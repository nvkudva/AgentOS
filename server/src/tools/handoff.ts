import { q, one } from '../db.js';
import { id } from '../ids.js';
import { append } from '../events.js';
import type { ToolSpec } from '../runtime/types.js';
import { ScopeViolation } from '../errors.js';

export type Who = { agent_id: string | null; run_id: string | null };

/**
 * PM-10: one room asks another for data or compute. The request is a row, not a
 * whisper — logged on both sides, revocable by the sender until accepted, and
 * artifacts only travel if they belong to the sender (or are shared).
 */
export async function requestHandoff(fromRoomId: string, fromKey: string, toRef: string,
    artifactIds: string[], message: string, who: Who) {
  const from = await one<any>(`SELECT id FROM room WHERE id=$1`, [fromRoomId]);
  if (!from) throw new ScopeViolation(fromKey, 'unknown sending room');
  const to = await one<any>(`SELECT * FROM room WHERE key=$1 OR id=$1`, [toRef]);
  if (!to) throw new ScopeViolation(fromKey, `no room "${toRef}" to hand off to`);
  if (to.id === fromRoomId) throw new ScopeViolation(fromKey, 'a room cannot hand off to itself');
  const aids = artifactIds.map(String);
  if (aids.length) {
    const owned = await q<any>(
      `SELECT id FROM artifact WHERE id = ANY($1) AND (room_id=$2 OR shared)`, [aids, fromRoomId]);
    if (owned.length !== aids.length) {
      throw new ScopeViolation(fromKey, 'only your own or shared artifacts travel');
    }
  }
  const hid = id('hnd');
  await q(`INSERT INTO handoff (id, from_room_id, to_room_id, artifact_ids, message)
           VALUES ($1,$2,$3,$4,$5)`, [hid, fromRoomId, to.id, JSON.stringify(aids), message]);
  await append({ type: 'handoff.requested', room_id: fromRoomId,
    agent_id: who.agent_id, run_id: who.run_id,
    payload: { handoff_id: hid, to_room: to.key, artifacts: aids, message } });
  return { handoff_id: hid, to_room: to.key, state: 'pending' };
}

export async function answerHandoff(handoffId: string, roomId: string, roomKey: string,
    accept: boolean, who: Who) {
  const h = await one<any>(`SELECT * FROM handoff WHERE id=$1`, [handoffId]);
  if (!h) throw new ScopeViolation(roomKey, `no handoff "${handoffId}"`);
  if (h.to_room_id !== roomId) throw new ScopeViolation(roomKey, 'only the receiving room answers a handoff');
  if (h.state !== 'pending') throw new ScopeViolation(roomKey, `handoff is already ${h.state}`);
  const state = accept ? 'accepted' : 'rejected';
  await q(`UPDATE handoff SET state=$2, decided_at=now() WHERE id=$1`, [h.id, state]);
  let carried = 0;
  if (state === 'accepted') {
    // Accepted artifacts arrive as shared copies: the source keeps its own,
    // the receiver reads without ever touching the source's tables.
    for (const aid of h.artifact_ids ?? []) {
      const art = await one<any>(`SELECT * FROM artifact WHERE id=$1`, [aid]);
      if (!art) continue;
      await q(`INSERT INTO artifact (id, room_id, kind, title, body, uri, shared)
               VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [id('art'), roomId, art.kind, art.title, art.body, art.uri]);
      carried++;
    }
  }
  await append({ type: state === 'accepted' ? 'handoff.accepted' : 'handoff.rejected',
    room_id: roomId, agent_id: who.agent_id, run_id: who.run_id,
    payload: { handoff_id: h.id, carried } });
  return { handoff_id: h.id, state, carried };
}

export async function revokeHandoff(handoffId: string, roomId: string, roomKey: string, who: Who) {
  const h = await one<any>(`SELECT * FROM handoff WHERE id=$1`, [handoffId]);
  if (!h) throw new ScopeViolation(roomKey, `no handoff "${handoffId}"`);
  if (h.from_room_id !== roomId) throw new ScopeViolation(roomKey, 'only the sending room revokes a handoff');
  if (h.state !== 'pending') throw new ScopeViolation(roomKey, `handoff is already ${h.state}`);
  await q(`UPDATE handoff SET state='revoked', decided_at=now() WHERE id=$1`, [h.id]);
  await append({ type: 'handoff.revoked', room_id: roomId,
    agent_id: who.agent_id, run_id: who.run_id, payload: { handoff_id: h.id } });
  return { handoff_id: h.id, state: 'revoked' };
}

export const handoffRequest: ToolSpec = {
  name: 'handoff.request',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `ask the ${a.to_room} room: ${String(a.message ?? '').slice(0, 80)}`,
  touches: (a) => [`room ${a.to_room}`, 'shared artifacts'],
  estimate: () => 0,
  async run(ctx, args) {
    return requestHandoff(ctx.room.id, ctx.room.key, String(args.to_room ?? ''),
      Array.isArray(args.artifact_ids) ? args.artifact_ids : [], String(args.message ?? ''),
      { agent_id: ctx.agent.id, run_id: ctx.run.id });
  },
};

export const handoffFulfill: ToolSpec = {
  name: 'handoff.fulfill',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `${a.accept === false ? 'decline' : 'accept'} handoff ${a.handoff_id}`,
  touches: (a) => [`handoff ${a.handoff_id}`],
  estimate: () => 0,
  async run(ctx, args) {
    return answerHandoff(String(args.handoff_id), ctx.room.id, ctx.room.key,
      args.accept !== false, { agent_id: ctx.agent.id, run_id: ctx.run.id });
  },
};
