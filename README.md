# YouTube Frame Snap

A Tampermonkey userscript that saves the current YouTube video frame as a photo, at the video's full resolution
(not a screenshot of the player, so no controls, captions or overlays).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open **[youtube-frame-snap.user.js](https://github.com/abd3lraouf/youtube-frame-snap/raw/main/youtube-frame-snap.user.js)** and click **Install**.

Updates install themselves: Tampermonkey checks the script's `@updateURL` (daily by default), and the script
also checks GitHub every hour and shows a **Click to update** notice when a newer version is out. **Check for
updates** in the Tampermonkey menu checks right away.

## Use

| Action | What it does |
| --- | --- |
| Click the camera button in the player | Saves the frame |
| **Shift**+click the camera button | Copies the frame to the clipboard (PNG) |
| **Z** | Saves the frame |
| **Shift+Z** | Copies the frame |
| **X** | Pauses and opens the frame to draw arrows on (below) |

Change either shortcut from the Tampermonkey menu (**Save frame shortcut: Z** / **Draw arrows shortcut: X**), then press the new keys
(any key, with Ctrl/Option/Cmd if you like; Shift is kept for copying). It is ignored while you type in search or comments.

Works on watch pages, Shorts (keyboard or the Tampermonkey menu), embeds and the miniplayer.

## Arrows

Press **X**: the video pauses and the frame opens full size, with a toolbar under it.

| Do | What it does |
| --- | --- |
| Drag | Draws an arrow (from where you press to where you let go) |
| **1**–**5** or the toolbar | Style: straight, curved, double-headed, dashed, block |
| **C** (Shift+C back) or a swatch | Colour: red, yellow, green, blue, white |
| **S** or S / M / L | Size |
| **×** on an arrow | Removes that arrow |
| **Cmd+Z** / **Ctrl+Z**, **Backspace** or Undo | Removes the last arrow |
| **Enter** or Save | Saves the image with the arrows, at full resolution |
| **Shift+Enter** or Copy | Copies it instead |
| **Esc** or Cancel | Closes without saving |

Arrows scale with the video's resolution and carry an outline, so they read on any frame. The × marks are only in the
editor, never in the saved image. Style, colour and size are remembered.

## Files

Frames download like any other file, into your browser's default Downloads folder, named by video id and the
second they were taken: `aqz-KE-bpKQ_27.663s.png` (with arrows: `aqz-KE-bpKQ_27.663s_arrows.png`). Grabbing the same moment twice adds ` (1)`, ` (2)`.

## Format

PNG (lossless) by default. Switch to JPEG or WebP from the Tampermonkey menu: **Format: … (click to change)**.
The choice is remembered.

The image is as sharp as the stream YouTube is playing: pick a higher quality in the player's settings first for a
sharper frame.

## No file appears?

Tampermonkey saves through its own downloader. In its dashboard: **Settings** → **Config mode: Advanced** →
**Downloads BETA**, check the whitelisted extensions include `.png` (and `.jpg`, `.webp` if you use them), and set
**Download Mode** to **Browser API** if it still does nothing.

## Releasing

`git config core.hooksPath .githooks` once per clone. The pre-commit hook raises the patch `@version` whenever the
script changes without a version bump, so every push reaches installed copies.

## License

MIT
