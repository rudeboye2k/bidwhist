/* Give Me Da Kitty — daily.js
 * The Daily Deal: one hand, the same cards for everyone today, and a shared leaderboard.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// The hand runs on the same in-browser room as solo (RoomCore.dailyRoom: the
// day's seed, default rules, fresh computer players). Your moves are kept so
// the server can replay them and check the score before it goes on the board.
// Your score is your team's points minus theirs; ties go to more books.
const Daily = { date: null, moves: [] };
const DAILY_KEY = 'bidwhist.daily';

function deviceId() {
  try {
    let id = localStorage.getItem('bidwhist.device');
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('bidwhist.device', id);
    }
    return id;
  } catch (_) { return null; }
}
function dailySaved() {
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY) || 'null');
    return d && d.date === E.dailyDate() ? d : null;
  } catch (_) { return null; }
}
function saveDaily(d) { try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch (_) { /* ignore */ } }

function startDaily() {
  $('modal-daily').classList.remove('show');
  $('splash').classList.remove('show');
  Daily.date = E.dailyDate();
  Daily.moves = [];
  startSolo({ daily: Daily.date });
  log('— <b>Daily Deal</b>: everyone gets these same cards today. One hand — make it count. —', true);
}

// The hand's over: keep the result, then post it.
function finishDaily(r) {
  const s = RoomCore.dailyScore(r);
  const saved = dailySaved();
  if (!saved || !saved.done) saveDaily({ date: Daily.date, done: true, posted: false, net: s.net, books: s.books, moves: Daily.moves.slice() });
  postDaily();
}

async function postDaily() {
  const d = dailySaved();
  const base = Net.serverBase();
  if (!d || !d.done || d.posted || !base) return null;
  try {
    const res = await fetch(`${base}/api/daily/${d.date}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: deviceId(), name: G.profile.name, avatar: G.profile.avatar, moves: d.moves }),
    });
    const board = await res.json();
    if (res.ok) { d.posted = true; saveDaily(d); return board; }
    if (board && board.error) { d.posted = true; d.rejected = board.error; saveDaily(d); }
  } catch (_) { /* offline: try again next time the board opens */ }
  return null;
}

const signed = (n) => (n > 0 ? '+' : '') + n;

async function openDaily() {
  $('splash').classList.remove('show');
  const d = dailySaved();
  $('btn-daily-play').hidden = !!(d && d.done);
  $('daily-note').innerHTML = d && d.done
    ? `You scored <b>${signed(d.net)}</b> today (${d.books} books). A new deal comes at midnight UTC.`
    : 'One hand, and everybody gets the same cards today. Your score is your team&rsquo;s points minus theirs — one try, so make it count.';
  const list = $('daily-board');
  list.innerHTML = '<li class="daily-empty">Loading today&rsquo;s board…</li>';
  $('modal-daily').classList.add('show');
  let board = await postDaily();
  const base = Net.serverBase();
  if (!board && base) {
    try { board = await (await fetch(`${base}/api/daily/${E.dailyDate()}?device=${encodeURIComponent(deviceId() || '')}`)).json(); } catch (_) { board = null; }
  }
  renderDailyBoard(board);
}

function renderDailyBoard(board) {
  const list = $('daily-board');
  list.innerHTML = '';
  if (!board || !board.top) {
    list.innerHTML = '<li class="daily-empty">The leaderboard needs a connection — your score will post next time.</li>';
    return;
  }
  if (!board.top.length) {
    list.innerHTML = '<li class="daily-empty">Nobody&rsquo;s posted a score yet today. Be the first!</li>';
    return;
  }
  for (const e of board.top) {
    const li = document.createElement('li');
    if (e.you) li.className = 'you';
    const rank = document.createElement('span'); rank.className = 'r-tag daily-rank'; rank.textContent = '#' + e.rank;
    const av = document.createElement('span'); av.className = 'avatar';
    applyAvatar(av, avatarFrom(e.avatar, (e.name || 'player') + '#' + e.rank));
    const nm = document.createElement('span'); nm.className = 'r-name'; nm.textContent = e.name;
    const sc = document.createElement('span'); sc.className = 'r-tag' + (e.you ? ' you' : '');
    sc.textContent = `${signed(e.net)} · ${e.books} bks`;
    li.append(rank, av, nm, sc);
    list.appendChild(li);
  }
  if (board.you && board.you.rank > board.top.length) {
    const li = document.createElement('li'); li.className = 'you';
    li.innerHTML = `<span class="r-tag daily-rank">#${board.you.rank}</span><span class="r-name">You</span><span class="r-tag you">${signed(board.you.net)} · ${board.you.books} bks</span>`;
    list.appendChild(li);
  }
  if (board.total > 1) $('daily-note').insertAdjacentHTML('beforeend', ` <span class="daily-total">${board.total} players today.</span>`);
}
