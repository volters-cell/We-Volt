/* Wiring: load the data, keep one piece of state (decision, layer, country),
   and let the URL carry it so a journalist can link straight to a country. */
(function () {
  'use strict';

  // layerChosen records whether the reader picked the layer or the page did:
  // an automatic default re-derives for each decision, a deliberate choice sticks.
  const state = {
    decision: null, layer: 'vote', layerChosen: false,
    country: null, filter: 'all', isolate: null, query: '', unfolded: false, member: null
  };

  let calendar = { sessions: [] };
  let directory = null;
  let memberIndex = null;      // every MEP, for search
  let memberCache = {};        // their voting records, fetched on demand
  let bySourceId = {};         // vote id in the source data -> record in the index

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cache = {};
  let states = [];
  let statesByCode = {};
  let index = null;
  let map = null;

  const dom = {};
  ['sample-banner', 'sample-banner-text', 'decision-list', 'decision-body', 'decision-status',
   'decision-date', 'decision-title', 'decision-subtitle', 'decision-summary', 'decision-means',
   'decision-rule', 'decision-sources', 'outcome', 'map', 'legend', 'map-heading', 'map-hint',
   'panel-empty', 'panel-body', 'country-table', 'table-empty', 'header-count',
   'header-plenary', 'search-input', 'search-clear', 'search-status',
   'mep-results', 'decision-section', 'back-to-votes', 'session-list', 'roll-call',
   'roll-call-detail', 'roll-call-filter', 'member-section', 'member-name', 'member-group',
   'member-country', 'member-summary', 'member-totals', 'member-votes', 'member-filter',
   'member-count', 'back-from-member'].forEach(function (id) {
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

  /* ------------------------------------------------------------ motion */

  const animations = [];

  function stopAnimations() {
    while (animations.length) cancelAnimationFrame(animations.pop());
  }

  /* Counts a number up from zero. A vote total that lands rather than simply
     appearing gives the reader a moment to register what it is. */
  function countUp(element, value, duration) {
    if (REDUCED.matches || !duration) {
      element.textContent = value;
      return;
    }
    const started = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      element.textContent = Math.round(value * eased);
      if (t < 1) animations.push(requestAnimationFrame(frame));
    }
    animations.push(requestAnimationFrame(frame));
  }

  function animateOutcome(delay) {
    stopAnimations();
    const numbers = dom.outcome.querySelectorAll('[data-count]');
    const fills = dom.outcome.querySelectorAll('.meter-fill');

    const run = function () {
      Array.prototype.forEach.call(numbers, function (element) {
        countUp(element, Number(element.getAttribute('data-count')), 900);
      });
      Array.prototype.forEach.call(fills, function (fill) {
        fill.style.width = fill.getAttribute('data-width');
      });
    };

    if (REDUCED.matches || !delay) run();
    else window.setTimeout(run, delay);
  }

  /* ------------------------------------------------------------ search */

  function matches(item) {
    if (!state.query) return true;
    // Every word has to appear somewhere: "media hungary" finds the media
    // freedom vote, not everything about either.
    return state.query.split(/\s+/).every(function (word) {
      return item.keywords.indexOf(word) !== -1;
    });
  }

  /* Members are searched across the whole term, not only inside whatever vote
     happens to be open: following one MEP is the point of the site. */
  function mepMatches() {
    if (!state.query || !memberIndex) return [];
    const words = state.query.split(/\s+/);
    return memberIndex.filter(function (member) {
      return words.every(function (word) { return member.keywords.indexOf(word) !== -1; });
    }).slice(0, 25);
  }

  function renderMepResults() {
    const found = mepMatches();
    if (!found.length) {
      dom['mep-results'].hidden = true;
      dom['mep-results'].innerHTML = '';
      return;
    }
    dom['mep-results'].hidden = false;
    dom['mep-results'].innerHTML = '<h3>Members</h3><ul>' +
      found.map(function (member) {
        const country = statesByCode[member.country] || { name: member.country };
        return '<li><button type="button" class="mep-hit member-hit" data-member="' +
          esc(member.id) + '">' +
          '<span class="mep-name">' + esc(member.name) + '</span>' +
          '<span class="mep-meta">' + esc(country.name) + ' · ' + esc(member.group) + '</span>' +
          '<span class="card-rule">' + member.votes + ' votes</span></button></li>';
      }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------- one member */

  async function showMember(id) {
    if (!memberCache[id]) {
      try {
        memberCache[id] = await Data.getJSON('data/meps/' + id + '.json');
      } catch (error) {
        return;
      }
    }
    const member = memberCache[id];
    state.member = member;
    state.decision = null;

    dom['decision-section'].hidden = true;
    document.querySelector('.table-section').hidden = true;
    document.querySelector('.layer-tabs').hidden = true;
    dom['member-section'].hidden = false;
    // One subject at a time: the country panel belongs to a vote, not a person.
    document.getElementById('country-panel').hidden = true;
    state.country = null;

    const country = statesByCode[member.country] || { name: member.country };
    dom['member-name'].textContent = member.name;
    dom['member-group'].textContent = member.group;
    dom['member-group'].className = 'badge badge-parliament';
    dom['member-country'].textContent = country.name;
    dom['member-summary'].textContent = 'Every roll-call vote this member has cast in the ' +
      'records held here.';

    dom['member-totals'].innerHTML = ['for', 'against', 'abstain', 'absent'].map(function (key) {
      return '<div class="tally-cell tally-' + key + '">' +
        '<span class="tally-number">' + member.totals[key] + '</span>' +
        '<span class="tally-label">' + esc(Panel.VOTE_LABEL[key]) + '</span></div>';
    }).join('');

    renderMemberVotes();

    // Put their country on the map, so the person has a place.
    if (map) {
      map.paint(function (code) {
        return code === member.country
          ? { className: 'layer-neutral', label: country.name }
          : { className: 'layer-vote vote-unknown', label: '' };
      }, function (code) {
        return code === member.country ? '<span>' + esc(member.name) + '</span>' : '';
      });
      map.setSelected(member.country);
    }
    dom['map-hint'].textContent = member.name + ' sits for ' + country.name + '.';
    dom.legend.innerHTML = '';
  }

  function renderMemberVotes() {
    const member = state.member;
    if (!member) return;
    const filter = dom['member-filter'].value.trim().toLowerCase();

    const rows = member.votes.map(function (entry) {
      return { record: bySourceId[entry[0]], position: entry[1] };
    }).filter(function (row) {
      if (!row.record) return false;
      if (!filter) return true;
      return (row.record.keywords || '').indexOf(filter) !== -1;
    });

    dom['member-count'].textContent = rows.length + ' vote' + (rows.length === 1 ? '' : 's') +
      (filter ? ' matching “' + filter + '”' : '');

    dom['member-votes'].innerHTML = rows.slice(0, 400).map(function (row) {
      const key = ['for', 'against', 'abstain', 'absent'][row.position];
      return '<li><button type="button" class="member-vote" data-id="' + esc(row.record.id) + '">' +
        '<span class="mv-title">' + esc(row.record.title) + '</span>' +
        '<span class="vote-pill vote-' + key + '">' + esc(Panel.VOTE_LABEL[key]) + '</span>' +
        '<span class="mv-date">' + esc(Data.formatDate(row.record.date)) + '</span>' +
        '<span class="result result-' + esc(row.record.result) + '">' +
        esc(RESULT_LABEL[row.record.result] || row.record.result) + '</span>' +
        '</button></li>';
    }).join('') + (rows.length > 400
      ? '<li class="feed-empty">Showing the most recent 400. Filter to narrow it down.</li>'
      : '');
  }

  function setQuery(value) {
    state.query = String(value || '').trim().toLowerCase();
    dom['search-clear'].hidden = !state.query;
    renderFeed();
    renderMepResults();
  }

  /* ------------------------------------------------------- plenary sessions */

  function renderPlenary() {
    const today = new Date().toISOString().slice(0, 10);
    const sessions = calendar.sessions || [];
    const past = sessions.filter(function (session) { return session.end < today; });
    const next = sessions.filter(function (session) { return session.end >= today; })[0];

    if (past.length) {
      const last = past[past.length - 1];
      dom['header-plenary'].textContent = 'Last plenary ' + sessionLabel(last) +
        (next ? ' · next ' + sessionLabel(next) : '');
      return;
    }

    // No calendar imported yet: say what the records themselves show.
    const latest = index.decisions
      .filter(function (item) { return item.body === 'parliament'; })
      .map(function (item) { return item.date; })
      .sort()
      .pop();
    dom['header-plenary'].textContent = latest
      ? 'Latest sitting on record ' + Data.formatDate(latest)
      : '';
    dom['header-plenary'].title = 'Plenary calendar not imported yet — run npm run sessions.';
  }

  function sessionLabel(session) {
    const start = new Date(session.start + 'T00:00:00Z');
    const end = new Date(session.end + 'T00:00:00Z');
    const sameMonth = session.start.slice(0, 7) === session.end.slice(0, 7);
    const startText = start.toLocaleDateString('en-GB', {
      day: 'numeric', month: sameMonth ? undefined : 'short', timeZone: 'UTC'
    });
    const endText = end.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
    return startText + '–' + endText + (session.location ? ', ' + session.location : '');
  }

  /* ------------------------------------------------------------ the feed */

  const RESULT_LABEL = {
    adopted: 'Adopted',
    rejected: 'Rejected',
    blocked: 'Not adopted',
    recorded: 'Recorded'
  };

  /* Votes belong to sittings, and sittings belong to plenary sessions. Grouping
     them that way is how the Parliament's own week is shaped, and it keeps the
     landing page to a handful of lines instead of a wall of votes. */
  function sessionFor(date) {
    const found = (calendar.sessions || []).find(function (session) {
      return session.start <= date && date <= session.end;
    });
    if (found) return { key: found.start, session: found };
    return { key: date.slice(0, 7), session: null };
  }

  function sessionLabelFor(group) {
    if (group.session) {
      return (group.session.location ? group.session.location + ' · ' : '') +
        sessionRange(group.session);
    }
    const date = new Date(group.key + '-01T00:00:00Z');
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function sessionRange(session) {
    const start = new Date(session.start + 'T00:00:00Z');
    const end = new Date(session.end + 'T00:00:00Z');
    const sameMonth = session.start.slice(0, 7) === session.end.slice(0, 7);
    return start.toLocaleDateString('en-GB', {
      day: 'numeric', month: sameMonth ? undefined : 'short', timeZone: 'UTC'
    }) + '–' + end.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
  }

  function renderFeed() {
    const items = index.decisions.filter(function (item) {
      return (state.filter === 'all' || item.body === state.filter) && matches(item);
    });

    if (state.query) {
      dom['search-status'].hidden = false;
      dom['search-status'].textContent = items.length
        ? items.length + ' vote' + (items.length === 1 ? ' matches' : 's match') + ' “' + state.query + '”'
        : 'No vote matches “' + state.query + '”';
    } else {
      dom['search-status'].hidden = true;
    }

    const groups = [];
    const byKey = {};
    items.forEach(function (item) {
      const where = sessionFor(item.date);
      if (!byKey[where.key]) {
        byKey[where.key] = { key: where.key, session: where.session, items: [] };
        groups.push(byKey[where.key]);
      }
      byKey[where.key].items.push(item);
    });
    groups.sort(function (a, b) { return a.key < b.key ? 1 : -1; });

    if (!groups.length) {
      dom['session-list'].innerHTML = '<p class="feed-empty">' + (state.query
        ? 'Nothing here matches that. Try a procedure reference, or a word from the title.'
        : 'No votes recorded yet.') + '</p>';
      return;
    }

    // Landing folded is the point: the page opens on the search box, and the
    // session headers say what is behind them. A search opens what it found.
    dom['session-list'].innerHTML =
      '<p class="session-tools"><button type="button" id="unfold-all" aria-expanded="' +
      (state.unfolded ? 'true' : 'false') + '">' +
      (state.unfolded ? 'Fold all sessions' : 'Unfold all sessions') + '</button></p>' +
      groups.map(function (group) {
      const open = state.query || state.unfolded;
      const current = state.decision && group.items.some(function (item) {
        return item.id === state.decision.id;
      });
      return '<details class="session"' + (open || current ? ' open' : '') + '>' +
        '<summary>' +
          '<span class="session-label">' + esc(sessionLabelFor(group)) + '</span>' +
          '<span class="session-count">' + group.items.length + ' vote' +
            (group.items.length === 1 ? '' : 's') + '</span>' +
        '</summary>' +
        '<ul class="decision-list">' + group.items.map(decisionCard).join('') + '</ul>' +
        '</details>';
    }).join('');
  }

  /* The cost layer is data-driven: it appears when a decision carries sourced
     figures and stays out of the way when it does not. */
  function hasImpact(decision) {
    return Object.keys(decision.countries).some(function (code) {
      const impact = decision.countries[code].impact;
      return impact && typeof impact.value === 'number';
    });
  }

  function decisionCard(item) {
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
    if (!map) return;

    if (!decision) {
      // No vote open: the Union itself is the subject.
      map.paint(function () {
        return { className: 'layer-neutral', label: 'member state of the European Union' };
      }, function (code) {
        const item = statesByCode[code];
        if (!item) return '';
        const inside = ['euro', 'schengen', 'nato'].filter(function (key) {
          return ((item.memberships || {})[key] || {}).member;
        });
        return '<span>' + item.seats + ' MEPs' +
          (inside.length ? ' · ' + inside.map(function (key) {
            return { euro: 'euro', schengen: 'Schengen', nato: 'NATO' }[key];
          }).join(' · ') : '') + '</span>';
      });
      renderLegend();
      if (state.isolate) applyIsolation();
      return;
    }

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
          className: 'layer-vote vote-' + position.position,
          label: Panel.VOTE_LABEL[position.position]
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
    if (state.isolate) applyIsolation();
  }

  function legendRow(className, label, key) {
    const swatch = '<span class="swatch ' + className + '"></span>';
    if (!key) return '<li>' + swatch + esc(label) + '</li>';
    const on = Boolean(state.isolate) && state.isolate.kind === 'layer' && state.isolate.key === key;
    return '<li><button type="button" data-isolate="' + esc(key) + '" aria-pressed="' +
      (on ? 'true' : 'false') + '">' + swatch + esc(label) + '</button></li>';
  }

  function renderLegend() {
    const decision = state.decision;
    let html = '';

    if (!decision) {
      dom.legend.innerHTML = '<h3>Legend</h3><ul>' +
        legendRow('layer-neutral', 'Member state of the European Union') +
        '<li><span class="swatch swatch-context"></span>Europe outside the Union</li>' +
        '</ul><p class="legend-hint">Pick a vote from the list to colour the map by ' +
        'how each member state voted. The chips on a country isolate the euro area, ' +
        'Schengen or NATO.</p>';
      return;
    }

    if (state.layer === 'vote') {
      const keys = decision.body === 'commission'
        ? [['vote-not-applicable', 'No vote taken']]
        : [['vote-for', 'In favour'], ['vote-against', 'Against'],
           ['vote-abstain', 'Abstained'], ['vote-absent', 'Did not vote']];
      html = keys.map(function (pair) {
        return legendRow('layer-vote ' + pair[0], pair[1], pair[0].replace('vote-', ''));
      }).join('');
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
        return legendRow('layer-press press-' + framing, Panel.FRAMING_LABEL[framing], framing);
      }).join('');
    }

    const clickable = html.indexOf('data-isolate') !== -1;
    dom.legend.innerHTML = '<h3>Legend</h3><ul>' + html + '</ul>' +
      (state.isolate
        ? '<p class="legend-hint">' + esc(isolateSummary()) + '</p>'
        : (clickable
            ? '<p class="legend-hint">Click a group to isolate it on the map and in the table. ' +
              'The chips on a country do the same for the euro area, Schengen and NATO.</p>'
            : ''));
  }

  /* Two things can be isolated: a group within the current layer (everyone who
     voted against), or a bloc (everyone in the euro area). */
  function isolateMatches(code) {
    const isolate = state.isolate;
    if (!isolate) return true;
    if (isolate.kind === 'layer' && !state.decision) return true;

    if (isolate.kind === 'bloc') {
      const memberships = (statesByCode[code] || {}).memberships || {};
      const membership = memberships[isolate.key];
      return Boolean(membership && membership.member);
    }
    if (state.layer === 'press') {
      return Data.pressFraming(state.decision.countries[code]).framing === isolate.key;
    }
    return Data.countryPosition(state.decision, code).position === isolate.key;
  }

  const BLOC_LABEL = { euro: 'the euro area', schengen: 'the Schengen area', nato: 'NATO' };

  function isolateSummary() {
    const isolate = state.isolate;
    if (!isolate) return '';
    const inside = states.filter(function (item) { return isolateMatches(item.code); }).length;
    if (isolate.kind === 'bloc') {
      return 'Showing ' + BLOC_LABEL[isolate.key] + ' — ' + inside + ' of 27 member states. ' +
        'Click the chip again to bring the rest back.';
    }
    return 'Showing one group — ' + inside + ' of 27. Click it again to bring the rest back.';
  }

  function applyIsolation() {
    // A vote group cannot be isolated when no vote is open; a bloc always can.
    if (state.isolate && state.isolate.kind === 'layer' && !state.decision) state.isolate = null;
    if (map) map.setDimmed(state.isolate ? isolateMatches : null);
    Array.prototype.forEach.call(dom['country-table'].querySelectorAll('tr[data-code]'), function (row) {
      row.classList.toggle('is-dimmed',
        Boolean(state.isolate) && !isolateMatches(row.getAttribute('data-code')));
    });
    Array.prototype.forEach.call(dom['panel-body'].querySelectorAll('[data-bloc]'), function (chip) {
      const on = Boolean(state.isolate) && state.isolate.kind === 'bloc' &&
        state.isolate.key === chip.getAttribute('data-bloc');
      chip.setAttribute('aria-pressed', String(on));
    });
    renderLegend();
  }

  function setIsolate(kind, key) {
    const current = state.isolate;
    state.isolate = current && current.kind === kind && current.key === key
      ? null
      : { kind: kind, key: key };
    applyIsolation();
  }

  function setHovered(code) {
    if (map) map.setHovered(code);
    Array.prototype.forEach.call(dom['country-table'].querySelectorAll('tr[data-code]'), function (row) {
      row.classList.toggle('is-hovered', row.getAttribute('data-code') === code);
    });
  }

  /* ------------------------------------------------------------- roll-call */

  /* The whole vote, member by member where the record has them. Rendered on
     first open rather than on every decision load: it is 27 tables, and most
     readers never ask for it. */
  let rollCallFor = null;

  function renderRollCall() {
    const decision = state.decision;
    if (!decision || rollCallFor === decision.id) return;
    rollCallFor = decision.id;

    const filter = dom['roll-call-filter'].value.trim().toLowerCase();
    const blocks = states.map(function (item) {
      const country = decision.countries[item.code] || {};
      const position = Data.countryPosition(decision, item.code);
      const totals = Data.mepTotals(country);
      const meps = country.meps || [];

      const rows = meps.length
        ? meps.map(function (mep) {
            return '<tr><th scope="row">' + (mep.id
              ? '<button type="button" class="link-button" data-member="' + esc(mep.id) + '">' +
                esc(mep.name) + '</button>'
              : esc(mep.name)) + '</th>' +
              '<td>' + esc(mep.party || '—') + '</td>' +
              '<td>' + esc(mep.group || '—') + '</td>' +
              '<td><span class="vote-pill vote-' + esc(mep.vote) + '">' +
              esc(Panel.VOTE_LABEL[mep.vote] || mep.vote) + '</span></td></tr>';
          }).join('')
        : (country.mepGroups || []).map(function (group) {
            return '<tr><th scope="row">' + esc(group.group) + '</th>' +
              '<td>' + group.seats + ' seats</td>' +
              '<td class="numeric"><span class="n-for">' + (group.for || 0) + '</span> / ' +
                '<span class="n-against">' + (group.against || 0) + '</span> / ' +
                '<span class="n-abstain">' + (group.abstain || 0) + '</span></td>' +
              '<td>' + (group.absent || 0) + ' absent</td></tr>';
          }).join('');

      return {
        code: item.code,
        haystack: [item.name, item.code, Panel.VOTE_LABEL[position.position],
          meps.map(function (mep) { return mep.name + ' ' + mep.group + ' ' + (mep.party || ''); }).join(' '),
          (country.mepGroups || []).map(function (group) { return group.group; }).join(' ')
        ].join(' ').toLowerCase(),
        html: '<section class="roll-country" data-code="' + esc(item.code) + '">' +
          '<h4>' + esc(item.name) +
            '<span class="vote-pill vote-' + esc(position.position) + '">' +
            esc(Panel.VOTE_LABEL[position.position] || position.position) + '</span>' +
            (totals ? '<span class="roll-totals"><span class="n-for">' + totals.for +
              '</span> / <span class="n-against">' + totals.against +
              '</span> / <span class="n-abstain">' + totals.abstain + '</span></span>' : '') +
          '</h4>' +
          (rows
            ? '<table class="roll-table"><tbody>' + rows + '</tbody></table>'
            : '<p class="empty">No member-level record for this vote.</p>') +
          '</section>'
      };
    });

    dom.rollCall = blocks;
    dom['roll-call'].innerHTML =
      '<p class="roll-note">' + (blocks.some(function (b) { return b.html.indexOf('roll-table') !== -1; })
        ? 'Every member state, with the record this vote carries: each MEP by name where the ' +
          'roll-call has been imported, and the totals by political group otherwise.'
        : 'This record carries no member-level detail.') + '</p>' +
      blocks.map(function (block) { return block.html; }).join('');

    if (filter) filterRollCall(filter);
  }

  function filterRollCall(value) {
    const query = String(value || '').trim().toLowerCase();
    const blocks = dom.rollCall || [];
    Array.prototype.forEach.call(dom['roll-call'].querySelectorAll('.roll-country'), function (node) {
      const block = blocks.find(function (item) { return item.code === node.getAttribute('data-code'); });
      node.hidden = Boolean(query) && block && block.haystack.indexOf(query) === -1;
    });
  }

  /* ---------------------------------------------------------------- outcome */

  function meter(label, figure, rest, share, threshold, met) {
    const width = Math.min(100, share * 100).toFixed(1) + '%';
    return '<div class="meter ' + (met ? 'met' : 'unmet') + '">' +
      '<p class="meter-label">' + esc(label) + '</p>' +
      '<div class="meter-track" role="img" aria-label="' + esc(figure + ' ' + rest) + '">' +
        '<span class="meter-fill" data-width="' + width + '" style="width:0"></span>' +
        '<span class="meter-threshold" style="left:' + (threshold * 100).toFixed(1) + '%"></span>' +
      '</div>' +
      '<p class="meter-value"><strong>' + esc(figure) + '</strong> ' + esc(rest) + '</p>' +
    '</div>';
  }

  function renderOutcome() {
    const decision = state.decision;
    const result = decision.outcome || {};
    let html = '<a class="permalink vote-link" href="' + esc(permalink(state.country)) +
      '">Link to this vote</a>' +
      '<button type="button" class="replay">Replay</button>' +
      '<p class="outcome-result outcome-' + esc(result.result || 'unknown') + '">' +
      esc(result.headline || result.result || '') + '</p>';

    if (decision.body === 'council' && decision.voteRule === 'unanimity') {
      // Unanimity is a different arithmetic: population does not enter it, the
      // threshold is every member state, and an abstention is not a veto.
      const qmv = Data.qualifiedMajority(decision, states);
      const against = qmv.groups.against;
      html += '<div class="meters">' +
        meter('Member states in favour',
          qmv.statesFor + ' of 27', '— all 27 needed',
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
          qmv.statesFor + ' of 27', '— 15 needed',
          qmv.statesShare, 15 / 27, qmv.statesFor >= 15) +
        meter('Population represented',
          (qmv.populationShare * 100).toFixed(1) + '%', '— 65% needed',
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
            return '<div class="tally-cell tally-' + key + '">' +
              '<span class="tally-number" data-count="' + tally[key] + '">0</span>' +
              '<span class="tally-label">' + esc(Panel.VOTE_LABEL[key]) + '</span></div>';
          }).join('') +
          '</div>' +
          '<p class="outcome-note"><span class="n-for">' + cast + '</span> votes cast of 720 ' +
          'seats. A simple majority of votes cast carries the file.</p>';
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
        meps: totals,
        mepsKey: totals ? totals.for : -1,
        impact: impact,
        press: framing.count,
        framing: framing.framing
      };
    });
  }

  function showColumn(name, visible) {
    Array.prototype.forEach.call(
      dom['country-table'].querySelectorAll('[data-col="' + name + '"]'),
      function (cell) { cell.hidden = !visible; }
    );
  }

  function renderTable() {
    if (!state.decision) return;
    const rows = tableRows();
    // A sort held over from a decision that had a column this one lacks would
    // sort by nothing at all.
    if (sortKey === 'impact' && !hasImpact(state.decision)) sortKey = 'name';
    if (sortKey === 'meps' && !rows.some(function (row) { return row.meps; })) sortKey = 'name';
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

    const decision = state.decision;
    const body = dom['country-table'].querySelector('tbody');
    body.innerHTML = rows.map(function (row) {
      return '<tr data-code="' + row.code + '">' +
        '<th scope="row"><button type="button" class="link-button">' + esc(row.name) + '</button></th>' +
        '<td><span class="vote-pill vote-' + esc(row.positionKey) + '">' + esc(row.position) + '</span>' +
        '</td>' +
        '<td class="numeric" data-col="meps">' + (row.meps
          ? '<span class="n-for">' + row.meps.for + '</span> / ' +
            '<span class="n-against">' + row.meps.against + '</span> / ' +
            '<span class="n-abstain">' + row.meps.abstain + '</span>'
          : '—') + '</td>' +
        '<td class="numeric" data-col="impact"' + (row.impact === null ? ' hidden' : '') + '>' +
          esc(Data.formatImpact(row.impact, state.decision.impactUnit)) + '</td>' +
        '</tr>';
    }).join('');

    showColumn('impact', hasImpact(decision));
    showColumn('meps', Object.keys(decision.countries).some(function (code) {
      return Data.mepTotals(decision.countries[code]);
    }));
  }

  /* ---------------------------------------------------------------- routing */

  function permalink(code) {
    const id = state.decision ? state.decision.id : '';
    return '#/' + id + (code ? '/' + code : '');
  }

  function readHash() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    return { decisionId: parts[0] || null, code: (parts[1] || '').toUpperCase() || null };
  }

  /* The address bar is deliberately NOT a running record of what you clicked.
     Writing every selection into it meant a tab reopened days later came back
     on somebody's old vote instead of the search page. Links are made on
     demand instead — the "Link to this vote" control and the one in the
     country panel — and those links still open exactly what they name. */
  function writeHash() {
    return;
  }

  /* ---------------------------------------------------------------- render */

  function selectCountry(code, options) {
    state.country = code && statesByCode[code] ? code : null;
    if (map) map.setSelected(state.country);

    if (!state.country) {
      dom['panel-body'].hidden = true;
      dom['panel-empty'].hidden = false;
      dom['panel-empty'].querySelector('p').textContent = state.decision
        ? 'Every member state holds the same answers for this vote: how it voted, and how ' +
          'its own press told the story.'
        : 'Click any member state to see who they are and which clubs they are in. Pick a ' +
          'vote from the list to see how they voted.';
    } else {
      dom['panel-empty'].hidden = true;
      if (state.decision) {
        Panel.render(dom['panel-body'], state.decision, statesByCode[state.country],
          permalink(state.country));
      } else {
        Panel.renderProfile(dom['panel-body'], statesByCode[state.country],
          permalink(state.country));
      }
      if (state.isolate) applyIsolation();
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
    const roll = Object.keys(decision.countries).some(function (code) {
      return Data.mepTotals(decision.countries[code]);
    });
    showColumn('impact', costs);
    showColumn('meps', roll);
    document.getElementById('tab-impact').hidden = !costs;

    // Twenty-seven rows all reading "No vote taken" is a table that answers
    // nothing. Say it once instead.
    const tabulable = roll || Object.keys(decision.countries).some(function (code) {
      const position = decision.countries[code].position;
      return position && position !== 'not-applicable';
    });
    dom['country-table'].parentNode.hidden = !tabulable;
    dom['table-empty'].hidden = tabulable;
    dom['table-empty'].textContent = tabulable ? '' :
      'No member state cast a vote on this act, so there is nothing to tabulate. ' +
      'What each country got out of it is in the map and the country panels.';
    if (!state.layerChosen) {
      // "How they voted" is an empty question for an act nobody voted on, so a
      // Commission file opens on the coverage instead.
      setLayer(decision.body === 'commission' ? 'press' : 'vote');
    } else if (!costs && state.layer === 'impact') {
      setLayer('vote');
    }

    rollCallFor = null;
    dom['roll-call-detail'].open = false;
    dom['roll-call'].innerHTML = '';
    renderOutcome();
    paint();
    renderTable();
    renderFeed();
    renderMepResults();
  }

  /* Nothing open: the map is the Union, the list is the way in. */
  function clearDecision(options) {
    if (map) map.stop();
    state.decision = null;
    state.member = null;
    dom['member-section'].hidden = true;
    document.getElementById('country-panel').hidden = false;
    state.isolate = null;
    state.layerChosen = false;
    state.layer = 'vote';
    dom['decision-section'].hidden = true;
    // The whole section, not just the table: an empty "All 27 member states"
    // heading on the landing page is a promise with nothing behind it.
    document.querySelector('.table-section').hidden = true;
    dom['table-empty'].hidden = true;
    document.querySelector('.layer-tabs').hidden = true;
    dom['map-hint'].textContent = 'Click a member state for its profile, or pick a vote ' +
      'from the list to see how the Union split.';
    if (map) map.revealAll();
    paint();
    renderFeed();
    renderMepResults();
    selectCountry((options && options.country) || null, { scroll: false });
  }

  async function loadDecision(id, code) {
    if (!id) {
      clearDecision({ country: code });
      return;
    }
    const entry = index.decisions.find(function (item) { return item.id === id; });
    if (!entry) {
      clearDecision({ country: code });
      return;
    }
    if (!cache[entry.id]) {
      cache[entry.id] = Data.expandBallots(await Data.getJSON(entry.file), directory);
    }
    const changed = !state.decision || state.decision.id !== entry.id;
    state.member = null;
    dom['member-section'].hidden = true;
    document.getElementById('country-panel').hidden = false;
    state.decision = cache[entry.id];
    state.isolate = null;
    dom['decision-section'].hidden = false;
    document.querySelector('.table-section').hidden = false;
    document.querySelector('.layer-tabs').hidden = false;
    dom['map-hint'].textContent = 'Click a member state to open its record. ' +
      'Click the sea to close it. Arrow keys move between countries.';
    renderDecision();
    selectCountry(code || null, { scroll: false });
    if (changed) playReveal();
  }

  /* The outcome first — the whole Union in the colour of the result — then
     each member state turning to its own vote, west to east. */
  function playReveal() {
    if (!map || !state.decision) return;
    const result = (state.decision.outcome && state.decision.outcome.result) || 'recorded';
    const hold = REDUCED.matches ? 0 : 620;
    map.play('result-' + result, { hold: hold, step: 46 });
    animateOutcome(hold);
  }

  function setLayer(layer, chosen) {
    // "Against" means nothing once the map is showing press framing. A bloc
    // still does, so that one stays.
    if (layer !== state.layer && state.isolate && state.isolate.kind === 'layer') {
      state.isolate = null;
    }
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
      const [reference, geo, decisionIndex, plenary, members, people] = await Promise.all([
        Data.getJSON('data/reference/member-states.json'),
        Data.getJSON('data/eu-countries.geo.json'),
        Data.getJSON('data/decisions/index.json'),
        Data.getJSON('data/reference/plenary-calendar.json').catch(function () {
          return { sessions: [] };
        }),
        // Identities live here, once, rather than inside every vote record.
        Data.getJSON('data/reference/meps.json').catch(function () { return null; }),
        // Every member, for search; their voting records load one at a time.
        Data.getJSON('data/meps/index.json').catch(function () { return null; })
      ]);
      calendar = plenary || { sessions: [] };
      directory = members && members.members ? members.members : null;
      memberIndex = (people && people.members) || null;

      states = reference.states;
      statesByCode = {};
      states.forEach(function (item) { statesByCode[item.code] = item; });
      Panel.setStates(states);
      index = decisionIndex;

      const counts = index.decisions.reduce(function (totals, item) {
        totals[item.body] = (totals[item.body] || 0) + 1;
        return totals;
      }, {});
      dom['header-count'].textContent = index.decisions.length + ' votes tracked · ' +
        (counts.parliament || 0) + ' Parliament · ' + (counts.council || 0) + ' Council · ' +
        (counts.commission || 0) + ' Commission' +
        (index.metadata && index.metadata.updated
          ? ' · updated ' + Data.formatDate(index.metadata.updated) : '');

      index.decisions.forEach(function (item) {
        if (item.sourceId) bySourceId[item.sourceId] = item;
      });

      renderPlenary();
      renderFeed();

      map = new EUMap(dom.map, geo, {
        onSelect: function (code) { selectCountry(code); },
        onDeselect: function () { selectCountry(null); },
        onHover: function (code) { setHovered(code); }
      });

      // A shared link opens what it names. Then the hash is cleared, so
      // reopening or reloading that tab lands on the search page rather than on
      // whatever was last looked at.
      const route = readHash();
      await loadDecision(route.decisionId, route.code);
      if (location.hash) {
        try {
          history.replaceState(null, '', location.pathname + location.search);
        } catch (error) {
          // a sandbox that refuses history writes: nothing else to do
        }
      }

      dom['session-list'].addEventListener('click', function (event) {
        const card = event.target.closest('.decision-card');
        if (card) {
          loadDecision(card.getAttribute('data-id'), state.country);
          return;
        }
        if (event.target.closest('#unfold-all')) {
          state.unfolded = !state.unfolded;
          renderFeed();
        }
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (button) {
        button.addEventListener('click', function () {
          setFilter(button.getAttribute('data-filter'));
        });
      });

      dom['search-input'].addEventListener('input', function (event) {
        setQuery(event.target.value);
      });
      dom['search-input'].addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && dom['search-input'].value) {
          event.stopPropagation();
          dom['search-input'].value = '';
          setQuery('');
        }
      });
      dom['search-clear'].addEventListener('click', function () {
        dom['search-input'].value = '';
        setQuery('');
        dom['search-input'].focus();
      });

      dom['mep-results'].addEventListener('click', function (event) {
        const hit = event.target.closest('.mep-hit');
        if (!hit) return;
        if (hit.hasAttribute('data-member')) {
          showMember(hit.getAttribute('data-member'));
        } else {
          selectCountry(hit.getAttribute('data-code'));
        }
      });

      dom['member-votes'].addEventListener('click', function (event) {
        const row = event.target.closest('.member-vote');
        if (row) loadDecision(row.getAttribute('data-id'), state.country);
      });

      dom['member-filter'].addEventListener('input', renderMemberVotes);

      dom['back-from-member'].addEventListener('click', function () {
        clearDecision();
        dom['search-input'].focus();
      });

      // Escape closes the open country from anywhere on the page.
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && state.country) selectCountry(null);
      });

      dom['panel-body'].addEventListener('click', function (event) {
        if (event.target.closest('.panel-close')) {
          selectCountry(null);
          return;
        }
        const chip = event.target.closest('[data-bloc]');
        if (chip) setIsolate('bloc', chip.getAttribute('data-bloc'));
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (tab) {
        tab.addEventListener('click', function () { setLayer(tab.getAttribute('data-layer'), true); });
      });

      dom['country-table'].addEventListener('click', function (event) {
        const button = event.target.closest('.link-button');
        if (!button) return;
        selectCountry(button.closest('tr').getAttribute('data-code'));
      });

      // Pointing at a row lights up the country, and the other way round.
      dom['country-table'].addEventListener('mouseover', function (event) {
        const row = event.target.closest('tr[data-code]');
        setHovered(row ? row.getAttribute('data-code') : null);
      });
      dom['country-table'].addEventListener('mouseleave', function () { setHovered(null); });

      dom.legend.addEventListener('click', function (event) {
        const button = event.target.closest('[data-isolate]');
        if (button) setIsolate('layer', button.getAttribute('data-isolate'));
      });

      dom.outcome.addEventListener('click', function (event) {
        if (event.target.closest('.replay')) playReveal();
      });

      dom['roll-call-detail'].addEventListener('toggle', function () {
        if (dom['roll-call-detail'].open) renderRollCall();
      });
      dom['roll-call-filter'].addEventListener('input', function (event) {
        filterRollCall(event.target.value);
      });
      dom['roll-call'].addEventListener('click', function (event) {
        const member = event.target.closest('[data-member]');
        if (member) {
          showMember(member.getAttribute('data-member'));
          return;
        }
        const country = event.target.closest('.roll-country');
        if (country) selectCountry(country.getAttribute('data-code'));
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

      dom['back-to-votes'].addEventListener('click', function () {
        clearDecision();
        dom['search-input'].focus();
      });

      window.addEventListener('hashchange', function () {
        const next = readHash();
        const current = state.decision ? state.decision.id : null;
        if (next.decisionId !== current) {
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
