// ==UserScript==
// @name         YouTube Frame Snap
// @namespace    https://github.com/abd3lraouf/youtube-frame-snap
// @version      1.5.0
// @description  Save the current YouTube video frame as a full-resolution photo: camera button or Z. Press X to mark it up first (arrows in five styles, boxes, ellipses, highlight, blur, pen, text, numbered counters; move, resize, × to remove, undo), then Enter to save. Shift copies to the clipboard instead.
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
    arrows: { store: 'arrowsShortcut', fallback: 'KeyX', title: 'Annotate frame' },
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

  // ---------- editor: arrows, shapes, text, counters ----------

  const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff'];
  const DARK_TEXT = ['#ffcc00', '#ffffff'];
  const STYLES = ['straight', 'curved', 'double', 'dashed', 'block'];
  const STYLE_NAMES = { straight: 'Straight', curved: 'Curved', double: 'Double', dashed: 'Dashed', block: 'Block' };
  const SIZES = [
    { name: 'S', scale: 0.6 },
    { name: 'M', scale: 1 },
    { name: 'L', scale: 1.6 },
  ];
  const TOOLS = [
    { id: 'select', code: 'KeyV', name: 'Select, move and resize' },
    { id: 'arrow', code: 'KeyA', name: 'Arrow' },
    { id: 'rect', code: 'KeyR', name: 'Rectangle' },
    { id: 'ellipse', code: 'KeyO', name: 'Ellipse' },
    { id: 'highlight', code: 'KeyH', name: 'Highlight' },
    { id: 'blur', code: 'KeyB', name: 'Blur (pixelate)' },
    { id: 'pen', code: 'KeyP', name: 'Pen' },
    { id: 'text', code: 'KeyT', name: 'Text' },
    { id: 'counter', code: 'KeyN', name: 'Counter (1, 2, 3…)' },
  ];
  const BOXES = ['rect', 'ellipse', 'highlight', 'blur'];
  const FONT = 'Roboto, Arial, sans-serif';
  let editor = null;

  const outlineFor = (color) => (color === '#ffffff' ? '#000000' : '#ffffff');
  const counterRadius = (s) => s.lw * 3.2;
  const textSize = (s) => Math.round(s.lw * 5.5);

  function unit(x, y) {
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  function norm(s) {
    return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
  }

  // The bend point of an arrow: the midpoint for straight ones, pushed sideways for curved ones.
  function bendPoint(a) {
    const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
    const bend = a.style === 'curved' ? len * 0.3 : 0;
    return {
      x: (a.x1 + a.x2) / 2 - ((a.y2 - a.y1) / len) * bend,
      y: (a.y1 + a.y2) / 2 + ((a.x2 - a.x1) / len) * bend,
    };
  }

  function curvePoints(a) {
    const c = bendPoint(a);
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      pts.push({ x: u * u * a.x1 + 2 * u * t * c.x + t * t * a.x2, y: u * u * a.y1 + 2 * u * t * c.y + t * t * a.y2 });
    }
    return pts;
  }

  // Halfway along an arrow, where its × sits.
  function middleOf(a) {
    const c = bendPoint(a);
    return { x: 0.25 * a.x1 + 0.5 * c.x + 0.25 * a.x2, y: 0.25 * a.y1 + 0.5 * c.y + 0.25 * a.y2 };
  }

  function headAt(ctx, x, y, dir, head) {
    const wing = head * 0.6;
    const hx = x - dir.x * head;
    const hy = y - dir.y * head;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(hx - dir.y * wing, hy + dir.x * wing);
    ctx.lineTo(hx + dir.y * wing, hy - dir.x * wing);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // A tapered fat arrow: thin at the tail, wide at the head.
  function drawBlock(ctx, a, len, outline, edge) {
    const head = Math.min(a.lw * 5, len * 0.5);
    const wing = head * 0.6;
    const tail = a.lw * 0.35;
    const neck = a.lw * 1.1;
    ctx.translate(a.x1, a.y1);
    ctx.rotate(Math.atan2(a.y2 - a.y1, a.x2 - a.x1));
    ctx.beginPath();
    ctx.moveTo(0, -tail);
    ctx.lineTo(len - head, -neck);
    ctx.lineTo(len - head, -wing);
    ctx.lineTo(len, 0);
    ctx.lineTo(len - head, wing);
    ctx.lineTo(len - head, neck);
    ctx.lineTo(0, tail);
    ctx.closePath();
    ctx.lineWidth = edge * 2;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.fillStyle = a.color;
    ctx.fill();
  }

  // a = { x1, y1, x2, y2, color, style, lw }; the head is at (x2, y2).
  function drawArrow(ctx, a) {
    const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    if (len < 1) return;
    const lw = a.lw;
    const edge = Math.max(1.5, lw * 0.35);
    const outline = outlineFor(a.color);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (a.style === 'block') return drawBlock(ctx, a, len, outline, edge);
    const two = a.style === 'double';
    const head = Math.min(lw * 4.5, len * (two ? 0.35 : 0.6));
    const c = bendPoint(a);
    const endDir = unit(a.x2 - c.x, a.y2 - c.y);
    const startDir = unit(a.x1 - c.x, a.y1 - c.y);
    // The shaft stops inside the head so its round cap doesn't poke through the tip.
    const s = two ? { x: a.x1 - startDir.x * head * 0.8, y: a.y1 - startDir.y * head * 0.8 } : { x: a.x1, y: a.y1 };
    const e = { x: a.x2 - endDir.x * head * 0.8, y: a.y2 - endDir.y * head * 0.8 };
    // An outline pass, then the colour on top, so the arrow reads on any frame.
    for (const [paint, width, headStroke] of [
      [outline, lw + edge * 2, edge * 2],
      [a.color, lw, 1],
    ]) {
      ctx.strokeStyle = paint;
      ctx.fillStyle = paint;
      ctx.lineWidth = width;
      ctx.setLineDash(a.style === 'dashed' ? [lw * 0.8, lw * 2.4] : []);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.quadraticCurveTo(c.x, c.y, e.x, e.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = headStroke;
      headAt(ctx, a.x2, a.y2, endDir, head);
      if (two) headAt(ctx, a.x1, a.y1, startDir, head);
    }
  }

  // Outline first, then the colour on top, like the arrows.
  function strokeTwice(ctx, color, width, trace) {
    const edge = Math.max(1.5, width * 0.35);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [paint, w] of [
      [outlineFor(color), width + edge * 2],
      [color, width],
    ]) {
      ctx.strokeStyle = paint;
      ctx.lineWidth = w;
      ctx.beginPath();
      trace();
      ctx.stroke();
    }
  }

  function tracePen(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  const pixelCells = document.createElement('canvas');

  // Pixelates the original frame under the box, so it hides what's there.
  function pixelate(ctx, s, base) {
    if (!base) return;
    const b = norm(s);
    const x = Math.max(0, Math.floor(b.x));
    const y = Math.max(0, Math.floor(b.y));
    const w = Math.min(base.width, Math.ceil(b.x + b.w)) - x;
    const h = Math.min(base.height, Math.ceil(b.y + b.h)) - y;
    if (w < 2 || h < 2) return;
    const cell = Math.max(6, s.lw * 1.8);
    pixelCells.width = Math.max(1, Math.round(w / cell));
    pixelCells.height = Math.max(1, Math.round(h / cell));
    pixelCells.getContext('2d').drawImage(base, x, y, w, h, 0, 0, pixelCells.width, pixelCells.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pixelCells, 0, 0, pixelCells.width, pixelCells.height, x, y, w, h);
  }

  function drawCounter(ctx, s, n) {
    const r = counterRadius(s);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.lineWidth = Math.max(2, s.lw * 0.6);
    ctx.strokeStyle = outlineFor(s.color);
    ctx.stroke();
    ctx.fillStyle = DARK_TEXT.includes(s.color) ? '#0f0f0f' : '#ffffff';
    ctx.font = `700 ${Math.round(r * (n > 9 ? 1 : 1.25))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), s.x, s.y + r * 0.07);
  }

  function drawText(ctx, s) {
    const size = textSize(s);
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    const lines = s.text.split('\n');
    let w = 0;
    lines.forEach((line, i) => {
      const y = s.y + i * size * 1.2;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = outlineFor(s.color);
      ctx.strokeText(line, s.x, y);
      ctx.fillStyle = s.color;
      ctx.fillText(line, s.x, y);
      w = Math.max(w, ctx.measureText(line).width);
    });
    // Kept for selecting and hit-testing the text.
    s._w = w;
    s._h = lines.length * size * 1.2;
  }

  // n numbers counters in the order they were placed, so removing one renumbers the rest.
  function drawShape(ctx, s, base, n) {
    ctx.save();
    if (s.type === 'arrow') drawArrow(ctx, s);
    else if (s.type === 'rect') {
      const b = norm(s);
      const r = Math.min(s.lw, b.w / 2, b.h / 2);
      strokeTwice(ctx, s.color, s.lw * 0.7, () => ctx.roundRect(b.x, b.y, b.w, b.h, r));
    } else if (s.type === 'ellipse') {
      const b = norm(s);
      strokeTwice(ctx, s.color, s.lw * 0.7, () => ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2));
    } else if (s.type === 'highlight') {
      const b = norm(s);
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = s.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else if (s.type === 'blur') pixelate(ctx, s, base);
    else if (s.type === 'pen') strokeTwice(ctx, s.color, s.lw * 0.7, () => tracePen(ctx, s.points));
    else if (s.type === 'counter') drawCounter(ctx, s, n);
    else if (s.type === 'text') drawText(ctx, s);
    ctx.restore();
  }

  function bbox(s) {
    if (s.type === 'arrow' || s.type === 'pen') {
      const pts = s.type === 'arrow' ? curvePoints(s) : s.points;
      const pad = s.type === 'arrow' ? s.lw * 3 : s.lw;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    if (s.type === 'counter') {
      const r = counterRadius(s);
      return { x: s.x - r, y: s.y - r, w: 2 * r, h: 2 * r };
    }
    if (s.type === 'text') return { x: s.x, y: s.y, w: s._w || 0, h: s._h || 0 };
    return norm(s);
  }

  function distSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }

  function nearLine(p, pts, d) {
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= d;
    for (let i = 1; i < pts.length; i++) if (distSeg(p, pts[i - 1], pts[i]) <= d) return true;
    return false;
  }

  // Lines are hit near the line, rectangles and ellipses near their outline, the rest anywhere inside.
  function hit(s, p, tol) {
    if (s.type === 'arrow') return nearLine(p, curvePoints(s), tol + s.lw * (s.style === 'block' ? 2.5 : 1.5));
    if (s.type === 'pen') return nearLine(p, s.points, tol + s.lw);
    if (s.type === 'counter') return Math.hypot(p.x - s.x, p.y - s.y) <= counterRadius(s) + tol;
    if (s.type === 'rect') {
      const b = norm(s);
      const d = tol + s.lw;
      const outer = p.x >= b.x - d && p.x <= b.x + b.w + d && p.y >= b.y - d && p.y <= b.y + b.h + d;
      const inner = p.x > b.x + d && p.x < b.x + b.w - d && p.y > b.y + d && p.y < b.y + b.h - d;
      return outer && !inner;
    }
    if (s.type === 'ellipse') {
      const b = norm(s);
      const rx = b.w / 2 || 1;
      const ry = b.h / 2 || 1;
      const k = Math.hypot((p.x - b.x - rx) / rx, (p.y - b.y - ry) / ry);
      return Math.abs(k - 1) * Math.min(rx, ry) <= tol + s.lw;
    }
    const b = bbox(s);
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  }

  function shift(s, dx, dy) {
    if (s.type === 'arrow') {
      s.x1 += dx;
      s.y1 += dy;
      s.x2 += dx;
      s.y2 += dy;
    } else if (s.type === 'pen') {
      for (const q of s.points) {
        q.x += dx;
        q.y += dy;
      }
    } else {
      s.x += dx;
      s.y += dy;
    }
  }

  function big(s) {
    if (s.type === 'arrow') return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > s.lw * 3;
    if (s.type === 'pen') return s.points.length > 1;
    const b = norm(s);
    return b.w > s.lw && b.h > s.lw;
  }

  function el(tag, style, text) {
    const n = document.createElement(tag);
    if (style) Object.assign(n.style, style);
    if (text) n.textContent = text;
    return n;
  }

  // Toolbar icons are drawn by the same code as the marks, so each button shows exactly what it makes.
  function toolIcon(id) {
    const c = el('canvas', { width: '44px', height: '22px', display: 'block' });
    c.width = 88;
    c.height = 44;
    const ctx = c.getContext('2d');
    const w = '#ffffff';
    const sample = {
      arrow: { type: 'arrow', x1: 12, y1: 32, x2: 76, y2: 12, style: 'straight', color: w, lw: 4.5 },
      rect: { type: 'rect', x: 18, y: 7, w: 52, h: 30, color: w, lw: 4 },
      ellipse: { type: 'ellipse', x: 16, y: 6, w: 56, h: 32, color: w, lw: 4 },
      highlight: { type: 'highlight', x: 12, y: 12, w: 64, h: 20, color: '#ffcc00', lw: 4 },
      pen: {
        type: 'pen',
        points: [
          { x: 12, y: 30 },
          { x: 28, y: 12 },
          { x: 44, y: 30 },
          { x: 60, y: 12 },
          { x: 76, y: 26 },
        ],
        color: w,
        lw: 4,
      },
      text: { type: 'text', x: 26, y: 6, text: 'Aa', color: w, lw: 5.2 },
      counter: { type: 'counter', x: 44, y: 22, color: '#ff3b30', lw: 5.6 },
    }[id];
    if (sample) drawShape(ctx, sample, null, 1);
    else if (id === 'blur') {
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#d0d0d0' : '#707070';
          ctx.fillRect(17 + i * 9, 8 + j * 9, 9, 9);
        }
      }
    } else if (id === 'select') {
      ctx.beginPath();
      [
        [36, 5],
        [36, 37],
        [44, 30],
        [50, 41],
        [56, 38],
        [50, 27],
        [60, 26],
      ].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = w;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.fill();
      ctx.stroke();
    }
    return c;
  }

  const TOOL_BUTTON = {
    height: '34px',
    minWidth: '34px',
    padding: '0 10px',
    border: '1px solid rgba(255,255,255,.18)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,.06)',
    color: '#fff',
    font: `500 13px/1 ${FONT}`,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  };

  // Pauses the video and opens its frame full size to mark up. Enter saves, Shift+Enter copies, Esc closes.
  function openEditor() {
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
    const name = `${baseName(video)}_annotated`;
    const W = base.width;
    const H = base.height;
    const unitWidth = Math.max(4, Math.round(Math.max(W, H) / 220));
    let shapes = [];
    const history = [];
    let future = [];
    let selected = null;
    let drag = null;
    let editing = null;
    let skipClick = false;
    let tool = TOOLS.some((t) => t.id === GM_getValue('tool')) ? GM_getValue('tool') : 'arrow';
    let color = Math.min(Number(GM_getValue('arrowColor')) || 0, COLORS.length - 1);
    let style = STYLES.includes(GM_getValue('arrowStyle')) ? GM_getValue('arrowStyle') : 'straight';
    let size = SIZES[GM_getValue('arrowSize')] ? GM_getValue('arrowSize') : 1;
    const currentLw = () => unitWidth * SIZES[size].scale;
    const pct = (v, total) => `${(v / total) * 100}%`;

    // ----- layout -----

    const root = el('div', {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      background: 'rgba(0,0,0,.92)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
    });
    const stage = el('div', { position: 'relative', lineHeight: '0' });
    const canvas = el('canvas', {
      display: 'block',
      maxWidth: 'calc(100vw - 48px)',
      maxHeight: 'calc(100vh - 170px)',
      cursor: 'crosshair',
      touchAction: 'none',
      boxShadow: '0 8px 40px rgba(0,0,0,.6)',
    });
    canvas.width = W;
    canvas.height = H;
    // Close buttons, the selection box and its handles sit over the canvas in percentages, so they follow any
    // on-screen scale and never reach the saved image.
    const layer = el('div', { position: 'absolute', inset: '0', pointerEvents: 'none' });
    stage.append(canvas, layer);

    const row = () =>
      el('div', {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '0 16px',
        maxWidth: 'calc(100vw - 32px)',
      });
    const toolsRow = row();
    const optionsRow = row();
    const hint = el(
      'div',
      { color: 'rgba(255,255,255,.6)', font: `400 12px/1.4 ${FONT}`, textAlign: 'center', padding: '0 16px' },
      'Drag to draw · click a mark to move it, drag its corners to resize · double-click text to edit · ' +
        'Delete removes · ↑↓←→ nudge · Enter save · Shift+Enter copy · Esc cancel'
    );
    const divider = () => el('span', { width: '1px', height: '22px', background: 'rgba(255,255,255,.2)', margin: '0 6px' });
    const button = (parent, content, title, onClick) => {
      const b = el('button', TOOL_BUTTON);
      b.type = 'button';
      b.title = title;
      if (typeof content === 'string') b.textContent = content;
      else b.append(content);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
        b.blur();
      });
      parent.append(b);
      return b;
    };
    const mark = (b, on) => {
      b.style.background = on ? 'rgba(255,255,255,.22)' : TOOL_BUTTON.background;
      b.style.borderColor = on ? '#fff' : 'rgba(255,255,255,.18)';
    };

    const toolButtons = TOOLS.map((t) =>
      button(toolsRow, toolIcon(t.id), `${t.name} (${label(t.code)})`, () => {
        setTool(t.id);
        refresh();
      })
    );
    const styleGroup = el('span', { display: 'inline-flex', gap: '6px', alignItems: 'center' });
    const styleButtons = STYLES.map((st, i) => {
      const icon = el('canvas', { width: '44px', height: '22px', display: 'block' });
      icon.width = 88;
      icon.height = 44;
      drawArrow(icon.getContext('2d'), { x1: 10, y1: 30, x2: 78, y2: 16, color: '#ffffff', style: st, lw: 4.5 });
      return button(styleGroup, icon, `${STYLE_NAMES[st]} arrow (${i + 1})`, () => {
        setStyle(st);
        refresh();
      });
    });
    styleGroup.append(divider());
    optionsRow.append(styleGroup);
    const colorButtons = COLORS.map((c, i) => {
      const dot = el('span', { width: '16px', height: '16px', borderRadius: '50%', background: c, display: 'block' });
      const b = button(optionsRow, dot, 'Colour (C)', () => {
        setColor(i);
        refresh();
      });
      b.style.padding = '0';
      return b;
    });
    optionsRow.append(divider());
    const sizeButtons = SIZES.map((s, i) =>
      button(optionsRow, s.name, 'Size (S)', () => {
        setSize(i);
        refresh();
      })
    );
    optionsRow.append(divider());
    const undoButton = button(optionsRow, 'Undo', `Undo (${MAC ? 'Cmd' : 'Ctrl'}+Z)`, () => {
      undo();
      refresh();
    });
    const redoButton = button(optionsRow, 'Redo', `Redo (${MAC ? 'Cmd' : 'Ctrl'}+Shift+Z)`, () => {
      redo();
      refresh();
    });
    optionsRow.append(divider());
    button(optionsRow, 'Cancel', 'Close without saving (Esc)', () => close());
    button(optionsRow, 'Copy', 'Copy to the clipboard (Shift+Enter)', () => finish(true));
    const save = button(optionsRow, 'Save', 'Save the image (Enter)', () => finish(false));
    Object.assign(save.style, { background: '#fff', color: '#0f0f0f', borderColor: '#fff', fontWeight: '700' });

    root.append(stage, toolsRow, optionsRow, hint);
    document.documentElement.append(root);

    // ----- state -----

    const snapshot = () => JSON.stringify(shapes);
    function remember(before = snapshot()) {
      history.push(before);
      if (history.length > 200) history.shift();
      future = [];
    }
    function restore(json) {
      shapes = JSON.parse(json);
      selected = null;
    }
    function undo() {
      if (!history.length) return;
      future.push(snapshot());
      restore(history.pop());
    }
    function redo() {
      if (!future.length) return;
      history.push(snapshot());
      restore(future.pop());
    }
    function remove(s) {
      remember();
      shapes.splice(shapes.indexOf(s), 1);
      if (selected === s) selected = null;
    }
    // Colour, size and arrow style also change the selected mark.
    function apply(change) {
      if (selected && shapes.includes(selected)) {
        remember();
        change(selected);
      }
    }
    // Picking a drawing tool lets go of the selection, so the next colour or size is for the next mark.
    function setTool(id) {
      tool = id;
      GM_setValue('tool', id);
      if (id !== 'select') selected = null;
    }
    function setColor(i) {
      color = i;
      GM_setValue('arrowColor', i);
      apply((s) => (s.color = COLORS[i]));
    }
    function setSize(i) {
      size = i;
      GM_setValue('arrowSize', i);
      apply((s) => (s.lw = currentLw()));
    }
    function setStyle(st) {
      style = st;
      GM_setValue('arrowStyle', st);
      if (selected && selected.type === 'arrow') apply((s) => (s.style = st));
      else setTool('arrow');
    }

    // ----- drawing -----

    const ctx = canvas.getContext('2d');
    let queued = false;
    function render() {
      queued = false;
      ctx.drawImage(base, 0, 0);
      let n = 0;
      for (const s of shapes) {
        if (s.type === 'counter') n++;
        if (editing && editing.shape === s) continue;
        drawShape(ctx, s, base, n);
      }
      if (drag && drag.mode === 'draw') drawShape(ctx, drag.shape, base, n + 1);
    }
    function schedule() {
      if (!queued) {
        queued = true;
        requestAnimationFrame(render);
      }
    }

    function closeButton(s) {
      const b = bbox(s);
      const arrow = s.type === 'arrow';
      const at = arrow ? middleOf(s) : { x: b.x + b.w, y: b.y };
      const x = el(
        'button',
        {
          position: 'absolute',
          left: pct(at.x, W),
          top: pct(at.y, H),
          // Arrows get it on the line; boxes just outside their top-right corner, clear of the resize handle.
          transform: arrow ? 'translate(-50%, -50%)' : 'translate(2px, calc(-100% - 2px))',
          width: '22px',
          height: '22px',
          padding: '0',
          borderRadius: '50%',
          border: '2px solid #fff',
          background: 'rgba(15,15,15,.85)',
          color: '#fff',
          font: `700 14px/18px ${FONT}`,
          cursor: 'pointer',
          pointerEvents: 'auto',
          boxShadow: '0 1px 4px rgba(0,0,0,.5)',
        },
        '×'
      );
      x.type = 'button';
      x.title = 'Remove';
      x.addEventListener('pointerdown', (e) => e.stopPropagation());
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        remove(s);
        refresh();
      });
      return x;
    }

    function handlesFor(s) {
      if (s.type === 'arrow') {
        return [
          { x: s.x1, y: s.y1, mode: 'p1', cursor: 'move' },
          { x: s.x2, y: s.y2, mode: 'p2', cursor: 'move' },
        ];
      }
      if (!BOXES.includes(s.type)) return [];
      const b = norm(s);
      const corners = [
        [b.x, b.y, 'nwse-resize'],
        [b.x + b.w, b.y, 'nesw-resize'],
        [b.x + b.w, b.y + b.h, 'nwse-resize'],
        [b.x, b.y + b.h, 'nesw-resize'],
      ];
      return corners.map(([x, y, cursor], i) => {
        const [ox, oy] = corners[(i + 2) % 4];
        return { x, y, mode: 'corner', ox, oy, cursor };
      });
    }

    function overlay() {
      layer.replaceChildren();
      if (drag) return;
      if (selected && shapes.includes(selected)) {
        const b = bbox(selected);
        layer.append(
          el('div', {
            position: 'absolute',
            left: pct(b.x, W),
            top: pct(b.y, H),
            width: pct(b.w, W),
            height: pct(b.h, H),
            outline: '1.5px dashed rgba(255,255,255,.9)',
            boxShadow: '0 0 0 1px rgba(0,0,0,.45)',
          })
        );
      }
      for (const s of shapes) if (!(editing && editing.shape === s)) layer.append(closeButton(s));
      if (selected && shapes.includes(selected)) {
        for (const h of handlesFor(selected)) {
          const d = el('div', {
            position: 'absolute',
            left: pct(h.x, W),
            top: pct(h.y, H),
            width: '12px',
            height: '12px',
            transform: 'translate(-50%, -50%)',
            background: '#fff',
            border: '2px solid #0a84ff',
            borderRadius: '3px',
            cursor: h.cursor,
            pointerEvents: 'auto',
          });
          d.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            startDrag({ mode: h.mode, shape: selected, ox: h.ox, oy: h.oy }, e);
          });
          layer.append(d);
        }
      }
    }

    function refresh() {
      toolButtons.forEach((b, i) => mark(b, TOOLS[i].id === tool));
      styleButtons.forEach((b, i) => mark(b, STYLES[i] === (selected && selected.type === 'arrow' ? selected.style : style)));
      colorButtons.forEach((b, i) => mark(b, i === color));
      sizeButtons.forEach((b, i) => mark(b, i === size));
      styleGroup.style.display = tool === 'arrow' || (selected && selected.type === 'arrow') ? 'inline-flex' : 'none';
      undoButton.style.opacity = history.length ? '1' : '.4';
      redoButton.style.opacity = future.length ? '1' : '.4';
      render();
      overlay();
    }

    // ----- pointer -----

    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
    }
    const tolerance = () => (8 * W) / canvas.getBoundingClientRect().width;
    const topAt = (p) => [...shapes].reverse().find((s) => hit(s, p, tolerance()));

    function startDrag(d, e) {
      d.before = snapshot();
      d.last = point(e);
      drag = d;
      canvas.setPointerCapture(e.pointerId);
      layer.replaceChildren();
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (editing) {
        skipClick = true;
        commitText();
        return;
      }
      skipClick = false;
      const p = point(e);
      const top = topAt(p);
      // The select tool picks anything; a drawing tool only grabs the mark that is already selected.
      if (tool === 'select' || (top && top === selected)) {
        selected = top || null;
        if (top) startDrag({ mode: 'move', shape: top }, e);
        else refresh();
        render();
        return;
      }
      if (tool === 'text') return; // placed on click, so the text box keeps the focus
      const lw = currentLw();
      const c = COLORS[color];
      if (tool === 'counter') {
        remember();
        const s = { type: 'counter', x: p.x, y: p.y, color: c, lw };
        shapes.push(s);
        selected = s;
        startDrag({ mode: 'move', shape: s, placed: true }, e);
        render();
        return;
      }
      let s;
      if (tool === 'arrow') s = { type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, style, color: c, lw };
      else if (tool === 'pen') s = { type: 'pen', points: [p], color: c, lw };
      else s = { type: tool, x: p.x, y: p.y, w: 0, h: 0, color: c, lw };
      selected = null;
      startDrag({ mode: 'draw', shape: s }, e);
    });

    canvas.addEventListener('pointermove', (e) => {
      const p = point(e);
      if (!drag) {
        const top = topAt(p);
        canvas.style.cursor =
          top && (tool === 'select' || top === selected)
            ? 'move'
            : tool === 'select'
            ? 'default'
            : tool === 'text'
            ? 'text'
            : 'crosshair';
        return;
      }
      const s = drag.shape;
      if (drag.mode === 'draw') {
        if (s.type === 'arrow') {
          s.x2 = p.x;
          s.y2 = p.y;
        } else if (s.type === 'pen') {
          const last = s.points[s.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) > 2) s.points.push(p);
        } else {
          s.w = p.x - s.x;
          s.h = p.y - s.y;
        }
      } else if (drag.mode === 'move') {
        shift(s, p.x - drag.last.x, p.y - drag.last.y);
        drag.last = p;
      } else if (drag.mode === 'p1') {
        s.x1 = p.x;
        s.y1 = p.y;
      } else if (drag.mode === 'p2') {
        s.x2 = p.x;
        s.y2 = p.y;
      } else if (drag.mode === 'corner') {
        Object.assign(s, { x: drag.ox, y: drag.oy, w: p.x - drag.ox, h: p.y - drag.oy });
      }
      drag.moved = true;
      schedule();
    });

    const lift = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      const s = d.shape;
      if (d.mode === 'draw') {
        if (big(s)) {
          if (BOXES.includes(s.type)) Object.assign(s, norm(s));
          remember(d.before);
          shapes.push(s);
          selected = s;
        }
      } else if (d.moved && !d.placed) {
        if (BOXES.includes(s.type)) Object.assign(s, norm(s));
        remember(d.before);
      }
      refresh();
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);

    canvas.addEventListener('click', (e) => {
      if (skipClick) {
        skipClick = false;
        return;
      }
      if (tool !== 'text') return;
      const p = point(e);
      const existing = [...shapes].reverse().find((s) => s.type === 'text' && hit(s, p, tolerance()));
      if (existing) return editText(existing, false);
      const lw = currentLw();
      editText({ type: 'text', x: p.x, y: p.y - textSize({ lw }) * 0.6, text: '', color: COLORS[color], lw }, true);
    });

    canvas.addEventListener('dblclick', (e) => {
      if (tool === 'text') return;
      const p = point(e);
      const t = [...shapes].reverse().find((s) => s.type === 'text' && hit(s, p, tolerance()));
      if (t) editText(t, false);
    });

    // ----- text -----

    function editText(shape, isNew) {
      const k = canvas.getBoundingClientRect().width / W;
      const area = el('textarea', {
        position: 'absolute',
        left: pct(shape.x, W),
        top: pct(shape.y, H),
        font: `700 ${textSize(shape) * k}px ${FONT}`,
        lineHeight: '1.2',
        color: shape.color,
        background: 'rgba(0,0,0,.35)',
        border: '1px dashed #fff',
        borderRadius: '4px',
        outline: 'none',
        resize: 'none',
        padding: '0 2px',
        margin: '0',
        overflow: 'hidden',
        whiteSpace: 'pre',
        zIndex: '2',
      });
      area.value = shape.text;
      const fit = () => {
        const lines = area.value.split('\n');
        area.rows = lines.length;
        area.cols = Math.max(4, ...lines.map((l) => l.length + 2));
      };
      fit();
      area.addEventListener('input', fit);
      area.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitText();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          commitText(true);
        }
      });
      area.addEventListener('blur', () => commitText());
      editing = { shape, area, isNew, before: snapshot() };
      stage.append(area);
      render();
      overlay();
      setTimeout(() => area.focus(), 0);
    }

    function commitText(cancel = false) {
      if (!editing) return;
      const { shape, area, isNew, before } = editing;
      editing = null;
      const text = area.value.replace(/\s+$/, '');
      area.remove();
      if (!cancel && text) {
        if (isNew || text !== shape.text) {
          remember(before);
          shape.text = text;
          if (isNew) shapes.push(shape);
        }
        selected = shape;
      } else if (!cancel && !isNew) {
        remember(before);
        shapes.splice(shapes.indexOf(shape), 1);
        selected = null;
      }
      if (editor) refresh();
    }

    // ----- finish -----

    function close() {
      root.remove();
      editor = null;
    }

    async function finish(copy) {
      if (editing) commitText();
      selected = null;
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
      // Every key stays inside the editor so YouTube's own shortcuts don't fire underneath it;
      // the text box handles its own keys.
      key(e) {
        if (editing) return;
        e.stopPropagation();
        const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
        const mod = e.metaKey || e.ctrlKey;
        const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
        const t = TOOLS.find((x) => x.code === e.code);
        const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
        if (e.code === 'Escape') {
          if (selected) selected = null;
          else return close();
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') return finish(e.shiftKey);
        else if (mod && e.code === 'KeyZ') e.shiftKey ? redo() : undo();
        else if (mod && e.code === 'KeyY') redo();
        else if (e.code === 'Backspace' || e.code === 'Delete') {
          if (selected && shapes.includes(selected)) remove(selected);
          else if (shapes.length) remove(shapes[shapes.length - 1]);
        } else if (nudge && selected && shapes.includes(selected)) {
          const step = ((e.shiftKey ? 10 : 1) * W) / canvas.getBoundingClientRect().width;
          remember();
          shift(selected, nudge[0] * step, nudge[1] * step);
        } else if (plain && e.code === 'KeyC') setColor((color + (e.shiftKey ? COLORS.length - 1 : 1)) % COLORS.length);
        else if (plain && e.code === 'KeyS') setSize((size + 1) % SIZES.length);
        else if (plain && digit && STYLES[digit[2] - 1]) setStyle(STYLES[digit[2] - 1]);
        else if (plain && t) setTool(t.id);
        else return;
        e.preventDefault();
        refresh();
      },
    };

    refresh();
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
    return `Save frame (${label(shortcuts.save)}) · Shift+click to copy · ${label(shortcuts.arrows)} to annotate`;
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
      else openEditor();
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
  GM_registerMenuCommand('Annotate current frame', () => openEditor());
  registerShortcutMenus();
  registerFormatMenu();
  GM_registerMenuCommand('Check for updates', () => checkForUpdate(true));
})();
