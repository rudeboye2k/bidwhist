// Edit name + avatar from the lobby; everyone at the table sees it.
const { chromium, devices } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
(async () => {
  const code = (await (await fetch(ORIGIN + '/api/new', { method: 'POST' })).json()).code;
  const host = new WebSocket(`${WS}/api/room/${code}/ws`);
  let hv = null; host.on('message', (m) => { const x = JSON.parse(m); if (x.type === 'state') hv = x.view; });
  await new Promise((r) => host.on('open', r)); host.send(JSON.stringify({ type: 'hello', name: 'Mrs. Weir' }));
  await wait(300);
  const b = await chromium.launch();
  for (const [label, opts] of [['desk', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
    const p = await b.newPage(opts);
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${ORIGIN}/#join=${code}`);
    await p.waitForSelector('#modal-online.show'); await p.click('#btn-join');
    await p.waitForSelector('#modal-lobby.show'); await wait(500);
    check(`${label}: lobby shows who you're playing as`, await p.isVisible('#lobby-me') && (await p.textContent('#lobby-pname')).trim() === 'You');
    check(`${label}: an empty team has no captain`, !(await p.textContent('#lobby-teams')).includes('Captain: Player'));
    if (label === 'desk') await p.screenshot({ path: OUT + '/lobby-me-before.png' });
    await p.click('#btn-lobby-profile');
    await p.waitForSelector('#modal-profile.show');
    const onTop = await p.evaluate(() => { const r = document.querySelector('#modal-profile .modal').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 30); return !!e.closest('#modal-profile'); });
    check(`${label}: the editor opens on top of the lobby`, onTop);
    const nm = label === 'desk' ? 'Juliet' : 'Jules';
    await p.fill('#profile-name', nm);
    await p.click('#btn-shuffle-avatar');
    await p.click('#btn-profile-save');
    await wait(800);
    check(`${label}: lobby strip shows the new name`, (await p.textContent('#lobby-pname')).trim() === nm);
    check(`${label}: your roster row shows your name (tagged "you")`, await p.evaluate((n) => [...document.querySelectorAll('#lobby-teams li')].some((li) => li.textContent.includes(n) && li.querySelector('.r-tag.you')), nm));
    const seen = hv && hv.seats.find((s) => s.name === nm);
    check(`${label}: the host sees the new name + avatar`, !!seen && /^cartoon:/.test(seen.avatar || ''));
    if (label === 'desk') await p.screenshot({ path: OUT + '/lobby-me-after.png' });
    if (label === 'phone') await p.screenshot({ path: OUT + '/lobby-me-phone.png' });
    check(`${label}: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    check(`${label}: no page errors`, errs.length === 0);
    await p.close();
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  host.close(); await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
