import type { Snapshot, Room, Agent, Mandate, Task, Inbox } from '../../../web/src/lib/api.ts';

function room(id: string, key: string, name: string, objective: string): Room {
  return {
    id, key, name, objective, x: 0, y: 0, w: 100, h: 100, budget_cents: 6000, spent_cents: 1500,
    tool_grants: [], status: 'open', approval_policy: {}, db_role: null, color: '#000', icon: 'x',
  };
}
function agent(id: string, room_id: string, name: string, state: Agent['state'], activity = ''): Agent {
  return {
    id, room_id, name, role: 'worker', policy_key: 'k', tier: 'worker', state, activity,
    spent_cents: 0, cost_budget_cents: 1000, steps_used: 0, step_budget: 10, persona: '', color: '#000', avatar: '',
  };
}
function mandate(id: string, text: string, room_id: string, state: Mandate['state'], report = ''): Mandate {
  return { id, text, room_id, state, color: null, quoted_cents: 600, spent_cents: 100, report, artifact_id: null, context: [], created_at: '2026-01-01T00:00:00Z' };
}
function task(id: string, mandate_id: string, agent_id: string, title: string, state: Task['state'], ord: number): Task {
  return { id, mandate_id, agent_id, run_id: null, title, state, ord, kill_reason: null };
}

export const sales = room('room_sales', 'sales', 'Sales', 'deals pipeline customers pricing');
export const engineering = room('room_eng', 'engineering', 'Engineering', 'code tests bugs pricing fixes');
export const marketing = room('room_mkt', 'marketing', 'Marketing', 'campaigns content posts');

export const sam = agent('agt_sam', 'room_sales', 'Sam', 'blocked', 'waiting on you: needs a price');
export const rex = agent('agt_rex', 'room_eng', 'Rex', 'failed', 'killed: loop_detected');
export const kit = { ...agent('agt_kit', 'room_eng', 'Kit', 'working', 'repo.test'), tier: 'manager' as const };
export const ada = agent('agt_ada', 'room_mkt', 'Ada', 'working', 'queue.draft');

export const mSales = mandate('man_sales', 'Fix the failing pricing test', 'room_sales', 'working', 'Pricing work is half done. More detail follows.');
export const mEng = mandate('man_eng', 'Fix the failing pricing test in the API', 'room_eng', 'working', 'Tests are being fixed.');
export const mMkt = mandate('man_mkt', 'Launch spring campaign', 'room_mkt', 'working', '');

export const t1 = task('task_1', 'man_mkt', 'agt_ada', 'Draft launch post', 'failed', 2);
export const t2 = task('task_2', 'man_mkt', 'agt_ada', 'Prepare audience list', 'working', 1);
export const t3 = task('task_3', 'man_mkt', 'agt_ada', 'Book ad slot', 'queued', 3);
export const t4 = task('task_4', 'man_eng', 'agt_kit', 'Fix pricing test', 'done', 1);
export const t5 = task('task_5', 'man_sales', 'agt_sam', 'Call top deal', 'queued', 1);

export const inbox1: Inbox = {
  id: 'inb_1', room_key: 'sales', room_name: 'Sales', agent_name: 'Sam', kind: 'approval',
  action: 'publish a post', blast_radius: 'high', est_cost_cents: 600, run_spent_cents: 0,
  touches: [], created_at: '2026-01-01T00:00:00Z', args: {}, mandate_id: 'man_sales',
};
export const inbox2: Inbox = { ...inbox1, id: 'inb_2', agent_name: 'Kit', room_key: 'engineering', room_name: 'Engineering', est_cost_cents: 120 };

export function fixtureSnapshot(): Snapshot {
  return {
    rooms: [sales, engineering, marketing],
    agents: [sam, rex, kit, ada],
    inbox: [inbox1, inbox2],
    mandates: [mSales, mEng, mMkt],
    tasks: [t1, t2, t3, t4, t5],
    config: {},
  };
}
