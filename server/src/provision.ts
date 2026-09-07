import { pool, q, one, DB } from './db.js';
import { id } from './ids.js';
import { append } from './events.js';
import { TOOLS } from './tools/index.js';
import { POLICIES } from './policies/index.js';

/**
 * A room is data, not code.
 *
 * Everything a room needs — its identity, its tool grants, its budget, its database
 * role and the grants on that role — is created here from a plain description. The
 * shell has no per-room code, so adding a function to the company is a form, not a
 * deploy. That claim is what `test/newroom.test.ts` exists to check.
 */

export type AccessProfile = 'none' | 'read_business' | 'write_pipeline' | 'support_desk';

/** What a room's own Postgres role is allowed to do. The database, not our code, enforces it. */
export const ACCESS: Record<AccessProfile, { label: string; note: string; grants: (role: string) => string[] }> = {
  none: {
    label: 'No company data',
    note: 'Cannot reach the company database at all.',
    grants: () => [],
  },
  read_business: {
    label: 'Read the company database',
    note: 'Can read customers, orders and pipeline. Cannot change any of them.',
    grants: (r) => [
      `GRANT USAGE ON SCHEMA bizdata TO ${r}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA bizdata TO ${r}`,
    ],
  },
  write_pipeline: {
    label: 'Read the company database, annotate deals',
    note: 'Can read everything and write one column: the note on a pipeline deal.',
    grants: (r) => [
      `GRANT USAGE ON SCHEMA bizdata TO ${r}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA bizdata TO ${r}`,
      `GRANT UPDATE (note) ON bizdata.pipeline TO ${r}`,
    ],
  },
  support_desk: {
    label: 'Run the support desk',
    note: 'Can read tickets and customers, and answer a ticket. Nothing else.',
    grants: (r) => [
      `GRANT USAGE ON SCHEMA support, bizdata TO ${r}`,
      `GRANT SELECT ON ALL TABLES IN SCHEMA support TO ${r}`,
      `GRANT SELECT ON bizdata.customer TO ${r}`,
      `GRANT UPDATE (reply, status, answered_at) ON support.ticket TO ${r}`,
      `GRANT USAGE ON ALL SEQUENCES IN SCHEMA support TO ${r}`,
    ],
  },
};

export type AgentSpec = { name: string; role: string; policy: string; persona: string; color: string; avatar: string;
                          step_budget?: number; cost_budget_cents?: number };
export type RoomSpec = {
  key: string; name: string; objective: string;
  color: string; icon: string;
  budget_cents: number;
  tools: string[];
  access: AccessProfile;
  approval_policy?: Record<string, 'auto' | 'approve'>;
  agents: AgentSpec[];
};

const KEY = /^[a-z][a-z0-9_]{1,22}$/;

export function validate(spec: RoomSpec): string[] {
  const bad: string[] = [];
  if (!KEY.test(spec.key ?? '')) bad.push('key must be lowercase letters, digits and underscores');
  if (!spec.name?.trim()) bad.push('name is required');
  if (!spec.objective?.trim()) bad.push('objective is required');
  if (!(spec.budget_cents > 0)) bad.push('budget must be more than zero');
  if (!ACCESS[spec.access]) bad.push(`unknown data access "${spec.access}"`);
  for (const t of spec.tools ?? []) if (!TOOLS[t]) bad.push(`unknown tool "${t}"`);
  if (!spec.agents?.length) bad.push('a room needs at least one agent');
  for (const a of spec.agents ?? []) {
    if (!a.name?.trim()) bad.push('every agent needs a name');
    const job = POLICIES[a.policy];
    if (!job) { bad.push(`unknown job "${a.policy}"`); continue; }
    // A room that hires for work it cannot do produces an agent that fails on its first
    // step. Better to refuse the room than to log a scope violation nobody asked for.
    const missing = job.uses.filter((t) => !(spec.tools ?? []).includes(t));
    if (missing.length) bad.push(`${a.name || 'that agent'} cannot do "${job.goal}" here — the room also needs: ${missing.join(', ')}`);
  }
  return bad;
}

/** Next free slot on the Overview grid, so a new room does not land on top of another. */
async function nextSlot() {
  const rows = await q<any>('SELECT x, y, w, h FROM room');
  const taken = new Set(rows.flatMap((r) => {
    const cells: string[] = [];
    for (let dx = 0; dx < r.w; dx++) for (let dy = 0; dy < r.h; dy++) cells.push(`${r.x + dx},${r.y + dy}`);
    return cells;
  }));
  for (let y = 0; y < 40; y++) for (let x = 0; x + 1 < 4; x += 2) {
    if (!taken.has(`${x},${y}`) && !taken.has(`${x + 1},${y}`)) return { x, y, w: 2, h: 1 };
  }
  return { x: 0, y: 40, w: 2, h: 1 };
}


/**
 * THE MANAGER TIER. Exactly one per room, and never on the form — a room with no
 * manager has nobody to receive a mandate, so this is structure, not configuration.
 * It polls its own tasks while its crew works, hence the roomy step budget.
 */
