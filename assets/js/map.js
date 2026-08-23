/* The map itself: one SVG, one path per member state, three colour layers.
   Everything a mouse can do here, a keyboard can do too. */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WIDTH = 760;
  const HEIGHT = 700;
  const SMALL_AREA = 300;   // px² — below this a state needs a click target of its own
const TIGHT_LABEL = 9;    // px of inscribed radius — below this the name will not fit inside

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function EUMap(container, geo, handlers) {
    this.container = container;
    this.handlers = handlers || {};
    this.layout = Projection.layout(geo, WIDTH, HEIGHT, 18);
    this.shapes = {};
    this.selected = null;
    this.hovered = null;
    this.revealed = {};
    this.dimmed = null;
    this.timers = [];
    this.build();
  }

  EUMap.prototype.build = function () {
    const self = this;

    const svg = el('svg', {
      viewBox: '0 0 ' + WIDTH + ' ' + HEIGHT,
      class: 'eu-map',
      role: 'group',
      'aria-label': 'Member states of the European Union'
    });

    // Neighbours are context: grey, unlabelled, and invisible to the pointer,
    // the keyboard and the screen reader alike.
    const contextLayer = el('g', { class: 'context', 'aria-hidden': 'true' });
    const shapeLayer = el('g', { class: 'shapes' });
    const labelLayer = el('g', { class: 'labels', 'aria-hidden': 'true' });

    this.layout.shapes.forEach(function (shape) {
      if (!shape.member) {
        contextLayer.appendChild(el('path', { d: shape.path, class: 'context-shape' }));
        return;
      }
      const small = shape.area < SMALL_AREA;
      // A label that cannot sit inside the country is drawn above it in dark
      // type instead of white-on-white over the sea.
      const tight = small || shape.inscribed < TIGHT_LABEL;

      const group = el('g', {
        class: 'country' + (small ? ' country-small' : ''),
        tabindex: '0',
        role: 'button',
        'data-code': shape.code,
        'aria-label': shape.name
      });

      group.appendChild(el('path', { d: shape.path, class: 'country-shape' }));

      if (small) {
        // Malta is six square-kilometres of pixels; give it a fair click target.
        group.appendChild(el('circle', {
          cx: shape.centroid[0].toFixed(1),
          cy: shape.centroid[1].toFixed(1),
          r: '11',
          class: 'country-hit'
        }));
        group.appendChild(el('circle', {
          cx: shape.centroid[0].toFixed(1),
          cy: shape.centroid[1].toFixed(1),
          r: '4.5',
          class: 'country-dot'
        }));
      }

      const label = el('text', {
        x: shape.centroid[0].toFixed(1),
        y: (shape.centroid[1] + (tight ? -11 : 4)).toFixed(1),
        class: 'country-label' + (tight ? ' country-label-small' : '')
      });
      label.textContent = shape.code;
      labelLayer.appendChild(label);

      group.addEventListener('click', function () { self.select(shape.code); });
      group.addEventListener('keydown', function (event) { self.onKeydown(event, shape); });
      group.addEventListener('mouseenter', function (event) {
        self.showTip(shape, event);
        if (self.handlers.onHover) self.handlers.onHover(shape.code);
      });
      group.addEventListener('mousemove', function (event) { self.moveTip(event); });
      group.addEventListener('mouseleave', function () {
        self.hideTip();
        if (self.handlers.onHover) self.handlers.onHover(null);
      });
      group.addEventListener('focus', function () { self.showTip(shape, null); });
      group.addEventListener('blur', function () { self.hideTip(); });

      shapeLayer.appendChild(group);
      self.shapes[shape.code] = { shape: shape, group: group, label: label };
    });

    svg.appendChild(contextLayer);
    svg.appendChild(shapeLayer);
    svg.appendChild(labelLayer);

    // Clicking the sea closes the open country. A map you can only ever open
    // and never close is a trap, and the way out has to be the obvious one.
    svg.addEventListener('click', function (event) {
      if (event.target.closest('.country')) return;
      if (self.handlers.onDeselect) self.handlers.onDeselect();
    });

    const tip = document.createElement('div');
    tip.className = 'map-tip';
    tip.hidden = true;

    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.container.appendChild(tip);
    this.svg = svg;
    this.tip = tip;
  };

  /* Arrow keys walk to the nearest state in that direction — the map is a
     stand-in for a menu of 27 items, and it should behave like one. */
  EUMap.prototype.onKeydown = function (event, shape) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.select(shape.code);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.handlers.onDeselect) this.handlers.onDeselect();
      return;
    }
    const directions = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();

    const from = shape.centroid;
    let best = null;
    let bestDistance = Infinity;
    Object.keys(this.shapes).forEach(function (code) {
      if (code === shape.code) return;
      const to = this.shapes[code].shape.centroid;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const along = dx * direction[0] + dy * direction[1];
      if (along <= 0) return;
      const across = Math.abs(dx * direction[1] - dy * direction[0]);
      // Stay inside a 50-degree cone, then take the nearest state in it: pressing
      // right from France should land in Germany, not skip across to Slovenia.
      if (across > along * 1.19) return;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = code;
      }
    }, this);

    if (best) this.shapes[best].group.focus();
  };

  EUMap.prototype.select = function (code) {
    this.setSelected(code);
    if (this.handlers.onSelect) this.handlers.onSelect(code);
  };

  EUMap.prototype.setSelected = function (code) {
    if (this.selected && this.shapes[this.selected]) {
      this.shapes[this.selected].group.classList.remove('is-selected');
    }
    this.selected = code;
    if (code && this.shapes[code]) {
      const group = this.shapes[code].group;
      group.classList.add('is-selected');
      group.parentNode.appendChild(group); // raise the outline above its neighbours
    }
  };

  EUMap.prototype.showTip = function (shape, event) {
    if (!this.tipText) return;
    const text = this.tipText(shape.code);
    if (!text) return;
    this.tip.innerHTML = '<strong>' + shape.name + '</strong>' + text;
    this.tip.hidden = false;
    if (event) {
      this.moveTip(event);
    } else {
      const box = this.container.getBoundingClientRect();
      const svgBox = this.svg.getBoundingClientRect();
      const scale = svgBox.width / WIDTH;
      this.place(
        svgBox.left - box.left + shape.centroid[0] * scale,
        svgBox.top - box.top + shape.centroid[1] * scale
      );
    }
  };

  EUMap.prototype.moveTip = function (event) {
    const box = this.container.getBoundingClientRect();
    this.place(event.clientX - box.left, event.clientY - box.top);
  };

  EUMap.prototype.place = function (x, y) {
    const width = this.tip.offsetWidth || 200;
    const max = this.container.clientWidth - width - 8;
    this.tip.style.left = Math.max(8, Math.min(x + 14, max)) + 'px';
    this.tip.style.top = Math.max(8, y - this.tip.offsetHeight - 12) + 'px';
  };

  EUMap.prototype.hideTip = function () {
    this.tip.hidden = true;
  };

  /* Paint: one class per state, so the palette lives in CSS and follows the
     reader's colour scheme instead of being burned into fill attributes. */
  EUMap.prototype.paint = function (classFor, tipText) {
    this.tipText = tipText;
    this.classFor = classFor;
    Object.keys(this.shapes).forEach(function (code) {
      const entry = this.shapes[code];
      const wanted = classFor(code);
      entry.group.setAttribute('class', [
        'country',
        entry.shape.area < SMALL_AREA ? 'country-small' : '',
        wanted.className,
        code === this.selected ? 'is-selected' : '',
        code === this.hovered ? 'is-hovered' : '',
        this.revealed[code] === false ? '' : 'revealed',
        this.dimmed && this.dimmed[code] ? 'is-dimmed' : ''
      ].filter(Boolean).join(' '));
      entry.group.setAttribute('aria-label', entry.shape.name + ': ' + wanted.label);
    }, this);
  };

  /* Emphasis, applied on top of whatever the layer painted. */

  EUMap.prototype.setHovered = function (code) {
    if (this.hovered && this.shapes[this.hovered]) {
      this.shapes[this.hovered].group.classList.remove('is-hovered');
    }
    this.hovered = code;
    if (code && this.shapes[code]) this.shapes[code].group.classList.add('is-hovered');
  };

  /* Dim everything that is not part of the group the reader asked to see —
     clicking "Against" in the legend should leave the against countries lit. */
  EUMap.prototype.setDimmed = function (predicate) {
    this.dimmed = {};
    Object.keys(this.shapes).forEach(function (code) {
      const dim = predicate ? !predicate(code) : false;
      this.dimmed[code] = dim;
      this.shapes[code].group.classList.toggle('is-dimmed', dim);
    }, this);
  };

  /* The reveal: the Union takes the colour of the outcome, holds, then each
     member state turns to its own vote in a west-to-east sweep. */
  EUMap.prototype.play = function (resultClass, options) {
    const self = this;
    const settings = options || {};
    this.stop();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || settings.skip) {
      this.revealAll();
      if (settings.onDone) settings.onDone();
      return;
    }

    this.svg.setAttribute('class', 'eu-map is-revealing ' + resultClass);
    Object.keys(this.shapes).forEach(function (code) {
      self.revealed[code] = false;
      self.shapes[code].group.classList.remove('revealed');
    }, this);

    const order = this.layout.shapes.filter(function (shape) {
      return shape.member;
    }).sort(function (a, b) {
      return a.centroid[0] - b.centroid[0];
    });

    const hold = settings.hold === undefined ? 620 : settings.hold;
    const step = settings.step === undefined ? 46 : settings.step;

    this.timers = order.map(function (shape, i) {
      return window.setTimeout(function () {
        self.revealed[shape.code] = true;
        self.shapes[shape.code].group.classList.add('revealed');
      }, hold + i * step);
    });

    this.timers.push(window.setTimeout(function () {
      self.svg.setAttribute('class', 'eu-map');
      if (settings.onDone) settings.onDone();
    }, hold + order.length * step + 260));
  };

  EUMap.prototype.revealAll = function () {
    this.svg.setAttribute('class', 'eu-map');
    Object.keys(this.shapes).forEach(function (code) {
      this.revealed[code] = true;
      this.shapes[code].group.classList.add('revealed');
    }, this);
  };

  EUMap.prototype.stop = function () {
    (this.timers || []).forEach(window.clearTimeout);
    this.timers = [];
  };

  global.EUMap = EUMap;
})(window);
