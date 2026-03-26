# DarkWorldByShariq

A browser extension that converts any webpage into a dark theme with intelligent contrast preservation. Works on Google Chrome and Microsoft Edge.

---

## How it works

The extension applies `filter: invert(100%) hue-rotate(180deg)` to the entire page:

- **Invert** flips every pixel's brightness — white becomes black, light grey becomes dark grey.
- **Hue-rotate(180°)** cancels the colour-hue shift caused by inversion, so reds stay red, blues stay blue, etc.
- Because only brightness is flipped (not contrast ratios), text that was readable before remains readable — no mixing of similar foreground and background colours.
- Images, videos, canvases, and iframes are counter-inverted so they display at their natural colours rather than looking like photo negatives.

---

## Installation

### Google Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked**.
4. Browse to and select the `dark-mode-extension` folder.
5. The extension appears in your toolbar. Pin it via the puzzle-piece icon if needed.

### Microsoft Edge

1. Open Edge and navigate to `edge://extensions`
2. Enable **Developer mode** using the toggle in the left sidebar.
3. Click **Load unpacked**.
4. Browse to and select the `dark-mode-extension` folder.
5. The extension appears in your toolbar.

> **Note:** Because this is loaded as an unpacked (developer) extension it will show a banner on browser start saying "Developer mode extensions are enabled". This is normal and expected.

---

## Usage

Click the **DarkWorldByShariq** icon in the toolbar to open the popup.

| Control | Behaviour |
|---|---|
| **All Pages** | Enables dark mode on every website automatically. Persists across tabs, reloads, and browser restarts. |
| **This Tab** | Enables dark mode only on the currently active tab. Resets if the tab is closed. Grayed out when "All Pages" is on (already covered). |

The status pill at the top of the popup shows whether dark mode is currently **ON** or **OFF** for the active tab.

---

## File structure

```
dark-mode-extension/
├── manifest.json               Extension config (Manifest V3)
├── background/
│   └── service-worker.js       Manages on/off state; pushes updates to tabs
├── content/
│   └── content.js              Injected into every page; applies/removes dark mode
├── popup/
│   ├── popup.html              Toolbar popup UI
│   ├── popup.css               Popup styles
│   └── popup.js                Popup logic & toggle handlers
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Updating the extension

After making any code changes, go to `chrome://extensions` (or `edge://extensions`) and click the **refresh** icon on the extension card to reload it.

---

## Known limitations

- **Already-dark sites** (e.g. GitHub in dark mode): the filter will invert them to appear light. Toggle dark mode off for those tabs using "This Tab".
- **Chrome system pages** (`chrome://`, `edge://`): extensions cannot run on browser-internal pages — these will remain in their default theme.
- **Per-tab state** is not persisted across browser restarts (by design). Use "All Pages" if you want full persistence.
