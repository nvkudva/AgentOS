import { pool, closeAll } from '../src/db.js';
import { id } from '../src/ids.js';

const ROOMS = [
  { key: 'analytics', name: 'Analytics', objective: 'Answer questions from company data',
    x: 0, y: 0, w: 2, h: 1, budget: 300, role: 'atrium_analytics',
    grants: ['sql.query', 'artifact.write', 'artifact.read', 'escalate'],
    policy: { low: 'auto', medium: 'auto', high: 'approve' } },
  { key: 'engineering', name: 'Engineering', objective: 'Ship small, tested changes',
    x: 2, y: 0, w: 2, h: 1, budget: 400, role: 'atrium_engineering',
    grants: ['repo.read', 'repo.patch', 'repo.test', 'github.pr.open', 'artifact.write', 'escalate'],
    policy: { low: 'auto', medium: 'auto', high: 'approve' } },
  { key: 'marketing', name: 'Marketing', objective: 'Draft numbers-backed posts',
    x: 0, y: 1, w: 2, h: 1, budget: 200, role: 'atrium_marketing',
    grants: ['queue.draft', 'queue.publish', 'artifact.read', 'artifact.write', 'escalate'],
    policy: { low: 'auto', medium: 'auto', high: 'approve' } },
  { key: 'sales', name: 'Sales', objective: 'Keep the pipeline honest',
    x: 2, y: 1, w: 2, h: 1, budget: 200, role: 'atrium_sales',
    grants: ['sql.query', 'crm.note', 'artifact.write', 'escalate'],
    policy: { low: 'auto', medium: 'auto', high: 'approve' } },
  { key: 'strategy', name: 'Strategy', objective: 'Synthesise across rooms',
    x: 0, y: 2, w: 4, h: 1, budget: 150, role: 'atrium_strategy',
    grants: ['artifact.read', 'artifact.write', 'escalate'],
    policy: { low: 'auto', medium: 'auto', high: 'approve' } },
];

const AGENTS: Record<string, Array<[string, string, string]>> = {
  analytics:   [['Ada', 'analyst', 'analytics.weekly'], ['Bo', 'analyst', 'analytics.weekly']],
  engineering: [['Kit', 'engineer', 'engineering.fix'], ['Rex', 'engineer', 'demo.loop']],
  marketing:   [['Mel', 'writer', 'marketing.launch']],
  sales:       [['Sam', 'rep', 'sales.hygiene']],
  strategy:    [['Iris', 'strategist', 'strategy.synth']],
};

async function bizdata() {
  const c = await pool.query('SELECT count(*)::int n FROM bizdata.customer');
  if (c.rows[0].n) return console.log('bizdata already seeded');
  const regions = ['NA', 'EMEA', 'APAC'], plans = ['starter', 'team', 'enterprise'];
  for (let i = 1; i <= 120; i++) {
    const churn = Math.random() < 0.18 ? `current_date - ${Math.floor(Math.random() * 120)}` : 'NULL';
    await pool.query(
      `INSERT INTO bizdata.customer (name, plan, region, signed_up, churned_at)
       VALUES ($1,$2,$3, current_date - $4::int, ${churn})`,
      [`Customer ${i}`, plans[i % 3], regions[i % 3], 60 + Math.floor(Math.random() * 600)]);
  }
  for (let i = 0; i < 900; i++) {
    await pool.query(
      `INSERT INTO bizdata.orders (customer_id, placed_at, amount_cents, status)
       VALUES ($1, current_date - $2::int, $3, $4)`,
      [1 + Math.floor(Math.random() * 120), Math.floor(Math.random() * 180),
       2000 + Math.floor(Math.random() * 90000), Math.random() < 0.9 ? 'paid' : 'refunded']);
  }
  const stages = ['discovery', 'demo', 'negotiation', 'won', 'lost'];
  for (let i = 0; i < 40; i++) {
    await pool.query(
      `INSERT INTO bizdata.pipeline (account, stage, value_cents, owner, last_touch)
       VALUES ($1,$2,$3,$4, current_date - $5::int)`,
      [`Account ${i}`, stages[i % 5], 50000 + Math.floor(Math.random() * 900000), 'Sam',
       Math.floor(Math.random() * 70)]);
  }
  console.log('bizdata seeded');
}

const main = async () => {
  await bizdata();
  for (const r of ROOMS) {
    const rid = id('room');
    const { rows } = await pool.query(
      `INSERT INTO room (id,key,name,objective,x,y,w,h,budget_cents,tool_grants,approval_policy,db_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (key) DO UPDATE SET tool_grants=EXCLUDED.tool_grants, db_role=EXCLUDED.db_role,
         objective=EXCLUDED.objective, x=EXCLUDED.x, y=EXCLUDED.y, w=EXCLUDED.w, h=EXCLUDED.h
       RETURNING id`,
      [rid, r.key, r.name, r.objective, r.x, r.y, r.w, r.h, r.budget,
       JSON.stringify(r.grants), JSON.stringify(r.policy), r.role]);
    const roomId = rows[0].id;
    for (const [name, role, policy] of AGENTS[r.key] ?? []) {
      const exists = await pool.query('SELECT 1 FROM agent WHERE room_id=$1 AND name=$2', [roomId, name]);
      if (exists.rowCount) continue;
      await pool.query(
        `INSERT INTO agent (id, room_id, name, role, policy_key, step_budget, cost_budget_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id('agt'), roomId, name, role, policy, policy === 'demo.loop' ? 6 : 40, policy === 'demo.loop' ? 4 : 120]);
    }
    console.log('room', r.key);
  }
  await closeAll();
};
main().catch((e) => { console.error(e); process.exit(1); });
