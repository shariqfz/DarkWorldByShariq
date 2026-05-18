'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DMP_STYLE_ID        = 'dark-mode-pro-styles';
const DMP_CLASS           = 'dark-mode-pro-active';
const DMP_BRIGHTNESS_CLASS = 'dark-mode-pro-brightness';

// ---------------------------------------------------------------------------
// CSS injected into the page
//
// Strategy: invert(100%) hue-rotate(180deg) on <html>
//   - Flips brightness of every pixel (light → dark, dark → light)
//   - The 180° hue rotation cancels the hue shift introduced by inversion,
//     so reds stay red, blues stay blue, etc.
//   - Contrast ratios are preserved because we are just flipping the
//     luminance axis; text that was readable stays readable.
//
// Brightness is controlled via the CSS custom property --dmp-brightness.
// The brightness() step is appended after invert+hue-rotate so it dims the
// already-dark result (values < 1 make the page darker).
//
// Media elements (img, video, canvas, iframe …) are counter-inverted with
// the same filter so they appear at their original colours / brightness
// rather than looking like photo negatives.
//
// The DMP_BRIGHTNESS_CLASS rule handles brightness when dark mode is OFF —
// it applies only a brightness filter so the user can dim the original page.
// ---------------------------------------------------------------------------
const DARK_MODE_CSS = `
  html.${DMP_CLASS} {
    filter: invert(100%) hue-rotate(180deg) brightness(var(--dmp-brightness, 1)) !important;
    background-color: #111111 !important;
    /* Tell the browser UI (scrollbars, form controls) to use dark colours */
    color-scheme: dark !important;
  }

  /*
   * Counter-invert media so they look natural.
   * Double application of (invert + hue-rotate) is the identity transform,
   * so the net effect on these elements is: no change to their appearance.
   */
  html.${DMP_CLASS} img,
  html.${DMP_CLASS} video,
  html.${DMP_CLASS} picture,
  html.${DMP_CLASS} canvas,
  html.${DMP_CLASS} iframe,
  html.${DMP_CLASS} embed,
  html.${DMP_CLASS} object {
    filter: invert(100%) hue-rotate(180deg) !important;
  }

  /* Brightness-only mode (dark mode off, brightness < 1) */
  html.${DMP_BRIGHTNESS_CLASS}:not(.${DMP_CLASS}) {
    filter: brightness(var(--dmp-brightness, 1)) !important;
  }
`;

// ---------------------------------------------------------------------------
// Core enable / disable
// ---------------------------------------------------------------------------
function injectStyles() {
  if (document.getElementById(DMP_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DMP_STYLE_ID;
  style.textContent = DARK_MODE_CSS;
  // document.head may not exist yet at document_start, fall back to <html>
  (document.head || document.documentElement).appendChild(style);
}

function enableDarkMode() {
  injectStyles();
  document.documentElement.classList.add(DMP_CLASS);
}

function disableDarkMode() {
  document.documentElement.classList.remove(DMP_CLASS);
}

// ---------------------------------------------------------------------------
// Brightness control
//
// value: number in [0.1, 1.0] where 1.0 = normal (no change).
// Sets --dmp-brightness on <html> and adds/removes the brightness class for
// the non-dark-mode brightness rule.
// ---------------------------------------------------------------------------
function applyBrightness(value) {
  document.documentElement.style.setProperty('--dmp-brightness', value);
  if (value < 1) {
    document.documentElement.classList.add(DMP_BRIGHTNESS_CLASS);
  } else {
    document.documentElement.classList.remove(DMP_BRIGHTNESS_CLASS);
  }
}

// ---------------------------------------------------------------------------
// Already-dark detection
//
// Checks the computed background colour of <body> (falling back to <html>).
// Transparent backgrounds (alpha < 0.1) are skipped since they tell us
// nothing about the page's intended background colour.
// A relative luminance below 0.3 (~30% brightness) is considered "dark".
// ---------------------------------------------------------------------------
function getBackgroundLuminance(el) {
  const bg = window.getComputedStyle(el).backgroundColor;
  const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return null;
  const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
  if (alpha < 0.1) return null; // Effectively transparent — skip
  const [, r, g, b] = match.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function isPageAlreadyDark() {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const lum = getBackgroundLuminance(el);
    if (lum !== null) return lum < 0.3;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Conditional apply — respects the "skip already-dark pages" setting.
//
// If skipDarkPages is true we must wait for DOMContentLoaded so that
// computed styles are available for the luminance check.
// If skipDarkPages is false (or the page is not already dark) we apply
// immediately to avoid any flash of light content.
// ---------------------------------------------------------------------------
function applyDarkModeConditionally(skipDarkPages) {
  if (!skipDarkPages) {
    enableDarkMode();
    return;
  }

  const check = () => {
    if (!isPageAlreadyDark()) enableDarkMode();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check, { once: true });
  } else {
    check();
  }
}

// ---------------------------------------------------------------------------
// Initial state check
//
// Phase 1 (document_start): inject the <style> tag immediately so the CSS
//   rules are ready the moment the class is added — no extra paint needed.
//
// Phase 2: read storage for globalEnabled + skipDarkPages.
//   - Global on  → applyDarkModeConditionally (fast path, no round-trip)
//   - Global off → ask background if this specific tab should be dark,
//                  then apply conditionally if so.
// ---------------------------------------------------------------------------
injectStyles(); // Phase 1 — styles ready, class not yet added

// Load brightness for this tab from session storage (via background)
chrome.runtime.sendMessage({ type: 'getBrightness' }, response => {
  if (chrome.runtime.lastError) return;
  if (response?.brightness !== undefined) applyBrightness(response.brightness);
});

chrome.storage.local.get(['globalEnabled', 'skipDarkPages', 'excludedUrls'], data => {
  const skipDarkPages = data.skipDarkPages !== false; // default true

  if (data.globalEnabled) {
    const excludedUrls = Array.isArray(data.excludedUrls) ? data.excludedUrls : [];
    const currentUrl = window.location.origin + window.location.pathname;
    if (!excludedUrls.includes(currentUrl)) {
      applyDarkModeConditionally(skipDarkPages);
    }
    return;
  }

  // Per-tab check
  chrome.runtime.sendMessage({ type: 'checkDarkMode' }, response => {
    if (chrome.runtime.lastError) return; // Extension may have reloaded
    if (response?.enabled) applyDarkModeConditionally(skipDarkPages);
  });
});

// ---------------------------------------------------------------------------
// Runtime commands from the background / popup
//
// Explicit user toggles (via popup) always apply immediately — they bypass
// the already-dark detection so the toggle feels responsive and predictable.
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'setDarkMode') {
    if (msg.enabled) {
      enableDarkMode();
    } else {
      disableDarkMode();
    }
    return;
  }
  if (msg.type === 'applyBrightness') {
    applyBrightness(msg.brightness);
  }
});

// Re-fetch brightness whenever the page becomes visible — catches cases where
// "Apply to all tabs" was toggled or its value changed while this tab was in
// the background and the broadcast didn't reach us.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  chrome.runtime.sendMessage({ type: 'getBrightness' }, response => {
    if (chrome.runtime.lastError) return;
    if (response?.brightness !== undefined) applyBrightness(response.brightness);
  });
});
