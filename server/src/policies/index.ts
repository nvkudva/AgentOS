import type { Ctx } from '../runtime/types.js';
import { callTool } from '../runtime/toolbelt.js';
import { q, one } from '../db.js';
import { pump } from '../tools/assign.js';

export type Step = { activity: string; run: (ctx: Ctx, s: Record<string, any>) => Promise<void> };
/** `uses` is what the job needs granted. A room cannot hire for work it cannot do. */
export type Policy = { key: string; goal: string; uses: string[]; steps: Step[] };

const T = (ctx: Ctx, name: string, args: any) => callTool(ctx, name, args);

/** ANALYTICS — real queries against the real bizdata schema, through the analytics DB role. */
const analyticsWeekly: Policy = {
  key: 'analytics.weekly',
  goal: 'Report last quarter revenue, top regions and churn',
  uses: ['sql.query', 'artifact.write'],
  steps: [
    { activity: 'querying revenue by month', async run(ctx, s) {
        s.revenue = await T(ctx, 'sql.query', { sql:
          `SELECT to_char(date_trunc('month', placed_at),'YYYY-MM') AS month,
                  sum(amount_cents)/100.0 AS revenue, count(*) AS orders
             FROM bizdata.orders WHERE status='paid'
            GROUP BY 1 ORDER BY 1 DESC LIMIT 6` });
      } },
    { activity: 'ranking regions by revenue', async run(ctx, s) {
        s.regions = await T(ctx, 'sql.query', { sql:
          `SELECT c.region, sum(o.amount_cents)/100.0 AS revenue, count(DISTINCT c.id) AS customers
             FROM bizdata.orders o JOIN bizdata.customer c ON c.id=o.customer_id
            WHERE o.status='paid' GROUP BY 1 ORDER BY 2 DESC` });
      } },
    { activity: 'measuring churn', async run(ctx, s) {
        s.churn = await T(ctx, 'sql.query', { sql:
          `SELECT plan, count(*) FILTER (WHERE churned_at IS NOT NULL) AS churned, count(*) AS total
             FROM bizdata.customer GROUP BY 1 ORDER BY 1` });
      } },
    { activity: 'writing the report', async run(ctx, s) {
        const body = [
          '## Revenue by month', table(s.revenue),
          '\n## Regions', table(s.regions),
          '\n## Churn by plan', table(s.churn),
        ].join('\n');
        s.artifact = await T(ctx, 'artifact.write', { kind: 'report', title: 'Quarterly numbers', body, shared: true });
      } },
  ],
};

/** ENGINEERING — real edit to a real git repo, real tests, real PR (always approved first). */
const engineeringFix: Policy = {
  key: 'engineering.fix',
  goal: 'Fix the rounding bug in pricing and open a PR',
  uses: ['repo.read', 'repo.patch', 'repo.test', 'github.pr.open', 'artifact.write', 'escalate'],
  steps: [
    { activity: 'reading src/pricing.js', async run(ctx, s) {
        s.file = await T(ctx, 'repo.read', { path: 'src/pricing.js', ref: 'main' });
      } },
    { activity: 'patching the rounding bug', async run(ctx, s) {
        const fixed = s.file.body.replace('Math.floor(cents * rate)', 'Math.round(cents * rate)');
        if (fixed === s.file.body) {
          // Nothing to do is a result, not a silent success. Tell the human and stop.
          await T(ctx, 'escalate', { question: 'main already rounds correctly — nothing to fix. Close this out?' });
          s.__done = true;
          return;
        }
        s.branch = `atrium/fix-rounding-${ctx.run.id.slice(-6)}`;
        s.commit = await T(ctx, 'repo.patch', {
          path: 'src/pricing.js', body: fixed, branch: s.branch, from: 'main',
          message: 'fix: round discounted cents instead of flooring',
        });
      } },
    { activity: 'running the test suite', async run(ctx, s) {
        if (s.__done) return;
        s.tests = await T(ctx, 'repo.test', {});
        if (!s.tests.passed) throw new Error('tests failed after patch: ' + s.tests.output.slice(0, 300));
      } },
    { activity: 'requesting approval to open the PR', async run(ctx, s) {
        if (s.__done) return;
        s.pr = await T(ctx, 'github.pr.open', {
          branch: s.branch, base: 'main',
          title: 'fix: round discounted cents instead of flooring',
          body: 'Discounted totals were floored, losing up to a cent per line. Tests pass.',
        });
      } },
    { activity: 'recording the PR', async run(ctx, s) {
        if (s.__done) return;
        await T(ctx, 'artifact.write', { kind: 'pr', title: 'Pricing rounding fix', shared: true,
          body: JSON.stringify(s.pr, null, 2) });
      } },
  ],
};

