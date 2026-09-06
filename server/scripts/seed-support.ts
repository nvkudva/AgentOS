import { pool, closeAll } from '../src/db.js';

const SUBJECTS: [string, string, string][] = [
  ['Invoice shows the wrong VAT rate', 'Our March invoice charges 20% but we are registered in Ireland.', 'urgent'],
  ['Cannot add a second seat', 'The add-seat button does nothing on the team plan.', 'urgent'],
  ['Export stops at 1000 rows', 'CSV export truncates. We have 4,300 orders to pull.', 'normal'],
  ['SSO redirect loop', 'Signing in through Okta bounces back to the login page.', 'urgent'],
  ['Change billing contact', 'Please move invoices to finance@ rather than my address.', 'low'],
  ['Refund for a duplicate charge', 'We were billed twice on the 3rd.', 'normal'],
  ['API rate limit unclear', 'Docs say 60/min, we see 429s at about 40.', 'normal'],
  ['Delete an old workspace', 'We want the 2023 workspace removed for good.', 'low'],
];

const n = (await pool.query('SELECT count(*)::int c FROM support.ticket')).rows[0].c;
if (n) { console.log('tickets already seeded'); }
else {
  for (let i = 0; i < SUBJECTS.length; i++) {
    const [subject, body, priority] = SUBJECTS[i];
    await pool.query(
      `INSERT INTO support.ticket (customer_id, subject, body, priority, opened_at)
       VALUES ($1,$2,$3,$4, current_date - $5::int)`,
      [1 + Math.floor(Math.random() * 120), subject, body, priority, SUBJECTS.length - i]);
  }
  console.log(`seeded ${SUBJECTS.length} support tickets`);
}
await closeAll();
