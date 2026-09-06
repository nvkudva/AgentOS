import { pool, closeAll } from '../src/db.js';
import { append } from '../src/events.js';
await pool.query(`UPDATE agent SET state='idle', activity='', current_run_id=NULL, steps_used=0, spent_cents=0`);
await pool.query(`UPDATE room SET status='open'`);
await pool.query(`UPDATE approval SET state='expired', decided_at=now() WHERE state='pending'`);
// Logged like everything else, so the replay fold still matches the tables afterwards.
await append({ type: 'admin.reset', payload: { by: 'operator' } });
console.log('agents reset');
await closeAll();
