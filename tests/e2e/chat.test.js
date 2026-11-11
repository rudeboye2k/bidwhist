// Type your own message in the 💬 window: online (both ways) and solo.
const { chromium, devices } = require('./helpers');
const WebSocket = require('ws');
const { ORIGIN, WS, OUT } = require('./helpers');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n); } };
(async () => {
  const b = await chromium.launch();
  let host;
  for (const [label, opts] of [['desk', { viewport: { width: 1280, height: 860 } }], ['phone', devices['iPhone 13']]]) {
    const code = (await (await fetch(ORIGIN + '/api/new', { method: 'POST' })).json()).code;
    host = new WebSocket(`${WS}/api/room/${code}/ws`);
    const got = []; host.on('message', (m) => { const x = JSON.parse(m); if (x.type === 'state') got.push(...x.events); });
    await new Promise((r) => host.on('open', r)); host.send(JSON.stringify({ type: 'hello', name: 'Mrs. Weir' }));
    await wait(300);
    const p = await b.newPage(opts);
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.dismiss());
    await p.goto(`${ORIGIN}/#join=${code}`);
    await p.waitForSelector('#modal-online.show'); await p.click('#btn-join');
    await p.waitForSelector('#modal-lobby.show'); await wait(300);
    host.send(JSON.stringify({ type: 'start' }));
    await p.waitForFunction(() => !document.getElementById('modal-lobby').classList.contains('show'), null, { timeout: 10000 }).catch(() => {});
    if (label === 'phone') { /* game already running: joiner is a new seat? (table had room) */ }
    await wait(1500);
    if (!(await p.isVisible('#btn-react'))) { check(`${label}: 💬 button visible in game`, false); continue; }
    await p.click('#btn-react');
    check(`${label}: the 💬 window has a type-your-own box`, await p.isVisible('.react-say input'));
    const msg = label === 'desk' ? 'Y\'all ready to get set?' : 'Deal faster!';
    await p.fill('.react-say input', msg);
    await p.screenshot({ path: `${OUT}/say-${label}-typing.png` });
    await p.press('.react-say input', 'Enter');
    await wait(900);
    check(`${label}: the table receives your message`, got.some((e) => e.t === 'say' && e.text === msg));
    check(`${label}: it pops over your seat`, await p.evaluate((m) => [...document.querySelectorAll('.react-bubble')].some((x) => x.textContent === m), msg));
    check(`${label}: and shows in Table Talk`, (await p.textContent('#log')).includes(msg));
    await wait(1400);
    host.send(JSON.stringify({ type: 'say', text: '<img src=x onerror=alert(1)>Nice try' }));
    await wait(900);
    const injected = await p.evaluate(() => !!document.querySelector('#log img, .react-bubble img'));
    check(`${label}: other players' messages arrive, markup is never rendered`, !injected && (await p.textContent('#log')).includes('Nice try'));
    await p.screenshot({ path: `${OUT}/say-${label}-sent.png` });
    check(`${label}: no page errors`, errs.length === 0);
    await p.close();
    host.close();
  }
  // solo
  const s = await b.newPage({ viewport: { width: 1280, height: 860 } });
  await s.goto(ORIGIN + '/'); await s.click('#btn-deal-in'); await wait(1500);
  await s.click('#btn-react'); await s.fill('.react-say input', 'Pearl, you scared?'); await s.press('.react-say input', 'Enter'); await wait(700);
  check('solo: typing works against the computer too', (await s.textContent('#log')).includes('Pearl, you scared?'));
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
