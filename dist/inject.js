// Runs in the page (MAIN world) at document_start. Wraps fetch and XMLHttpRequest so
// requests matching an enabled "Response Override" rule get the rule's status and body
// instead of going to the network. Rules arrive from content.js by postMessage.
(() => {
  if (window.__interzeptInstalled) return;
  window.__interzeptInstalled = true;

  let overrides = [];
  let resolveReady;
  // Requests made before the rules arrive wait briefly, so early calls are not missed.
  const ready = new Promise((resolve) => (resolveReady = resolve));
  setTimeout(() => resolveReady(), 500);

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.__interzept === 'rules') {
      overrides = (event.data.overrides || []).map((o) => ({ ...o, re: toRegex(o.source) }));
      resolveReady();
    }
  });

  function toRegex(pattern) {
    return new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  }

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch { return String(url); }
  }

  function find(url) {
    const href = absolute(url);
    return overrides.find((o) => o.re.test(href));
  }

  function headersOf(o) {
    const h = new Headers();
    let type = 'application/json';
    for (const { name, value } of o.headers || []) {
      if (!name) continue;
      if (name.toLowerCase() === 'content-type') type = value;
      else h.set(name, value);
    }
    h.set('Content-Type', type);
    h.set('X-Interzept', 'override');
    return h;
  }

  // fetch
  const realFetch = window.fetch;
  window.fetch = async function (input, init) {
    await ready;
    const url = input instanceof Request ? input.url : input;
    const o = find(url);
    if (!o) return realFetch.call(this, input, init);
    const nullBody = [101, 204, 205, 304].includes(o.status);
    return new Response(nullBody ? null : o.body, { status: o.status, headers: headersOf(o) });
  };

  // XMLHttpRequest
  const RealXHR = window.XMLHttpRequest;
  const open = RealXHR.prototype.open;
  const send = RealXHR.prototype.send;
  RealXHR.prototype.open = function (method, url, ...rest) {
    this.__interzeptUrl = url;
    return open.call(this, method, url, ...rest);
  };
  RealXHR.prototype.send = function (body) {
    const xhr = this;
    ready.then(() => {
      const o = find(xhr.__interzeptUrl);
      if (!o) return send.call(xhr, body);
      const headers = headersOf(o);
      const define = (k, v) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
      let parsed = o.body;
      if (xhr.responseType === 'json') { try { parsed = JSON.parse(o.body); } catch { parsed = null; } }
      define('readyState', 4);
      define('status', o.status);
      define('statusText', 'OK');
      define('responseURL', absolute(xhr.__interzeptUrl));
      define('responseText', o.body);
      define('response', parsed);
      xhr.getAllResponseHeaders = () => [...headers].map(([k, v]) => `${k}: ${v}`).join('\r\n');
      xhr.getResponseHeader = (name) => headers.get(name);
      setTimeout(() => {
        for (const type of ['readystatechange', 'load', 'loadend']) {
          const event = new Event(type);
          xhr.dispatchEvent(event);
          const handler = xhr['on' + type];
          if (typeof handler === 'function') handler.call(xhr, event);
        }
      }, 0);
    });
  };
})();
