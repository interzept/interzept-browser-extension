// Content script (isolated world). Sends the enabled response-override rules to
// inject.js, which runs in the page itself and wraps fetch and XMLHttpRequest.

const RULES_KEY = 'interzept-rules';
const ENABLED_KEY = 'interzept-enabled';

function publish(data) {
  const enabled = data[ENABLED_KEY] !== false;
  const rules = Array.isArray(data[RULES_KEY]) ? data[RULES_KEY] : [];
  const overrides = enabled
    ? rules
        .filter((r) => r && r.enabled && r.type === 'overrides' && r.source && r.source.trim())
        .map((r) => ({
          source: r.source.trim(),
          status: Number(r.responseCode) || 200,
          body: r.responseBody || '',
          headers: r.responseHeaders || [],
        }))
    : [];
  window.postMessage({ __interzept: 'rules', overrides }, '*');
}

chrome.storage.local.get([RULES_KEY, ENABLED_KEY]).then(publish);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[RULES_KEY] || changes[ENABLED_KEY])) {
    chrome.storage.local.get([RULES_KEY, ENABLED_KEY]).then(publish);
  }
});
