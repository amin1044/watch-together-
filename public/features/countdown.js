// شمارش معکوس ۳-۲-۱ تا هر دو نفر دقیقاً همزمان پخش رو شروع کنن
WT.register({
  name: 'countdown',
  init(ctx) {
    const box = ctx.addStageExtra();
    const btn = document.createElement('button');
    btn.textContent = '⏱ شروع همزمان (۳-۲-۱)';
    btn.onclick = () => {
      if (!ctx.currentSrc && !ctx.video.src) return ctx.toast('اول یه ویدیو انتخاب کن');
      ctx.send('countdown');
    };
    box.appendChild(btn);

    const el = document.getElementById('countdown');
    let timers = [];

    ctx.on('countdown', (msg) => {
      timers.forEach(clearTimeout);
      timers = [];
      // همه‌جا موقتاً توقف روی زمان مشخص
      ctx.applyState({ playing: false, time: msg.time, rate: msg.rate || 1 });

      el.classList.remove('hidden');
      const show = (t) => { el.innerHTML = ''; const s = document.createElement('span'); s.textContent = t; el.appendChild(s); };
      for (let i = 0; i < msg.seconds; i++) {
        timers.push(setTimeout(() => show(String(msg.seconds - i)), i * 1000));
      }
      timers.push(setTimeout(() => {
        show('▶');
        ctx.applyState({ playing: true, time: msg.time, rate: msg.rate || 1 });
        if (msg.from === ctx.me.id) ctx.sendState();
      }, msg.seconds * 1000));
      timers.push(setTimeout(() => el.classList.add('hidden'), msg.seconds * 1000 + 700));
    });
  },
});
