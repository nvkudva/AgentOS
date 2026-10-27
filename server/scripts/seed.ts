import { pool, one, closeAll } from '../src/db.js';
import { provisionRoom, type RoomSpec } from '../src/provision.js';

/**
 * The rooms Atrium ships with. They are created through exactly the same call the
 * "New room" form uses — if seeding needed a private path, "a room is data" would
 * be a claim about new rooms only.
 */
const ROOMS: RoomSpec[] = [
  { key: 'engineering', name: 'Engineering', objective: 'Keep the Copper Cup ordering site fast and green',
    color: '#6f8ef5', icon: '⌘', budget_cents: 400, access: 'none',
    tools: ['repo.read', 'repo.patch', 'repo.test', 'github.pr.open', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Kit', role: 'engineer', policy: 'engineering.fix', avatar: '👨‍💻', color: '#6f8ef5',
        persona: 'Small diffs, real tests, no heroics. Refuses to ship a red checkout page.' },
      { name: 'Rex', role: 'engineer', policy: 'demo.loop', avatar: '🧑‍💻', color: '#8a93a5',
        step_budget: 6, cost_budget_cents: 4,
        persona: 'Gets stuck in loops on purpose. He exists to prove the kill switch works.' },
    ] },
  { key: 'analytics', name: 'Analytics', objective: 'Answer questions from the till and the website',
    color: '#4bb3d4', icon: '◈', budget_cents: 300, access: 'read_business',
    tools: ['sql.query', 'artifact.write', 'artifact.read', 'escalate'],
    agents: [
      { name: 'Ada', role: 'analyst', policy: 'analytics.weekly', avatar: '👩‍🔬', color: '#4bb3d4',
        persona: 'Cautious. Will not state a number she has not queried twice.' },
      { name: 'Bo', role: 'analyst', policy: 'analytics.weekly', avatar: '🧑‍🔬', color: '#63c9c0',
        persona: 'Fast and rough. Good for a first read of the morning rush, never the final one.' },
    ] },
  { key: 'marketing', name: 'Marketing', objective: 'Fill the café on slow afternoons',
    color: '#e0794b', icon: '✎', budget_cents: 200, access: 'none',
    tools: ['queue.draft', 'queue.publish', 'artifact.read', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Mel', role: 'writer', policy: 'marketing.launch', avatar: '👩‍🎨', color: '#e0794b',
        persona: 'Writes plainly, cites the analytics room, never publishes without asking.' },
      { name: 'Nia', role: 'editor', policy: 'marketing.launch', avatar: '🧑‍🏫', color: '#d9a441',
        persona: 'Second pair of eyes. Cuts a draft by a third before it goes anywhere.' },
    ] },
  { key: 'sales', name: 'Sales', objective: 'Sign offices up for weekly bean delivery',
    color: '#3fb27f', icon: '◎', budget_cents: 200, access: 'write_pipeline',
    tools: ['sql.query', 'crm.note', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Sam', role: 'rep', policy: 'sales.hygiene', avatar: '🤵', color: '#3fb27f',
        persona: 'Pipeline janitor. Flags stale wholesale deals before they rot.' },
      { name: 'Tor', role: 'analyst', policy: 'sales.hygiene', avatar: '👨‍🔬', color: '#57b6a0',
        persona: 'Reads the pipeline as numbers, not stories. Blunt about which offices will never buy.' },
    ] },
  { key: 'support', name: 'Support', objective: 'Answer customers before they chase us',
    color: '#e05b8f', icon: '☎', budget_cents: 250, access: 'support_desk',
    tools: ['ticket.list', 'ticket.reply', 'artifact.write', 'escalate'],
    agents: [
      { name: 'Ren', role: 'support', policy: 'support.triage', avatar: '💁', color: '#e05b8f',
        persona: 'Answers the oldest urgent thing first. Never promises a pickup date.' },
      { name: 'Ola', role: 'support', policy: 'support.triage', avatar: '💁‍♂️', color: '#d67aa8',
        persona: 'Reads the whole thread before replying. Slower, fewer follow-ups.' },
    ] },
  { key: 'finance', name: 'Finance', objective: 'Close the month and watch the food cost',
    color: '#c9a227', icon: '⛁', budget_cents: 250, access: 'read_business',
    tools: ['sql.query', 'artifact.write', 'artifact.read', 'escalate'],
    agents: [
      { name: 'Fay', role: 'controller', policy: 'finance.close', avatar: '👩‍⚖️', color: '#c9a227',
        persona: 'Ties every number to a till row. Will not round in your favour.' },
      { name: 'Gus', role: 'analyst', policy: 'finance.close', avatar: '👨‍🏫', color: '#d9b64a',
        persona: 'Looks for the line that moved — usually oat milk — and asks why.' },
    ] },
  { key: 'research', name: 'Research', objective: 'Taste what is next on the menu',
    color: '#7f8cd6', icon: '◍', budget_cents: 180, access: 'read_business',
    tools: ['artifact.read', 'artifact.write', 'sql.query', 'escalate'],
    agents: [
      { name: 'Val', role: 'researcher', policy: 'research.brief', avatar: '🕵️', color: '#7f8cd6',
        persona: 'Digs for the drink nobody asked about. Slow, occasionally right.' },
    ] },
];

