// زیرنویس مشترک: فایل .srt یا .vtt رو انتخاب کن، برای همه‌ی اتاق نمایش داده می‌شه.
// - انکودینگ فارسی ویندوز (Windows-1256) خودکار تشخیص داده می‌شه
// - تنظیم تأخیر زیرنویس (فقط برای خودت)
WT.register({
  name: 'subtitles',
  init(ctx) {
    const panel = ctx.addSidePanel('زیرنویس', { icon: '🔤' });
    const video = ctx.video;

    const pick = document.createElement('label');
    pick.className = 'filebtn';
    pick.textContent = '📂 انتخاب فایل زیرنویس (srt / vtt)';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.srt,.vtt,text/vtt,application/x-subrip';
    file.hidden = true;
    pick.appendChild(file);

    const info = document.createElement('div');
    info.className = 'muted';
    info.textContent = 'زیرنویسی انتخاب نشده.';

    const clear = document.createElement('button');
    clear.className = 'danger';
    clear.textContent = 'حذف زیرنویس';
    clear.onclick = () => ctx.send('subtitleClear');

    const offsetBox = document.createElement('div');
    offsetBox.className = 'setting';
    const offsetTitle = document.createElement('h4');
    offsetTitle.textContent = 'تأخیر زیرنویس (فقط برای خودت)';
    const offsetRow = document.createElement('div');
    offsetRow.className = 'row';
    const minus = document.createElement('button');
    minus.textContent = '−0.5s';
    const plus = document.createElement('button');
    plus.textContent = '+0.5s';
    const reset = document.createElement('button');
    reset.textContent = 'ریست';
    const offsetLabel = document.createElement('span');
    offsetLabel.dir = 'ltr';
    offsetRow.append(minus, offsetLabel, plus, reset);
    offsetBox.append(offsetTitle, offsetRow);

    panel.body.append(pick, info, clear, offsetBox);

    let baseVtt = null;
    let name = null;
    let offset = 0;
    let trackEl = null;
    let blobUrl = null;

    // ---------- تبدیل و تغییر زمان ----------
    async function readText(f) {
      const buf = await f.arrayBuffer();
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch {
        return new TextDecoder('windows-1256').decode(buf);
      }
    }

    function toVtt(text) {
      text = text.replace(/^﻿/, '').replace(/\r/g, '');
      if (/^WEBVTT/.test(text.trim())) return text;
      return 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    }

    const TS = /(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{3})/g;
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    function shift(vtt, sec) {
      return vtt
        .split('\n')
        .map((line) => {
          if (!line.includes('-->')) return line;
          return line.replace(TS, (_, h, m, s, ms) => {
            let t = (+h || 0) * 3600 + +m * 60 + +s + +ms / 1000 + sec;
            if (t < 0) t = 0;
            const H = Math.floor(t / 3600);
            const M = Math.floor((t % 3600) / 60);
            const S = Math.floor(t % 60);
            const MS = Math.round((t - Math.floor(t)) * 1000);
            return `${pad(H)}:${pad(M)}:${pad(S)}.${pad(MS === 1000 ? 999 : MS, 3)}`;
          });
        })
        .join('\n');
    }

    // ---------- نمایش ----------
    function removeTrack() {
      if (trackEl) { trackEl.remove(); trackEl = null; }
      if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    }

    function render() {
      removeTrack();
      offsetLabel.textContent = (offset > 0 ? '+' : '') + offset.toFixed(1) + 's';
      info.textContent = baseVtt ? `زیرنویس فعال: ${name}` : 'زیرنویسی انتخاب نشده.';
      clear.disabled = !baseVtt;
      if (!baseVtt) return;
      const text = offset ? shift(baseVtt, offset) : baseVtt;
      blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = name;
      trackEl.srclang = 'fa';
      trackEl.default = true;
      trackEl.src = blobUrl;
      video.appendChild(trackEl);
      trackEl.track.mode = 'showing';
    }

    function apply(n, vtt) {
      baseVtt = vtt || null;
      name = n;
      offset = 0;
      render();
    }

    minus.onclick = () => { offset = Math.round((offset - 0.5) * 10) / 10; render(); };
    plus.onclick = () => { offset = Math.round((offset + 0.5) * 10) / 10; render(); };
    reset.onclick = () => { offset = 0; render(); };

    file.onchange = async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      if (f.size > 1.5 * 1024 * 1024) return ctx.toast('فایل زیرنویس خیلی بزرگه');
      try {
        const vtt = toVtt(await readText(f));
        ctx.send('subtitle', { name: f.name, vtt });
      } catch {
        ctx.toast('خوندن فایل زیرنویس ممکن نشد');
      }
    };

    ctx.on('welcome', (msg) => apply(msg.subtitle && msg.subtitle.name, msg.subtitle && msg.subtitle.vtt));
    ctx.on('subtitle', (msg) => apply(msg.name, msg.vtt));
    render();
  },
});
