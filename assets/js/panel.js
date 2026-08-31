/* The country panel — the thing the whole map exists to open: how did this
   country vote, member by member and group by group. */
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
    const groups = (country.mepGroups || []).filter(function (group) {
      return (group.for || 0) + (group.against || 0) + (group.abstain || 0) > 0;
    });
    if (!groups.length) return '';
    // Votes cast, not seats held: no record says how large a national
    // delegation's group was on the day, so nothing is claimed about it. The
    // members who did not vote are stated once, above, for the whole
    // delegation, where the seat count makes it a stable figure.
    return '<div class="table-scroll"><table class="group-table">' +
      '<caption>By political group</caption>' +
      '<thead><tr><th scope="col">Group</th><th scope="col">Votes cast</th>' +
      '<th scope="col">For</th><th scope="col">Against</th>' +
      '<th scope="col">Abstain</th></tr></thead><tbody>' +
      groups.map(function (group) {
        const cast = (group.for || 0) + (group.against || 0) + (group.abstain || 0);
        return '<tr><th scope="row" class="group-cell">' +
          (global.Groups ? global.Groups.swatch(group.group) : '') +
          '<span>' + escapeHTML(group.group) + '</span></th>' +
          '<td>' + cast + '</td>' +
          '<td class="cell-for">' + (group.for || 0) + '</td>' +
          '<td class="cell-against">' + (group.against || 0) + '</td>' +
          '<td class="cell-abstain">' + (group.abstain || 0) + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
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
      // The delegation's size is the seats it holds, always — never the number
      // of ballots this particular record happens to carry. Records read from
      // the Parliament's portal name only the members who voted, so counting
      // ballots would change the denominator from one vote to the next.
      const cast = totals.for + totals.against + totals.abstain;
      const silent = Math.max(0, state.seats - cast);
      totals.total = state.seats;
      const share = cast ? Math.round((totals.for / cast) * 100) : null;
      html += '<p class="position position-' + escapeHTML(derived.position) + '">' +
        escapeHTML(VOTE_LABEL[derived.position]) + '</p>' +
        '<p class="position-detail">' +
        num(totals.for, 'for') + ' of ' + state.seats + ' MEPs in favour, ' +
        num(totals.against, 'against') + ' against, ' +
        num(totals.abstain, 'abstain') + ' abstained, ' +
        num(silent, 'absent') + ' did not vote' +
        (share === null ? '.' : ' — ' + num(share + '%', totals.for > totals.against ? 'for' : 'against') +
          ' of votes cast were in favour.') +
        '</p>' + bar(totals, state.seats) + groupRows(country) +
        '<p class="panel-actions"><button type="button" class="show-in-roll" data-country="' +
        escapeHTML(state.code) + '">Show ' + escapeHTML(state.name) + '’s members in the vote' +
        '</button></p>';
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
        escapeHTML(state.name) + ' voted, member by member.</p>' +
        '<p class="panel-actions"><a class="permalink" href="' + escapeHTML(permalink) +
        '" data-copy="' + escapeHTML(permalink) + '">Copy link to this country</a></p>' +
      '</section>';
    node.hidden = false;
  }

  /* A country the map draws in grey. It has no vote in these records, so what
     is worth saying is who they are and where they stand with the Union. */
  function renderOutside(node, code, country) {
    const eu = country.eu || {};
    const chips = [];

    if (eu.status === 'candidate') {
      chips.push('<span class="bloc bloc-in bloc-candidate">EU candidate since ' + eu.since + '</span>');
    } else if (eu.status === 'applicant') {
      // Applied, but not granted candidate status — the distinction the
      // Commission draws, and the one Kosovo sits on.
      chips.push('<span class="bloc bloc-in bloc-candidate">Applied to join in ' + eu.since + '</span>');
    } else if (eu.status === 'former') {
      chips.push('<span class="bloc bloc-out">Left the EU in ' + eu.since + '</span>');
    } else {
      chips.push('<span class="bloc bloc-out">Not in the EU</span>');
    }
    if (country.eea) chips.push('<span class="bloc bloc-in">European Economic Area</span>');
    chips.push(country.schengen
      ? '<span class="bloc bloc-in">Schengen</span>'
      : '<span class="bloc bloc-out">Outside Schengen</span>');
    chips.push(country.nato
      ? '<span class="bloc bloc-in bloc-nato">NATO since ' + country.nato + '</span>'
      : '<span class="bloc bloc-out">Not in NATO</span>');
    if (country.euro) {
      chips.push('<span class="bloc bloc-in bloc-euro">Uses the euro ' +
        escapeHTML(country.euro === true ? '' : country.euro) + '</span>');
    }

    const people = country.population >= 1
      ? country.population.toFixed(1) + ' million people'
      : Math.round(country.population * 1000) + ' thousand people';

    node.innerHTML =
      '<header class="panel-head">' +
        '<button type="button" class="panel-close" aria-label="Close ' +
          escapeHTML(country.name) + '">Close</button>' +
        '<p class="panel-eyebrow">Outside the Union</p>' +
        '<h2 id="panel-title">' + escapeHTML(country.name) + '</h2>' +
        '<p class="panel-facts">' + escapeHTML(people) + ' · capital ' +
          escapeHTML(country.capital) + '</p>' +
        '<div class="blocs">' + chips.join('') + '</div>' +
        (eu.note || country.populationNote || country.natoNote
          ? '<p class="bloc-notes">' +
            (eu.note ? '<span class="bloc-note">' + escapeHTML(eu.note) + '</span>' : '') +
            // A territory can be covered by an alliance without being a member
            // of it; the chip alone would say the wrong thing about Greenland.
            (country.natoNote
              ? '<span class="bloc-note">NATO: ' + escapeHTML(country.natoNote) + '</span>'
              : '') +
            (country.populationNote
              ? '<span class="bloc-note">Population: ' + escapeHTML(country.populationNote) + '</span>'
              : '') + '</p>'
          : '') +
      '</header>' +
      '<section class="card"><p class="neutral-note">' + escapeHTML(country.name) +
        ' sends no members to the European Parliament, so it casts no votes in these ' +
        'records. It is drawn here because what the Union decides rarely stops at its ' +
        'own border.</p></section>';
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
          '" data-copy="' + escapeHTML(permalink) +
          '">Copy link to this country’s record</a></p>' +
      '</header>' +
      positionSection(decision, country, state) +
      impactSection(decision, country) +
      (country.note ? '<p class="country-note">' + escapeHTML(country.note) + '</p>' : '');
    if (global.Groups) global.Groups.loadLogos(node);
    node.hidden = false;
  }

  global.Panel = { render: render, renderProfile: renderProfile, renderOutside: renderOutside,
    setStates: setStates, VOTE_LABEL: VOTE_LABEL, escapeHTML: escapeHTML };
})(window);
