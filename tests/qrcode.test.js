// QR encoder correctness checks. The Reed-Solomon ECC is the error-prone part:
// a valid RS codeword has zero syndromes at α^0..α^(n-1), so we verify that
// directly. Plus structural checks on the rendered matrix.
// Run: node tests/qrcode.test.js
'use strict';
const { QRCode } = require('../js/qrcode.js');
const T = QRCode._test;

let fails = 0;
const check = (name, ok) => { if (!ok) { fails++; console.error('FAIL ' + name); } else console.log('ok   ' + name); };

// GF(256) exp for syndrome evaluation.
function alphaPow(j) { let x = 1; for (let i = 0; i < j; i++) x = T.gfMul(x, 0x02); return x; }

// Reed-Solomon: for each ECC length used (v1..v10, L and M), build a random
// data block, append computed ECC, and assert all syndromes are zero.
let rsChecked = 0;
for (const ecl of [0, 1]) {
  for (let ver = 1; ver <= 10; ver++) {
    const eccLen = T.ECC_PER_BLOCK[ecl][ver - 1];
    const dlen = Math.max(1, Math.floor(T.dataCodewords(ver, ecl) / T.NUM_BLOCKS[ecl][ver - 1]));
    const data = Array.from({ length: dlen }, () => Math.floor(Math.random() * 256));
    const ecc = Array.from(T.rsRemainder(data, T.rsDivisor(eccLen)));
    const cw = data.concat(ecc);            // full codeword, most-significant first
    let allZero = true;
    for (let j = 0; j < eccLen; j++) {
      let s = 0;
      for (let i = 0; i < cw.length; i++) s ^= T.gfMul(cw[i], alphaPow(j * (cw.length - 1 - i)));
      if (s !== 0) allZero = false;
    }
    if (!allZero) { rsChecked = -1; break; }
    rsChecked++;
  }
  if (rsChecked < 0) break;
}
check('Reed-Solomon codewords have zero syndromes (all v1-10, L & M)', rsChecked === 20);

// Structural: finder patterns, timing, size, quiet dark module.
const { modules, size } = T.encode('https://bidwhist.example.workers.dev/#join=HURLQ', 1);
check('matrix is square and odd-sized', modules.length === size && size % 4 === 1);

function finderOk(ox, oy) {
  // 7x7 finder: dark border ring, dark 3x3 center, light ring between.
  for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
    const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
    const expect = d !== 2;
    if (modules[oy + dy][ox + dx] !== expect) return false;
  }
  return true;
}
check('top-left finder pattern', finderOk(0, 0));
check('top-right finder pattern', finderOk(size - 7, 0));
check('bottom-left finder pattern', finderOk(0, size - 7));

let timingOk = true;
for (let i = 8; i < size - 8; i++) { if (modules[6][i] !== (i % 2 === 0)) timingOk = false; }
check('horizontal timing pattern alternates', timingOk);
check('dark module present', modules[size - 8][8] === true);

// A long link still fits (picks a higher version); a huge one throws.
let fit = true; try { T.encode('https://bidwhist.example.workers.dev/#join=ABCDE&s=' + 'x'.repeat(120), 0); } catch (_) { fit = false; }
check('long invite link fits at ECC L', fit);

// SVG render produces a valid svg string with a path.
const svg = QRCode.toSvg('https://x.dev/#join=ABCDE');
check('toSvg returns an <svg> with module path', /^<svg/.test(svg) && svg.includes('<path') && svg.includes('</svg>'));

if (fails) { console.error('\n' + fails + ' failure(s)'); process.exit(1); }
console.log('\nAll QR tests passed.');
