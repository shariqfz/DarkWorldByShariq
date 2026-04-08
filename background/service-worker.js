'use strict';

// ---------------------------------------------------------------------------
// State — loaded from storage on every service-worker wake-up
// ---------------------------------------------------------------------------
let state = { globalEnabled: false, enabledTabs: [], skipDarkPages: true, excludedUrls: [] };

// Resolve before handling any message so state is always fresh
const stateReady = chrome.storage.local
  .get(['globalEnabled', 'enabledTabs', 'skipDarkPages', 'excludedUrls'])
  .then(data => {
    state.globalEnabled = !!data.globalEnabled;
    state.enabledTabs = Array.isArray(data.enabledTabs) ? data.enabledTabs : [];
    // Default true — skip pages that already have a dark background
    state.skipDarkPages = data.skipDarkPages !== false;
    state.excludedUrls = Array.isArray(data.excludedUrls) ? data.excludedUrls : [];
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function isTabEnabled(tabId) {
  return state.enabledTabs.includes(tabId);
}

function isUrlExcluded(url) {
  if (!url) return false;
  return state.excludedUrls.includes(normalizeUrl(url));
}

function isDarkModeOn(tabId, url) {
  if (state.globalEnabled && !isUrlExcluded(url)) return true;
  return isTabEnabled(tabId);
}

function persist() {
  chrome.storage.local.set({
    globalEnabled: state.globalEnabled,
    enabledTabs: [...state.enabledTabs],
    skipDarkPages: state.skipDarkPages,
    excludedUrls: [...state.excludedUrls]
  });
}

function sendToTab(tabId, enabled) {
  chrome.tabs.sendMessage(tabId, { type: 'setDarkMode', enabled }).catch(() => {
    // Tab may not have a content script (e.g. chrome:// pages) — ignore
  });
}

function applyToAllTabs() {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      sendToTab(tab.id, isDarkModeOn(tab.id, tab.url));
    }
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
function handleMessage(msg, sender, sendResponse) {
  switch (msg.type) {

    // Content script asking "should I be dark right now?"
    case 'checkDarkMode': {
      const tabId = sender.tab?.id;
      const tabUrl = sender.tab?.url;
      sendResponse({ enabled: isDarkModeOn(tabId, tabUrl) });
      break;
    }

    // Popup asking for full state of the active tab
    case 'getState': {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        const tabId = tab?.id;
        const tabUrl = tab?.url;
        sendResponse({
          globalEnabled: state.globalEnabled,
          tabEnabled: isTabEnabled(tabId),
          darkModeOn: isDarkModeOn(tabId, tabUrl),
          skipDarkPages: state.skipDarkPages,
          excludedByUrl: isUrlExcluded(tabUrl),
          tabId,
          tabUrl
        });
      });
      // Response sent inside the async callback above — channel kept open by
      // the outer `return true` in the addListener wrapper
      break;
    }

    // Popup toggling global dark mode
    case 'setGlobal': {
      state.globalEnabled = msg.enabled;
      persist();
      applyToAllTabs();
      sendResponse({ ok: true, globalEnabled: state.globalEnabled });
      break;
    }

    // Popup toggling the "skip already-dark pages" setting
    case 'setSkipDarkPages': {
      state.skipDarkPages = msg.enabled;
      persist();
      sendResponse({ ok: true, skipDarkPages: state.skipDarkPages });
      break;
    }

    // Popup toggling "not this page" exclusion
    case 'setExclude': {
      const { url, excluded } = msg;
      const normalized = normalizeUrl(url);
      if (excluded && !state.excludedUrls.includes(normalized)) {
        state.excludedUrls.push(normalized);
      } else if (!excluded) {
        state.excludedUrls = state.excludedUrls.filter(u => u !== normalized);
      }
      persist();
      // Re-apply to the active tab immediately
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs[0];
        if (tab) sendToTab(tab.id, isDarkModeOn(tab.id, tab.url));
      });
      sendResponse({ ok: true, excludedByUrl: isUrlExcluded(url) });
      break;
    }

    // Popup toggling dark mode for one specific tab
    case 'setTab': {
      const { tabId, enabled } = msg;
      if (enabled && !state.enabledTabs.includes(tabId)) {
        state.enabledTabs.push(tabId);
      } else if (!enabled) {
        state.enabledTabs = state.enabledTabs.filter(id => id !== tabId);
      }
      persist();
      chrome.tabs.get(tabId, tab => {
        sendToTab(tabId, isDarkModeOn(tabId, tab?.url));
      });
      sendResponse({ ok: true, tabEnabled: isTabEnabled(tabId) });
      break;
    }
  }
}

// Wrap every message handler behind stateReady so state is always loaded
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  stateReady.then(() => handleMessage(msg, sender, sendResponse));
  return true; // Keep the response channel open for async replies
});

// ---------------------------------------------------------------------------
// Cleanup — remove closed tabs from the per-tab list
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(tabId => {
  stateReady.then(() => {
    const before = state.enabledTabs.length;
    state.enabledTabs = state.enabledTabs.filter(id => id !== tabId);
    if (state.enabledTabs.length !== before) persist();
  });
});
