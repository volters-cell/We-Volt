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
  const SITE = 'volters-cell.github.io/We-Volt';

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
  function layoutTitle(ctx, text, maxWidth, sizes, maxLines) {
    for (let i = 0; i < sizes.length; i++) {
      ctx.font = font(700, sizes[i], "'Source Serif 4', Georgia, serif");
      const lines = wrap(ctx, text, maxWidth);
      if (lines.length <= maxLines || i === sizes.length - 1) {
        return { size: sizes[i], lines: lines.slice(0, maxLines), clipped: lines.length > maxLines };
      }
    }
    return { size: sizes[sizes.length - 1], lines: [], clipped: false };
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

  async function ready() {
    if (!document.fonts || !document.fonts.ready) return;
    try {
      await document.fonts.ready;
    } catch (error) {
      // A browser that will not report on its fonts still draws with them.
    }
  }

  /* card({ title, subtitle, dateLabel, bodyLabel, result, totals, seats, url })
     resolves to a PNG blob, or null where the canvas will not give one up. */
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

    /* Measured before it is drawn, because a story is a fixed frame with a
       reader's thumb at the bottom and the app's own controls at the top: the
       block has to sit in the middle of what is left, whether the title runs
       to one line or to six. */
    const title = layoutTitle(ctx, vote.title, inner, [96, 86, 76, 66, 58], 6);
    ctx.font = font(400, 34);
    const subtitle = vote.subtitle ? wrap(ctx, vote.subtitle, inner).slice(0, 2) : [];

    const BRAND = 96;        // the mark and the name
    const META = 104;        // institution and date, and air under it
    const TITLE = title.lines.length * title.size * 1.14;
    const SUB = subtitle.length ? subtitle.length * 48 + 26 : 0;
    const VERDICT = 190;
    const BAR = 46 + 78;
    const CELLS = 156 + 70;
    const SEATS = vote.seats ? 56 : 0;
    const block = BRAND + META + TITLE + SUB + VERDICT + BAR + CELLS + SEATS;

    // Instagram covers roughly the top and bottom eighth of a story with its
    // own controls, so the safe band is what is between them.
    const TOP_SAFE = 300;
    const BOTTOM_SAFE = HEIGHT - 300;
    let y = Math.max(TOP_SAFE, TOP_SAFE + ((BOTTOM_SAFE - TOP_SAFE) - block) / 2);

    brandMark(ctx, pad + 26, y - 14, 26);
    ctx.fillStyle = INK.text;
    ctx.font = font(700, 42);
    ctx.fillText('EU Tracker', pad + 76, y);
    y += BRAND;

    ctx.fillStyle = INK.faint;
    ctx.font = font(600, 32);
    ctx.fillText(String(vote.bodyLabel || '').toUpperCase() + '  ·  ' + (vote.dateLabel || ''), pad, y);
    y += META;

    ctx.fillStyle = INK.text;
    ctx.font = font(700, title.size, "'Source Serif 4', Georgia, serif");
    title.lines.forEach(function (line, i) {
      const last = title.clipped && i === title.lines.length - 1;
      ctx.fillText(last ? line + '…' : line, pad, y + i * title.size * 1.14);
    });
    y += TITLE + title.size * 0.14;

    if (subtitle.length) {
      ctx.fillStyle = INK.faint;
      ctx.font = font(400, 34);
      subtitle.forEach(function (line, i) { ctx.fillText(line, pad, y + i * 48); });
      y += SUB;
    }

    // The verdict.
    y += 118;
    ctx.fillStyle = outcome.ink;
    ctx.font = font(700, 112);
    ctx.fillText(outcome.word, pad, y);
    y += 72;

    // The split, drawn as the bar the page draws.
    const totals = vote.totals || { for: 0, against: 0, abstain: 0, absent: 0 };
    const cast = totals.for + totals.against + totals.abstain;
    const barH = 46;
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
    y += barH + 78;

    // The three numbers, each in the colour of the vote it counts.
    const cells = [
      { label: 'In favour', value: totals.for, ink: INK.for },
      { label: 'Against', value: totals.against, ink: INK.against },
      { label: 'Abstained', value: totals.abstain, ink: INK.abstain }
    ];
    const cellW = (inner - 32) / 3;
    cells.forEach(function (cell, i) {
      const x = pad + i * (cellW + 16);
      ctx.fillStyle = INK.panel;
      roundRect(ctx, x, y, cellW, 156, 18);
      ctx.fill();
      ctx.fillStyle = cell.ink;
      ctx.font = font(700, 74);
      ctx.fillText(String(cell.value), x + 26, y + 82);
      ctx.fillStyle = INK.soft;
      ctx.font = font(600, 28);
      ctx.fillText(cell.label, x + 26, y + 126);
    });
    y += 156 + 56;

    if (vote.seats) {
      ctx.fillStyle = INK.faint;
      ctx.font = font(400, 30);
      ctx.fillText(cast + ' of ' + vote.seats + ' members voted · ' +
        totals.absent + ' did not', pad, y);
    }

    // The foot, kept clear of the controls a story app draws over the bottom.
    ctx.fillStyle = INK.faint;
    ctx.font = font(400, 30);
    ctx.fillText('Source: European Parliament open data', pad, HEIGHT - 340);
    ctx.fillStyle = INK.gold;
    ctx.font = font(700, 40);
    ctx.fillText(SITE, pad, HEIGHT - 278);

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
