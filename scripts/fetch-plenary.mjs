#!/usr/bin/env node
/*
 * Import roll-call votes straight from the European Parliament.
 *
 *   node scripts/fetch-plenary.mjs --date 2026-09-15        one sitting
 *   node scripts/fetch-plenary.mjs --since 2026-09-01       every sitting since
 *   node scripts/fetch-plenary.mjs --date 2026-09-15 --all  amendments too
 *   node scripts/fetch-plenary.mjs --date 2026-09-15 --dry-run
 *   node scripts/fetch-plenary.mjs --date 2026-09-15 --inspect
 *   node scripts/fetch-plenary.mjs --file annex.xml         a saved annex
 *
 * Two documents make a record:
 *
 *   1. The roll-call annex for a sitting, published with the minutes:
 *      https://www.europarl.europa.eu/doceo/document/PV-{term}-{date}-RCV_FR.xml
 *      It carries every vote of that day, and for each one the name and
 *      political group of every member who voted for, against or abstained.
 *
 *   2. The MEP directory, which is what turns those names into countries:
 *      https://www.europarl.europa.eu/meps/en/directory/xml/?leg={term}
 *      Cached in data/reference/meps.json and refreshed with --refresh-meps.
 *
 * The annex does not say whether a text was adopted, only how many voted each
 * way, so the result here is derived: more for than against carries an ordinary
 * vote. Votes needing an absolute majority are the exception, and every
 * imported record says in its dataNote that the result was derived this way.
 *
 * Nothing about the cost or the press is ever generated. Those are editorial.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseXML, findAll, find, outline } from './lib/xml.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TERM = 10; // 2024–2029
const TERM_START = '2024-07-16'; // the constitutive sitting after the June 2024 elections
const POSITIONS = ['for', 'against', 'abstain', 'absent'];
const MEP_CACHE = 'data/reference/meps.json';

/* The same roll-call annex is published at more than one address, in more than
   one language. English first — the descriptions become the record's titles —
   then French, then the document register, which sometimes has the file before
   the document server does. */
const ANNEX_URLS = (term, date) => {
  const [year, month, day] = date.split('-');
  return [
    `https://www.europarl.europa.eu/doceo/document/PV-${term}-${date}-RCV_EN.xml`,
    `https://www.europarl.europa.eu/doceo/document/PV-${term}-${date}-RCV_FR.xml`,
    'https://www.europarl.europa.eu/RegData/seance_pleniere/proces_verbal/' +
      `${year}/${month}-${day}/liste_presence/P${term}_PV(${year})${month}-${day}(RCV)_XC.xml`
  ];
};

/* The votes list carries the Parliament's own statement of what carried and
   what fell. It is published a day or more after the sitting, so a same-day
   import derives the result and a later run corrects it. */
const VOT_URL = (term, date) =>
  `https://www.europarl.europa.eu/doceo/document/PV-${term}-${date}-VOT_EN.xml`;

const DIRECTORY_URL = (term) =>
  `https://www.europarl.europa.eu/meps/en/directory/xml/?leg=${term}`;

const CALENDAR_FILE = 'data/reference/plenary-calendar.json';

/* Country names as the directory writes them, to the codes this project uses.
   Greece is EL in the Parliament's own documents and GR here. */
const COUNTRIES = {
  austria: 'AT', belgium: 'BE', bulgaria: 'BG', croatia: 'HR', cyprus: 'CY',
  czechia: 'CZ', 'czech republic': 'CZ', denmark: 'DK', estonia: 'EE',
  finland: 'FI', france: 'FR', germany: 'DE', greece: 'GR', hungary: 'HU',
  ireland: 'IE', italy: 'IT', latvia: 'LV', lithuania: 'LT', luxembourg: 'LU',
  malta: 'MT', netherlands: 'NL', 'the netherlands': 'NL', poland: 'PL',
  portugal: 'PT', romania: 'RO', slovakia: 'SK', slovenia: 'SI', spain: 'ES',
  sweden: 'SE'
};

const CODE_FIXES = { EL: 'GR', UK: null, GB: null };

/* Group labels vary between documents; these are the ones the interface and the
   sample records use. Anything unrecognised is passed through untouched. */
