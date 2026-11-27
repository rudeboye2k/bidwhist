/* Give Me Da Kitty — flyover.js
 * On a federal holiday, the first book of every hand sets off a short
 * animation that crosses the screen: Santa's sleigh at Christmas, fireworks
 * on the Fourth, a strutting turkey at Thanksgiving, and so on.
 * Part of the app (js/app/*.js, loaded in order; they share one scope). */
'use strict';

// Drawn on a full-screen canvas above the table and below dialogs; it never
// takes taps and lasts about four seconds. Days of remembrance (Memorial Day,
// Veterans Day, MLK Day) get slow, quiet versions. "Reduce motion" skips it.
const FLY_MS = 4200;

function holidayFlyover(id) {
  if (reduceMotion() || !FLYOVERS[id]) return Promise.resolve();
  const canvas = document.createElement('canvas');
  canvas.className = 'hol flyover';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const fx = makeFx(ctx, W, H);
  const script = FLYOVERS[id](fx, W, H);
  const start = performance.now();
  return new Promise((done) => {
    let last = start;
    const frame = (now) => {
      const t = (now - start) / 1000, k = (now - start) / FLY_MS, dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, W, H);
      // fade in over the first 8%, out over the last 15%
      ctx.globalAlpha = Math.min(1, k / 0.08, (1 - k) / 0.15);
      script(t, k, dt);
      fx.update(dt);
      ctx.globalAlpha = 1;
      if (k < 1) requestAnimationFrame(frame);
      else { canvas.remove(); done(); }
    };
    requestAnimationFrame(frame);
  });
}

