import type { Agent, Room, Inbox } from '../lib/api';
import { hours } from '../lib/humanize';

/** An unrouted sentence and the rooms that answered to it, best first. */
export type Proposal = { kind: 'propose'; room: Room; rooms: Room[]; text: string };

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
  /** commit a proposal: create the mandate, route it, and fly it there from `from` */
  dispatch: (text: string, room: Room, from: DOMRect, mandate?: string) => void;
};
export type CmdResult = { say: string; ok: boolean; propose?: Proposal };

const WAKE = /^\s*(hey\s+)?atrium[,!.\s]*/i;
export const stripWake = (s: string) => s.replace(WAKE, '').trim();
export const hasWake = (s: string) => WAKE.test(s);

/** Words that appear in every sentence and so choose nothing. */
const STOP = new Set(('the a an and or of to in on for from with our my your this that last next '
  + 'please can you we us it its is are was were do does did run go get make give take put show '
  + 'tell me about into over out up down all any some more most new old why how what when who')
  .split(' '));

/**
 * Which room a sentence belongs to. Keywords score against the room's own words —
 * its key and name loudest, then its objective, then the tools it is trusted with,
 * because a room's grants are the truest statement of what it is allowed to be asked.
 *
 * It never picks on a tie of zero: a sentence that matches nothing is a question back
 * to the operator, not a guess dressed as a decision.
 */
export function routeRooms(text: string, rooms: Room[]): Room[] {
  const words = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w)))];
  if (!words.length) return [];
  const open = rooms.filter((r) => r.status === 'open');
  const scored = open.map((r) => {
    const name = `${r.key} ${r.name}`.toLowerCase();
    const objective = (r.objective ?? '').toLowerCase();
    const grants = r.tool_grants.join(' ').toLowerCase().replace(/[._*]/g, ' ');
    let n = 0;
    for (const w of words) {
      if (name.includes(w)) n += 4;
      else if (objective.includes(w)) n += 2;
      else if (grants.includes(w)) n += 1;
    }
    return { r, n };
  }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return [];
  // The winner first, then every other open room: cycling with the arrows must be able
  // to reach a room the keywords never mentioned.
  const rest = open.filter((r) => !scored.some((s) => s.r.id === r.id));
  return [...scored.map((s) => s.r), ...rest];
}

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
    // Short on purpose: this is spoken aloud and shown in a small panel.
    const wait = c.inbox.length;
    const busy = c.agents.filter((a) => a.state === 'working').length;
    const stuck = c.agents.filter((a) => ['blocked', 'failed', 'killed'].includes(a.state));
    if (!wait && !stuck.length) return { say: `All calm. ${busy} working.`, ok: true };
    const bits: string[] = [];
    if (wait) bits.push(`${wait} waiting on you`);
    if (c.inbox[0]) bits.push(`biggest is ${hours(c.inbox[0].est_cost_cents)}`);
    if (stuck.length) bits.push(`${stuck.map((s) => s.name).join(' and ')} stopped`);
    return { say: bits.join(', ') + '.', ok: true };
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
    const who = m[1].trim();
    const a = find(c.agents, who);
    if (a) { c.startAgent(a); c.openAgent(a); return { say: `${a.name} is on it.`, ok: true }; }
    // "run analytics on last quarter's churn" is not a name that failed to match — it is
    // a sentence. Only something short enough to be a name is reported as an unknown one.
    if (who.split(/\s+/).length <= 3) return { say: `I do not know anyone called ${who}.`, ok: false };
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
    return { say: 'I never approve by voice. Here is the card.', ok: true };
  }

  // --- chrome ---------------------------------------------------------------
  if (/^(dark|night)( mode)?$/.test(t)) { c.setTheme('dark'); return { say: 'Dark.', ok: true }; }
  if (/^(light|day)( mode)?$/.test(t)) { c.setTheme('light'); return { say: 'Light.', ok: true }; }
  if (/^auto( mode)?$/.test(t)) { c.setTheme('auto'); return { say: 'Following the system.', ok: true }; }
  if (/^(hide|close)\s+(the\s+)?(sidebar|notifications?)/.test(t)) { c.setSidebar(false); return { say: 'Hidden.', ok: true }; }
  if (/^(show|open)\s+(the\s+)?(sidebar|notifications?)/.test(t)) { c.setSidebar(true); return { say: 'Here.', ok: true }; }

  // --- intent: an unmatched sentence is a piece of work looking for a room ---
  // Nothing dispatches here. The result is a proposal the operator confirms; the orb
  // holds it uncommitted until they press Return, drag it out, or throw it away.
  const said = stripWake(raw).replace(/[.!?]+$/, '').trim();
  const ranked = routeRooms(t, c.rooms);
  if (ranked.length) {
    return { say: `${ranked[0].name}?`, ok: true,
             propose: { kind: 'propose', room: ranked[0], rooms: ranked, text: said } };
  }
  if (said.split(/\s+/).length >= 3) return { say: 'Which room should take that?', ok: false };

  return { say: `I did not understand "${t}".`, ok: false };
}

export const HELP = [
  'run Kit · run everyone', 'stop Rex · stop all', 'open engineering · open Ada',
  'what needs me', 'show approvals', 'dark mode · light mode',
];
