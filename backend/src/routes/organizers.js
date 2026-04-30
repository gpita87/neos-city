const express = require('express');
const router = express.Router();
const db = require('../db');
const challonge = require('../services/challonge');
const { detectSeries, SERIES_NAMES } = require('../services/achievements');

// ── Shared helpers ────────────────────────────────────────────────────────────

// Extract a clean slug from a tournament object (v2 JSON:API or v1 plain)
function slugFromTournament(t) {
  const attrs = t.attributes || t.tournament || t;
  const rawUrl = attrs.full_challonge_url || attrs.url || '';
  // full_challonge_url: "https://challonge.com/wise_/ffc12"
  // url: may be just "ffc12" or "/wise_/ffc12"
  const path = rawUrl.replace(/^https?:\/\/challonge\.com\//, '').replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  // Use the last segment as the slug
  return (parts[parts.length - 1] || '').split('#')[0] || String(attrs.id || '');
}

// Build a normalised tournament summary from a raw API object
function normaliseTournament(t, knownOrganizerSet) {
  const attrs = t.attributes || t.tournament || t;
  const slug = slugFromTournament(t);
  const name = attrs.name || '';
  const series = detectSeries(slug, name);
  const fullUrl = attrs.full_challonge_url || attrs.url || '';
  const organizer = challonge.extractOrganizerFromUrl(fullUrl);

  return { slug, name, series, organizer, attrs, fullUrl };
}

// Returns true when a tournament looks like a Pokkén event
function isPokkenTournament(name, series) {
  const n = name.toLowerCase();
  return (
    n.includes('pokk') ||
    n.includes('ferrum') ||
    n.includes('rtg') ||
    n.includes('ffc') ||
    n.includes('dcm') ||
    n.includes('croissant') ||
    n.includes('end of the road') ||
    series !== 'other'
  );
}

// GET /api/organizers — list all tracked organizers
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM organizers ORDER BY added_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organizers — add an organizer to the pool
router.post('/', async (req, res) => {
  const { challonge_username, display_name, notes, challonge_subdomain, slug_patterns } = req.body;
  if (!challonge_username) return res.status(400).json({ error: 'challonge_username required' });

  try {
    const { rows: [org] } = await db.query(
      `INSERT INTO organizers (challonge_username, display_name, notes, challonge_subdomain, slug_patterns)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (challonge_username) DO UPDATE SET
         display_name        = COALESCE(EXCLUDED.display_name, organizers.display_name),
         notes               = COALESCE(EXCLUDED.notes, organizers.notes),
         challonge_subdomain = COALESCE(EXCLUDED.challonge_subdomain, organizers.challonge_subdomain),
         slug_patterns       = COALESCE(EXCLUDED.slug_patterns, organizers.slug_patterns)
       RETURNING *`,
      [challonge_username.toLowerCase(), display_name || challonge_username, notes || null, challonge_subdomain || null, slug_patterns || null]
    );
    res.json(org);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/organizers/:id — remove an organizer
router.delete('/:id', async (req, res) => {
  try {
    await db.query(`DELETE FROM organizers WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organizers/discover — preview what tournaments would be found (dry run)
router.post('/discover', async (req, res) => {
  try {
    const { rows: organizers } = await db.query(`SELECT * FROM organizers`);
    if (organizers.length === 0) return res.json({ tournaments: [] });
    const knownOrganizers = new Set(organizers.map(o => o.challonge_username.toLowerCase()));

    // Tournaments already in our DB
    const { rows: existing } = await db.query(`SELECT challonge_id FROM tournaments`);
    const existingIds = new Set(existing.map(r => r.challonge_id));

    const discovered = [];

    for (const org of organizers) {
      console.log(`Discovering for ${org.challonge_username}…`);
      let slugs;
      try {
        slugs = await challonge.discoverUserTournaments(org.challonge_username, { pages: 5 });
      } catch (err) {
        console.warn(`Scrape failed for ${org.challonge_username}:`, err.message);
        slugs = [];
      }
      if (org.challonge_subdomain) {
        try {
          const subSlugs = await challonge.subdomainTournaments(org.challonge_subdomain);
          slugs = [...new Set([...slugs, ...subSlugs])];
        } catch (err) {
          console.warn(`Subdomain [${org.challonge_subdomain}] failed:`, err.message);
        }
      }

      for (const slug of slugs) {
        const series = detectSeries(slug, slug);
        discovered.push({
          challonge_id: slug, name: slug, series,
          series_name: SERIES_NAMES[series] || 'Other',
          organizer: org.challonge_username,
          completed_at: null, participants_count: null,
          already_imported: existingIds.has(slug)
        });
      }
    }

    // Slug pattern enumeration — collect unique prefixes across all organizers
    const allPrefixes = [
      ...new Set(
        organizers.flatMap(o =>
          (o.slug_patterns || '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean)
        )
      )
    ];
    if (allPrefixes.length > 0) {
      const prefixToOrg = {};
      for (const org of organizers) {
        for (const p of (org.slug_patterns || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
          if (!prefixToOrg[p]) prefixToOrg[p] = org.challonge_username;
        }
      }
      const seenInDiscover = new Set(discovered.map(d => d.challonge_id));
      try {
        const enumSlugs = await challonge.enumerateSlugPatterns(allPrefixes);
        for (const slug of enumSlugs) {
          if (seenInDiscover.has(slug)) continue;
          const series = detectSeries(slug, slug);
          const prefix = allPrefixes.find(p => slug.toLowerCase().startsWith(p));
          discovered.push({
            challonge_id: slug, name: slug, series,
            series_name: SERIES_NAMES[series] || 'Other',
            organizer: prefixToOrg[prefix] || organizers[0].challonge_username,
            completed_at: null, participants_count: null,
            already_imported: existingIds.has(slug)
          });
          seenInDiscover.add(slug);
        }
      } catch (err) {
        console.warn(`Enumeration failed in discover:`, err.message);
      }
    }

    // Sort newest first
    discovered.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

    res.json({
      total: discovered.length,
      new: discovered.filter(t => !t.already_imported).length,
      tournaments: discovered
    });
  } catch (err) {
    console.error('Discover error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organizers/sync — import all NEW tournaments from all organizers
router.post('/sync', async (req, res) => {
  const { dry_run = false, series_filter = null } = req.body;

  try {
    const { rows: organizers } = await db.query(`SELECT * FROM organizers`);
    if (organizers.length === 0) {
      return res.json({ message: 'No organizers added yet.', imported: 0, skipped: 0 });
    }

    const { rows: existing } = await db.query(`SELECT challonge_id FROM tournaments`);
    const existingIds = new Set(existing.map(r => r.challonge_id));
    const knownOrganizers = new Set(organizers.map(o => o.challonge_username.toLowerCase()));

    const results = { imported: [], skipped: [], errors: [] };
    const toImport = [];
    // seenSlugs prevents double-importing the same slug found via multiple methods
    const seenSlugs = new Set(existingIds);

    const addSlug = (slug, organizer) => {
      if (seenSlugs.has(slug)) { results.skipped.push(slug); return; }
      if (series_filter && detectSeries(slug, slug) !== series_filter) return;
      seenSlugs.add(slug);
      toImport.push({ slug, name: slug, series: detectSeries(slug, slug), organizer });
    };

    // ── Phase 1: profile scraping + subdomain API per organizer ──────────────
    console.log(`Syncing ${organizers.length} organizer(s)…`);

    for (const org of organizers) {
      console.log(`Scraping ${org.challonge_username}…`);
      let slugs;
      try {
        slugs = await challonge.discoverUserTournaments(org.challonge_username, { pages: 10 });
        console.log(`  → ${slugs.length} slugs found for ${org.challonge_username}`);
      } catch (scrapeErr) {
        console.warn(`  Scrape failed for ${org.challonge_username}:`, scrapeErr.message);
        results.errors.push({ organizer: org.challonge_username, error: scrapeErr.message });
        slugs = [];
      }

      if (org.challonge_subdomain) {
        try {
          const subSlugs = await challonge.subdomainTournaments(org.challonge_subdomain);
          const before = slugs.length;
          slugs = [...new Set([...slugs, ...subSlugs])];
          console.log(`  → +${slugs.length - before} from subdomain [${org.challonge_subdomain}]`);
        } catch (subErr) {
          console.warn(`  Subdomain [${org.challonge_subdomain}] failed:`, subErr.message);
        }
      }

      for (const slug of slugs) addSlug(slug, org.challonge_username);
    }

    // ── Phase 2: slug pattern enumeration (deduplicated across organizers) ───
    // Collect unique prefixes from all organizers, enumerate each once.
    // Results come back sorted ascending (oldest-first) — correct ELO order.
    const allPrefixes = [
      ...new Set(
        organizers
          .flatMap(o => (o.slug_patterns || '').split(',').map(p => p.trim().toLowerCase()).filter(Boolean))
      )
    ];

    if (allPrefixes.length > 0) {
      console.log(`Enumerating slug patterns: ${allPrefixes.join(', ')}…`);
      try {
        const enumSlugs = await challonge.enumerateSlugPatterns(allPrefixes);
        console.log(`  → ${enumSlugs.length} slugs found via enumeration`);
        // Map each enumerated slug back to its organizer via the prefix
        const prefixToOrg = {};
        for (const org of organizers) {
          for (const p of (org.slug_patterns || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
            if (!prefixToOrg[p]) prefixToOrg[p] = org.challonge_username;
          }
        }
        for (const slug of enumSlugs) {
          const prefix = allPrefixes.find(p => slug.toLowerCase().startsWith(p));
          addSlug(slug, prefixToOrg[prefix] || organizers[0].challonge_username);
        }
      } catch (enumErr) {
        console.warn(`  Enumeration failed:`, enumErr.message);
      }
    }

    if (dry_run) {
      return res.json({ dry_run: true, would_import: toImport, skipped: results.skipped.length });
    }

    // Import each new tournament sequentially (avoid hammering the API)
    for (const { slug, name, series } of toImport) {
      try {
        await importTournamentById(slug);
        results.imported.push({ slug, name, series });
        console.log(`✅ Imported: ${name} (${slug})`);
      } catch (importErr) {
        console.error(`❌ Failed to import ${slug}:`, importErr.message);
        results.errors.push({ slug, name, error: importErr.message });
      }
    }

    // Update last_synced_at for all organizers
    await db.query(`UPDATE organizers SET last_synced_at = NOW()`);

    res.json({
      success: true,
      imported: results.imported.length,
      skipped: results.skipped.length,
      errors: results.errors.length,
      detail: results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared import logic (called by both /sync and /tournaments/import) ────────
async function importTournamentById(challonge_id) {
  // Dynamically require to avoid circular deps
  const tournamentRoute = require('./tournaments');
  // We call the underlying function directly
  return tournamentRoute.importOne(challonge_id);
}

module.exports = router;