const GROUPS = {
  'group of the european people\'s party (christian democrats)': 'EPP',
  'group of the progressive alliance of socialists and democrats in the european parliament': 'S&D',
  'patriots for europe group': 'PfE',
  'european conservatives and reformists group': 'ECR',
  'renew europe group': 'Renew',
  'group of the greens/european free alliance': 'Greens/EFA',
  'the left group in the european parliament - gue/ngl': 'The Left',
  'europe of sovereign nations group': 'ESN',
  'non-attached members': 'NI',
  ppe: 'EPP', 's&d': 'S&D', pfe: 'PfE', ecr: 'ECR', renew: 'Renew',
  verts: 'Greens/EFA', 'verts/ale': 'Greens/EFA', 'the left': 'The Left',
  'gue/ngl': 'The Left', esn: 'ESN', ni: 'NI'
};

const VOTE_SECTIONS = [
  ['Result.For', 'for'],
  ['Result.Against', 'against'],
  ['Result.Abstention', 'abstain']
];

/* Amendments are the bulk of a plenary and the least of its meaning. By default
   only the votes on a text as a whole are imported. --all takes everything. */
const FINAL_VOTE = /(ensemble du texte|vote unique|single vote|proposition de r[ée]solution|resolution|texte dans son ensemble|whole text|final vote|commission proposal|proposition de la commission)/i;
const AMENDMENT = /\b(am|amendement|amendment)\s*\d+/i;

/* ------------------------------------------------------------------ helpers */

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = !next || next.startsWith('--') ? true : (i += 1, next);
  }
  return args;
}

async function firstAvailable(urls) {
  for (const url of urls) {
    const text = await getText(url);
    if (text) return { url: url, text: text };
  }
  return null;
}

/* The importer only looks for votes on days the Parliament sat. Without a
   calendar it falls back to trying weekdays, which costs a 404 and nothing else. */
async function sittingDayLookup() {
  try {
    const calendar = JSON.parse(await readFile(path.join(ROOT, CALENDAR_FILE), 'utf8'));
    const days = new Set();
    (calendar.sessions || []).forEach(function (session) {
      const from = new Date(session.start + 'T00:00:00Z');
      const to = new Date(session.end + 'T00:00:00Z');
      for (let day = from; day <= to; day = new Date(day.getTime() + 86400000)) {
        days.add(day.toISOString().slice(0, 10));
      }
    });
    return days.size ? days : null;
  } catch (error) {
    return null;
  }
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/xml,text/xml,*/*', 'user-agent': 'eu-tracker/0.1 (open data import)' },
    redirect: 'follow'
  });
  if (response.status === 404) return null; // no sitting that day
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

export function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 58);
}

export function normaliseGroup(label) {
  if (!label) return 'NI';
  const key = String(label).trim().toLowerCase();
  return GROUPS[key] || String(label).trim();
}

export function countryCode(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const upper = raw.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(CODE_FIXES, upper)) return CODE_FIXES[upper];
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return COUNTRIES[raw.toLowerCase()] || null;
}

/* ------------------------------------------------------- the MEP directory */

export function parseDirectory(xml) {
  const doc = parseXML(xml);
  const members = {};
  findAll(doc, 'mep').forEach(function (node) {
    const read = function (tag) {
      const child = find(node, tag);
      return child ? child.text.trim() : '';
    };
    const id = read('id');
    if (!id) return;
    members[id] = {
      name: read('fullName') || read('name'),
      country: countryCode(read('country')),
      group: normaliseGroup(read('politicalGroup')),
      party: read('nationalPoliticalGroup') || null
    };
  });
  return members;
}

async function loadDirectory(args) {
  if (typeof args.meps === 'string') {
    return parseDirectory(await readFile(args.meps, 'utf8'));
  }
  const cachePath = path.join(ROOT, MEP_CACHE);
  if (!args['refresh-meps']) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      if (cached.members && Object.keys(cached.members).length) return cached.members;
    } catch (error) {
      // no cache yet — fall through and fetch
    }
  }

  let xml;
  try {
    xml = await getText(DIRECTORY_URL(args.term || TERM));
  } catch (error) {
    xml = null;
    console.warn(`The MEP directory could not be fetched (${error.message}).`);
  }

  // A stale cache still maps most members correctly; no cache at all maps none.
  if (!xml) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'));
      if (cached.members && Object.keys(cached.members).length) {
        console.warn(`Falling back to the cached directory of ${cached.fetched}.`);
        return cached.members;
      }
    } catch (error) {
      // nothing cached either
    }
    throw new Error('The MEP directory could not be fetched and nothing is cached.');
  }

  const members = parseDirectory(xml);
  if (!Object.keys(members).length) {
    throw new Error('The MEP directory parsed to nothing — run with --inspect to see its shape.');
  }
  await writeFile(cachePath, JSON.stringify({
    source: DIRECTORY_URL(args.term || TERM),
    fetched: new Date().toISOString().slice(0, 10),
    term: Number(args.term || TERM),
    members
  }, null, 2) + '\n', 'utf8');
  console.log(`${MEP_CACHE}: ${Object.keys(members).length} members`);
  return members;
}

