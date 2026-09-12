/* Light or dark.

   Two states, one switch. The sun and the moon are both in view and the knob
   says which one you are in — the control shows its state rather than naming
   the next one, which is what a switch is for.

   There used to be a third state, "follow the system", reached by pressing a
   round button twice. A switch has two positions, so it is gone. A visitor who
   had chosen it still has it in storage; that is read once, resolved to
   whatever the machine says at that moment, and written back as a real choice.

   On a phone there is no switch and no choice: the site is light. The width
   that decides this is the same 40rem at which the header becomes the phone
   header, so "the phone version" means one thing across the site. A dark
   theme chosen on a desktop is not forgotten when you open the site on a
   phone — it is left in storage, unapplied, and is there again on the
   desktop. Narrowing a desktop window past 40rem does the same thing, which
   is what keeps the rule honest: the switch is never hidden while the theme
   it controls is still dark.

   The choice is remembered. Storage can be refused outright (a private window,
   a browser set to block it), so every read and write is guarded: the site
   works without memory, it just forgets.

   SPDX-License-Identifier: AGPL-3.0-or-later
*/
(function (global) {
  'use strict';

  const KEY = 'eu-tracker-theme';
  const THEMES = ['light', 'dark'];
  // The width at which the header becomes the phone header.
  const PHONE = '(max-width: 40rem)';

  const LABEL = {
    light: { aria: 'Dark theme', title: 'Switch to the dark theme' },
    dark: { aria: 'Light theme', title: 'Switch to the light theme' }
  };

  let current = null;

  function phone() {
    try {
      return global.matchMedia(PHONE).matches;
    } catch (error) {
      return global.innerWidth <= 640;   // no matchMedia: fall back to the width
    }
  }

  function machine() {
    try {
      return global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (error) {
      return 'light';   // no matchMedia: the site's own default stands
    }
  }

  /* What is in storage, as one of the two states. "system" is what an older
     visit may have saved; it means "whatever the machine says", so that is
     what it is worth now. */
  function stored() {
    let value = null;
    try {
      value = localStorage.getItem(KEY);
    } catch (error) {
      return null;   // storage refused; the default stands
    }
    if (value === 'system') return machine();
    return THEMES.indexOf(value) === -1 ? null : value;
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
    if (THEMES.indexOf(theme) === -1) theme = machine();
    /* The phone has one theme. Asking for another is answered with light
       rather than refused, so every caller — the switch, the keyboard
       shortcut, EUTheme.set — behaves the same way and none of them has to
       know about the width. */
    if (phone()) theme = 'light';
    document.documentElement.setAttribute('data-theme', theme);
    current = theme;

    /* The knob is placed by CSS from data-theme, so nothing here moves it.
       What the switch needs from this side is the part a screen reader reads:
       whether it is on, and what turning it does. */
    const control = button();
    if (control) {
      control.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
      control.setAttribute('aria-label', LABEL[theme].aria);
      control.setAttribute('title', LABEL[theme].title);
    }

    if (!(options && options.quiet)) {
      remember(theme);
      global.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
    }
  }

  function cycle() {
    apply(current === 'dark' ? 'light' : 'dark');
  }

  function start() {
    const saved = stored();
    /* The site's default is light, and the inline script in the page head has
       already painted it. Applying it quietly keeps that true without writing
       a choice nobody made. On a phone the saved choice is not applied at all
       and not written back either: it belongs to the desktop and is left
       where it is. */
    apply(saved || 'light', { quiet: !saved || phone() });
    // An older "system" has just been resolved; write it back as a real choice
    // so it is not resolved again on the next visit.
    if (saved && !phone()) remember(saved);

    const control = button();
    // A button already answers Enter and Space by firing click. Handling those
    // keys as well is how a control ends up switching twice on one press.
    if (control) control.addEventListener('click', cycle);

    /* Crossing the width — a rotated phone, a resized window — moves the
       switch in or out of the page, so the theme moves with it: light while
       the switch is gone, the saved choice again once it is back. */
    try {
      global.matchMedia(PHONE).addEventListener('change', function () {
        apply(phone() ? 'light' : (stored() || 'light'), { quiet: true });
      });
    } catch (error) {
      // an older browser without matchMedia listeners: the theme holds
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.EUTheme = { get: function () { return current; }, set: apply, cycle: cycle };
})(window);