/** Copper Cup Coffee: three neighbourhood cafés plus an ordering website. */
const FIRST = ['Maya', 'Jonas', 'Priya', 'Theo', 'Lena', 'Marcus', 'Aisha', 'Diego', 'Nora', 'Felix',
  'June', 'Omar', 'Tessa', 'Ravi', 'Wren', 'Kofi', 'Alba', 'Milo', 'Sana', 'Ellis'];
const LAST = ['R.', 'K.', 'S.', 'M.', 'T.', 'B.', 'H.', 'L.', 'P.', 'D.'];
const CAFES = ['flagship', 'riverside', 'market'];
const OFFICES = ['Hale & Co', 'Brightline Studio', 'North Pier Legal', 'Fern Clinic', 'Loopworks',
  'Cedar School', 'Beacon Realty', 'Foxglove Press'];

async function bizdata() {
  const c = await pool.query('SELECT count(*)::int n FROM bizdata.customer');
  if (c.rows[0].n) return console.log('bizdata already seeded');
  const plans = ['regular', 'subscriber', 'wholesale'];
  for (let i = 1; i <= 120; i++) {
    const churn = Math.random() < 0.18 ? `current_date - ${Math.floor(Math.random() * 120)}` : 'NULL';
    await pool.query(
      `INSERT INTO bizdata.customer (name, plan, region, signed_up, churned_at)
       VALUES ($1,$2,$3, current_date - $4::int, ${churn})`,
      [`${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`, plans[i % 3], CAFES[i % 3],
       60 + Math.floor(Math.random() * 600)]);
  }
  for (let i = 0; i < 900; i++) {
    await pool.query(
      `INSERT INTO bizdata.orders (customer_id, placed_at, amount_cents, status)
       VALUES ($1, current_date - $2::int, $3, $4)`,
      [1 + Math.floor(Math.random() * 120), Math.floor(Math.random() * 180),
       350 + Math.floor(Math.random() * 1050), Math.random() < 0.9 ? 'paid' : 'refunded']);
  }
  const stages = ['discovery', 'demo', 'negotiation', 'won', 'lost'];
  for (let i = 0; i < 40; i++) {
    await pool.query(
      `INSERT INTO bizdata.pipeline (account, stage, value_cents, owner, last_touch)
       VALUES ($1,$2,$3,$4, current_date - $5::int)`,
      [`${OFFICES[i % OFFICES.length]}${i >= OFFICES.length ? ` — site ${1 + Math.floor(i / OFFICES.length)}` : ''}`,
       stages[i % 5], 20000 + Math.floor(Math.random() * 180000), 'Sam',
       Math.floor(Math.random() * 70)]);
  }
  console.log('bizdata seeded');
}

async function tickets() {
  const c = await pool.query('SELECT count(*)::int n FROM support.ticket');
  if (c.rows[0].n) return console.log('tickets already seeded');
  const rows: [string, string, string, string][] = [
    ['Oat flat white tasted thin this morning', 'Regular says the riverside flat white was watery around 8am. Asked if the grinder was recalibrated.', 'high', 'open'],
    ['Birthday cake order for Saturday pickup', 'Chocolate hazelnut cake for 12, pickup Saturday 10am at flagship. Wants “happy 40th Bea” on top.', 'normal', 'open'],
    ['App shows sold out but shelf was full', 'Website listed morning buns as sold out at 9:20; the shelf still had a full tray. Lost a pre-order.', 'urgent', 'open'],
    ['Bean subscription skipped a week', 'Wholesale subscriber missed last Tuesday’s 2kg delivery, no note on the account. Wants a makeup bag.', 'normal', 'open'],
    ['Wrong milk in delivery order', 'Large latte arrived with dairy instead of oat. Refunded already, customer asked us to flag the ticket.', 'low', 'answered'],
  ];
  for (const [subject, body, priority, status] of rows) {
    await pool.query(
      `INSERT INTO support.ticket (customer_id, subject, body, priority, status)
       VALUES (1 + (random() * 119)::int, $1, $2, $3, $4)`, [subject, body, priority, status]);
  }
  console.log('tickets seeded');
}

