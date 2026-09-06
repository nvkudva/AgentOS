import { q } from './db.js';
import { bus } from './bus.js';

export type EventInput = {
  type: string;
  room_id?: string | null;
  agent_id?: string | null;
  run_id?: string | null;
  payload?: Record<string, any>;
};

/**
 * Append to the event log. This is the ONLY way state changes are recorded.
 * Projections (room/agent/run) are a fold over this table; see scripts/replay.ts.
 */
export async function append(e: EventInput) {
  const [row] = await q(
    `INSERT INTO event (type, room_id, agent_id, run_id, payload)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, ts`,
    [e.type, e.room_id ?? null, e.agent_id ?? null, e.run_id ?? null, e.payload ?? {}]
  );
  bus.publish({ type: 'event', event: { ...e, id: row.id, ts: row.ts, payload: e.payload ?? {} } });
  return row;
}
