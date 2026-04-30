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
        sets(page: 1, perPage: 64, sortType: STANDARD) {
          pageInfo { total page }
          nodes {
            id
            state
            winnerId
            fullRoundText
            round
            slots {
              standing { placement }
              entrant { id name }
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
              id state winnerId fullRoundText round
              slots {
                standing { placement }
                entrant { id name }
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

module.exports = { getPhaseGroup, getAllSets, getEventBySlug, parseStartggUrl, isStartggUrl };
