/* Give Me Da Kitty — main.js
 * Wiring: buttons, menus, preferences, service worker — runs last.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// ---- wiring ---------------------------------------------------------------

$('btn-deal-in').addEventListener('click', () => {
  $('splash').classList.remove('show');
  startSolo();
});
// Rule edits made mid-hand go to the table just before the next deal.
function flushRules() {
  if (G.nextRules && Online.conn && amHost()) { Online.conn.send({ type: 'rules', rules: G.nextRules }); G.nextRules = null; }
}
$('btn-next-hand').addEventListener('click', () => {
  $('modal-summary').classList.remove('show');
  if (G.daily) { openDaily(); return; }
  if (Online.conn && amHost()) { flushRules(); Online.conn.send({ type: 'nextHand' }); }
});
$('btn-to-lobby').addEventListener('click', () => {
  $('modal-gameover').classList.remove('show');
  if (G.mode === 'online' && amHost()) { flushRules(); Online.conn.send({ type: 'toLobby' }); }
});
$('btn-rematch').addEventListener('click', () => {
  $('modal-gameover').classList.remove('show');
  if (Online.conn && amHost()) { flushRules(); Online.conn.send({ type: 'start' }); }
});
$('btn-new-game').addEventListener('click', () => {
  if (!G.running) return;
  if (G.mode === 'online') { location.reload(); return; }
  if (confirm('Start a fresh game? Current scores will be wiped.')) startSolo();
});

// Online setup + lobby wiring.
$('btn-play-online').addEventListener('click', () => { $('splash').classList.remove('show'); openOnlineSetup(); });
$('btn-online-back').addEventListener('click', () => { $('modal-online').classList.remove('show'); $('splash').classList.add('show'); });
$('btn-host').addEventListener('click', hostTable);
$('btn-join').addEventListener('click', joinTable);
$('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
$('btn-start-online').addEventListener('click', () => { if (amHost()) Online.conn.send({ type: 'start' }); });
$('btn-rejoin').addEventListener('click', rejoinTable);
$('btn-daily').addEventListener('click', openDaily);
$('btn-daily-play').addEventListener('click', startDaily);
$('btn-daily-close').addEventListener('click', () => {
  $('modal-daily').classList.remove('show');
  $('splash').classList.add('show'); // opened from the menu or after today's hand: back to the menu
});
$('btn-leave-online').addEventListener('click', () => {
  forgetTable();
  try { Online.conn && Online.conn.send({ type: 'leave' }); Online.conn && Online.conn.close(); } catch (_) { /* ignore */ }
  location.reload();
});
$('btn-copy-link').addEventListener('click', () => copyText(inviteLink(Online.code), $('btn-copy-link'), 'Copy invite link'));
// Phones/tablets: the native share sheet (Messages, WhatsApp, …) is the
// easiest way to send an invite by text.
if (navigator.share) {
  $('btn-share-link').hidden = false;
  $('btn-copy-link').classList.replace('primary', 'ghost');
  $('btn-share-link').addEventListener('click', () => {
    navigator.share({
      title: 'Give Me Da Kitty',
      text: `Pull up a chair — Give Me Da Kitty 🃏 · Bid Whist with your crew. Game key: ${Online.code}`,
      url: inviteLink(Online.code),
    }).catch(() => { /* cancelled */ });
  });
}

// Phone header: the nav collapses behind a ☰ toggle.
const closeMenu = () => { document.querySelector('.topbar').classList.remove('menu-open'); $('btn-menu').setAttribute('aria-expanded', 'false'); };
$('btn-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = document.querySelector('.topbar').classList.toggle('menu-open');
  $('btn-menu').setAttribute('aria-expanded', String(open));
});
$('topnav').addEventListener('click', closeMenu);
document.addEventListener('click', (e) => { if (!e.target.closest('.topbar')) closeMenu(); });
$('btn-copy-key').addEventListener('click', () => copyText(Online.code, $('btn-copy-key'), 'Copy key only'));
$('btn-reconnect').addEventListener('click', () => {
  $('modal-disconnect').classList.remove('show');
  connectRoom(Online.base, Online.code, Online.isHost);
});
$('btn-quit-online').addEventListener('click', () => { forgetTable(); location.reload(); });
$('btn-settings').addEventListener('click', () => { settingsToForm(); renderPrefs(); $('modal-settings').classList.add('show'); });

