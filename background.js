// Background service worker for Interzept.
// Turns the rules saved by the options page into live browser rules:
// - "redirect" rules and "headers" rules become declarativeNetRequest dynamic rules.
// - "overrides" rules are applied in the page by inject.js (fetch and XMLHttpRequest),
//   because declarativeNetRequest cannot replace a response body.

const RULES_KEY = 'interzept-rules';
const ENABLED_KEY = 'interzept-enabled';

// Headers that only make sense on the response (CORS, caching, cookies, security policy).
const RESPONSE_HEADERS = /^(access-control-|set-cookie$|cache-control$|content-security-policy|x-frame-options$|expires$|etag$|vary$)/i;

// Turn a pattern like https://api.example.com/* into an RE2 regex for declarativeNetRequest.
function patternToRegex(pattern) {
  return '^' + pattern.trim().split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
}

function headerOps(headers, side) {
  return (headers || [])
    .filter((h) => h && h.name && h.name.trim())
    .filter((h) => (side === 'response') === RESPONSE_HEADERS.test(h.name.trim()))
    .map((h) =>
      h.operation === 'remove'
        ? { header: h.name.trim(), operation: 'remove' }
        : { header: h.name.trim(), operation: 'set', value: h.value || '' }
    );
}

function toNetRequestRules(rules) {
  const out = [];
  let id = 1;
  for (const rule of rules) {
    if (!rule || !rule.enabled || !rule.source || !rule.source.trim()) continue;
    const condition = {
      regexFilter: patternToRegex(rule.source),
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'websocket', 'other'],
    };
    if (rule.type === 'redirect' && rule.destination && rule.destination.trim()) {
      out.push({ id: id++, priority: 1, condition, action: { type: 'redirect', redirect: { url: rule.destination.trim() } } });
    } else if (rule.type === 'headers') {
      const requestHeaders = headerOps(rule.headers, 'request');
      const responseHeaders = headerOps(rule.headers, 'response');
      if (!requestHeaders.length && !responseHeaders.length) continue;
      const action = { type: 'modifyHeaders' };
      if (requestHeaders.length) action.requestHeaders = requestHeaders;
      if (responseHeaders.length) action.responseHeaders = responseHeaders;
      out.push({ id: id++, priority: 1, condition, action });
    }
  }
  return out;
}

async function applyRules() {
  const data = await chrome.storage.local.get([RULES_KEY, ENABLED_KEY]);
  const enabled = data[ENABLED_KEY] !== false;
  const rules = Array.isArray(data[RULES_KEY]) ? data[RULES_KEY] : [];
  const next = enabled ? toNetRequestRules(rules) : [];
  const current = await chrome.declarativeNetRequest.getDynamicRules();
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: current.map((r) => r.id),
      addRules: next,
    });
  } catch (error) {
    // One bad rule (for example an invalid regex or redirect URL) should not block the rest.
    console.warn('Interzept: applying rules one by one after an error:', error.message);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: current.map((r) => r.id) });
    for (const r of next) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [r] });
      } catch (e) {
        console.warn('Interzept: skipped a rule:', e.message);
      }
    }
  }
  const active = enabled ? rules.filter((r) => r && r.enabled).length : 0;
  chrome.action.setBadgeBackgroundColor({ color: '#0891b2' });
  chrome.action.setBadgeText({ text: active ? String(active) : '' });
}

chrome.runtime.onInstalled.addListener(applyRules);
chrome.runtime.onStartup.addListener(applyRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[RULES_KEY] || changes[ENABLED_KEY])) applyRules();
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request && request.action === 'openOptions') chrome.runtime.openOptionsPage();
  sendResponse({ success: true });
});

applyRules();
