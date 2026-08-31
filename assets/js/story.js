/* A vote as a picture, 1080x1920, for Instagram and every other story.

   A web page cannot post into Instagram Stories: that is an app-to-app call
   Instagram only accepts from a registered native app. What a page can do is
   hand the phone a finished image, and the phone's own share sheet offers
   Instagram, which offers Stories. So this draws the card and passes it to
   navigator.share as a file. Where the browser will not take files — a
   laptop, mostly — the image is saved instead, to be posted from a phone.

   Everything on the card comes from the vote already open on the page. No
   figure is computed here, so nothing on the picture can disagree with the
   page it came from. */
(function (global) {
  'use strict';

  const WIDTH = 1080;
  const HEIGHT = 1920;

  const INK = {
    ground: '#0b1b3a',
    panel: '#132549',
    text: '#ffffff',
    soft: '#c3d0e8',
    faint: '#8fa6cc',
    gold: '#ffd617',
    for: '#1a7f5a',
    against: '#b3372c',
    abstain: '#b8860b',
    absent: '#5b6b86'
  };
  // The map's colours, the same four the page uses.
  const VOTE = {
    for: '#2f9c7d',
    against: '#d75b4c',
    abstain: '#d8a53a',
    split: '#7c8ba1',
    absent: '#3a4351',
    unknown: '#3a4351'
  };

  const RESULT = {
    adopted: { word: 'Adopted', ink: '#38c08a' },
    rejected: { word: 'Rejected', ink: '#ff7a6b' },
    recorded: { word: 'Recorded', ink: '#c3d0e8' }
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
    layout.shapes.forEach(function (shape) {
      if (shape.member) return;
      ctx.fillStyle = '#16274b';
      ctx.fill(new Path2D(shape.path));
    });

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

  /* card({ title, subtitle, dateLabel, bodyLabel, result, totals, seats, url })
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
    const BRAND = 80;        // the mark and the name
    const META = 84;         // institution and date
    const HOOK = 66;         // the question the picture answers
    /* The verdict is drawn on its baseline, so its own height sits above that
       line: the block has to carry the air before it, the letters themselves,
       and the gap to the bar, or a long title runs into the word. */
    const LEAD = 46;         // air between the title and the verdict
    const VERDICT_TOP = 80;  // the cap height of the word below
    const VERDICT = LEAD + VERDICT_TOP + 40;
    const BAR = 42 + 54;
    const NUMBERS = 58;      // the three counts, in one line
    const SEATS = vote.seats ? 44 : 0;
    const CODE = 180;        // the square beside the link
    const FOOT = CODE + 24;

    const MAP_MAX = 520;
    const MAP_MIN = 260;     // below this the Union is a smudge; better none

    // Instagram draws its own controls over the top and bottom of a story.
    const TOP_SAFE = 230;
    const BOTTOM_SAFE = HEIGHT - 240;
    const band = BOTTOM_SAFE - TOP_SAFE;

    const canMap = Boolean(vote.geo && global.Projection && global.Path2D);
    const fixed = BRAND + META + HOOK + VERDICT + BAR + NUMBERS + SEATS + FOOT;

    const title = layoutTitle(ctx, vote.title, inner,
      [92, 82, 72, 64, 56, 48], band - fixed - (canMap ? MAP_MIN : 0));
    // The first line is drawn on its baseline, so the block has to carry the
    // height of the letters above it or the hook line runs into the title.
    const TITLE_TOP = title.size * 0.82;
    const TITLE = TITLE_TOP + title.lines.length * title.size * 1.14;

    const spare = band - fixed - TITLE;
    const MAP = canMap && spare >= MAP_MIN ? Math.min(MAP_MAX, spare) : 0;

    const block = fixed + TITLE + MAP;
    let y = TOP_SAFE + Math.max(0, (band - block) / 2);

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
    ctx.fillStyle = INK.gold;
    ctx.font = font(700, 40);
    ctx.fillText('How did your country vote?', pad, y);
    y += HOOK + TITLE_TOP;

    ctx.fillStyle = INK.text;
    ctx.font = font(700, title.size, "'Source Serif 4', Georgia, serif");
    title.lines.forEach(function (line, i) {
      const last = title.clipped && i === title.lines.length - 1;
      ctx.fillText(last ? line + '…' : line, pad, y + i * title.size * 1.14);
    });
    y += TITLE - TITLE_TOP + title.size * 0.2;

    // The verdict.
    y += LEAD + VERDICT_TOP;
    ctx.fillStyle = outcome.ink;
    ctx.font = font(700, 104);
    ctx.fillText(outcome.word, pad, y);
    y += 40;

    // The split, drawn as the bar the page draws.
    const totals = vote.totals || { for: 0, against: 0, abstain: 0, absent: 0 };
    const cast = totals.for + totals.against + totals.abstain;
    const barH = 42;
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

    /* The foot: the way in, said twice. The code carries this vote's own
       address, for a phone held up to the screen or a screenshot passed on;
       the pill beside it says where that goes in words, because a story is as
       often read by someone who will type it as by someone who will scan it. */
    const drawn = vote.url && global.QR &&
      QR.draw(ctx, vote.url, pad, y, CODE, {
        ink: INK.ground, background: '#ffffff', quiet: 3
      });

    const pillX = drawn ? pad + CODE + 28 : pad;
    const pillW = WIDTH - pad - pillX;
    const pillH = 104;
    const pillY = y + (CODE - pillH) / 2;

    ctx.fillStyle = INK.gold;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();

    ctx.fillStyle = '#12203f';
    ctx.font = font(700, 36);
    ctx.fillText('Open the full record', pillX + 40, pillY + 44);
    ctx.font = font(600, 26);
    ctx.fillText(vote.site || '', pillX + 40, pillY + 78);


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
