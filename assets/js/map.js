/* The map itself: one SVG, one path per member state, three colour layers.
   Everything a mouse can do here, a keyboard can do too. */
(function (global) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WIDTH = 760;
  const HEIGHT = 700;
  const SMALL_AREA = 150;   // px² — below this a state needs a click target of its own
  const DOT_AREA = 40;      // px² — below this it cannot be seen at all without a mark
  const TIGHT_LABEL = 8;    // px of inscribed radius — below this the name will not fit inside

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  /* Labels. A country wide enough to hold its own code gets it in the middle.
     One that is not — Luxembourg, Slovenia, Malta — gets it just outside, on a
     short leader line, pushed clear of its neighbours' labels rather than
     stacked on top of them. */
  const MARGIN = 12;        // px — no label is allowed nearer the frame than this

  /* Insets. Svalbard sits far enough north that fitting the frame around it
     would cost every member state a tenth of its size, and cropping it would
     lose it altogether. So it is drawn where a paper map would draw it: in a
     box of its own in the corner, at the same scale as the rest, labelled, and
     opening the record of the country it belongs to. */
  const INSET_PAD = 9;      // px of air between the outline and its box
  const INSET_CAPTION = 15; // px under the outline for the name

  function inFrame(point) {
    return point[0] >= MARGIN && point[0] <= WIDTH - MARGIN &&
           point[1] >= MARGIN && point[1] <= HEIGHT - MARGIN;
  }

  function placeLabels(placements, layer) {
    const centre = [WIDTH / 2, HEIGHT / 2];

    placements.forEach(function (item) {
      const pole = item.shape.centroid;
      if (!item.tight) {
        // Dead on the pole of inaccessibility. The text is centred on that
        // point in both directions by the stylesheet, so nothing is nudged
        // here to compensate for a baseline.
        item.at = [pole[0], pole[1]];
        return;
      }
      // Away from the middle of the map, so callouts point at open water or
      // at the frame rather than back across the Union.
      const dx = pole[0] - centre[0];
      const dy = pole[1] - centre[1];
      const length = Math.hypot(dx, dy) || 1;
      const reach = Math.max(item.shape.inscribed, 3) + 10;
      const out = [pole[0] + (dx / length) * reach, pole[1] + (dy / length) * reach];
      // Malta sits on the southern edge, so its outward callout would land off
      // the map. Where that happens the label goes the other way instead.
      item.at = inFrame(out)
        ? out
        : [pole[0] - (dx / length) * reach, pole[1] - (dy / length) * reach];
    });

    // Three passes of gentle separation: enough to unpick the Benelux, not
    // enough to send a label somewhere it stops meaning anything. A label
    // sitting inside its own country may shuffle a few pixels to break contact
    // with a neighbour — Slovenia against Croatia — but never far enough to
    // leave the country it names, which is what its inscribed radius allows.
    placements.forEach(function (item) {
      item.slack = item.tight ? Infinity : Math.max(0, Math.min(4, item.shape.inscribed - 6));
    });

    for (let pass = 0; pass < 3; pass++) {
      placements.forEach(function (item) {
        if (!item.slack) return;
        placements.forEach(function (other) {
          if (other === item) return;
          const dx = item.at[0] - other.at[0];
          const dy = item.at[1] - other.at[1];
          const distance = Math.hypot(dx, dy);
          // Centre to centre. A two-letter label is about seventeen pixels
          // wide, so anything under that and the boxes touch however far apart
          // their middles are.
          const wanted = 19;
          if (distance >= wanted || distance === 0) return;
          const push = (wanted - distance) / 2;
          item.at[0] += (dx / distance) * push;
          item.at[1] += (dy / distance) * push;

          if (item.slack === Infinity) return;
          const pole = item.shape.centroid;
          const driftX = item.at[0] - pole[0];
          const driftY = item.at[1] - pole[1];
          const drift = Math.hypot(driftX, driftY);
          if (drift <= item.slack) return;
          item.at[0] = pole[0] + (driftX / drift) * item.slack;
          item.at[1] = pole[1] + (driftY / drift) * item.slack;
        });
      });
    }

    // Whatever the passes did, nothing hangs off the edge of the frame.
    placements.forEach(function (item) {
      item.at[0] = Math.min(WIDTH - MARGIN, Math.max(MARGIN, item.at[0]));
      item.at[1] = Math.min(HEIGHT - MARGIN, Math.max(MARGIN, item.at[1]));
    });

    placements.forEach(function (item) {
      item.label.setAttribute('x', item.at[0].toFixed(1));
      item.label.setAttribute('y', item.at[1].toFixed(1));

      if (!item.tight) return;
      const pole = item.shape.centroid;
      const dx = item.at[0] - pole[0];
      const dy = item.at[1] - pole[1];
      const length = Math.hypot(dx, dy) || 1;
      // Stop the line short of both ends: at the shape, and under the text.
      const from = [pole[0] + (dx / length) * 2, pole[1] + (dy / length) * 2];
      const to = [item.at[0] - (dx / length) * 9, item.at[1] - (dy / length) * 9];
      if (length < 13) return;
      const leader = el('line', {
        x1: from[0].toFixed(1), y1: from[1].toFixed(1),
        x2: to[0].toFixed(1), y2: to[1].toFixed(1),
        class: 'label-leader'
      });
      layer.insertBefore(leader, layer.firstChild);
    });
  }

  function EUMap(container, geo, handlers) {
    this.container = container;
    this.handlers = handlers || {};
    this.layout = Projection.layout(geo, WIDTH, HEIGHT, 12);
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

    // Neighbours stay visually secondary but are no longer inert: a reader
    // looking at Serbia or Ukraine should be able to click it.
    const contextLayer = el('g', { class: 'context' });
    const shapeLayer = el('g', { class: 'shapes' });
    const insetLayer = el('g', { class: 'insets' });
    const labelLayer = el('g', { class: 'labels', 'aria-hidden': 'true' });

    const placements = [];

    this.layout.shapes.forEach(function (shape) {
      if (shape.inset) {
        self.buildInset(shape, insetLayer);
        return;
      }
      if (!shape.member) {
        const outside = el('g', {
          class: 'country outside',
          tabindex: '0',
          role: 'button',
          'data-code': shape.code,
          'aria-label': shape.name
        });
        outside.appendChild(el('path', { d: shape.path, class: 'context-shape' }));
        outside.addEventListener('click', function () {
          if (self.handlers.onOutside) self.handlers.onOutside(shape.code);
        });
        outside.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (self.handlers.onOutside) self.handlers.onOutside(shape.code);
        });
        outside.addEventListener('mouseenter', function (event) {
          self.showTip(shape, event, shape.name);
        });
        outside.addEventListener('mousemove', function (event) { self.moveTip(event); });
        outside.addEventListener('mouseleave', function () { self.hideTip(); });
        contextLayer.appendChild(outside);
        self.shapes[shape.code] = { shape: shape, group: outside };
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
        // Luxembourg is a few pixels across and Malta fewer; both need a click
        // target bigger than themselves. It is invisible: the country's own
        // outline is what the reader sees.
        group.appendChild(el('circle', {
          cx: shape.centroid[0].toFixed(1),
          cy: shape.centroid[1].toFixed(1),
          r: '11',
          class: 'country-hit'
        }));
      }

      if (shape.area < DOT_AREA) {
        // Malta, though, is smaller than the dot that stands for it: without
        // one it would have no colour to show when the map is painted by vote.
        // Luxembourg is drawn large enough to speak for itself — a disc there
        // sat across the Belgian and German borders and read as a fault in the
        // map rather than as a country.
        group.appendChild(el('circle', {
          cx: shape.centroid[0].toFixed(1),
          cy: shape.centroid[1].toFixed(1),
          r: '4.5',
          class: 'country-dot'
        }));
      }

      // Placed properly below, once every label is known.
      const label = el('text', { class: 'country-label' + (tight ? ' country-label-small' : '') });
      label.textContent = shape.code;
      labelLayer.appendChild(label);
      placements.push({ shape: shape, label: label, tight: tight, layer: labelLayer });

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

    placeLabels(placements, labelLayer);

    svg.appendChild(contextLayer);
    svg.appendChild(shapeLayer);
    svg.appendChild(labelLayer);
    // Last, so the box sits over whatever the frame happens to crop behind it.
    if (insetLayer.childNodes.length) svg.appendChild(insetLayer);

    // Clicking the sea closes the open country. A map you can only ever open
    // and never close is a trap, and the way out has to be the obvious one.
    svg.addEventListener('click', function (event) {
      if (event.target.closest('.country')) return;
      if (self.handlers.onDeselect) self.handlers.onDeselect();
    });

    const tip = document.createElement('div');
    tip.className = 'country-tooltip';
    tip.hidden = true;

    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.container.appendChild(tip);
    this.svg = svg;
    this.tip = tip;
  };

  /* Arrow keys walk to the nearest state in that direction — the map is a
     stand-in for a menu of 27 items, and it should behave like one. */
  /* A territory drawn in a box of its own: true outline, same scale as the
     map, moved bodily back inside the frame. The box opens the record of the
     country it belongs to, because that is the record it has. */
  EUMap.prototype.buildInset = function (shape, layer) {
    const self = this;
    const bounds = shape.bounds;
    if (!bounds || !isFinite(bounds.width) || !isFinite(bounds.height)) return;

    const owner = this.layout.shapes.filter(function (other) {
      return other.code === shape.inset;
    })[0];
    const title = owner ? shape.name + ' · ' + owner.name : shape.name;

    const boxWidth = bounds.width + INSET_PAD * 2;
    const boxHeight = bounds.height + INSET_PAD * 2 + INSET_CAPTION;
    const x = WIDTH - MARGIN - boxWidth;
    const y = MARGIN;

    const group = el('g', {
      class: 'country outside inset',
      tabindex: '0',
      role: 'button',
      'data-code': shape.code,
      'aria-label': title
    });
    group.appendChild(el('rect', {
      x: x.toFixed(1), y: y.toFixed(1),
      width: boxWidth.toFixed(1), height: boxHeight.toFixed(1),
      rx: '7', class: 'inset-frame'
    }));

    const drawing = el('g', {
      transform: 'translate(' + (x + INSET_PAD - bounds.x).toFixed(1) +
                 ' ' + (y + INSET_PAD - bounds.y).toFixed(1) + ')'
    });
    drawing.appendChild(el('path', { d: shape.path, class: 'context-shape' }));
    group.appendChild(drawing);

    const caption = el('text', {
      x: (x + boxWidth / 2).toFixed(1),
      y: (y + boxHeight - 5).toFixed(1),
      class: 'inset-label'
    });
    caption.textContent = shape.name;
    group.appendChild(caption);

    const open = function () {
      if (self.handlers.onOutside) self.handlers.onOutside(shape.inset || shape.code);
    };
    group.addEventListener('click', open);
    group.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
    const named = { code: shape.code, name: title, centroid: shape.centroid };
    group.addEventListener('mouseenter', function (event) { self.showTip(named, event, title); });
    group.addEventListener('mousemove', function (event) { self.moveTip(event); });
    group.addEventListener('mouseleave', function () { self.hideTip(); });
    group.addEventListener('focus', function () { self.showTip(named, null, title); });
    group.addEventListener('blur', function () { self.hideTip(); });

    layer.appendChild(group);
    this.shapes[shape.code] = { shape: shape, group: group };
  };

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
      if (code === shape.code || !this.shapes[code].shape.member) return;
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

  EUMap.prototype.showTip = function (shape, event, plain) {
    const text = plain !== undefined ? '' : (this.tipText ? this.tipText(shape.code) : '');
    if (plain === undefined && !text) return;
    this.tip.innerHTML = '<strong>' + shape.name + '</strong>' + text;
    this.tip.classList.add('is-visible');
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
    this.tip.classList.remove('is-visible');
  };

  /* Paint: one class per state, so the palette lives in CSS and follows the
     reader's colour scheme instead of being burned into fill attributes. */
  EUMap.prototype.paint = function (classFor, tipText) {
    this.tipText = tipText;
    this.classFor = classFor;
    Object.keys(this.shapes).forEach(function (code) {
      const entry = this.shapes[code];
      if (!entry.shape.member) return;
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
      if (!this.shapes[code].shape.member) return;
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
      if (!self.shapes[code].shape.member) return;
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
      if (!this.shapes[code].shape.member) return;
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