/* --------------------------------------------------------- the roll calls */

/* The annex carries the sitting date in its root element, which is what a run
   from a saved file has to go on. */
export function annexDate(xml) {
  const doc = parseXML(xml);
  const root = doc.children.find(function (node) { return node.name.indexOf('RollCallVote') !== -1; });
  const stamp = root ? (root.attributes['Sitting.Date'] || root.attributes.Date || '') : '';
  const match = stamp.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export function parseAnnex(xml) {
  const doc = parseXML(xml);
  return findAll(doc, 'RollCallVote.Result').map(function (node) {
    const description = find(node, 'RollCallVote.Description.Text');
    const votes = [];

    VOTE_SECTIONS.forEach(function (pair) {
      const section = find(node, pair[0]);
      if (!section) return;
      findAll(section, 'Result.PoliticalGroup.List').forEach(function (list) {
        const group = normaliseGroup(list.attributes.Identifier);
        findAll(list, 'Result.Member.Name').forEach(function (member) {
          votes.push({
            id: member.attributes.MepId || member.attributes.PersId || null,
            name: member.text.trim(),
            group: group,
            vote: pair[1]
          });
        });
      });
      // Some annexes list members directly under the section.
      if (!findAll(section, 'Result.PoliticalGroup.List').length) {
        findAll(section, 'Result.Member.Name').forEach(function (member) {
          votes.push({
            id: member.attributes.MepId || member.attributes.PersId || null,
            name: member.text.trim(),
            group: normaliseGroup(member.attributes.PoliticalGroup),
            vote: pair[1]
          });
        });
      }
    });

    return {
      identifier: node.attributes.Identifier || null,
      timestamp: node.attributes.Date || null,
      title: (description ? description.text : '').replace(/\s+/g, ' ').trim(),
      votes: votes
    };
  });
}

/* Reads the votes list: which roll call carried, in the Parliament's words
   rather than by arithmetic. Keyed by the roll-call identifier so the two
   documents can be joined. */
export function parseVotList(xml) {
  const doc = parseXML(xml);
  const results = {};

  findAll(doc, 'voting').forEach(function (node) {
    const id = node.attributes.votingId || node.attributes.Identifier || node.attributes.id;
    if (!id) return;
    const raw = String(node.attributes.result || node.attributes.Result || '').toUpperCase();
    if (!raw) return;
    results[id] = {
      raw: raw,
      result: raw.indexOf('ADOPT') !== -1 ? 'adopted'
        : raw.indexOf('REJECT') !== -1 ? 'rejected'
        : raw.indexOf('LAPSE') !== -1 ? 'lapsed'
        : raw.indexOf('WITHDRAW') !== -1 ? 'withdrawn'
        : null
    };
  });

  return results;
}

export function isFinalVote(title) {
  if (!title) return false;
  if (AMENDMENT.test(title)) return false;
  return FINAL_VOTE.test(title);
}

/* -------------------------------------------------- roll call -> decision */

/* An annex description reads "A10-0123/2026 - Rapporteur - Proposition de
   résolution (ensemble du texte)": a reference, who steered it, and what was
   actually voted on. The last part is the closest thing to a headline; the rest
   belongs underneath it. Editors rewrite these into plain language afterwards. */
export function splitTitle(description) {
  const text = String(description || '').replace(/\s+/g, ' ').trim();
  const reference = (text.match(/\b[AB]\d{1,2}-\d{4}\/\d{4}\b/) || [null])[0];
  const parts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const object = parts.length > 1 ? parts[parts.length - 1] : text;
  const context = parts.length > 1 ? parts.slice(0, -1).join(' · ') : '';
  return {
    reference: reference,
    title: object || 'Roll-call vote',
    subtitle: context ? context + ' — roll-call vote in plenary' : 'Roll-call vote in plenary'
  };
}

export function toDecision(rollCall, members, date, sourceUrl, official, options) {
  const countries = {};
  const unknown = [];

  rollCall.votes.forEach(function (vote) {
    const member = (vote.id && members[vote.id]) || null;
    const code = member ? member.country : null;
    if (!code) {
      unknown.push(vote.name || vote.id);
      return;
    }
    if (!countries[code]) countries[code] = { meps: [], mepGroups: [], press: [] };
    const country = countries[code];
    const group = member.group || vote.group || 'NI';

    country.meps.push({
      name: member.name || vote.name,
      party: member.party || null,
      group: group,
      vote: vote.vote,
      id: vote.id
    });

    let row = country.mepGroups.find((item) => item.group === group);
    if (!row) {
      row = { group: group, seats: 0, for: 0, against: 0, abstain: 0, absent: 0 };
      country.mepGroups.push(row);
    }
    row.seats += 1;
    row[vote.vote] += 1;
  });

  Object.values(countries).forEach(function (country) {
    country.meps.sort((a, b) => a.name.localeCompare(b.name));
    country.mepGroups.sort((a, b) => b.seats - a.seats);
  });

  const totals = { for: 0, against: 0, abstain: 0 };
  rollCall.votes.forEach(function (vote) { totals[vote.vote] += 1; });
  const parts = splitTitle(rollCall.title);

  // Prefer what the Parliament says; fall back to the arithmetic of the annex.
  const stated = official && official.result;
  const adopted = stated ? stated === 'adopted' : totals.for > totals.against;
  const derived = !stated;

  // Compact by default: identities stay in the member directory and the vote
  // stores only [member id, position]. It is a tenth of the size, and it is the
  // difference between a term of votes fitting on free hosting and not.
  const compact = !(options && options.fat);
  if (compact) {
    Object.keys(countries).forEach(function (code) {
      delete countries[code].meps;
      delete countries[code].mepGroups;
    });
  }

  const ballots = compact
    ? rollCall.votes
        .filter(function (vote) { return vote.id && members[vote.id]; })
        .map(function (vote) { return [Number(vote.id), POSITIONS.indexOf(vote.vote)]; })
    : null;

  return {
    decision: {
      id: `ep-${date}-${slug(parts.reference || parts.title) || rollCall.identifier || 'vote'}`,
      status: 'verified',
      dataNote: derived
        ? 'Roll-call annex imported from the European Parliament. The annex records how each ' +
          'member voted but not whether the text carried, so the result below is derived from ' +
          'the totals: more in favour than against. The votes list, which states the result, is ' +
          'published a day or more later — re-running the import then replaces this.'
        : 'Imported from the European Parliament: the roll-call annex for how each member voted, ' +
          'and the votes list for the result.',
      body: 'parliament',
      bodyLabel: 'European Parliament',
      title: parts.title,
      subtitle: parts.subtitle,
      date: date,
      voteRule: 'simple-majority',
      voteRuleLabel: 'Majority of votes cast',
      procedure: { reference: parts.reference, url: null },
      summary: '',
      whatItMeans: [],
      outcome: {
        result: stated && stated !== 'adopted' && stated !== 'rejected'
          ? stated
          : (adopted ? 'adopted' : 'rejected'),
        headline: `${adopted ? 'Adopted' : 'Rejected'} — ${totals.for} in favour, ` +
          `${totals.against} against, ${totals.abstain} abstained.` +
          (derived ? ' Result derived from the totals.' : '')
      },
      impactUnit: 'EUR per person per year',
      impactLabel: 'Estimated net budget effect',
      ...(ballots ? { ballots: ballots } : {}),
      sources: [
        { label: 'Roll-call annex to the minutes', url: sourceUrl },
        { label: 'European Parliament open data', url: 'https://data.europarl.europa.eu/' }
      ],
      countries: countries
    },
    unknown: unknown,
    totals: totals
  };
}

/* --------------------------------------------------------------- the run */

function sittingDates(args) {
  if (args.file) return [null];
  if (args.date) return [String(args.date)];
  if (args.since) {
    const dates = [];
    const from = new Date(String(args.since) + 'T00:00:00Z');
    const to = args.until ? new Date(String(args.until) + 'T00:00:00Z') : new Date();
    for (let day = from; day <= to; day = new Date(day.getTime() + 86400000)) {
      const weekday = day.getUTCDay();
      if (weekday === 0 || weekday === 6) continue; // the Parliament does not sit at weekends
      dates.push(day.toISOString().slice(0, 10));
    }
    return dates;
  }
  // Default: the last week, which covers a plenary that has just finished.
  const dates = [];
  for (let back = 1; back <= 7; back += 1) {
    const day = new Date(Date.now() - back * 86400000);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates.reverse();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const term = args.term || TERM;
  const from = typeof args.from === 'string' ? args.from : TERM_START;
  const outDir = typeof args.out === 'string' ? args.out : 'data/decisions';
  const written = [];
  const taken = new Set();
  let skipped = 0;

  const members = args.inspect && args.file ? {} : await loadDirectory(args);

  const sittingDays = args.file || args.force ? null : await sittingDayLookup();
  if (sittingDays) console.log(`${sittingDays.size} sitting days known from the plenary calendar.`);

  for (const date of sittingDates(args)) {
    // This Parliament only: the term that began after the June 2024 elections.
    if (date && date < from) continue;
    if (sittingDays && date && !sittingDays.has(date)) continue;

    let url = String(args.file || '');
    let xml = args.file ? await readFile(String(args.file), 'utf8') : null;
    if (!args.file) {
      const found = await firstAvailable(ANNEX_URLS(term, date));
      if (!found) continue; // nothing published for that day
      url = found.url;
      xml = found.text;
    }

    if (args.inspect) {
      console.log(`\n${url}`);
      [...outline(parseXML(xml))]
        .filter(([, count]) => count > 0)
        .slice(0, 40)
        .forEach(([tagPath, count]) => console.log(`  ${count.toString().padStart(6)}  ${tagPath}`));
      continue;
    }

    const sitting = date || annexDate(xml);
    if (!sitting) {
      console.warn(`${url}: no sitting date in the file — pass --date`);
      continue;
    }

    let official = {};
    if (!args.file && !args['no-vot']) {
      const votXml = await getText(VOT_URL(term, sitting));
      if (votXml) {
        official = parseVotList(votXml);
        console.log(`${sitting}: votes list found — ${Object.keys(official).length} stated results.`);
      } else {
        console.log(`${sitting}: no votes list yet; results will be derived from the totals.`);
      }
    }

    const rollCalls = parseAnnex(xml);
    if (!rollCalls.length) {
      console.warn(`${url}: the annex parsed to no roll calls — run --inspect to see its shape.`);
      continue;
    }

    for (const rollCall of rollCalls) {
      if (!args.all && !isFinalVote(rollCall.title)) {
        skipped += 1;
        continue;
      }
      const built = toDecision(rollCall, members, sitting, url,
        official[rollCall.identifier] || null, { fat: Boolean(args.fat) });
      if (taken.has(built.decision.id)) {
        built.decision.id += '-' + (rollCall.identifier || taken.size);
      }
      taken.add(built.decision.id);
      if (!Object.keys(built.decision.countries).length) {
        console.warn(`${sitting}: "${rollCall.title}" mapped to no member states — is the MEP cache current?`);
        continue;
      }
      if (built.unknown.length) {
        console.warn(`${sitting}: ${built.unknown.length} members not in the directory ` +
          `(${built.unknown.slice(0, 3).join(', ')}…) — try --refresh-meps`);
      }

      // resolve, not join: an absolute --out must not end up under the repo.
      const directory = path.resolve(ROOT, outDir);
      const file = path.join(directory, `${built.decision.id}.json`);
      const shown = path.relative(ROOT, file);
      if (args['dry-run']) {
        console.log(`would write ${shown} — ${built.totals.for}/${built.totals.against}/` +
          `${built.totals.abstain} across ${Object.keys(built.decision.countries).length} member states`);
      } else {
        await mkdir(directory, { recursive: true });
        await writeFile(file, JSON.stringify(built.decision, null, 2) + '\n', 'utf8');
        console.log(`${shown} — ${built.totals.for}/${built.totals.against}/${built.totals.abstain}`);
      }
      written.push(built.decision.id);
    }
  }

  if (!args.inspect) {
    console.log(`\n${written.length} record${written.length === 1 ? '' : 's'}` +
      (skipped ? `, ${skipped} amendment votes skipped (pass --all to keep them)` : '') + '.');
    if (written.length && !args['dry-run']) {
      console.log('Next: node scripts/build-index.mjs, then node scripts/validate-data.mjs');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
