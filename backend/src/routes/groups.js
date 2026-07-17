// Pokkén in-game Groups (lobbies) + per-user memberships.
//
// Players record which Groups they belong to so the Arena match panel can show
// which ones a pairing shares (that's where the set actually gets played).
// The game caps active memberships at ~6, enforced here app-level (transaction
// + count) per the codebase convention — see add_arena.sql.
//
// Public:      GET /                (active groups; admins may ?include_inactive=1)
// requireAuth: GET /mine, PUT /mine {group_ids: []}  (full-replace, max 6)
// requireAdmin: POST /, PATCH /:id  (incl. the `active` flag)

const express = require('express');
const db = require('../db');
const { requireAuth, attachUser } = require('../middleware/requireAuth');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

const MAX_GROUPS = 6;

// Pure normalization for PUT /mine input — unit-tested in backend/tests.
// Dedupes, rejects non-positive-integer entries, enforces the membership cap.
// Returns { ids } on success or { error } for a 400.
function normalizeGroupIds(raw) {
  if (!Array.isArray(raw)) return { error: 'group_ids must be an array' };
  const ids = [];
  for (const v of raw) {
    const id = Number(v);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: 'group_ids must be positive integers' };
    }
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_GROUPS) {
    return { error: `You can be in at most ${MAX_GROUPS} groups (the in-game cap)` };
  }
  return { ids };
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/groups — active groups (everyone). Admins may pass
// ?include_inactive=1 to also see deactivated ones for the CRUD panel.
router.get('/', attachUser, async (req, res) => {
  try {
    const includeInactive = Boolean(req.user?.is_admin && req.query.include_inactive);
    const { rows: groups } = await db.query(
      `SELECT g.id, g.name, g.is_official, g.ruleset, g.active,
              COUNT(ug.user_id)::int AS member_count
       FROM pokken_groups g
       LEFT JOIN user_groups ug ON ug.group_id = g.id
       ${includeInactive ? '' : 'WHERE g.active'}
       GROUP BY g.id
       ORDER BY g.is_official DESC, g.name ASC`
    );
    res.json({ groups });
  } catch (err) {
    console.error('[groups] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load groups' });
  }
});

// GET /api/groups/mine — the caller's memberships. Deactivated groups still
// appear (the user is still in them in-game) so they can be dropped.
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows: groups } = await db.query(
      `SELECT g.id, g.name, g.is_official, g.ruleset, g.active
       FROM user_groups ug
       JOIN pokken_groups g ON g.id = ug.group_id
       WHERE ug.user_id = $1
       ORDER BY g.name ASC`,
      [req.user.id]
    );
    res.json({ groups });
  } catch (err) {
    console.error('[groups] mine failed:', err.message);
    res.status(500).json({ error: 'Failed to load your groups' });
  }
});

// PUT /api/groups/mine  { group_ids: [] } — full-replace semantics: the list
// sent IS the new membership set. Max 6 + existence check inside a transaction
// so a concurrent save can't slip past the cap.
router.put('/mine', requireAuth, async (req, res) => {
  const { ids, error } = normalizeGroupIds(req.body?.group_ids);
  if (error) return res.status(400).json({ error });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (ids.length) {
      const { rows } = await client.query(
        `SELECT id FROM pokken_groups WHERE id = ANY($1::int[]) AND active`,
        [ids]
      );
      if (rows.length !== ids.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more groups do not exist or are inactive' });
      }
    }
    await client.query(`DELETE FROM user_groups WHERE user_id = $1`, [req.user.id]);
    if (ids.length) {
      await client.query(
        `INSERT INTO user_groups (user_id, group_id)
         SELECT $1, unnest($2::int[])`,
        [req.user.id, ids]
      );
    }
    await client.query('COMMIT');

    const { rows: groups } = await db.query(
      `SELECT g.id, g.name, g.is_official, g.ruleset, g.active
       FROM user_groups ug
       JOIN pokken_groups g ON g.id = ug.group_id
       WHERE ug.user_id = $1
       ORDER BY g.name ASC`,
      [req.user.id]
    );
    res.json({ groups });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[groups] save mine failed:', err.message);
    res.status(500).json({ error: 'Failed to save your groups' });
  } finally {
    client.release();
  }
});

// ── Admin CRUD ───────────────────────────────────────────────────────────────

// POST /api/groups — create a group
router.post('/', requireAdmin, async (req, res) => {
  const { name, is_official, ruleset, capacity, active } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (ruleset !== undefined && (typeof ruleset !== 'object' || ruleset === null || Array.isArray(ruleset))) {
    return res.status(400).json({ error: 'ruleset must be an object' });
  }
  try {
    const { rows: [group] } = await db.query(
      `INSERT INTO pokken_groups (name, is_official, ruleset, capacity, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        String(name).trim(),
        is_official === undefined ? true : Boolean(is_official),
        JSON.stringify(ruleset ?? {}),
        capacity == null ? null : Number(capacity),
        active === undefined ? true : Boolean(active),
        req.user?.id ?? null,
      ]
    );
    res.status(201).json({ group });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name already exists' });
    console.error('[groups] create failed:', err.message);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PATCH /api/groups/:id — partial update, incl. the `active` flag.
// Deactivating hides a group from pickers and shared-group lookups but keeps
// memberships intact (reactivating restores them).
router.patch('/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid group id' });
  const { name, is_official, ruleset, capacity, active } = req.body || {};

  const sets = [];
  const vals = [];
  const push = (sql, v) => { vals.push(v); sets.push(`${sql} = $${vals.length}`); };
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
    push('name', String(name).trim());
  }
  if (is_official !== undefined) push('is_official', Boolean(is_official));
  if (ruleset !== undefined) {
    if (typeof ruleset !== 'object' || ruleset === null || Array.isArray(ruleset)) {
      return res.status(400).json({ error: 'ruleset must be an object' });
    }
    push('ruleset', JSON.stringify(ruleset));
  }
  if (capacity !== undefined) push('capacity', capacity == null ? null : Number(capacity));
  if (active !== undefined) push('active', Boolean(active));
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  try {
    vals.push(id);
    const { rows: [group] } = await db.query(
      `UPDATE pokken_groups SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A group with that name already exists' });
    console.error('[groups] update failed:', err.message);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

module.exports = router;
module.exports.normalizeGroupIds = normalizeGroupIds;
module.exports.MAX_GROUPS = MAX_GROUPS;
