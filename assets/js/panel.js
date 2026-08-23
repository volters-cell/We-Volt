/* The country panel — the thing the whole map exists to open. Three answers,
   in the order a reader asks them: how did we vote, what does it cost us,
   what did our own press say. */
(function (global) {
  'use strict';

  const VOTE_LABEL = {
    for: 'In favour',
    against: 'Against',
    abstain: 'Abstained',
    absent: 'Did not vote',
    'not-applicable': 'No vote taken',
    unknown: 'Not recorded'
  };

  const FRAMING_LABEL = {
    supportive: 'Supportive',
    critical: 'Critical',
    mixed: 'Mixed',
    neutral: 'Neutral',
    none: 'No coverage indexed yet'
  };

  let totalPopulation = 0;

  function setStates(states) {
    totalPopulation = states.reduce(function (sum, state) { return sum + state.population; }, 0);
  }

  /* A vote count in the colour of the vote it counts. */
  function num(value, kind) {
    return '<span class="n-' + kind + '">' + escapeHTML(value) + '</span>';
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function bar(totals, seats) {
    const cast = totals.for + totals.against + totals.abstain + totals.absent;
    const total = cast || seats || 1;
    return '<div class="vote-bar" role="img" aria-label="' +
      totals.for + ' in favour, ' + totals.against + ' against, ' +
      totals.abstain + ' abstained, ' + totals.absent + ' did not vote">' +
      Data.VOTE_KEYS.map(function (key) {
        const share = (totals[key] / total) * 100;
        if (share <= 0) return '';
        return '<span class="seg seg-' + key + '" style="width:' + share.toFixed(2) + '%"></span>';
      }).join('') + '</div>';
  }

  function groupRows(country) {
    const groups = country.mepGroups || [];
    if (!groups.length) return '';
    return '<table class="group-table">' +
      '<caption>By political group</caption>' +
      '<thead><tr><th scope="col">Group</th><th scope="col">Seats</th>' +
      '<th scope="col">For</th><th scope="col">Against</th><th scope="col">Abstain</th>' +
      '<th scope="col">Absent</th></tr></thead><tbody>' +
      groups.map(function (group) {
        return '<tr><th scope="row">' + escapeHTML(group.group) + '</th>' +
          '<td>' + group.seats + '</td>' +
          '<td class="cell-for">' + (group.for || 0) + '</td>' +
          '<td class="cell-against">' + (group.against || 0) + '</td>' +
          '<td class="cell-abstain">' + (group.abstain || 0) + '</td>' +
          '<td class="cell-absent">' + (group.absent || 0) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function mepRows(country) {
    const meps = country.meps || [];
    if (!meps.length) return '';
    return '<table class="mep-table">' +
      '<caption>Every MEP from this member state</caption>' +
      '<thead><tr><th scope="col">Member</th><th scope="col">National party</th>' +
      '<th scope="col">Group</th><th scope="col">Vote</th></tr></thead><tbody>' +
      meps.map(function (mep) {
        return '<tr><th scope="row">' + escapeHTML(mep.name) + '</th>' +
          '<td>' + escapeHTML(mep.party || '—') + '</td>' +
          '<td>' + escapeHTML(mep.group || '—') + '</td>' +
          '<td><span class="vote-pill vote-' + escapeHTML(mep.vote) + '">' +
          escapeHTML(VOTE_LABEL[mep.vote] || mep.vote) + '</span></td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function positionSection(decision, country, state) {
    if (decision.body === 'commission') {
      return '<section class="card"><h3>Position</h3>' +
        '<p class="no-vote">No member state vote. ' + escapeHTML(state.name) +
        ' had no ballot to cast here — the Commission acted on powers the member states delegated to it. ' +
        'The record below is what the decision did to this country all the same.</p></section>';
    }

    const totals = Data.mepTotals(country);
    const derived = Data.countryPosition(decision, state.code);

    let html = '<section class="card"><h3>How ' + escapeHTML(state.name) + ' voted</h3>';

    if (decision.body === 'council') {
      html += '<p class="position position-' + escapeHTML(derived.position) + '">' +
        escapeHTML(VOTE_LABEL[derived.position] || derived.position) + '</p>' +
        '<p class="position-detail">One seat, one vote in the Council — cast by the ' +
        escapeHTML(country.representative || 'responsible minister') + '. ' +
        'Weight in the qualified majority: <strong>' + state.population.toFixed(1) +
        ' million</strong> people, <strong>' +
        ((state.population / (totalPopulation || 1)) * 100).toFixed(1) +
        '%</strong> of the Union.</p>';
    }

    if (totals) {
      const cast = totals.for + totals.against + totals.abstain;
      const share = cast ? Math.round((totals.for / cast) * 100) : null;
      html += '<p class="position position-' + escapeHTML(derived.position) + '">' +
        escapeHTML(VOTE_LABEL[derived.position]) +
        (derived.split ? ' <span class="split-flag">delegation split</span>' : '') + '</p>' +
        '<p class="position-detail">' +
        num(totals.for, 'for') + ' of ' + state.seats + ' MEPs in favour, ' +
        num(totals.against, 'against') + ' against, ' +
        num(totals.abstain, 'abstain') + ' abstained, ' +
        num(totals.absent, 'absent') + ' did not vote' +
        (share === null ? '.' : ' — ' + num(share + '%', totals.for > totals.against ? 'for' : 'against') +
          ' of votes cast were in favour.') +
        '</p>' + bar(totals, state.seats) + groupRows(country) + mepRows(country);
    }

    return html + '</section>';
  }

  function impactSection(decision, country) {
    const impact = country.impact;
    // No figure, no card. An empty box promising a number is worse than the
    // honest absence of one.
    if (!impact || typeof impact.value !== 'number') return '';
    const direction = impact.value < 0 ? 'cost' : (impact.value > 0 ? 'gain' : 'neutral');
    return '<section class="card"><h3>' + escapeHTML(decision.impactLabel || 'What it costs') + '</h3>' +
      '<p class="impact-value impact-' + direction + '">' +
      escapeHTML(Data.formatImpact(impact.value, decision.impactUnit)) + '</p>' +
      '<p class="impact-note">' + escapeHTML(impact.note || '') +
      (impact.sample ? ' <span class="chip chip-sample">sample figure</span>' : '') + '</p>' +
      (impact.source && impact.source.url
        ? '<p class="impact-source"><a href="' + escapeHTML(impact.source.url) + '">' +
          escapeHTML(impact.source.label || 'Source') + '</a></p>'
        : '') +
      '</section>';
  }

  function pressSection(country) {
    const press = country.press || [];
    const framing = Data.pressFraming(country);

    let html = '<section class="card"><h3>How the press told it</h3>';
    if (!press.length) {
      return html + '<p class="empty">No coverage indexed yet. This is the gap the project ' +
        'is built to close — a journalist in this country can file the first entry.</p></section>';
    }

    html += '<p class="framing-summary">Dominant framing: <span class="framing framing-' +
      escapeHTML(framing.framing) + '">' + escapeHTML(FRAMING_LABEL[framing.framing]) +
      '</span> · ' + press.length + ' item' + (press.length === 1 ? '' : 's') + ' indexed</p>';

    html += '<ul class="press-list">' + press.map(function (item) {
      return '<li class="press-item framing-border-' + escapeHTML(item.framing) + '">' +
        '<p class="press-outlet">' + escapeHTML(item.outlet) +
        (item.language ? ' <span class="lang">' + escapeHTML(item.language.toUpperCase()) + '</span>' : '') +
        (item.sample ? ' <span class="chip chip-sample">sample</span>' : '') + '</p>' +
        (item.url
          ? '<p class="press-headline"><a href="' + escapeHTML(item.url) + '">' + escapeHTML(item.headline) + '</a></p>'
          : '<p class="press-headline">' + escapeHTML(item.headline) + '</p>') +
        (item.excerpt ? '<p class="press-excerpt">' + escapeHTML(item.excerpt) + '</p>' : '') +
        '<p class="press-meta"><span class="framing framing-' + escapeHTML(item.framing) + '">' +
        escapeHTML(FRAMING_LABEL[item.framing] || item.framing) + '</span>' +
        (item.date ? ' · ' + escapeHTML(Data.formatDate(item.date)) : '') + '</p>' +
        '</li>';
    }).join('') + '</ul>';

    return html + '</section>';
  }

  const BLOCS = [
    ['euro', 'Euro', 'Outside the euro'],
    ['schengen', 'Schengen', 'Outside Schengen'],
    ['nato', 'NATO', 'Not in NATO']
  ];

  /* Which clubs a member state belongs to. Half of what makes a country's vote
     legible is which rooms it is already in: a euro member votes on economic
     governance it is bound by, a non-NATO member sits out defence files. */
  function blocs(state) {
    const memberships = state.memberships || {};
    const chips = ['<span class="bloc bloc-in bloc-eu">EU since ' + state.joined + '</span>'];

    BLOCS.forEach(function (entry) {
      const membership = memberships[entry[0]] || { member: false };
      const inside = membership.member;
      const label = inside ? entry[1] + ' since ' + membership.since : entry[2];
      const title = membership.note || (inside
        ? entry[1] + ', since ' + membership.since
        : entry[2]);
      chips.push('<button type="button" class="bloc ' + (inside ? 'bloc-in' : 'bloc-out') +
        ' bloc-' + entry[0] + '" data-bloc="' + entry[0] + '" aria-pressed="false" title="' +
        escapeHTML(title) + '">' + escapeHTML(label) + '</button>');
    });

    // Two notes side by side need to say which club each one is about.
    const notes = BLOCS
      .filter(function (entry) { return (memberships[entry[0]] || {}).note; })
      .map(function (entry) {
        return '<span class="bloc-note"><strong>' + escapeHTML(entry[1]) + ':</strong> ' +
          escapeHTML(memberships[entry[0]].note) + '</span>';
      });

    return '<div class="blocs">' + chips.join('') + '</div>' +
      (notes.length ? '<p class="bloc-notes">' + notes.join('') + '</p>' : '');
  }

  /* With no vote open, a country is still worth opening: this is who they are
     and which rooms they sit in. */
  function renderProfile(node, state, permalink) {
    node.innerHTML =
      '<header class="panel-head">' +
        '<button type="button" class="panel-close" aria-label="Close ' +
          escapeHTML(state.name) + '">Close</button>' +
        '<p class="panel-eyebrow">Member state</p>' +
        '<h2 id="panel-title">' + escapeHTML(state.name) + '</h2>' +
        '<p class="panel-facts">' + state.seats + ' MEPs · ' + state.population.toFixed(1) +
          ' million people · capital ' + escapeHTML(state.capital) + '</p>' +
        blocs(state) +
      '</header>' +
      '<section class="card">' +
        '<p class="neutral-note">Pick a vote from the list to see how ' +
        escapeHTML(state.name) + ' voted, and how its press told the story.</p>' +
        '<p class="panel-actions"><a class="permalink" href="' + escapeHTML(permalink) +
        '">Link to this country</a></p>' +
      '</section>';
    node.hidden = false;
  }

  function render(node, decision, state, permalink) {
    const country = decision.countries[state.code] || {};
    node.innerHTML =
      '<header class="panel-head">' +
        '<button type="button" class="panel-close" aria-label="Close ' +
          escapeHTML(state.name) + '">Close</button>' +
        '<p class="panel-eyebrow">' + escapeHTML(decision.bodyLabel) + ' · ' +
          escapeHTML(Data.formatDate(decision.date)) + '</p>' +
        '<h2 id="panel-title">' + escapeHTML(state.name) + '</h2>' +
        '<p class="panel-facts">' + state.seats + ' MEPs · ' + state.population.toFixed(1) +
          ' million people · capital ' + escapeHTML(state.capital) + '</p>' +
        blocs(state) +
        '<p class="panel-actions"><a class="permalink" href="' + escapeHTML(permalink) +
          '">Link to this country’s record</a></p>' +
      '</header>' +
      positionSection(decision, country, state) +
      impactSection(decision, country) +
      pressSection(country) +
      (country.note ? '<p class="country-note">' + escapeHTML(country.note) + '</p>' : '');
    node.hidden = false;
  }

  global.Panel = { render: render, renderProfile: renderProfile, setStates: setStates, VOTE_LABEL: VOTE_LABEL, FRAMING_LABEL: FRAMING_LABEL, escapeHTML: escapeHTML };
})(window);