/**
 * Yesterday's paper trail: a short readable back-and-forth in every room, so an
 * opened room reads like the chat it is even before the crew says anything new.
 * Guarded — existing desks keep the history they already have.
 */
async function threads() {
  // Provisioning itself writes room.created events, so guard on speech: a desk
  // whose crew has already talked keeps its own history.
  const c = await pool.query(`SELECT count(*)::int n FROM event WHERE type='agent.said'`);
  if (c.rows[0].n) return console.log('threads already seeded');
  const aid: Record<string, string> = {};
  const workers = await pool.query<{ room_id: string; id: string; name: string }>(
    `SELECT a.room_id, a.id, a.name FROM agent a JOIN room r ON r.id=a.room_id WHERE a.tier='worker'`);
  for (const r of workers.rows) {
    aid[`${r.room_id}:${r.name}`] = r.id;
  }
  const rooms = await pool.query<{ id: string; key: string }>('SELECT id, key FROM room');
  const byKey: Record<string, string> = {};
  for (const r of rooms.rows) byKey[r.key] = r.id;
  // [roomKey, agentName, type, payload, minutesAgo]
  const script: [string, string, string, any, number][] = [
    ['engineering', 'Kit', 'run.started', { goal: 'Fix the checkout 500 on oat-milk large lattes' }, 190],
    ['engineering', 'Kit', 'agent.said', { activity: 'Reproduced it: the oat surcharge line drops out of the cart when the size is large' }, 185],
    ['engineering', 'Kit', 'tool.call', { tool: 'repo.read' }, 180],
    ['engineering', 'Kit', 'tool.result', { result: { rowCount: 3 } }, 179],
    ['engineering', 'Rex', 'agent.said', { activity: 'I can reproduce it five different ways if that helps' }, 170],
    ['engineering', 'Kit', 'agent.said', { activity: 'One way is enough. Patch is up, tests green, keeping the diff to eleven lines' }, 160],
    ['engineering', 'Kit', 'tool.call', { tool: 'repo.test' }, 159],
    ['engineering', 'Kit', 'tool.result', { result: { passed: true } }, 155],
    ['engineering', 'Kit', 'run.finished', {}, 150],
    ['analytics', 'Bo', 'run.started', { goal: 'Which drinks actually make money?' }, 240],
    ['analytics', 'Bo', 'agent.said', { activity: 'Pulled the morning rush first: oat flat white outsells dairy two to one at riverside' }, 235],
    ['analytics', 'Bo', 'tool.call', { tool: 'sql.query' }, 234],
    ['analytics', 'Bo', 'tool.result', { result: { rowCount: 214 } }, 233],
    ['analytics', 'Ada', 'agent.said', { activity: 'Ran it again by café and day. Same answer, and subscribers tip 30 percent more often' }, 220],
    ['analytics', 'Ada', 'tool.call', { tool: 'sql.query' }, 219],
    ['analytics', 'Ada', 'tool.result', { result: { rowCount: 96 } }, 218],
    ['analytics', 'Ada', 'run.finished', {}, 210],
    ['marketing', 'Mel', 'run.started', { goal: 'Fill Tuesday afternoons at the market café' }, 300],
    ['marketing', 'Mel', 'agent.said', { activity: 'Drafted the two-for-one cortado post, cited Ada’s rush numbers so it is not just vibes' }, 290],
    ['marketing', 'Mel', 'tool.call', { tool: 'queue.draft' }, 285],
    ['marketing', 'Nia', 'agent.said', { activity: 'Cut it by a third and killed the exclamation marks. Ready when you are' }, 270],
    ['marketing', 'Nia', 'run.finished', {}, 265],
    ['sales', 'Sam', 'run.started', { goal: 'Chase the three stalled wholesale tastings' }, 200],
    ['sales', 'Sam', 'agent.said', { activity: 'Hale & Co went quiet after the tasting. Not dead, just quiet — flagging for Thursday' }, 195],
    ['sales', 'Tor', 'agent.said', { activity: 'Numbers say otherwise: no reply in 21 days means dead. Move them to lost and stop watering them' }, 188],
    ['sales', 'Sam', 'tool.call', { tool: 'crm.note' }, 185],
    ['sales', 'Sam', 'run.finished', {}, 180],
    ['support', 'Ren', 'run.started', { goal: 'Clear the overnight ticket queue' }, 120],
    ['support', 'Ren', 'agent.said', { activity: 'Sold-out-but-shelf-full is the urgent one — that is a lost pre-order, answering first' }, 115],
    ['support', 'Ren', 'tool.call', { tool: 'ticket.list' }, 114],
    ['support', 'Ren', 'tool.result', { result: { rowCount: 4 } }, 113],
    ['support', 'Ola', 'agent.said', { activity: 'Read the whole thread on the oat flat white. Grinder was recalibrated at 9, so say that and mean it' }, 100],
    ['support', 'Ola', 'run.finished', {}, 95],
    ['finance', 'Fay', 'run.started', { goal: 'Close September, explain the milk line' }, 400],
    ['finance', 'Gus', 'agent.said', { activity: 'Oat milk spend is up 40 percent while dairy is flat. It is the whole variance' }, 390],
    ['finance', 'Gus', 'tool.call', { tool: 'sql.query' }, 389],
    ['finance', 'Gus', 'tool.result', { result: { rowCount: 58 } }, 388],
    ['finance', 'Fay', 'agent.said', { activity: 'Tied to till rows, not vibes. Close stands, and the menu board gets a smaller oat pour' }, 370],
    ['finance', 'Fay', 'run.finished', {}, 365],
    ['research', 'Val', 'run.started', { goal: 'Find the winter drink' }, 500],
    ['research', 'Val', 'agent.said', { activity: 'Cardamom oat latte, tested on twelve regulars. Nine would order it again' }, 480],
    ['research', 'Val', 'tool.call', { tool: 'artifact.write' }, 470],
    ['research', 'Val', 'run.finished', {}, 465],
  ];
  for (const [key, name, type, payload, ago] of script) {
    const room_id = byKey[key];
    await pool.query(
      `INSERT INTO event (room_id, agent_id, type, payload, ts)
       VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))`,
      [room_id, aid[`${room_id}:${name}`] ?? null, type, JSON.stringify(payload), ago]);
  }
  console.log('threads seeded');
}

