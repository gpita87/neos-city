/**
 * check_users.js
 *
 * Read-only diagnostic for the OAuth login flow. Prints every row in the
 * `users` table with the columns that matter for verifying:
 *   - Step 3: a row was created with the provider id + verified email
 *   - Step 4: a cross-provider merge produced ONE row with both
 *             discord_id AND google_id set (not two rows)
 *
 * Run from the neos-city directory:
 *   node check_users.js
 *
 * SELECT-only — does not mutate anything.
 */

const { Pool } = require('pg');
require('dotenv').config({ path: './backend/.env' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(`
    SELECT id, email, email_verified,
           discord_id, discord_username,
           google_id, display_name,
           player_id, is_admin,
           created_at, updated_at
    FROM users
    ORDER BY id
  `);

  console.log(`\n👤 users table — ${rows.length} row(s)`);
  console.log('═'.repeat(60));
  for (const u of rows) {
    console.log(`\n#${u.id}  ${u.display_name || '(no display name)'}${u.is_admin ? '  ⭐ ADMIN' : ''}`);
    console.log(`   email:        ${u.email || '—'}  (verified: ${u.email_verified})`);
    console.log(`   discord_id:   ${u.discord_id || '—'}${u.discord_username ? `  (@${u.discord_username})` : ''}`);
    console.log(`   google_id:    ${u.google_id || '—'}`);
    console.log(`   player_id:    ${u.player_id ?? '—'}`);
    console.log(`   created:      ${u.created_at?.toISOString?.() || u.created_at}`);
    console.log(`   updated:      ${u.updated_at?.toISOString?.() || u.updated_at}`);
  }

  // Flag the failure mode for Step 4: the same verified email on >1 row means
  // the cross-provider merge did NOT happen (two accounts instead of one).
  const { rows: dupes } = await pool.query(`
    SELECT LOWER(email) AS e, COUNT(*) AS n
    FROM users
    WHERE email IS NOT NULL AND email_verified = TRUE
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  `);
  console.log('\n' + '═'.repeat(60));
  if (dupes.length) {
    console.log('⚠️  Same verified email on multiple rows (merge did NOT happen):');
    for (const d of dupes) console.log(`   ${d.e} → ${d.n} rows`);
  } else {
    console.log('✓ No verified email is split across multiple rows.');
  }
  console.log('');

  await pool.end();
}

main().catch((err) => {
  console.error('check_users failed:', err.message);
  process.exit(1);
});
