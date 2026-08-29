/* Sharing the site itself.

   The button in the header opens a short menu of places to send it. Each entry
   is an ordinary link with the address and a line of text already in it, so it
   works with a click, a middle click, or a keyboard, and needs no third-party
   script watching the page.

   Where the browser has a share sheet of its own — a phone, mostly — that is
   offered first, because it reaches whatever the reader actually uses. */
(function (global) {
  'use strict';

  const TITLE = 'EU Tracker';
  const TEXT = 'Every roll-call vote of the European Parliament, member by member.';

  function url() {
    // The site, not the vote you happen to have open.
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  function icon(path) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + path + '</svg>';
  }

  const MARKS = {
    bluesky: icon('<path d="M5.77 3.4C8.32 5.3 11.06 9.17 12 11.25c.94-2.08 3.68-5.94 6.23-7.85 1.84-1.38 4.77-2.44 4.77.9 0 .67-.38 5.6-.6 6.4-.79 2.79-3.64 3.5-6.17 3.07 4.42.75 5.54 3.24 3.11 5.73-4.61 4.73-6.63-1.19-7.14-2.71-.1-.28-.15-.41-.15-.3 0-.11-.05.02-.15.3-.51 1.52-2.53 7.44-7.14 2.71-2.43-2.49-1.31-4.98 3.11-5.73-2.53.43-5.37-.28-6.17-3.07C1.48 9.9 1.1 4.97 1.1 4.3c0-3.34 2.93-2.28 4.67-.9z" fill="currentColor" stroke="none"/>'),
    mastodon: icon('<path d="M20.9 8.9c0-3.5-2.3-4.5-2.3-4.5C17.5 3.9 15.6 3.6 13.6 3.6h-.1c-2 0-3.9.3-5 .8 0 0-2.3 1-2.3 4.5v3.3c0 3.9.3 7.3 4.6 7.4 1.6.1 3-.3 3-.3v-2.1s-1.8.5-3.1.5c-1.9 0-2.4-1-2.4-2.5 0 0 .9.2 2.7.3 1.3.1 2.7 0 4-.3 2.6-.5 4.9-1.9 5.2-4.2.5-3.6.4-2.1.4-2.1zm-3.3 5.4h-2v-5c0-1-.4-1.6-1.3-1.6-1 0-1.5.6-1.5 1.9v2.7h-2V9.6c0-1.3-.5-1.9-1.5-1.9-.9 0-1.3.5-1.3 1.6v5h-2V9.2c0-1 .3-1.9.8-2.5.6-.6 1.3-.9 2.2-.9 1.1 0 1.9.4 2.4 1.2l.5.8.5-.8c.5-.8 1.3-1.2 2.4-1.2.9 0 1.6.3 2.2.9.5.6.8 1.4.8 2.5v5.1z" fill="currentColor" stroke="none"/>'),
    x: icon('<path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.2L4.7 21H1.5l7.5-8.6L1.2 3h6.6l4.5 5.7L17.5 3zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3z" fill="currentColor" stroke="none"/>'),
    linkedin: icon('<path d="M4.9 3.5a2.1 2.1 0 1 1 0 4.2 2.1 2.1 0 0 1 0-4.2zM3.2 9.2h3.4V21H3.2V9.2zm6 0h3.2v1.6h.1c.5-.9 1.6-1.8 3.3-1.8 3.5 0 4.2 2.3 4.2 5.3V21h-3.4v-5.2c0-1.3 0-2.9-1.8-2.9s-2 1.4-2 2.8V21H9.2V9.2z" fill="currentColor" stroke="none"/>'),
    whatsapp: icon('<path d="M12 2.5a9.4 9.4 0 0 0-8 14.3L2.5 21.5l4.9-1.4A9.4 9.4 0 1 0 12 2.5zm5.5 13.3c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-3.2-.8-2.7-1.1-4.4-3.9-4.5-4.1-.1-.2-1.1-1.4-1.1-2.7 0-1.3.7-1.9.9-2.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.5c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l2 .9c.2.1.4.2.4.3.1.1.1.7-.1 1.3z" fill="currentColor" stroke="none"/>'),
    telegram: icon('<path d="M21.9 4.3 2.9 11.6c-1 .4-1 1.3 0 1.6l4.6 1.4 1.8 5.4c.2.6.5.7 1 .3l2.6-2.1 4.5 3.3c.8.5 1.4.2 1.6-.8l3-14.1c.2-1-.4-1.5-1.1-1.3zM8.9 14.2l9.3-5.8c.4-.3.8-.1.5.2l-7.7 7-.3 3.2-1.8-4.6z" fill="currentColor" stroke="none"/>'),
    signal: icon('<path d="M12 2.4c-5.4 0-9.8 3.9-9.8 8.6 0 2.5 1.2 4.7 3.1 6.2l-1 3.6c-.2.6.4 1.1 1 .8l4-1.9c.9.2 1.8.3 2.7.3 5.4 0 9.8-3.9 9.8-8.6S17.4 2.4 12 2.4z" fill="currentColor" stroke="none"/>'),
    instagram: icon('<path d="M7.6 2.5h8.8a5.1 5.1 0 0 1 5.1 5.1v8.8a5.1 5.1 0 0 1-5.1 5.1H7.6a5.1 5.1 0 0 1-5.1-5.1V7.6a5.1 5.1 0 0 1 5.1-5.1zm0 2a3.1 3.1 0 0 0-3.1 3.1v8.8a3.1 3.1 0 0 0 3.1 3.1h8.8a3.1 3.1 0 0 0 3.1-3.1V7.6a3.1 3.1 0 0 0-3.1-3.1H7.6zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.4-2.7a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" fill="currentColor" stroke="none"/>'),
    email: icon('<path d="M3.5 5h17a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm.9 2 7.6 5.6L19.6 7H4.4z" fill="currentColor" stroke="none"/>'),
    copy: icon('<path d="M9 3h9a2 2 0 0 1 2 2v9h-2V5H9V3zM5 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v10h9V9H5z" fill="currentColor" stroke="none"/>'),
    device: icon('<path d="M12 3.2 8.4 6.8l1.4 1.4L11 7v9h2V7l1.2 1.2 1.4-1.4L12 3.2zM5 13v6.8c0 .7.5 1.2 1.2 1.2h11.6c.7 0 1.2-.5 1.2-1.2V13h-2v6H7v-6H5z" fill="currentColor" stroke="none"/>')
  };

  function links() {
    const e = encodeURIComponent;
    const address = url();
    const sentence = TITLE + ' — ' + TEXT;
    return [
      { key: 'bluesky', label: 'Bluesky', href: 'https://bsky.app/intent/compose?text=' + e(sentence + ' ' + address) },
      { key: 'mastodon', label: 'Mastodon', href: 'https://mastodonshare.com/?text=' + e(sentence) + '&url=' + e(address) },
      { key: 'x', label: 'X', href: 'https://x.com/intent/tweet?text=' + e(sentence) + '&url=' + e(address) },
      { key: 'linkedin', label: 'LinkedIn', href: 'https://www.linkedin.com/sharing/share-offsite/?url=' + e(address) },
      { key: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/?text=' + e(sentence + ' ' + address) },
      { key: 'telegram', label: 'Telegram', href: 'https://t.me/share/url?url=' + e(address) + '&text=' + e(sentence) },
      // Signal and Instagram take nothing from a web page: Signal has no share
      // address at all, and Instagram accepts no link from outside the app. So
      // these two copy the link instead of pretending to open something, and
      // say so. On a phone the share sheet at the top reaches both properly.
      { key: 'signal', label: 'Signal', copy: 'Copied for Signal',
        title: 'Signal has no web link — this copies the address to paste into a chat' },
      { key: 'instagram', label: 'Instagram', copy: 'Copied for Instagram',
        title: 'Instagram takes no links from the web — this copies the address to paste' },
      { key: 'email', label: 'Email', href: 'mailto:?subject=' + e(TITLE) + '&body=' + e(sentence + '\n\n' + address) }
    ];
  }

  function build(menu) {
    const rows = [];

    if (navigator.share) {
      rows.push('<button type="button" role="menuitem" class="share-row" data-native="1">' +
        MARKS.device + '<span>Share…</span></button>');
    }

    rows.push('<button type="button" role="menuitem" class="share-row" data-copy-site="1">' +
      MARKS.copy + '<span>Copy link</span></button>');

    rows.push('<hr>');

    links().forEach(function (item) {
      if (item.copy) {
        rows.push('<button type="button" role="menuitem" class="share-row"' +
          ' data-copy-site="1" data-said="' + item.copy + '" title="' + item.title + '">' +
          MARKS[item.key] + '<span>' + item.label + '</span></button>');
        return;
      }
      rows.push('<a role="menuitem" class="share-row" href="' + item.href +
        '" target="_blank" rel="noopener noreferrer">' + MARKS[item.key] +
        '<span>' + item.label + '</span></a>');
    });

    menu.innerHTML = rows.join('');
  }

  function start() {
    const wrap = document.getElementById('site-share');
    const control = document.getElementById('site-share-button');
    const menu = document.getElementById('site-share-menu');
    if (!wrap || !control || !menu) return;

    build(menu);

    function close(focus) {
      if (menu.hidden) return;
      menu.hidden = true;
      control.setAttribute('aria-expanded', 'false');
      if (focus) control.focus();
    }

    function open() {
      menu.hidden = false;
      control.setAttribute('aria-expanded', 'true');
      const first = menu.querySelector('.share-row');
      if (first) first.focus();
    }

    control.addEventListener('click', function () {
      if (menu.hidden) open(); else close(false);
    });

    menu.addEventListener('click', function (event) {
      const row = event.target.closest('.share-row');
      if (!row) return;

      if (row.hasAttribute('data-native')) {
        event.preventDefault();
        navigator.share({ title: TITLE, text: TEXT, url: url() }).catch(function () {});
        close(true);
        return;
      }

      if (row.hasAttribute('data-copy-site')) {
        event.preventDefault();
        const said = row.querySelector('span');
        const was = said.textContent;
        const message = row.getAttribute('data-said') || 'Link copied';
        const done = function () {
          said.textContent = message;
          setTimeout(function () { said.textContent = was; close(true); }, 900);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url()).then(done, done);
        } else {
          const field = document.createElement('input');
          field.value = url();
          document.body.appendChild(field);
          field.select();
          try { document.execCommand('copy'); } catch (error) { /* nothing to do */ }
          document.body.removeChild(field);
          done();
        }
        return;
      }

      close(false);   // an ordinary link: let it open, and tidy up behind it
    });

    // Clicking away, or Escape, closes it — the two things a reader tries.
    document.addEventListener('click', function (event) {
      if (!wrap.contains(event.target)) close(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        event.stopPropagation();
        close(true);
      }
    });

    // Up and down walk the menu, as a menu should.
    menu.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const rows = Array.prototype.slice.call(menu.querySelectorAll('.share-row'));
      const at = rows.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
      rows[(next + rows.length) % rows.length].focus();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(window);
