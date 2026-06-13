#!/usr/bin/env node
/**
 * set_mtm_series.js — one-shot: reclassify "Mid Tier Mayhem" from the catch-all
 * 'other' series (which the UI badges as "Local") to its own 'mtm' series.
 *
 * Tournament 1068 is already online (is_offline=false, source=startgg); this only
 * changes the `series` field so it stops reading as a local and gets the indigo
 * "Mid Tier Mayhem" badge wired into the frontend in this same change.
 *
 * detectSeries() in backend/src/services/achievements.js now maps "Mid Tier Mayhem"
 * → 'mtm', so future re-imports stay classified — this script just fixes the
 * existing row. Idempotent: safe to re-run (no-op once series is already 'mtm').
 *
 * Usage:  node set_mtm_series.js
 */

require('dotenv').config({ path: require('path').join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: before } = await pool.query(
      `SELECT id, name, source, is_offline, series
         FROM tournaments
        WHERE id = 1068 AND name ILIKE 'Mid Tier Mayhem'`
    );
    if (!before.length) {
      console.log('No tournament matched (id=1068, name "Mid Tier Mayhem"). Nothing changed.');
      return;
    }
    console.log('Before:', before[0]);

    const { rows: after } = await pool.query(
      `UPDATE tournaments
          SET series = 'mtm'
        WHERE id = 1068 AND name ILIKE 'Mid Tier Mayhem'
      RETURNING id, name, source, is_offline, series`
    );
    console.log('After: ', after[0]);
    console.log(after[0].series === 'mtm'
      ? '✅ Mid Tier Mayhem is now series=mtm (online, no longer "Local").'
      : '⚠️  Update did not take — check the row manually.');
  } finally {
    await pool.end();
  }
})();