// Look & sound — personal preferences, applied instantly (not table rules).
const FELTS = ['green', 'burgundy', 'midnight', 'purple'];
function currentFelt() {
  const f = document.documentElement.getAttribute('data-felt');
  return FELTS.includes(f) ? f : 'green';
}
function setFelt(f) {
  if (!FELTS.includes(f)) f = 'green';
  document.documentElement.setAttribute('data-felt', f);
  try { localStorage.setItem('bidwhist.felt', f); } catch (_) { /* ignore */ }
  renderPrefs();
}
function renderPrefs() {
  const f = currentFelt();
  for (const b of document.querySelectorAll('.felt-pick')) {
    const on = b.dataset.felt === f;
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  }
  $('pref-sound').checked = Sound.on;
  $('pref-coach').checked = coachOn();
  $('pref-big').checked = document.documentElement.getAttribute('data-cards') === 'big';
  $('pref-four').checked = document.documentElement.getAttribute('data-deck') === 'four';
  $('pref-notify-row').hidden = !TurnAlert.supported;
  $('pref-notify').checked = TurnAlert.on();
  const sb = $('btn-sound');
  sb.textContent = Sound.on ? 'Sound On' : 'Sound Off';
  sb.setAttribute('aria-pressed', String(Sound.on));
}
for (const b of document.querySelectorAll('.felt-pick')) b.addEventListener('click', () => setFelt(b.dataset.felt));
const prefToggle = (id, key, attr, val) => $(id).addEventListener('change', (e) => {
  try { localStorage.setItem(key, e.target.checked ? 'on' : 'off'); } catch (_) { /* ignore */ }
  if (attr) {
    if (e.target.checked) document.documentElement.setAttribute(attr, val);
    else document.documentElement.removeAttribute(attr);
  }
  renderHand();
  if (G.view && !Online.watching) setupTurn(G.view); // refresh coach marks
});
prefToggle('pref-coach', 'bidwhist.coach', null);
prefToggle('pref-big', 'bidwhist.bigCards', 'data-cards', 'big');
prefToggle('pref-four', 'bidwhist.fourColor', 'data-deck', 'four');
$('pref-notify').addEventListener('change', async (e) => { e.target.checked = await TurnAlert.enable(e.target.checked); });

// Table tools.
buildReactMenu();
$('btn-react').addEventListener('click', (e) => { e.stopPropagation(); toggleReactMenu(); });
document.addEventListener('click', (e) => { if (!e.target.closest('#table-tools')) toggleReactMenu(false); });
$('btn-last-book').addEventListener('click', showLastBook);
$('btn-lastbook-done').addEventListener('click', () => $('modal-lastbook').classList.remove('show'));
$('btn-review-hand').addEventListener('click', () => openReview(G.reviewTricks));
$('btn-review-prev').addEventListener('click', () => stepReview(-1));
$('btn-review-next').addEventListener('click', () => stepReview(1));
document.addEventListener('keydown', (e) => {
  if (!Review.tricks || !$('modal-lastbook').classList.contains('show')) return;
  if (e.key === 'ArrowLeft') stepReview(-1);
  else if (e.key === 'ArrowRight') stepReview(1);
});
$('btn-renege').addEventListener('click', () => {
  if (Online.conn && confirm('Call a renege on the other team? If nobody reneged, play just goes on.')) Online.conn.send({ type: 'renege' });
});
$('btn-sit').addEventListener('click', () => Online.conn && Online.conn.send({ type: 'sit' }));

// Installable + offline solo: cache the app with a service worker.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ }));
}
$('pref-sound').addEventListener('change', (e) => { Sound.set(e.target.checked); renderPrefs(); if (Sound.on) Sound.play('card'); });
$('btn-sound').addEventListener('click', () => { Sound.set(!Sound.on); renderPrefs(); if (Sound.on) Sound.play('card'); });
renderPrefs();

// Your own nameplate opens the profile editor.
const ownPlate = $('plate-0');
ownPlate.addEventListener('click', () => { if (!$('splash').classList.contains('show') && !Online.watching) openProfileEditor(); });
ownPlate.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfileEditor(); } });
$('btn-settings-done').addEventListener('click', () => { formToSettings(); $('modal-settings').classList.remove('show'); });

// Profile editor wiring.
$('btn-profile').addEventListener('click', openProfileEditor);
$('btn-edit-profile').addEventListener('click', openProfileEditor);
$('btn-lobby-profile').addEventListener('click', openProfileEditor);
$('splash-profile').addEventListener('click', openProfileEditor);
$('btn-profile-cancel').addEventListener('click', () => $('modal-profile').classList.remove('show'));
$('btn-profile-save').addEventListener('click', saveProfileFromEditor);
$('btn-upload-avatar').addEventListener('click', () => $('avatar-file').click());
$('btn-shuffle-avatar').addEventListener('click', () => { editorCartoon = randomCartoon(); editorImg = null; refreshProfilePreview(); });
$('avatar-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  $('profile-error').textContent = '';
  try { editorImg = await processAvatarFile(file); editorCartoon = null; refreshProfilePreview(); }
  catch (_) { $('profile-error').textContent = "Couldn't read that photo. Try a JPG or PNG (or take a screenshot of it)."; }
  e.target.value = '';
});
$('btn-rules').addEventListener('click', () => $('modal-howto').classList.add('show'));
$('btn-learn').addEventListener('click', startTutorial);
const learnFromHowto = (n) => {
  if (G.mode === 'online' && G.running && !confirm('Leave this online table to play a guided hand?')) return;
  if (G.mode === 'online' && Online.conn) { try { Online.conn.close(); } catch (_) { /* ignore */ } }
  startTutorial(n);
};
$('btn-howto-learn').addEventListener('click', () => learnFromHowto(1));
$('btn-howto-learn2').addEventListener('click', () => learnFromHowto(2));
$('btn-lesson-exit').addEventListener('click', exitTutorial);
$('btn-howto-done').addEventListener('click', () => $('modal-howto').classList.remove('show'));

renderScores();
renderTools();
renderPlates(); // show the profile + AI avatars before the first deal
renderSplashProfile();
renderRejoin();
actionHint('Waiting on the deal…');
handleDeepLink(); // if opened from an invite link, jump to the join panel
