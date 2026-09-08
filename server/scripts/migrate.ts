import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, DB, closeAll } from '../src/db.js';

const MIG = path.resolve(process.cwd(), '../db/migrations');

/**
 * Room DB roles. This is where "the engineering room cannot read the marketing
 * room's data" stops being a promise and becomes a GRANT.
 */
const ROLES: Record<string, string[]> = {
  atrium_analytics: [
    `GRANT USAGE ON SCHEMA bizdata TO atrium_analytics`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA bizdata TO atrium_analytics`,
  ],
  atrium_sales: [
    `GRANT USAGE ON SCHEMA bizdata TO atrium_sales`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA bizdata TO atrium_sales`,
    `GRANT UPDATE (note) ON bizdata.pipeline TO atrium_sales`,
  ],
  // engineering and marketing get CONNECT and nothing else.
  atrium_engineering: [],
  atrium_marketing: [],
};

const main = async () => {
  for (const f of (await readdir(MIG)).sort()) {
    if (!f.endsWith('.sql')) continue;
    await pool.query(await readFile(path.join(MIG, f), 'utf8'));
    console.log('applied', f);
  }
  for (const [role, grants] of Object.entries(ROLES)) {
    await pool.query(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}')
         THEN CREATE ROLE ${role} LOGIN PASSWORD '${role}'; END IF; END $$;`);
    await pool.query(`GRANT CONNECT ON DATABASE ${DB} TO ${role}`);
    await pool.query(`REVOKE ALL ON SCHEMA public FROM ${role}`).catch(() => {});
    for (const g of grants) await pool.query(g);
    console.log('role', role, grants.length ? '(granted)' : '(no data grants)');
  }
  await closeAll();
};
main().catch((e) => { console.error(e); process.exit(1); });
