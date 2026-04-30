/**
 * run_migration.js — Run a SQL migration file against the Supabase DB.
 *
 * Usage (from neos-city directory):
 *   node run_migration.js backend/src/db/migrations/add_offline_tiers.sql
 */

require('./backend/node_modules/dotenv').config({ path: './backend/.env' });
const fs = require('fs');
const { Pool } = require('./backend/node_modules/pg');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node run_migration.js <path-to-sql-file>');
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(sql)
  .then(() => { console.log(`Migration complete: ${file}`); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); process.exit(1); });
