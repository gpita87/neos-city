#!/usr/bin/env node
/**
 * Seed the achievements table with all v3 achievement definitions.
 * Run AFTER the achievement_revamp.sql migration.
 *
 * Usage:  node seed_achievements_v3.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });
const { Pool } = require('pg');
const { ACHIEVEMENTS } = require('./backend/src/services/achievements');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  console.log(`Seeding ${ACHIEVEMENTS.length} achievements...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert every achievement
    for (const a of ACHIEVEMENTS) {
      await client.query(
        `INSERT INTO achievements (id, name, description, icon, category, series)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           icon = EXCLUDED.icon,
           category = EXCLUDED.category,
           series = EXCLUDED.series`,
        [a.id, a.name, a.description, a.icon, a.category, a.scope === 'global' ? null : a.scope]
      );
    }

    await client.query('COMMIT');
    console.log(`Done — ${ACHIEVEMENTS.length} achievements seeded.`);

    // Show breakdown
    const pass1 = ACHIEVEMENTS.filter(a => a.pass === 1).length;
    const pass2 = ACHIEVEMENTS.filter(a => a.pass === 2).length;
    console.log(`  Pass 1 (stat-based): ${pass1}`);
    console.log(`  Pass 2 (query-based): ${pass2}`);

    const cats = {};
    for (const a of ACHIEVEMENTS) {
      cats[a.category] = (cats[a.category] || 0) + 1;
    }
    console.log(`  Categories:`, cats);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
