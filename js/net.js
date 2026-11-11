/* Bid Whist networking — thin transport only. The online game controller lives
 * in js/app/play.js and uses this to talk to the Cloudflare Worker backend. */
(function () {
  'use strict';

  // Older versions saved a custom server URL; it's no longer used.
  try { localStorage.removeItem('bidwhist.server'); localStorage.removeItem('bidwhist.serverUrl'); } catch (_) { /* ignore */ }

  const clean = (u) => String(u || '').trim().replace(/\/$/, '');

  // The game and the server are one Worker, so the page's own origin IS the
  // server. window.BIDWHIST_SERVER overrides that only if the page is hosted
  // somewhere else.
  function serverBase() {
    if (window.BIDWHIST_SERVER) return clean(window.BIDWHIST_SERVER);
    if (/^https?:$/.test(location.protocol)) return location.origin;
    return '';
  }

  function wsUrl(base, code) {
    const u = base.replace(/^http/, 'ws');
    return `${u}/api/room/${encodeURIComponent(code)}/ws`;
  }

  // Ask the server for a fresh room code (host flow).
  async function newCode(base) {
    const res = await fetch(base + '/api/new', { method: 'POST' });
    if (!res.ok) throw new Error('server returned ' + res.status);
    const data = await res.json();
    return data.code;
  }

  // Open a room socket. Handlers: {onOpen, onMessage(obj), onClose, onError}.
  // Returns { send(obj), close() }. Auto-reconnect is left to the caller.
  function connect(base, code, handlers) {
    const ws = new WebSocket(wsUrl(base, code));
    ws.addEventListener('open', () => handlers.onOpen && handlers.onOpen());
    ws.addEventListener('message', (ev) => {
      let obj; try { obj = JSON.parse(ev.data); } catch (_) { return; }
      handlers.onMessage && handlers.onMessage(obj);
    });
    ws.addEventListener('close', () => handlers.onClose && handlers.onClose());
    ws.addEventListener('error', (e) => handlers.onError && handlers.onError(e));
    return {
      send(obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
      close() { try { ws.close(); } catch (_) { /* ignore */ } },
      raw: ws,
    };
  }

  window.Net = { serverBase, newCode, connect };
})();
