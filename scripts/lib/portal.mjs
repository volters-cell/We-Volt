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

import { committeeOf } from './committees.mjs';

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

/* The day a meeting sat.

   Not simply meeting.activity_date. The portal spells that field two ways and
   which one it uses depends on the year: a 2020 meeting carries a plain
   activity_date, a 2019 meeting carries the same value under its JSON-LD name,
   "eli-dl:activity_date", wrapped in an object. Reading only the plain
   spelling makes every one of the 52 plenary meetings of 2019 look undated,
   and a fetcher that drops undated meetings then reports that the Parliament
   did not sit that year. This project made exactly that report, and repeated
   it, until HowTheyVote's archive contradicted it.

   So the identifier is the last word. A meeting is addressed MTG-PL-YYYY-MM-DD
   and names its own day; across the 51 meetings of 2020, where both the field
   and the identifier are present, the two never disagree. */
export function meetingDate(meeting) {
  if (!meeting) return null;

  const plain = meeting.activity_date;
  if (typeof plain === 'string' && plain.length >= 10) return plain.slice(0, 10);

  const tagged = meeting['eli-dl:activity_date'];
  const value = tagged && typeof tagged === 'object' ? tagged['@value'] : tagged;
  if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);

  const named = /\d{4}-\d{2}-\d{2}/.exec(String(meeting.activity_id || meeting.id || ''));
  return named ? named[0] : null;
}

/* One language out of the two dozen the portal returns. English where there is
   one — these become the titles a reader sees. */
export function english(value) {
  if (!value) return '';
  if (typeof value === 'string') return absent(value) ? '' : value;
  // A language whose label says "null" is not an answer, so the next one gets
  // its turn — an English "null" beside a real French title should not throw
  // the French title away.
  const spoken = [value.en, value.mul, value.fr, ...Object.values(value)]
    .map(function (entry) { return typeof entry === 'string' ? entry.trim() : ''; })
    .find(function (entry) { return entry && !absent(entry); });
  return spoken || '';
}

/* The portal sometimes serves the word "null" where a label should be, as text
   rather than as an empty field. Fifty-eight votes reached the site titled
   "null" that way — their real subject sitting in the subtitle, because the
   decision's own label had it all along and the item's label won by being
   first. A label that says "null" is a missing label, and saying so here lets
   every fallback behind it work as intended. */
function absent(text) {
  return /^(?:null|undefined)$/i.test(String(text).trim());
}

/* The portal answers 429 to a client that asks as fast as a script can. One
   request at a time, a quarter-second apart, is well inside what it tolerates
   and still walks a whole term in a couple of minutes. */
const PACE = 250;
const REQUEST_TIMEOUT = 45000;
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
        redirect: 'follow',
        // A request that hangs is worse than one that fails. The portal's
        // gateway can take minutes to give up on a slow endpoint, and five
        // attempts at that is a fifth of an hour spent on one sitting — which
        // is how a backfill of a whole year died on 5 October 2020. Give up
        // early and let the retry decide.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT)
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
/* org/5151 -> "GUE/NGL".

   A whole term is a dozen or so of these between several hundred members, so
   they are looked up once and remembered. A miss is remembered too: a null
   here means the portal had nothing, and asking it again for every member who
   sat in that group would cost hundreds of requests to learn the same thing. */
const groupNames = new Map();

export async function groupName(organization) {
  const id = lastSegment(String(organization || ''));
  if (!id) return null;
  if (groupNames.has(id)) return groupNames.get(id);

  let name = null;
  try {
    const answer = await get(`/corporate-bodies/${id}`, {});
    const row = (answer && answer.data && answer.data[0]) || answer;
    // label is the short form — "GUE/NGL", "Renew" — which is what the bulk
    // list gives for a sitting member, so both paths agree.
    if (row && row.label) name = normaliseGroup(english(row.label));
  } catch (error) {
    name = null;
  }
  groupNames.set(id, name);
  return name;
}

/* A9-0203/2020 -> the title of the report it names.

   The ninth term's decisions are labelled "A9-0018/2021 - Lara Wolters -
   Recital O/2 09/03/2021 16:47:58.618" — the report, the rapporteur, the part
   voted on and the second it happened, and nothing about the subject. The
   subject is published, but on the document, not the vote.

   A sitting turns on a handful of reports between a hundred or more votes, so
   these are looked up once and remembered, misses included, exactly as the
   group names are.

   title_dcterms, not title: the portal has no "title" field here, and reading
   the one that does not exist is why an earlier probe reported the documents
   as untitled. */
