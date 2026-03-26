'use strict';

// ---------------------------------------------------------------------------
// State — loaded from storage on every service-worker wake-up
// ---------------------------------------------------------------------------
let state = { globalEnabled: false, enabledTabs: [], skipDarkPages: true };

// Resolve before handling any message so state is always fresh
const stateReady = chrome.storage.local
  .get(['globalEnabled', 'enabledTabs', 'skipDarkPages'])
  .then(data => {
    state.globalEnabled = !!data.globalEnabled;
    state.enabledTabs = Array.isArray(data.enabledTabs) ? data.enabledTabs : [];
    // Default true — skip pages that already have a dark background
    state.skipDarkPages = data.skipDarkPages !== false;
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isTabEnabled(tabId) {
  return state.enabledTabs.includes(tabId);
}

function isDarkModeOn(tabId) {
  return state.globalEnabled || isTabEnabled(tabId);
}

function persist() {
  chrome.storage.local.set({
    globalEnabled: state.globalEnabled,
    enabledTabs: [...state.enabledTabs],
    skipDarkPages: state.skipDarkPages
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
      sendToTab(tab.id, isDarkModeOn(tab.id));
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
      sendResponse({ enabled: isDarkModeOn(tabId) });
      break;
    }

    // Popup asking for full state of the active tab
    case 'getState': {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tabId = tabs[0]?.id;
        sendResponse({
          globalEnabled: state.globalEnabled,
          tabEnabled: isTabEnabled(tabId),
          darkModeOn: isDarkModeOn(tabId),
          skipDarkPages: state.skipDarkPages,
          tabId
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

    // Popup toggling dark mode for one specific tab
    case 'setTab': {
      const { tabId, enabled } = msg;
      if (enabled && !state.enabledTabs.includes(tabId)) {
        state.enabledTabs.push(tabId);
      } else if (!enabled) {
        state.enabledTabs = state.enabledTabs.filter(id => id !== tabId);
      }
      persist();
      sendToTab(tabId, isDarkModeOn(tabId));
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
