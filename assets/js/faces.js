/* The faces of the Parliament.

   Every member has an official portrait, published by the Parliament itself at
   a predictable address: europarl.europa.eu/mepphoto/<person id>.jpg. Nothing
   has to be fetched, mirrored or stored here — the address is derived from the
   id the vote records already carry, and the browser loads it like any image.

   A portrait can be missing: a member who has just arrived, or one whose
   photograph the Parliament has not published. So every avatar is drawn twice
   over: initials on the colour of the member's political group underneath, and
   the photograph on top of it. If the photograph never arrives the initials
   stay, which is a face-shaped thing with the right name on it rather than a
   broken image. */
(function (global) {
  'use strict';

  /* The copies kept here. The Parliament's own address answers a browser and
     turns an automated request away, so the portraits are mirrored into the
     repository — and a page drawing seven hundred faces then draws them from
     the same server as everything else rather than sending seven hundred
     requests to somebody else's. */
  const MIRROR = 'assets/faces/';
  const PHOTO = 'https://www.europarl.europa.eu/mepphoto/';

  function escape(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Two letters: the first of the given name and the first of the family name.
     The Parliament writes a member as "Grégory ALLIONE" — the family name in
     capitals — so the capitals are the surname wherever they appear. */
  function initials(name) {
    const parts = String(name || '').split(/\s+/).filter(Boolean);
    if (!parts.length) return '·';
    const surname = parts.filter(function (part) {
      return part.length > 1 && part === part.toUpperCase();
    });
    const first = parts[0];
    const last = surname.length ? surname[0] : parts[parts.length - 1];
    const one = first.charAt(0);
    const two = last === first ? '' : last.charAt(0);
    return (one + two).toUpperCase();
  }

  /* Where to find a member's face: the copy kept here first. */
  function url(member) {
    const id = member && typeof member === 'object' ? member.id : member;
    return id ? MIRROR + encodeURIComponent(String(id)) + '.jpg' : '';
  }

  /* And where it came from: the address the Parliament's own record of that
     person gives, which a member imported since the last mirror still has even
     though no copy has been taken of it yet. */
  function source(member) {
    if (member && typeof member === 'object') {
      if (member.photo) return member.photo;
      return member.id ? PHOTO + encodeURIComponent(String(member.id)) + '.jpg' : '';
    }
    return member ? PHOTO + encodeURIComponent(String(member)) + '.jpg' : '';
  }

  /* avatar(member, options) -> the markup for one face.

     member: { id, name, group }
     options.size: 'sm' (a row), 'md' (a list), 'lg' (a profile)
     options.eager: load it now rather than when it scrolls into view — for the
     one face at the top of a profile, which is on screen already. */
  function avatar(member, options) {
    const settings = options || {};
    const size = settings.size || 'sm';
    const ink = global.Groups ? Groups.colour(member.group) : null;
    const style = ink ? ' style="background:' + ink.fill + ';color:' + ink.ink + '"' : '';

    return '<span class="face face-' + size + '"' + style + ' aria-hidden="true">' +
      '<span class="face-initials">' + escape(initials(member.name)) + '</span>' +
      (member.id
        ? '<img class="face-photo" alt="" src="' + escape(url(member)) + '"' +
          ' loading="' + (settings.eager ? 'eager' : 'lazy') + '" decoding="async"' +
          ' data-source="' + escape(source(member)) + '"' +
          // One retry at the Parliament's own address, for a member who joined
          // since the last mirror; then the initials, which are always right.
          ' onload="this.classList.add(\'is-there\')"' +
          ' onerror="if(this.dataset.source&&this.src!==this.dataset.source)' +
          '{this.src=this.dataset.source;}else{this.remove();}">'
        : '') +
      '</span>';
  }

  global.Faces = { avatar: avatar, url: url, source: source, initials: initials };
})(window);
