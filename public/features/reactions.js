// ری‌اکشن‌های شناور روی ویدیو (کاملاً سمت کلاینت، با sendPlugin/onPlugin؛ بدون هیچ کدی تو سرور)
WT.register({
  name: 'reactions',
  init(ctx) {
    const bar = ctx.addStageExtra();
    bar.className = 'react-bar';
    const emojis = ['❤️', '😂', '😮', '😢', '🔥', '👏', '😍', '🍿'];

    function floatEmoji(e) {
      const el = document.createElement('div');
      el.className = 'float-emoji';
      el.textContent = e;
      el.style.left = 8 + Math.random() * 84 + '%';
      ctx.overlay.appendChild(el);
      setTimeout(() => el.remove(), 2700);
    }

    emojis.forEach((e) => {
      const b = document.createElement('button');
      b.textContent = e;
      b.onclick = () => {
        floatEmoji(e);
        ctx.sendPlugin('reactions', { emoji: e });
      };
      bar.appendChild(b);
    });

    ctx.onPlugin('reactions', (data) => {
      if (data && emojis.includes(data.emoji)) floatEmoji(data.emoji);
    });
  },
});