/** MARKETING — reads the shared analytics artifact, drafts into the real content queue. */
const marketingLaunch: Policy = {
  key: 'marketing.launch',
  goal: 'Draft a numbers-backed post and queue it',
  uses: ['artifact.read', 'queue.draft', 'queue.publish'],
  steps: [
    { activity: 'reading shared analytics artifacts', async run(ctx, s) {
        s.shared = await T(ctx, 'artifact.read', { room_key_source: 'analytics' });
      } },
    { activity: 'drafting the post', async run(ctx, s) {
        const src = s.shared.shared?.[0];
        const body = src
          ? `Our quarter, in the open.\n\n${src.body.split('\n').slice(0, 14).join('\n')}\n\nNumbers pulled straight from production.`
          : 'Our quarter, in the open. (Waiting on analytics for the numbers.)';
        s.draft = await T(ctx, 'queue.draft', { channel: 'blog', title: 'Our quarter, in the open', body });
      } },
    { activity: 'requesting approval to publish', async run(ctx, s) {
        s.published = await T(ctx, 'queue.publish', { id: s.draft.id, channel: 'blog' });
      } },
  ],
};

/** SALES — real reads and a real narrow write. */
const salesHygiene: Policy = {
  key: 'sales.hygiene',
  goal: 'Flag stale pipeline',
  uses: ['sql.query', 'crm.note', 'artifact.write'],
  steps: [
    { activity: 'finding deals untouched for 30 days', async run(ctx, s) {
        s.stale = await T(ctx, 'sql.query', { sql:
          `SELECT id, account, stage, value_cents/100.0 AS value, last_touch
             FROM bizdata.pipeline
            WHERE last_touch < current_date - 30 AND stage NOT IN ('won','lost')
            ORDER BY value_cents DESC LIMIT 5` });
      } },
    { activity: 'annotating the stalest deal', async run(ctx, s) {
        const top = s.stale.rows?.[0];
        if (!top) return;
        s.noted = await T(ctx, 'crm.note', { id: top.id, note: `Stale ${top.last_touch}: no touch in 30+ days. Flagged by Atrium.` });
      } },
    { activity: 'summarising', async run(ctx, s) {
        await T(ctx, 'artifact.write', { kind: 'note', title: 'Stale pipeline', shared: true,
          body: table(s.stale) });
      } },
  ],
};

/** STRATEGY — cross-room synthesis via the shared artifact store only (DECISION D3). */
const strategySynth: Policy = {
  key: 'strategy.synth',
  goal: 'Synthesise what the other rooms found',
  uses: ['artifact.read', 'artifact.write', 'escalate'],
  steps: [
    { activity: 'reading shared artifacts', async run(ctx, s) {
        s.all = await T(ctx, 'artifact.read', {});
      } },
    { activity: 'asking the operator which thread to pull', async run(ctx, s) {
        if (s.asked) return;
        s.asked = await T(ctx, 'escalate', {
          question: 'Two rooms report opposite signals on the enterprise plan. Chase revenue or churn first?',
          est_cost_cents: 0,
        });
      } },
    { activity: 'writing the synthesis', async run(ctx, s) {
        const titles = (s.all.shared ?? []).map((a: any) => `- ${a.room}: ${a.title}`).join('\n');
        await T(ctx, 'artifact.write', { kind: 'synthesis', title: 'Cross-room read', body: titles || 'nothing shared yet' });
      } },
  ],
};

/**
 * A policy that deliberately loops. It exists to prove R4: the runtime kills it on
 * step and cost budget, without the operator noticing anything.
 */
