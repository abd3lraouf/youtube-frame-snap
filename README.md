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
| **X** | Pauses and opens the frame in the editor (below) |

Change either shortcut from the Tampermonkey menu (**Save frame shortcut: Z** / **Annotate frame shortcut: X**), then press the new keys
(any key, with Ctrl/Option/Cmd if you like; Shift is kept for copying). It is ignored while you type in search or comments.

Works on watch pages, Shorts (keyboard or the Tampermonkey menu), embeds and the miniplayer.

## Annotate

Press **X**: the video pauses and the frame opens full size in an editor, with two toolbars under it.

**Tools** (click, or press the key)

| Key | Tool |
| --- | --- |
| **V** | Select: click a mark to move it, drag its corners (or an arrow's ends) to resize |
| **A** | Arrow, in five styles (**1**–**5**): straight, curved, double-headed, dashed, block |
| **R** | Rectangle |
| **O** | Ellipse |
| **H** | Highlight (see-through colour) |
| **B** | Blur: pixelates what's under the box |
| **P** | Pen |
| **T** | Text: click, type, Enter (Shift+Enter for a new line); double-click text to edit it |
| **N** | Counter: each click places the next number, 1, 2, 3…; removing one renumbers the rest |

**Everything else**

| Do | What it does |
| --- | --- |
| **×** on a mark | Removes that mark |
| **C** (Shift+C back) or a swatch | Colour: red, yellow, green, blue, white |
| **S** or S / M / L | Size |
| **Delete** / **Backspace** | Removes the selected mark (or the last one) |
| Arrow keys | Nudge the selected mark (Shift for 10×) |
| **Cmd+Z** / **Ctrl+Z**, Shift to redo | Undo and redo |
| **Enter** or Save | Saves the image, at full resolution |
| **Shift+Enter** or Copy | Copies it instead |
| **Esc** or Cancel | Lets go of the selection, then closes without saving |

Colour, size and style also change the selected mark. Marks scale with the video's resolution and carry an outline,
so they read on any frame. The × marks and selection boxes are only in the editor, never in the saved image.
Your last tool, style, colour and size are remembered.

## Files

Frames download like any other file, into your browser's default Downloads folder, named by video id and the
second they were taken: `aqz-KE-bpKQ_27.663s.png` (marked up: `aqz-KE-bpKQ_27.663s_annotated.png`). Grabbing the same moment twice adds ` (1)`, ` (2)`.

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
