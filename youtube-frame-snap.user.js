// ==UserScript==
// @name         YouTube Frame Snap
// @namespace    https://github.com/abd3lraouf/youtube-frame-snap
// @version      1.3.1
// @description  Save the current YouTube video frame as a full-resolution photo: camera button or Z. Press X to draw arrows on the frame first, then Enter to save. Shift copies to the clipboard instead. Shortcuts are changeable.
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
  const UPDATE_EVERY_MS = 60 * 60 * 1000;
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const MODS = ['Ctrl', 'Alt', 'Meta'];

  let format = FORMATS[GM_getValue('format')] ? GM_getValue('format') : 'png';
  // Shortcuts are a key code plus Alt/Ctrl/Meta, e.g. "KeyZ" or "Alt+KeyZ". Shift is kept for "copy instead".
  const ACTIONS = {
    save: { store: 'shortcut', fallback: 'KeyZ', title: 'Save frame' },
    arrows: { store: 'arrowsShortcut', fallback: 'KeyX', title: 'Draw arrows' },
  };
  const shortcuts = {};
  for (const [action, d] of Object.entries(ACTIONS)) shortcuts[action] = GM_getValue(d.store) || d.fallback;

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

  // <videoId>_<seconds>s, e.g. aqz-KE-bpKQ_27.663s (the extension comes from the format)
  function baseName(video) {
    return `${videoId() || 'youtube'}_${video.currentTime.toFixed(3)}s`;
  }

  // ---------- capture ----------

  function frameCanvas(video) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function canvasBlob(canvas, mime, quality) {
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

  // Downloads a finished image, or copies it to the clipboard.
  async function deliver(canvas, name, copy) {
    const size = `${canvas.width}×${canvas.height}`;
    if (copy) {
      // The clipboard only takes PNG reliably.
      const blob = await canvasBlob(canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(`Copied ${size} image`);
    } else {
      const f = FORMATS[format];
      const file = `${name}.${f.ext}`;
      toast('Saving…');
      await download(await canvasBlob(canvas, f.mime, f.quality), file);
      toast(`Downloaded ${file} (${size})`);
    }
  }

  async function snap({ copy = false } = {}) {
    const video = activeVideo();
    if (!video) return toast('No video frame to capture yet');
    try {
      await deliver(frameCanvas(video), baseName(video), copy);
    } catch (e) {
      console.error('[YouTube Frame Snap]', e);
      toast(`Capture failed: ${e.message}`);
    }
  }

  // ---------- arrows ----------

  const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'];
  let editor = null;

  function drawArrow(ctx, a, lw) {
    const dx = a.x2 - a.x1;
    const dy = a.y2 - a.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const head = Math.min(lw * 4.5, len * 0.6);
    const wing = head * 0.6;
    const hx = a.x2 - ux * head;
    const hy = a.y2 - uy * head;
    const edge = Math.max(2, lw * 0.35);
    const outline = a.color === '#ffffff' ? '#000000' : '#ffffff';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // An outline pass, then the colour on top, so the arrow reads on any frame.
    for (const [paint, width, headStroke] of [
      [outline, lw + edge * 2, edge * 2],
      [a.color, lw, 1],
    ]) {
      ctx.strokeStyle = paint;
      ctx.fillStyle = paint;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x1, a.y1);
      ctx.lineTo(a.x2 - ux * head * 0.8, a.y2 - uy * head * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a.x2, a.y2);
      ctx.lineTo(hx - uy * wing, hy + ux * wing);
      ctx.lineTo(hx + uy * wing, hy - ux * wing);
      ctx.closePath();
      ctx.lineWidth = headStroke;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // Pauses the video and opens its frame full size: drag to draw arrows, Enter saves, Shift+Enter copies, Esc closes.
  function openArrows() {
    if (editor) return;
    const video = activeVideo();
    if (!video) return toast('No video frame to capture yet');
    video.pause();
    let base;
    try {
      base = frameCanvas(video);
    } catch (e) {
      return toast(`Capture failed: ${e.message}`);
    }
    const name = `${baseName(video)}_arrows`;
    const W = base.width;
    const H = base.height;
    const lw = Math.max(4, Math.round(Math.max(W, H) / 220));
    const arrows = [];
    let draft = null;
    let color = Number(GM_getValue('arrowColor')) || 0;

    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      background: 'rgba(0,0,0,.85)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
    });
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    Object.assign(canvas.style, {
      maxWidth: 'calc(100vw - 48px)',
      maxHeight: 'calc(100vh - 100px)',
      cursor: 'crosshair',
      touchAction: 'none',
      boxShadow: '0 8px 40px rgba(0,0,0,.6)',
    });
    const hint = document.createElement('div');
    Object.assign(hint.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: '#fff',
      font: '500 14px/1.4 Roboto, Arial, sans-serif',
      padding: '0 16px',
      textAlign: 'center',
    });
    const swatch = document.createElement('span');
    Object.assign(swatch.style, { width: '16px', height: '16px', borderRadius: '50%', border: '2px solid #fff', flex: 'none' });
    const help = document.createElement('span');
    help.textContent = `Drag to draw arrows · C colour · ${MAC ? 'Cmd' : 'Ctrl'}+Z undo · Enter save · Shift+Enter copy · Esc cancel`;
    hint.append(swatch, help);
    root.append(canvas, hint);
    document.documentElement.append(root);

    const ctx = canvas.getContext('2d');
    let queued = false;
    function render() {
      queued = false;
      ctx.drawImage(base, 0, 0);
      for (const a of arrows) drawArrow(ctx, a, lw);
      if (draft) drawArrow(ctx, draft, lw);
      swatch.style.background = COLORS[color];
    }
    function schedule() {
      if (!queued) {
        queued = true;
        requestAnimationFrame(render);
      }
    }
    render();

    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      const p = point(e);
      draft = { x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: COLORS[color] };
      schedule();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!draft) return;
      const p = point(e);
      draft.x2 = p.x;
      draft.y2 = p.y;
      schedule();
    });
    const lift = () => {
      if (draft && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > lw * 3) arrows.push(draft);
      draft = null;
      schedule();
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);

    function close() {
      root.remove();
      editor = null;
    }

    async function finish(copy) {
      draft = null;
      render();
      close();
      try {
        await deliver(canvas, name, copy);
      } catch (e) {
        console.error('[YouTube Frame Snap]', e);
        toast(`Export failed: ${e.message}`);
      }
    }

    editor = {
      // Every key stays inside the editor so YouTube's own shortcuts don't fire underneath it.
      key(e) {
        e.stopPropagation();
        if (e.code === 'Escape') close();
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') finish(e.shiftKey);
        else if ((e.code === 'KeyZ' && (e.metaKey || e.ctrlKey)) || e.code === 'Backspace') arrows.pop();
        else if (e.code === 'KeyC' && !e.metaKey && !e.ctrlKey) {
          color = (color + 1) % COLORS.length;
          GM_setValue('arrowColor', color);
        } else return;
        e.preventDefault();
        schedule();
      },
    };
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
    return `Save frame (${label(shortcuts.save)}) · Shift+click to copy · ${label(shortcuts.arrows)} to draw arrows`;
  }

  function typing(el) {
    return el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  let recording = null; // the action whose new shortcut is being pressed

  window.addEventListener(
    'keydown',
    (e) => {
      if (recording) {
        if (/^(Shift|Control|Alt|Meta)/.test(e.code)) return;
        e.preventDefault();
        e.stopPropagation();
        const action = recording;
        recording = null;
        if (e.code === 'Escape') return toast('Shortcut unchanged');
        const combo = comboOf(e);
        const taken = Object.keys(ACTIONS).find((a) => a !== action && shortcuts[a] === combo);
        if (taken) return toast(`${label(combo)} is already ${ACTIONS[taken].title}`);
        shortcuts[action] = combo;
        GM_setValue(ACTIONS[action].store, combo);
        for (const b of document.querySelectorAll(`#${BUTTON_ID}`)) b.title = buttonTitle();
        registerShortcutMenus();
        return toast(`${ACTIONS[action].title} is now ${label(combo)}`, { ms: 3000 });
      }
      if (editor) return editor.key(e);
      if (e.repeat || typing(document.activeElement)) return;
      const combo = comboOf(e);
      const action = Object.keys(ACTIONS).find((a) => shortcuts[a] === combo);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === 'save') snap({ copy: e.shiftKey });
      else openArrows();
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
  const shortcutMenuIds = {};

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

  function registerShortcutMenus() {
    for (const [action, d] of Object.entries(ACTIONS)) {
      const title = `${d.title} shortcut: ${label(shortcuts[action])} (click to change)`;
      shortcutMenuIds[action] = reRegister(shortcutMenuIds[action] ?? null, title, () => {
        recording = action;
        toast(`Press the new ${d.title} shortcut (Esc to cancel)`, { ms: 8000 });
      });
    }
  }

  GM_registerMenuCommand('Save current frame', () => snap());
  GM_registerMenuCommand('Copy current frame', () => snap({ copy: true }));
  GM_registerMenuCommand('Draw arrows on current frame', () => openArrows());
  registerShortcutMenus();
  registerFormatMenu();
  GM_registerMenuCommand('Check for updates', () => checkForUpdate(true));
})();
