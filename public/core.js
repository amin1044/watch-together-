// =====================================================================
//  هسته‌ی تماشای مشترک
//  اتصال، همگام‌سازی ویدیو، سیستم افزونه (WT.register)
//
//  WT.register({
//    name: 'myFeature',
//    init(ctx) { ... },            // یک بار بعد از اولین ورود به اتاق
//    onMessage(msg, ctx) { ... },  // (اختیاری) هر پیام خام سرور
//  });
//
//  ctx:
//    video, player, overlay       المنت‌ها (player = کانتینر تمام‌صفحه)
//    me, users(), hostId          کاربر فعلی، حاضرین، میزبان
//    isHost(), canControl()       دسترسی‌ها
//    currentSrc                   لینک ویدیوی فعلی
//    send(type, payload)          پیام خام به سرور (نیاز به هندلر تو server.js)
//    on(type, fn)                 گوش دادن به پیام خام سرور
//    sendPlugin(name, data)       فرستادن داده به افزونه‌ی هم‌نام بقیه (بدون تغییر سرور)
//    onPlugin(name, fn)           دریافت: fn(data, fromId)
//    addSidePanel(title, opts)    تب جدید => { body, show(), setBadge(n), active, onShow }
//    addStageExtra()              ظرف جدید زیر ویدیو
//    applyState(state), sendState()   کنترل همگام پخش
//    toggleFullscreen()
//    toast(text)
// =====================================================================

