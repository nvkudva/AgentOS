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
