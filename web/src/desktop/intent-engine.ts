import type * as Api from '../lib/api';
import type * as Commands from './commands';
import * as humanize from '../lib/humanize';
import * as context from '../lib/voice/context';
import * as query from '../lib/voice/query';
import * as respond from '../lib/voice/respond';

export type { IntentKind, ListItem, VoiceContext } from '../lib/voice/context';
export { emptyContext } from '../lib/voice/context';

export type Tier = 0 | 1 | 2 | 3;
export type VisualAction =
  | { kind: 'openRoom'; roomId: string } | { kind: 'openAgent'; agentId: string }
  | { kind: 'openTask'; taskId: string; roomId: string }
  | { kind: 'launch'; app: 'floor' | 'work' | 'inbox' | 'settings' }
  | { kind: 'highlight'; ids: string[]; roomId: string | null }
  | { kind: 'focusApproval'; inboxId: string } | { kind: 'scroll'; dir: 1 | -1 }
  | { kind: 'window'; op: 'close' | 'minimise' | 'front' | 'park' | 'clear'; winRef: string | null };

export type IntentResult = {
  say: string; ok: boolean; intent: context.IntentKind; tier: Tier; confidence: number;
  visual: VisualAction[]; context: context.VoiceContext;
  propose?: Commands.Proposal;
  confirm?: { label: string };
  clarify?: { question: string; options: { label: string; result: IntentResult }[] };
};

type Cand = { name: string; key?: string };
type Link<T extends Cand> = { item: T | null; confidence: number; alts: T[] };

const ORD: Record<string, number> = {
  first: 1, '1': 1, one: 1, second: 2, '2': 2, two: 2, third: 3, '3': 3, three: 3,
  fourth: 4, '4': 4, four: 4, fifth: 5, '5': 5, five: 5,
};
const STOP = new Set(('the a an and or of to in on for from with our my your this that last next please can you we us it its is are was were do does did run go get make give take put show tell me about into over out up down all any some more most new old why how what when who').split(' '));

function norm(raw: string): string {
  return raw.trim().toLowerCase().replace(/^(hey\s+)?atrium[,!.\s]*/i, '').replace(/[.!?]+$/, '').trim();
}

