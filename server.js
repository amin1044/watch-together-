'use strict';
// =====================================================================
//  سرور تماشای مشترک
//  - سرو فایل‌های استاتیک (public/) + /healthz + /config
//  - اتاق‌ها: رمز اختیاری، میزبان، حالت کنترل (همه / فقط میزبان)
//  - همگام‌سازی پخش، صف پخش، زیرنویس مشترک، چت با تاریخچه
//  - سیگنالینگ WebRTC (پیام‌های هدفمند) برای تماس و اشتراک صفحه
//  - رله‌ی عمومی "plugin" برای قابلیت‌های سمت کلاینت
//  برای قابلیت جدید سمت سرور: یه کلید به آبجکت handlers اضافه کن.
// =====================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_USERS = Number(process.env.MAX_USERS_PER_ROOM) || 12;
const MAX_CHAT_HISTORY = 100;
const MAX_PLAYLIST = 100;
const MAX_SUBTITLE_BYTES = 1.5 * 1024 * 1024;
const MAX_RELAY_BYTES = 32 * 1024; // سقف حجم پیام‌های plugin / signal

// سرورهای ICE برای WebRTC. برای TURN متغیر محیطی ICE_SERVERS رو (JSON) ست کن.
function loadIceServers() {
  const fallback = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (!process.env.ICE_SERVERS) return fallback;
  try {
    const v = JSON.parse(process.env.ICE_SERVERS);
    return Array.isArray(v) ? v : fallback;
  } catch {
    console.warn('ICE_SERVERS معتبر نیست؛ از STUN پیش‌فرض استفاده می‌شه.');
    return fallback;
  }
}
const ICE_SERVERS = loadIceServers();

