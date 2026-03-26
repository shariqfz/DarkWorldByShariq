'use strict';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const globalToggle    = document.getElementById('globalToggle');
const tabToggle       = document.getElementById('tabToggle');
const skipDarkToggle  = document.getElementById('skipDarkToggle');
const tabRow          = document.getElementById('tabRow');
const globalNote      = document.getElementById('globalNote');
const statusBadge     = document.getElementById('statusBadge');
const statusText      = document.getElementById('statusText');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentTabId = null;
let uiState = { globalEnabled: false, tabEnabled: false, darkModeOn: false, skipDarkPages: true };

// ---------------------------------------------------------------------------
// UI renderer
// ---------------------------------------------------------------------------
function renderUI(state) {
  uiState = state;

  // Toggles
  globalToggle.checked = state.globalEnabled;
  // Show "This Tab" as checked if dark mode is on for the tab (either way)
  tabToggle.checked = state.tabEnabled || state.globalEnabled;

  // When global is on, "This Tab" row is redundant — dim it and show note
  tabRow.classList.toggle('disabled', state.globalEnabled);
  globalNote.hidden = !state.globalEnabled;

  // Skip dark pages toggle
  skipDarkToggle.checked = state.skipDarkPages;

  // Status pill
  const on = state.darkModeOn;
  statusText.textContent = on ? 'Dark mode ON' : 'Dark mode OFF';
  statusBadge.classList.toggle('active', on);
}

// ---------------------------------------------------------------------------
// Load initial state from background
// ---------------------------------------------------------------------------
chrome.runtime.sendMessage({ type: 'getState' }, response => {
  if (chrome.runtime.lastError || !response) {
    statusText.textContent = 'Unable to load state';
    return;
  }
  currentTabId = response.tabId;
  renderUI(response);
});

// ---------------------------------------------------------------------------
// "All Pages" toggle
// ---------------------------------------------------------------------------
globalToggle.addEventListener('change', () => {
  const enabled = globalToggle.checked;

  chrome.runtime.sendMessage({ type: 'setGlobal', enabled }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      // Revert on failure
      globalToggle.checked = !enabled;
      return;
    }
    renderUI({
      ...uiState,
      globalEnabled: enabled,
      // If we just turned global ON, this tab is now covered by it
      darkModeOn: enabled || uiState.tabEnabled
    });
  });
});

// ---------------------------------------------------------------------------
// "This Tab" toggle
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// "Skip dark pages" toggle
// ---------------------------------------------------------------------------
skipDarkToggle.addEventListener('change', () => {
  const enabled = skipDarkToggle.checked;

  chrome.runtime.sendMessage({ type: 'setSkipDarkPages', enabled }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      skipDarkToggle.checked = !enabled;
      return;
    }
    uiState = { ...uiState, skipDarkPages: enabled };
  });
});

// ---------------------------------------------------------------------------
// "This Tab" toggle
// ---------------------------------------------------------------------------
tabToggle.addEventListener('change', () => {
  // Guard: shouldn't be interactive when global is on, but be safe
  if (uiState.globalEnabled) {
    tabToggle.checked = true;
    return;
  }

  const enabled = tabToggle.checked;

  chrome.runtime.sendMessage(
    { type: 'setTab', tabId: currentTabId, enabled },
    response => {
      if (chrome.runtime.lastError || !response?.ok) {
        tabToggle.checked = !enabled;
        return;
      }
      renderUI({
        ...uiState,
        tabEnabled: enabled,
        darkModeOn: enabled
      });
    }
  );
});