await bizdata();
await tickets();
for (const spec of ROOMS) {
  if (await one('SELECT 1 FROM room WHERE key=$1', [spec.key])) { console.log('room', spec.key, '(exists)'); continue; }
  await provisionRoom(spec);
  console.log('room', spec.key, '— created with', spec.agents.length, 'agents');
}
/**
 * Seed owns the words on the rooms and crews it created: re-running seed
 * re-applies the current objectives and personas by key and name, so an old
 * desk picks up the story without touching anything the operator changed.
 */
async function retheme() {
  for (const spec of ROOMS) {
    await pool.query('UPDATE room SET objective=$2 WHERE key=$1', [spec.key, spec.objective]);
    for (const a of spec.agents) {
      await pool.query(
        `UPDATE agent SET persona=$3 WHERE name=$2 AND room_id=(SELECT id FROM room WHERE key=$1)`,
        [spec.key, a.name, a.persona]);
    }
    // The room row is the source of truth for the password (tests and
    // roomDbPassword read it from there): re-apply it so a drifted role
    // can never lock the crew out of its own account.
    const row = await one<{ db_role: string | null; db_password: string | null }>(
      'SELECT db_role, db_password FROM room WHERE key=$1', [spec.key]);
    // db_role is null for access:'none' rooms, but the role still exists (the
    // room was provisioned with it) — heal by key-derived name either way.
    // Note: roles live at cluster level, so seeding a second database in the
    // same cluster rotates the shared role passwords; re-running this seed
    // re-syncs them from the room rows.
    if (row?.db_password) {
      const role = row.db_role ?? `atrium_${spec.key}`;
      await pool.query(`ALTER ROLE ${role} WITH PASSWORD '${row.db_password}'`).catch(() => {});
    }
  }
  console.log('rethemed');
}

await retheme();
// Threads come last: they quote the crew, so the crew has to exist.
await threads();
await closeAll();
