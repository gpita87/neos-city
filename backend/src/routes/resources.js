const express = require('express');
const router = express.Router();
const db = require('../db');
const requireAdmin = require('../middleware/requireAdmin');

// GET /api/resources — the curated learning library. Optional filters:
//   ?kind=character_guide|fundamental  ?character=Gardevoir
//   ?skill_level=beginner  ?series=ffc  ?creator_id=3
// The dataset is small, so the frontend can also just fetch all and filter
// client-side; the params exist for flexibility.
router.get('/', async (req, res) => {
  const { kind, character, skill_level, series, creator_id } = req.query;
  const where = [];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$?', `$${params.length}`)); };

  if (kind)        add('r.kind = $?', kind);
  if (character)   add('r.character_name = $?', character);
  if (skill_level) add('r.skill_level = $?', skill_level);
  if (series)      add('r.series = $?', series);
  if (creator_id)  add('r.creator_id = $?', creator_id);

  try {
    const { rows } = await db.query(
      `SELECT r.id, r.title, r.url, r.kind, r.character_name AS character,
              r.skill_level, r.series, r.creator_id, r.added_at,
              c.name AS creator_name
       FROM resources r
       LEFT JOIN creators c ON c.id = r.creator_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY r.kind ASC, r.character_name ASC NULLS LAST, r.title ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/resources — add a resource.
// Body: { title, url, kind, character?, skill_level?, series?, creator_id? }
router.post('/', requireAdmin, async (req, res) => {
  const { title, url, kind, character, skill_level, series, creator_id } = req.body;
  if (!title || !url || !kind) {
    return res.status(400).json({ error: 'title, url and kind are required' });
  }
  try {
    const { rows: [resource] } = await db.query(
      `INSERT INTO resources (title, url, kind, character_name, skill_level, series, creator_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, url, kind, character_name AS character, skill_level, series, creator_id, added_at`,
      [title, url, kind, character || null, skill_level || null, series || null, creator_id || null]
    );
    res.json(resource);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/resources/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
