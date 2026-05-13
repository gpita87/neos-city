const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected DB error:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  // Drain the pool so one-shot scripts can exit. The server itself never
  // calls this — it wants the pool alive for the process lifetime.
  end: () => pool.end(),
};