const documentTitles = new Map();

export function documentPath(reference) {
  // A joint motion is written RC-B9-0006/2019, so the kind may carry a prefix.
  const match = /^([A-Z]+(?:-[A-Z]+)?)(\d{1,2})-(\d{4})\/(\d{4})$/
    .exec(String(reference || '').trim());
  return match ? `${match[1]}-${match[2]}-${match[4]}-${match[3]}` : null;
}

/* English if the portal has it, and only then anything else.

   english() falls through to French and then to whatever is first, which is
   right for a label that must say something and wrong for choosing between two
   published titles. A vote item often carries its short name in French alone
   while the document carries a full one in English; taking the first source
   rather than the best English one is how 1,088 votes came to be titled in a
   language this site is not written in. */
export function englishOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const found = value.en;
  return typeof found === 'string' ? found.trim() : '';
}

export async function documentTitle(reference) {
  const pathname = documentPath(reference);
  if (!pathname) return null;
  if (documentTitles.has(pathname)) return documentTitles.get(pathname);

  let title = null;
  try {
    const answer = await get(`/documents/${pathname}`, {});
    const row = (answer && answer.data && answer.data[0]) || null;
    title = (row && (englishOnly(row.title_dcterms) || english(row.title_dcterms))) || null;
  } catch (error) {
    title = null;
  }
  documentTitles.set(pathname, title);
  return title;
}

/* Which committee wrote a report, cached like the titles beside it. */
const documentCommittees = new Map();

export async function documentCommittee(reference) {
  const pathname = documentPath(reference);
  if (!pathname) return null;
  if (documentCommittees.has(pathname)) return documentCommittees.get(pathname);

  let code = null;
  try {
    const answer = await get(`/documents/${pathname}`, {});
    const row = (answer && answer.data && answer.data[0]) || null;
    code = row ? committeeOf(row.creator) : null;
  } catch (error) {
    code = null;
  }
  documentCommittees.set(pathname, code);
  return code;
}

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
    let group = previous.group || null;
    try {
      const detail = await get(`/meps/${id}`, {});
      const person = (detail && detail.data && detail.data[0]) || null;
      const memberships = [].concat((person && person.hasMembership) || []);

      const mandate = memberships.find(function (membership) {
        return membership.role === 'def/ep-roles/MEMBER_PARLIAMENT' && membership.represents;
      });
      if (mandate) country = countryCode(lastSegment([].concat(mandate.represents)[0])) || country;

      /* And which group they sat with.

         A sitting member's group arrives in the bulk list. A former member's
         does not, and the cached directory only knows the ones this project
         has already seen — so backfilling an earlier term would have given
         every member who has since left a group of null, and "how each
         political group split" is most of what this site is for.

         Three things about this were read off the portal by
         scripts/probe-member-shape.mjs rather than assumed, and the first
         guess at all three was wrong:

           the classification is EU_POLITICAL_GROUP, and NATIONAL_POLITICAL_GROUP
           sits right beside it on the same person — that one is the party they
           were elected for, not the group they sat with, and matching loosely
           on "POLITICAL_GROUP" catches both;

           the membership carries no name at all. "organization" is an opaque
           org/5151, so lifting its last segment would have filed people under
           the group "5151";

           and org/5151 resolves at /corporate-bodies/5151 — the numeric id
           alone; three other shapes return nothing — to a record whose label
           is "GUE/NGL", which is the short form this project already uses.

         A group is versioned by period, so a member who sat through a renaming
         has more than one membership. The latest start date is the group they
         ended the term in, which is the one figure a single stored group can
         honestly be. */
      const seats = memberships
        .filter(function (membership) {
          return /EU_POLITICAL_GROUP/.test(String(membership.membershipClassification || ''));
        })
        .sort(function (a, b) {
          const at = (a.memberDuring && a.memberDuring.startDate) || '';
          const bt = (b.memberDuring && b.memberDuring.startDate) || '';
          return at < bt ? -1 : at > bt ? 1 : 0;
        });
      const seat = seats[seats.length - 1];
      if (seat) group = (await groupName(seat.organization)) || group;
    } catch (error) {
      // keep whatever was already known about them
    }
    members[id] = {
      name: row.label || previous.name || id,
      country: country,
      group: group,
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
