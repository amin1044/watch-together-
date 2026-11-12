// صف پخش مشترک: همه می‌تونن لینک اضافه کنن؛ پخش/حذف/بعدی طبق دسترسی کنترل.
// وقتی ویدیو تموم بشه خودکار می‌ره سراغ آیتم بعدی (سرور تصمیم می‌گیره).
WT.register({
  name: 'playlist',
  init(ctx) {
    const panel = ctx.addSidePanel('صف پخش', { icon: '🎞' });
    let items = [];

    const form = document.createElement('form');
    form.className = 'row-form';
    const url = document.createElement('input');
    url.placeholder = 'لینک ویدیو';
    url.dir = 'ltr';
    const add = document.createElement('button');
    add.className = 'primary';
    add.textContent = 'افزودن';
    form.append(url, add);

    const title = document.createElement('input');
    title.placeholder = 'عنوان (اختیاری)';
    title.maxLength = 100;

    const list = document.createElement('ul');
    list.className = 'pl-list';

    const nextBtn = document.createElement('button');
    nextBtn.textContent = '⏭ آیتم بعدی';
    nextBtn.onclick = () => ctx.send('next');

    panel.body.append(form, title, list, nextBtn);

    form.onsubmit = (e) => {
      e.preventDefault();
      const src = url.value.trim();
      if (!src) return;
      ctx.send('playlistAdd', { src, title: title.value.trim() });
      url.value = '';
      title.value = '';
    };

    function render() {
      list.innerHTML = '';
      if (!items.length) {
        const n = document.createElement('div');
        n.className = 'empty-note';
        n.textContent = 'صف خالیه. چند تا لینک اضافه کن تا پشت سر هم پخش بشن.';
        list.appendChild(n);
        return;
      }
      for (const it of items) {
        const li = document.createElement('li');
        li.className = 'pl-item' + (it.src === ctx.currentSrc ? ' current' : '');
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = it.title;
        t.title = `${it.title} (اضافه‌کننده: ${it.by})`;
        const play = document.createElement('button');
        play.textContent = '▶';
        play.title = 'پخش';
        play.onclick = () => ctx.send('playlistPlay', { id: it.id });
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'حذف';
        del.onclick = () => ctx.send('playlistRemove', { id: it.id });
        li.append(play, t, del);
        list.appendChild(li);
      }
    }

    ctx.on('welcome', (msg) => { items = msg.playlist || []; render(); });
    ctx.on('playlist', (msg) => { items = msg.items; render(); });
    ctx.on('source', () => setTimeout(render, 0));
    render();
  },
});
