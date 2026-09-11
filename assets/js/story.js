/* A vote as a picture, 1080x1350, for Instagram and everywhere else.

   Four-by-five, and the composition fills it. It was 1080x1920 with the
   content held inside the middle four-by-five, on the theory that Instagram
   crops a tall picture for the feed. It letterboxes it instead — so the feed
   showed the card inset between black bars while a story showed it edge to
   edge with two bands of empty white inside it, and Instagram's own picker
   offered three previews that disagreed about what this was.

   No single picture fills both shapes; that is geometry. This one fills the
   feed exactly and sits centred in a story, with the app's furniture above
   and below the card instead of on top of it.

   A web page cannot post into Instagram Stories: that is an app-to-app call
   Instagram only accepts from a registered native app. What a page can do is
   hand the phone a finished image, and the phone's own share sheet offers
   Instagram, which offers Stories. So this draws the card and passes it to
   navigator.share as a file. Where the browser will not take files — a
   laptop, mostly — the image is saved instead, to be posted from a phone.

   Everything on the card comes from the vote already open on the page. No
   figure is computed here, so nothing on the picture can disagree with the
   page it came from. 

   SPDX-License-Identifier: AGPL-3.0-or-later
*/
(function (global) {
  'use strict';

  const WIDTH = 1080;
  const HEIGHT = 1350;

  /* Light, like the site.

     This card was navy, and navy is what Instagram's own chrome is: in the
     picker that offers Story, Reel and Send a message, a dark card sat inside
     dark buttons on a dark sheet and the three previews ran together into one
     smudge. A light card is a page of paper in that picker — it reads as one
     thing, at a glance, every time.

     The values are the site's own light theme rather than a second palette
     invented for the card, so the picture and the page it links to cannot
     drift apart. */
  const INK = {
    ground: '#ffffff',
    panel: '#eceef3',
    text: '#131a24',
    soft: '#4d5666',
    faint: '#656c7b',
    gold: '#f6c700',
    blue: '#0b3a8f',
    // The bar's three blocks: the same fills the map uses below it.
    for: '#15785f',
    against: '#b3382c',
    abstain: '#c88a12',
    absent: '#9aa2b1'
  };
  // The map's colours, the same four the page uses in its light theme.
  const VOTE = {
    for: '#15785f',
    against: '#b3382c',
    abstain: '#c88a12',
    split: '#7c8ba1',
    absent: '#d6dae3',
    unknown: '#d6dae3'
  };

  /* Deep enough to carry a hundred-pixel word on white. These are the inks the
     page sets a result in, not the fills. */
  const RESULT = {
    adopted: { word: 'Adopted', ink: '#136a54' },
    rejected: { word: 'Rejected', ink: '#a73429' },
    recorded: { word: 'Recorded', ink: '#4d5666' }
  };

  function font(weight, size, family) {
    return weight + ' ' + size + 'px ' + (family || "'IBM Plex Sans', system-ui, sans-serif");
  }

  /* Fits a title into the space it has by trying the largest size first. Long
     titles are the rule here, not the exception: the Parliament names a vote
     the way an order paper does. */
  function layoutTitle(ctx, text, maxWidth, sizes, budget) {
    let last = null;
    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      ctx.font = font(700, size, "'Source Serif 4', Georgia, serif");
      const lines = wrap(ctx, text, maxWidth);
      const room = Math.max(1, Math.floor(budget / (size * 1.14)));
      last = { size: size, lines: lines.slice(0, room), clipped: lines.length > room };
      if (!last.clipped) return last;
    }
    // Nothing fits whole: the smallest size, cut to the room there is.
    return last;
  }

  function wrap(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* The dashed circle of stars, small enough that a ring of dashes reads as
     the flag without pretending to be it. */
  /* Volt's own mark, for the foot of the card.

     The file has no colour of its own — its site fills it from the surrounding
     text, and the page does the same with a mask — so the copy rendered here
     is given the ink colour, which is what it takes on a light ground. The file on
     disk is untouched; this only says what to paint it with, and asks for it
     at the size it will be drawn so it rasterises sharp rather than being
     scaled up from 230 pixels.

     If it cannot be had — the single-file build, an offline copy — the name is
     set in type instead, and the line beside it is the point either way. */
  let voltMark = null;

  function volt(height) {
    if (voltMark) return voltMark;
    voltMark = fetch('assets/brand/volt.svg')
      .then(function (response) {
        if (!response.ok) throw new Error('no mark');
        return response.text();
      })
      .then(function (text) {
        const opening = text.match(/<svg\b[^>]*>/i);
        if (!opening) throw new Error('not a drawing');
        const wide = Math.round(height * (230 / 96));
        /* The site's own size and class come off the opening tag before ours
           go on. Leaving them would give the drawing two widths and two
           heights, which is not a drawing any more — the browser refuses it
           and the mark silently becomes the word. */
        const root = opening[0]
          .replace(/\s(?:class|width|height)="[^"]*"/gi, '')
          .replace(/<svg\b/i, '<svg width="' + wide * 3 + '" height="' + height * 3 + '"');
        const painted = (root + text.slice(opening[0].length))
          .replace(/fill="inherit"/g, 'fill="#131a24"');
        return new Promise(function (resolve, reject) {
          const image = new Image();
          image.onload = function () { resolve(image); };
          image.onerror = function () { reject(new Error('would not draw')); };
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(painted);
        });
      })
      .catch(function () { return null; });
    return voltMark;
  }

  function brandMark(ctx, x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0b3a8f';
    ctx.fill();
    ctx.setLineDash([r * 0.5, r * 0.42]);
    ctx.lineWidth = r * 0.3;
    ctx.strokeStyle = INK.gold;
    ctx.stroke();
    ctx.restore();
  }

  /* The Union itself, painted by the vote. This is the thing the site is, and
     on a story it is what makes a reader stop: a shape they recognise, in the
     colours of an argument they can see the shape of before they read a word.

     Drawn from the same outline file and the same projection as the page, so
     the picture and the site cannot drift apart. */
  function drawMap(ctx, geo, positions, x, y, width, height) {
    if (!geo || !global.Projection || !global.Path2D) return false;

    /* The page frames the map around Azerbaijan too, so a reader can find it.
       In a story there is no room for that: the frame holds the member states
       and nothing else, so the Union fills the space it is given. The
       neighbours are still drawn, and run off the edge as they do on the page.
       A shallow copy — the outlines themselves are shared, not rewritten. */
    const framed = {
      type: geo.type,
      features: geo.features.map(function (feature) {
        if (!feature.properties || feature.properties.frame !== true) return feature;
        const properties = {};
        Object.keys(feature.properties).forEach(function (key) {
          if (key !== 'frame') properties[key] = feature.properties[key];
        });
        return { type: feature.type, id: feature.id, properties: properties,
          geometry: feature.geometry };
      })
    };

    const layout = Projection.layout(framed, width, height, 4);
    if (!layout || !layout.shapes) return false;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.translate(x, y);

    // The neighbours first, dark and quiet: they place the Union without
    // competing with it.
    /* The neighbours are not drawn here, and the page's are not missed.

       On the page they place the Union inside a continent a reader can pan
       around. On a card there is nothing to pan: the frame ends where the
       picture does, so every neighbour is cut off mid-country and the largest
       of them — Russia across the whole top corner — reads as a pale slab
       laid over the picture rather than as land. The Union's own outline is
       the thing anyone recognises, and on its own, on the ground colour, it
       is unmistakable. */

    layout.shapes.forEach(function (shape) {
      if (!shape.member) return;
      ctx.fillStyle = VOTE[positions[shape.code]] || VOTE.unknown;
      const path = new Path2D(shape.path);
      ctx.fill(path);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = INK.ground;
      ctx.stroke(path);
    });

    ctx.restore();
    return true;
  }

  async function ready() {
    if (!document.fonts || !document.fonts.ready) return;
    try {
      await document.fonts.ready;
    } catch (error) {
      // A browser that will not report on its fonts still draws with them.
    }
  }

  /* card({ title, dateLabel, bodyLabel, result, totals, seats, url, geo, positions })
     resolves to a PNG blob, or null where the canvas will not give one up.
     The url is what the code in the corner opens. */
  async function card(vote) {
    await ready();

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const pad = 88;
    const inner = WIDTH - pad * 2;

    ctx.fillStyle = INK.ground;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // A band of the vote's own colour along the top, so the result is legible
    // before a word is read.
    const outcome = RESULT[vote.result] || RESULT.recorded;
    ctx.fillStyle = outcome.ink;
    ctx.fillRect(0, 0, WIDTH, 14);
    ctx.textBaseline = 'alphabetic';

    /* Measured before it is drawn. A story is a fixed frame with the app's own
       controls over the top and bottom of it, so everything has to fit the band
       between them, and two parts have no fixed height: the title, which is not
       known until it is wrapped, and the map, which should take whatever is
       left. The map is the reason to stop scrolling, so it is promised its
       share first and the title takes what remains. */
    const HEAD_IN = 40;      // the mark hangs above its own baseline
    const BRAND = 70;        // the mark and the name
    const META = 68;         // institution and date
    const HOOK = 58;         // the question the picture answers
    /* The verdict is drawn on its baseline, so its own height sits above that
       line: the block has to carry the air before it, the letters themselves,
       and the gap to the bar, or a long title runs into the word. */
    const LEAD = 44;         // air between the title and the verdict
    const VERDICT_TOP = 78;  // the cap height of the word below
    const VERDICT = LEAD + VERDICT_TOP + 30;
    const BAR = 38 + 50;
    const NUMBERS = 52;      // the three counts, in one line
    const SEATS = vote.seats ? 38 : 0;
    const CODE = 164;        // the square beside the link, big enough to scan
    const FOOT = CODE + 20;

    const MAP_MAX = 470;
    const MAP_MIN = 180;     // below this the Union is a smudge; better none

    /* The picture is four-by-five, and that is the whole of it.

       It used to be 1080x1920 with the composition held inside the middle
       1080x1350, on the theory that Instagram crops a tall picture to
       four-by-five for the feed. It does not crop it — it letterboxes it. So
       the feed showed the card inset between two black bars, while a story and
       a reel showed it edge to edge with two bands of empty white inside it,
       and the three previews in Instagram's own picker disagreed with each
       other about what this thing even was.

       One picture cannot fill both shapes; that is geometry, not a bug to
       find. What it can do is fill one of them and sit cleanly in the other.
       Four-by-five is that one: the feed takes it whole, at full width, with
       nothing added and nothing cut; a story centres it and puts the app's own
       furniture above and below the card rather than on top of it, which is
       better than the arrangement this was trying to protect.

       And it is denser. The margins that existed to be covered by somebody
       else's interface are gone, so the same content has a smaller frame to
       fill, and every destination shows a full card. */
    const MARGIN = 30;
    const band = HEIGHT - MARGIN * 2;

    const canMap = Boolean(vote.geo && global.Projection && global.Path2D);
    const fixed = HEAD_IN + BRAND + META + HOOK + VERDICT + BAR + NUMBERS + SEATS + FOOT;

    /* The title is measured by its lines alone, but drawn from a baseline, so
       the block it costs is a cap height taller than the room it was given.
       The allowance below is that cap height at the largest size on offer. */
    const title = layoutTitle(ctx, vote.title, inner, [92, 82, 72, 64, 56, 48],
      band - fixed - (canMap ? MAP_MIN : 0) - 76);
    /* A block of type is its cap height, the leading between its lines, and a
       descender — not a whole empty line under the last one. Counting that
       last line in full put a hole between a one-line title and the verdict
       below it, which on a card this size read as a mistake. */
    const TITLE_TOP = title.size * 0.82;
    const TITLE = TITLE_TOP + (title.lines.length - 1) * title.size * 1.14 +
      title.size * 0.26;

    const spare = band - fixed - TITLE;
    const MAP = canMap && spare >= MAP_MIN ? Math.min(MAP_MAX, spare) : 0;

    const block = fixed + TITLE + MAP;
    let y = MARGIN + HEAD_IN + Math.max(0, (band - block) / 2);

    brandMark(ctx, pad + 24, y - 12, 24);
    ctx.fillStyle = INK.text;
    ctx.font = font(700, 40);
    ctx.fillText('EU Tracker', pad + 70, y);
    y += BRAND;

    ctx.fillStyle = INK.faint;
    ctx.font = font(600, 30);
    ctx.fillText(String(vote.bodyLabel || '').toUpperCase() + '  ·  ' +
      (vote.dateLabel || ''), pad, y);
    y += META;

    // The question the picture answers, in the Union's own gold: the reason to
    // look at the map below rather than scroll past it.
    // Gold on white is 1.7:1 and unreadable; the Union's other colour is not.
    ctx.fillStyle = INK.blue;
    ctx.font = font(700, 40);
    ctx.fillText('How did your country vote?', pad, y);
    y += HOOK + TITLE_TOP;

    ctx.fillStyle = INK.text;
    ctx.font = font(700, title.size, "'Source Serif 4', Georgia, serif");
    title.lines.forEach(function (line, i) {
      const last = title.clipped && i === title.lines.length - 1;
      ctx.fillText(last ? line + '…' : line, pad, y + i * title.size * 1.14);
    });
    y += TITLE - TITLE_TOP;

    // The verdict.
    y += LEAD + VERDICT_TOP;
    ctx.fillStyle = outcome.ink;
    ctx.font = font(700, 104);
    ctx.fillText(outcome.word, pad, y);
    y += 40;

    // The split, drawn as the bar the page draws.
    const totals = vote.totals || { for: 0, against: 0, abstain: 0, absent: 0 };
    const cast = totals.for + totals.against + totals.abstain;
    const barH = 38;
    if (cast > 0) {
      let x = pad;
      [['for', INK.for], ['against', INK.against], ['abstain', INK.abstain]].forEach(function (pair) {
        const width = (totals[pair[0]] / cast) * inner;
        if (width <= 0) return;
        ctx.fillStyle = pair[1];
        ctx.fillRect(x, y, Math.max(width - 4, 2), barH);
        x += width;
      });
    }
    y += BAR;

    /* The three counts on one line, each number in the colour of the vote it
       counts and each word after it in the quieter grey — so the eye takes the
       figures first and the labels only if it wants them. */
    let x = pad;
    [['for', 'for', INK.for], ['against', 'against', INK.against],
     ['abstain', 'abstained', INK.abstain]].forEach(function (part, i) {
      if (i) {
        ctx.fillStyle = INK.faint;
        ctx.font = font(400, 40);
        ctx.fillText('  ·  ', x, y);
        x += ctx.measureText('  ·  ').width;
      }
      ctx.fillStyle = part[2];
      ctx.font = font(700, 52);
      const number = String(totals[part[0]]);
      ctx.fillText(number, x, y);
      x += ctx.measureText(number).width + 12;
      ctx.fillStyle = INK.soft;
      ctx.font = font(600, 34);
      ctx.fillText(part[1], x, y);
      x += ctx.measureText(part[1]).width;
    });
    y += NUMBERS;

    if (vote.seats) {
      ctx.fillStyle = INK.faint;
      ctx.font = font(400, 28);
      ctx.fillText(cast + ' of ' + vote.seats + ' members voted · ' +
        totals.absent + ' did not', pad, y);
      y += SEATS;
    }

    if (MAP) {
      // The Union is nearly square in this projection, so a square is what it
      // is given, centred: a wide box would only pad it with empty sea.
      const side = Math.min(inner, MAP - 16);
      drawMap(ctx, vote.geo, vote.positions || {}, (WIDTH - side) / 2, y, side, MAP - 16);
      y += MAP;
    }

    /* The foot: the way in. Three of them, because a story is watched in three
       ways. The code is for a phone held up to a screen, or a screenshot
       passed on. The pill says what the code is for. And the address is
       printed under it in words, because a story is often watched on the very
       phone that would have to scan it — and because an address a reader can
       simply type is the only way in that survives being screenshotted,
       re-posted, or filmed off somebody else's screen.

       It is printed now because it is short enough to be printed: the vote is
       named by the Parliament's own number for it, so the line is an address
       rather than the paragraph of slug it used to be. */
    const drawn = vote.url && global.QR &&
      QR.draw(ctx, vote.url, pad, y, CODE, {
        ink: INK.text, background: INK.ground, quiet: 3
      });

    const pillX = drawn ? pad + CODE + 28 : pad;
    const pillW = WIDTH - pad - pillX;
    const pillH = 88;

    /* The pill and the line below it, centred against the code beside them. */
    const pillY = y + Math.round((CODE - (pillH + 28 + 30)) / 2);

    ctx.fillStyle = INK.gold;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();

    ctx.fillStyle = '#12203f';
    ctx.font = font(700, 38);
    ctx.textAlign = 'center';
    ctx.fillText('Open the full record', pillX + pillW / 2, pillY + 58);

    ctx.textAlign = 'left';

    /* The address is not printed.

       It was, for a while, and the reasoning was sound: a story is often
       watched on the very phone that would otherwise have to scan the code,
       and words survive a screenshot. What the reasoning missed is what the
       words actually said. The site is hosted on GitHub Pages, so the address
       reads "volters-cell.github.io/..." — and a card carrying somebody's
       repository host across the bottom looks like a draft, not like a record
       of how the Parliament voted.

       So the two ways in are the code and the pill, both of which say what
       they are without naming anyone's hosting. If this ever gets a domain of
       its own, printing it here again would be worth doing: the line is one
       fillText, and its place is still free. */
    const footX = pillX + 6;

    /* Who is asking, and why: under the way in, beside the code, in the room
       that row already has. Putting it below would have cost the map eighty
       pixels, and the map is the reason anyone stops on this card at all.

       The record above is the Parliament's. This line is the only thing here
       that is not, so it is said plainly and kept apart from the figures. */
    const markH = 30;
    const mark = await volt(markH);
    const line = 'Someone has to shape Europe.';
    const lineY = pillY + pillH + 28 + 24;   // under the pill, on the code's own line
    let voltX = footX;

    if (mark) {
      const markW = markH * (230 / 96);
      ctx.drawImage(mark, voltX, lineY - markH + 6, markW, markH);
      voltX += markW + 20;
    } else {
      ctx.fillStyle = INK.text;
      ctx.font = font(700, 30);
      ctx.fillText('Volt', voltX, lineY);
      voltX += ctx.measureText('Volt').width + 20;
    }
    ctx.fillStyle = INK.soft;
    ctx.font = font(600, 30);
    ctx.fillText(line, voltX, lineY);

    return await new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
      } else {
        resolve(null);
      }
    });
  }

  global.Story = { card: card, WIDTH: WIDTH, HEIGHT: HEIGHT };
})(window);
