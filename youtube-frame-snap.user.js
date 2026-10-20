// ==UserScript==
// @name         YouTube Frame Snap
// @namespace    https://github.com/abd3lraouf/youtube-frame-snap
// @version      1.2.0
// @description  Save the current YouTube video frame as a full-resolution photo. Camera button in the player, or press Z (changeable). Shift+click (or Shift+Z) copies it to the clipboard.
// @author       Abdelraouf Sabri
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://www.youtube-nocookie.com/embed/*
// @icon         https://www.youtube.com/favicon.ico
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_info
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// @license      MIT
// @homepageURL  https://github.com/abd3lraouf/youtube-frame-snap
// @supportURL   https://github.com/abd3lraouf/youtube-frame-snap/issues
// @updateURL    https://github.com/abd3lraouf/youtube-frame-snap/raw/main/youtube-frame-snap.user.js
// @downloadURL  https://github.com/abd3lraouf/youtube-frame-snap/raw/main/youtube-frame-snap.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'yfs-snap-button';
  const FORMATS = {
    png: { mime: 'image/png', ext: 'png', label: 'PNG (lossless)' },
    jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG (95%)', quality: 0.95 },
    webp: { mime: 'image/webp', ext: 'webp', label: 'WebP (95%)', quality: 0.95 },
  };
  const ORDER = Object.keys(FORMATS);
  const SCRIPT_URL = 'https://github.com/abd3lraouf/youtube-frame-snap/raw/main/youtube-frame-snap.user.js';
  const RAW_URL = 'https://raw.githubusercontent.com/abd3lraouf/youtube-frame-snap/main/youtube-frame-snap.user.js';
  const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const MODS = ['Ctrl', 'Alt', 'Meta'];

  let format = FORMATS[GM_getValue('format')] ? GM_getValue('format') : 'png';
  // A key code plus Alt/Ctrl/Meta, e.g. "KeyZ" or "Alt+KeyZ". Shift is kept for "copy instead".
  let shortcut = GM_getValue('shortcut') || 'KeyZ';

  // ---------- picking the video ----------

  // The visible, loaded <video> with the most on-screen area (watch page, Shorts, embeds, miniplayer).
  function activeVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      if (!v.videoWidth || v.readyState < 2) continue;
      const r = v.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (w * h > bestArea) {
        best = v;
        bestArea = w * h;
      }
    }
    return best;
  }

  // ---------- naming ----------

  function videoId() {
    const u = new URL(location.href);
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[1] : '';
  }

  // <videoId>_<seconds>s.png, e.g. aqz-KE-bpKQ_27.663s.png
  function fileName(video, ext) {
    return `${videoId() || 'youtube'}_${video.currentTime.toFixed(3)}s.${ext}`;
  }

  // ---------- capture ----------

  function grab(video, mime, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty image'))), mime, quality);
      } catch (e) {
        reject(e);
      }
    });
  }

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function gmDownload(url, name) {
    return new Promise((resolve, reject) => {
      GM_download({
        url,
        name,
        saveAs: false,
        conflictAction: 'uniquify',
        onload: resolve,
        onerror: (e) => reject(new Error((e && (e.error || e.details)) || 'download failed')),
        ontimeout: () => reject(new Error('download timed out')),
      });
    });
  }

  // Through the browser's download manager, into the default Downloads folder.
  // A plain <a download> click from the userscript sandbox is silently dropped on YouTube.
  async function download(blob, name) {
    if (typeof GM_download === 'function') {
      try {
        return await gmDownload(blob, name);
      } catch (e) {
        // Older managers take only string URLs.
        return await gmDownload(await toDataUrl(blob), name);
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function snap({ copy = false } = {}) {
    const video = activeVideo();
    if (!video) return toast('No video frame to capture yet');
    const size = `${video.videoWidth}×${video.videoHeight}`;
    try {
      if (copy) {
        // The clipboard only takes PNG reliably.
        const blob = await grab(video, 'image/png');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(`Copied ${size} frame`);
      } else {
        const f = FORMATS[format];
        const name = fileName(video, f.ext);
        toast('Saving…');
        await download(await grab(video, f.mime, f.quality), name);
        toast(`Downloaded ${name} (${size})`);
      }
    } catch (e) {
      console.error('[YouTube Frame Snap]', e);
      toast(`Capture failed: ${e.message}`);
    }
  }

  // ---------- toast ----------

  let toastEl = null;
  let toastTimer = 0;

  function toast(text, { onClick = null, ms = 1800 } = {}) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed',
        left: '50%',
        bottom: '72px',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        padding: '10px 16px',
        borderRadius: '8px',
        background: 'rgba(15,15,15,.92)',
        color: '#fff',
        font: '500 14px/1.3 Roboto, Arial, sans-serif',
        pointerEvents: 'none',
        transition: 'opacity .2s',
        opacity: '0',
      });
      document.documentElement.append(toastEl);
    }
    toastEl.textContent = text;
    toastEl.onclick = onClick;
    toastEl.style.pointerEvents = onClick ? 'auto' : 'none';
    toastEl.style.cursor = onClick ? 'pointer' : '';
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.pointerEvents = 'none';
    }, ms);
  }

  // ---------- player button ----------

  // Built with DOM calls, not innerHTML: YouTube enforces Trusted Types.
  function cameraIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    // Same 24px outline sizing as the player's own icons (settings, fullscreen).
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'none');
    const body = document.createElementNS(NS, 'path');
    body.setAttribute('fill', 'white');
    body.setAttribute('fill-rule', 'evenodd');
    body.setAttribute(
      'd',
      'M9 4h6l1.83 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.17zM4 8v11h16V8h-4.05l-1.83-2H9.88L8.05 8zm8 1a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'
    );
    svg.append(body);
    return svg;
  }

  function makeButton() {
    const b = document.createElement('button');
    b.id = BUTTON_ID;
    b.className = 'ytp-button';
    b.title = buttonTitle();
    b.setAttribute('aria-label', 'Save frame');
    b.append(cameraIcon());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      snap({ copy: e.shiftKey });
    });
    return b;
  }

  function ensureButtons() {
    for (const controls of document.querySelectorAll('.ytp-right-controls')) {
      if (!controls.querySelector(`#${BUTTON_ID}`)) controls.prepend(makeButton());
    }
  }

  // YouTube is a single-page app that rebuilds the player, so keep re-checking (once per frame at most).
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      ensureButtons();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', ensureButtons);
  ensureButtons();

  // ---------- keyboard ----------

  function comboOf(e) {
    const mods = MODS.filter((m) => e[`${m.toLowerCase()}Key`]);
    return [...mods, e.code].join('+');
  }

  function label(combo) {
    const names = { Alt: MAC ? 'Option' : 'Alt', Meta: MAC ? 'Cmd' : 'Win', Ctrl: 'Ctrl' };
    return combo
      .split('+')
      .map((p) => names[p] || p.replace(/^Key|^Digit/, ''))
      .join('+');
  }

  function buttonTitle() {
    return `Save frame (${label(shortcut)}) · Shift+click to copy`;
  }

  function typing(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  let recording = false;

  window.addEventListener(
    'keydown',
    (e) => {
      if (recording) {
        if (/^(Shift|Control|Alt|Meta)/.test(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        recording = false;
        if (e.code === 'Escape') return toast('Shortcut unchanged');
        shortcut = comboOf(e);
        GM_setValue('shortcut', shortcut);
        for (const b of document.querySelectorAll(`#${BUTTON_ID}`)) b.title = buttonTitle();
        registerShortcutMenu();
        return toast(`Shortcut is now ${label(shortcut)} (Shift+${label(shortcut)} copies)`, { ms: 3000 });
      }
      if (e.repeat || comboOf(e) !== shortcut || typing(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      snap({ copy: e.shiftKey });
    },
    true
  );

  // ---------- updates ----------

  // Tampermonkey updates from @updateURL on its own schedule (daily by default); this checks sooner and offers the update.
  function newer(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  }

  function checkForUpdate(manual = false) {
    if (typeof GM_xmlhttpRequest !== 'function') return;
    GM_setValue('lastUpdateCheck', Date.now());
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${RAW_URL}?t=${Date.now()}`,
      onload: (r) => {
        const m = /@version\s+([\d.]+)/.exec(r.responseText || '');
        const current = GM_info.script.version;
        if (m && newer(m[1], current)) {
          toast(`YouTube Frame Snap ${m[1]} is out (you have ${current}). Click to update.`, {
            ms: 15000,
            onClick: () => GM_openInTab(SCRIPT_URL, { active: true }),
          });
        } else if (manual) {
          toast(`YouTube Frame Snap ${current} is the latest`);
        }
      },
      onerror: () => manual && toast('Could not reach GitHub to check for updates'),
    });
  }

  if (Date.now() - (GM_getValue('lastUpdateCheck') || 0) > UPDATE_EVERY_MS) checkForUpdate();

  // ---------- Tampermonkey menu ----------

  let formatMenuId = null;
  let shortcutMenuId = null;

  function reRegister(id, title, fn) {
    if (id !== null && typeof GM_unregisterMenuCommand === 'function') GM_unregisterMenuCommand(id);
    return GM_registerMenuCommand(title, fn);
  }

  function registerFormatMenu() {
    formatMenuId = reRegister(formatMenuId, `Format: ${FORMATS[format].label} (click to change)`, () => {
      format = ORDER[(ORDER.indexOf(format) + 1) % ORDER.length];
      GM_setValue('format', format);
      registerFormatMenu();
      toast(`Frames save as ${FORMATS[format].label}`);
    });
  }

  function registerShortcutMenu() {
    shortcutMenuId = reRegister(shortcutMenuId, `Shortcut: ${label(shortcut)} (click to change)`, () => {
      recording = true;
      toast('Press the new shortcut (Esc to cancel)', { ms: 8000 });
    });
  }

  GM_registerMenuCommand('Save current frame', () => snap());
  GM_registerMenuCommand('Copy current frame', () => snap({ copy: true }));
  registerShortcutMenu();
  registerFormatMenu();
  GM_registerMenuCommand('Check for updates', () => checkForUpdate(true));
})();
