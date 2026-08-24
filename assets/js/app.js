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
  let outside = null;          // the countries the map draws in grey
  let memberIndex = null;      // every MEP, for search
  let manyBodies = false;      // is there more than one institution to filter between?
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
   'decision-date', 'decision-title', 'decision-subtitle', 'decision-summary', 'vote-links',
   'outcome', 'map', 'legend', 'map-heading', 'map-hint',
   'panel-empty', 'panel-body', 'header-count',
   'header-plenary', 'search-input', 'search-clear', 'search-status',
   'mep-results', 'decision-section', 'back-to-votes', 'session-list',
   'roll', 'roll-bar', 'roll-summary', 'roll-count', 'roll-body', 'roll-name',
   'roll-group', 'roll-country', 'roll-position', 'roll-reset', 'member-section', 'member-name', 'member-group',
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

  /* Every word has to match, and a word matches where a word starts: "ukrain"
     finds Ukraine, but "euro" does not match every record through the middle of
     some unrelated word. */
  function wordTest(word) {
    return new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }

  function matches(item) {
    if (!state.query) return true;
    return state.query.split(/\s+/).every(function (word) {
      return wordTest(word).test(item.keywords);
    });
  }

  /* Members are searched across the whole term, not only inside whatever vote
     happens to be open: following one MEP is the point of the site. */
  function mepMatches() {
    if (!state.query || !memberIndex) return [];
    const tests = state.query.split(/\s+/).map(wordTest);
    return memberIndex.filter(function (member) {
      return tests.every(function (test) { return test.test(member.keywords); });
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
    renderFeed();

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
    // Reading one vote should not mean scrolling past every other one. The list
    // steps aside while a vote or a member is open, and comes back the moment
    // you search or ask for all votes again.
    const browsing = Boolean(state.query) || !(state.decision || state.member);
    dom['session-list'].hidden = !browsing;
    document.querySelector('.tracker-filters').hidden = !browsing || !manyBodies;
    document.getElementById('intro').hidden = !browsing;
    if (!browsing) {
      dom['search-status'].hidden = true;
      return;
    }

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

    // A search is a search, not a tour of the calendar: results come back as a
    // flat list, newest first, rather than unfolding every session they touch.
    if (state.query) {
      const shown = items.slice(0, 50);
      dom['session-list'].innerHTML = shown.length
        ? '<ul class="decision-list">' + shown.map(function (item) {
            return decisionCard(item, true);
          }).join('') + '</ul>' +
          (items.length > shown.length
            ? '<p class="feed-empty">Showing the first ' + shown.length + ' of ' +
              items.length + '. Add a word to narrow it down.</p>'
            : '')
        : '<p class="feed-empty">Nothing here matches that. Try a procedure reference, ' +
          'or a word from the title.</p>';
      return;
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

  function decisionCard(item, withDate) {
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
          (withDate
            ? '<span class="card-rule">' + esc(Data.formatDate(item.date)) + '</span>'
            : (item.voteRuleLabel
                ? '<span class="card-rule">' + esc(item.voteRuleLabel) + '</span>' : '')) +
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
      dom.legend.innerHTML = '<ul>' +
        legendRow('layer-neutral', 'Member state of the European Union') +
        '<li><span class="swatch swatch-context"></span>Europe outside the Union</li>' +
        '</ul><p class="legend-hint">Pick a vote to colour the map by how each member ' +
        'state voted, or click a country for its own record.</p>';
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
    dom.legend.innerHTML = '<ul>' + html + '</ul>' +
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
    Array.prototype.forEach.call(dom['roll-body'].querySelectorAll('[data-code]'), function (row) {
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
    Array.prototype.forEach.call(dom['roll-body'].querySelectorAll('[data-code]'), function (row) {
      row.classList.toggle('is-hovered', row.getAttribute('data-code') === code);
    });
  }

  /* ------------------------------------------------------------- roll-call */

  const POSITIONS = ['for', 'against', 'abstain', 'absent'];

  const roll = { tab: 'members', name: '', group: '', country: '', position: '' };


  /* Every ballot in the open vote, flattened once, with everything the filters
     and the three breakdowns need. */
  function ballotList() {
    const decision = state.decision;
    if (!decision) return [];
    const out = [];
    Object.keys(decision.countries).forEach(function (code) {
      (decision.countries[code].meps || []).forEach(function (mep) {
        out.push({
          id: mep.id,
          name: mep.name,
          group: mep.group || 'NI',
          country: code,
          countryName: (statesByCode[code] || {}).name || code,
          position: mep.vote,
          haystack: (mep.name + ' ' + (mep.party || '')).toLowerCase()
        });
      });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  function tally(list) {
    const totals = { for: 0, against: 0, abstain: 0, absent: 0 };
    list.forEach(function (item) { totals[item.position] += 1; });
    return totals;
  }

  function filtered(list) {
    return list.filter(function (item) {
      if (roll.group && item.group !== roll.group) return false;
      if (roll.country && item.country !== roll.country) return false;
      if (roll.position && item.position !== roll.position) return false;
      if (roll.name && item.haystack.indexOf(roll.name) === -1) return false;
      return true;
    });
  }

  function share(count, total) {
    return total ? Math.round((count / total) * 100) : 0;
  }

  /* The bar: the whole chamber in one line, each part clickable, because the
     first thing a reader wants after seeing "32% against" is the 32%. */
  function renderBar(totals) {
    const cast = totals.for + totals.against + totals.abstain;
    const segments = ['for', 'against', 'abstain'].filter(function (key) { return totals[key]; });

    dom['roll-bar'].innerHTML = segments.map(function (key) {
      const percent = share(totals[key], cast);
      return '<button type="button" class="seg seg-' + key +
        (roll.position === key ? ' is-active' : '') + '" data-position="' + key + '"' +
        ' style="flex: ' + totals[key] + ' 1 0"' +
        ' aria-pressed="' + (roll.position === key ? 'true' : 'false') + '"' +
        ' title="' + esc(Panel.VOTE_LABEL[key]) + ': ' + totals[key] + ' members">' +
        '<span class="seg-value">' + percent + '%</span>' +
        '<span class="seg-label">' + esc(Panel.VOTE_LABEL[key]) + '</span>' +
        '</button>';
    }).join('') + (totals.absent
      ? '<button type="button" class="seg seg-absent' + (roll.position === 'absent' ? ' is-active' : '') +
        '" data-position="absent" aria-pressed="' + (roll.position === 'absent' ? 'true' : 'false') +
        '" title="Did not vote: ' + totals.absent + ' members">' +
        '<span class="seg-value">' + totals.absent + '</span>' +
        '<span class="seg-label">absent</span></button>'
      : '');

    const decision = state.decision;
    const result = (decision.outcome && decision.outcome.result) || 'recorded';
    dom['roll-summary'].innerHTML =
      '<span class="result result-' + esc(result) + '">' +
        esc(RESULT_LABEL[result] || result) + '</span> · ' +
      '<span class="n-for">' + totals.for + '</span> in favour, ' +
      '<span class="n-against">' + totals.against + '</span> against, ' +
      '<span class="n-abstain">' + totals.abstain + '</span> abstained. ' +
      cast + ' of ' + (cast + totals.absent) + ' members voted; ' +
      '<span class="n-absent">' + totals.absent + '</span> did not.';
  }

  function renderMembersTab(list) {
    if (!list.length) return '<p class="empty">No member matches these filters.</p>';
    return '<ul class="roll-members">' + list.slice(0, 800).map(function (item) {
      return '<li data-code="' + esc(item.country) + '">' +
        '<button type="button" class="roll-member" data-member="' + esc(item.id) + '">' +
          '<span class="rm-name">' + esc(item.name) + '</span>' +
          '<span class="rm-meta">' + esc(item.countryName) + ' · ' + esc(item.group) + '</span>' +
          '<span class="vote-pill vote-' + item.position + '">' +
            esc(Panel.VOTE_LABEL[item.position]) + '</span>' +
        '</button></li>';
    }).join('') + '</ul>' +
      (list.length > 800 ? '<p class="empty">Showing the first 800. Filter to narrow it down.</p>' : '');
  }

  /* A row per group or per country: who they are, how many of them voted, and
     the shape of that vote. The bar is the same instrument as the one at the
     top of the page, at a smaller size, so the two read together. */
  function breakdownRows(list, keyOf, labelOf, tileOf, kind) {
    const groups = {};
    list.forEach(function (item) {
      const key = keyOf(item);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    const rows = Object.keys(groups).map(function (key) {
      const totals = tally(groups[key]);
      return {
        key: key,
        label: labelOf(key),
        tile: tileOf(key),
        size: groups[key].length,
        totals: totals,
        cast: totals.for + totals.against + totals.abstain
      };
    });
    rows.sort(function (a, b) { return b.size - a.size; });

    if (!rows.length) return '<p class="empty">Nothing matches these filters.</p>';

    return '<ul class="breakdown">' + rows.map(function (row) {
      const parts = POSITIONS.filter(function (key) { return row.totals[key]; })
        .map(function (key) {
          const percent = share(row.totals[key], row.size);
          return '<span class="bd-seg bd-' + key + '" style="flex:' + row.totals[key] + ' 1 0"' +
            ' title="' + esc(Panel.VOTE_LABEL[key]) + ': ' + row.totals[key] +
            ' (' + percent + '%)"></span>';
        }).join('');

      return '<li' + (kind === 'country' ? ' data-code="' + esc(row.key) + '"' : '') + '>' +
        '<button type="button" class="breakdown-row"' +
          (kind === 'country'
            ? ' data-country="' + esc(row.key) + '"'
            : ' data-group="' + esc(row.key) + '"') + '>' +
          tile(row, kind) +
          '<span class="bd-main">' +
            '<span class="bd-label">' + esc(row.label) + '</span>' +
            '<span class="bd-sub">' + row.cast + ' of ' + row.size + ' members voted' +
              (row.cast
                ? ' · <span class="n-for">' + row.totals.for + '</span> for, ' +
                  '<span class="n-against">' + row.totals.against + '</span> against, ' +
                  '<span class="n-abstain">' + row.totals.abstain + '</span> abstained'
                : '') +
            '</span>' +
            '<span class="bd-bar">' + parts + '</span>' +
          '</span>' +
        '</button></li>';
    }).join('') + '</ul>';
  }

  /* A group's own logo where one has been added, its conventional colour
     otherwise. The image is swapped in only once it has actually loaded, so a
     missing file leaves the tile alone rather than leaving a hole. */
  function tile(row, kind) {
    if (kind !== 'group') {
      return '<span class="bd-tile bd-tile-country">' + esc(row.tile) + '</span>';
    }
    return Groups.mark(row.key);
  }

  function renderRoll() {
    const decision = state.decision;
    if (!decision) return;

    const all = ballotList();
    if (!all.length) {
      dom.roll.hidden = true;
      return;
    }
    dom.roll.hidden = false;

    renderBar(tally(all));

    // The dropdowns list what this vote actually contains, not a fixed menu.
    const groups = [...new Set(all.map(function (item) { return item.group; }))].sort();
    const countries = [...new Set(all.map(function (item) { return item.country; }))]
      .sort(function (a, b) {
        return ((statesByCode[a] || {}).name || a).localeCompare((statesByCode[b] || {}).name || b);
      });

    fillSelect(dom['roll-group'], 'All groups', groups.map(function (g) { return [g, g]; }), roll.group);
    fillSelect(dom['roll-country'], 'All countries', countries.map(function (code) {
      return [code, (statesByCode[code] || {}).name || code];
    }), roll.country);
    fillSelect(dom['roll-position'], 'All positions', POSITIONS.map(function (key) {
      return [key, Panel.VOTE_LABEL[key]];
    }), roll.position);

    const list = filtered(all);
    const active = Boolean(roll.name || roll.group || roll.country || roll.position);
    dom['roll-reset'].hidden = !active;

    dom['roll-count'].textContent = active
      ? list.length + ' of ' + all.length + ' members match'
      : all.length + ' members';

    Array.prototype.forEach.call(document.querySelectorAll('[data-roll-tab]'), function (tab) {
      tab.setAttribute('aria-selected', String(tab.getAttribute('data-roll-tab') === roll.tab));
    });

    if (roll.tab === 'groups') {
      dom['roll-body'].innerHTML = breakdownRows(list,
        function (item) { return item.group; },
        Groups.name,
        Groups.tile,
        'group');
    } else if (roll.tab === 'countries') {
      dom['roll-body'].innerHTML = breakdownRows(list,
        function (item) { return item.country; },
        function (key) { return (statesByCode[key] || {}).name || key; },
        function (key) { return key; },
        'country');
    } else {
      dom['roll-body'].innerHTML = renderMembersTab(list);
    }

    // Wherever a group mark has just been drawn, its logo replaces the tile.
    Groups.loadLogos(dom['roll-body']);
    if (state.isolate) applyIsolation();
  }

  function fillSelect(select, allLabel, options, value) {
    select.innerHTML = '<option value="">' + esc(allLabel) + '</option>' +
      options.map(function (pair) {
        return '<option value="' + esc(pair[0]) + '"' +
          (pair[0] === value ? ' selected' : '') + '>' + esc(pair[1]) + '</option>';
      }).join('');
  }

  function setRoll(changes) {
    Object.assign(roll, changes);
    renderRoll();
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
    let html =
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
      // The stacked bar below carries the numbers; repeating them here twice
      // over would just be furniture.
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

  /* ---------------------------------------------------------------- routing */

  function permalink(code) {
    const id = state.decision ? state.decision.id : '';
    return '#/' + id + (code ? '/' + code : '');
  }

  /* An address someone can paste somewhere, not a fragment that only means
     something inside this page. */
  function shareUrl(code) {
    return location.origin + location.pathname + location.search + permalink(code);
  }

  async function copyLink(button) {
    const text = button.getAttribute('data-copy');
    const original = button.textContent;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (error) {
      // Clipboard access can be refused; fall back to selecting the text so the
      // reader can copy it themselves.
      const field = document.createElement('input');
      field.value = text;
      field.className = 'copy-fallback';
      button.after(field);
      field.select();
      copied = document.execCommand && document.execCommand('copy');
      field.remove();
    }
    button.textContent = copied ? 'Link copied' : text;
    window.setTimeout(function () { button.textContent = original; }, copied ? 1600 : 6000);
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

  /* Clicking a grey country opens its profile, in the same place a member
     state's record appears. */
  function selectOutside(code) {
    const country = outside && outside[code];
    if (!country) return;
    if (map) map.setSelected(code);
    state.country = null;
    dom['panel-empty'].hidden = true;
    document.getElementById('country-panel').hidden = false;
    Panel.renderOutside(dom['panel-body'], code, country);
    const narrow = window.matchMedia('(max-width: 62rem)').matches;
    if (narrow) dom['panel-body'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectCountry(code, options) {
    state.country = code && statesByCode[code] ? code : null;
    if (map) map.setSelected(state.country);

    // Picking a country narrows the roll-call to its members: the question
    // after clicking Spain is who in Spain voted which way.
    if (state.decision && (roll.country || state.country)) {
      setRoll({ country: state.country || '', tab: state.country ? 'members' : roll.tab });
    }

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
          shareUrl(state.country));
      } else {
        Panel.renderProfile(dom['panel-body'], statesByCode[state.country],
          shareUrl(state.country));
      }
      if (state.isolate) applyIsolation();
      // On a narrow screen the panel is far below the map, so bring it into
      // view; on a wide one it is already beside the map and must not jump.
      const narrow = window.matchMedia('(max-width: 62rem)').matches;
      if (narrow && (!options || options.scroll !== false)) {
        dom['panel-body'].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    Array.prototype.forEach.call(dom['roll-body'].querySelectorAll('[data-code]'), function (row) {
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



    // Links that open, in one line under the vote: the Parliament's own file
    // for this procedure, and the annex the record was read from.
    const links = [];
    const reference = decision.procedure && decision.procedure.reference;
    if (reference) {
      links.push({
        url: decision.procedure.url ||
          // The slash belongs in a procedure reference; encoding it breaks the
          // lookup on the Parliament's side.
          'https://oeil.europarl.europa.eu/oeil/en/procedure-file?reference=' +
          encodeURIComponent(reference).replace(/%2F/g, '/'),
        label: 'Procedure file ' + reference
      });
    }
    (decision.sources || []).forEach(function (source) {
      if (source.url) links.push({ url: source.url, label: source.label });
    });

    dom['vote-links'].innerHTML = links.map(function (link) {
      return '<a class="vote-source" href="' + esc(link.url) +
        '" target="_blank" rel="noopener noreferrer">' + esc(link.label) +
        '<span aria-hidden="true"> ↗</span></a>';
    }).join('') +
      '<a class="vote-source vote-share" href="' + esc(shareUrl()) + '" data-copy="' +
      esc(shareUrl()) + '">Copy link to this vote</a>';
    dom['vote-links'].hidden = false;

    const isSample = decision.status === 'sample';
    dom['decision-status'].hidden = !isSample;
    dom['sample-banner'].hidden = !isSample;

    const costs = hasImpact(decision);
    document.getElementById('tab-impact').hidden = !costs;

    const press = Object.keys(decision.countries).some(function (code) {
      return (decision.countries[code].press || []).length;
    });
    document.getElementById('tab-press').hidden = !press;
    if (!press && state.layer === 'press') setLayer('vote');
    if (!state.layerChosen) {
      // "How they voted" is an empty question for an act nobody voted on, so a
      // Commission file opens on the coverage instead.
      setLayer(decision.body === 'commission' ? 'press' : 'vote');
    } else if (!costs && state.layer === 'impact') {
      setLayer('vote');
    }

    roll.name = '';
    roll.group = '';
    roll.country = '';
    roll.position = '';
    roll.tab = 'members';
    if (dom['roll-name']) dom['roll-name'].value = '';

    renderOutcome();
    renderRoll();
    paint();
    renderFeed();
    renderMepResults();
  }

  /* "All votes" means all of them: a search left over from finding this vote
     would otherwise hand back an empty list. */
  function backToVotes() {
    dom['search-input'].value = '';
    state.query = '';
    dom['search-clear'].hidden = true;
    clearDecision();
    dom['search-input'].focus();
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
      const [reference, geo, decisionIndex, plenary, members, people, neighbours] =
        await Promise.all([
        Data.getJSON('data/reference/member-states.json'),
        Data.getJSON('data/eu-countries.geo.json'),
        Data.getJSON('data/decisions/index.json'),
        Data.getJSON('data/reference/plenary-calendar.json').catch(function () {
          return { sessions: [] };
        }),
        // Identities live here, once, rather than inside every vote record.
        Data.getJSON('data/reference/meps.json').catch(function () { return null; }),
        // Every member, for search; their voting records load one at a time.
        Data.getJSON('data/meps/index.json').catch(function () { return null; }),
        Data.getJSON('data/reference/neighbours.json').catch(function () { return null; })
      ]);
      calendar = plenary || { sessions: [] };
      directory = members && members.members ? members.members : null;
      memberIndex = (people && people.members) || null;
      outside = (neighbours && neighbours.countries) || {};

      states = reference.states;
      statesByCode = {};
      states.forEach(function (item) { statesByCode[item.code] = item; });
      Panel.setStates(states);
      index = decisionIndex;

      const counts = index.decisions.reduce(function (totals, item) {
        totals[item.body] = (totals[item.body] || 0) + 1;
        return totals;
      }, {});
      dom['header-count'].textContent = index.decisions.length.toLocaleString('en-GB') +
        ' roll-call votes' +
        (index.metadata && index.metadata.updated
          ? ' · updated ' + Data.formatDate(index.metadata.updated) : '');

      // Institutions with nothing in them are not offered as filters: an empty
      // shelf reads as a broken site rather than an honest gap.
      Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (button) {
        const body = button.getAttribute('data-filter');
        button.hidden = body !== 'all' && !counts[body];
      });
      manyBodies = Object.keys(counts).filter(function (key) { return counts[key]; }).length > 1;

      // Two numbers, both facts: the votes held, and the seats in the chamber.
      const seats = states.reduce(function (sum, item) { return sum + item.seats; }, 0);
      document.getElementById('intro-stats').textContent =
        index.decisions.length.toLocaleString('en-GB') + ' votes · ' + seats + ' seats · ' +
        'since 16 July 2024';

      index.decisions.forEach(function (item) {
        if (item.sourceId) bySourceId[item.sourceId] = item;
      });

      renderPlenary();
      renderFeed();

      map = new EUMap(dom.map, geo, {
        onSelect: function (code) { selectCountry(code); },
        onDeselect: function () { selectCountry(null); },
        onHover: function (code) { setHovered(code); },
        onOutside: function (code) { selectOutside(code); }
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
        backToVotes();
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
        const inRoll = event.target.closest('.show-in-roll');
        if (inRoll) {
          setRoll({ country: inRoll.getAttribute('data-country'), tab: 'members' });
          dom.roll.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        const chip = event.target.closest('[data-bloc]');
        if (chip) setIsolate('bloc', chip.getAttribute('data-bloc'));
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (tab) {
        tab.addEventListener('click', function () { setLayer(tab.getAttribute('data-layer'), true); });
      });


      dom.legend.addEventListener('click', function (event) {
        const button = event.target.closest('[data-isolate]');
        if (button) setIsolate('layer', button.getAttribute('data-isolate'));
      });

      // Copy-link controls, wherever they appear. They are real links, so a
      // modifier click opens them in a tab as any link would; a plain click
      // copies the address instead of reloading the page you are already on.
      document.addEventListener('click', function (event) {
        const control = event.target.closest('[data-copy]');
        if (!control) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        copyLink(control);
      });

      // The bar is a filter: click "Against" to see only those who did.
      dom['roll-bar'].addEventListener('click', function (event) {
        const segment = event.target.closest('[data-position]');
        if (!segment) return;
        const position = segment.getAttribute('data-position');
        setRoll({ position: roll.position === position ? '' : position, tab: 'members' });
        dom['roll-count'].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-roll-tab]'), function (tab) {
        tab.addEventListener('click', function () {
          setRoll({ tab: tab.getAttribute('data-roll-tab') });
        });
      });

      dom['roll-name'].addEventListener('input', function (event) {
        setRoll({ name: event.target.value.trim().toLowerCase() });
      });
      dom['roll-group'].addEventListener('change', function (event) {
        setRoll({ group: event.target.value });
      });
      dom['roll-country'].addEventListener('change', function (event) {
        setRoll({ country: event.target.value });
      });
      dom['roll-position'].addEventListener('change', function (event) {
        setRoll({ position: event.target.value });
      });
      dom['roll-reset'].addEventListener('click', function () {
        dom['roll-name'].value = '';
        setRoll({ name: '', group: '', country: '', position: '' });
      });

      dom['roll-body'].addEventListener('click', function (event) {
        const member = event.target.closest('[data-member]');
        if (member) {
          showMember(member.getAttribute('data-member'));
          return;
        }
        const country = event.target.closest('[data-country]');
        if (country) selectCountry(country.getAttribute('data-country'));
        const group = event.target.closest('[data-group]');
        if (group) setRoll({ group: group.getAttribute('data-group'), tab: 'members' });
      });

      dom['roll-body'].addEventListener('mouseover', function (event) {
        const row = event.target.closest('[data-code]');
        setHovered(row ? row.getAttribute('data-code') : null);
      });
      dom['roll-body'].addEventListener('mouseleave', function () { setHovered(null); });

      dom['back-to-votes'].addEventListener('click', function () {
        backToVotes();
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
