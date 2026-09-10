/* Wiring: load the data, keep one piece of state (decision, layer, country),
   and let the URL carry it so a journalist can link straight to a country. 

   SPDX-License-Identifier: AGPL-3.0-or-later
*/
(function () {
  'use strict';

  // layerChosen records whether the reader picked the layer or the page did:
  // an automatic default re-derives for each decision, a deliberate choice sticks.
  const state = {
    decision: null, layer: 'vote', layerChosen: false,
    country: null, filter: 'all', isolate: null, query: '', unfolded: false, member: null,
    // The neighbour whose record is open, if any. It is not `country`: a
    // neighbour has no seats and never narrows the roll-call.
    outside: null
  };

  let calendar = { sessions: [] };
  let directory = null;
  let geoData = null;          // the outlines, kept for the story card
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

  /* The panel has two headings — the prompt when nothing is open, and the
     country's name when something is. Only one of them exists at a time as far
     as a reader is concerned, so the section points at whichever is showing;
     naming a hidden heading is how a panel ends up announced as "Pick a
     country" while Germany is on screen. */
  function panelLabelled(id) {
    const panel = document.getElementById('country-panel');
    if (panel) panel.setAttribute('aria-labelledby', id);
  }

  /* Going back.

     The address bar is deliberately not a running record of what you clicked —
     a tab reopened days later should come back on the search page, not on
     somebody's old vote. But a reader who has just opened a vote, or a country,
     expects the browser's Back button and a phone's back gesture to close it
     again rather than leave the site.

     So each thing you open pushes a history entry at the address you are
     already on: the address bar does not change, and Back has something to pop.
     Popping it undoes exactly one step, innermost first. The close buttons go
     through the same door, so the two can never drift apart. */
  const backStack = [];

  function openStep(undo) {
    backStack.push(undo);
    try {
      history.pushState({ euTracker: backStack.length }, '', location.href);
    } catch (error) {
      backStack.pop(); // a browser that will not take the entry keeps the button
    }
  }

  function closeStep(fallback) {
    if (backStack.length) {
      history.back();   // the popstate handler does the closing
      return;
    }
    if (fallback) fallback();
  }

  function popStep() {
    const undo = backStack.pop();
    if (undo) undo();
  }

  ['sample-banner', 'sample-banner-text', 'decision-list', 'decision-body', 'decision-status',
   'decision-date', 'decision-title', 'decision-subtitle', 'decision-summary', 'vote-links', 'vote-share',
   'outcome', 'map', 'legend', 'map-heading', 'map-hint',
   'panel-empty', 'panel-body', 'header-plenary', 'search-input', 'search-clear', 'search-status',
   'member-face', 'member-party',
   'mep-results', 'decision-section', 'back-to-votes', 'session-list',
   'roll', 'roll-bar', 'roll-summary', 'roll-count', 'roll-body', 'roll-name',
   'roll-group', 'roll-country', 'roll-position', 'roll-reset', 'member-section', 'member-name', 'member-group',
   'member-country', 'member-summary', 'member-totals', 'member-votes', 'member-filter',
   'member-count', 'back-from-member', 'map-back', 'brand-home'].forEach(function (id) {
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

  /* The seat count in a country's panel is a door. Behind it are the members
     who hold those seats, by name, each one opening their own record.

     A country can show more members than it has seats: a seat changes hands
     when someone resigns or is elected to something else, and everyone who has
     held one this term is in the directory. Where the two numbers differ the
     list says so rather than looking like a miscount. */
  function surnameKey(name) {
    const parts = String(name || '').split(/\s+/);
    const capitals = parts.filter(function (part) {
      return part.length > 1 && part === part.toUpperCase();
    });
    return (capitals.length ? capitals.join(' ') : String(name || '')).toLowerCase();
  }

  function countryMembersHTML(code) {
    if (!memberIndex) {
      return '<p class="neutral-note">The member directory has not loaded.</p>';
    }
    const country = statesByCode[code];
    const people = memberIndex.filter(function (member) {
      return member.country === code;
    }).sort(function (a, b) {
      return surnameKey(a.name).localeCompare(surnameKey(b.name), 'en');
    });

    if (!people.length) {
      return '<p class="neutral-note">No member of this country is in the directory yet.</p>';
    }

    // The two numbers can differ in both directions, and each says something
    // different: more people than seats means a seat changed hands, fewer
    // means someone holds a seat but has cast no vote in the records here.
    let note = '';
    if (country && people.length > country.seats) {
      note = '<p class="seat-note">' + people.length + ' people have held ' +
        esc(country.name) + '’s ' + country.seats + ' seats this term — a seat that ' +
        'changes hands has more than one holder.</p>';
    } else if (country && people.length < country.seats) {
      note = '<p class="seat-note">' + people.length + ' of ' + esc(country.name) + '’s ' +
        country.seats + ' seats have a member on record here.</p>';
    }

    return note + '<ul>' + people.map(function (member) {
      const group = window.Groups ? Groups.name(member.group) : member.group;
      return '<li><button type="button" class="mep-hit" data-member="' + esc(member.id) + '">' +
        (window.Faces ? Faces.avatar(member, { size: 'md' })
          : (window.Groups ? Groups.swatch(member.group) : '')) +
        '<span class="mep-name">' + esc(member.name) + '</span>' +
        '<span class="mep-meta">' +
        (member.party ? esc(member.party) + ' · ' : '') + esc(group) + ' · ' +
        member.votes.toLocaleString('en-GB') + ' votes</span>' +
        '</button></li>';
    }).join('') + '</ul>';
  }

  function toggleCountryMembers(button) {
    const list = document.getElementById('country-meps');
    if (!list) return;
    const code = button.getAttribute('data-seats');

    if (button.getAttribute('aria-expanded') === 'true') {
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      return;
    }

    // Built once per country, then kept: the panel is rebuilt often enough
    // that rendering seven hundred rows on every open would be felt.
    if (list.dataset.code !== code) {
      list.innerHTML = countryMembersHTML(code);
      list.dataset.code = code;
      if (window.Groups) Groups.loadLogos(list);
    }
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
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
          (window.Faces ? Faces.avatar(member, { size: 'md' }) : '') +
          '<span class="mep-name">' + esc(member.name) + '</span>' +
          '<span class="mep-meta">' + esc(country.name) + ' · ' + esc(member.group) +
            (member.party ? ' · ' + esc(member.party) : '') + '</span>' +
          '<span class="card-rule">' + member.votes + ' votes</span></button></li>';
      }).join('') + '</ul>';
  }

  /* ------------------------------------------------------------- one member */

  async function showMember(id, options) {
    if (!memberCache[id]) {
      try {
        memberCache[id] = await Data.getJSON('data/meps/' + id + '.json');
      } catch (error) {
        return;
      }
    }
    const member = memberCache[id];
    // Where the reader came from, so Back puts them there. Opening a member
    // from a country's own list and landing on the vote list instead would
    // lose the place they were keeping.
    const from = state.country;
    if (!(options && options.fromHistory)) {
      openStep(function () { backToVotes({ fromHistory: true, country: from }); });
    }
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
    // The group's own mark beside its name, the same mark the breakdown of a
    // vote and a country's table carry.
    dom['member-group'].innerHTML =
      (window.Groups ? Groups.swatch(member.group) : '') +
      '<span>' + esc(member.group) + '</span>';
    dom['member-group'].className = 'badge badge-parliament badge-group';
    if (window.Groups) Groups.loadLogos(dom['member-group']);
    dom['member-country'].textContent = country.name;

    // The face and the party they were elected for. The political group is in
    // the line above; the party is the other half of who they are, and the one
    // a reader at home recognises.
    if (dom['member-face']) {
      dom['member-face'].innerHTML = window.Faces
        ? Faces.avatar(member, { size: 'lg', eager: true }) : '';
    }
    if (dom['member-party']) {
      const label = member.party
        ? member.party + (member.partyShort && member.partyShort !== member.party
            ? ' (' + member.partyShort + ')' : '')
        : '';
      dom['member-party'].textContent = label;
      dom['member-party'].hidden = !label;
    }
    dom['member-summary'].textContent = 'Every vote this member has cast in the ' +
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
      setHeaderPlenary(
        'Last plenary ' + sessionLabel(last) + (next ? ' · next ' + sessionLabel(next) : ''),
        // On a phone the same line has to fit the width, so the cities go.
        'Plenary ' + sessionLabel(last, true) + (next ? ' · next ' + sessionLabel(next, true) : '')
      );
      return;
    }

    // No calendar imported yet: say what the records themselves show.
    const latest = index.decisions
      .filter(function (item) { return item.body === 'parliament'; })
      .map(function (item) { return item.date; })
      .sort()
      .pop();
    setHeaderPlenary(latest ? 'Latest sitting on record ' + Data.formatDate(latest) : '');
    dom['header-plenary'].title = 'Plenary calendar not imported yet — run npm run sessions.';
  }

  /* The header line comes in two lengths and the screen picks one. Both are
     kept on the element, so a rotation or a resize swaps them without the
     calendar being read again. */
  const narrowHeader = window.matchMedia('(max-width: 40rem)');

  function setHeaderPlenary(full, short) {
    const node = dom['header-plenary'];
    if (!node) return;
    node.dataset.full = full || '';
    node.dataset.short = short || full || '';
    applyHeaderPlenary();
  }

  function applyHeaderPlenary() {
    const node = dom['header-plenary'];
    if (!node || node.dataset.full === undefined) return;
    node.textContent = narrowHeader.matches ? node.dataset.short : node.dataset.full;
  }

  if (narrowHeader.addEventListener) {
    narrowHeader.addEventListener('change', applyHeaderPlenary);
  } else if (narrowHeader.addListener) {
    narrowHeader.addListener(applyHeaderPlenary);   // Safari before 14
  }

  function sessionLabel(session, terse) {
    const start = new Date(session.start + 'T00:00:00Z');
    const end = new Date(session.end + 'T00:00:00Z');
    const sameMonth = session.start.slice(0, 7) === session.end.slice(0, 7);
    const startText = start.toLocaleDateString('en-GB', {
      day: 'numeric', month: sameMonth ? undefined : 'short', timeZone: 'UTC'
    });
    const endText = end.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
    });
    return startText + '–' + endText +
      (session.location && !terse ? ', ' + session.location : '');
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
      const open = state.query || state.unfolded || unfoldedSessions.has(group.key);
      const current = state.decision && group.items.some(function (item) {
        return item.id === state.decision.id;
      });
      return '<details class="session" data-session="' + esc(group.key) + '"' +
        (open || current ? ' open' : '') + '>' +
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
  let delegations = [];

  /* Which plenary sessions the reader has unfolded. The list is rebuilt on
     every render, so without this, closing a vote would drop them back to a
     folded list with no memory of where they had been reading. */
  const unfoldedSessions = new Set();


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
          party: mep.party || null,
          photo: mep.photo || null,
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

  /* Every denominator on this page comes from the size of the chamber, never
     from the number of ballots a particular record happens to carry.

     The Parliament has 720 seats. Some records name every member including
     those who did not vote; others, the ones read from the portal, name only
     the members who did — the portal does not publish absences. Counting the
     ballots would therefore make "of N members" mean 720 on one vote and 607
     on the next, for no reason a reader could see. So the seats decide, the
     votes cast are counted, and what is left is what it says: members who did
     not vote. */
  function chamberSeats() {
    return states.reduce(function (sum, item) { return sum + item.seats; }, 0);
  }

  function seatsOf(code) {
    const state = statesByCode[code];
    return state ? state.seats : 0;
  }

  function castOf(totals) {
    return totals.for + totals.against + totals.abstain;
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
        // A segment narrower than about a tenth of the bar cannot hold a word
        // without clipping it, and "abst…" reads worse than nothing: the
        // percentage and the colour already say which part this is, and the
        // sentence underneath names all three.
        (percent >= 9 ? '<span class="seg-label">' + esc(Panel.VOTE_LABEL[key]) + '</span>' : '') +
        '</button>';
    }).join('');

    const decision = state.decision;
    const result = (decision.outcome && decision.outcome.result) || 'recorded';
    const seats = chamberSeats();
    const silent = Math.max(0, seats - cast);
    dom['roll-summary'].innerHTML =
      '<span class="result result-' + esc(result) + '">' +
        esc(RESULT_LABEL[result] || result) + '</span> · ' +
      '<span class="n-for">' + totals.for + '</span> in favour, ' +
      '<span class="n-against">' + totals.against + '</span> against, ' +
      '<span class="n-abstain">' + totals.abstain + '</span> abstained. ' +
      cast + ' of ' + seats + ' members voted; ' +
      '<span class="n-absent">' + silent + '</span> did not.';
  }

  function renderMembersTab(list) {
    if (!list.length) return '<p class="empty">No member matches these filters.</p>';
    return '<ul class="roll-members">' + list.slice(0, 800).map(function (item) {
      return '<li data-code="' + esc(item.country) + '">' +
        '<button type="button" class="roll-member" data-member="' + esc(item.id) + '">' +
          (window.Faces ? Faces.avatar(item) : '') +
          '<span class="rm-name">' + esc(item.name) + '</span>' +
          '<span class="rm-meta">' + esc(item.countryName) + ' · ' + esc(item.group) +
            (item.party ? ' · ' + esc(item.party) : '') + '</span>' +
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
      const cast = castOf(totals);
      return {
        key: key,
        label: labelOf(key),
        tile: tileOf(key),
        // A member state's delegation is a fixed size; a political group's is
        // not recorded per vote, so nothing is claimed about it.
        seats: kind === 'country' ? seatsOf(key) : 0,
        size: groups[key].length,
        totals: totals,
        cast: cast
      };
    });
    rows.sort(function (a, b) { return b.size - a.size; });

    if (!rows.length) return '<p class="empty">Nothing matches these filters.</p>';

    return '<ul class="breakdown">' + rows.map(function (row) {
      const parts = POSITIONS.filter(function (key) { return row.totals[key]; })
        .map(function (key) {
          const percent = share(row.totals[key], row.seats || row.cast || row.size);
          return '<span class="bd-seg bd-' + key + '" style="flex:' + row.totals[key] + ' 1 0"' +
            ' title="' + esc(Panel.VOTE_LABEL[key]) + ': ' + row.totals[key] +
            ' (' + percent + '%)"></span>';
        }).join('');

      return '<li' + (kind === 'country' ? ' data-code="' + esc(row.key) + '"' : '') + '>' +
        '<button type="button" class="breakdown-row"' +
          (kind === 'country'
            ? ' data-country="' + esc(row.key) + '" title="Open this country\u2019s record"'
            : ' data-group="' + esc(row.key) + '" title="See the members of this group"') + '>' +
          tile(row, kind) +
          '<span class="bd-main">' +
            '<span class="bd-label">' + esc(row.label) + '</span>' +
            '<span class="bd-sub">' +
              (row.seats
                ? row.cast + ' of ' + row.seats + ' members voted'
                : row.cast + ' vote' + (row.cast === 1 ? '' : 's') + ' cast') +
              (row.cast
                ? ' · <span class="n-for">' + row.totals.for + '</span> for, ' +
                  '<span class="n-against">' + row.totals.against + '</span> against, ' +
                  '<span class="n-abstain">' + row.totals.abstain + '</span> abstained'
                : '') +
            '</span>' +
            '<span class="bd-bar">' + parts + '</span>' +
          '</span>' +
          '<span class="bd-go" aria-hidden="true">\u203a</span>' +
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
      ? list.length + ' of ' + all.length + ' listed members match'
      : all.length + ' members listed';

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

  /* One member out of the directory, by the id every ballot uses. */
  let byId = null;
  function memberById(id) {
    if (!memberIndex) return null;
    if (!byId) {
      byId = new Map();
      memberIndex.forEach(function (member) { byId.set(String(member.id), member); });
    }
    return byId.get(String(id)) || null;
  }

  /* How a named party's members voted on this record. The Parliament publishes
     a member's country and political group but not the party they stood for,
     so the membership comes from data/reference/delegations.json and is read
     against this vote's own ballots. Nothing is inferred: a member with no
     ballot in the record did not vote. */
  function delegationVote(decision, delegation) {
    const positions = new Map();
    (decision.ballots || []).forEach(function (ballot) {
      positions.set(String(ballot[0]), POSITIONS[ballot[1]]);
    });

    const members = delegation.members.map(function (member) {
      // The directory is the fuller record: it writes the name the way the
      // Parliament writes it, and it knows the group the member sits in now.
      const known = memberById(member.id);
      return {
        id: member.id,
        name: (known && known.name) || member.name,
        country: member.country,
        group: (known && known.group) || delegation.group,
        party: (known && known.party) || delegation.name,
        photo: known ? known.photo : null,
        position: positions.get(String(member.id)) || 'absent'
      };
    });

    const totals = { for: 0, against: 0, abstain: 0, absent: 0 };
    members.forEach(function (member) { totals[member.position] += 1; });
    return { members: members, totals: totals, cast: castOf(totals) };
  }

  function delegationLine(decision) {
    if (!delegations.length || !(decision.ballots || []).length) return '';

    return delegations.map(function (delegation) {
      const result = delegationVote(decision, delegation);
      const parts = ['for', 'against', 'abstain'].filter(function (key) { return result.totals[key]; })
        .map(function (key) {
          return '<span class="n-' + key + '">' + result.totals[key] + '</span> ' +
            esc(DELEGATION_WORD[key]);
        });
      if (result.totals.absent) {
        parts.push('<span class="n-absent">' + result.totals.absent + '</span> did not vote');
      }

      // Each member with their own face, and the row is a door to their record
      // — the same door the roll-call rows open.
      const names = result.members.map(function (member) {
        return '<li><button type="button" class="dg-member" data-member="' + esc(member.id) + '">' +
          (window.Faces ? Faces.avatar(member) : '') +
          '<span class="dg-name">' + esc(member.name) + '</span>' +
          '<span class="vote-pill vote-' + member.position + '">' +
          esc(Panel.VOTE_LABEL[member.position]) + '</span></button></li>';
      }).join('');

      /* Open on every vote, not folded away behind a summary. This is the
         one delegation the site follows, it is five people, and how they
         voted is the thing a reader came for — not a footnote to be
         unfolded once they have read everything else. The fold stays, for
         anyone who wants the outcome without the faces. */
      return '<details class="delegation" open>' +
        '<summary>' +
          '<span class="dg-mark" style="background:' + esc(delegation.colour || '#444') + '"></span>' +
          '<span class="dg-label">' + esc(delegation.name) + '</span>' +
          '<span class="dg-sum">' + parts.join(', ') + '</span>' +
        '</summary>' +
        '<ul class="dg-members">' + names + '</ul>' +
        '<p class="dg-note">' + esc(delegation.note || '') + ' ' +
          esc(delegation.members.length) + ' members of the Parliament.</p>' +
        '</details>';
    }).join('');
  }

  /* Where to check this vote, at the Parliament's own address.

     This used to be a row of loose links, and the one it called "the source"
     went to data.europarl.europa.eu — the front door, with nothing behind it
     for this vote. 603 of the 718 records cited that. A citation nobody can
     follow is not a citation, and on a site whose only claim is that every
     number here came from the Parliament, that was the weakest part of it.

     Now each record names the documents it can actually be checked against.
     The roll-call results come first because that is the document this vote
     is recorded in — the Parliament's own list of who voted which way at that
     sitting. The rest is context: the minutes, the procedure file, and the
     machine-readable data these figures were counted from.

     Every address was tried against the Parliament's servers, across five
     sittings spanning the term, before any of it was written down. */
  const SOURCE_NOTE = {
    record: 'The Parliament\u2019s own record of who voted which way',
    minutes: 'What the House did that day, in order',
    procedure: 'The whole legislative file, stage by stage',
    data: 'The same sitting as data, to count the figures again'
  };

  function sourceBlock(decision) {
    const sources = (decision.sources || []).filter(function (source) { return source.url; });
    if (!sources.length) return '';

    return '<section class="sources" aria-labelledby="sources-title">' +
      '<h3 class="sources-title" id="sources-title">Check it at the European Parliament</h3>' +
      '<ul class="source-list">' + sources.map(function (source) {
        const note = SOURCE_NOTE[source.role] || '';
        return '<li><a class="source-link' + (source.role === 'record' ? ' is-record' : '') +
          '" href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' +
          '<span class="source-label">' + esc(source.label) +
          '<span class="source-out" aria-hidden="true">\u2197</span></span>' +
          (note ? '<span class="source-note">' + esc(note) + '</span>' : '') +
          '</a></li>';
      }).join('') + '</ul></section>';
  }

  const DELEGATION_WORD = { for: 'in favour', against: 'against', abstain: 'abstained' };

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
      html += '<p class="outcome-note">No country-by-country vote exists for this act: ' +
        'the Commission used powers the member states had already delegated to it.</p>';
    }

    dom.outcome.innerHTML = html + delegationLine(decision);
  }

  /* ---------------------------------------------------------------- routing */

  /* A vote's address.

     The Parliament gives every roll-call its own number, and that number is
     the tail of every id held here, so a link can carry the number alone:
     "#/195719" rather than "#/ep-2026-07-09-2023-0212-cod-195719". Short
     enough to read out, to print on a picture and to type back in; and the
     code drawn on the story card has half as much to carry, so it stays
     coarse enough to scan from a phone held up to a screen.

     The long form still opens, so every link shared before this keeps
     working. */
  function shortId(decision) {
    if (!decision) return '';
    return decision.sourceId ? String(decision.sourceId) : decision.id;
  }

  /* ...and back again: the number first, then the full id. */
  function resolveId(token) {
    if (!token) return null;
    const wanted = String(token);
    if (!index || !index.decisions) return wanted;
    const found = index.decisions.find(function (item) {
      return item.id === wanted || String(item.sourceId) === wanted;
    });
    return found ? found.id : wanted;
  }

  function permalink(code) {
    const id = shortId(state.decision);
    return '#/' + id + (code ? '/' + code : '');
  }

  /* An address someone can paste somewhere, not a fragment that only means
     something inside this page. */
  function shareUrl(code) {
    // "index.html" is how a folder is served, not part of the address anyone
    // would write down; the site's own share menu drops it too.
    const path = location.pathname.replace(/index\.html$/, '');
    return location.origin + path + location.search + permalink(code);
  }

  /* Sharing a vote. The address carries the vote, so anyone opening it lands
     on the same record; the text is the vote's own headline, so the reader who
     receives it knows what they are being sent before they click. */
  function shareText(decision) {
    if (!decision) return 'EU Tracker — Every vote of the European Parliament, member by member.';
    const outcome = (decision.outcome && decision.outcome.result) || '';
    return decision.title + (outcome ? ' — ' + (RESULT_LABEL[outcome] || outcome) : '') +
      ' in the European Parliament';
  }

  /* One picture, and it fits wherever Instagram offers to put it: the card is
     composed inside the middle four-by-five, which is the story's safe area
     and the feed's crop at once. */
  const STORY_HINT = 'Makes a picture of this vote that fits a story, a reel or a feed ' +
    'post, and copies the link at the same time \u2014 paste it into Instagram\u2019s link ' +
    'sticker so anyone watching lands on this vote.';
  const STORY_DONE = 'Link copied. In Instagram: Sticker \u2192 Link \u2192 paste, ' +
    'and the story opens this vote.';
  const STORY_SAVED = 'Picture saved, link copied. Post it, then paste the link into ' +
    'the story\u2019s link sticker.';

  function plainUrl(url) {
    return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  }

  /* Everything one vote can be shared as, in one card: the address itself,
     spelled out so a reader can see what they are about to send and one press
     from the clipboard; the picture, for a story; the phone's own share sheet
     where there is one; and the places people actually post.

     Each place is a mark and a word. Eight unlabelled glyphs are a puzzle. */
  function shareCard(decision) {
    const url = shareUrl();
    const text = shareText(decision);
    const e = encodeURIComponent;
    // The marks the header's own share menu uses, so one hand drew both.
    const mark = function (key) {
      return (window.ShareMarks && window.ShareMarks[key]) || '';
    };
    const targets = [
      { key: 'bluesky', label: 'Bluesky',
        href: 'https://bsky.app/intent/compose?text=' + e(text + ' ' + url) },
      { key: 'x', label: 'X',
        href: 'https://x.com/intent/tweet?text=' + e(text) + '&url=' + e(url) },
      { key: 'linkedin', label: 'LinkedIn',
        href: 'https://www.linkedin.com/sharing/share-offsite/?url=' + e(url) },
      { key: 'whatsapp', label: 'WhatsApp',
        href: 'https://wa.me/?text=' + e(text + ' ' + url) },
      { key: 'telegram', label: 'Telegram',
        href: 'https://t.me/share/url?url=' + e(url) + '&text=' + e(text) },
      { key: 'email', label: 'Email', aria: 'Send this vote by email',
        href: 'mailto:?subject=' + e(text) + '&body=' + e(text + '\n\n' + url) }
    ];

    return '<section class="share-card" aria-labelledby="share-card-title">' +
      '<h3 class="share-card-title" id="share-card-title">Share this vote</h3>' +

      /* The address is shown without its scheme, which is the form a reader
         would say out loud and the form printed on the story card. Copy puts
         the whole thing on the clipboard; a reader who selects the line by
         hand gets the scheme-less form, which every browser and every chat app
         resolves to the same page. */
      '<div class="share-address">' +
        '<input class="share-address-field" type="text" readonly spellcheck="false"' +
          ' aria-label="Link to this vote" value="' + esc(plainUrl(url)) + '">' +
        '<button type="button" class="share-act share-address-copy" data-copy="' + esc(url) + '">' +
          mark('copy') + '<span>Copy link</span></button>' +
      '</div>' +

      '<div class="share-acts">' +
        // The picture. On a phone it goes into the share sheet, where Instagram
        // offers Stories; anywhere else it is saved to be posted from one.
        '<button type="button" class="share-act is-primary share-story"' +
          ' title="Draws this vote as a picture that fits a story, a reel or a feed post,' +
          ' and opens the share sheet.">' +
          mark('instagram') + '<span>Story or post</span></button>' +
        '<button type="button" class="share-act share-native" hidden' +
          ' data-share-url="' + esc(url) + '" data-share-text="' + esc(text) + '">' +
          mark('device') + '<span>Share\u2026</span></button>' +
      '</div>' +

      '<ul class="share-places">' + targets.map(function (target) {
        return '<li><a class="share-act share-place" href="' + esc(target.href) +
          '" target="_blank" rel="noopener noreferrer" aria-label="' +
          esc(target.aria || ('Share this vote on ' + target.label)) + '">' +
          mark(target.key) + '<span>' + esc(target.label) + '</span></a></li>';
      }).join('') + '</ul>' +

      '<p class="share-note" id="share-note">' + esc(STORY_HINT) + '</p>' +
      '</section>';
  }

  /* The line under the card, which says what just happened. It is a status
     rather than an alert: nothing has gone wrong, there is only something to
     read before switching to the other app. */
  let noteTimer = 0;
  function shareNote(words) {
    const note = document.getElementById('share-note');
    if (!note) return;
    window.clearTimeout(noteTimer);
    note.textContent = words;
    note.classList.add('is-live');
    noteTimer = window.setTimeout(function () {
      note.textContent = STORY_HINT;
      note.classList.remove('is-live');
    }, 14000);
  }

  /* The card, once it is in the page: the address selects itself when it is
     touched, so copying it by hand is one gesture; and the system share sheet
     appears where the browser has one — a phone, mostly. The sheet button is
     revealed rather than rendered conditionally so the markup stays the same. */
  function armShareCard(root) {
    const field = root.querySelector('.share-address-field');
    if (field) {
      const all = function () { field.select(); };
      field.addEventListener('focus', all);
      field.addEventListener('click', all);
    }

    if (!navigator.share) return;
    Array.prototype.forEach.call(root.querySelectorAll('.share-native'), function (button) {
      button.hidden = false;
      button.onclick = function () {
        navigator.share({
          title: 'EU Tracker',
          text: button.getAttribute('data-share-text'),
          url: button.getAttribute('data-share-url')
        }).catch(function () { /* the reader closed the sheet */ });
      };
    });
  }

  /* The vote as a 1080x1920 picture, handed to the phone's own share sheet.

     No web page can post into Instagram Stories by itself — Instagram accepts
     that only from a registered native app — so this opens the sheet the phone
     already has, with every app on it. Choosing Instagram there offers Add to
     story, and the picture arrives as the story.

     The picture is drawn BEFORE anybody asks for it, and that is the whole
     trick. navigator.share() may only be called while the tap that triggered
     it is still live — "transient activation" — and drawing this card is not
     quick: it waits for the fonts, loads the Volt mark as an image, and paints
     a canvas the size of a phone screen. Doing that between the tap and the
     sheet spent the tap. iOS Safari then refused the call outright, the
     refusal was mistaken for "this browser dislikes this payload", and the
     tap ended by quietly saving a file instead — which on a phone is no use
     to anyone. That was the bug.

     So the card is drawn when the vote opens, while nobody is waiting, and the
     tap does nothing but hand the finished file over. It is also the version
     that feels instant, which is the same thing as easier. */
  let story = { key: null, file: null, url: null };

  function storyKey(decision) {
    return decision ? decision.id + '|' + shareUrl() : null;
  }

  function storyTotals(decision) {
    const totals = tally(ballotList());
    const seats = chamberSeats();
    // The same arithmetic as the line under the bar: the seats are the
    // denominator, the ballots are what was cast, and the rest did not vote.
    totals.absent = Math.max(0, seats - castOf(totals));
    return { totals: totals, seats: seats };
  }

  async function drawStory(decision, url) {
    const counted = storyTotals(decision);

    // The Union painted by this vote, from the same outline and the same
    // reading of the record as the map on the page.
    const positions = {};
    Object.keys(statesByCode).forEach(function (code) {
      positions[code] = Data.countryPosition(decision, code).position;
    });

    const blob = await Story.card({
      title: decision.title,
      subtitle: decision.subtitle,
      bodyLabel: decision.bodyLabel,
      dateLabel: Data.formatDate(decision.date),
      result: (decision.outcome && decision.outcome.result) || 'recorded',
      totals: counted.totals,
      seats: counted.seats,
      url: url,
      geo: geoData,
      positions: positions
    });
    if (!blob) return null;

    // Named for the vote as well as the day, so a folder of these can be told
    // apart and matched back to what it shows.
    return new File([blob], 'eu-tracker-' + decision.date + '-' + shortId(decision) + '.png',
      { type: 'image/png' });
  }

  /* Drawn in the gaps, when the vote opens. If the reader moves on first the
     result is thrown away: the key it was drawn for no longer matches. */
  function primeStory() {
    const decision = state.decision;
    if (!decision || !window.Story || !geoData) return;
    const key = storyKey(decision);
    if (story.key === key) return;

    story = { key: key, file: null, url: shareUrl() };
    const soon = window.requestIdleCallback ||
      function (fn) { return window.setTimeout(fn, 300); };
    soon(function () {
      if (story.key !== key) return;
      drawStory(decision, story.url).then(function (file) {
        if (story.key === key) story.file = file;
      }, function () {
        // Nothing to do: the tap will draw it the slow way and say so.
      });
    });
  }

  /* Hands one payload to the sheet, synchronously, inside the tap.

     One payload, not three tried in turn: activation is spent by the first
     call, so a retry after a refusal is refused again for a different reason
     and only muddies what went wrong. The shape is chosen up front instead,
     by asking the browser which it will take. */
  function offerStory(file, decision, url) {
    if (!navigator.share) return null;
    const shapes = [
      // The address as its own field, so an app with a place for a link fills
      // it in rather than trailing it after a sentence...
      { files: [file], text: shareText(decision), url: url },
      // ...and written into the words for one that has not.
      { files: [file], text: shareText(decision) + ' ' + url },
      { files: [file] }
    ];
    let payload = null;
    for (let i = 0; i < shapes.length && !payload; i++) {
      if (!navigator.canShare || navigator.canShare(shapes[i])) payload = shapes[i];
    }
    if (!payload) return null;
    return navigator.share(payload);
  }

  /* The file, saved. What a laptop gets, and the last resort on a phone. */
  function keepStory(file) {
    const href = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = href;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
  }

  function shareStory(button) {
    if (!window.Story || !state.decision) return;
    const decision = state.decision;
    // The button carries a mark beside its words, so only the words change.
    const label = button.querySelector('span') || button;
    const said = label.textContent;
    const say = function (words) { label.textContent = words; };
    const restore = function () {
      window.setTimeout(function () { say(said); button.disabled = false; }, 1600);
    };
    const failed = function () {
      say('Could not draw it');
      restore();
    };

    const ready = story.file && story.key === storyKey(decision) ? story.file : null;
    const url = ready ? story.url : shareUrl();

    /* Primed, never awaited. Waiting on the clipboard here would spend the
       same tap that the share sheet still needs. */
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        const written = navigator.clipboard.writeText(url);
        if (written && written.catch) written.catch(function () { /* refused */ });
      } catch (error) { /* no clipboard */ }
    }

    if (ready) {
      const shared = offerStory(ready, decision, url);
      if (shared) {
        button.disabled = true;
        shared.then(function () {
          say('Shared');
          shareNote(STORY_DONE);
          restore();
        }, function (error) {
          // The reader closing the sheet is not a failure and re-opening it
          // would be rude. Anything else means the sheet never came: save the
          // picture, which always works.
          if (!error || error.name === 'AbortError') { restore(); return; }
          keepStory(ready);
          say('Image saved');
          shareNote(STORY_SAVED);
          restore();
        });
        return;
      }
      // No share sheet here — a laptop, mostly.
      keepStory(ready);
      say('Image saved');
      shareNote(STORY_SAVED);
      restore();
      return;
    }

    /* Not drawn yet — the reader was faster than the idle callback. Draw it
       now. The sheet cannot be opened from here on iOS, for the reason above,
       so this saves the picture and says so rather than pretending. */
    button.disabled = true;
    say('Drawing…');
    drawStory(decision, url).then(function (file) {
      if (!file) { failed(); return; }
      story = { key: storyKey(decision), file: file, url: url };
      keepStory(file);
      say('Image saved');
      shareNote(STORY_SAVED);
      restore();
    }, failed);
  }

  async function copyLink(button) {
    const text = button.getAttribute('data-copy');
    // Where the control carries a mark beside its words, only the words move.
    const label = button.querySelector('span') || button;
    const original = label.textContent;
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
    label.textContent = copied ? 'Link copied' : text;
    window.setTimeout(function () { label.textContent = original; }, copied ? 1600 : 6000);
  }

  function readHash() {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
    return {
      decisionId: resolveId(parts[0]),
      code: (parts[1] || '').toUpperCase() || null
    };
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
  function selectOutside(code, options) {
    const country = outside && outside[code];
    if (!country) return;
    // Opening a neighbour is a step like any other, so Back closes it.
    if (code !== state.outside && !(options && options.fromHistory)) {
      openStep(function () { closeOutside(); });
    }
    state.outside = code;
    if (map) map.setSelected(code);
    state.country = null;
    dom['panel-empty'].hidden = true;
    dom['panel-body'].hidden = false;
    document.getElementById('country-panel').hidden = false;
    Panel.renderOutside(dom['panel-body'], code, country);
    const narrow = window.matchMedia('(max-width: 62rem)').matches;
    if (narrow) dom['panel-body'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Puts the reading column back to its invitation. selectCountry(null) does
     the work; this only makes sure the neighbour is forgotten with it. */
  function closeOutside() {
    state.outside = null;
    selectCountry(null, { replaceStep: true });
  }

  /* Put the country's record where the reader can see it.

     On a narrow screen the panel is far below the map and always has to be
     brought up. On a wide one it sits beside the map, and jumping the page
     when the answer is already on screen would be rude — but the map is tall,
     and a reader who has scrolled down to reach Portugal has left the top of
     that column behind. Then clicking a country changes something they cannot
     see. So the test is not the width of the screen but the simple question of
     whether the answer is actually in front of them. */
  function bringPanelIntoView() {
    const panel = document.getElementById('country-panel');
    if (!panel) return;
    const box = panel.getBoundingClientRect();
    const height = window.innerHeight || document.documentElement.clientHeight;
    // Enough of it to read: its top on screen, and a few lines of it showing.
    const seen = box.top >= 0 && box.top <= height - Math.min(160, box.height);
    if (seen) return;
    panel.scrollIntoView({
      behavior: REDUCED.matches ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  function selectCountry(code, options) {
    const opening = Boolean(code && statesByCode[code]) && code !== state.country;
    state.country = code && statesByCode[code] ? code : null;
    if (state.country || !code) state.outside = null;
    if (opening && !(options && options.replaceStep)) {
      openStep(function () { selectCountry(null, { fromHistory: true }); });
    }
    if (map) map.setSelected(state.country);

    // Picking a country narrows the roll-call to its members: the question
    // after clicking Spain is who in Spain voted which way.
    if (state.decision && (roll.country || state.country)) {
      setRoll({ country: state.country || '', tab: state.country ? 'members' : roll.tab });
    }

    if (!state.country) {
      dom['panel-body'].hidden = true;
      dom['panel-empty'].hidden = false;
      panelLabelled('panel-empty-title');
      dom['panel-empty'].querySelector('p').textContent = state.decision
        ? 'Every member state holds the same answers for this vote: how it voted, and how ' +
          'how its own members voted.'
        : 'Click any member state to see who they are and which clubs they are in. Pick a ' +
          'vote from the list to see how they voted.';
    } else {
      dom['panel-empty'].hidden = true;
      panelLabelled('panel-title');
      if (state.decision) {
        Panel.render(dom['panel-body'], state.decision, statesByCode[state.country],
          shareUrl(state.country));
      } else {
        Panel.renderProfile(dom['panel-body'], statesByCode[state.country],
          shareUrl(state.country));
      }
      if (state.isolate) applyIsolation();
      if (!options || options.scroll !== false) bringPanelIntoView();
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



    dom['vote-links'].innerHTML = sourceBlock(decision);
    dom['vote-links'].hidden = false;

    // Sharing is its own card, below the outcome: the last thing on the brief,
    // where a reader who has read the result is ready to pass it on.
    dom['vote-share'].innerHTML = shareCard(decision);
    armShareCard(dom['vote-share']);
    dom['vote-share'].hidden = false;
    // Draw the picture now, while nobody is waiting for it, so the tap that
    // shares it has nothing left to do but open the sheet.
    primeStory();

    const isSample = decision.status === 'sample';
    dom['decision-status'].hidden = !isSample;
    dom['sample-banner'].hidden = !isSample;

    const costs = hasImpact(decision);
    document.getElementById('tab-impact').hidden = !costs;

    if (!state.layerChosen) {
      setLayer('vote');
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
  function backToVotes(options) {
    if (!(options && options.fromHistory)) {
      // Let Back do it, so the history and the page agree about where we are.
      if (backStack.length) { history.back(); return; }
    }
    dom['search-input'].value = '';
    state.query = '';
    dom['search-clear'].hidden = true;
    // Carries options.country through, so coming back from a member returns to
    // the country whose list they were opened from.
    clearDecision(options);
    if (!(options && options.country)) dom['search-input'].focus();
  }

  /* Nothing open: no vote, no member, no country, no neighbour. The start
     page, however the reader arrived at it. */
  function atStart() {
    return !state.decision && !state.member && !state.country && !state.outside;
  }

  /* The Union drawn as one country, on arriving at the start page — by the
     name, by Back, or by opening the site. Only where there is nothing else on
     the map to say: a Back that merely closes a country while a vote stays
     open has a vote to show, and that comes first. */
  function greetHome() {
    if (map && atStart()) map.unite();
  }

  /* True while the way home is unwinding the history, so that the handlers
     watching the address do not read the entries going past as a reader asking
     for them. */
  let goingHome = false;

  function stripHash() {
    if (!location.hash) return;
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (error) {
      // a sandbox that refuses history writes: nothing else to do
    }
  }

  /* The way home, from anywhere: a vote, a member, a country, a search. It
     undoes every step at once rather than one at a time, and lets the history
     go back the same number, so Back afterwards leaves the site as it would
     have from the start page rather than walking back in through the door the
     reader just came out of. */
  function goHome() {
    const steps = backStack.length;
    backStack.length = 0;
    // Going back through those entries can land on one whose address still
    // names a vote, and the handler that watches the address would then open it
    // again — which is the opposite of going home. So the way home says so
    // while it is happening, and the two handlers stand aside.
    goingHome = true;
    stripHash();
    if (steps) {
      try {
        history.go(-steps);
      } catch (error) {
        // a browser that will not move: the page is still put back below
      }
    }
    window.setTimeout(function () {
      goingHome = false;
      stripHash();   // whatever the history left in the address, home has none
    }, 450);

    dom['search-input'].value = '';
    state.query = '';
    dom['search-clear'].hidden = true;
    state.country = null;
    clearDecision();
    closeOutside();
    window.scrollTo({ top: 0, behavior: REDUCED.matches ? 'auto' : 'smooth' });
    // And the map says what the name means: for a few seconds the internal
    // frontiers go and the Union is one country, outlined in its own gold.
    // After clearDecision, which stops whatever the map was doing.
    greetHome();
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
      'from the list.';
    // Nothing open: the line is the way in, and is said out loud again.
    dom['map-hint'].classList.remove('is-quiet');
    if (map) map.revealAll();
    paint();
    renderFeed();
    renderMepResults();
    selectCountry((options && options.country) || null, { scroll: false });
  }

  async function loadDecision(id, code, options) {
    if (!id) {
      clearDecision({ country: code });
      return;
    }
    // Back has to undo the step the reader actually took. Opening a vote from
    // a member's own list is a step out of that member's record, not out of
    // the vote list: going back has to put them where they were, with the
    // country they had open if they had one.
    if (!(options && options.fromHistory) && (!state.decision || state.decision.id !== id)) {
      const fromMember = state.member && state.member.id;
      const fromCountry = state.country;
      openStep(function () {
        if (fromMember) {
          showMember(fromMember, { fromHistory: true });
        } else {
          backToVotes({ fromHistory: true, country: fromCountry });
        }
      });
    }
    const entry = index.decisions.find(function (item) {
      return item.id === id || String(item.sourceId) === String(id);
    });
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
    // Kept for a screen reader, taken out of the way for everyone else: with a
    // vote open the map is showing the vote, and an instruction has no business
    // standing between the reader and it.
    dom['map-hint'].classList.add('is-quiet');
    renderDecision();
    selectCountry(code || null, { scroll: false });
    if (changed) playReveal();

    // On one column the vote opens above the map, which is above the list the
    // reader just tapped: without this they would be left looking at the list
    // with the answer off the top of the screen.
    if (changed && !(options && options.fromHistory) &&
        window.matchMedia('(max-width: 62rem)').matches) {
      const brief = document.querySelector('.decision-brief');
      if (brief) brief.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
    // "Against" means nothing once the map is showing what a decision costs. A bloc
    // still does, so that one stays.
    if (layer !== state.layer && state.isolate && state.isolate.kind === 'layer') {
      state.isolate = null;
    }
    state.layer = layer;
    if (chosen) state.layerChosen = true;
    // One button now, and it is a switch rather than one of a pair: pressed
    // means the map is showing what the vote costs.
    Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-layer') === layer));
    });
    dom['map-heading'].textContent = LAYERS[layer].heading;
    dom['map-hint'].textContent = LAYERS[layer].hint;
    paint();
  }

  /* ---------------------------------------------------------------- start */

  async function start() {
    try {
      const [reference, geo, decisionIndex, plenary, members, people, neighbours, blocs] =
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
        Data.getJSON('data/reference/neighbours.json').catch(function () { return null; }),
        // Parties worth following as a bloc: the Parliament records a member's
        // group but not the party they were elected for, so the membership is
        // kept here, by person id.
        Data.getJSON('data/reference/delegations.json').catch(function () { return null; })
      ]);
      calendar = plenary || { sessions: [] };
      directory = members && members.members ? members.members : null;
      memberIndex = (people && people.members) || null;
      outside = (neighbours && neighbours.countries) || {};
      delegations = (blocs && blocs.delegations) || [];

      document.body.classList.remove('is-loading');

      // A placeholder that fits the box it is in. The long one is clipped
      // mid-word on a phone, which reads as a broken field.
      if (window.matchMedia('(max-width: 34rem)').matches) {
        dom['search-input'].placeholder = 'Search a vote or an MEP…';
      }

      states = reference.states;
      statesByCode = {};
      states.forEach(function (item) { statesByCode[item.code] = item; });
      Panel.setStates(states);
      index = decisionIndex;

      const counts = index.decisions.reduce(function (totals, item) {
        totals[item.body] = (totals[item.body] || 0) + 1;
        return totals;
      }, {});
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

      geoData = geo;
      map = new EUMap(dom.map, geo, {
        // Clicking a country a second time closes it again. The map is the
        // way in and the same click is the way out, which is what a reader
        // tries first — and it goes back through the history step the first
        // click pushed, so Back and the second click end in the same place.
        onSelect: function (code) {
          if (code && code === state.country) {
            closeStep(function () { selectCountry(null); });
            return;
          }
          selectCountry(code);
        },
        onDeselect: function () {
          if (state.country) closeStep(function () { selectCountry(null); });
          else if (state.outside) closeStep(function () { closeOutside(); });
        },
        onHover: function (code) { setHovered(code); },
        onOutside: function (code) {
          if (code && code === state.outside) {
            closeStep(function () { closeOutside(); });
            return;
          }
          selectOutside(code);
        }
      });

      // A shared link opens what it names. Then the hash is cleared, so
      // reopening or reloading that tab lands on the search page rather than on
      // whatever was last looked at.
      const route = readHash();
      await loadDecision(route.decisionId, route.code);
      // Opening the site on nothing in particular: the Union, once, before the
      // reader starts. A shared link naming a vote has that to show instead.
      greetHome();
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
          unfoldedSessions.clear();
          renderFeed();
        }
      });

      // Which sessions are open is the reader's place in the list. Remember it,
      // so closing a vote puts them back where they were rather than at the top
      // of a folded list.
      dom['session-list'].addEventListener('toggle', function (event) {
        const details = event.target.closest('.session');
        if (!details) return;
        const key = details.getAttribute('data-session');
        if (details.open) unfoldedSessions.add(key);
        else unfoldedSessions.delete(key);
      }, true);

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

      // A delegation's members open their own record, like every other name
      // on the page.
      dom.outcome.addEventListener('click', function (event) {
        const person = event.target.closest('[data-member]');
        if (person) showMember(person.getAttribute('data-member'));
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
        if (event.key === 'Escape' && state.country) {
          closeStep(function () { selectCountry(null); });
        }
      });

      dom['panel-body'].addEventListener('click', function (event) {
        if (event.target.closest('.panel-close')) {
          closeStep(function () { selectCountry(null); });
          return;
        }
        const inRoll = event.target.closest('.show-in-roll');
        if (inRoll) {
          setRoll({ country: inRoll.getAttribute('data-country'), tab: 'members' });
          dom.roll.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        const seats = event.target.closest('.seat-toggle');
        if (seats) {
          toggleCountryMembers(seats);
          return;
        }
        const person = event.target.closest('[data-member]');
        if (person) {
          showMember(person.getAttribute('data-member'));
          return;
        }
        const group = event.target.closest('[data-group]');
        if (group) {
          setRoll({ group: group.getAttribute('data-group'), tab: 'members' });
          dom.roll.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        const chip = event.target.closest('[data-bloc]');
        if (chip) setIsolate('bloc', chip.getAttribute('data-bloc'));
      });

      Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (button) {
        const layer = button.getAttribute('data-layer');
        button.addEventListener('click', function () {
          // A switch: pressing it again puts the vote back on the map.
          setLayer(state.layer === layer ? 'vote' : layer, true);
        });
      });

      // One step back, wherever the reader is: the same door Back uses, so the
      // two can never disagree. With nothing left to undo it goes home.
      dom['map-back'].addEventListener('click', function () {
        closeStep(function () { goHome(); });
      });

      dom['brand-home'].addEventListener('click', function () { goHome(); });


      dom.legend.addEventListener('click', function (event) {
        const button = event.target.closest('[data-isolate]');
        if (button) setIsolate('layer', button.getAttribute('data-isolate'));
      });

      // Copy-link controls, wherever they appear. They are real links, so a
      // modifier click opens them in a tab as any link would; a plain click
      // copies the address instead of reloading the page you are already on.
      document.addEventListener('click', function (event) {
        const story = event.target.closest('.share-story');
        if (story) {
          shareStory(story);
          return;
        }
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
        if (group) {
          setRoll({ group: group.getAttribute('data-group'), tab: 'members' });
          dom.roll.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      dom['roll-body'].addEventListener('mouseover', function (event) {
        const row = event.target.closest('[data-code]');
        setHovered(row ? row.getAttribute('data-code') : null);
      });
      dom['roll-body'].addEventListener('mouseleave', function () { setHovered(null); });

      dom['back-to-votes'].addEventListener('click', function () {
        backToVotes();
      });

      window.addEventListener('popstate', function () {
        if (goingHome) return;
        popStep();
        // Back can close a country and leave the vote up, which has its own
        // thing to show. Only a Back that lands on the start page is home.
        greetHome();
      });

      window.addEventListener('hashchange', async function () {
        if (goingHome) return;
        const next = readHash();
        const current = state.decision ? state.decision.id : null;
        if (next.decisionId !== current) {
          await loadDecision(next.decisionId, next.code);
        } else if (next.code !== state.country) {
          selectCountry(next.code, { scroll: false });
        }
        // A shared link is cleared out of the address once it has been opened,
        // the same as one opened in a fresh tab. Otherwise the second link a
        // reader follows in the same tab leaves its vote behind in the address,
        // and a reload weeks later reopens it — which is the thing the clearing
        // on load exists to prevent.
        stripHash();
      });
    } catch (error) {
      document.body.classList.remove('is-loading');
      document.body.classList.add('has-failed');
      const local = location.protocol === 'file:';
      document.querySelector('main').insertAdjacentHTML('afterbegin',
        '<div class="load-error" role="alert">' +
          '<p><strong>The votes could not be loaded.</strong> ' +
          (local
            ? 'The site reads its records over HTTP, so it cannot run from a ' +
              '<code>file://</code> path. Serve the folder — <code>python3 -m http.server</code> — ' +
              'and open it at <code>localhost</code>.'
            : 'That is usually a connection that dropped mid-request. Nothing is lost; ' +
              'the records are static files and will load on a second try.') +
          '</p>' +
          '<p class="load-error-detail">' + esc(error.message) + '</p>' +
          (local ? '' : '<p><button type="button" class="button-link" id="retry-load">Try again</button></p>') +
        '</div>');
      const retry = document.getElementById('retry-load');
      if (retry) retry.addEventListener('click', function () { location.reload(); });
    }
  }

  start();
})();
