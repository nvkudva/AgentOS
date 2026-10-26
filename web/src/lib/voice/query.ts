import type * as Api from '../api';
import * as progress from '../progress';
import type * as Ctx from './context';

const TASK_RANK: Record<string, number> = { failed: 0, killed: 0, working: 1, queued: 2, done: 3 };
const AGENT_RANK: Record<string, number> = { blocked: 0, failed: 1, killed: 2, awaiting_approval: 3 };

export function taskItem(snap: Api.Snapshot, task: Api.Task): Ctx.ListItem {
  const mandate = snap.mandates.find((m) => m.id === task.mandate_id) ?? null;
  return { kind: 'task', id: task.id, label: task.title, roomId: mandate?.room_id ?? null, state: task.state };
}

export function agentItem(snap: Api.Snapshot, agent: Api.Agent): Ctx.ListItem {
  void snap;
  return { kind: 'agent', id: agent.id, label: agent.name, roomId: agent.room_id, state: agent.state };
}

export function mandateItem(mandate: Api.Mandate): Ctx.ListItem {
  return { kind: 'mandate', id: mandate.id, label: mandate.text, roomId: mandate.room_id, state: mandate.state };
}

export function inboxItem(item: Api.Inbox, snap: Api.Snapshot): Ctx.ListItem {
  const room = snap.rooms.find((r) => r.key === item.room_key) ?? null;
  return { kind: 'inbox', id: item.id, label: `${item.agent_name}: ${item.action}`, roomId: room?.id ?? null, state: item.kind };
}

export function sortForSpeech(tasks: Api.Task[], snap: Api.Snapshot): Ctx.ListItem[] {
  return [...tasks]
    .sort((a, b) => (TASK_RANK[a.state] ?? 4) - (TASK_RANK[b.state] ?? 4) || a.ord - b.ord || (a.id < b.id ? -1 : 1))
    .map((t) => taskItem(snap, t));
}

export function sortAgentsForSpeech(agents: Api.Agent[], snap: Api.Snapshot): Ctx.ListItem[] {
  return [...agents]
    .sort((a, b) => (AGENT_RANK[a.state] ?? 4) - (AGENT_RANK[b.state] ?? 4) || (a.name < b.name ? -1 : 1))
    .map((a) => agentItem(snap, a));
}

export type RoomFacts = {
  room: Api.Room;
  progress: ReturnType<typeof progress.roomProgress>;
  blocked: Ctx.ListItem[]; waiting: Api.Inbox[]; crew: Api.Agent[];
};

export function roomFacts(snap: Api.Snapshot, room: Api.Room): RoomFacts {
  const crew = snap.agents.filter((a) => a.room_id === room.id);
  const blockedAgents = crew.filter((a) => ['blocked', 'failed', 'killed', 'awaiting_approval'].includes(a.state));
  const blockedMandates = snap.mandates.filter((m) => m.room_id === room.id && m.state === 'blocked');
  const blocked: Ctx.ListItem[] = [
    ...sortAgentsForSpeech(blockedAgents, snap),
    ...blockedMandates.map((m) => mandateItem(m)),
  ];
  const waiting = snap.inbox.filter((i) => i.room_key === room.key || crew.some((a) => a.name === i.agent_name));
  return { room, progress: progress.roomProgress(room, snap.mandates, snap.tasks, crew), blocked, waiting, crew };
}

export function blockedList(snap: Api.Snapshot, room?: Api.Room): Ctx.ListItem[] {
  const agents = room
    ? snap.agents.filter((a) => a.room_id === room.id)
    : snap.agents;
  const stuck = agents.filter((a) => ['blocked', 'failed', 'killed', 'awaiting_approval'].includes(a.state));
  const mandates = snap.mandates.filter((m) => m.state === 'blocked' && (!room || m.room_id === room.id));
  const failedTasks = snap.tasks.filter((t) => ['failed', 'killed'].includes(t.state))
    .filter((t) => !room || mandates.some((m) => m.id === t.mandate_id) || agents.some((a) => a.id === t.agent_id));
  const seen = new Set<string>();
  const out: Ctx.ListItem[] = [];
  for (const item of [...sortAgentsForSpeech(stuck, snap), ...mandates.map((m) => mandateItem(m)), ...sortForSpeech(failedTasks, snap)]) {
    const key = `${item.kind}:${item.id}`;
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  }
  return out;
}

export function needsMe(snap: Api.Snapshot): { count: number; top: Api.Inbox | null; items: Ctx.ListItem[] } {
  const sorted = [...snap.inbox].sort((a, b) => b.est_cost_cents - a.est_cost_cents);
  return { count: snap.inbox.length, top: sorted[0] ?? null, items: sorted.map((i) => inboxItem(i, snap)) };
}

export function finishedList(snap: Api.Snapshot, room?: Api.Room): Ctx.ListItem[] {
  const tasks = snap.tasks.filter((t) => t.state === 'done')
    .filter((t) => !room || snap.mandates.find((m) => m.id === t.mandate_id)?.room_id === room.id);
  return sortForSpeech(tasks, snap);
}

export function runningList(snap: Api.Snapshot, room?: Api.Room): Ctx.ListItem[] {
  const tasks = snap.tasks.filter((t) => t.state === 'working')
    .filter((t) => !room || snap.mandates.find((m) => m.id === t.mandate_id)?.room_id === room.id);
  const agents = snap.agents.filter((a) => a.state === 'working' && (!room || a.room_id === room.id));
  return [...sortForSpeech(tasks, snap), ...sortAgentsForSpeech(agents, snap)];
}

export function roomTasks(snap: Api.Snapshot, room: Api.Room): Ctx.ListItem[] {
  const mandates = snap.mandates.filter((m) => m.room_id === room.id);
  const tasks = snap.tasks.filter((t) => mandates.some((m) => m.id === t.mandate_id));
  return sortForSpeech(tasks, snap);
}

export function searchSnapshot(snap: Api.Snapshot, query: string): Ctx.ListItem[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const match = (text: string) => words.length > 0 && words.some((w) => text.toLowerCase().includes(w));
  const out: Ctx.ListItem[] = [];
  for (const m of snap.mandates) if (match(m.text)) out.push(mandateItem(m));
  for (const item of sortForSpeech(snap.tasks.filter((t) => match(t.title)), snap)) out.push(item);
  return out;
}

export function failedTasks(snap: Api.Snapshot): Ctx.ListItem[] {
  return sortForSpeech(snap.tasks.filter((t) => ['failed', 'killed'].includes(t.state)), snap);
}
