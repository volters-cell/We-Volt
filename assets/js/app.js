/* Wiring: load the data, keep one piece of state (decision, layer, country),
   and let the URL carry it so a journalist can link straight to a country. */
(function () {
  'use strict';

  // layerChosen records whether the reader picked the layer or the page did:
  // an automatic default re-derives for each decision, a deliberate choice sticks.
  const state = { decision: null, layer: 'vote', layerChosen: false, country: null, filter: 'all' };
  const cache = {};
  let states = [];
  let statesByCode = {};
  let index = null;
  let map = null;

  const dom = {};
  ['sample-banner', 'sample-banner-text', 'decision-list', 'decision-body', 'decision-status',
   'decision-date', 'decision-title', 'decision-subtitle', 'decision-summary', 'decision-means',
   'decision-rule', 'decision-sources', 'outcome', 'map', 'legend', 'map-heading', 'map-hint',
   'panel-empty', 'panel-body', 'country-table', 'header-count', 'header-updated'].forEach(function (id) {
    dom[id] = document.getElementById(id);
  });

  const esc = Panel.escapeHTML;

  const LAYERS = {
    vote: {
      heading: 'How they voted',
      hint: 'Click a member state to open its record. Arrow keys move between countries.'
    },
    impact: {
      heading: 'What it costs each member state',
      hint: 'Shaded by the estimated effect per person. Every figure carries its source in the country panel.'
    },
    press: {
      heading: 'How each national press framed it',
      hint: 'Shaded by the dominant framing of the coverage indexed so far. Pale countries have no coverage indexed yet.'
    }
  };

  /* ------------------------------------------------------------ the feed */

  const RESULT_LABEL = {
    adopted: 'Adopted',
    rejected: 'Rejected',
    blocked: 'Not adopted',
    recorded: 'Recorded'
  };

  function renderFeed() {
    const items = index.decisions.filter(function (item) {
      return state.filter === 'all' || item.body === state.filter;
    });

    dom['decision-list'].innerHTML = items.length ? items.map(function (item) {
      const current = state.decision && item.id === state.decision.id;
      return '<li>' +
        '<button type="button" class="decision-card' + (current ? ' is-current' : '') + '"' +
        ' data-id="' + esc(item.id) + '"' + (current ? ' aria-current="true"' : '') + '>' +
          '<span class="card-top">' +
            '<span class="badge badge-' + esc(item.body) + '">' + esc(shortBody(item.body)) + '</span>' +
            '<time datetime="' + esc(item.date) + '">' + esc(Data.formatDate(item.date)) + '</time>' +
          '</span>' +
          '<span class="card-title">' + esc(item.title) + '</span>' +
          '<span class="card-foot">' +
            '<span class="result result-' + esc(item.result) + '">' +
              esc(RESULT_LABEL[item.result] || item.result) + '</span>' +
            (item.voteRuleLabel ? '<span class="card-rule">' + esc(item.voteRuleLabel) + '</span>' : '') +
          '</span>' +
        '</button></li>';
    }).join('') : '<li class="feed-empty">Nothing recorded from this institution yet.</li>';
  }

  /* The cost layer is data-driven: it appears when a decision carries sourced
     figures and stays out of the way when it does not. */
  function hasImpact(decision) {
    return Object.keys(decision.countries).some(function (code) {
      const impact = decision.countries[code].impact;
      return impact && typeof impact.value === 'number';
    });
  }

  function shortBody(body) {
    return { parliament: 'Parliament', council: 'Council', commission: 'Commission' }[body] || body;
  }

  function setFilter(filter) {
    state.filter = filter;
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-filter') === filter));
    });
    renderFeed();
  }

  /* ---------------------------------------------------------------- painting */

  function paint() {
    const decision = state.decision;
    if (!decision || !map) return;

    if (state.layer === 'impact') {
      const scale = Data.impactScale(decision);
      map.paint(function (code) {
        const impact = (decision.countries[code] || {}).impact;
        const value = impact ? impact.value : null;
        return {
          className: 'layer-impact impact-' + scale.bucket(value),
          label: Data.formatImpact(value, decision.impactUnit)
        };
      }, function (code) {
        const impact = (decision.countries[code] || {}).impact;
        return '<span>' + esc(Data.formatImpact(impact ? impact.value : null, decision.impactUnit)) + '</span>';
      });
    } else if (state.layer === 'press') {
      map.paint(function (code) {
        const framing = Data.pressFraming(decision.countries[code]);
        return {
          className: 'layer-press press-' + framing.framing,
          label: Panel.FRAMING_LABEL[framing.framing]
        };
      }, function (code) {
        const framing = Data.pressFraming(decision.countries[code]);
        return '<span>' + esc(Panel.FRAMING_LABEL[framing.framing]) +
          (framing.count ? ' · ' + framing.count + ' item' + (framing.count === 1 ? '' : 's') : '') + '</span>';
      });
    } else {
      map.paint(function (code) {
        const position = Data.countryPosition(decision, code);
        return {
          className: 'layer-vote vote-' + position.position + (position.split ? ' is-split' : ''),
          label: Panel.VOTE_LABEL[position.position] + (position.split ? ', delegation split' : '')
        };
      }, function (code) {
        const position = Data.countryPosition(decision, code);
        const totals = position.totals;
        return '<span>' + esc(Panel.VOTE_LABEL[position.position]) +
          (totals ? ' · ' + totals.for + '–' + totals.against +
            (totals.abstain ? '–' + totals.abstain : '') : '') + '</span>';
      });
    }

    renderLegend();
  }

  function legendRow(className, label) {
    return '<li><span class="swatch ' + className + '"></span>' + esc(label) + '</li>';
  }

  function renderLegend() {
    const decision = state.decision;
    let html = '';

    if (state.layer === 'vote') {
      const keys = decision.body === 'commission'
        ? [['vote-not-applicable', 'No vote taken']]
        : [['vote-for', 'In favour'], ['vote-against', 'Against'],
           ['vote-abstain', 'Abstained'], ['vote-absent', 'Did not vote']];
      html = keys.map(function (pair) { return legendRow('layer-vote ' + pair[0], pair[1]); }).join('');
      if (decision.body === 'parliament') {
        html += '<li><span class="swatch layer-vote vote-for is-split"></span>Delegation split (under 15 points between the top two)</li>';
      }
    } else if (state.layer === 'impact') {
      const scale = Data.impactScale(decision);
      const unit = decision.impactUnit || '';
      const step = scale.step;
      const fmt = function (value) { return Math.abs(value).toFixed(step < 5 ? 1 : 0); };
      html =
        legendRow('layer-impact impact-cost-3', 'Cost over ' + fmt(step * 2) + ' ' + unit) +
        legendRow('layer-impact impact-cost-2', 'Cost ' + fmt(step) + '–' + fmt(step * 2) + ' ' + unit) +
        legendRow('layer-impact impact-cost-1', 'Cost under ' + fmt(step) + ' ' + unit) +
        legendRow('layer-impact impact-zero', 'No measurable effect') +
        legendRow('layer-impact impact-gain-1', 'Gain under ' + fmt(step) + ' ' + unit) +
        legendRow('layer-impact impact-gain-2', 'Gain ' + fmt(step) + '–' + fmt(step * 2) + ' ' + unit) +
        legendRow('layer-impact impact-gain-3', 'Gain over ' + fmt(step * 2) + ' ' + unit);
    } else {
      html = ['supportive', 'critical', 'mixed', 'neutral', 'none'].map(function (framing) {
        return legendRow('layer-press press-' + framing, Panel.FRAMING_LABEL[framing]);
      }).join('');
    }

    dom.legend.innerHTML = '<h3>Legend</h3><ul>' + html + '</ul>';
  }

  /* ---------------------------------------------------------------- outcome */

  function meter(label, valueText, share, threshold, met) {
    return '<div class="meter ' + (met ? 'met' : 'unmet') + '">' +
      '<p class="meter-label">' + esc(label) + '</p>' +
      '<div class="meter-track" role="img" aria-label="' + esc(valueText) + '">' +
        '<span class="meter-fill" style="width:' + Math.min(100, share * 100).toFixed(1) + '%"></span>' +
        '<span class="meter-threshold" style="left:' + (threshold * 100).toFixed(1) + '%"></span>' +
      '</div>' +
      '<p class="meter-value">' + esc(valueText) + '</p>' +
    '</div>';
  }

  function renderOutcome() {
    const decision = state.decision;
    const result = decision.outcome || {};
    let html = '<p class="outcome-result outcome-' + esc(result.result || 'unknown') + '">' +
      esc(result.headline || result.result || '') + '</p>';

    if (decision.body === 'council' && decision.voteRule === 'unanimity') {
      // Unanimity is a different arithmetic: population does not enter it, the
      // threshold is every member state, and an abstention is not a veto.
      const qmv = Data.qualifiedMajority(decision, states);
      const against = qmv.groups.against;
      html += '<div class="meters">' +
        meter('Member states in favour',
          qmv.statesFor + ' of 27 — all 27 needed',
          qmv.statesShare, 1, qmv.statesFor === states.length) +
        '</div>' +
        '<p class="outcome-note">' +
        (against.length
          ? 'Voting against: ' + against.map(function (code) {
              return statesByCode[code] ? statesByCode[code].name : code;
            }).join(', ') + '. On a file like this one, that is enough on its own. '
          : 'No member state voted against. ') +
        'Abstaining does not block a unanimous decision — only a vote against does.</p>';
    } else if (decision.body === 'council') {
      const qmv = Data.qualifiedMajority(decision, states);
      html += '<div class="meters">' +
        meter('Member states in favour',
          qmv.statesFor + ' of 27 — 15 needed',
          qmv.statesShare, 15 / 27, qmv.statesFor >= 15) +
        meter('Population represented',
          (qmv.populationShare * 100).toFixed(1) + '% — 65% needed',
          qmv.populationShare, 0.65, qmv.populationShare >= 0.65) +
        '</div>' +
        '<p class="outcome-note">' +
        (qmv.blocking.formed
          ? 'A blocking minority formed: ' + qmv.blocking.states + ' member states holding ' +
            (qmv.blocking.populationShare * 100).toFixed(1) + '% of the population.'
          : 'The states not voting in favour — ' + qmv.blocking.states + ' of them, ' +
            (qmv.blocking.populationShare * 100).toFixed(1) + '% of the population — fell short of a ' +
            'blocking minority, which needs at least 4 states and more than 35%.') +
        ' Abstaining counts the same as voting against when a qualified majority is being counted.</p>';
    } else if (decision.body === 'parliament') {
      const tally = Data.decisionTally(decision);
      if (tally) {
        const cast = tally.for + tally.against + tally.abstain;
        html += '<div class="tally">' +
          ['for', 'against', 'abstain', 'absent'].map(function (key) {
            return '<div class="tally-cell tally-' + key + '"><span class="tally-number">' +
              tally[key] + '</span><span class="tally-label">' +
              esc(Panel.VOTE_LABEL[key]) + '</span></div>';
          }).join('') +
          '</div>' +
          '<p class="outcome-note">' + cast + ' votes cast of 720 seats. ' +
          'A simple majority of votes cast carries the file.</p>';
      }
    } else {
      const covered = Object.keys(decision.countries).filter(function (code) {
        return (decision.countries[code].press || []).length;
      }).length;
      html += '<p class="outcome-note">No country-by-country vote exists for this act: ' +
        'the Commission used powers the member states had already delegated to it. ' +
        'What each country got instead is the effect and the coverage — ' + covered +
        ' of 27 have press indexed so far.</p>';
    }

    dom.outcome.innerHTML = html;
  }

  /* ---------------------------------------------------------------- table */

  let sortKey = 'name';
  let sortAsc = true;

  function tableRows() {
    const decision = state.decision;
    return states.map(function (item) {
      const country = decision.countries[item.code] || {};
      const position = Data.countryPosition(decision, item.code);
      const totals = Data.mepTotals(country);
      const impact = country.impact && typeof country.impact.value === 'number' ? country.impact.value : null;
      const framing = Data.pressFraming(country);
      return {
        code: item.code,
        name: item.name,
        position: Panel.VOTE_LABEL[position.position] || position.position,
        positionKey: position.position,
        split: position.split,
        meps: totals,
        mepsKey: totals ? totals.for : -1,
        impact: impact,
        press: framing.count,
        framing: framing.framing
      };
    });
  }

  function renderTable() {
    const rows = tableRows();
    const direction = sortAsc ? 1 : -1;
    rows.sort(function (a, b) {
      let left = a[sortKey], right = b[sortKey];
      if (sortKey === 'meps') { left = a.mepsKey; right = b.mepsKey; }
      if (sortKey === 'position') { left = a.positionKey; right = b.positionKey; }
      if (left == null) left = -Infinity;
      if (right == null) right = -Infinity;
      if (typeof left === 'string') return left.localeCompare(right) * direction;
      return (left - right) * direction;
    });

    const body = dom['country-table'].querySelector('tbody');
    body.innerHTML = rows.map(function (row) {
      return '<tr data-code="' + row.code + '">' +
        '<th scope="row"><button type="button" class="link-button">' + esc(row.name) + '</button></th>' +
        '<td><span class="vote-pill vote-' + esc(row.positionKey) + '">' + esc(row.position) + '</span>' +
        (row.split ? ' <span class="split-flag">split</span>' : '') + '</td>' +
        '<td class="numeric">' + (row.meps
          ? row.meps.for + ' / ' + row.meps.against + ' / ' + row.meps.abstain
          : '—') + '</td>' +
        '<td class="numeric" data-col="impact"' + (row.impact === null ? ' hidden' : '') + '>' +
          esc(Data.formatImpact(row.impact, state.decision.impactUnit)) + '</td>' +
        '<td>' + (row.press ? row.press + ' · ' + esc(Panel.FRAMING_LABEL[row.framing]) : '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------------------------------------------------------------- routing */

  function permalink(code) {
    return '#/' + state.decision.id + (code ? '/' + code : '');
  }

  function readHash() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    return { decisionId: parts[0] || null, code: (parts[1] || '').toUpperCase() || null };
  }

  function writeHash() {
    const target = permalink(state.country);
    if (location.hash === target) return;
    try {
      history.replaceState(null, '', target);
    } catch (error) {
      // Some embedded contexts refuse history writes. The permalink in the
      // panel still carries the address; only the location bar goes stale.
      location.hash = target;
    }
  }

  /* ---------------------------------------------------------------- render */

  function selectCountry(code, options) {
    state.country = code && statesByCode[code] ? code : null;
    if (map) map.setSelected(state.country);

    if (!state.country) {
      dom['panel-body'].hidden = true;
      dom['panel-empty'].hidden = false;
    } else {
      dom['panel-empty'].hidden = true;
      Panel.render(dom['panel-body'], state.decision, statesByCode[state.country], permalink(state.country));
      // On a narrow screen the panel is far below the map, so bring it into
      // view; on a wide one it is already beside the map and must not jump.
      const narrow = window.matchMedia('(max-width: 62rem)').matches;
      if (narrow && (!options || options.scroll !== false)) {
        dom['panel-body'].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    Array.prototype.forEach.call(dom['country-table'].querySelectorAll('tr[data-code]'), function (row) {
      row.classList.toggle('is-selected', row.getAttribute('data-code') === state.country);
    });

    writeHash();
  }

  function renderDecision() {
    const decision = state.decision;

    dom['decision-body'].textContent = decision.bodyLabel;
    dom['decision-body'].className = 'badge badge-' + decision.body;
    dom['decision-date'].textContent = Data.formatDate(decision.date);
    dom['decision-date'].setAttribute('datetime', decision.date);
    dom['decision-title'].textContent = decision.title;
    dom['decision-subtitle'].textContent = decision.subtitle || '';
    dom['decision-summary'].textContent = decision.summary || '';
    dom['decision-rule'].textContent = decision.voteRuleLabel || decision.voteRule || '';

    dom['decision-means'].innerHTML = (decision.whatItMeans || []).map(function (line) {
      return '<li>' + esc(line) + '</li>';
    }).join('');

    dom['decision-sources'].innerHTML = (decision.sources || []).map(function (source) {
      return '<li>' + (source.url
        ? '<a href="' + esc(source.url) + '">' + esc(source.label) + '</a>'
        : esc(source.label)) + '</li>';
    }).join('') + (decision.procedure && decision.procedure.reference
      ? '<li>Procedure reference: <code>' + esc(decision.procedure.reference) + '</code></li>'
      : '') + (decision.dataNote
      ? '<li class="data-note">' + esc(decision.dataNote) + '</li>'
      : '');

    const isSample = decision.status === 'sample';
    dom['decision-status'].hidden = !isSample;
    dom['sample-banner'].hidden = !isSample;

    const costs = hasImpact(decision);
    document.getElementById('tab-impact').hidden = !costs;
    Array.prototype.forEach.call(dom['country-table'].querySelectorAll('[data-col="impact"]'), function (cell) {
      cell.hidden = !costs;
    });
    if (!state.layerChosen) {
      // "How they voted" is an empty question for an act nobody voted on, so a
      // Commission file opens on the coverage instead.
      setLayer(decision.body === 'commission' ? 'press' : 'vote');
    } else if (!costs && state.layer === 'impact') {
      setLayer('vote');
    }

    renderOutcome();
    paint();
    renderTable();
    renderFeed();
  }

  async function loadDecision(id, code) {
    const entry = index.decisions.find(function (item) { return item.id === id; }) || index.decisions[0];
    if (!cache[entry.id]) cache[entry.id] = await Data.getJSON(entry.file);
    state.decision = cache[entry.id];
    renderDecision();
    selectCountry(code || null, { scroll: false });
  }

  function setLayer(layer, chosen) {
    state.layer = layer;
    if (chosen) state.layerChosen = true;
    Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (tab) {
      tab.setAttribute('aria-selected', String(tab.getAttribute('data-layer') === layer));
    });
    dom['map-heading'].textContent = LAYERS[layer].heading;
    dom['map-hint'].textContent = LAYERS[layer].hint;
    paint();
  }

  /* ---------------------------------------------------------------- start */

  async function start() {
    try {
      const [reference, geo, decisionIndex] = await Promise.all([
        Data.getJSON('data/reference/member-states.json'),
        Data.getJSON('data/eu-countries.geo.json'),
        Data.getJSON('data/decisions/index.json')
      ]);

      states = reference.states;
      statesByCode = {};
      states.forEach(function (item) { statesByCode[item.code] = item; });
      Panel.setStates(states);
      index = decisionIndex;

      const counts = index.decisions.reduce(function (totals, item) {
        totals[item.body] = (totals[item.body] || 0) + 1;
        return totals;
      }, {});
      dom['header-count'].textContent = index.decisions.length + ' decisions tracked · ' +
        (counts.parliament || 0) + ' Parliament · ' + (counts.council || 0) + ' Council · ' +
        (counts.commission || 0) + ' Commission';
      dom['header-updated'].textContent = index.metadata && index.metadata.updated
        ? 'Updated ' + Data.formatDate(index.metadata.updated) : '';

      renderFeed();

      dom['decision-list'].addEventListener('scroll', function () {
        const list = dom['decision-list'];
        const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
        list.classList.toggle('at-end', atEnd);
      });

      map = new EUMap(dom.map, geo, {
        onSelect: function (code) { selectCountry(code); },
        onDeselect: function () { selectCountry(null); }
      });

      const route = readHash();
      await loadDecision(route.decisionId, route.code);

      dom['decision-list'].addEventListener('click', function (event) {
        const card = event.target.closest('.decision-card');
        if (card) loadDecision(card.getAttribute('data-id'), state.country);
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (button) {
        button.addEventListener('click', function () {
          setFilter(button.getAttribute('data-filter'));
        });
      });

      // Escape closes the open country from anywhere on the page.
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && state.country) selectCountry(null);
      });

      dom['panel-body'].addEventListener('click', function (event) {
        if (event.target.closest('.panel-close')) selectCountry(null);
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (tab) {
        tab.addEventListener('click', function () { setLayer(tab.getAttribute('data-layer'), true); });
      });

      dom['country-table'].addEventListener('click', function (event) {
        const button = event.target.closest('.link-button');
        if (!button) return;
        selectCountry(button.closest('tr').getAttribute('data-code'));
      });

      Array.prototype.forEach.call(dom['country-table'].querySelectorAll('[data-sort]'), function (button) {
        button.addEventListener('click', function () {
          const key = button.getAttribute('data-sort');
          sortAsc = key === sortKey ? !sortAsc : true;
          sortKey = key;
          renderTable();
          Array.prototype.forEach.call(dom['country-table'].querySelectorAll('th'), function (th) {
            th.removeAttribute('aria-sort');
          });
          button.closest('th').setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
        });
      });

      window.addEventListener('hashchange', function () {
        const next = readHash();
        if (next.decisionId && state.decision && next.decisionId !== state.decision.id) {
          loadDecision(next.decisionId, next.code);
        } else if (next.code !== state.country) {
          selectCountry(next.code, { scroll: false });
        }
      });
    } catch (error) {
      document.querySelector('main').insertAdjacentHTML('afterbegin',
        '<p class="load-error"><strong>Could not load the data.</strong> ' + esc(error.message) +
        '<br>The site reads its records over HTTP — open it with a local server ' +
        '(<code>python3 -m http.server</code>), not as a <code>file://</code> path.</p>');
    }
  }

  start();
})();
