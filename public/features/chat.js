// چت: تاریخچه، لینک‌های قابل کلیک، دکمه‌ی «پخش» کنار لینک ویدیو، نشانگر پیام خوانده‌نشده
WT.register({
  name: 'chat',
  init(ctx) {
    const panel = ctx.addSidePanel('چت', { icon: '💬' });
    const log = document.createElement('div');
    log.className = 'chat-log';
    const form = document.createElement('form');
    form.className = 'chat-form';
    const input = document.createElement('input');
    input.placeholder = 'یه چیزی بنویس...';
    input.maxLength = 500;
    input.autocomplete = 'off';
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'ارسال';
    form.append(input, btn);
    panel.body.append(log, form);

    let unread = 0;
    panel.onShow = () => { unread = 0; panel.setBadge(0); log.scrollTop = log.scrollHeight; };

    const VIDEO_RE = /\.(mp4|webm|m3u8|ogv|mov|m4v)(\?|#|$)/i;

    function fill(el, text) {
      // متن امن: فقط لینک‌های http(s) به <a> تبدیل می‌شن
      text.split(/(https?:\/\/[^\s]+)/g).forEach((part, i) => {
        if (i % 2 === 0) { el.append(document.createTextNode(part)); return; }
        const a = document.createElement('a');
        a.href = part;
        a.textContent = part;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        el.append(a);
        if (VIDEO_RE.test(part)) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'playlink';
          b.textContent = '▶ پخش';
          b.onclick = () => ctx.send('source', { src: part });
          el.append(b);
        }
      });
    }

    function addMsg(m) {
      const d = document.createElement('div');
      d.className = 'chat-msg' + (m.from === ctx.me.id ? ' me' : '');
      const who = document.createElement('span');
      who.className = 'who';
      const time = new Date(m.ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
      who.textContent = `${m.name} · ${time}`;
      const text = document.createElement('span');
      fill(text, m.text);
      d.append(who, text);
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    function addSys(text) {
      const d = document.createElement('div');
      d.className = 'chat-sys';
      d.textContent = text;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      ctx.send('chat', { text });
      input.value = '';
    };

    ctx.on('welcome', (msg) => {
      log.innerHTML = '';
      (msg.chat || []).forEach(addMsg);
    });

    ctx.on('chat', (m) => {
      addMsg(m);
      if (m.from !== ctx.me.id && !panel.active) panel.setBadge(++unread);
    });

    ctx.on('users', (msg) => {
      if (msg.joined) addSys(`${msg.joined} وارد شد`);
      if (msg.left) addSys(`${msg.left} خارج شد`);
    });
  },
});
