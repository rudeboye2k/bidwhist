/* Give Me Da Kitty — settings.js
 * Profile editor and Table Rules.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// ---- profile editor -------------------------------------------------------

let editorImg = null;      // pending uploaded image data URL
let editorCartoon = null;  // pending cartoon spec (overrides the image)

function openProfileEditor() {
  editorImg = G.profile.avatar;
  editorCartoon = null;
  $('profile-name').value = G.profile.name === 'You' ? '' : G.profile.name;
  $('profile-error').textContent = '';
  refreshProfilePreview();
  $('modal-profile').classList.add('show');
}
function refreshProfilePreview() {
  applyAvatar($('profile-preview'), editorCartoon || avatarFrom(editorImg || G.profile.avatar, 'you#0'));
}
function saveProfileFromEditor() {
  const name = ($('profile-name').value || '').trim().slice(0, 16) || 'You';
  let avatar = G.profile.avatar;
  if (editorCartoon) avatar = editorCartoon.code;
  else if (editorImg) avatar = editorImg;
  G.profile = { name, avatar };
  saveProfile(G.profile);
  $('modal-profile').classList.remove('show');
  renderPlates();
  renderOnlineProfile();
  renderSplashProfile();
  if (Online.conn) Online.conn.send({ type: 'profile', name, avatar });
}

// ---- settings -------------------------------------------------------------

const RULE_CHECKS = ['noTrumpDoubles', 'kittyIsBook', 'forcedDealerBid', 'sportKitty', 'bostonDoubles', 'noJokers', 'ntMinFour', 'renege'];

// Online, only the host edits the rules (everyone sees them).
function rulesLocked() { return G.mode === 'online' && !amHost(); }

function settingsToForm() {
  const f = $('settings-form');
  const r = E.cleanRules(G.nextRules || (G.view && G.mode === 'online' && G.view.rules) || G.rules);
  f.minBid.value = String(r.minBid);
  f.gameTarget.value = String(r.gameTarget);
  for (const k of RULE_CHECKS) f[k].checked = !!r[k];
  f.leadRule.value = r.leadRule;
  f.aiLevel.value = r.aiLevel;
  f.turnTimer.value = String(r.turnTimer);
  const locked = rulesLocked();
  for (const el of f.elements) el.disabled = locked;
  $('rules-lock').hidden = !locked;
  for (const el of document.querySelectorAll('.online-only')) el.hidden = G.mode !== 'online';
}

function formToSettings() {
  if (rulesLocked()) return;
  const f = $('settings-form');
  const r = E.cleanRules({
    minBid: parseInt(f.minBid.value, 10),
    gameTarget: parseInt(f.gameTarget.value, 10),
    leadRule: f.leadRule.value, aiLevel: f.aiLevel.value,
    turnTimer: parseInt(f.turnTimer.value, 10),
    ...Object.fromEntries(RULE_CHECKS.map((k) => [k, f[k].checked])),
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch (_) { /* ignore */ }
  if (!Online.conn) { G.rules = r; renderScores(); return; }
  // Rules change between hands: now if we're between hands, else at the next deal.
  const between = G.view && ['lobby', 'handover', 'gameover'].includes(G.view.phase);
  if (between) { Online.conn.send({ type: 'rules', rules: r }); G.nextRules = null; }
  else { G.nextRules = r; log('Rule changes will apply from the next hand.', true); }
}
