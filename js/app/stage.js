/* Give Me Da Kitty — stage.js
 * The holiday start screen: a full-bleed animated scene (drawn live on a
 * canvas, so it plays like a video but loads instantly and fits any screen)
 * with big headline type, for federal holidays and fun days alike.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// Layout: on wide screens the scene fills the left of the start screen and
// the menu card sits on the right; on phones the scene fills the top and the
// card overlaps its bottom edge. The scene pauses whenever the start screen is
// hidden or the tab isn't visible, and "reduce motion" gets a still frame.
const Stage = { item: null, scene: null };

function buildStage(item, also) {
  removeStage();
  if (!item) return;
  Stage.item = item;
  const splash = $('splash');
  splash.classList.add('has-stage');
  const stage = document.createElement('section');
  stage.className = 'hol holiday-stage';
  stage.setAttribute('aria-label', item.name);
  const when = item.when || item.date(new Date().getFullYear());
  const eyebrow = item.kind === 'fun' ? 'Today is' : (item.solemn ? 'Today we honor' : 'Happy holidays from the table');
  stage.innerHTML = `
    <canvas class="stage-canvas" aria-hidden="true"></canvas>
    <div class="stage-shade" aria-hidden="true"></div>
    <div class="stage-copy">
      <p class="stage-eyebrow"></p>
      <h2 class="stage-title"></h2>
      <p class="stage-line"></p>
      <div class="stage-meta"></div>
    </div>`;
  stage.querySelector('.stage-eyebrow').textContent = `${eyebrow} · ${when.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}`;
  stage.querySelector('.stage-title').textContent = item.kind === 'fun' ? item.name : item.greeting;
  stage.querySelector('.stage-line').textContent = item.line || '';
  const meta = stage.querySelector('.stage-meta');
  for (const a of (also || []).slice(0, 3)) {
    const chip = document.createElement('span');
    chip.className = 'stage-chip';
    chip.textContent = `Also today · ${a.emblem} ${a.kind === 'fun' ? a.name : a.name.replace(/ Day$/, '') + (a.when && a.when.toDateString() !== new Date().toDateString() ? ' season' : '')}`;
    meta.appendChild(chip);
  }
  splash.insertBefore(stage, splash.querySelector('.splash-card'));
  stage.style.setProperty('--st-a', item.palette[0]);
  stage.style.setProperty('--st-b', item.palette[2] || item.palette[1]);
  Stage.scene = createScene(stage.querySelector('.stage-canvas'), item, () => splash.classList.contains('show'));
}

function removeStage() {
  if (Stage.scene) Stage.scene.stop();
  Stage.scene = null; Stage.item = null;
  const s = document.querySelector('.holiday-stage');
  if (s) s.remove();
  $('splash').classList.remove('has-stage');
}

// ---- the scene ----------------------------------------------------------------
function createScene(canvas, item, visible) {
  const ctx = canvas.getContext('2d');
  const pal = item.palette;
  const calm = reduceMotion();
  let W = 0, H = 0, dpr = 1, raf = 0, timer = 0, running = true, t0 = performance.now(), last = t0;
  const parts = [];
  const R = (a, b) => a + Math.random() * (b - a);
  const P = (a) => a[Math.floor(Math.random() * a.length)];
  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const emojiFont = (px) => `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  const pieces = (item.pieces && item.pieces.length ? item.pieces : item.emoji || [item.emblem]).filter(Boolean);

  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }
  const area = () => (W * H) / (900 * 700);

  // Populate the effect for this size.
  function seed() {
    parts.length = 0;
    const k = Math.max(0.35, Math.min(1.6, area()));
    if (item.fx === 'snow') {
      for (let i = 0; i < 160 * k; i++) parts.push({ x: R(0, W), y: R(0, H), z: R(0.2, 1), s: R(0, 6.28) });
      for (let i = 0; i < 16 * k; i++) parts.push({ bokeh: true, x: R(0, W), y: R(0, H * 0.7), r: R(14, 44), c: P(pal), s: R(0, 6.28) });
    } else if (item.fx === 'stars' || item.fx === 'fireworks') {
      for (let i = 0; i < 140 * k; i++) parts.push({ star: true, x: R(0, W), y: R(0, H), r: R(0.4, 1.8), s: R(0, 6.28), sp: R(0.6, 2) });
    } else if (item.fx === 'leaves') {
      for (let i = 0; i < 26 * k; i++) parts.push({ x: R(0, W), y: R(-H, H), z: R(0.4, 1), rot: R(0, 6.28), vr: R(-1.2, 1.2), e: P(['🍂', '🍁', '🍂', '🍃']), s: R(0, 6.28) });
    } else if (item.fx === 'bubbles') {
      for (let i = 0; i < 38 * k; i++) parts.push({ x: R(0, W), y: R(0, H * 1.2), r: R(6, 34), v: R(14, 46), s: R(0, 6.28) });
    } else if (item.fx === 'float') {
      for (let i = 0; i < 22 * k; i++) parts.push({ x: R(0, W), y: R(0, H * 1.2), z: R(0.45, 1), e: P(pieces), s: R(0, 6.28), rot: R(-0.4, 0.4) });
    } else if (item.fx === 'confetti') {
      for (let i = 0; i < 140 * k; i++) parts.push({ x: R(0, W), y: R(-H, H), w: R(6, 12), h: R(9, 18), c: P(pal), rot: R(0, 6.28), vr: R(-4, 4), flip: R(0, 6.28), v: R(50, 120), s: R(0, 6.28) });
    } else if (item.fx === 'rain') {
      for (let i = 0; i < 160 * k; i++) parts.push({ x: R(0, W), y: R(0, H), l: R(10, 22), v: R(380, 620) });
      for (let i = 0; i < 6 * k; i++) parts.push({ umb: true, x: R(0, W), y: R(0, H), z: R(0.5, 1), e: P(['☂️', '🌂', '☔']), s: R(0, 6.28) });
    }
  }

  // Background: a dark base with three slow-drifting glows in the palette (an "aurora").
  function background(t) {
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#120a10'); g.addColorStop(1, '#070405');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = t * (0.05 + i * 0.02) + i * 2.1;
      const cx = W * (0.5 + 0.35 * Math.cos(a)), cy = H * (0.45 + 0.3 * Math.sin(a * 1.3));
      const rr = Math.max(W, H) * (0.55 + 0.1 * i);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      rg.addColorStop(0, hexA(pal[i % pal.length], item.solemn ? 0.16 : 0.24));
      rg.addColorStop(1, hexA(pal[i % pal.length], 0));
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // The emblem: a big emoji with a halo, slowly breathing (a Ken Burns-style move).
  function emblem(t) {
    // Wide: big, up and to the right of the headline. Phone: above the headline, clear of it.
    const wide = W > 700;
    const base = wide ? Math.min(W, H) * 0.3 : Math.min(W * 0.36, H * 0.24);
    const breathe = calm ? 1 : 1 + 0.035 * Math.sin(t * 0.9);
    const cx = W * (wide ? 0.62 : 0.5), cy = H * (wide ? 0.38 : 0.21) + (calm ? 0 : Math.sin(t * 0.7) * 6);
    const halo = ctx.createRadialGradient(cx, cy, base * 0.1, cx, cy, base * 1.25);
    halo.addColorStop(0, hexA(pal[0], 0.45)); halo.addColorStop(0.5, hexA(pal[1 % pal.length], 0.12)); halo.addColorStop(1, hexA(pal[0], 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, base * 1.25, 0, 6.29); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(calm ? 0 : Math.sin(t * 0.5) * 0.05); ctx.scale(breathe, breathe);
    ctx.font = emojiFont(Math.round(base)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = item.stageEmblem || item.emblem;
    ctx.shadowColor = hexA(pal[0], 0.7); ctx.shadowBlur = 28;
    ctx.fillText(glyph, 0, 0);          // glow pass
    ctx.shadowBlur = 0;
    ctx.fillText(glyph, 0, 0);          // crisp pass on top
    ctx.restore();
  }

  // ---- effects ----
  const rockets = [], sparks = [];
  let nextRocket = 0;
  function fireworks(t, dt) {
    if (!calm && t > nextRocket) {
      rockets.push({ x: R(W * 0.12, W * 0.88), y: H + 10, vx: R(-30, 30), vy: -R(H * 0.95, H * 1.25), c: P(pal.filter((c) => c !== '#1d1d1d')) || '#fff', ty: R(H * 0.12, H * 0.45) });
      nextRocket = t + R(0.45, 1.1);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 260 * dt;
      ctx.strokeStyle = hexA(r.c, 0.9); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.vx * 0.04, r.y - r.vy * 0.04); ctx.stroke();
      if (r.y <= r.ty || r.vy >= 0) {
        const n = Math.round(R(60, 95)), sp = R(140, 260);
        const ring = Math.random() < 0.3;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * 6.283 + R(-0.05, 0.05), v = ring ? sp : sp * R(0.3, 1);
          sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: R(0.45, 0.8), c: Math.random() < 0.2 ? '#ffffff' : r.c });
        }
        rockets.splice(i, 1);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vx *= 1 - 1.4 * dt; s.vy *= 1 - 1.4 * dt; s.vy += 70 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= s.decay * dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.fillStyle = hexA(s.c, Math.min(1, s.life * 1.2));
      ctx.beginPath(); ctx.arc(s.x, s.y, 1.2 + s.life * 1.8, 0, 6.29); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function step(t, dt) {
    background(t);
    // Stars first (behind everything), then the emblem, then the foreground effect.
    for (const p of parts) if (p.star) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * p.sp + p.s));
      ctx.fillStyle = `rgba(255,248,230,${(calm ? 0.6 : a).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
    }
    if (item.fx === 'stars' && !calm) shootingStar(t);
    emblem(t);
    if (item.fx === 'fireworks') fireworks(t, dt);
    for (const p of parts) {
      if (p.star) continue;
      if (item.fx === 'snow') {
        if (p.bokeh) {
          const a = 0.1 + 0.12 * Math.abs(Math.sin(t * 0.6 + p.s));
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, hexA(p.c, a)); g.addColorStop(1, hexA(p.c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          continue;
        }
        if (!calm) { p.y += (18 + 52 * p.z) * dt; p.x += Math.sin(t * 0.8 + p.s) * 14 * p.z * dt; if (p.y > H + 6) { p.y = -6; p.x = R(0, W); } }
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.6 * p.z).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.8 + 2.6 * p.z, 0, 6.29); ctx.fill();
      } else if (item.fx === 'leaves') {
        if (!calm) { p.y += (30 + 50 * p.z) * dt; p.x += Math.sin(t * 0.9 + p.s) * 40 * dt + 12 * dt; p.rot += p.vr * dt; if (p.y > H + 30) { p.y = -30; p.x = R(-20, W); } }
        drawEmoji(p.e, p.x, p.y, 16 + 22 * p.z, p.rot, 0.55 + 0.45 * p.z);
      } else if (item.fx === 'bubbles') {
        if (!calm) { p.y -= p.v * dt; p.x += Math.sin(t * 1.2 + p.s) * 16 * dt; if (p.y < -p.r * 2) { p.y = H + p.r * 2; p.x = R(0, W); } }
        bubble(p, t);
      } else if (item.fx === 'float') {
        if (!calm) { p.y -= (18 + 30 * p.z) * dt; p.x += Math.sin(t * 0.7 + p.s) * 18 * dt; if (p.y < -60) { p.y = H + 60; p.x = R(0, W); } }
        drawEmoji(p.e, p.x, p.y, 18 + 30 * p.z, p.rot + Math.sin(t + p.s) * 0.15, 0.35 + 0.55 * p.z);
      } else if (item.fx === 'confetti') {
        if (!calm) { p.y += p.v * dt; p.x += Math.sin(t * 1.4 + p.s) * 30 * dt; p.rot += p.vr * dt; p.flip += 5 * dt; if (p.y > H + 20) { p.y = -20; p.x = R(0, W); } }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      } else if (item.fx === 'rain') {
        if (p.umb) {
          if (!calm) { p.y -= 22 * p.z * dt; p.x += Math.sin(t * 0.8 + p.s) * 20 * dt; if (p.y < -60) { p.y = H + 60; p.x = R(0, W); } }
          drawEmoji(p.e, p.x, p.y, 30 + 26 * p.z, Math.sin(t + p.s) * 0.2, 0.9);
          continue;
        }
        if (!calm) { p.y += p.v * dt; p.x -= p.v * 0.18 * dt; if (p.y > H) { p.y = -p.l; p.x = R(0, W * 1.2); } }
        ctx.strokeStyle = 'rgba(190,220,255,.45)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * 0.18, p.y - p.l); ctx.stroke();
      }
    }
  }

  let shoot = null, nextShoot = 2;
  function shootingStar(t) {
    if (!shoot && t > nextShoot) { shoot = { x: R(W * 0.2, W), y: R(0, H * 0.4), t: t }; nextShoot = t + R(3, 7); }
    if (!shoot) return;
    const k = (t - shoot.t) / 0.9;
    if (k > 1) { shoot = null; return; }
    const x = shoot.x - k * W * 0.45, y = shoot.y + k * H * 0.25;
    const g = ctx.createLinearGradient(x, y, x + 120, y - 66);
    g.addColorStop(0, `rgba(255,255,255,${(1 - k).toFixed(2)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 120, y - 66); ctx.stroke();
  }

  function bubble(p, t) {
    const g = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
    g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.7, 'rgba(255,255,255,.04)'); g.addColorStop(1, hexA(pal[Math.floor(p.s * 10) % pal.length], 0.5));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
    ctx.strokeStyle = hexA(pal[(Math.floor(t + p.s * 3)) % pal.length], 0.55); ctx.lineWidth = 1.2; ctx.stroke();
  }

  function drawEmoji(e, x, y, px, rot, alpha) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.font = emojiFont(Math.round(px)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(e, 0, 0); ctx.restore();
  }

  function frame(now) {
    if (!running) return;
    if (!visible() || document.hidden) { timer = setTimeout(() => { last = performance.now(); raf = requestAnimationFrame(frame); }, 400); return; }
    const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(t, dt);
    raf = requestAnimationFrame(frame);
  }

  const onResize = () => size();
  window.addEventListener('resize', onResize);
  size();
  if (calm) step(3, 0);   // one still frame
  else raf = requestAnimationFrame(frame);
  return {
    stop() { running = false; cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener('resize', onResize); },
  };
}
