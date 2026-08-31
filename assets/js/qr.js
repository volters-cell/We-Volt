/* A QR code, drawn here rather than fetched from anywhere.

   The story card carries one so the vote can be opened from a screenshot, a
   phone held up to a screen, or a story someone reposted. Every other way of
   getting a QR code onto a page — an image service, a library from a CDN —
   would put a third party between the reader and the record, which is the one
   thing this project does not do. So it is generated in the page: byte mode,
   error correction level M, versions 1 to 10, which covers any address this
   site produces with room for the code to survive a logo over its middle.

   The algorithm is ISO/IEC 18004. The tables below are from it. */
(function (global) {
  'use strict';

  // Per version at error-correction level M: error-correction codewords per
  // block, then the two groups of blocks as [count, data codewords each].
  const SPEC = {
    1: [10, [1, 16], [0, 0]],
    2: [16, [1, 28], [0, 0]],
    3: [26, [1, 44], [0, 0]],
    4: [18, [2, 32], [0, 0]],
    5: [24, [2, 43], [0, 0]],
    6: [16, [4, 27], [0, 0]],
    7: [18, [4, 31], [0, 0]],
    8: [22, [2, 38], [2, 39]],
    9: [22, [3, 36], [2, 37]],
    10: [26, [4, 43], [1, 44]]
  };

  const ALIGNMENT = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  /* GF(256) with the primitive polynomial the standard names, 0x11d. */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function mul(a, b) {
    if (!a || !b) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function generator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      // poly[0] is the highest-degree coefficient: multiplying by x keeps the
      // index, multiplying by the root moves it one along.
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function remainder(data, degree) {
    const gen = generator(degree);
    const out = new Array(degree).fill(0);
    data.forEach(function (byte) {
      const factor = byte ^ out[0];
      out.shift();
      out.push(0);
      for (let i = 0; i < degree; i++) out[i] ^= mul(gen[i + 1], factor);
    });
    return out;
  }

  function utf8(text) {
    const encoded = unescape(encodeURIComponent(String(text)));
    const bytes = [];
    for (let i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i) & 0xff);
    return bytes;
  }

  function capacity(version) {
    const spec = SPEC[version];
    return spec[1][0] * spec[1][1] + spec[2][0] * spec[2][1];
  }

  function pickVersion(byteLength) {
    for (let version = 1; version <= 10; version++) {
      const header = 4 + (version < 10 ? 8 : 16);
      if (byteLength * 8 + header <= capacity(version) * 8) return version;
    }
    return 0;
  }

  /* The message: mode, length, the bytes themselves, a terminator, then the
     two pad bytes the standard alternates until the block is full. */
  function codewords(bytes, version) {
    const bits = [];
    const push = function (value, length) {
      for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
    };

    push(4, 4);                                   // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach(function (byte) { push(byte, 8); });

    const total = capacity(version) * 8;
    for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }
    const pads = [0xec, 0x11];
    let at = 0;
    while (data.length < capacity(version)) data.push(pads[at++ % 2]);
    return data;
  }

  /* Blocks are interleaved: one codeword from each block in turn, then the
     same for the error-correction codewords. */
  function interleave(data, version) {
    const spec = SPEC[version];
    const ecLength = spec[0];
    const groups = [spec[1], spec[2]];

    const blocks = [];
    let at = 0;
    groups.forEach(function (group) {
      for (let i = 0; i < group[0]; i++) {
        const block = data.slice(at, at + group[1]);
        at += group[1];
        blocks.push({ data: block, ec: remainder(block, ecLength) });
      }
    });

    const out = [];
    const longest = Math.max.apply(null, blocks.map(function (b) { return b.data.length; }));
    for (let i = 0; i < longest; i++) {
      blocks.forEach(function (block) {
        if (i < block.data.length) out.push(block.data[i]);
      });
    }
    for (let i = 0; i < ecLength; i++) {
      blocks.forEach(function (block) { out.push(block.ec[i]); });
    }
    return out;
  }

  /* The fixed patterns, laid down before the message and marked as reserved so
     the message flows around them. */
  function frame(version) {
    const size = version * 4 + 17;
    const modules = [];
    const reserved = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Array(size).fill(0));
      reserved.push(new Array(size).fill(false));
    }

    const set = function (x, y, value) {
      modules[y][x] = value ? 1 : 0;
      reserved[y][x] = true;
    };

    const finder = function (ox, oy) {
      for (let y = -1; y <= 7; y++) {
        for (let x = -1; x <= 7; x++) {
          const px = ox + x, py = oy + y;
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const edge = x === 0 || x === 6 || y === 0 || y === 6;
          const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          set(px, py, (x >= 0 && x <= 6 && y >= 0 && y <= 6) && (edge || core));
        }
      }
    };
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);

    for (let i = 8; i < size - 8; i++) {
      set(i, 6, i % 2 === 0);
      set(6, i, i % 2 === 0);
    }

    const centres = ALIGNMENT[version];
    centres.forEach(function (cy) {
      centres.forEach(function (cx) {
        // Not where a finder already is.
        if ((cx === 6 && cy === 6) ||
            (cx === 6 && cy === size - 7) ||
            (cx === size - 7 && cy === 6)) return;
        for (let y = -2; y <= 2; y++) {
          for (let x = -2; x <= 2; x++) {
            const edge = Math.abs(x) === 2 || Math.abs(y) === 2;
            set(cx + x, cy + y, edge || (x === 0 && y === 0));
          }
        }
      });
    });

    set(8, size - 8, 1);   // the dark module, always

    // Format information areas, filled in once a mask is chosen.
    for (let i = 0; i < 9; i++) {
      if (!reserved[8][i]) { modules[8][i] = 0; reserved[8][i] = true; }
      if (!reserved[i][8]) { modules[i][8] = 0; reserved[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      if (!reserved[8][size - 1 - i]) { modules[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
      if (!reserved[size - 1 - i][8]) { modules[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
    }

    // Version information, from version 7 up.
    if (version >= 7) {
      let bits = version << 12;
      for (let i = 0; i < 6; i++) {
        if (bits >> (17 - i) & 1) bits ^= 0x1f25 << (5 - i);
      }
      bits = (version << 12) | (bits & 0xfff);
      for (let i = 0; i < 18; i++) {
        const bit = (bits >> i) & 1;
        const a = Math.floor(i / 3);
        const b = i % 3;
        set(a, size - 11 + b, bit);
        set(size - 11 + b, a, bit);
      }
    }

    return { size: size, modules: modules, reserved: reserved };
  }

  const MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; },
    function (x, y) { return ((x * y) % 2) + ((x * y) % 3) === 0; },
    function (x, y) { return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; },
    function (x, y) { return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; }
  ];

  function place(grid, bytes) {
    const size = grid.size;
    const bits = [];
    bytes.forEach(function (byte) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    });

    let at = 0;
    let upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right -= 1;   // the vertical timing line is skipped
      for (let step = 0; step < size; step++) {
        const y = upward ? size - 1 - step : step;
        for (let column = 0; column < 2; column++) {
          const x = right - column;
          if (grid.reserved[y][x]) continue;
          grid.modules[y][x] = at < bits.length ? bits[at] : 0;
          at += 1;
        }
      }
      upward = !upward;
    }
  }

  function applyMask(grid, mask) {
    const size = grid.size;
    const out = grid.modules.map(function (row) { return row.slice(); });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (grid.reserved[y][x]) continue;
        if (MASKS[mask](x, y)) out[y][x] ^= 1;
      }
    }
    return out;
  }

  function writeFormat(modules, size, mask) {
    // Level M is 00; the rest is the BCH the standard specifies, XORed with
    // 0x5412 so a blank area is not a valid format.
    let bits = (0 << 3) | mask;
    let rest = bits << 10;
    for (let i = 4; i >= 0; i--) {
      if (rest >> (i + 10) & 1) rest ^= 0x537 << i;
    }
    const format = ((bits << 10) | (rest & 0x3ff)) ^ 0x5412;

    // The string is written most significant bit first, which is the order the
    // standard's figure shows and the order a scanner reads back.
    const bit = function (i) { return (format >> (14 - i)) & 1; };

    for (let i = 0; i <= 5; i++) modules[8][i] = bit(i);
    modules[8][7] = bit(6);
    modules[8][8] = bit(7);
    modules[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) modules[14 - i][8] = bit(i);

    // The second copy is seven modules up the right of the bottom-left finder
    // and eight along the top of the bottom-right corner — not eight and
    // seven, which would write over the dark module.
    for (let i = 0; i <= 6; i++) modules[size - 1 - i][8] = bit(i);
    for (let i = 7; i <= 14; i++) modules[8][size - 15 + i] = bit(i);

    modules[size - 8][8] = 1;   // the dark module survives everything
  }

  function penalty(modules, size) {
    let score = 0;

    // Runs of five or more of the same colour, in both directions.
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          const here = pass ? modules[b][a] : modules[a][b];
          const before = pass ? modules[b - 1][a] : modules[a][b - 1];
          if (here === before) {
            run += 1;
            if (run === 5) score += 3;
            else if (run > 5) score += 1;
          } else {
            run = 1;
          }
        }
      }
    }

    // Blocks of the same colour, two by two.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v = modules[y][x];
        if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) {
          score += 3;
        }
      }
    }

    // The finder-like sequence, which must not appear in the message.
    const PATTERN = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const REVERSED = PATTERN.slice().reverse();
    const matches = function (line, at, pattern) {
      for (let i = 0; i < pattern.length; i++) {
        if (line[at + i] !== pattern[i]) return false;
      }
      return true;
    };
    for (let a = 0; a < size; a++) {
      const row = modules[a];
      const column = modules.map(function (r) { return r[a]; });
      for (let b = 0; b + 11 <= size; b++) {
        if (matches(row, b, PATTERN) || matches(row, b, REVERSED)) score += 40;
        if (matches(column, b, PATTERN) || matches(column, b, REVERSED)) score += 40;
      }
    }

    // How far from half the modules are dark.
    let dark = 0;
    modules.forEach(function (row) { row.forEach(function (v) { dark += v; }); });
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;

    return score;
  }

  /* matrix(text) -> { size, modules } where modules[y][x] is 1 for dark, or
     null if the text will not fit in a version this encoder draws. */
  function matrix(text) {
    const bytes = utf8(text);
    const version = pickVersion(bytes.length);
    if (!version) return null;

    const grid = frame(version);
    place(grid, interleave(codewords(bytes, version), version));

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const modules = applyMask(grid, mask);
      writeFormat(modules, grid.size, mask);
      const score = penalty(modules, grid.size);
      if (!best || score < best.score) best = { score: score, modules: modules };
    }

    return { size: grid.size, modules: best.modules, version: version };
  }

  /* Draws it into a canvas context, module by module, with a quiet zone: the
     four-module border the standard requires and scanners rely on. */
  function draw(ctx, text, x, y, size, options) {
    const code = matrix(text);
    if (!code) return false;
    const quiet = (options && options.quiet !== undefined) ? options.quiet : 4;
    const span = code.size + quiet * 2;
    const unit = size / span;

    ctx.fillStyle = (options && options.background) || '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = (options && options.ink) || '#000000';
    for (let row = 0; row < code.size; row++) {
      for (let column = 0; column < code.size; column++) {
        if (!code.modules[row][column]) continue;
        ctx.fillRect(
          x + (column + quiet) * unit,
          y + (row + quiet) * unit,
          Math.ceil(unit),
          Math.ceil(unit)
        );
      }
    }
    return true;
  }

  global.QR = { matrix: matrix, draw: draw };
})(window);
