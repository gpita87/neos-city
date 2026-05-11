const axios = require('axios');

const API_URL = 'https://api.start.gg/gql/alpha';

// ─── GraphQL helper ───────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const token = process.env.STARTGG_TOKEN;
  if (!token) throw new Error('STARTGG_TOKEN is not set in .env');

  const response = await axios.post(
    API_URL,
    { query, variables },
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  if (response.data.errors?.length) {
    throw new Error(`start.gg GQL error: ${response.data.errors[0].message}`);
  }

  return response.data.data;
}

// ─── Fetch a full phase group (bracket) with all sets and tournament metadata ─

async function getPhaseGroup(phaseGroupId) {
  const data = await gql(
    `query GetBracket($id: ID!) {
      phaseGroup(id: $id) {
        id
        displayIdentifier
        phase {
          id
          name
          event {
            id
            name
            numEntrants
            startAt
            tournament {
              id
              name
              slug
              startAt
              endAt
            }
          }
        }
        standings(query: { perPage: 256, page: 1 }) {
          nodes {
            placement
            entrant { id name }
          }
        }
        sets(page: 1, perPage: 64, sortType: STANDARD) {
          pageInfo { total page }
          nodes {
            id
            state
            winnerId
            fullRoundText
            round
            displayScore
            slots {
              entrant { id name }
              standing { stats { score { value } } }
            }
          }
        }
      }
    }`,
    { id: String(phaseGroupId) }
  );
  return data.phaseGroup;
}

// ─── Paginate sets if bracket has more than 64 ────────────────────────────────

async function getAllSets(phaseGroupId) {
  const first = await getPhaseGroup(phaseGroupId);
  const totalPages = first.sets.pageInfo.page || 1;
  const allSets = [...first.sets.nodes];

  for (let page = 2; page <= totalPages; page++) {
    const data = await gql(
      `query GetSetsPage($id: ID!, $page: Int!) {
        phaseGroup(id: $id) {
          sets(page: $page, perPage: 64, sortType: STANDARD) {
            nodes {
              id state winnerId fullRoundText round displayScore
              slots {
                entrant { id name }
                standing { stats { score { value } } }
              }
            }
          }
        }
      }`,
      { id: String(phaseGroupId), page }
    );
    allSets.push(...(data.phaseGroup.sets.nodes || []));
  }

  // Attach the paginated sets back onto the first response object
  return { ...first, sets: { ...first.sets, nodes: allSets } };
}

// ─── Resolve event slug → phase groups ───────────────────────────────────────
//
// Given a slug like "tournament/heaven-s-arena-23/event/heaven-s-arena-23"
// returns the event metadata and all its phases + phase groups so you can pick
// the main bracket and feed its phaseGroupId(s) to getAllSets().

async function getEventBySlug(eventSlug) {
  const data = await gql(
    `query EventPhaseGroups($slug: String!) {
      event(slug: $slug) {
        id
        name
        numEntrants
        startAt
        state
        tournament {
          id
          name
          slug
          startAt
          endAt
        }
        phases {
          id
          name
          numSeeds
          phaseGroups {
            nodes {
              id
              displayIdentifier
            }
          }
        }
      }
    }`,
    { slug: eventSlug }
  );
  return data.event;
}

// ─── URL parser ───────────────────────────────────────────────────────────────
//
// Handles:
//   https://www.start.gg/tournament/heaven-s-arena-20/events/heaven-s-arena-20/brackets/2137102/3113734/overview
//   https://start.gg/tournament/heaven-s-arena-20/events/heaven-s-arena-20/brackets/2137102/3113734
//
// Returns { phaseId, phaseGroupId } or null if the URL doesn't match.

function parseStartggUrl(url = '') {
  const match = url.match(/\/brackets\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { phaseId: match[1], phaseGroupId: match[2] };
}

function isStartggUrl(url = '') {
  return /start\.gg\/tournament\//i.test(url);
}

// ─── Discover recent Pokkén tournaments via the public search ────────────────
//
// Pokkén Tournament's start.gg videogame ID is 447 (verifiable via the search
// UI's `events.videogame.id=447` URL filter). The `tournaments` query supports
// `videogameIds` + `past` + `afterDate`, so we don't need an organizer list.
//
// Yields one URL per phase group on the LAST phase of each Pokkén event in the
// tournament. The "last phase" heuristic picks the final-bracket stage when an
// event has Pools + Top 8; for single-phase events it's just the bracket.
// Multiple phase groups on the same phase (rare, e.g. parallel pools) all get
// emitted — dedup downstream catches anything already imported.

const POKKEN_VIDEOGAME_ID = 447;

async function discoverPokkenTournaments({ sinceDays = 90, perPage = 50, maxPages = 5, sleepMs = 500 } = {}) {
  const afterDate = Math.floor((Date.now() - sinceDays * 24 * 60 * 60 * 1000) / 1000);
  const out = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await gql(
      `query SearchPokken($videogameIds: [ID]!, $afterDate: Timestamp, $perPage: Int!, $page: Int!) {
        tournaments(query: {
          perPage: $perPage
          page: $page
          filter: {
            videogameIds: $videogameIds
            afterDate: $afterDate
            past: true
          }
        }) {
          pageInfo { totalPages page }
          nodes {
            id
            slug
            name
            startAt
            events {
              id
              slug
              name
              numEntrants
              videogame { id }
              phases {
                id
                name
                phaseGroups(query: { perPage: 20 }) {
                  nodes { id displayIdentifier }
                }
              }
            }
          }
        }
      }`,
      { videogameIds: [POKKEN_VIDEOGAME_ID], afterDate, perPage, page }
    );

    const nodes = data?.tournaments?.nodes || [];
    for (const t of nodes) {
      // Filter events to Pokkén client-side — server-side `events(filter:)`
      // schema has varied across start.gg API versions; client-side check is
      // safer and the response set is small.
      const pokkenEvents = (t.events || []).filter(
        ev => Number(ev?.videogame?.id) === POKKEN_VIDEOGAME_ID
      );
      for (const ev of pokkenEvents) {
        const phases = ev.phases || [];
        if (phases.length === 0) continue;
        const lastPhase = phases[phases.length - 1];
        const groups = lastPhase.phaseGroups?.nodes || [];
        for (const g of groups) {
          // Convert API event slug "tournament/X/event/Y" to URL form "tournament/X/events/Y"
          const urlSlug = String(ev.slug || '').replace('/event/', '/events/');
          if (!urlSlug) continue;
          out.push({
            phaseGroupId:   String(g.id),
            phaseId:        String(lastPhase.id),
            tournamentSlug: t.slug,
            eventSlug:      ev.slug,
            name:           `${t.name} — ${ev.name}`,
            startAt:        t.startAt,
            numEntrants:    ev.numEntrants,
            url: `https://www.start.gg/${urlSlug}/brackets/${lastPhase.id}/${g.id}`,
          });
        }
      }
    }

    const totalPages = data?.tournaments?.pageInfo?.totalPages || 1;
    if (page >= totalPages) break;
    if (sleepMs) await new Promise(r => setTimeout(r, sleepMs));
  }

  return out;
}

module.exports = {
  getPhaseGroup,
  getAllSets,
  getEventBySlug,
  parseStartggUrl,
  isStartggUrl,
  discoverPokkenTournaments,
  POKKEN_VIDEOGAME_ID,
};
