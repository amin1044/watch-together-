// میانبرهای کیبورد: Space/K پخش‌وتوقف · ←/→ ۱۰ ثانیه · J/L ۱۰ ثانیه · ↑/↓ صدا · M بی‌صدا · F تمام‌صفحه
WT.register({
  name: 'hotkeys',
  init(ctx) {
    const v = ctx.video;

    document.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const seek = (d) => {
        v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + d));
        ctx.toast(d > 0 ? `⏩ ${d}s` : `⏪ ${-d}s`, 900);
      };

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (v.paused) v.play().catch(() => {}); else v.pause();
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          seek(10);
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          seek(-10);
          break;
        case 'arrowup':
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.1);
          ctx.toast(`🔊 ${Math.round(v.volume * 100)}%`, 700);
          break;
        case 'arrowdown':
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.1);
          ctx.toast(`🔉 ${Math.round(v.volume * 100)}%`, 700);
          break;
        case 'm':
          v.muted = !v.muted;
          ctx.toast(v.muted ? '🔇 بی‌صدا' : '🔊 با صدا', 700);
          break;
        case 'f':
          ctx.toggleFullscreen();
          break;
      }
    });
  },
});
