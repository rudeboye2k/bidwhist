/*
 * Minimal QR Code generator (byte mode, versions 1–10, ECC levels L/M).
 * Self-contained, no dependencies — a compact port of Project Nayuki's
 * public-domain QR algorithm, enough to encode a short invite URL and render it
 * as a crisp SVG. Exposes window.QRCode.render(container, text).
 */
(function (root) {
  'use strict';

  // GF(256) multiply with QR's primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  // ECC codewords per block and block count, indexed [ecl][version-1], v1..v10.
  // ecl: 0 = L, 1 = M.
  const ECC_PER_BLOCK = {
    0: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    1: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  };
  const NUM_BLOCKS = {
    0: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    1: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  };

  function rawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; }
    if (ver >= 7) r -= 36;
    return r;
  }
  function totalCodewords(ver) { return Math.floor(rawDataModules(ver) / 8); }
  function dataCodewords(ver, ecl) {
    return totalCodewords(ver) - ECC_PER_BLOCK[ecl][ver - 1] * NUM_BLOCKS[ecl][ver - 1];
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = Math.ceil((size - 13) / (n * 2 - 2)) * 2;
    const res = [6];
    for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ result[0];
      for (let i = 0; i < result.length - 1; i++) result[i] = result[i + 1];
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  function utf8(text) {
    const out = [];
    for (const ch of unescape(encodeURIComponent(text))) out.push(ch.charCodeAt(0));
    return out;
  }

  function chooseVersion(len, ecl) {
    for (let v = 1; v <= 10; v++) {
      const cci = v <= 9 ? 8 : 16;
      const capBits = dataCodewords(v, ecl) * 8;
      if (4 + cci + 8 * len <= capBits) return v;
    }
    return -1;
  }

  // Build the final interleaved data+ECC codeword stream.
  function makeCodewords(bytes, ver, ecl) {
    const cci = ver <= 9 ? 8 : 16;
    const bits = [];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);            // byte mode
    push(bytes.length, cci);    // char count
    for (const b of bytes) push(b, 8);
    const dcw = dataCodewords(ver, ecl);
    const capBits = dcw * 8;
    for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0); // terminator
    while (bits.length % 8 !== 0) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (let pad = 0xec; data.length < dcw; pad ^= 0xec ^ 0x11) data.push(pad);

    // Split into blocks, append ECC, interleave.
    const numBlocks = NUM_BLOCKS[ecl][ver - 1];
    const eccLen = ECC_PER_BLOCK[ecl][ver - 1];
    const shortLen = Math.floor(dcw / numBlocks);
    const numShort = numBlocks - (dcw % numBlocks);
    const divisor = rsDivisor(eccLen);
    const blocks = [];
    let off = 0;
    for (let i = 0; i < numBlocks; i++) {
      const dlen = shortLen + (i < numShort ? 0 : 1);
      const dat = data.slice(off, off + dlen); off += dlen;
      const ecc = rsRemainder(dat, divisor);
      blocks.push({ dat, ecc });
    }
    const result = [];
    const maxData = shortLen + 1;
    for (let i = 0; i < maxData; i++)
      for (const b of blocks) if (i < b.dat.length) result.push(b.dat[i]);
    for (let i = 0; i < eccLen; i++)
      for (const b of blocks) result.push(b.ecc[i]);
    return result;
  }

  // ---- matrix ----

  function encode(text, ecl) {
    const bytes = utf8(text);
    const ver = chooseVersion(bytes.length, ecl);
    if (ver < 0) throw new Error('QR: text too long');
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { mod[y][x] = v; fn[y][x] = true; };

    // timing patterns
    for (let i = 0; i < size; i++) { if (!fn[6][i]) set(i, 6, i % 2 === 0); if (!fn[i][6]) set(6, i, i % 2 === 0); }

    // finder patterns + separators
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    // alignment patterns
    const aps = alignPositions(ver);
    for (const ay of aps) for (const ax of aps) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    // reserve format + version areas (filled later)
    const reserveFormat = () => {
      for (let i = 0; i < 9; i++) { if (!fn[i][8]) set(8, i, false); if (!fn[8][i]) set(i, 8, false); }
      for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false); }
      set(8, size - 8, true); // dark module
    };
    reserveFormat();
    if (ver >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(a, b, false); set(b, a, false);
      }
    }

    // place codewords (zigzag)
    const codewords = makeCodewords(bytes, ver, ecl);
    let bitIdx = 0;
    const getBit = () => {
      const byte = codewords[bitIdx >> 3];
      const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIdx & 7))) & 1;
      bitIdx++;
      return bit === 1;
    };
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - v : v;
          if (!fn[y][x]) mod[y][x] = getBit();
        }
      }
    }

    // masking: pick lowest-penalty mask
    const maskFns = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x, y) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    let best = -1, bestPenalty = Infinity, bestMod = null;
    for (let m = 0; m < 8; m++) {
      const trial = mod.map((r) => r.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (!fn[y][x] && maskFns[m](x, y)) trial[y][x] = !trial[y][x];
      drawFormat(trial, fn, size, ecl, m);
      if (ver >= 7) drawVersion(trial, size, ver);
      const p = penalty(trial, size);
      if (p < bestPenalty) { bestPenalty = p; best = m; bestMod = trial; }
    }
    return { modules: bestMod, size };
  }

  function drawFormat(mod, fn, size, ecl, mask) {
    const eclBits = ecl === 0 ? 1 : 0; // L=01, M=00 (QR format: M=0,L=1,H=2,Q=3)
    const data = (eclBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const get = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) mod[i][8] = get(i);
    mod[7][8] = get(6); mod[8][8] = get(7); mod[8][7] = get(8);
    for (let i = 9; i < 15; i++) mod[8][14 - i] = get(i);
    for (let i = 0; i < 8; i++) mod[8][size - 1 - i] = get(i);
    for (let i = 8; i < 15; i++) mod[size - 15 + i][8] = get(i);
    mod[size - 8][8] = true;
  }

  function drawVersion(mod, size, ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      mod[b][a] = bit; mod[a][b] = bit;
    }
  }

  function penalty(mod, size) {
    let p = 0;
    // rule 1: runs of 5+
    for (let y = 0; y < size; y++) {
      let runC = mod[y][0], runL = 1;
      for (let x = 1; x < size; x++) {
        if (mod[y][x] === runC) { runL++; if (runL === 5) p += 3; else if (runL > 5) p++; }
        else { runC = mod[y][x]; runL = 1; }
      }
    }
    for (let x = 0; x < size; x++) {
      let runC = mod[0][x], runL = 1;
      for (let y = 1; y < size; y++) {
        if (mod[y][x] === runC) { runL++; if (runL === 5) p += 3; else if (runL > 5) p++; }
        else { runC = mod[y][x]; runL = 1; }
      }
    }
    // rule 2: 2x2 blocks
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    // rule 4: dark ratio
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
    const ratio = dark / (size * size);
    p += Math.floor(Math.abs(ratio * 100 - 50) / 5) * 10;
    return p;
  }

  // ---- render ----

  function toSvg(text, opts) {
    opts = opts || {};
    const ecl = opts.ecl === 'L' ? 0 : 1;
    const { modules, size } = encode(text, ecl);
    const quiet = 4;
    const dim = size + quiet * 2;
    const dark = opts.dark || '#15110b';
    const light = opts.light || '#f6efdd';
    let rects = '';
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      if (modules[y][x]) rects += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" width="100%" height="100%">` +
      `<rect width="${dim}" height="${dim}" fill="${light}" rx="1"/>` +
      `<path d="${rects}" fill="${dark}"/></svg>`;
  }

  function render(container, text, opts) {
    try { container.innerHTML = toSvg(text, opts); return true; }
    catch (e) { container.innerHTML = ''; return false; }
  }

  root.QRCode = { render, toSvg, encode };
  root.QRCode._test = { gfMul, rsDivisor, rsRemainder, dataCodewords, ECC_PER_BLOCK, NUM_BLOCKS, encode };
})(typeof window !== 'undefined' ? window : this);
