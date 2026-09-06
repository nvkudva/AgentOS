import type { Agent, Room, Inbox } from '../lib/api';

export type CmdCtx = {
  agents: Agent[]; rooms: Room[]; inbox: Inbox[]; panic: boolean;
  startAgent: (a: Agent) => void;
  killAgent: (a: Agent) => void;
  openAgent: (a: Agent) => void;
  openRoom: (r: Room) => void;
  launch: (k: 'floor' | 'list' | 'inbox' | 'settings') => void;
  setPanic: (on: boolean) => void;
  setTheme: (t: 'light' | 'dark' | 'auto') => void;
  setSidebar: (open: boolean) => void;
  focusApproval: (id: string) => void;
};
export type CmdResult = { say: string; ok: boolean };

const WAKE = /^\s*(hey\s+)?atrium[,!.\s]*/i;
export const stripWake = (s: string) => s.replace(WAKE, '').trim();
export const hasWake = (s: string) => WAKE.test(s);

const find = <T extends { name?: string; key?: string }>(xs: T[], q: string) =>
  xs.find((x) => (x.name ?? '').toLowerCase() === q) ??
  xs.find((x) => (x.key ?? '').toLowerCase() === q) ??
  xs.find((x) => (x.name ?? '').toLowerCase().startsWith(q)) ??
  xs.find((x) => (x.key ?? '').toLowerCase().startsWith(q));

/**
 * The supervisor's brain. Deterministic on purpose: a spoken sentence that half-parsed
 * must never become an action nobody asked for.
 *
 * The one thing it deliberately cannot do is approve. Voice recognition is the wrong
 * place for an irreversible decision, so "approve the PR" surfaces the card and waits
 * for a click. R2 stays intact.
 */
export function run(raw: string, c: CmdCtx): CmdResult {
  const t = stripWake(raw).toLowerCase().replace(/[.!?]+$/, '').trim();
  if (!t) return { say: 'I am listening.', ok: false };

  let m: RegExpMatchArray | null;

  // --- status ---------------------------------------------------------------
  if (/^(what needs me|status|anything for me|what.s waiting|report)/.test(t)) {
    const wait = c.inbox.length;
    const busy = c.agents.filter((a) => a.state === 'working').length;
    const stuck = c.agents.filter((a) => ['blocked', 'failed', 'killed'].includes(a.state));
    if (!wait && !stuck.length) return { say: `Calm. ${busy} working, nothing waiting on you.`, ok: true };
    const dear = c.inbox[0];
    return {
      say: `${wait} waiting on you${dear ? `, dearest is ${dear.action} at ${dear.est_cost_cents} cents` : ''}` +
           `${stuck.length ? `. ${stuck.map((s) => s.name).join(' and ')} stopped` : ''}.`,
      ok: true,
    };
  }

  // --- stop / panic ---------------------------------------------------------
  if (/^(stop|halt|freeze|pause)\s+(all|everything|everyone)/.test(t) || /^panic/.test(t)) {
    c.setPanic(true); return { say: 'Everything stopped.', ok: true };
  }
  if (/^(resume|continue|carry on|unpause)\s*(all|everything|everyone)?$/.test(t)) {
    c.setPanic(false); return { say: 'Resumed.', ok: true };
  }
  if ((m = t.match(/^(?:stop|kill|halt)\s+(.+)$/))) {
    const a = find(c.agents, m[1].trim());
    if (!a) return { say: `I do not know anyone called ${m[1]}.`, ok: false };
    c.killAgent(a); return { say: `Stopped ${a.name}.`, ok: true };
  }

  // --- run ------------------------------------------------------------------
  if (/^(run|start|wake)\s+(all|everyone|everybody)$/.test(t)) {
    const idle = c.agents.filter((a) => a.state !== 'working');
    idle.forEach(c.startAgent);
    return { say: `Started ${idle.length} agents.`, ok: true };
  }
  if ((m = t.match(/^(?:run|start|wake)\s+(.+)$/))) {
    const a = find(c.agents, m[1].trim());
    if (!a) return { say: `I do not know anyone called ${m[1]}.`, ok: false };
    c.startAgent(a); c.openAgent(a); return { say: `${a.name} is on it.`, ok: true };
  }

  // --- open -----------------------------------------------------------------
  if ((m = t.match(/^(?:open|show|go to)\s+(.+)$/))) {
    const q = m[1].trim();
    if (/^(floor|map|rooms)$/.test(q)) { c.launch('floor'); return { say: 'Floor.', ok: true }; }
    if (/^(activity|feed|log|chat)$/.test(q)) { c.launch('list'); return { say: 'Activity.', ok: true }; }
    if (/^(approvals?|inbox|needs me)$/.test(q)) { c.setSidebar(true); return { say: 'Approvals.', ok: true }; }
    if (/^settings?$/.test(q)) { c.launch('settings'); return { say: 'Settings.', ok: true }; }
    const a = find(c.agents, q);
    if (a) { c.openAgent(a); return { say: `${a.name}.`, ok: true }; }
    const r = find(c.rooms, q);
    if (r) { c.openRoom(r); return { say: `${r.name}.`, ok: true }; }
    return { say: `I could not find ${q}.`, ok: false };
  }

  // --- approvals: surface, never decide -------------------------------------
  if (/^(approve|reject|deny|say yes|say no)/.test(t)) {
    const first = c.inbox[0];
    if (!first) return { say: 'Nothing is waiting for a decision.', ok: true };
    c.setSidebar(true); c.focusApproval(first.id);
    return { say: `I will not approve by voice. Here is the card: ${first.action}. Decide with a click.`, ok: true };
  }

  // --- chrome ---------------------------------------------------------------
  if (/^(dark|night)( mode)?$/.test(t)) { c.setTheme('dark'); return { say: 'Dark.', ok: true }; }
  if (/^(light|day)( mode)?$/.test(t)) { c.setTheme('light'); return { say: 'Light.', ok: true }; }
  if (/^auto( mode)?$/.test(t)) { c.setTheme('auto'); return { say: 'Following the system.', ok: true }; }
  if (/^(hide|close)\s+(the\s+)?(sidebar|notifications?)/.test(t)) { c.setSidebar(false); return { say: 'Hidden.', ok: true }; }
  if (/^(show|open)\s+(the\s+)?(sidebar|notifications?)/.test(t)) { c.setSidebar(true); return { say: 'Here.', ok: true }; }

  return { say: `I did not understand "${t}".`, ok: false };
}

export const HELP = [
  'run Kit · run everyone', 'stop Rex · stop all', 'open engineering · open Ada',
  'what needs me', 'show approvals', 'dark mode · light mode',
];