(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const features = [];
  const typeListeners = {};
  const pluginListeners = {};

  let ws = null;
  let joined = false;
  let fatal = false;
  let retry = 0;
  let reconnectTimer = null;
  let featuresReady = false;

  const me = { id: null, name: '' };
  let users = [];
  let hostId = null;
  let controlMode = 'all';
  let roomId = '';
  let roomPassword = '';

  const video = $('video');
  const player = $('player');
  let lastApplied = null; // آخرین وضعیتی که خودمون اعمال یا ارسال کردیم (برای جلوگیری از بازتاب)
  let currentSrc = null;
  let currentFileName = null;
  let localFileName = null;
  let objectUrl = null;
  let pendingState = null;
  let syncAfterLoad = false;
  let hls = null;
  let hlsPromise = null;

  // ---------------------------------------------------------------
  //  ابزارها
  // ---------------------------------------------------------------
  function toast(text, ms = 3500) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms);
  }

  function send(type, payload = {}) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type, ...payload }));
      return true;
    }
    return false;
  }

  const on = (type, fn) => (typeListeners[type] ||= []).push(fn);
  const onPlugin = (name, fn) => (pluginListeners[name] ||= []).push(fn);
  const isHost = () => me.id !== null && me.id === hostId;
  const canControl = () => controlMode === 'all' || isHost();

  function randomRoom() {
    const c = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }

  function setStatus(s) {
    const el = $('status');
    el.className = 'status ' + s;
    el.title = s === 'ok' ? 'متصل' : s === 'down' ? 'قطع شد؛ در حال اتصال مجدد...' : 'در حال اتصال...';
  }

  // ---------------------------------------------------------------
  //  ویدیو
  // ---------------------------------------------------------------
  function teardownHls() {
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
  }

  function ensureHls() {
    if (window.Hls) return Promise.resolve();
    if (!hlsPromise) {
      hlsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
        s.onload = resolve;
        s.onerror = () => { hlsPromise = null; reject(new Error('hls.js load failed')); };
        document.head.appendChild(s);
      });
    }
    return hlsPromise;
  }

  function loadSource(src) {
    teardownHls();
    if (objectUrl && src !== objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      localFileName = null;
    }
    currentSrc = src || null;
    $('emptyHint').classList.toggle('hidden', !!src);
    $('tapPlay').classList.add('hidden');
    if (!src) {
      video.removeAttribute('src');
      video.load();
      return;
    }
    const isHls = /\.m3u8(\?|#|$)/i.test(src);
    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      const mine = src;
      ensureHls()
        .then(() => {
          if (currentSrc !== mine) return;
          if (window.Hls && Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(mine);
            hls.attachMedia(video);
          } else {
            toast('این مرورگر از HLS پشتیبانی نمی‌کنه');
          }
        })
        .catch(() => toast('کتابخونه‌ی HLS لود نشد'));
    } else {
      video.src = src;
      video.load();
    }
  }

  function tryPlay() {
    const p = video.play();
    if (p && p.catch) p.catch(() => $('tapPlay').classList.remove('hidden'));
  }

  function applyState(s, opts = {}) {
    if (!currentSrc) return;
    if (video.readyState === 0) { pendingState = s; return; }
    if (opts.periodic && (video.seeking || video.readyState < 3)) return;

    const th = s.playing ? (opts.periodic ? 1.5 : 0.7) : 0.3;
    const needSeek = Math.abs(video.currentTime - s.time) > th;
    const needRate = s.rate && Math.abs(video.playbackRate - s.rate) > 0.01;
    const needPlay = s.playing && video.paused;
    const needPause = !s.playing && !video.paused;
    if (!(needSeek || needRate || needPlay || needPause)) return;

    lastApplied = { playing: !!s.playing, time: s.time, rate: s.rate || video.playbackRate, at: Date.now() };
    if (needSeek) video.currentTime = s.time;
    if (needRate) video.playbackRate = s.rate;
    if (needPlay) tryPlay();
    if (needPause) video.pause();
  }

  function curState() {
    return { playing: !video.paused && !video.ended, time: video.currentTime, rate: video.playbackRate };
  }

  // آیا وضعیت فعلی همون چیزیه که خودمون (یا بقیه) قبلاً اعمال کردیم؟ اگه آره، رویداد بازتابه و ارسال نمی‌شه.
  function isEcho(cur) {
    const l = lastApplied;
    if (!l) return false;
    const expected = l.playing ? l.time + ((Date.now() - l.at) / 1000) * l.rate : l.time;
    return cur.playing === l.playing && Math.abs(cur.time - expected) < 1.2 && Math.abs(cur.rate - l.rate) < 0.01;
  }

  function sendState() {
    const cur = curState();
    lastApplied = { ...cur, at: Date.now() };
    send('state', cur);
  }

  function handleSource(src, fileName, playing) {
    currentFileName = fileName || null;
    pendingState = playing ? { playing: true, time: 0, rate: 1 } : null;
    $('hint').textContent = '';
    if (src) { loadSource(src); return; }
    if (fileName) {
      if (localFileName === fileName && objectUrl) {
        applyState({ playing: !!playing, time: 0, rate: 1 });
        return;
      }
      loadSource(null);
      $('hint').textContent = `🎞 فایل «${fileName}» انتخاب شده. همون فایل رو از کامپیوتر خودت هم انتخاب کن.`;
      return;
    }
    loadSource(null);
  }

  function toggleFullscreen() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (player.requestFullscreen || player.webkitRequestFullscreen) {
      (player.requestFullscreen || player.webkitRequestFullscreen).call(player);
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen(); // iPhone
    }
  }

  // ---------------------------------------------------------------
  //  رابط
  // ---------------------------------------------------------------
  function renderUsers() {
    const box = $('users');
    box.innerHTML = '';
    for (const u of users) {
      const d = document.createElement('span');
      d.className = 'u' + (u.id === me.id ? ' me' : '');
      d.textContent = (u.host ? '👑 ' : '') + u.name;
      box.appendChild(d);
    }
  }

  function addSidePanel(title, opts = {}) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    const label = document.createElement('span');
    label.textContent = (opts.icon ? opts.icon + ' ' : '') + title;
    const badge = document.createElement('span');
    badge.className = 'badge hidden';
    tab.append(label, badge);

    const body = document.createElement('div');
    body.className = 'tab-panel hidden';
    $('tabs').appendChild(tab);
    $('tabPanels').appendChild(body);

    const api = {
      body, tab, active: false, onShow: null,
      show() {
        document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('#tabPanels .tab-panel').forEach((p) => p.classList.add('hidden'));
        tab.classList.add('active');
        body.classList.remove('hidden');
        document.querySelectorAll('#tabs .tab').forEach((t) => (t._api && (t._api.active = false)));
        api.active = true;
        if (api.onShow) api.onShow();
      },
      setBadge(n) {
        badge.textContent = n;
        badge.classList.toggle('hidden', !n);
      },
    };
    tab._api = api;
    tab.onclick = api.show;
    if ($('tabs').children.length === 1) api.show();
    return api;
  }

  function addStageExtra() {
    const d = document.createElement('div');
    $('stageExtras').appendChild(d);
    return d;
  }

  const ctx = {
    video,
    player,
    overlay: $('overlay'),
    get me() { return me; },
    get hostId() { return hostId; },
    get controlMode() { return controlMode; },
    get roomId() { return roomId; },
    get currentSrc() { return currentSrc; },
    users: () => users,
    isHost,
    canControl,
    send,
    on,
    sendPlugin: (name, data) => send('plugin', { name, data }),
    onPlugin,
    addSidePanel,
    addStageExtra,
    applyState,
    sendState,
    toggleFullscreen,
    toast,
  };

  // ---------------------------------------------------------------
  //  پیام‌های سرور
  // ---------------------------------------------------------------
  function onWelcome(msg) {
    joined = true;
    me.id = msg.you;
    users = msg.users;
    hostId = msg.hostId;
    controlMode = msg.controlMode;
    renderUsers();
    setStatus('ok');
    $('lobby').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('joinBtn').disabled = false;

    const st = msg.state;
    if (st.src && st.src === currentSrc) {
      applyState(st);
    } else {
      handleSource(st.src, st.fileName, false);
      if (st.src || st.fileName) pendingState = st;
    }

    if (!featuresReady) {
      featuresReady = true;
      features.forEach((f) => f.init && f.init(ctx));
    }
  }

  function showLobbyError(text) {
    $('app').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    const e = $('lobbyError');
    e.textContent = text;
    e.classList.remove('hidden');
    $('joinBtn').disabled = false;
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        onWelcome(msg);
        break;
      case 'users':
        users = msg.users;
        hostId = (users.find((u) => u.host) || {}).id ?? null;
        renderUsers();
        break;
      case 'settings':
        controlMode = msg.controlMode;
        toast(controlMode === 'all' ? 'حالا همه می‌تونن ویدیو رو کنترل کنن' : 'حالا فقط میزبان ویدیو رو کنترل می‌کنه');
        break;
      case 'state':
        applyState(msg, { periodic: msg.reason === 'sync' });
        break;
      case 'source':
        handleSource(msg.src, msg.fileName, msg.playing);
        break;
      case 'denied':
        toast('الان فقط میزبان می‌تونه ویدیو رو کنترل کنه 👑');
        break;
      case 'toast':
        toast(msg.text);
        break;
      case 'error':
        fatal = true;
        showLobbyError(msg.text || 'خطا');
        break;
      case 'plugin':
        (pluginListeners[msg.name] || []).forEach((fn) => fn(msg.data, msg.from));
        break;
    }
    (typeListeners[msg.type] || []).forEach((fn) => fn(msg));
    features.forEach((f) => f.onMessage && f.onMessage(msg, ctx));
  }

  // ---------------------------------------------------------------
  //  اتصال (با اتصال مجدد خودکار)
  // ---------------------------------------------------------------
  function connect() {
    clearTimeout(reconnectTimer);
    setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}`);
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      send('join', { room: roomId, name: me.name, password: roomPassword });
    };
    sock.onmessage = (e) => {
      try { handleMessage(JSON.parse(e.data)); } catch (err) { console.error(err); }
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      const wasJoined = joined;
      joined = false;
      if (fatal) return;
      setStatus('down');
      if (wasJoined) toast('اتصال قطع شد؛ دارم دوباره وصل می‌شم...', 4000);
      retry++;
      reconnectTimer = setTimeout(connect, Math.min(1000 * retry, 8000));
    };
  }

  function enterRoom() {
    me.name = $('nameInput').value.trim() || 'مهمان';
    roomId = $('roomInput').value.trim() || randomRoom();
    roomPassword = $('passInput').value;
    localStorage.setItem('wt_name', me.name);
    fatal = false;
    $('lobbyError').classList.add('hidden');
    $('joinBtn').disabled = true;
    history.replaceState(null, '', `/r/${encodeURIComponent(roomId)}`);
    $('roomLabel').textContent = roomId;
    document.title = `تماشای مشترک · ${roomId}`;
    connect();
  }

  // ---------------------------------------------------------------
  //  رویدادهای UI
  // ---------------------------------------------------------------
  function start() {
    $('nameInput').value = localStorage.getItem('wt_name') || '';
    const m = location.pathname.match(/^\/r\/([^/]+)/);
    if (m) $('roomInput').value = decodeURIComponent(m[1]);

    $('joinBtn').onclick = enterRoom;
    [$('nameInput'), $('roomInput'), $('passInput')].forEach((i) =>
      i.addEventListener('keydown', (e) => e.key === 'Enter' && enterRoom())
    );

    $('copyLink').onclick = async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        toast('لینک دعوت کپی شد ✅');
      } catch {
        prompt('این لینک رو کپی کن:', location.href);
      }
    };

    $('loadUrl').onclick = () => {
      const url = $('urlInput').value.trim();
      if (!url) return;
      if (!canControl()) return toast('الان فقط میزبان می‌تونه ویدیو عوض کنه 👑');
      send('source', { src: url });
      $('urlInput').value = '';
    };
    $('urlInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('loadUrl').click());

    $('fileInput').onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const nameMatches = currentFileName === f.name;
      if (!nameMatches && !canControl()) return toast('الان فقط میزبان می‌تونه ویدیو عوض کنه 👑');

      const url = URL.createObjectURL(f);
      loadSource(url); // آبجکت قبلی رو آزاد می‌کنه
      objectUrl = url;
      localFileName = f.name;
      currentFileName = f.name;
      $('hint').textContent = '';
      syncAfterLoad = true;
      pendingState = null;
      if (!nameMatches) send('source', { src: null, fileName: f.name });
    };

    $('syncBtn').onclick = () => {
      if (!canControl()) { send('sync'); return toast('زمان رو از اتاق گرفتم'); }
      sendState();
      toast('وضعیت تو برای بقیه فرستاده شد');
    };
    $('fsBtn').onclick = toggleFullscreen;

    $('tapPlay').onclick = () => {
      $('tapPlay').classList.add('hidden');
      video.play().catch(() => {});
    };

    ['play', 'pause', 'seeked', 'ratechange'].forEach((ev) =>
      video.addEventListener(ev, () => { if (!isEcho(curState())) sendState(); })
    );
    video.addEventListener('ended', () => currentSrc && send('ended', { src: currentSrc }));

    video.addEventListener('loadedmetadata', () => {
      if (pendingState) { const s = pendingState; pendingState = null; applyState(s); }
      if (syncAfterLoad) { syncAfterLoad = false; send('sync'); }
    });
    video.addEventListener('error', () => {
      if (currentSrc) {
        const isMkv = /\.mkv(\?|#|$)/i.test(currentSrc);
        toast(
          isMkv
            ? 'فرمت MKV در بیشتر مرورگرها پشتیبانی نمی‌شود. فایل را به MP4 تبدیل کنید یا از لینک mp4/webm/m3u8 استفاده کنید.'
            : 'ویدیو لود نشد. لینک باید مستقیم باشد و فرمتش (mp4 / webm / m3u8) پشتیبانی شود. CORS یا مسدود بودن لینک هم می‌تواند علت باشد.',
          7000
        );
      }
    });

    // اصلاح دوره‌ای انحراف + نگه داشتن اتصال
    setInterval(() => joined && send('sync'), 5000);
  }

  window.WT = {
    register(feature) { features.push(feature); },
    ctx,
  };

  document.addEventListener('DOMContentLoaded', start);
})();
