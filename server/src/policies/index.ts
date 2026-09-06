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

function table(res: any): string {
  const rows = res?.rows ?? [];
  if (!rows.length) return '_no rows_';
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r: any) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
}

export const POLICIES: Record<string, Policy> = Object.fromEntries(
  [analyticsWeekly, engineeringFix, marketingLaunch, salesHygiene, strategySynth, loopTrap].map((p) => [p.key, p])
);
