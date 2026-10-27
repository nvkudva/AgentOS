import type * as Api from '../api';

export type IntentKind = 'status.global' | 'status.room' | 'status.blocked' | 'status.needsme'
  | 'status.finished' | 'status.running' | 'entity.detail' | 'nav.open' | 'nav.ordinal' | 'nav.window'
  | 'nav.scroll' | 'search' | 'followup.room' | 'action.dispatch' | 'action.agent' | 'action.roompause'
  | 'action.recall' | 'action.route' | 'approval.nav' | 'meta.repeat' | 'meta.stop' | 'meta.help'
  | 'meta.speed' | 'meta.volume' | 'meta.clear' | 'meta.undo' | 'meta.wake' | 'status.brief'
  | 'action.decide' | 'unknown';

export type ListItem = {
  kind: 'task' | 'mandate' | 'agent' | 'inbox' | 'room';
  id: string; label: string; roomId: string | null; state: string;
};

export type VoiceContext = {
  focusRoom: Api.Room | null; focusAgent: Api.Agent | null;
  focusMandate: Api.Mandate | null; focusTask: Api.Task | null;
  lastList: { items: ListItem[]; intent: IntentKind; at: number } | null;
  lastIntent: IntentKind | null; pendingRoom: Api.Room | null;
};

export function emptyContext(): VoiceContext {
  return {
    focusRoom: null, focusAgent: null, focusMandate: null, focusTask: null,
    lastList: null, lastIntent: null, pendingRoom: null,
  };
}

export function withRoom(ctx: VoiceContext, room: Api.Room | null): VoiceContext {
  return { ...ctx, focusRoom: room, pendingRoom: room ?? ctx.pendingRoom };
}

export function withAgent(ctx: VoiceContext, agent: Api.Agent, room: Api.Room | null): VoiceContext {
  return { ...ctx, focusAgent: agent, focusRoom: room ?? ctx.focusRoom, pendingRoom: room ?? ctx.pendingRoom };
}

export function withTask(ctx: VoiceContext, task: Api.Task, room: Api.Room | null): VoiceContext {
  return { ...ctx, focusTask: task, focusRoom: room ?? ctx.focusRoom, pendingRoom: room ?? ctx.pendingRoom };
}

export function withMandate(ctx: VoiceContext, mandate: Api.Mandate, room: Api.Room | null): VoiceContext {
  return { ...ctx, focusMandate: mandate, focusRoom: room ?? ctx.focusRoom, pendingRoom: room ?? ctx.pendingRoom };
}

export function withList(ctx: VoiceContext, items: ListItem[], intent: IntentKind): VoiceContext {
  return { ...ctx, lastList: { items: [...items], intent, at: Date.now() }, lastIntent: intent };
}

export function focusEntity(ctx: VoiceContext, snap: Api.Snapshot): Api.Task | Api.Mandate | Api.Agent | Api.Room | null {
  if (ctx.focusTask) return ctx.focusTask;
  if (ctx.focusMandate) return ctx.focusMandate;
  if (ctx.focusAgent) return ctx.focusAgent;
  if (ctx.focusRoom) return ctx.focusRoom;
  void snap;
  return null;
}

export function roomOfTask(snap: Api.Snapshot, task: Api.Task): Api.Room | null {
  const mandate = snap.mandates.find((m) => m.id === task.mandate_id) ?? null;
  if (mandate?.room_id) return snap.rooms.find((r) => r.id === mandate.room_id) ?? null;
  const agent = snap.agents.find((a) => a.id === task.agent_id) ?? null;
  return agent ? snap.rooms.find((r) => r.id === agent.room_id) ?? null : null;
}

export function roomOfAgent(snap: Api.Snapshot, agent: Api.Agent): Api.Room | null {
  return snap.rooms.find((r) => r.id === agent.room_id) ?? null;
}

export function roomOfMandate(snap: Api.Snapshot, mandate: Api.Mandate): Api.Room | null {
  return mandate.room_id ? snap.rooms.find((r) => r.id === mandate.room_id) ?? null : null;
}
