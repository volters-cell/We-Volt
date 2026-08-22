/* Loading and the derived numbers: delegation tallies, the Council
   qualified-majority arithmetic, and the buckets each map layer colours by. */
(function (global) {
  'use strict';

  const VOTE_KEYS = ['for', 'against', 'abstain', 'absent'];

  async function getJSON(path) {
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

  /* The map colours a delegation by where its majority went, and flags the ones
     that split — a 43/38 delegation is a different story from a unanimous one. */
  const SPLIT_MARGIN = 0.15;

  function delegationPosition(country) {
    const totals = mepTotals(country);
    if (!totals) return { position: country && country.position ? country.position : 'unknown', split: false };
    const cast = totals.for + totals.against + totals.abstain;
    if (!cast) return { position: 'absent', split: false };
    const ranked = ['for', 'against', 'abstain'].sort(function (a, b) { return totals[b] - totals[a]; });
    const margin = (totals[ranked[0]] - totals[ranked[1]]) / cast;
    return { position: ranked[0], split: margin < SPLIT_MARGIN, totals: totals };
  }

  function countryPosition(decision, code) {
    const country = decision.countries[code];
    if (!country) return { position: 'unknown', split: false };
    if (decision.body === 'parliament') return delegationPosition(country);
    return { position: country.position || 'unknown', split: false, totals: mepTotals(country) };
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

  function pressFraming(country) {
    const press = (country && country.press) || [];
    if (!press.length) return { framing: 'none', count: 0 };
    const counts = {};
    press.forEach(function (item) {
      counts[item.framing] = (counts[item.framing] || 0) + 1;
    });
    const ranked = FRAMINGS.filter(function (f) { return counts[f]; })
      .sort(function (a, b) { return counts[b] - counts[a]; });
    if (!ranked.length) return { framing: 'neutral', count: press.length };
    const dominant = ranked[0];
    const tied = ranked.length > 1 && counts[ranked[1]] === counts[dominant];
    return { framing: tied ? 'mixed' : dominant, count: press.length };
  }

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
    mepTotals: mepTotals,
    decisionTally: decisionTally,
    countryPosition: countryPosition,
    delegationPosition: delegationPosition,
    qualifiedMajority: qualifiedMajority,
    pressFraming: pressFraming,
    impactScale: impactScale,
    formatImpact: formatImpact,
    formatDate: formatDate,
    VOTE_KEYS: VOTE_KEYS
  };
})(window);
