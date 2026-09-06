import type { Ctx } from '../runtime/types.js';
import { callTool } from '../runtime/toolbelt.js';

export type Step = { activity: string; run: (ctx: Ctx, s: Record<string, any>) => Promise<void> };
export type Policy = { key: string; goal: string; steps: Step[] };

const T = (ctx: Ctx, name: string, args: any) => callTool(ctx, name, args);

/** ANALYTICS — real queries against the real bizdata schema, through the analytics DB role. */
const analyticsWeekly: Policy = {
  key: 'analytics.weekly',
  goal: 'Report last quarter revenue, top regions and churn',
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

function table(res: any): string {
  const rows = res?.rows ?? [];
  if (!rows.length) return '_no rows_';
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r: any) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
}

export const POLICIES: Record<string, Policy> = Object.fromEntries(
  [analyticsWeekly, engineeringFix, marketingLaunch, salesHygiene, strategySynth,
   supportTriage, financeClose, researchBrief, loopTrap].map((p) => [p.key, p])
);