const loopTrap: Policy = {
  key: 'demo.loop',
  goal: 'Deliberately spin, to exercise the kill switch',
  uses: ['artifact.write'],
  steps: [
    { activity: 'retrying the same write', async run(ctx, s) {
        await T(ctx, 'artifact.write', { kind: 'note', title: 'spin', body: 'again' });
        s.__repeat = true;   // never advances
      } },
  ],
};

/** SUPPORT — reads the real ticket table and answers one, with your approval. */
const supportTriage: Policy = {
  key: 'support.triage',
  goal: 'Answer the oldest urgent ticket',
  uses: ['ticket.list', 'ticket.reply', 'artifact.write'],
  steps: [
    { activity: 'looking at open tickets', async run(ctx, s) {
        s.open = await T(ctx, 'ticket.list', { status: 'open', limit: 10 });
      } },
    { activity: 'picking the one that has waited longest', async run(ctx, s) {
        s.pick = s.open.rows?.[0];
        if (!s.pick) { s.__done = true; return; }
      } },
    { activity: 'drafting a reply', async run(ctx, s) {
        if (s.__done) return;
        const t = s.pick;
        s.draft =
          `Hi ${t.customer ?? 'there'},\n\n` +
          `Thanks for writing in about "${t.subject}". We have looked into it and are on it now. ` +
          `You are on the ${t.plan ?? 'current'} plan, so this is covered.\n\n` +
          `We will follow up here as soon as it is resolved.\n\nSupport`;
      } },
    { activity: 'asking you before it goes to the customer', async run(ctx, s) {
        if (s.__done) return;
        s.sent = await T(ctx, 'ticket.reply', { id: s.pick.id, reply: s.draft });
      } },
    { activity: 'writing up what was answered', async run(ctx, s) {
        if (s.__done) return;
        await T(ctx, 'artifact.write', { kind: 'note', shared: true,
          title: `Answered ticket #${s.pick.id}`, body: `**${s.pick.subject}**\n\n${s.draft}` });
      } },
  ],
};

/** FINANCE — real numbers out of the real database, written up as a memo. */
const financeClose: Policy = {
  key: 'finance.close',
  goal: 'Close the month: revenue, refunds and what is still open',
  uses: ['sql.query', 'artifact.write'],
  steps: [
    { activity: 'adding up the last full month', async run(ctx, s) {
        s.rev = await T(ctx, 'sql.query', { sql:
          `SELECT to_char(date_trunc('month', placed_at),'YYYY-MM') AS month,
                  sum(amount_cents) FILTER (WHERE status='paid')/100.0     AS paid,
                  sum(amount_cents) FILTER (WHERE status='refunded')/100.0 AS refunded,
                  count(*) FILTER (WHERE status='paid')                    AS orders
             FROM bizdata.orders
            GROUP BY 1 ORDER BY 1 DESC LIMIT 3` });
      } },
    { activity: 'checking what is still in the pipeline', async run(ctx, s) {
        s.open = await T(ctx, 'sql.query', { sql:
          `SELECT stage, count(*) AS deals, sum(value_cents)/100.0 AS value
             FROM bizdata.pipeline WHERE stage NOT IN ('won','lost')
            GROUP BY 1 ORDER BY 3 DESC` });
      } },
    { activity: 'writing the month-end memo', async run(ctx, s) {
        await T(ctx, 'artifact.write', { kind: 'memo', shared: true, title: 'Month-end close',
          body: ['## Revenue', table(s.rev), '\n## Still open', table(s.open)].join('\n') });
      } },
  ],
};

/** RESEARCH — reads what every room published, backs it with one number, writes a brief. */
const researchBrief: Policy = {
  key: 'research.brief',
  goal: 'Turn what the other rooms found into a short brief',
  uses: ['artifact.read', 'sql.query', 'artifact.write'],
  steps: [
    { activity: 'reading what other rooms shared', async run(ctx, s) {
        s.shared = await T(ctx, 'artifact.read', {});
      } },
    { activity: 'checking one number for itself', async run(ctx, s) {
        s.check = await T(ctx, 'sql.query', { sql:
          `SELECT c.region, count(*) AS customers,
                  round(100.0 * count(*) FILTER (WHERE c.churned_at IS NOT NULL) / count(*), 1) AS churn_pct
             FROM bizdata.customer c GROUP BY 1 ORDER BY 3 DESC` });
      } },
    { activity: 'writing the brief', async run(ctx, s) {
        const cited = (s.shared.shared ?? []).map((a: any) => `- ${a.room}: ${a.title}`).join('\n');
        await T(ctx, 'artifact.write', { kind: 'brief', shared: true, title: 'Weekly brief',
          body: `## What the rooms reported\n${cited || '_nothing shared yet_'}\n\n## Churn by region\n${table(s.check)}` });
      } },
  ],
};


