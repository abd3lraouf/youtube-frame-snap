# YouTube Frame Snap

A Tampermonkey userscript that saves the current YouTube video frame as a photo, at the video's full resolution
(not a screenshot of the player, so no controls, captions or overlays).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open **[youtube-frame-snap.user.js](https://github.com/abd3lraouf/youtube-frame-snap/raw/main/youtube-frame-snap.user.js)** and click **Install**.

Updates arrive through Tampermonkey automatically.

## Use

| Action | What it does |
| --- | --- |
| Click the camera button in the player | Saves the frame |
| **Shift**+click the camera button | Copies the frame to the clipboard (PNG) |
| **Alt+S** (**Option+S** on Mac) | Saves the frame |
| **Alt+Shift+S** | Copies the frame |

Works on watch pages, Shorts (keyboard or the Tampermonkey menu), embeds and the miniplayer.

Frames download like any other file, into your browser's default Downloads folder, named by video id and the
second they were taken: `aqz-KE-bpKQ_27.663s.png`. Grabbing the same moment twice adds ` (1)`, ` (2)`.

## Format

PNG (lossless) by default. Switch to JPEG or WebP from the Tampermonkey menu: **Format: … (click to change)**.
The choice is remembered.

The image is as sharp as the stream YouTube is playing: pick a higher quality in the player's settings first for a
sharper frame.

## No file appears?

Tampermonkey saves through its own downloader. In its dashboard: **Settings** → **Config mode: Advanced** →
**Downloads BETA**, check the whitelisted extensions include `.png` (and `.jpg`, `.webp` if you use them), and set
**Download Mode** to **Browser API** if it still does nothing.

## License

MIT
