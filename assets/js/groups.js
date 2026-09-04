/* The political groups: what they are called, what they are drawn as, and how
   a group's own logo replaces that drawing.

   One file because a group has to look the same everywhere it appears — in the
   roll-call breakdown, in the country panel, in a member's profile. Two copies
   of this table would drift, and a reader would meet two different marks for
   the same group on one page. */
(function (global) {
  'use strict';

  /* Short names for the interface, and the Parliament's own full names, which
     are what a reader gets on hover and what a screen reader announces. */
  const NAMES = {
    'EPP': 'European People’s Party',
    'S&D': 'Progressive Alliance of Socialists and Democrats',
    'PfE': 'Patriots for Europe',
    'ECR': 'European Conservatives and Reformists',
    'Renew': 'Renew Europe',
    'Greens/EFA': 'Greens / European Free Alliance',
    'The Left': 'The Left in the European Parliament',
    'ESN': 'Europe of Sovereign Nations',
    'NI': 'Non-attached members'
  };

  const OFFICIAL = {
    'EPP': 'Group of the European People’s Party (Christian Democrats)',
    'S&D': 'Group of the Progressive Alliance of Socialists and Democrats in the European Parliament',
    'PfE': 'Patriots for Europe Group',
    'ECR': 'European Conservatives and Reformists Group',
    'Renew': 'Renew Europe Group',
    'Greens/EFA': 'Group of the Greens/European Free Alliance',
    'The Left': 'The Left group in the European Parliament — GUE/NGL',
    'ESN': 'Europe of Sovereign Nations Group',
    'NI': 'Non-attached Members'
  };

  // What fits on a tile, which is not always what the group is called.
  const TILES = { 'Greens/EFA': 'Greens', 'The Left': 'Left' };

  /* The colours these groups are conventionally drawn in — the ones a reader
     recognises from a seat chart. They are approximations, not brand values
     taken from the groups themselves, and they live here so they can be
     corrected in one place. A group with a logo file in assets/groups/ uses
     that instead; see the README there, including on whose marks these are. */
  const COLOURS = {
    'EPP': { fill: '#3399ff', ink: '#08213f' },
    'S&D': { fill: '#e4002b', ink: '#ffffff' },
    'PfE': { fill: '#1b3a6b', ink: '#ffffff' },
    'ECR': { fill: '#0054a5', ink: '#ffffff' },
    'Renew': { fill: '#ffd200', ink: '#3a2f00' },
    'Greens/EFA': { fill: '#4aa64a', ink: '#ffffff' },
    'The Left': { fill: '#8b1a1a', ink: '#ffffff' },
    'ESN': { fill: '#4b5b6b', ink: '#ffffff' },
    'NI': { fill: '#9aa2b1', ink: '#14181f' }
  };

  const FALLBACK = { fill: 'var(--surface-sunken)', ink: 'var(--ink-soft)' };

  function slug(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function escape(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function name(key) { return NAMES[key] || key; }
  function official(key) { return OFFICIAL[key] || NAMES[key] || key; }
  function tileText(key) { return TILES[key] || key; }
  function colour(key) { return COLOURS[key] || FALLBACK; }

  /* The mark itself: a coloured tile carrying the group's short form, which a
     logo replaces once one has been added. `extra` is for the classes a
     particular list needs. */
  function mark(key, extra, options) {
    const ink = colour(key);
    const lettered = !options || options.lettered !== false;
    return '<span class="bd-tile bd-tile-group' + (extra ? ' ' + extra : '') + '"' +
      ' data-logo="' + escape(slug(key)) + '"' +
      ' title="' + escape(official(key)) + '"' +
      ' style="background:' + ink.fill + ';color:' + ink.ink + ';border-color:' + ink.fill + '">' +
      (lettered ? escape(tileText(key)) : '') + '</span>';
  }

  /* The same mark, without its lettering: for a row that names the group in
     the next breath, where a second copy of the name would only clip. It still
     becomes the group's logo once one is added. */
  function swatch(key) {
    return mark(key, 'bd-tile-swatch', { lettered: false });
  }

  /* A group's own logo where one has been added, its conventional colour
     otherwise. The image is swapped in only once it has actually loaded, so a
     missing file leaves the tile alone rather than leaving a hole. Called on
     whatever has just been rendered, so every list gets the same treatment. */
  /* Which logo files exist, asked for once. scripts/build-index.mjs writes the
     list; guessing instead would mean a failed request for every group nobody
     has added a logo for yet. */
  /* Artwork drawn in white. A group that sets its mark in white publishes only
     that version — it lives on the group's own colour on their site — so here
     it keeps the group's colour behind it rather than vanishing into the page.
     Measured from the files themselves, not guessed: every mark was rendered
     and its ink read, and these are the ones with no ink darker than white.
     Re-measure after a re-fetch; scripts/mirror-group-logos.mjs says so. */
  const WHITE_INK = { 'greens-efa': true };

  let available = null;

  function logoList() {
    if (available) return available;
    available = fetch('assets/groups/logos.json', { cache: 'no-cache' })
      .then(function (response) { return response.ok ? response.json() : []; })
      .catch(function () { return []; });
    return available;
  }

  function loadLogos(root) {
    if (!root) return;
    const marks = Array.prototype.slice.call(root.querySelectorAll('[data-logo]'));
    if (!marks.length) return;

    logoList().then(function (files) {
      if (!files.length) return;
      marks.forEach(function (node) {
        if (node.classList.contains('has-logo')) return;
        const key = node.getAttribute('data-logo');
        const file = files.find(function (name) {
          return name.replace(/\.(svg|png|jpe?g)$/i, '') === key;
        });
        if (!file) return;

        const image = new Image();
        image.onload = function () {
          if (node.querySelector('img')) return;
          node.textContent = '';
          node.classList.add('has-logo');
          if (WHITE_INK[key]) {
            // Keep the group's colour under white artwork; the tile already
            // carries it.
            node.classList.add('has-logo-on-colour');
          } else {
            node.style.background = '';
            node.style.borderColor = '';
          }
          image.alt = '';
          node.appendChild(image);
        };
        image.src = 'assets/groups/' + file;
      });
    });
  }

  global.Groups = {
    name: name,
    official: official,
    tile: tileText,
    colour: colour,
    slug: slug,
    mark: mark,
    swatch: swatch,
    loadLogos: loadLogos
  };
})(window);