/**
 * THE MANAGER TIER. It does no tool work of its own — it reads the sentence you
 * spoke, cuts it into tasks, hands each one to a worker, waits, and tells you what
 * happened. If it ever needed a real grant it would be a worker with a better title.
 */
const DECOMPOSITIONS: Record<string, { match: string[]; tasks: string[] }[]> = {
  analytics: [
    { match: ['churn', 'retention', 'cancel', 'leaving'],
      tasks: ['Pull churn by plan for the period', 'Split churn by region and tenure', 'Write the churn read-out'] },
    { match: ['revenue', 'growth', 'quarter', 'sales', 'numbers'],
      tasks: ['Total paid revenue by month', 'Rank regions by revenue', 'Write up the quarterly numbers'] },
    { match: [], tasks: ['Query the numbers behind the question', 'Sanity-check them against last quarter', 'Write the finding up'] },
  ],
  engineering: [
    { match: ['bug', 'fix', 'broken', 'rounding', 'crash'],
      tasks: ['Read the code path that is wrong', 'Patch it on a branch and run the tests', 'Open the pull request'] },
    { match: [], tasks: ['Reproduce what was asked for', 'Make the change on a branch', 'Run the tests and report'] },
  ],
  marketing: [
    { match: ['post', 'launch', 'announce', 'blog', 'write'],
      tasks: ['Pull the numbers worth quoting', 'Draft the post', 'Cut it down and queue it'] },
    { match: [], tasks: ['Read what the other rooms published', 'Draft something worth sending', 'Queue it for your approval'] },
  ],
  sales: [
    { match: ['pipeline', 'deal', 'stale', 'forecast'],
      tasks: ['List deals untouched for 30 days', 'Annotate the stalest deal', 'Summarise what is rotting'] },
    { match: [], tasks: ['Read the pipeline as it stands', 'Flag what has gone quiet', 'Write up what needs a call'] },
  ],
  support: [
    { match: ['ticket', 'customer', 'refund', 'angry', 'waiting'],
      tasks: ['List the tickets that have waited longest', 'Draft a reply to the oldest', 'Write up what was answered'] },
    { match: [], tasks: ['Read the open queue', 'Answer the one that has waited longest', 'Write up what was answered'] },
  ],
  finance: [
    { match: ['close', 'month', 'burn', 'spend', 'refund'],
      tasks: ['Add up the last full month', 'Check what is still open', 'Write the month-end memo'] },
    { match: [], tasks: ['Pull the figures the question needs', 'Tie each one back to a row', 'Write the memo'] },
  ],
  research: [
    { match: ['brief', 'compare', 'look into', 'investigate'],
      tasks: ['Read what every room published', 'Check one number independently', 'Write the brief'] },
    { match: [], tasks: ['Gather what is already known', 'Verify the load-bearing number', 'Write the brief'] },
  ],
  strategy: [
    { match: ['decide', 'priorit', 'trade-off', 'bet'],
      tasks: ['Read what the rooms are reporting', 'Name the trade-off out loud', 'Write the synthesis'] },
    { match: [], tasks: ['Read across the rooms', 'Write the synthesis'] },
  ],
};
const FALLBACK = [
  { match: [], tasks: ['Read what this room already knows', 'Do the work that was asked for', 'Write up the result'] },
];

/** Deterministic: same room, same words, same plan. 2–4 titles, never more. */
export function decompose(roomKey: string, text: string): string[] {
  const t = (text ?? '').toLowerCase();
  const table = DECOMPOSITIONS[roomKey] ?? FALLBACK;
  const hit = table.find((r) => r.match.length && r.match.some((k) => t.includes(k)))
           ?? table[table.length - 1];
  return hit.tasks.slice(0, 4);
}

