/* Light, dark, or whatever the machine says.

   Three states, one button. The icon shows the state you are in — a sun, a
   moon, or a half-filled circle for "follow the system" — and the label says
   what the next press will do, so the control is legible whether you read it
   or look at it.

   The choice is remembered. Storage can be refused outright (a private window,
   a browser set to block it), so every read and write is guarded: the site
   works without memory, it just forgets. */
(function (global) {
  'use strict';

  const KEY = 'eu-tracker-theme';
  const ORDER = ['light', 'dark', 'system'];

  const ICONS = {
    light: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="4.4" fill="none"/>' +
      '<line x1="12" y1="1.9" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.1"/>' +
      '<line x1="1.9" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.1" y2="12"/>' +
      '<line x1="4.9" y1="4.9" x2="6.4" y2="6.4"/><line x1="17.6" y1="17.6" x2="19.1" y2="19.1"/>' +
      '<line x1="4.9" y1="19.1" x2="6.4" y2="17.6"/><line x1="17.6" y1="6.4" x2="19.1" y2="4.9"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M20.7 13.5A8.5 8.5 0 0 1 10.5 3.3 8.6 8.6 0 1 0 20.7 13.5z" ' +
      'fill="currentColor" stroke="none"/></svg>',
    // A circle with one half filled: neither chosen, the machine decides.
    system: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.2" fill="none"/>' +
      '<path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none"/></svg>'
  };

  const NEXT_LABEL = {
    light: 'Light theme. Switch to dark.',
    dark: 'Dark theme. Switch to follow the system.',
    system: 'Following the system. Switch to light.'
  };

  let current = null;

  function stored() {
    try {
      const value = localStorage.getItem(KEY);
      return ORDER.indexOf(value) === -1 ? null : value;
    } catch (error) {
      return null;   // storage refused; the default stands
    }
  }

  function remember(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch (error) {
      // nothing to do: the choice holds for this visit and no longer
    }
  }

  function button() {
    return document.getElementById('theme-toggle');
  }

  function apply(theme, options) {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    current = theme;

    const control = button();
    if (control) {
      control.innerHTML = ICONS[theme];
      control.setAttribute('aria-label', NEXT_LABEL[theme]);
      control.setAttribute('title', NEXT_LABEL[theme]);
      control.setAttribute('data-theme-state', theme);
    }

    if (!(options && options.quiet)) {
      remember(theme);
      global.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
    }
  }

  function cycle() {
    apply(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
  }

  function start() {
    apply(stored() || 'light', { quiet: !stored() });

    const control = button();
    // A button already answers Enter and Space by firing click. Handling those
    // keys as well is how a control ends up switching twice on one press.
    if (control) control.addEventListener('click', cycle);

    try {
      global.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (current === 'system') apply('system', { quiet: true });
      });
    } catch (error) {
      // an older browser without matchMedia listeners: nothing breaks
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.EUTheme = { get: function () { return current; }, set: apply, cycle: cycle };
})(window);
