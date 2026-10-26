import { createHash, randomBytes } from 'node:crypto';
import { q, one } from './db.js';
import { id } from './ids.js';

export type Auth = { scope: 'operator' } | { scope: 'room'; roomId: string } | { scope: 'none' };

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** Mint a token. Returns the plaintext ONCE — it is hashed before it is stored. */
export async function mintToken(label: string, roomId: string | null = null): Promise<string> {
  const secret = `atr_${randomBytes(24).toString('base64url')}`;
  await q(`INSERT INTO api_token (id, label, scope_room_id, secret_hash) VALUES ($1,$2,$3,$4)`,
    [id('tok'), label, roomId, hash(secret)]);
  return secret;
}

export async function resolveAuth(token: string | null | undefined): Promise<Auth> {
  if (!token) return { scope: 'none' };
  const row = await one<any>(`SELECT scope_room_id FROM api_token WHERE secret_hash=$1`, [hash(token)]);
  if (!row) return { scope: 'none' };
  return row.scope_room_id ? { scope: 'room', roomId: row.scope_room_id } : { scope: 'operator' };
}

/**
 * Bootstraps the operator token: env wins, then the stored one, then a fresh
 * random secret stored hashed and printed ONCE for the operator to keep.
 */
export async function ensureOperatorToken(): Promise<string | null> {
  if (process.env.ATRIUM_TOKEN) {
    const known = await one(`SELECT id FROM api_token WHERE label='operator (env)' AND secret_hash=$1`,
      [hash(process.env.ATRIUM_TOKEN)]);
    if (!known) {
      await q(`INSERT INTO api_token (id, label, scope_room_id, secret_hash) VALUES ($1,'operator (env)',NULL,$2)`,
        [id('tok'), hash(process.env.ATRIUM_TOKEN)]);
    }
    return null; // already in the operator's hands
  }
  const existing = await one(`SELECT id FROM api_token WHERE label='operator (boot)'`);
  if (existing) return null;
  const secret = await mintToken('operator (boot)');
  return secret;
}

/** Room-scoped tokens are for tooling that belongs to one room. */
export async function mintRoomToken(roomId: string): Promise<string> {
  return mintToken(`room ${roomId}`, roomId);
}
