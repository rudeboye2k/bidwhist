/* Bid Whist networking — thin transport only. The online game controller lives
 * in app.js and uses this to talk to the Cloudflare Worker backend. */
(function () {
  'use strict';

  // v2 key: the old 'bidwhist.server' could hold a URL that never existed, so
  // it's discarded rather than trusted.
  const SERVER_KEY = 'bidwhist.serverUrl';
  try { localStorage.removeItem('bidwhist.server'); } catch (_) { /* ignore */ }

  const clean = (u) => String(u || '').trim().replace(/\/$/, '');

  // The game and the server are one Worker, so the page's own origin IS the
  // server. An explicit window.BIDWHIST_SERVER overrides that (e.g. if the
  // site is hosted somewhere else, like GitHub Pages).
  function defaultServer() {
    if (window.BIDWHIST_SERVER) return clean(window.BIDWHIST_SERVER);
    if (/^https?:$/.test(location.protocol)) return location.origin;
    return '';
  }

  // A custom URL the player typed wins; otherwise the default.
  function serverBase() {
    try {
      const s = clean(localStorage.getItem(SERVER_KEY));
      if (s) return s;
    } catch (_) { /* ignore */ }
    return defaultServer();
  }
  // Only remember a URL that differs from the default, so the default can
  // change later without a stale value pinning old browsers to it.
  function saveServer(url) {
    const u = clean(url);
    try {
      if (!u || u === defaultServer()) localStorage.removeItem(SERVER_KEY);
      else localStorage.setItem(SERVER_KEY, u);
    } catch (_) { /* ignore */ }
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

  window.Net = { serverBase, defaultServer, saveServer, newCode, connect };
})();
