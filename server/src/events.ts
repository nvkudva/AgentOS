import pg from 'pg';
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
const sinceSnapshot = new Map<string, number>();

export async function append(e: EventInput) {
  const [row] = await q(
    `INSERT INTO event (type, room_id, agent_id, run_id, payload)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, ts`,
    [e.type, e.room_id ?? null, e.agent_id ?? null, e.run_id ?? null, e.payload ?? {}]
  );
  bus.publish({ type: 'event', event: { ...e, id: row.id, ts: row.ts, payload: e.payload ?? {} } });
  // A7: checkpoint a room every 200 of its events, in the background. The fold
  // stays the definition; snapshots are just where it starts.
  if (e.room_id) {
    const n = (sinceSnapshot.get(e.room_id) ?? 0) + 1;
    sinceSnapshot.set(e.room_id, n);
    if (n >= 200) {
      sinceSnapshot.set(e.room_id, 0);
      import('./replay.js').then((m) => m.writeRoomSnapshot(e.room_id!).catch(() => {}));
    }
  }
  return row;
}

/**
 * PM-11: the same insert, but on the CALLER's transaction. State changes and
 * their events commit atomically — a crash can never leave an approved row
 * whose run never resumed, or a resumed run the log never saw. The bus publish
 * stays after commit (at-most-once delivery, next snapshot heals).
 */
export async function appendTx(c: pg.PoolClient, e: EventInput) {
  const r = await c.query(
    `INSERT INTO event (type, room_id, agent_id, run_id, payload)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, ts`,
    [e.type, e.room_id ?? null, e.agent_id ?? null, e.run_id ?? null, e.payload ?? {}]
  );
  return r.rows[0];
}
