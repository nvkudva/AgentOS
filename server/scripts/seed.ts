import { pool, one, closeAll } from '../src/db.js';
import { provisionRoom, type RoomSpec } from '../src/provision.js';

/**
 * The rooms Atrium ships with. They are created through exactly the same call the
 * "New room" form uses — if seeding needed a private path, "a room is data" would
 * be a claim about new rooms only.
 */
const ROOMS: RoomSpec[] = [
  { key: 'analytics', name: 'Analytics', objective: 'Answer questions from company data',
    color: '#4bb3d4', icon: '◈', budget_cents: 300, access: 'read_business',
    tools: ['sql.query', 'artifact.write', 'artifact.read', 'escalate'],
    agents: [
      { name: 'Ada', role: 'analyst', policy: 'analytics.weekly', avatar: '🔭', color: '#4bb3d4',
        persona: 'Cautious. Will not state a number she has not queried twice.' },
      { name: 'Bo', role: 'analyst', policy: 'analytics.weekly', avatar: '📐', color: '#63c9c0',
        persona: 'Fast and rough. Good for a first read, never the final one.' },
    ] },
  { key: 'engineering', name: 'Engineering', objective: 'Ship small, tested changes',
    color: '#6f8ef5', icon: '⌘', budget_cents: 400, access: 'none',
    tools: ['repo.read', 'repo.patch', 'repo.test', 'github.pr.open', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Kit', role: 'engineer', policy: 'engineering.fix', avatar: '🔧', color: '#6f8ef5',
        persona: 'Small diffs, real tests, no heroics. Refuses to ship red.' },
      { name: 'Rex', role: 'engineer', policy: 'demo.loop', avatar: '🌀', color: '#8a93a5',
        step_budget: 6, cost_budget_cents: 4,
        persona: 'Gets stuck in loops on purpose. He exists to prove the kill switch works.' },
    ] },
  { key: 'marketing', name: 'Marketing', objective: 'Draft numbers-backed posts',
    color: '#e0794b', icon: '✎', budget_cents: 200, access: 'none',
    tools: ['queue.draft', 'queue.publish', 'artifact.read', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Mel', role: 'writer', policy: 'marketing.launch', avatar: '✒️', color: '#e0794b',
        persona: 'Writes plainly, cites the analytics room, never publishes without asking.' },
      { name: 'Nia', role: 'editor', policy: 'marketing.launch', avatar: '🗞️', color: '#d9a441',
        persona: 'Second pair of eyes. Cuts a draft by a third before it goes anywhere.' },
    ] },
  { key: 'sales', name: 'Sales', objective: 'Keep the pipeline honest',
    color: '#3fb27f', icon: '◎', budget_cents: 200, access: 'write_pipeline',
    tools: ['sql.query', 'crm.note', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Sam', role: 'rep', policy: 'sales.hygiene', avatar: '📇', color: '#3fb27f',
        persona: 'Pipeline janitor. Flags stale deals before they rot.' },
      { name: 'Tor', role: 'analyst', policy: 'sales.hygiene', avatar: '📊', color: '#57b6a0',
        persona: 'Reads the pipeline as numbers, not stories. Blunt about what is dead.' },
    ] },
  { key: 'support', name: 'Support', objective: 'Answer customers before they chase us',
    color: '#e05b8f', icon: '☎', budget_cents: 250, access: 'support_desk',
    tools: ['ticket.list', 'ticket.reply', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Ren', role: 'support', policy: 'support.triage', avatar: '🎧', color: '#e05b8f',
        persona: 'Answers the oldest urgent thing first. Never promises a date.' },
      { name: 'Ola', role: 'support', policy: 'support.triage', avatar: '🛟', color: '#d67aa8',
        persona: 'Reads the whole thread before replying. Slower, fewer follow-ups.' },
    ] },
  { key: 'finance', name: 'Finance', objective: 'Close the month and watch the burn',
    color: '#c9a227', icon: '⛁', budget_cents: 250, access: 'read_business',
    tools: ['sql.query', 'artifact.write', 'artifact.read', 'escalate'],
    agents: [
      { name: 'Fay', role: 'controller', policy: 'finance.close', avatar: '🧾', color: '#c9a227',
        persona: 'Ties every number to a row. Will not round in your favour.' },
      { name: 'Gus', role: 'analyst', policy: 'finance.close', avatar: '💱', color: '#d9b64a',
        persona: 'Looks for the line that moved and asks why.' },
    ] },
  { key: 'research', name: 'Research', objective: 'Turn what the rooms found into a brief',
    color: '#7f8cd6', icon: '◍', budget_cents: 180, access: 'read_business',
    tools: ['artifact.read', 'artifact.write', 'sql.query', 'escalate'],
    agents: [
      { name: 'Val', role: 'researcher', policy: 'research.brief', avatar: '🔎', color: '#7f8cd6',
        persona: 'Digs for the thing nobody asked about. Slow, occasionally right.' },
    ] },
];

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

await bizdata();
for (const spec of ROOMS) {
  if (await one('SELECT 1 FROM room WHERE key=$1', [spec.key])) { console.log('room', spec.key, '(exists)'); continue; }
  await provisionRoom(spec);
  console.log('room', spec.key, '— created with', spec.agents.length, 'agents');
}
await closeAll();
