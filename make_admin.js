/**
 * make_admin.js — Grant admin rights to a user account.
 *
 * Sets users.is_admin = true for the account whose discord_username OR email
 * matches the given identifier (case-insensitive). Run this once after you
 * have signed in via OAuth at least once (so your `users` row exists).
 *
 * This backs the transitional admin gate in
 * backend/src/middleware/requireAdmin.js — once you're an admin, your logged-in
 * session authorizes admin routes without the shared x-admin-token.
 *
 * Usage (from neos-city directory):
 *   node make_admin.js <discord_username|email>
 *
 * Examples:
 *   node make_admin.js gabriel
 *   node make_admin.js gabriel@example.com
 *
 * SQL fallback (Supabase SQL editor):
 *   UPDATE users SET is_admin = true
 *   WHERE LOWER(discord_username) = LOWER('gabriel') OR LOWER(email) = LOWER('gabriel');
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const { Pool } = require('./backend/node_modules/pg');

const identifier = process.argv[2];

if (!identifier) {
  console.error('Usage: node make_admin.js <discord_username|email>');
  console.error('Example: node make_admin.js gabriel');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `UPDATE users
          SET is_admin = true, updated_at = NOW()
        WHERE LOWER(discord_username) = LOWER($1)
           OR LOWER(email) = LOWER($1)
      RETURNING id, email, discord_username, is_admin`,
      [identifier]
    );

    if (rows.length === 0) {
      console.error(`No user found matching "${identifier}" (by discord_username or email).`);
      console.error('Sign in via OAuth (Discord or Google) at least once so your users row exists, then re-run.');
      process.exitCode = 1;
      return;
    }

    console.log(`Granted admin to ${rows.length} user(s):`);
    for (const u of rows) {
      console.log(`  id=${u.id} email=${u.email ?? '—'} discord=${u.discord_username ?? '—'} is_admin=${u.is_admin}`);
    }
  } finally {
    client.release();
  }
}

run()
  .then(() => pool.end())
  .catch(e => { console.error(e.message); pool.end(); process.exit(1); });
