// تنظیمات اتاق: لینک دعوت، حالت کنترل (همه / فقط میزبان)، انتقال میزبانی، خروج
WT.register({
  name: 'room',
  init(ctx) {
    const panel = ctx.addSidePanel('اتاق', { icon: '⚙️' });
    const body = panel.body;

    // لینک دعوت
    const inviteBox = document.createElement('div');
    inviteBox.className = 'setting';
    inviteBox.innerHTML = '<h4>لینک دعوت</h4>';
    const inviteRow = document.createElement('div');
    inviteRow.className = 'row-form';
    const link = document.createElement('input');
    link.readOnly = true;
    link.dir = 'ltr';
    link.value = location.href;
    const copy = document.createElement('button');
    copy.textContent = 'کپی';
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); ctx.toast('کپی شد ✅'); }
      catch { link.select(); }
    };
    inviteRow.append(link, copy);
    inviteBox.appendChild(inviteRow);

    // حالت کنترل
    const modeBox = document.createElement('div');
    modeBox.className = 'setting';
    modeBox.innerHTML = '<h4>چه کسی ویدیو رو کنترل می‌کنه؟</h4>';
    const mode = document.createElement('select');
    mode.innerHTML = '<option value="all">همه (پیش‌فرض)</option><option value="host">فقط میزبان 👑</option>';
    mode.onchange = () => ctx.send('settings', { controlMode: mode.value });
    const modeNote = document.createElement('div');
    modeNote.className = 'muted';
    modeNote.style.fontSize = '12px';
    modeBox.append(mode, modeNote);

    // انتقال میزبانی
    const hostBox = document.createElement('div');
    hostBox.className = 'setting';
    const hostTitle = document.createElement('h4');
    hostTitle.textContent = 'انتقال میزبانی';
    const hostList = document.createElement('div');
    hostList.className = 'row';
    hostBox.append(hostTitle, hostList);

    // خروج
    const leave = document.createElement('button');
    leave.className = 'danger';
    leave.textContent = 'خروج از اتاق';
    leave.onclick = () => (location.href = '/');

    body.append(inviteBox, modeBox, hostBox, leave);

    function render() {
      link.value = location.href;
      mode.value = ctx.controlMode;
      mode.disabled = !ctx.isHost();
      modeNote.textContent = ctx.isHost() ? '' : 'فقط میزبان می‌تونه این رو عوض کنه.';
      hostList.innerHTML = '';
      hostBox.classList.toggle('hidden', !ctx.isHost());
      const others = ctx.users().filter((u) => u.id !== ctx.me.id);
      if (!others.length) hostList.textContent = 'کسی دیگه‌ای تو اتاق نیست.';
      others.forEach((u) => {
        const b = document.createElement('button');
        b.textContent = '👑 ' + u.name;
        b.onclick = () => ctx.send('makeHost', { id: u.id });
        hostList.appendChild(b);
      });
    }

    ['welcome', 'users', 'settings'].forEach((t) => ctx.on(t, render));
    render();
  },
});
