/*
 * The European Parliament's open data portal.
 *
 *   https://data.europarl.europa.eu/api/v2
 *
 * Everything this project imports comes from here. The Parliament's public
 * website answers automated requests with an empty 202 — a bot wall — so the
 * portal is not a convenience but the only door. It answers JSON-LD, without a
 * key, without a quota, under the Commission's reuse decision.
 *
 * Three endpoints carry the whole project:
 *
 *   /meetings?year=YYYY                       every sitting day of a year
 *   /meetings/MTG-PL-{date}/decisions         every decision taken that day,
 *                                             each roll-call carrying the lists
 *                                             had_voter_favor, _against and
 *                                             _abstention: one person id per
 *                                             member who voted that way
 *   /meps/show-current                        the sitting members, each with a
 *                                             country and a political group
 *
 * A decision also names the vote item it belongs to, and the item names the
 * report and the procedure, which is how a record ends up with a readable title
 * and a link back to the file it came from.
 */

const BASE = 'https://data.europarl.europa.eu/api/v2';
const AGENT = 'eu-tracker/0.1 (open data import; https://github.com/volters-cell/We-Volt)';

/* The portal writes group names its own way. These are the forms the interface
   uses; anything unrecognised passes through so a new group is visible rather
   than silently folded into another. */
const GROUPS = {
  ppe: 'EPP', epp: 'EPP',
  's&d': 'S&D', sd: 'S&D',
  pfe: 'PfE', ecr: 'ECR', renew: 'Renew', re: 'Renew',
  'verts/ale': 'Greens/EFA', verts: 'Greens/EFA', 'greens/efa': 'Greens/EFA',
  'the left': 'The Left', 'gue/ngl': 'The Left',
  esn: 'ESN', ni: 'NI'
};

/* Memberships name a country by its three-letter authority code. Greece is EL
   in the Parliament's documents and GR here, as everywhere else in this app. */
const ISO3 = {
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK',
  EST: 'EE', FIN: 'FI', FRA: 'FR', DEU: 'DE', GRC: 'GR', HUN: 'HU', IRL: 'IE',
  ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL', POL: 'PL',
  PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE'
};

const CODE_FIXES = { EL: 'GR', UK: null, GB: null };

export const PORTAL = BASE;

export function normaliseGroup(label) {
  if (!label) return null;
  const key = String(label).trim().toLowerCase();
  return GROUPS[key] || String(label).trim();
}

export function countryCode(value) {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase();
  if (ISO3[raw]) return ISO3[raw];
  if (Object.prototype.hasOwnProperty.call(CODE_FIXES, raw)) return CODE_FIXES[raw];
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

/* "person/197628" and ".../country/FRA" both mean their last segment. */
export function lastSegment(value) {
  const text = String(value || '');
  const cut = text.lastIndexOf('/');
  return cut === -1 ? text : text.slice(cut + 1);
}

/* One language out of the two dozen the portal returns. English where there is
   one — these become the titles a reader sees. */
export function english(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.en || value.mul || value.fr || Object.values(value)[0] || '');
}

/* The portal answers 429 to a client that asks as fast as a script can. One
   request at a time, a quarter-second apart, is well inside what it tolerates
   and still walks a whole term in a couple of minutes. */
const PACE = 250;
let lastCall = 0;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitTurn() {
  const wait = lastCall + PACE - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

export async function get(pathname, params) {
  const url = new URL(BASE + pathname);
  url.searchParams.set('format', 'application/ld+json');
  Object.entries(params || {}).forEach(function (entry) {
    if (entry[1] !== undefined && entry[1] !== null) url.searchParams.set(entry[0], String(entry[1]));
  });

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await waitTurn();
      const response = await fetch(url, {
        headers: { accept: 'application/ld+json', 'user-agent': AGENT },
        redirect: 'follow'
      });
      if (response.status === 404) return null; // nothing recorded there
      if (response.status === 429 || response.status >= 500) {
        // Being asked to slow down is not a failure; it is an instruction.
        const after = Number(response.headers.get('retry-after'));
        throw Object.assign(new Error(`${url.pathname} responded ${response.status}`),
          { after: Number.isFinite(after) && after > 0 ? after * 1000 : 0 });
      }
      if (!response.ok) throw Object.assign(new Error(`${url.pathname} responded ${response.status}`), { fatal: true });

      // A year the Parliament has not scheduled yet comes back 200 with an
      // empty body. That is an answer — nothing recorded — not a failure.
      const body = (await response.text()).trim();
      if (!body) return null;
      try {
        return JSON.parse(body);
      } catch (error) {
        throw Object.assign(new Error(`${url.pathname} answered ${body.length} bytes that are not JSON`), { fatal: true });
      }
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
      await sleep(error.after || 1000 * Math.pow(2, attempt + 1));
    }
  }
  throw lastError;
}