// ---------------------------------------------------------------------
//  HTTP
// ---------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)',
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, BASE_HEADERS);
    return res.end('Bad request');
  }

  if (url === '/healthz') {
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (url === '/config') {
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ iceServers: ICE_SERVERS }));
  }

  if (url === '/' || url.startsWith('/r/')) url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403, BASE_HEADERS);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, BASE_HEADERS);
      return res.end('Not found');
    }
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------------
//  ابزارها
// ---------------------------------------------------------------------
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const num = (v, def, min, max) => {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
};
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function validUrl(s) {
  s = String(s || '').trim();
  if (!s || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function titleFromUrl(u) {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
    return last || new URL(u).hostname;
  } catch {
    return u.slice(0, 60);
  }
}

// ---------------------------------------------------------------------
//  اتاق‌ها
// ---------------------------------------------------------------------
const rooms = new Map();
let nextClientId = 1;
let nextItemId = 1;

function createRoom(id) {
  return {
    id,
    passHash: null,
    hostId: null,
    controlMode: 'all', // 'all' | 'host'
    clients: new Map(), // ws -> { id, name }
    state: { src: null, fileName: null, playing: false, time: 0, rate: 1, at: Date.now() },
    playlist: [],
    subtitle: null, // { name, vtt }
    chat: [],
    cleanupTimer: null,
  };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except = null) {
  const data = JSON.stringify(msg);
  for (const ws of room.clients.keys()) {
    if (ws !== except && ws.readyState === 1) ws.send(data);
  }
}

function findWs(room, id) {
  for (const [ws, c] of room.clients) if (c.id === id) return ws;
  return null;
}

function currentTime(s) {
  return s.playing ? s.time + ((Date.now() - s.at) / 1000) * s.rate : s.time;
}

function snapshot(room) {
  const s = room.state;
  return { src: s.src, fileName: s.fileName, playing: s.playing, time: currentTime(s), rate: s.rate };
}

function userList(room) {
  return [...room.clients.values()].map((c) => ({ id: c.id, name: c.name, host: c.id === room.hostId }));
}

function canControl(room, client) {
  return room.controlMode === 'all' || client.id === room.hostId;
}

function deny(ws, room) {
  send(ws, { type: 'denied' });
  send(ws, { type: 'state', ...snapshot(room), reason: 'denied' });
}

function setSource(room, { src, fileName, playing = false }) {
  room.state = { src, fileName, playing, time: 0, rate: 1, at: Date.now() };
  room.subtitle = null;
  broadcast(room, { type: 'source', src, fileName, playing });
  broadcast(room, { type: 'subtitle', name: null, vtt: null });
}

function advancePlaylist(room, fromSrc) {
  const idx = room.playlist.findIndex((i) => i.src === fromSrc);
  const next = idx >= 0 ? room.playlist[idx + 1] : null;
  if (next) setSource(room, { src: next.src, fileName: null, playing: true });
  return !!next;
}

// ---------------------------------------------------------------------
//  هندلرها: (ctx) => void  با ctx = { ws, client, room, msg }
// ---------------------------------------------------------------------
const handlers = {
  // --- همگام‌سازی پخش ---
  state({ ws, client, room, msg }) {
    if (!canControl(room, client)) return deny(ws, room);
    const s = room.state;
    s.playing = !!msg.playing;
    s.time = num(msg.time, 0, 0, 1e7);
    s.rate = num(msg.rate, 1, 0.25, 4);
    s.at = Date.now();
    broadcast(room, { type: 'state', from: client.id, playing: s.playing, time: s.time, rate: s.rate }, ws);
  },

  // کلاینت وضعیت فعلی رو می‌خواد (اصلاح دوره‌ای انحراف)
  sync({ ws, room }) {
    send(ws, { type: 'state', ...snapshot(room), reason: 'sync' });
  },

  source({ ws, client, room, msg }) {
    if (!canControl(room, client)) return deny(ws, room);
    if (msg.src) {
      const src = validUrl(msg.src);
      if (!src) return send(ws, { type: 'toast', text: 'لینک معتبر نیست (باید با http یا https شروع بشه)' });
      setSource(room, { src, fileName: null });
    } else {
      const fileName = clean(msg.fileName, 200);
      if (!fileName) return;
      setSource(room, { src: null, fileName });
    }
  },

  // ویدیو تموم شد؛ اگه تو صف بعدی داره، می‌ره سراغش (فقط اولین پیام اثر داره)
  ended({ room, msg }) {
    if (msg.src && msg.src === room.state.src) {
      if (!advancePlaylist(room, msg.src)) room.state.playing = false;
    }
  },

  next({ ws, client, room }) {
    if (!canControl(room, client)) return deny(ws, room);
    if (!room.state.src || !advancePlaylist(room, room.state.src)) {
      send(ws, { type: 'toast', text: 'آیتم بعدی تو صف نیست' });
    }
  },

  countdown({ ws, client, room }) {
    if (!canControl(room, client)) return deny(ws, room);
    const s = room.state;
    const t = currentTime(s);
    s.playing = false;
    s.time = t;
    s.at = Date.now();
    broadcast(room, { type: 'countdown', from: client.id, seconds: 3, time: t, rate: s.rate });
  },

  // --- صف پخش ---
  playlistAdd({ ws, client, room, msg }) {
    const src = validUrl(msg.src);
    if (!src) return send(ws, { type: 'toast', text: 'لینک معتبر نیست' });
    if (room.playlist.length >= MAX_PLAYLIST) return send(ws, { type: 'toast', text: 'صف پر شده' });
    room.playlist.push({ id: nextItemId++, src, title: clean(msg.title, 100) || titleFromUrl(src), by: client.name });
    broadcast(room, { type: 'playlist', items: room.playlist });
  },

  playlistRemove({ ws, client, room, msg }) {
    if (!canControl(room, client)) return deny(ws, room);
    room.playlist = room.playlist.filter((i) => i.id !== Number(msg.id));
    broadcast(room, { type: 'playlist', items: room.playlist });
  },

  playlistPlay({ ws, client, room, msg }) {
    if (!canControl(room, client)) return deny(ws, room);
    const item = room.playlist.find((i) => i.id === Number(msg.id));
    if (item) setSource(room, { src: item.src, fileName: null, playing: true });
  },

  // --- زیرنویس مشترک ---
  subtitle({ ws, room, msg }) {
    const vtt = String(msg.vtt || '');
    if (!vtt) return;
    if (Buffer.byteLength(vtt) > MAX_SUBTITLE_BYTES) {
      return send(ws, { type: 'toast', text: 'فایل زیرنویس خیلی بزرگه' });
    }
    room.subtitle = { name: clean(msg.name, 100) || 'زیرنویس', vtt };
    broadcast(room, { type: 'subtitle', ...room.subtitle });
  },

  subtitleClear({ room }) {
    room.subtitle = null;
    broadcast(room, { type: 'subtitle', name: null, vtt: null });
  },

  // --- چت ---
  chat({ client, room, msg }) {
    const text = clean(msg.text, 500);
    if (!text) return;
    const m = { type: 'chat', id: Date.now() + '-' + client.id, from: client.id, name: client.name, text, ts: Date.now() };
    room.chat.push(m);
    if (room.chat.length > MAX_CHAT_HISTORY) room.chat.shift();
    broadcast(room, m);
  },

  // --- مدیریت اتاق (فقط میزبان) ---
  settings({ ws, client, room, msg }) {
    if (client.id !== room.hostId) return send(ws, { type: 'toast', text: 'فقط میزبان می‌تونه تنظیمات رو عوض کنه' });
    if (msg.controlMode === 'all' || msg.controlMode === 'host') {
      room.controlMode = msg.controlMode;
      broadcast(room, { type: 'settings', controlMode: room.controlMode });
    }
  },

  makeHost({ ws, client, room, msg }) {
    if (client.id !== room.hostId) return send(ws, { type: 'toast', text: 'فقط میزبان می‌تونه میزبانی رو منتقل کنه' });
    const target = findWs(room, Number(msg.id));
    if (!target) return;
    room.hostId = room.clients.get(target).id;
    broadcast(room, { type: 'users', users: userList(room) });
  },

  // --- پیام هدفمند برای سیگنالینگ WebRTC ---
  signal({ client, room, msg }) {
    if (JSON.stringify(msg.data ?? null).length > MAX_RELAY_BYTES) return;
    const target = findWs(room, Number(msg.to));
    if (target) send(target, { type: 'signal', from: client.id, data: msg.data });
  },

  // --- رله‌ی عمومی برای افزونه‌های سمت کلاینت (بدون تغییر سرور) ---
  plugin({ ws, client, room, msg }) {
    if (JSON.stringify(msg.data ?? null).length > MAX_RELAY_BYTES) return;
    const name = clean(msg.name, 40);
    if (!name) return;
    broadcast(room, { type: 'plugin', from: client.id, name, data: msg.data }, ws);
  },
};

// ---------------------------------------------------------------------
//  WebSocket
// ---------------------------------------------------------------------
const wss = new WebSocketServer({ server, maxPayload: 3 * 1024 * 1024 });

// ping دوره‌ای تا اتصال‌های مرده پاک بشن و پروکسی (Render) اتصال بیکار رو نبنده
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

wss.on('connection', (ws) => {
  let room = null;
  let client = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  // محدودیت نرخ پیام (توکن‌باکت)
  let tokens = 120;
  let last = Date.now();

  ws.on('message', (raw) => {
    const now = Date.now();
    tokens = Math.min(120, tokens + ((now - last) / 1000) * 60);
    last = now;
    if (tokens < 1) return;
    tokens -= 1;

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'join') {
      if (client) return;
      const roomId = clean(msg.room, 64);
      if (!roomId) return;
      const name = clean(msg.name, 30) || 'مهمان';
      const pw = String(msg.password || '').slice(0, 64);

      let r = rooms.get(roomId);
      if (r && r.passHash && hash(pw) !== r.passHash) {
        send(ws, { type: 'error', code: 'password', text: 'رمز اتاق اشتباهه' });
        return ws.close();
      }
      if (r && r.clients.size >= MAX_USERS) {
        send(ws, { type: 'error', code: 'full', text: 'اتاق پره' });
        return ws.close();
      }
      if (!r) {
        r = createRoom(roomId);
        if (pw) r.passHash = hash(pw);
        rooms.set(roomId, r);
      }
      room = r;
      clearTimeout(room.cleanupTimer);

      client = { id: nextClientId++, name };
      room.clients.set(ws, client);
      if (room.hostId === null || ![...room.clients.values()].some((c) => c.id === room.hostId)) {
        room.hostId = client.id;
      }

      send(ws, {
        type: 'welcome',
        you: client.id,
        users: userList(room),
        hostId: room.hostId,
        controlMode: room.controlMode,
        hasPassword: !!room.passHash,
        state: snapshot(room),
        playlist: room.playlist,
        subtitle: room.subtitle,
        chat: room.chat,
        iceServers: ICE_SERVERS,
      });
      broadcast(room, { type: 'users', users: userList(room), joined: client.name }, ws);
      return;
    }

    if (!room) return;
    const handler = Object.prototype.hasOwnProperty.call(handlers, msg.type) ? handlers[msg.type] : null;
    if (handler) {
      try {
        handler({ ws, client, room, msg });
      } catch (err) {
        console.error('handler error', msg.type, err);
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.clients.delete(ws);

    if (room.clients.size === 0) {
      const r = room;
      r.cleanupTimer = setTimeout(() => {
        if (r.clients.size === 0 && rooms.get(r.id) === r) rooms.delete(r.id);
      }, 10 * 60 * 1000);
      return;
    }
    if (room.hostId === client.id) room.hostId = room.clients.values().next().value.id;
    broadcast(room, { type: 'users', users: userList(room), left: client.name });
  });
});

server.listen(PORT, () => {
  console.log(`Watch Together روی پورت ${PORT} بالا اومد`);
});
