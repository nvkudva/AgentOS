import pg from 'pg';

// Room-scoped connection pools. Each room's DB access uses ITS OWN postgres role,
// so cross-room data access is refused by the database, not by our code being polite.
const { Pool } = pg;

export const DB = process.env.PGDATABASE ?? 'atrium';
const HOST = process.env.PGHOST ?? '127.0.0.1';
const PORT = Number(process.env.PGPORT ?? 5432);

export const pool = new Pool({
  host: HOST, port: PORT, database: DB,
  user: process.env.PGUSER ?? 'atrium',
  password: process.env.PGPASSWORD ?? 'atrium',
  max: 12,
});

const rolePools = new Map<string, pg.Pool>();
export function rolePool(role: string, password?: string): pg.Pool {
  const key = password ? `${role}#pw` : role;
  let p = rolePools.get(key);
  if (!p) {
    // New rooms get random passwords (provisionRoom stores them on the room row);
    // the password==rolename default only covers pre-A9 roles.
    p = new Pool({ host: HOST, port: PORT, database: DB, user: role, password: password ?? role, max: 4 });
    rolePools.set(key, p);
  }
  return p;
}

/** The room's own DB password, for tooling that connects AS the room. */
export async function roomDbPassword(roomId: string): Promise<string | null> {
  const r = await pool.query(`SELECT db_password FROM room WHERE id=$1`, [roomId]);
  return r.rows[0]?.db_password ?? null;
}

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}
export async function one<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export async function closeAll() {
  await pool.end().catch(() => {});
  for (const p of rolePools.values()) await p.end().catch(() => {});
}