/* The portal pages at a few hundred records; ask until a page comes back short.
   Not every endpoint honours offset, and one that ignores it hands back the
   same page for ever — which is a loop that ends when the machine runs out of
   memory, not when the data does. So a page that starts where the last one
   started is the end of the data, whatever its length says. */
const PAGE_LIMIT = 40;

export async function getAll(pathname, params, pageSize) {
  const size = pageSize || 500;
  const rows = [];
  let previousFirst = null;

  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const payload = await get(pathname, { ...(params || {}), limit: size, offset: page * size });
    const batch = (payload && payload.data) || [];
    if (!batch.length) return rows;

    const first = batch[0] && (batch[0].id || batch[0].activity_id);
    if (previousFirst !== null && first === previousFirst) return rows;
    previousFirst = first;

    rows.push(...batch);
    if (batch.length < size) return rows;
  }

  console.warn(`${pathname}: stopped after ${PAGE_LIMIT} pages — the portal kept sending more.`);
  return rows;
}

/* ------------------------------------------------------------- the members */

/* Bulk first: one request returns every sitting member with their country and
   group. Then the term's full list, which includes those who have since left —
   they voted, so their ballots need a name too. Those few are looked up one by
   one, where the country is on the parliamentary mandate itself. */
export async function fetchMembers(term, options) {
  const known = (options && options.known) || {};
  const members = {};

  const current = await getAll('/meps/show-current', {}, 1000);
  current.forEach(function (row) {
    const id = String(row.identifier || lastSegment(row.id));
    members[id] = {
      name: row.label || `${row.givenName || ''} ${row.familyName || ''}`.trim(),
      country: countryCode(row['api:country-of-representation']),
      group: normaliseGroup(row['api:political-group']),
      party: (known[id] && known[id].party) || null
    };
  });

  const term_ = await getAll('/meps', { 'parliamentary-term': term }, 1000);
  const missing = term_.filter(function (row) {
    return !members[String(row.identifier || lastSegment(row.id))];
  });

  for (const row of missing) {
    const id = String(row.identifier || lastSegment(row.id));
    const previous = known[id] || {};
    let country = previous.country || null;
    try {
      const detail = await get(`/meps/${id}`, {});
      const person = (detail && detail.data && detail.data[0]) || null;
      const mandate = ((person && person.hasMembership) || []).find(function (membership) {
        return membership.role === 'def/ep-roles/MEMBER_PARLIAMENT' && membership.represents;
      });
      if (mandate) country = countryCode(lastSegment([].concat(mandate.represents)[0])) || country;
    } catch (error) {
      // keep whatever was already known about them
    }
    members[id] = {
      name: row.label || previous.name || id,
      country: country,
      // A former member's group is not in the bulk record; the previous
      // directory is the only place it survives.
      group: previous.group || null,
      party: previous.party || null,
      former: true
    };
  }

  return members;
}

/* -------------------------------------------------------------- the votes */

export const ROLLCALL = 'def/ep-decision-methods/VOTE_ELECTRONIC_ROLLCALL';

export function isRollCall(decision) {
  if (!decision) return false;
  if (decision.decision_method === ROLLCALL) return true;
  return Boolean(decision.had_voter_favor || decision.had_voter_against || decision.had_voter_abstention);
}

/* A decision's ballots, as [person id, position] with position indexed into
   ['for','against','abstain','absent'] — the compact form the site reads. */
export function ballotsOf(decision) {
  const ballots = [];
  [['had_voter_favor', 0], ['had_voter_against', 1], ['had_voter_abstention', 2]].forEach(function (pair) {
    [].concat(decision[pair[0]] || []).forEach(function (voter) {
      const id = Number(lastSegment(voter));
      if (Number.isFinite(id)) ballots.push([id, pair[1]]);
    });
  });
  return ballots.sort(function (a, b) { return a[0] - b[0]; });
}

export function tallyOf(decision) {
  const count = function (field, stated) {
    if (Number.isFinite(decision[stated])) return decision[stated];
    return [].concat(decision[field] || []).length;
  };
  return {
    for: count('had_voter_favor', 'number_of_votes_favor'),
    against: count('had_voter_against', 'number_of_votes_against'),
    abstain: count('had_voter_abstention', 'number_of_votes_abstention')
  };
}
