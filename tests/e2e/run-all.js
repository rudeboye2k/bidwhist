// Run every *.test.js here against a running game (see helpers.js), one at a
// time, retrying a failed file once (they drive real timing and animations).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && (!only.length || only.some((o) => f.includes(o)))).sort();
const results = [];
for (const f of files) {
  let ok = false, tries = 0, out = '';
  while (!ok && tries < 2) {
    tries++;
    const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 15 * 60 * 1000 });
    out = (r.stdout || '') + (r.stderr || '');
    ok = r.status === 0;
  }
  const summary = (out.match(/\d+\/\d+ passed/g) || []).pop() || (ok ? 'ok' : 'failed');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(30)} ${summary}${tries > 1 ? '  (passed on retry)' : ''}`.replace('  (passed on retry)', ok && tries > 1 ? '  (passed on retry)' : ''));
  if (!ok) {
    const lines = out.trim().split('\n');
    const fails = lines.filter((l) => /^\s*FAIL/.test(l));
    console.log([...fails, ...lines.slice(-15).filter((l) => !fails.includes(l))].map((l) => '    ' + l).join('\n'));
  }
  results.push(ok);
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} test files passed`);
process.exit(failed ? 1 : 0);
