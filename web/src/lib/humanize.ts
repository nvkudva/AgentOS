/**
 * Everything an agent does, said in plain English.
 *
 * The people running this are operators, not engineers. They should never meet a tool
 * name, an event type, a millisecond, or a cent. One place decides how work is described,
 * so the language stays consistent everywhere it appears.
 */

const TOOL: Record<string, { verb: string; place: string; glyph: string }> = {
  'sql.query':       { verb: 'Looked something up in', place: 'the company database', glyph: '🗄️' },
  'crm.note':        { verb: 'Left a note on',         place: 'a deal',               glyph: '📇' },
  'artifact.write':  { verb: 'Wrote up',               place: 'what it found',        glyph: '📄' },
  'artifact.read':   { verb: 'Read',                   place: "other teams' notes",   glyph: '📚' },
  'queue.draft':     { verb: 'Drafted a post into',    place: 'the content queue',    glyph: '✍️' },
  'queue.publish':   { verb: 'Published to',           place: 'the blog',             glyph: '📣' },
  'repo.read':       { verb: 'Opened',                 place: 'a file',               glyph: '📂' },
  'repo.patch':      { verb: 'Made a change to',       place: 'the code',             glyph: '🔧' },
  'repo.test':       { verb: 'Ran',                    place: 'the tests',            glyph: '🧪' },
  'github.pr.open':  { verb: 'Opened',                 place: 'a pull request',       glyph: '🔀' },
  'escalate':        { verb: 'Asked',                  place: 'you a question',       glyph: '🙋' },
};

export const toolName = (t: string) => TOOL[t]?.place ?? t;
export const toolGlyph = (t: string) => TOOL[t]?.glyph ?? '•';

/** Cents are an implementation detail. People read money in dollars. */
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The live one-line status, in words an operator would use. */
export function friendlyActivity(activity: string, state: string) {
  if (!activity) return friendlyState(state);
  if (activity === 'done') return 'Finished';
  if (activity === 'starting' || activity === 'resuming') return 'Getting going';
  if (activity.startsWith('waiting on you:')) return activity.replace('waiting on you:', 'Needs you:').trim();
  if (activity.startsWith('killed: loop_detected')) return 'Stopped — it was going in circles';
  if (activity.startsWith('killed: step_budget')) return 'Stopped — it ran out of steps';
  if (activity.startsWith('killed: cost_budget')) return 'Stopped — it reached its spending limit';
  if (activity.startsWith('killed:')) return 'Stopped';
  if (activity.startsWith('scope violation')) return "Stopped — that isn't allowed here";
  if (activity.startsWith('halted:')) return 'Paused — the room hit its limit';
  if (activity === 'rejected by you') return 'You said no';
  return activity[0].toUpperCase() + activity.slice(1);
}

export const friendlyState = (s: string) => ({
  idle: 'Ready', working: 'Working', blocked: 'Waiting for you',
  awaiting_approval: 'Needs your approval', failed: 'Stopped — something went wrong',
  killed: 'Stopped by a limit',
}[s] ?? s);

/** "high" means nothing to anyone. Say what it can actually reach. */
export const blastWords = (b: string) => ({
  low: 'Read-only', medium: 'Visible inside the company', high: 'Leaves the company',
}[b] ?? b);

/** The headline on an approval card: who wants to do what, in one short sentence. */
export function askTitle(it: { kind: string; tool?: string; action: string; agent_name: string }) {
  if (it.kind === 'escalation') return it.action;
  const verb = {
    'github.pr.open': 'open a pull request',
    'queue.publish': 'publish a post',
    'repo.patch': 'change the code',
    'crm.note': 'update a deal',
    'sql.query': 'run a query',
  }[it.tool ?? ''] ?? it.action;
  return `${it.agent_name} wants to ${verb}`;
}

/** The secondary line on a card: the real action, minus the identifiers nobody reads. */
export const plainDetail = (s: string) =>
  s.replace(/\b(cq|apr|esc|run|art|agt|room)_[0-9a-f]{6,}\b/g, 'it')
   .replace(/queued post it/, 'the draft')
   .replace(/\s+/g, ' ')
   .trim();

/** What a tool call reaches, said plainly. */
export const touchWords = (t: string) =>
  t.replace(/^content_queue row .*/, 'a post in the content queue')
   .replace(/^content_queue.*/, 'the content queue')
   .replace(/^bizdata\./, 'the company database — ')
   .replace(/^branch /, 'a branch of the code: ')
   .replace(/^base /, 'the main code: ')
   .replace('local git remote', 'your code repository')
   .replace('artifact store (this room)', "this room's notes");

export type Said =
  | { kind: 'bubble'; text: string }                    // the agent talking
  | { kind: 'ask'; text: string }                       // a question for you
  | { kind: 'step'; glyph: string; text: string }       // a piece of work
  | { kind: 'note'; text: string }                      // start, finish, your decisions
  | { kind: 'problem'; text: string }
  | null;

export function describe(e: any, who: string): Said {
  const p = e.payload ?? {};
  const t = TOOL[p.tool];
  switch (e.type) {
    case 'run.started':   return { kind: 'note', text: `${who} started: ${p.goal}` };
    case 'agent.said':    return { kind: 'bubble', text: capital(p.activity) };
    case 'tool.call':     return { kind: 'step', glyph: toolGlyph(p.tool),
                                   text: t ? `${t.verb} ${t.place}` : `Used ${p.tool}` };
    case 'tool.result': {
      const n = p.result?.rowCount;
      if (typeof n === 'number') return { kind: 'step', glyph: '✅', text: `Found ${n} ${n === 1 ? 'record' : 'records'}` };
      if (p.result?.passed === true)  return { kind: 'step', glyph: '✅', text: 'All tests passed' };
      if (p.result?.passed === false) return { kind: 'problem', text: 'The tests did not pass' };
      if (p.result?.url) return { kind: 'step', glyph: '🔗', text: `Pull request opened — ${p.result.url}` };
      return null;                                            // silence is fine for a plain success
    }
    case 'tool.error':    return { kind: 'problem', text: `Couldn't ${t ? t.verb.toLowerCase() + ' ' + t.place : 'finish that step'}. ${p.error}` };
    case 'scope.violation': return { kind: 'problem',
                                     text: `Stopped — ${who} isn't allowed to touch ${toolName(p.tool)}.` };
    case 'approval.requested': return { kind: 'ask', text: `${who} needs your approval: ${p.action}` };
    case 'approval.granted':   return { kind: 'note', text: `You approved this.` };
    case 'approval.rejected':  return { kind: 'note', text: `You said no.` };
    case 'escalation.raised':  return { kind: 'ask', text: p.question };
    case 'run.finished':  return { kind: 'note', text: 'Finished' };
    case 'run.failed':    return { kind: 'problem', text: `Stopped — ${p.error}` };
    case 'agent.killed':  return { kind: 'problem', text: p.reason === 'loop_detected'
                                     ? `Stopped — ${who} was going in circles.`
                                     : p.reason?.includes('budget') ? `Stopped — ${who} reached the spending limit.`
                                     : `You stopped ${who}.` };
    default: return null;
  }
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
