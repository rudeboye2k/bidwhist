// Shared bits for the browser tests: which browser, which server, where screenshots go.
//   E2E_ORIGIN    the running game (default http://127.0.0.1:8787 — `npx wrangler dev`)
//   E2E_OUT       where screenshots go (default: the system temp folder)
//   CHROMIUM_PATH a Chromium to use (default: /opt/pw-browsers/chromium if present,
//                 else Playwright's own — `npx playwright-core install chromium`)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const pw = require('playwright-core');

const ORIGIN = (process.env.E2E_ORIGIN || 'http://127.0.0.1:8787').replace(/\/$/, '');
const WS = ORIGIN.replace(/^http/, 'ws');
// Screenshots go OUTSIDE the project: `wrangler dev` reloads (dropping every
// socket) whenever a file in the site folder changes.
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'gmdk-e2e');
fs.mkdirSync(OUT, { recursive: true });

const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const chromium = {
  launch: (opts) => pw.chromium.launch(Object.assign(exe ? { executablePath: exe } : {}, opts || {})),
};

module.exports = { chromium, devices: pw.devices, ORIGIN, WS, OUT };