const MANAGER_NAMES: Record<string, string> = {
  analytics: 'Vera', engineering: 'Otto', marketing: 'Juno', sales: 'Cleo',
  support: 'Mira', finance: 'Hugo', research: 'Piet', strategy: 'Zara',
};
const POOL = ['Nan', 'Rune', 'Elis', 'Tam', 'Vic', 'Orin', 'Sol', 'Wren'];

function managerName(key: string) {
  if (MANAGER_NAMES[key]) return MANAGER_NAMES[key];
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return POOL[h % POOL.length];
}

async function seedManager(roomId: string, key: string, roomName: string, color: string) {
  const has = await one('SELECT id FROM agent WHERE room_id=$1 AND tier=$2', [roomId, 'manager']);
  if (has) return;
  await q(
    `INSERT INTO agent (id, room_id, name, role, policy_key, tier, step_budget, cost_budget_cents,
                        persona, color, avatar)
     VALUES ($1,$2,$3,'manager','room.manager','manager',300,60,$4,$5,'◆')`,
    [id('agt'), roomId, managerName(key), `Runs ${roomName}. Breaks what you ask for into tasks, hands them out, and reports back.`, color]);
}

/** Idempotent, and called at boot: rooms provisioned before the tier existed get theirs. */
export async function ensureManagers() {
  for (const r of await q<any>('SELECT id, key, name, color FROM room')) {
    await seedManager(r.id, r.key, r.name, r.color ?? '#8b95a1');
  }
}

export async function provisionRoom(spec: RoomSpec) {
  const bad = validate(spec);
  if (bad.length) throw Object.assign(new Error(bad.join('; ')), { status: 400, problems: bad });

  const exists = await one('SELECT id FROM room WHERE key=$1', [spec.key]);
  if (exists) throw Object.assign(new Error(`a room called "${spec.key}" already exists`), { status: 409 });

  // Every room gets the manager tier and the two tools that tier needs. Neither is
  // offered on the form: a room without a manager has nobody to receive a mandate.
  const tools = Array.from(new Set([...(spec.tools ?? []), 'assign', 'report']));

  const role = `atrium_${spec.key}`;              // key is validated against KEY, so this is safe to inline
  await pool.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}')
       THEN CREATE ROLE ${role} LOGIN PASSWORD '${role}'; END IF; END $$;`);
  await pool.query(`GRANT CONNECT ON DATABASE ${DB} TO ${role}`);
  await pool.query(`REVOKE ALL ON SCHEMA public FROM ${role}`).catch(() => {});
  for (const g of ACCESS[spec.access].grants(role)) await pool.query(g);

  const slot = await nextSlot();
  const rid = id('room');
  await q(
    `INSERT INTO room (id,key,name,objective,x,y,w,h,budget_cents,tool_grants,approval_policy,db_role,color,icon)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [rid, spec.key, spec.name, spec.objective, slot.x, slot.y, slot.w, slot.h, spec.budget_cents,
     JSON.stringify(tools), JSON.stringify(spec.approval_policy ?? { low: 'auto', medium: 'auto', high: 'approve' }),
     spec.access === 'none' ? null : role, spec.color, spec.icon]);

  await seedManager(rid, spec.key, spec.name, spec.color);
  for (const a of spec.agents) {
    await q(
      `INSERT INTO agent (id, room_id, name, role, policy_key, step_budget, cost_budget_cents, persona, color, avatar)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id('agt'), rid, a.name, a.role, a.policy, a.step_budget ?? 40, a.cost_budget_cents ?? 120,
       a.persona ?? '', a.color ?? spec.color, a.avatar ?? '🙂']);
  }

  await append({ type: 'room.created', room_id: rid,
                 payload: { key: spec.key, tools: spec.tools, access: spec.access, agents: spec.agents.length } });
  return await one('SELECT * FROM room WHERE id=$1', [rid]);
}

/** What the room creator offers, described for a person rather than a schema. */
export function catalog() {
  const TOOL_WORDS: Record<string, string> = {
    'sql.query': 'Read the company database',
    'crm.note': 'Leave a note on a deal',
    'artifact.write': 'Write up what it finds',
    'artifact.read': "Read other rooms' shared notes",
    'queue.draft': 'Draft a post into the content queue',
    'queue.publish': 'Publish a post',
    'repo.read': 'Open a file in the code',
    'repo.patch': 'Change the code on a branch',
    'repo.test': 'Run the tests',
    'github.pr.open': 'Open a pull request',
    'ticket.list': 'Look at support tickets',
    'ticket.reply': 'Answer a support ticket',
    'escalate': 'Ask you a question',
  };
  return {
    tools: Object.values(TOOLS).map((t) => ({
      name: t.name, label: TOOL_WORDS[t.name] ?? t.name,
      blast: t.blast, reversible: t.reversible, external: t.external,
    })),
    access: Object.entries(ACCESS).map(([k, v]) => ({ key: k, label: v.label, note: v.note })),
    jobs: Object.entries(POLICIES).map(([k, p]) => ({ key: k, goal: p.goal, steps: p.steps.length, uses: p.uses })),
  };
}