const roomManager: Policy = {
  key: 'room.manager',
  goal: 'Take what the operator asked for, break it up, and see it done',
  uses: ['assign', 'report', 'clarify'],
  steps: [
    { activity: 'reading what you asked for', async run(ctx, s) {
        const m = await one<any>(`SELECT * FROM mandate WHERE id=$1`, [ctx.run.mandate_id]);
        s.mandate_id = m?.id ?? null;
        s.text = m?.text ?? ctx.run.goal;
        // A redirected mandate arrives holding what the last room already produced.
        s.context = m?.context ?? [];
        if (s.context.length) await ctx.say(`carrying ${s.context.length} artifact(s) from the last room`);
        if (m) await q(`UPDATE mandate SET state='planned' WHERE id=$1`, [m.id]);
      } },
    { activity: 'asking you one question', async run(ctx, s) {
        // Only when the sentence left out the one thing that changes the plan. A manager
        // that asks about everything is worse than one that guesses.
        // Only work that is actually measured over time has a period to ask about.
        // Asking a launch post which quarter it covers is worse than not asking at all.
        const timed = /\b(analy[sz]|report|churn|revenue|numbers|metrics?|trend|forecast|growth|retention|pipeline|conversion|traffic|spend|cohort|sales figures)\w*/i;
        if (s.answer || !timed.test(s.text)) return;
        if (/\b(last|this|next|q[1-4]|week|month|quarter|year|today|yesterday)\b/i.test(s.text)) return;
        if (!s.clarify_id) {
          const r = await T(ctx, 'clarify', {
            question: `Which period should I take "${String(s.text).slice(0, 48)}" over?`,
            answers: ['last quarter', 'last month', 'all time'],
          });
          s.clarify_id = r.clarify_id;
        }
        const row = await one<any>(`SELECT state, decided_note FROM approval WHERE id=$1`, [s.clarify_id]);
        if (!row || row.state === 'pending') { s.__repeat = true; s.__sameStep = 0; return; }
        s.answer = row.decided_note ?? 'all time';
        s.text = `${s.text} (${s.answer})`;
        await ctx.say(`you said ${s.answer}`);
      } },
    { activity: 'breaking it into tasks', async run(ctx, s) {
        s.titles = decompose(ctx.room.key, s.text);
        s.plan = await T(ctx, 'assign', { mandate_id: s.mandate_id, titles: s.titles });
        await ctx.say(`assigned ${s.titles.length} tasks`);
      } },
    { activity: 'watching its workers', async run(ctx, s) {
        if (!s.mandate_id) return;
        await pump(s.mandate_id, ctx.room.id);
        // Only the tasks this room owns. After a redirect the previous room's tasks are
        // still on the mandate, and counting them would report someone else's work.
        const rows = await q<any>(
          `SELECT t.state, count(*)::int AS n FROM task t
             JOIN agent a ON a.id=t.agent_id
            WHERE t.mandate_id=$1 AND a.room_id=$2 GROUP BY 1`, [s.mandate_id, ctx.room.id]);
        const by: Record<string, number> = Object.fromEntries(rows.map((r) => [r.state, r.n]));
        const total = rows.reduce((a, r) => a + r.n, 0);
        const open = (by.queued ?? 0) + (by.working ?? 0);
        if (open > 0) {
          await ctx.say(`${by.done ?? 0} of ${total} done`);
          s.__repeat = true;
          // Waiting is not looping. The scheduler kills three identical steps in a row;
          // a manager whose crew is still working must be allowed to keep waiting.
          s.__sameStep = 0;
        }
      } },
    { activity: 'reporting back to you', async run(ctx, s) {
        s.said = await T(ctx, 'report', { mandate_id: s.mandate_id });
      } },
  ],
};

function table(res: any): string {
  const rows = res?.rows ?? [];
  if (!rows.length) return '_no rows_';
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r: any) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
}

export const POLICIES: Record<string, Policy> = Object.fromEntries(
  [analyticsWeekly, engineeringFix, marketingLaunch, salesHygiene, strategySynth,
   supportTriage, financeClose, researchBrief, loopTrap, roomManager].map((p) => [p.key, p])
);
