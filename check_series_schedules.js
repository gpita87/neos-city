require('dotenv').config({ path: 'backend/.env' });
const db = require('./backend/src/db');

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

(async () => {
  const series = ['ffc', 'rtg_na', 'rtg_eu', 'dcm', 'tcc', 'eotr', 'nezumi', 'nezumi_rookies', 'ha'];
  for (const s of series) {
    const r = await db.query(`
      SELECT name, started_at, completed_at
      FROM tournaments
      WHERE series = $1 AND is_offline = false
      ORDER BY started_at DESC NULLS LAST
      LIMIT 8
    `, [s]);
    console.log(`\n===== ${s} (${r.rows.length} shown) =====`);
    for (const row of r.rows) {
      const d = row.started_at ? new Date(row.started_at) : null;
      const utcDow = d ? DOW[d.getUTCDay()] : '??';
      const utcTime = d ? d.toISOString().slice(11, 16) : '??';
      const dateStr = d ? d.toISOString().slice(0, 10) : 'NO START';
      console.log(`  ${dateStr} ${utcDow} ${utcTime}Z  ${row.name.trim()}`);
    }
  }
  await db.end();
})().catch(e => { console.error(e); process.exit(1); });
