import type { Room, Agent, Mandate, Task } from './api';

export type Progress = {
  /** the instruction the room is working on, if it has one */
  mandate: Mandate | null;
  /** one sentence of where it has got to, chosen by what is actually true */
  where: string;
  /** stopped, and it is the operator who has to move */
  needs: boolean;
  /** the manager's own words, once there are any */
  report: string;
};

/**
 * What a room is doing, in a sentence.
 *
 * Shared so the card on the Overview and the box at the top of a room's console say
 * the same thing in the same words — two places disagreeing about the state of one
 * room is worse than either of them being terse.
 */
export function roomProgress(room: Room, mandates: Mandate[], tasks: Task[], crew: Agent[]): Progress {
  const m = mandates
    .filter((x) => x.room_id === room.id && x.state !== 'recalled')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;

  const waiting = crew.some((a) => ['awaiting_approval', 'blocked'].includes(a.state));

  if (!m) {
    const idle = crew.filter((a) => a.state === 'idle').length;
    return {
      mandate: null,
      where: idle === crew.length
        ? `All ${crew.length} here and free.`
        : `${idle} of ${crew.length} free.`,
      needs: waiting,
      report: '',
    };
  }

  const mt = tasks.filter((t) => t.mandate_id === m.id);
  const done = mt.filter((t) => t.state === 'done').length;
  const working = mt.filter((t) => t.state === 'working');
  const failed = mt.filter((t) => t.state === 'failed').length;
  const who = working
    .map((t) => crew.find((a) => a.id === t.agent_id)?.name)
    .filter(Boolean) as string[];

  const where =
    m.state === 'done' ? 'Finished.'
    : m.state === 'blocked' || waiting ? 'Stopped, waiting on you.'
    : m.state === 'heard' || m.state === 'routed' ? 'Just arrived — being broken down.'
    : !mt.length ? 'Being broken into tasks.'
    : working.length ? `${done} of ${mt.length} done, ${who.length ? `${who.join(' and ')} on the rest` : 'the rest queued'}.`
    : `${done} of ${mt.length} done.`;

  return {
    mandate: m,
    where: where + (failed ? ` ${failed} failed.` : ''),
    needs: waiting || m.state === 'blocked',
    report: m.report ?? '',
  };
}

export type Detail = {
  /** who is in the room, named while the list is short enough to name */
  crew: string;
  /** the work it is holding, in counts */
  load: string;
  /** how far it may go before it has to ask */
  scope: string;
};

/** What it may do unattended, per the highest blast radius its policy waves through. */
const ALONE: Record<string, string> = {
  low: 'Reads on its own; writing waits for you.',
  medium: 'Acts alone inside the company; the rest waits for you.',
  high: 'Acts alone, outward-facing work included.',
};

/**
 * The three lines under the sentence: who is in the room, what it is holding, and how
 * far it may go alone. Same source as `roomProgress`, for the same reason — the card on
 * the Overview, the parked rail and the console must not describe one room differently.
 */
export function roomDetail(room: Room, mandates: Mandate[], tasks: Task[], crew: Agent[]): Detail {
  const mgr = crew.find((a) => a.tier === 'manager');
  const workers = crew.filter((a) => a.tier !== 'manager').map((a) => a.name);
  const listed = workers.length > 3
    ? `${workers.length} specialists`
    : workers.slice(0, -1).join(', ') + (workers.length > 1 ? ' and ' : '') + (workers.at(-1) ?? '');

  const live = mandates.filter((m) => m.room_id === room.id && !['recalled', 'done'].includes(m.state));
  const mine = tasks.filter((t) => live.some((m) => m.id === t.mandate_id));
  const count = (s: string) => mine.filter((t) => t.state === s).length;
  const parts = [
    count('working') && `${count('working')} running`,
    count('queued') && `${count('queued')} waiting to be picked up`,
    count('done') && `${count('done')} finished`,
    count('failed') && `${count('failed')} stopped`,
  ].filter(Boolean) as string[];

  return {
    crew: !mgr ? `${crew.length} here, nobody running it`
      : !workers.length ? `${mgr.name} runs it single-handed`
      : `${mgr.name} runs ${listed}`,
    load: parts.length ? `${parts.join(', ')}.` : 'Nothing in hand.',
    scope: ALONE[Object.keys(ALONE).reverse().find((b) => room.approval_policy?.[b] === 'auto') ?? '']
      ?? 'Asks you before it does anything.',
  };
}
