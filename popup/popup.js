'use strict';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const globalToggle    = document.getElementById('globalToggle');
const tabToggle       = document.getElementById('tabToggle');
const skipDarkToggle  = document.getElementById('skipDarkToggle');
const excludeToggle   = document.getElementById('excludeToggle');
const tabRow          = document.getElementById('tabRow');
const excludeRow      = document.getElementById('excludeRow');
const excludeDivider  = document.getElementById('excludeDivider');
const globalNote      = document.getElementById('globalNote');
const statusBadge     = document.getElementById('statusBadge');
const statusText      = document.getElementById('statusText');
const brightnessSlider    = document.getElementById('brightnessSlider');
const brightnessValue     = document.getElementById('brightnessValue');
const brightnessAllToggle = document.getElementById('brightnessAllToggle');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentTabId = null;
let currentTabUrl = null;
let uiState = { globalEnabled: false, tabEnabled: false, darkModeOn: false, skipDarkPages: true, excludedByUrl: false, brightness: 1, applyBrightnessToAll: false };

// ---------------------------------------------------------------------------
// UI renderer
// ---------------------------------------------------------------------------
function renderUI(state) {
  uiState = state;

  // Toggles
  globalToggle.checked = state.globalEnabled;
  // Show "This Tab" as checked if dark mode is on for the tab (either way)
  tabToggle.checked = state.tabEnabled || state.globalEnabled;

  // "Not This Page" — only relevant when global is on
  const showExclude = state.globalEnabled;
  excludeRow.hidden = !showExclude;
  excludeDivider.hidden = !showExclude;
  excludeToggle.checked = !!state.excludedByUrl;

  // When global is on, "This Tab" row is redundant — dim it and show note
  tabRow.classList.toggle('disabled', state.globalEnabled);
  globalNote.hidden = !state.globalEnabled;

  // Skip dark pages toggle
  skipDarkToggle.checked = state.skipDarkPages;

  // Status pill
  const on = state.darkModeOn;
  statusText.textContent = on ? 'Dark mode ON' : 'Dark mode OFF';
  statusBadge.classList.toggle('active', on);

  // Brightness slider — convert 0.1–1.0 to 10–100
  const pct = Math.round((state.brightness ?? 1) * 100);
  brightnessSlider.value = pct;
  brightnessValue.textContent = pct + '%';
  updateSliderFill(pct);

  // Apply-to-all-tabs toggle
  brightnessAllToggle.checked = !!state.applyBrightnessToAll;
}

// ---------------------------------------------------------------------------
// Slider fill — updates the CSS custom property that drives the track gradient
// ---------------------------------------------------------------------------
function updateSliderFill(pct) {
  // pct is 10–100; map to 0%–100% of the track
  const fill = ((pct - 10) / 90) * 100;
  brightnessSlider.style.setProperty('--fill', fill + '%');
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
  currentTabUrl = response.tabUrl;
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
      // If we just turned global ON, this tab is now covered by it (unless excluded)
      darkModeOn: (enabled && !uiState.excludedByUrl) || uiState.tabEnabled
    });
  });
});

// ---------------------------------------------------------------------------
// "Not This Page" toggle
// ---------------------------------------------------------------------------
excludeToggle.addEventListener('change', () => {
  if (!currentTabUrl) return;
  const excluded = excludeToggle.checked;

  chrome.runtime.sendMessage({ type: 'setExclude', url: currentTabUrl, excluded }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      excludeToggle.checked = !excluded;
      return;
    }
    renderUI({
      ...uiState,
      excludedByUrl: excluded,
      darkModeOn: uiState.globalEnabled ? !excluded : uiState.tabEnabled
    });
  });
});

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

// ---------------------------------------------------------------------------
// Brightness slider
// ---------------------------------------------------------------------------
brightnessSlider.addEventListener('input', () => {
  const pct = parseInt(brightnessSlider.value, 10);
  brightnessValue.textContent = pct + '%';
  updateSliderFill(pct);

  const brightness = pct / 100;
  chrome.runtime.sendMessage({ type: 'setBrightness', tabId: currentTabId, brightness });
  uiState = { ...uiState, brightness };
});

// ---------------------------------------------------------------------------
// "Apply to all tabs" brightness toggle
// ---------------------------------------------------------------------------
brightnessAllToggle.addEventListener('change', () => {
  const enabled = brightnessAllToggle.checked;
  const brightness = parseInt(brightnessSlider.value, 10) / 100;

  chrome.runtime.sendMessage(
    { type: 'setBrightnessApplyAll', enabled, brightness },
    response => {
      if (chrome.runtime.lastError || !response?.ok) {
        brightnessAllToggle.checked = !enabled;
        return;
      }
      uiState = { ...uiState, applyBrightnessToAll: enabled };
    }
  );
});
