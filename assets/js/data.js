/* Loading and the derived numbers: delegation tallies, the Council
   qualified-majority arithmetic, and the buckets each map layer colours by. */
(function (global) {
  'use strict';

  const VOTE_KEYS = ['for', 'against', 'abstain', 'absent'];

  /* A vote can be stored two ways.
   *
   * The long way repeats every member's name, party and group inside every
   * record: 69 KB per vote, 0.9 GB for a five-year term.
   *
   * The short way keeps identities in the member directory, once, and stores
   * the vote itself as pairs of [member id, position]: 8 KB per vote, 104 MB
   * for a term — small enough that the whole Parliament fits on free static
   * hosting and this project never needs a paid database.
   *
   * The page expands the short form on load, so everything downstream — the
   * map, the panel, the roll-call, search — sees the same shape either way. */
  function expandBallots(decision, members) {
    if (!decision || !Array.isArray(decision.ballots) || !members) return decision;

    decision.countries = decision.countries || {};
    Object.keys(decision.countries).forEach(function (code) {
      decision.countries[code].meps = [];
      decision.countries[code].mepGroups = [];
    });

    let unknown = 0;
    decision.ballots.forEach(function (ballot) {
      const member = members[ballot[0]];
      const vote = VOTE_KEYS[ballot[1]];
      if (!member || !member.country || !vote) {
        unknown += 1;
        return;
      }
      const code = member.country;
      if (!decision.countries[code]) decision.countries[code] = { meps: [], mepGroups: [] };
      const country = decision.countries[code];
      country.meps = country.meps || [];
      country.mepGroups = country.mepGroups || [];

      country.meps.push({
        name: member.name,
        party: member.party || null,
        group: member.group || 'NI',
        vote: vote,
        id: ballot[0]
      });

      const group = member.group || 'NI';
      let row = country.mepGroups.find(function (item) { return item.group === group; });
      if (!row) {
        row = { group: group, seats: 0, for: 0, against: 0, abstain: 0, absent: 0 };
        country.mepGroups.push(row);
      }
      row.seats += 1;
      row[vote] += 1;
    });

    Object.keys(decision.countries).forEach(function (code) {
      const country = decision.countries[code];
      (country.meps || []).sort(function (a, b) { return a.name.localeCompare(b.name); });
      (country.mepGroups || []).sort(function (a, b) { return b.seats - a.seats; });
    });

    decision.expanded = { unknown: unknown };
    return decision;
  }

  async function getJSON(path) {
    // The single-file build (scripts/build-single-file.mjs) embeds every record
    // in the page, so the same code runs from a server or from one HTML file.
    const bundled = global.__EU_TRACKER_DATA__;
    if (bundled && bundled[path]) return bundled[path];

    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error('Could not load ' + path + ' (' + response.status + ')');
    }
    return response.json();
  }

  /* MEP numbers for one member state, whether the record holds a per-MEP
     roll-call (real data from the ingest script) or a group breakdown (samples). */
  function mepTotals(country) {
    if (!country) return null;
    if (Array.isArray(country.meps) && country.meps.length) {
      const totals = { for: 0, against: 0, abstain: 0, absent: 0 };
      country.meps.forEach(function (mep) {
        if (totals[mep.vote] !== undefined) totals[mep.vote] += 1;
      });
      return totals;
    }
    if (Array.isArray(country.mepGroups) && country.mepGroups.length) {
      const totals = { for: 0, against: 0, abstain: 0, absent: 0 };
      country.mepGroups.forEach(function (group) {
        VOTE_KEYS.forEach(function (key) { totals[key] += group[key] || 0; });
      });
      return totals;
    }
    return null;
  }

  function decisionTally(decision) {
    const totals = { for: 0, against: 0, abstain: 0, absent: 0 };
    let any = false;
    Object.keys(decision.countries).forEach(function (code) {
      const totalsForCountry = mepTotals(decision.countries[code]);
      if (!totalsForCountry) return;
      any = true;
      VOTE_KEYS.forEach(function (key) { totals[key] += totalsForCountry[key]; });
    });
    return any ? totals : null;
  }

  /* The map colours a delegation by where most of its members voted. That is
     arithmetic and nothing more: the numbers behind it are always on screen,
     and the reader decides what a 43-38 delegation means. */
  function delegationPosition(country) {
    const totals = mepTotals(country);
    if (!totals) {
      return { position: country && country.position ? country.position : 'unknown' };
    }
    const cast = totals.for + totals.against + totals.abstain;
    if (!cast) return { position: 'absent', totals: totals };
    const ranked = ['for', 'against', 'abstain'].sort(function (a, b) { return totals[b] - totals[a]; });
    return { position: ranked[0], totals: totals };
  }

  function countryPosition(decision, code) {
    const country = decision.countries[code];
    if (!country) return { position: 'unknown' };
    if (decision.body === 'parliament') return delegationPosition(country);
    return { position: country.position || 'unknown', totals: mepTotals(country) };
  }

  /* Council qualified majority: 55% of member states (15 of 27) representing 65%
     of the population. A blocking minority needs at least four member states. */
  function qualifiedMajority(decision, states) {
    const byCode = {};
    states.forEach(function (state) { byCode[state.code] = state; });
    const totalPopulation = states.reduce(function (sum, s) { return sum + s.population; }, 0);

    const groups = { for: [], against: [], abstain: [], absent: [] };
    Object.keys(decision.countries).forEach(function (code) {
      const position = decision.countries[code].position;
      if (groups[position]) groups[position].push(code);
    });

    const populationOf = function (codes) {
      return codes.reduce(function (sum, code) {
        return sum + (byCode[code] ? byCode[code].population : 0);
      }, 0);
    };

    const forStates = groups.for.length;
    const forPopulation = populationOf(groups.for);
    // Abstentions count against a qualified majority: only "for" votes build one.
    const notFor = groups.against.concat(groups.abstain, groups.absent);

    return {
      statesFor: forStates,
      statesNeeded: 15,
      statesShare: forStates / states.length,
      populationFor: forPopulation,
      populationShare: forPopulation / totalPopulation,
      populationNeeded: 0.65,
      passed: forStates >= 15 && forPopulation / totalPopulation >= 0.65,
      blocking: {
        states: notFor.length,
        populationShare: populationOf(notFor) / totalPopulation,
        // A blocking minority is four or more states holding more than 35%.
        formed: notFor.length >= 4 && populationOf(notFor) / totalPopulation > 0.35
      },
      groups: groups
    };
  }

  const FRAMINGS = ['supportive', 'critical', 'mixed', 'neutral'];


  /* Five buckets either side of zero, scaled to the decision's own range, so a
     file measured in cents per head reads as clearly as one in tens of euros. */
  function impactScale(decision) {
    const values = [];
    Object.keys(decision.countries).forEach(function (code) {
      const impact = decision.countries[code].impact;
      if (impact && typeof impact.value === 'number') values.push(impact.value);
    });
    const extent = values.reduce(function (max, v) { return Math.max(max, Math.abs(v)); }, 0);
    const step = extent / 3 || 1;

    return {
      extent: extent,
      step: step,
      bucket: function (value) {
        if (typeof value !== 'number' || Number.isNaN(value)) return 'none';
        if (Math.abs(value) < step * 0.05) return 'zero';
        const level = Math.min(3, Math.ceil(Math.abs(value) / step));
        return (value < 0 ? 'cost-' : 'gain-') + level;
      }
    };
  }

  function formatImpact(value, unit) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'Not estimated';
    if (value === 0) return 'No measurable effect';
    const sign = value < 0 ? '−' : '+';
    return sign + Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0) + ' ' + (unit || '');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const date = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    });
  }

  global.Data = {
    getJSON: getJSON,
    expandBallots: expandBallots,
    mepTotals: mepTotals,
    decisionTally: decisionTally,
    countryPosition: countryPosition,
    delegationPosition: delegationPosition,
    qualifiedMajority: qualifiedMajority,
    impactScale: impactScale,
    formatImpact: formatImpact,
    formatDate: formatDate,
    VOTE_KEYS: VOTE_KEYS
  };
})(window);