function lev(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

function edit1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++; if (edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function link<T extends Cand>(q: string, xs: T[]): Link<T> {
  const queryText = q.trim().toLowerCase();
  if (!queryText) return { item: null, confidence: 0, alts: [] };
  const exact = xs.filter((x) => x.name.toLowerCase() === queryText || (x.key ?? '').toLowerCase() === queryText);
  if (exact.length) return { item: exact[0], confidence: 1, alts: exact };
  const prefix = xs.filter((x) => x.name.toLowerCase().startsWith(queryText) || (x.key ?? '').toLowerCase().startsWith(queryText));
  if (prefix.length === 1) return { item: prefix[0], confidence: 0.9, alts: prefix };
  if (prefix.length > 1) return { item: null, confidence: 0.6, alts: prefix.slice(0, 3) };
  const fuzzy = xs.filter((x) => edit1(queryText, x.name.toLowerCase()) || edit1(queryText, (x.key ?? '').toLowerCase()));
  if (fuzzy.length === 1) return { item: fuzzy[0], confidence: 0.8, alts: fuzzy };
  if (fuzzy.length > 1) return { item: null, confidence: 0.6, alts: fuzzy.slice(0, 3) };
  const contains = xs.filter((x) => x.name.toLowerCase().includes(queryText));
  if (contains.length) return { item: null, confidence: 0.6, alts: contains.slice(0, 3) };
  const near = xs.filter((x) => lev(queryText, x.name.toLowerCase()) <= 2 || lev(queryText, (x.key ?? '').toLowerCase()) <= 2);
  if (near.length) return { item: null, confidence: 0.6, alts: near.slice(0, 3) };
  return { item: null, confidence: 0, alts: [] };
}

function roomInText(t: string, snap: Api.Snapshot): Api.Room | null {
  const sorted = [...snap.rooms].sort((a, b) => b.name.length - a.name.length);
  return sorted.find((r) => t.includes(r.name.toLowerCase()) || t.includes(r.key.toLowerCase())) ?? null;
}

function base(ctx: context.VoiceContext, intent: context.IntentKind, tier: Tier, say: string, ok = true, confidence = 1): IntentResult {
  return { say, ok, intent, tier, confidence, visual: [], context: { ...ctx, lastIntent: intent } };
}

function clarifyResult(ctx: context.VoiceContext, intent: context.IntentKind, question: string, options: { label: string; result: IntentResult }[], confidence: number): IntentResult {
  const out = base(ctx, intent, 1, question, false, confidence);
  out.clarify = { question, options: options.slice(0, 3) };
  return out;
}

function roomStatus(snap: Api.Snapshot, ctx: context.VoiceContext, room: Api.Room, intent: context.IntentKind = 'status.room'): IntentResult {
  const facts = query.roomFacts(snap, room);
  let next = context.withRoom(ctx, room);
  next = { ...next, lastIntent: intent, pendingRoom: room };
  const out = base(next, intent, 0, respond.sayRoom(facts));
  out.visual = [{ kind: 'openRoom', roomId: room.id }];
  out.context = next;
  return out;
}

function listResult(snap: Api.Snapshot, ctx: context.VoiceContext, intent: context.IntentKind, items: context.ListItem[], room: Api.Room | null): IntentResult {
  let next = room ? context.withRoom(ctx, room) : { ...ctx };
  next = context.withList(next, items, intent);
  if (room) next = { ...next, pendingRoom: room };
  const out = base(next, intent, 0, respond.sayList(intent, items, items.length));
  out.context = next;
  if (items.length) {
    out.visual = [{ kind: 'highlight', ids: items.slice(0, 5).map((i) => i.id), roomId: room?.id ?? items[0].roomId }];
  }
  return out;
}

function openEntity(snap: Api.Snapshot, ctx: context.VoiceContext, q: string, rawText: string): IntentResult {
  const apps: Record<string, 'floor' | 'work' | 'inbox' | 'settings'> = {
    floor: 'floor', map: 'floor', rooms: 'floor', work: 'work', mandates: 'work', mandate: 'work',
    history: 'work', inbox: 'inbox', approvals: 'inbox', approval: 'inbox', settings: 'settings', setting: 'settings',
  };
  if (apps[q]) {
    const out = base(ctx, 'nav.open', 1, q === 'settings' || q === 'setting' ? 'Settings.' : `${q[0].toUpperCase()}${q.slice(1)}.`);
    out.visual = [{ kind: 'launch', app: apps[q] }];
    return out;
  }
  if (q === 'that' || q === 'it' || q === 'this') return openFocus(snap, ctx);
  const agentLink = link(q, snap.agents);
  const roomLink = link(q, snap.rooms);
  const mandateHit = snap.mandates.find((m) => m.text.toLowerCase().includes(q) && q.length > 2) ?? null;
  const candidates: { label: string; result: IntentResult }[] = [];
  if (agentLink.item && agentLink.confidence >= 0.5) {
    const a = agentLink.item; const r = context.roomOfAgent(snap, a);
    const o = base(context.withAgent(ctx, a, r), 'nav.open', 1, `${a.name}.`, true, agentLink.confidence);
    o.visual = [{ kind: 'openAgent', agentId: a.id }]; o.context = context.withAgent(ctx, a, r);
    candidates.push({ label: a.name, result: o });
  }
  if (roomLink.item && roomLink.confidence >= 0.5) {
    const r = roomLink.item;
    const o = base(context.withRoom(ctx, r), 'nav.open', 1, `${r.name}.`, true, roomLink.confidence);
    o.visual = [{ kind: 'openRoom', roomId: r.id }]; o.context = context.withRoom(ctx, r);
    candidates.push({ label: r.name, result: o });
  }
  if (!candidates.length) {
    for (const a of agentLink.alts) {
      const r = context.roomOfAgent(snap, a);
      const o = base(context.withAgent(ctx, a, r), 'nav.open', 1, `${a.name}.`, true, 0.9);
      o.visual = [{ kind: 'openAgent', agentId: a.id }]; o.context = context.withAgent(ctx, a, r);
      candidates.push({ label: a.name, result: o });
    }
    for (const r of roomLink.alts) {
      const o = base(context.withRoom(ctx, r), 'nav.open', 1, `${r.name}.`, true, 0.9);
      o.visual = [{ kind: 'openRoom', roomId: r.id }]; o.context = context.withRoom(ctx, r);
      if (!candidates.some((c) => c.label === r.name)) candidates.push({ label: r.name, result: o });
    }
    if (candidates.length) {
      return clarifyResult(ctx, 'nav.open', `I heard "${rawText}". Did you mean ${candidates.map((c) => c.label).join(' or ')}?`, candidates, 0.6);
    }
  }
  const best = candidates.sort((x, y) => y.result.confidence - x.result.confidence)[0];
  const ambiguous = candidates.length > 1 && candidates[0].result.confidence === candidates[1].result.confidence;
  if (best && !ambiguous && best.result.confidence >= 0.75 && !(best.result.confidence === 0.8)) return best.result;
  if (candidates.length) {
    const heard = best && best.result.confidence === 0.8 ? `I heard "${rawText}". Did you mean ${candidates[0].label}?` : `Did you mean ${candidates.map((c) => c.label).join(' or ')}?`;
    return clarifyResult(ctx, 'nav.open', heard, candidates, 0.6);
  }
  if (mandateHit) {
    const r = context.roomOfMandate(snap, mandateHit);
    const o = base(context.withMandate(ctx, mandateHit, r), 'nav.open', 1, `${mandateHit.text}.`);
    if (r) o.visual = [{ kind: 'openRoom', roomId: r.id }];
    o.context = context.withMandate(ctx, mandateHit, r);
    return o;
  }
  return base(ctx, 'unknown', 0, `I could not find ${q}. Try "open" with a room or a name.`, false, 0);
}

function openFocus(snap: Api.Snapshot, ctx: context.VoiceContext): IntentResult {
  if (ctx.focusTask) {
    const room = context.roomOfTask(snap, ctx.focusTask);
    const out = base(ctx, 'nav.open', 1, `${ctx.focusTask.title}.`);
    out.visual = [{ kind: 'openTask', taskId: ctx.focusTask.id, roomId: room?.id ?? '' }];
    return out;
  }
  if (ctx.focusMandate) {
    const room = context.roomOfMandate(snap, ctx.focusMandate);
    const out = base(ctx, 'nav.open', 1, `${ctx.focusMandate.text}.`);
    if (room) out.visual = [{ kind: 'openRoom', roomId: room.id }];
    return out;
  }
  if (ctx.focusAgent) {
    const out = base(ctx, 'nav.open', 1, `${ctx.focusAgent.name}.`);
    out.visual = [{ kind: 'openAgent', agentId: ctx.focusAgent.id }];
    return out;
  }
  if (ctx.focusRoom) {
    const out = base(ctx, 'nav.open', 1, `${ctx.focusRoom.name}.`);
    out.visual = [{ kind: 'openRoom', roomId: ctx.focusRoom.id }];
    return out;
  }
  return base(ctx, 'unknown', 0, 'I do not have anything in focus yet. Name a room, person or task.', false, 0);
}

function openOrdinal(snap: Api.Snapshot, ctx: context.VoiceContext, t: string): IntentResult | null {
  let m = t.match(/^(?:open|show)\s+(.+?)\s+task\s+(\w+)$/);
  if (m) {
    const roomLink = link(m[1].trim(), snap.rooms);
    const n = ORD[m[2]] ?? Number(m[2]);
    if (!roomLink.item || !n) return base(ctx, 'unknown', 0, `I could not find ${m[1]}.`, false, 0);
    const items = query.roomTasks(snap, roomLink.item);
    if (n > items.length) return ordinalOutOfRange(ctx, items.length, roomLink.item);
    return openListItem(snap, ctx, items[n - 1], items);
  }
  m = t.match(/^(?:open|show)\s+(?:the\s+)?(\w+)(?:\s+(?:blocked\s+)?(?:item|one|task))?$/);
  if (m && ORD[m[1]] !== undefined && ctx.lastList) {
    const n = ORD[m[1]];
    const items = ctx.lastList.items;
    if (n > items.length) return ordinalOutOfRange(ctx, items.length, ctx.focusRoom);
    return openListItem(snap, ctx, items[n - 1], items);
  }
  m = t.match(/^(?:open|show)\s+task\s+(\w+)$/);
  if (m) {
    const n = ORD[m[1]] ?? Number(m[1]);
    const room = ctx.focusRoom;
    const items = ctx.lastList?.items.length && ctx.lastList.items.every((i) => !room || i.roomId === room.id)
      ? ctx.lastList.items : room ? query.roomTasks(snap, room) : [];
    if (!items.length) return base(ctx, 'unknown', 0, 'I do not have a task list yet. Open a room first.', false, 0);
    if (!n || n > items.length) return ordinalOutOfRange(ctx, items.length, room);
    return openListItem(snap, ctx, items[n - 1], items);
  }
  return null;
}

function ordinalOutOfRange(ctx: context.VoiceContext, size: number, room: Api.Room | null): IntentResult {
  const out = base(ctx, 'nav.ordinal', 1, `There are only ${respond.countWord(size)} in that list.`, false, 0.5);
  if (room) out.context = context.withRoom(ctx, room);
  return out;
}

function openListItem(snap: Api.Snapshot, ctx: context.VoiceContext, item: context.ListItem, items: context.ListItem[]): IntentResult {
  let next = context.withList(ctx, items, 'nav.ordinal');
  const out = base(next, 'nav.ordinal', 1, `${item.label}.`);
  if (item.kind === 'task') {
    const task = snap.tasks.find((x) => x.id === item.id) ?? null;
    const room = task ? context.roomOfTask(snap, task) : snap.rooms.find((r) => r.id === item.roomId) ?? null;
    if (task) next = context.withTask(next, task, room);
    out.visual = [{ kind: 'openTask', taskId: item.id, roomId: room?.id ?? item.roomId ?? '' }];
  } else if (item.kind === 'agent') {
    const agent = snap.agents.find((x) => x.id === item.id) ?? null;
    if (agent) next = context.withAgent(next, agent, context.roomOfAgent(snap, agent));
    out.visual = [{ kind: 'openAgent', agentId: item.id }];
  } else if (item.kind === 'inbox') {
    out.visual = [{ kind: 'focusApproval', inboxId: item.id }];
  } else if (item.kind === 'mandate') {
    const mandate = snap.mandates.find((x) => x.id === item.id) ?? null;
    const room = mandate ? context.roomOfMandate(snap, mandate) : null;
    if (mandate) next = context.withMandate(next, mandate, room);
    if (room) out.visual = [{ kind: 'openRoom', roomId: room.id }];
  } else {
    out.visual = [{ kind: 'openRoom', roomId: item.id }];
  }
  out.context = next;
  return out;
}

function rankRooms(text: string, rooms: Api.Room[]): Api.Room[] {
  const words = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
  if (!words.length) return [];
  const open = rooms.filter((r) => r.status === 'open');
  const scored = open.map((r) => {
    const name = `${r.key} ${r.name}`.toLowerCase();
    const objective = (r.objective ?? '').toLowerCase();
    const grants = r.tool_grants.join(' ').toLowerCase().replace(/[._*]/g, ' ');
    let n = 0;
    for (const w of words) { if (name.includes(w)) n += 4; else if (objective.includes(w)) n += 2; else if (grants.includes(w)) n += 1; }
    return { r, n };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return [];
  const rest = open.filter((r) => !scored.some((s) => s.r.id === r.id));
  return [...scored.map((s) => s.r), ...rest];
}


function needsMeResult(snap: Api.Snapshot, ctx: context.VoiceContext, intent: context.IntentKind): IntentResult {
  const facts = query.needsMe(snap);
  const next = context.withList(ctx, facts.items, intent);
  const out = base(next, intent, intent === 'approval.nav' ? 3 : 0, respond.sayNeedsMe(facts.count, facts.top));
  out.context = next;
  if (facts.top) out.visual = [{ kind: 'focusApproval', inboxId: facts.top.id }];
  return out;
}

function rerunForRoom(snap: Api.Snapshot, ctx: context.VoiceContext, room: Api.Room): IntentResult {
  const last = ctx.lastIntent;
  let out: IntentResult;
  if (last === 'status.blocked') out = listResult(snap, ctx, 'status.blocked', query.blockedList(snap, room), room);
  else if (last === 'status.finished') out = listResult(snap, ctx, 'status.finished', query.finishedList(snap, room), room);
  else if (last === 'status.running') out = listResult(snap, ctx, 'status.running', query.runningList(snap, room), room);
  else out = roomStatus(snap, ctx, room, last ?? 'status.room');
  const wrapped = { ...out, intent: 'followup.room' as context.IntentKind };
  wrapped.context = { ...out.context, lastIntent: 'followup.room', pendingRoom: room, focusRoom: room };
  return wrapped;
}

export function interpret(raw: string, snap: Api.Snapshot, ctx: context.VoiceContext): IntentResult {
  const t = norm(raw);
  if (!t) return base(ctx, 'unknown', 0, 'I am listening.', false, 0);
  let m: RegExpMatchArray | null;

  if (/^(forget that|start over|clear context)$/.test(t)) {
    const out = base(context.emptyContext(), 'meta.clear', 1, 'Cleared. Starting fresh.');
    out.context = context.emptyContext();
    return out;
  }
  if (/^(repeat|say that again|say again)( slower)?$/.test(t)) {
    return base(ctx, 'meta.repeat', 0, ctx.lastIntent ? 'Repeating the last answer.' : 'There is nothing to repeat yet.', !!ctx.lastIntent, ctx.lastIntent ? 1 : 0);
  }
  if (/^(stop talking|stop listening|that's all|that is all|stop)$/.test(t)) return base(ctx, 'meta.stop', 0, 'Stopped.');
  if (/^(talk )?(faster|slower)$/.test(t) || /^speed (up|down)$/.test(t)) return base(ctx, 'meta.speed', 1, t.includes('slow') || t.includes('down') ? 'Slower.' : 'Faster.');
  if (/^(quieter|louder|volume (up|down))$/.test(t)) return base(ctx, 'meta.volume', 1, t.includes('quiet') || t.includes('down') ? 'Quieter.' : 'Louder.');
  if (/^(help|what can i say|what can you do)$/.test(t)) {
    return base(ctx, 'meta.help', 0, 'Try: what needs me, what is blocked, how are we doing in Sales, open Marketing task 1, or show approvals.');
  }
  if (/^(approve|reject|deny|say yes to|say no to)/.test(t)) {
    const top = query.needsMe(snap).top;
    if (!top) return base(ctx, 'approval.nav', 3, 'Nothing is waiting for a decision.');
    const out = base(ctx, 'approval.nav', 3, 'I never approve by voice. Here is the card.');
    out.visual = [{ kind: 'focusApproval', inboxId: top.id }];
    return out;
  }
  if (/^(show|read|open) (my )?approvals?$/.test(t) || /^how many approvals/.test(t) || /^(next|read the first) approval/.test(t)) {
    return needsMeResult(snap, ctx, /next|first/.test(t) ? 'approval.nav' : 'status.needsme');
  }
  if ((m = t.match(/^what about (.+)$/))) {
    const room = roomInText(m[1], snap) ?? link(m[1].trim(), snap.rooms).item;
    if (room) return rerunForRoom(snap, ctx, room);
    return base(ctx, 'unknown', 0, `I could not find ${m[1]}.`, false, 0);
  }
  const ordinal = openOrdinal(snap, ctx, t);
  if (ordinal) return ordinal;

  if ((m = t.match(/^pause (.+)$/))) {
    const room = roomInText(m[1], snap) ?? link(m[1].trim(), snap.rooms).item;
    if (room) {
      const out = base(context.withRoom(ctx, room), 'action.roompause', 2, `Pause ${room.name}? Say yes to confirm.`);
      out.confirm = { label: `Pause ${room.name}` }; out.context = context.withRoom(ctx, room);
      return out;
    }
  }
  if (/^(recall that|cancel the last mandate|recall it)$/.test(t)) {
    const mandate = ctx.focusMandate ?? [...snap.mandates].reverse().find((x) => x.state !== 'done' && x.state !== 'recalled') ?? null;
    if (!mandate) return base(ctx, 'unknown', 0, 'There is no mandate to recall.', false, 0);
    const room = context.roomOfMandate(snap, mandate);
    const out = base(context.withMandate(ctx, mandate, room), 'action.recall', 2, `Recall "${mandate.text}"? Say yes to confirm.`);
    out.confirm = { label: `Recall ${mandate.text}` }; out.context = context.withMandate(ctx, mandate, room);
    return out;
  }
  if ((m = t.match(/^(?:move|send) that to (.+)$/))) {
    const room = roomInText(m[1], snap) ?? link(m[1].trim(), snap.rooms).item;
    const mandate = ctx.focusMandate;
    if (!room) return base(ctx, 'unknown', 0, `I could not find ${m[1]}.`, false, 0);
    if (!mandate) return base(ctx, 'unknown', 0, 'Which mandate? Open one first.', false, 0);
    const out = base(context.withMandate(ctx, mandate, room), 'action.route', 2, `Move "${mandate.text}" to ${room.name}? Say yes to confirm.`);
    out.confirm = { label: `Move to ${room.name}` }; out.context = context.withMandate(ctx, mandate, room);
    return out;
  }
  if ((m = t.match(/^(?:stop|kill|halt|run|start|wake)\s+(.+)$/))) {
    const verb = t.split(/\s+/)[0];
    const q = m[1].trim();
    if (!/^(all|everyone|everybody)$/.test(q)) {
      const found = link(q, snap.agents);
      if (found.item && found.confidence >= 0.9) {
        const room = context.roomOfAgent(snap, found.item);
        const label = verb === 'stop' || verb === 'kill' || verb === 'halt' ? `Stop ${found.item.name}` : `Run ${found.item.name}`;
        const out = base(context.withAgent(ctx, found.item, room), 'action.agent', 2, `${label}? Say yes to confirm.`, true, found.confidence);
        out.confirm = { label }; out.context = context.withAgent(ctx, found.item, room);
        return out;
      }
      if (found.alts.length) {
        const opts = found.alts.slice(0, 3).map((a) => ({ label: a.name, result: interpret(`${verb} ${a.name}`, snap, ctx) }));
        return clarifyResult(ctx, 'action.agent', `Did you mean ${found.alts.map((a) => a.name).join(' or ')}?`, opts, 0.6);
      }
    }
  }

  if (/^(close this|minimise this|minimize this)$/.test(t)) {
    const out = base(ctx, 'nav.window', 1, 'Closed.');
    out.visual = [{ kind: 'window', op: t.startsWith('close') ? 'close' : 'minimise', winRef: ctx.focusRoom?.id ?? null }];
    return out;
  }
  if (/^(clear desk|show everything)$/.test(t)) {
    const out = base(ctx, 'nav.window', 1, t.startsWith('clear') ? 'Desk cleared.' : 'Everything on screen.');
    out.visual = [{ kind: 'window', op: 'clear', winRef: null }];
    return out;
  }
  if ((m = t.match(/^(?:close|minimise|minimize|park)\s+(.+)$/)) || (m = t.match(/^bring\s+(.+?)\s+to (?:the )?front$/))) {
    const q = (m[1] ?? '').trim();
    const room = roomInText(q, snap) ?? link(q, snap.rooms).item ?? (q === 'this' ? ctx.focusRoom : null);
    if (!room) return base(ctx, 'unknown', 0, `I could not find ${q}.`, false, 0);
    const op = t.startsWith('close') ? 'close' as const : t.startsWith('bring') ? 'front' as const : t.startsWith('park') ? 'park' as const : 'minimise' as const;
    const out = base(context.withRoom(ctx, room), 'nav.window', 1, `${room.name}.`);
    out.visual = [{ kind: 'window', op, winRef: room.id }]; out.context = context.withRoom(ctx, room);
    return out;
  }
  if (/^scroll (down|up)$/.test(t) || /^read this page$/.test(t)) {
    const out = base(ctx, 'nav.scroll', 1, t.includes('up') ? 'Scrolled up.' : 'Scrolled down.');
    out.visual = [{ kind: 'scroll', dir: t.includes('up') ? -1 : 1 }];
    return out;
  }
  if (/^(next|previous) room$/.test(t)) {
    const dir = t.startsWith('next') ? 1 : -1;
    const idx = ctx.focusRoom ? snap.rooms.findIndex((r) => r.id === ctx.focusRoom?.id) : -1;
    const room = snap.rooms[(idx + dir + snap.rooms.length) % snap.rooms.length] ?? null;
    if (!room) return base(ctx, 'unknown', 0, 'There are no rooms.', false, 0);
    const out = base(context.withRoom(ctx, room), 'nav.scroll', 1, `${room.name}.`);
    out.visual = [{ kind: 'openRoom', roomId: room.id }]; out.context = context.withRoom(ctx, room);
    return out;
  }

  if (/what needs me|anything for me|what.s waiting/.test(t) && !/approval/.test(t)) return needsMeResult(snap, ctx, 'status.needsme');
  if (/^(what (is|are) blocked|what.s blocked|who is stuck|anything blocked)/.test(t) || /^blocked/.test(t)) {
    const room = roomInText(t, snap);
    return listResult(snap, ctx, 'status.blocked', query.blockedList(snap, room ?? undefined), room);
  }
  if (/blocked in/.test(t)) {
    const room = roomInText(t, snap);
    return listResult(snap, ctx, 'status.blocked', query.blockedList(snap, room ?? undefined), room);
  }
  if (/what (has )?finished|what.s finished/.test(t)) return listResult(snap, ctx, 'status.finished', query.finishedList(snap), null);
  if (/what.s running|what is running|who.s working/.test(t) && !/on that/.test(t)) return listResult(snap, ctx, 'status.running', query.runningList(snap), null);
  if (/^(status|report)$/.test(t)) {
    const busy = snap.agents.filter((a) => a.state === 'working').length;
    const stuck = snap.agents.filter((a) => ['blocked', 'failed', 'killed'].includes(a.state));
    const wait = snap.inbox.length;
    if (!wait && !stuck.length) return base(ctx, 'status.global', 0, `All calm. ${busy} working.`);
    const bits: string[] = [];
    if (wait) bits.push(`${wait} waiting on you`);
    if (snap.inbox[0]) bits.push(`biggest is ${humanize.hours(snap.inbox[0].est_cost_cents)}`);
    if (stuck.length) bits.push(`${stuck.map((s) => s.name).join(' and ')} stopped`);
    return base(ctx, 'status.global', 0, `${bits.join(', ')}.`);
  }

  if ((m = t.match(/^how much budget left in (.+)$/)) || (m = t.match(/^budget (?:left )?in (.+)$/))) {
    const room = roomInText(m[1], snap) ?? link(m[1].trim(), snap.rooms).item ?? ctx.focusRoom;
    if (!room) return base(ctx, 'unknown', 0, `I could not find ${m[1]}.`, false, 0);
    const out = base(context.withRoom(ctx, room), 'entity.detail', 0, respond.sayBudget(room));
    out.visual = [{ kind: 'openRoom', roomId: room.id }]; out.context = context.withRoom(ctx, room);
    return out;
  }
  if ((m = t.match(/^who (runs|is in|works in) (.+)$/))) {
    const room = roomInText(m[2], snap) ?? link(m[2].trim(), snap.rooms).item;
    if (!room) return base(ctx, 'unknown', 0, `I could not find ${m[2]}.`, false, 0);
    const facts = query.roomFacts(snap, room);
    const out = base(context.withRoom(ctx, room), 'entity.detail', 0, respond.sayCrew(room, facts.crew));
    out.visual = [{ kind: 'openRoom', roomId: room.id }]; out.context = context.withRoom(ctx, room);
    return out;
  }
  if (/^(and )?who (is working on|works on|owns) that/.test(t)) {
    const task = ctx.focusTask;
    const agent = task?.agent_id ? snap.agents.find((a) => a.id === task.agent_id) ?? null : ctx.focusAgent;
    if (!agent) return base(ctx, 'unknown', 0, 'I do not know who owns that yet.', false, 0);
    const room = context.roomOfAgent(snap, agent);
    const out = base(context.withAgent(ctx, agent, room), 'entity.detail', 0, respond.sayAgent(agent, room));
    out.visual = [{ kind: 'openAgent', agentId: agent.id }]; out.context = context.withAgent(ctx, agent, room);
    return out;
  }
  if ((m = t.match(/^what is (.+) doing$/))) {
    const found = link(m[1].trim(), snap.agents);
    if (found.item && found.confidence >= 0.75 && found.confidence !== 0.8) {
      const room = context.roomOfAgent(snap, found.item);
      const out = base(context.withAgent(ctx, found.item, room), 'entity.detail', 0, respond.sayAgent(found.item, room), true, found.confidence);
      out.visual = [{ kind: 'openAgent', agentId: found.item.id }]; out.context = context.withAgent(ctx, found.item, room);
      return out;
    }
    if (found.alts.length) {
      const opts = found.alts.slice(0, 3).map((a) => ({ label: a.name, result: interpret(`what is ${a.name} doing`, snap, ctx) }));
      return clarifyResult(ctx, 'entity.detail', `Did you mean ${found.alts.map((a) => a.name).join(' or ')}?`, opts, 0.6);
    }
  }
  if ((m = t.match(/^tell me about (.+?) task (\w+)$/))) {
    const room = roomInText(m[1], snap) ?? link(m[1].trim(), snap.rooms).item;
    const n = ORD[m[2]] ?? Number(m[2]);
    if (!room || !n) return base(ctx, 'unknown', 0, `I could not find ${m[1]}.`, false, 0);
    const items = query.roomTasks(snap, room);
    if (n > items.length) return ordinalOutOfRange(ctx, items.length, room);
    const item = items[n - 1];
    const task = snap.tasks.find((x) => x.id === item.id) ?? null;
    const out = base(context.withList(ctx, items, 'entity.detail'), 'entity.detail', 0, task ? `${item.label}: ${item.state}.` : `${item.label}.`);
    if (task) { out.context = context.withTask(context.withList(ctx, items, 'entity.detail'), task, room); out.visual = [{ kind: 'openTask', taskId: task.id, roomId: room.id }]; }
    return out;
  }
  if ((m = t.match(/^tell me about (.+)$/))) {
    return openEntity(snap, ctx, m[1].trim(), t);
  }

  const roomMention = roomInText(t, snap);
  if (roomMention && /(how are we doing|latest progress|progress|update on|how is|doing in)/.test(t)) return roomStatus(snap, ctx, roomMention);

  if ((m = t.match(/^(?:find|search)(?: mandates?)? about (.+)$/)) || (m = t.match(/^find (.+)$/))) {
    const items = query.searchSnapshot(snap, m[1].trim());
    const out = listResult(snap, ctx, 'search', items, null);
    out.visual = [{ kind: 'launch', app: 'work' }, ...out.visual];
    return out;
  }
  if (/^show failed tasks$/.test(t)) {
    const items = query.failedTasks(snap);
    const out = listResult(snap, ctx, 'search', items, null);
    out.visual = [{ kind: 'launch', app: 'work' }, ...out.visual];
    return out;
  }

  if ((m = t.match(/^(?:open|show|go to)\s+(.+)$/))) return openEntity(snap, ctx, m[1].trim(), t);

  const ranked = rankRooms(t, snap.rooms);
  const said = raw.trim().replace(/[.!?]+$/, '');
  if (ranked.length && t.split(/\s+/).length >= 3) {
    const out = base(ctx, 'action.dispatch', 2, `${ranked[0].name}?`, true, 0.9);
    out.propose = { kind: 'propose', room: ranked[0], rooms: ranked, text: said };
    return out;
  }
  if (t.split(/\s+/).length >= 3) return base(ctx, 'unknown', 0, 'Which room should take that?', false, 0.4);
  return base(ctx, 'unknown', 0, `I heard "${t}". Try "what needs me", "open Sales" or "help".`, false, 0);
}
