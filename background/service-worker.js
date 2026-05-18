'use strict';

// ---------------------------------------------------------------------------
// State — loaded from storage on every service-worker wake-up
// ---------------------------------------------------------------------------
let state = { globalEnabled: false, enabledTabs: [], skipDarkPages: true, excludedUrls: [], applyBrightnessToAll: false, globalBrightness: 1 };

// Per-tab brightness — keyed by tabId (string), stored in session storage so
// it survives page reloads but is cleared when the browser restarts.
let tabBrightness = {}; // { [tabId]: number (0.1–1.0) }

// Resolve before handling any message so state is always fresh
const stateReady = Promise.all([
  chrome.storage.local.get(['globalEnabled', 'enabledTabs', 'skipDarkPages', 'excludedUrls', 'applyBrightnessToAll', 'globalBrightness']),
  chrome.storage.session.get(['tabBrightness'])
]).then(([localData, sessionData]) => {
  state.globalEnabled = !!localData.globalEnabled;
  state.enabledTabs = Array.isArray(localData.enabledTabs) ? localData.enabledTabs : [];
  state.skipDarkPages = localData.skipDarkPages !== false;
  state.excludedUrls = Array.isArray(localData.excludedUrls) ? localData.excludedUrls : [];
  state.applyBrightnessToAll = !!localData.applyBrightnessToAll;
  state.globalBrightness = typeof localData.globalBrightness === 'number' ? localData.globalBrightness : 1;
  tabBrightness = sessionData.tabBrightness || {};
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
    excludedUrls: [...state.excludedUrls],
    applyBrightnessToAll: state.applyBrightnessToAll,
    globalBrightness: state.globalBrightness
  });
}

function broadcastBrightness(brightness) {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'applyBrightness', brightness }).catch(() => {});
    }
  });
}

function effectiveBrightnessForTab(tabId) {
  const perTab = tabBrightness[tabId];
  if (perTab !== undefined) return perTab;
  if (state.applyBrightnessToAll) return state.globalBrightness;
  return 1;
}

function persistBrightness() {
  chrome.storage.session.set({ tabBrightness });
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

    // Content script asking for its tab's brightness value
    case 'getBrightness': {
      const tabId = sender.tab?.id;
      sendResponse({ brightness: effectiveBrightnessForTab(tabId) });
      break;
    }

    // Popup setting brightness — applies globally if "Apply to all tabs" is on,
    // otherwise just to the active tab.
    case 'setBrightness': {
      const { tabId, brightness } = msg;
      if (state.applyBrightnessToAll) {
        state.globalBrightness = brightness;
        // Per-tab overrides should not override the global slider in this mode
        tabBrightness = {};
        persist();
        persistBrightness();
        broadcastBrightness(brightness);
      } else {
        if (brightness >= 1) {
          delete tabBrightness[tabId];
        } else {
          tabBrightness[tabId] = brightness;
        }
        persistBrightness();
        chrome.tabs.sendMessage(tabId, { type: 'applyBrightness', brightness }).catch(() => {});
      }
      sendResponse({ ok: true });
      break;
    }

    // Popup toggling the "Apply brightness to all tabs" mode
    case 'setBrightnessApplyAll': {
      state.applyBrightnessToAll = !!msg.enabled;
      if (state.applyBrightnessToAll) {
        if (typeof msg.brightness === 'number') {
          state.globalBrightness = msg.brightness;
        }
        tabBrightness = {};
        persistBrightness();
        broadcastBrightness(state.globalBrightness);
      }
      persist();
      sendResponse({ ok: true, applyBrightnessToAll: state.applyBrightnessToAll });
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
          brightness: effectiveBrightnessForTab(tabId),
          applyBrightnessToAll: state.applyBrightnessToAll,
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
// Push brightness to a tab when it becomes active.
//
// When "Apply to all tabs" is on, a tab that was in the background may have
// missed the broadcast (e.g. it was discarded, was loading at the time, or
// the message hit before its onMessage listener registered). Re-pushing on
// activation keeps the active tab in sync with the current global brightness.
// ---------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(({ tabId }) => {
  stateReady.then(() => {
    const brightness = effectiveBrightnessForTab(tabId);
    chrome.tabs.sendMessage(tabId, { type: 'applyBrightness', brightness }).catch(() => {});
  });
});

// Also push when a tab finishes loading — covers new tabs and navigations,
// since the content script's onMessage listener is reliably registered by then.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  stateReady.then(() => {
    const brightness = effectiveBrightnessForTab(tabId);
    chrome.tabs.sendMessage(tabId, { type: 'applyBrightness', brightness }).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Cleanup — remove closed tabs from the per-tab list
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(tabId => {
  stateReady.then(() => {
    const before = state.enabledTabs.length;
    state.enabledTabs = state.enabledTabs.filter(id => id !== tabId);
    if (state.enabledTabs.length !== before) persist();

    if (tabBrightness[tabId] !== undefined) {
      delete tabBrightness[tabId];
      persistBrightness();
    }
  });
});
