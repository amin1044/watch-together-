// تماس صوتی/تصویری + اشتراک صفحه (WebRTC، اتصال مستقیم بین همه‌ی افراد)
// سیگنالینگ از طریق سرور (ctx.send('signal')) و اعلان‌ها از طریق ctx.sendPlugin('call').
// الگوی "Perfect Negotiation" برای جلوگیری از تداخل offer ها.
// برای عبور از NAT های سخت می‌تونی TURN رو با متغیر محیطی ICE_SERVERS روی سرور ست کنی (README).
WT.register({
  name: 'call',
  init(ctx) {
    const grid = document.getElementById('callGrid');
    const screenView = document.getElementById('screenView');

    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

    // ---------- UI ----------
    const bar = ctx.addStageExtra();
    bar.className = 'call-bar';
    const mk = (text, title) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title || '';
      return b;
    };
    const joinBtn = mk('📞 ورود به تماس', 'تماس صوتی با بقیه');
    const micBtn = mk('🎤', 'میکروفون');
    const camBtn = mk('📷', 'دوربین');
    const shareBtn = mk('🖥 اشتراک صفحه', 'صفحه یا تب خودت رو نشون بده (مثلاً نتفلیکس/یوتیوب)');
    const localShareBtn = mk('📡 استریم ویدیو', 'ویدیوی محلی (فایلی که انتخاب کردی) رو برای بقیه استریم کن — فقط یک نفر لازم است فایل را داشته باشد');
    [micBtn, camBtn, shareBtn].forEach((b) => b.classList.add('hidden'));
    localShareBtn.classList.add('hidden'); // updateUI وقتی فایل محلی لود شد نشانش می‌دهد
    if (!canShare) shareBtn.remove();
    const banner = document.createElement('div');
    banner.className = 'share-banner hidden';
    bar.append(joinBtn, micBtn, camBtn, shareBtn, localShareBtn, banner);

    // ---------- وضعیت ----------
    let inCall = false;
    let localStream = null;
    let camTrack = null;
    let screenStream = null;
    let localShareStream = null; // استریم ویدیوی محلی با captureStream
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    const peers = new Map(); // id -> peer
    let selfTile = null;
    let screenOwner = null;
    let prevMainMuted = false;
    let shareKind = null; // 'screen' | 'local' | null

    fetch('/config').then((r) => r.json()).then((c) => c.iceServers && (iceServers = c.iceServers)).catch(() => {});
    ctx.on('welcome', (m) => { if (m.iceServers) iceServers = m.iceServers; });

    const nameOf = (id) => (ctx.users().find((u) => u.id === id) || {}).name || '؟';

    // ---------- کاشی‌ها ----------
    function makeTile(name, muted) {
      const el = document.createElement('div');
      el.className = 'tile';
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = !!muted;
      const av = document.createElement('div');
      av.className = 'avatar';
      av.textContent = (name || '؟').trim().charAt(0).toUpperCase();
      const nm = document.createElement('span');
      nm.className = 'tname';
      nm.textContent = name;
      el.append(v, av, nm);
      grid.appendChild(el);
      grid.classList.remove('hidden');
      return { el, video: v };
    }

    function refreshTile(tile) {
      const st = tile.video.srcObject;
      const has = !!st && st.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted && t.enabled);
      tile.el.classList.toggle('has-video', has);
    }

    function removeTile(tile) {
      if (!tile) return;
      tile.video.srcObject = null;
      tile.el.remove();
      if (!grid.children.length) grid.classList.add('hidden');
    }

    function watchStream(tile, stream) {
      const upd = () => refreshTile(tile);
      stream.addEventListener('addtrack', (e) => { hookTrack(e.track, upd); upd(); });
      stream.addEventListener('removetrack', upd);
      stream.getTracks().forEach((t) => hookTrack(t, upd));
      upd();
    }
    function hookTrack(t, upd) {
      t.onmute = upd;
      t.onunmute = upd;
      t.onended = upd;
    }

    // ---------- اشتراک صفحه / استریم ویدیوی محلی (نمایش) ----------
    function showScreen(peer, stream, kind) {
      screenOwner = peer.id;
      shareKind = kind || 'screen';
      if (screenView.srcObject !== stream) screenView.srcObject = stream;
      screenView.classList.remove('hidden');
      screenView.play().catch(() => {});
      prevMainMuted = ctx.video.muted;
      ctx.video.muted = true; // تا صدای ویدیوی همگام با صدای اشتراک قاطی نشه
      const label = kind === 'local' ? 'ویدیوی محلی رو داره استریم می‌کنه 📡' : 'صفحه‌ش رو نشون می‌ده 🖥';
      ctx.toast(`${nameOf(peer.id)} ${label}`);
      const end = () => { if (screenOwner === peer.id) hideScreen(); };
      stream.addEventListener('removetrack', () => { if (!stream.getTracks().length) end(); });
      stream.getVideoTracks().forEach((t) => { t.onended = end; t.onmute = () => setTimeout(() => t.muted && end(), 1500); });
    }

    function hideScreen() {
      if (screenOwner === null) return;
      screenOwner = null;
      shareKind = null;
      screenView.srcObject = null;
      screenView.classList.add('hidden');
      ctx.video.muted = prevMainMuted;
    }

    // ---------- ارتباط با هر نفر ----------
    function addTrack(peer, track, stream) {
      try {
        const s = peer.pc.addTrack(track, stream);
        peer.senders.set(track.id, s);
      } catch (e) { console.error(e); }
    }

    function classify(peer, stream) {
      if (peer.screenIds.has(stream.id)) {
        if (peer.tile && peer.tile.video.srcObject === stream) { peer.tile.video.srcObject = null; refreshTile(peer.tile); }
        const kind = peer.shareKinds && peer.shareKinds.get(stream.id) || 'screen';
        showScreen(peer, stream, kind);
      } else {
        if (!peer.tile) peer.tile = makeTile(nameOf(peer.id), false);
        if (peer.tile.video.srcObject !== stream) {
          peer.tile.video.srcObject = stream;
          watchStream(peer.tile, stream);
        }
        peer.tile.video.play().catch(() => {});
      }
    }

    function getPeer(id) {
      let peer = peers.get(id);
      if (peer) return peer;
      const pc = new RTCPeerConnection({ iceServers });
      peer = { id, pc, polite: ctx.me.id < id, makingOffer: false, ignoreOffer: false, screenIds: new Set(), shareKinds: new Map(), streams: new Map(), senders: new Map(), tile: null };
      peers.set(id, peer);

      pc.onicecandidate = ({ candidate }) => { if (candidate) ctx.send('signal', { to: id, data: { candidate } }); };
      pc.onnegotiationneeded = async () => {
        try {
          peer.makingOffer = true;
          await pc.setLocalDescription();
          ctx.send('signal', { to: id, data: { description: pc.localDescription } });
        } catch (e) { console.error(e); }
        finally { peer.makingOffer = false; }
      };
      pc.ontrack = ({ streams }) => {
        const stream = streams && streams[0];
        if (!stream) return;
        peer.streams.set(stream.id, stream);
        classify(peer, stream);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && pc.restartIce) pc.restartIce();
      };

      if (localStream) localStream.getTracks().forEach((t) => addTrack(peer, t, localStream));
      if (screenStream) screenStream.getTracks().forEach((t) => addTrack(peer, t, screenStream));
      if (localShareStream) localShareStream.getTracks().forEach((t) => addTrack(peer, t, localShareStream));
      return peer;
    }

    function closePeer(id) {
      const peer = peers.get(id);
      if (!peer) return;
      peers.delete(id);
      try { peer.pc.close(); } catch {}
      removeTile(peer.tile);
      if (screenOwner === id) hideScreen();
    }

    // ---------- سیگنالینگ ----------
    ctx.on('signal', async (msg) => {
      if (!inCall) return;
      const peer = getPeer(msg.from);
      const pc = peer.pc;
      const { description, candidate } = msg.data || {};
      try {
        if (description) {
          const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) return;
          await pc.setRemoteDescription(description);
          if (description.type === 'offer') {
            await pc.setLocalDescription();
            ctx.send('signal', { to: peer.id, data: { description: pc.localDescription } });
          }
        } else if (candidate) {
          try { await pc.addIceCandidate(candidate); }
          catch (e) { if (!peer.ignoreOffer) throw e; }
        }
      } catch (e) { console.error('signal error', e); }
    });

    ctx.onPlugin('call', (data, from) => {
      if (!data) return;
      if (data.t === 'join') {
        if (!inCall) return;
        // اگه خودم دارم صفحه یا ویدیوی محلی رو نشون می‌دم، شناسه‌ش رو دوباره اعلام می‌کنم
        if (screenStream) ctx.sendPlugin('call', { t: 'screen', on: true, streamId: screenStream.id, kind: 'screen' });
        if (localShareStream) ctx.sendPlugin('call', { t: 'screen', on: true, streamId: localShareStream.id, kind: 'local' });
        getPeer(from);
      } else if (data.t === 'leave') {
        closePeer(from);
      } else if (data.t === 'screen') {
        if (!inCall) return;
        const peer = getPeer(from);
        if (data.on) {
          peer.screenIds.add(data.streamId);
          peer.shareKinds.set(data.streamId, data.kind || 'screen');
          const st = peer.streams.get(data.streamId);
          if (st) classify(peer, st);
        } else {
          peer.screenIds.delete(data.streamId);
          peer.shareKinds.delete(data.streamId);
          if (screenOwner === from) hideScreen();
        }
      }
    });

    // کسی از اتاق رفت => اتصالش رو ببند
    ctx.on('users', (msg) => {
      const ids = new Set(msg.users.map((u) => u.id));
      [...peers.keys()].forEach((id) => { if (!ids.has(id)) closePeer(id); });
    });

    // بعد از قطع و وصل شدن (شناسه عوض می‌شه) تماس بسته می‌شه
    let welcomed = false;
    ctx.on('welcome', () => {
      if (welcomed && inCall) { leaveCall(true); ctx.toast('بعد از قطع اتصال، تماس بسته شد؛ دوباره وارد شو'); }
      welcomed = true;
    });

    // ---------- کنترل‌ها ----------
    function updateUI() {
      joinBtn.textContent = inCall ? '📴 خروج از تماس' : '📞 ورود به تماس';
      joinBtn.classList.toggle('danger', inCall);
      [micBtn, camBtn, shareBtn].forEach((b) => b.classList.toggle('hidden', !inCall));
      const audio = localStream && localStream.getAudioTracks()[0];
      micBtn.textContent = audio && !audio.enabled ? '🔇' : '🎤';
      micBtn.classList.toggle('danger', !!audio && !audio.enabled);
      camBtn.textContent = camTrack ? '📷 روشن' : '📷';
      camBtn.classList.toggle('on', !!camTrack);
      shareBtn.textContent = screenStream ? '⏹ توقف اشتراک' : '🖥 اشتراک صفحه';
      shareBtn.classList.toggle('on', !!screenStream);
      localShareBtn.textContent = localShareStream ? '⏹ توقف استریم' : '📡 استریم ویدیو';
      localShareBtn.classList.toggle('on', !!localShareStream);
      // دکمه استریم وقتی فایل محلی لود شده دیده می‌شود (حتی قبل از ورود به تماس)
      const hasLocalVideo = !!(ctx.video && ctx.video.src && ctx.video.src.startsWith('blob:'));
      localShareBtn.classList.toggle('hidden', !localShareStream && !hasLocalVideo);
      const sharing = !!(screenStream || localShareStream);
      banner.classList.toggle('hidden', !sharing);
      if (localShareStream) banner.textContent = '📡 داری ویدیوی محلی رو برای بقیه استریم می‌کنی';
      else if (screenStream) banner.textContent = '🖥 داری صفحه‌ت رو نشون می‌دی';
      else banner.textContent = '';
    }

    async function joinCall() {
      if (!hasMedia) return ctx.toast('تماس فقط روی https (یا localhost) کار می‌کنه');
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        return ctx.toast('به میکروفون دسترسی نداشتم. اجازه‌ی مرورگر رو چک کن.');
      }
      inCall = true;
      selfTile = makeTile(ctx.me.name + ' (تو)', true);
      selfTile.video.srcObject = localStream;
      watchStream(selfTile, localStream);
      updateUI();
      ctx.sendPlugin('call', { t: 'join' });
      ctx.toast('وارد تماس شدی 🎧 (با هدفون بهتره تا اکو نشه)');
    }

    function leaveCall(silent) {
      if (!inCall) return;
      if (screenStream) stopScreen();
      if (localShareStream) stopLocalShare();
      ctx.sendPlugin('call', { t: 'leave' });
      [...peers.keys()].forEach(closePeer);
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      camTrack = null;
      removeTile(selfTile);
      selfTile = null;
      hideScreen();
      inCall = false;
      updateUI();
      if (!silent) ctx.toast('از تماس خارج شدی');
    }

    function toggleMic() {
      const a = localStream && localStream.getAudioTracks()[0];
      if (!a) return;
      a.enabled = !a.enabled;
      updateUI();
    }

    async function toggleCam() {
      if (camTrack) {
        const id = camTrack.id;
        camTrack.stop();
        localStream.removeTrack(camTrack);
        peers.forEach((p) => {
          const s = p.senders.get(id);
          if (s) { try { p.pc.removeTrack(s); } catch {} p.senders.delete(id); }
        });
        camTrack = null;
        refreshTile(selfTile);
        updateUI();
        return;
      }
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 24 } });
        camTrack = vs.getVideoTracks()[0];
        localStream.addTrack(camTrack);
        peers.forEach((p) => addTrack(p, camTrack, localStream));
        refreshTile(selfTile);
        updateUI();
      } catch {
        ctx.toast('به دوربین دسترسی نداشتم');
      }
    }

    async function startScreen() {
      if (localShareStream) stopLocalShare();
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      } catch {
        screenStream = null;
        return;
      }
      // اول اعلان (تا دریافت‌کننده بدونه این استریم صفحه‌ست)، بعد اضافه کردن ترک‌ها
      ctx.sendPlugin('call', { t: 'screen', on: true, streamId: screenStream.id, kind: 'screen' });
      peers.forEach((p) => screenStream.getTracks().forEach((t) => addTrack(p, t, screenStream)));
      screenStream.getVideoTracks()[0].onended = stopScreen;
      updateUI();
    }

    function stopScreen() {
      if (!screenStream) return;
      const s = screenStream;
      screenStream = null;
      s.getTracks().forEach((t) => {
        t.stop();
        peers.forEach((p) => {
          const sender = p.senders.get(t.id);
          if (sender) { try { p.pc.removeTrack(sender); } catch {} p.senders.delete(t.id); }
        });
      });
      ctx.sendPlugin('call', { t: 'screen', on: false, streamId: s.id });
      updateUI();
    }

    // استریم ویدیوی محلی با captureStream — فقط یک نفر فایل را نیاز دارد
    // اگر هنوز در تماس نیست، خودش وارد تماس می‌شود
    async function startLocalShare() {
      if (screenStream) stopScreen();
      const video = ctx.video;
      if (!video || !video.src || !video.src.startsWith('blob:')) {
        return ctx.toast('اول یک فایل ویدیو از سیستم خودت انتخاب کن');
      }
      if (typeof video.captureStream !== 'function' && typeof video.mozCaptureStream !== 'function') {
        return ctx.toast('این مرورگر از استریم ویدیوی محلی پشتیبانی نمی‌کند (Chrome/Edge/Firefox پیشنهاد می‌شود)');
      }

      // اگر در تماس نیست، خودکار وارد شو (برای برقراری WebRTC لازم است)
      if (!inCall) {
        ctx.toast('برای استریم، وارد تماس می‌شوی...');
        await joinCall();
        if (!inCall) return; // join ناموفق بود (مثلاً اجازه میکروفون نداد)
      }

      try {
        // captureStream بازتاب وضعیت فعلی پخش (پلی/توقف/جلو-عقب) را به بقیه می‌فرستد
        localShareStream = (video.captureStream || video.mozCaptureStream).call(video, 25);
      } catch (e) {
        console.error(e);
        return ctx.toast('نتوانستم از ویدیو استریم بگیرم');
      }
      if (!localShareStream || !localShareStream.getTracks().length) {
        localShareStream = null;
        return ctx.toast('استریم خالی بود — مطمئن شو ویدیو لود شده');
      }
      ctx.sendPlugin('call', { t: 'screen', on: true, streamId: localShareStream.id, kind: 'local' });
      peers.forEach((p) => localShareStream.getTracks().forEach((t) => addTrack(p, t, localShareStream)));
      localShareStream.getVideoTracks().forEach((t) => { t.onended = stopLocalShare; });
      updateUI();
      ctx.toast('ویدیوی محلی برای بقیه استریم شد 📡 — بقیه هم باید وارد تماس شوند');
    }

    function stopLocalShare() {
      if (!localShareStream) return;
      const s = localShareStream;
      localShareStream = null;
      // ترک‌های captureStream را stop نکن (متعلق به element هستند)؛ فقط از peerها بردار
      s.getTracks().forEach((t) => {
        peers.forEach((p) => {
          const sender = p.senders.get(t.id);
          if (sender) { try { p.pc.removeTrack(sender); } catch {} p.senders.delete(t.id); }
        });
      });
      ctx.sendPlugin('call', { t: 'screen', on: false, streamId: s.id });
      updateUI();
    }

    joinBtn.onclick = () => (inCall ? leaveCall() : joinCall());
    micBtn.onclick = toggleMic;
    camBtn.onclick = toggleCam;
    shareBtn.onclick = () => (screenStream ? stopScreen() : startScreen());
    localShareBtn.onclick = () => (localShareStream ? stopLocalShare() : startLocalShare());

    // وقتی فایل محلی عوض یا پاک شد، استریم را هم متوقف کن
    const checkLocalSrc = () => {
      if (localShareStream && !(ctx.video && ctx.video.src && ctx.video.src.startsWith('blob:'))) {
        stopLocalShare();
      }
      updateUI();
    };
    ctx.video.addEventListener('emptied', checkLocalSrc);
    ctx.video.addEventListener('loadedmetadata', () => updateUI());

    window.addEventListener('beforeunload', () => { if (inCall) ctx.sendPlugin('call', { t: 'leave' }); });
    updateUI();
  },
});