// Small toolkit shared by the scripts: emoji drawing, sparkles, fireworks, confetti.
function makeFx(ctx, W, H) {
  const parts = [];
  const R = (a, b) => a + Math.random() * (b - a);
  const font = (px) => `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  return {
    R, W, H,
    emoji(e, x, y, px, rot, flip, alpha) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); if (flip) ctx.scale(-1, 1);
      if (alpha != null) ctx.globalAlpha *= alpha;
      ctx.font = font(Math.round(px)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
      ctx.fillText(e, 0, 0); ctx.restore();
    },
    sparkle(x, y, color, n) {
      for (let i = 0; i < (n || 2); i++) parts.push({ kind: 'dot', x: x + R(-6, 6), y: y + R(-6, 6), vx: R(-30, 30), vy: R(-20, 40), life: 1, decay: R(0.8, 1.6), r: R(1.5, 3.5), c: color || '#fff5c4' });
    },
    burst(x, y, colors, n, speed) {
      for (let i = 0; i < (n || 80); i++) {
        const a = (i / (n || 80)) * 6.283 + R(-0.05, 0.05), v = (speed || 240) * R(0.35, 1);
        parts.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: R(0.5, 0.9), r: R(1.6, 3), c: colors[i % colors.length], drag: 1.6, g: 80 });
      }
    },
    confetti(x, y, colors, n) {
      for (let i = 0; i < (n || 60); i++) parts.push({ kind: 'paper', x, y, vx: R(-220, 220), vy: R(-420, -120), life: 1, decay: R(0.35, 0.6), w: R(6, 11), h: R(9, 16), c: colors[i % colors.length], rot: R(0, 6.28), vr: R(-8, 8), g: 520 });
    },
    leaf(x, y) { parts.push({ kind: 'emoji', e: Math.random() < 0.5 ? '🍂' : '🍁', x, y, vx: R(120, 320), vy: R(-60, 60), life: 1, decay: R(0.35, 0.6), px: R(16, 30), rot: R(0, 6.28), vr: R(-4, 4), g: 30 }); },
    update(dt) {
      ctx.save();
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= p.decay * dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; }
        p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.vr) p.rot += p.vr * dt;
        if (p.kind === 'dot') {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = p.c.startsWith('#') ? rgba(p.c, Math.min(1, p.life * 1.3)) : p.c;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + p.life * 0.5), 0, 6.29); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
        } else if (p.kind === 'paper') {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 2));
          ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
        } else if (p.kind === 'emoji') {
          ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 2); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.font = font(Math.round(p.px)); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.e, 0, 0); ctx.restore();
        }
      }
      ctx.restore();
    },
  };
}

const ease = (k) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));
// Character size: a share of the smaller side, half again bigger on phones so it reads.
const unit = (W, H) => Math.min(W, H) * (W < 600 ? 1.5 : 1);

// Each script returns a draw(t, k, dt) for the four-second run (k: 0 → 1).
const FLYOVERS = {
  // Santa's sleigh and team arc across the sky, trailing stardust.
  christmas(fx, W, H) {
    const s = unit(W, H) * 0.11;
    return (t, k) => {
      const x = W + s * 6 - ease(k) * (W + s * 12), y = H * 0.32 - Math.sin(k * Math.PI) * H * 0.12 + Math.sin(t * 6) * 4;
      for (let i = 0; i < 4; i++) fx.emoji('🦌', x + i * s * 0.95, y + Math.sin(t * 9 + i) * 5, s, -0.05);
      fx.emoji('🛷', x + s * 4.4, y + s * 0.2, s * 1.15, 0, true);
      fx.emoji('🎅', x + s * 4.3, y - s * 0.35, s * 0.9);
      fx.emoji('🎁', x + s * 4.85, y - s * 0.15, s * 0.5);
      fx.sparkle(x + s * 5.3, y + s * 0.2, Math.random() < 0.5 ? '#fff5c4' : '#ffd6f0', 3);
    };
  },
  // Big fireworks over the table, and a flag-waving eagle.
  july4(fx, W, H) {
    const cols = ['#ff4d4d', '#ffffff', '#4d7dff'];
    let next = 0;
    return (t, k) => {
      if (t > next && k < 0.75) { fx.burst(fx.R(W * 0.15, W * 0.85), fx.R(H * 0.15, H * 0.45), cols, 110, fx.R(220, 320)); next = t + fx.R(0.25, 0.5); }
      const s = unit(W, H) * 0.13;
      fx.emoji('🦅', -s + ease(k) * (W + s * 2), H * 0.55 - Math.sin(k * Math.PI) * H * 0.2, s, Math.sin(t * 5) * 0.08, true);
    };
  },
  juneteenth(fx, W, H) {
    const cols = ['#e0453a', '#2f8f4e', '#f0cd78', '#ffffff'];
    let next = 0;
    return (t, k) => {
      if (t > next && k < 0.75) { fx.burst(fx.R(W * 0.15, W * 0.85), fx.R(H * 0.15, H * 0.45), cols, 100, fx.R(220, 300)); next = t + fx.R(0.3, 0.55); }
      fx.emoji('✊🏾', W / 2, H * 0.8 - ease(k) * H * 0.25, unit(W, H) * 0.16);
    };
  },
  // A champagne pop: the cork flies, confetti rains, glasses clink.
  newyear(fx, W, H) {
    let popped = false;
    const cols = ['#f0cd78', '#ffffff', '#e8c3ff', '#ffd9a0', '#9ad7ff'];
    return (t, k) => {
      const s = unit(W, H) * 0.16;
      fx.emoji('🍾', W * 0.2, H * 0.7, s, -0.5 + Math.min(0.2, t * 0.3));
      if (t > 0.6 && !popped) { popped = true; fx.confetti(W * 0.25, H * 0.6, cols, 140); fx.burst(W * 0.5, H * 0.3, cols, 120, 300); }
      if (t > 1.2) fx.emoji('🥂', W * 0.7, H * 0.55 - Math.sin(t * 4) * 6, s * (0.8 + 0.2 * ease((t - 1.2) * 2)));
    };
  },
  // A turkey struts across the bottom, leaves swirling behind it.
  thanksgiving(fx, W, H) {
    return (t, k) => {
      const s = unit(W, H) * 0.16;
      const x = W + s - ease(k) * (W + s * 2), y = H * 0.72 - Math.abs(Math.sin(t * 7)) * 14;
      fx.emoji('🦃', x, y, s, Math.sin(t * 7) * 0.08);
      if (Math.random() < 0.5) fx.leaf(x + s * 0.5, y + fx.R(-s * 0.4, s * 0.4));
      if (k > 0.3 && k < 0.34) fx.emoji('🥧', W * 0.5, H * 0.4, s * 0.6);
    };
  },
  columbus(fx, W, H) {
    return (t, k) => {
      for (let i = 0; i < 3; i++) fx.leaf(-20, fx.R(H * 0.1, H * 0.9));
      fx.emoji('🍁', ease(k) * W, H * 0.45 + Math.sin(t * 2) * 30, unit(W, H) * 0.14, t * 2);
    };
  },
  // A swooping eagle trailing gold stars.
  presidents(fx, W, H) {
    return (t, k) => {
      const s = unit(W, H) * 0.14, x = -s + ease(k) * (W + s * 2), y = H * 0.35 + Math.sin(k * Math.PI * 2) * H * 0.08;
      fx.emoji('🦅', x, y, s, Math.sin(t * 5) * 0.08, true);
      fx.sparkle(x - s * 0.5, y, '#f0cd78', 2);
    };
  },
  // Cookout parade: the grill's finest march across with sparks.
  labor(fx, W, H) {
    const line = ['🌭', '🍔', '🌽', '🛠️', '🇺🇸'];
    return (t, k) => {
      const s = unit(W, H) * 0.1;
      line.forEach((e, i) => {
        const x = -s + ease(k) * (W + s * 8) - i * s * 1.3, y = H * 0.7 - Math.abs(Math.sin(t * 6 + i)) * 12;
        fx.emoji(e, x, y, s);
      });
    };
  },
  // Quiet days: a slow flock of doves rising (MLK Day).
  mlk(fx, W, H) {
    return (t, k) => {
      const s = unit(W, H) * 0.09;
      for (let i = 0; i < 5; i++) {
        const x = W * (0.2 + i * 0.15) + Math.sin(t * 1.5 + i) * 20, y = H * 0.9 - ease(k * 1.1 - i * 0.04) * H * 0.75;
        fx.emoji('🕊️', x, y, s * (0.8 + (i % 2) * 0.3), Math.sin(t * 2 + i) * 0.1);
      }
    };
  },
  // Flags rising slowly in a line, then a dove (Memorial Day).
  memorial(fx, W, H) {
    return (t, k) => {
      const s = unit(W, H) * 0.08, n = Math.max(5, Math.round(W / (s * 1.6)));
      for (let i = 0; i < n; i++) fx.emoji('🇺🇸', (i + 0.5) * (W / n), H * 0.92 - ease(k * 1.3 - i * 0.03) * H * 0.18, s);
      if (k > 0.35) fx.emoji('🕊️', -s + ease((k - 0.35) / 0.65) * (W + s * 2), H * 0.3, s * 1.2, 0, true);
    };
  },
  // A medal shines and flags wave (Veterans Day).
  veterans(fx, W, H) {
    return (t, k) => {
      const s = unit(W, H) * 0.16;
      fx.emoji('🎖️', W / 2, H * 0.42, s * (0.85 + 0.15 * ease(k * 3)));
      if (Math.random() < 0.3) fx.sparkle(W / 2 + fx.R(-s / 2, s / 2), H * 0.42 + fx.R(-s / 2, s / 2), '#fff5c4', 2);
      fx.emoji('🇺🇸', W * 0.2, H * 0.62 + Math.sin(t * 2) * 4, s * 0.6);
      fx.emoji('🇺🇸', W * 0.8, H * 0.62 + Math.sin(t * 2 + 1) * 4, s * 0.6);
    };
  },
};
