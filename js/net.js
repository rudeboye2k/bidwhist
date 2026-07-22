/* Bid Whist networking — thin transport only. The online game controller lives
 * in app.js and uses this to talk to the Cloudflare Worker backend. */
(function () {
  'use strict';

  const SERVER_KEY = 'bidwhist.server';

  // Resolve the backend base URL: explicit global override, else saved value.
  function serverBase() {
    if (window.BIDWHIST_SERVER) return String(window.BIDWHIST_SERVER).replace(/\/$/, '');
    try { return (localStorage.getItem(SERVER_KEY) || '').replace(/\/$/, ''); } catch (_) { return ''; }
  }
  function saveServer(url) {
    try { localStorage.setItem(SERVER_KEY, String(url || '').replace(/\/$/, '')); } catch (_) { /* ignore */ }
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

  window.Net = { serverBase, saveServer, newCode, connect };
})();
