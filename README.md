# 🎬 تماشای مشترک (Watch Together)

تماشای همزمان فیلم با پارتنر یا دوستان. روی هر سرور Node.js (مثل Render) اجرا می‌شه.

## قابلیت‌ها

- **پخش همگام:** پخش/توقف/جلو-عقب/سرعت برای همه همزمان؛ اصلاح خودکار انحراف هر ۵ ثانیه؛ کسی که دیر وارد بشه روی زمان درست شروع می‌کنه.
- **منبع ویدیو:** لینک مستقیم (mp4/webm/m3u8) یا فایل از سیستم خودتون.
- **استریم ویدیوی محلی (WebRTC):** فقط یک نفر فایل را داشته باشد کافی است. فایل را انتخاب کنید و دکمه «📡 استریم ویدیو» را بزنید (در صورت نیاز خودش وارد تماس می‌شود). بقیه هم باید وارد تماس شوند تا تصویر را ببینند.
- **صف پخش مشترک** با پخش خودکار آیتم بعدی.
- **زیرنویس مشترک** (srt/vtt، تشخیص خودکار انکودینگ فارسی، تنظیم تأخیر).
- **چت** با تاریخچه، لینک کلیک‌پذیر و دکمه‌ی «پخش» کنار لینک ویدیو.
- **تماس صوتی/تصویری و اشتراک صفحه** (WebRTC) — با اشتراک صفحه می‌تونید یوتیوب/نتفلیکس و هر چیز دیگه‌ای رو هم نشون بدید.
- **ری‌اکشن‌های شناور** و **شمارش معکوس ۳-۲-۱** برای شروع همزمان.
- **رمز اتاق، میزبان 👑، حالت «فقط میزبان کنترل کنه»**، انتقال میزبانی.
- میانبرها: `Space/K` پخش‌وتوقف · `← →` یا `J L` ده ثانیه · `↑ ↓` صدا · `M` بی‌صدا · `F` تمام‌صفحه.
- اتصال مجدد خودکار، فارسی و راست‌چین، موبایل‌پسند.

## ۱) آپلود تو گیت‌هاب

1. تو github.com یه ریپوی جدید بساز (مثلاً `watch-together`).
2. zip رو باز کن و **محتویات** پوشه (نه خود پوشه) رو تو ریپو آپلود کن: دکمه‌ی **Add file ← Upload files**، همه‌ی فایل‌ها و پوشه‌ها رو بکش و رها کن، بعد **Commit changes**.
   - مطمئن شو `package.json`، `server.js` و پوشه‌ی `public` مستقیم تو ریشه‌ی ریپو هستن.
   - فایل `.gitignore` مخفیه؛ اگه تو آپلود وب نیومد مهم نیست.

یا با ترمینال:

```bash
cd watch-together
git init && git add . && git commit -m "watch together"
git branch -M main
git remote add origin https://github.com/USERNAME/watch-together.git
git push -u origin main
```

## ۲) اجرا روی Render

1. تو render.com با GitHub وارد شو.
2. **New + ← Web Service** ← ریپو رو انتخاب کن.
3. تنظیمات:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free`
4. **Create Web Service**. بعد از یکی دو دقیقه آدرس `https://اسم-تو.onrender.com` آماده‌ست.

(یا **New + ← Blueprint** رو بزن تا Render از روی `render.yaml` همه‌چیز رو خودش پر کنه.)

نکته‌ها:
- پلن رایگان بعد از ~۱۵ دقیقه بی‌کاری می‌خوابه و بالا اومدن دوباره‌ش حدود یک دقیقه طول می‌کشه. قبل از شروع فیلم یه بار صفحه رو باز کن.
- اتاق‌ها تو حافظه‌ان و با ری‌استارت سرور پاک می‌شن.
- تماس و اشتراک صفحه به https نیاز دارن (Render خودش https می‌ده).

## اجرا روی کامپیوتر خودت

```bash
npm install
npm start      # http://localhost:3000
```

## تماس صوتی وصل نمی‌شه؟ (TURN)

تماس مستقیم بین مرورگرها انجام می‌شه و برای پیدا کردن مسیر از STUN گوگل استفاده می‌کنه. پشت بعضی اینترنت‌ها/NATها این کافی نیست و به سرور TURN نیاز داری. یه سرویس TURN بگیر (مثلاً Metered یا Twilio؛ بعضی‌ها پلن رایگان دارن) و تو Render زیر **Environment** این متغیر رو اضافه کن:

```
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:443?transport=tcp","username":"USER","credential":"PASS"}]
```

بعد از ذخیره، سرویس خودش دوباره بالا میاد. نیازی به تغییر کد نیست.

متغیرهای اختیاری دیگه: `MAX_USERS_PER_ROOM` (پیش‌فرض ۱۲). تماس به صورت اتصال مستقیم بین همه‌ست، پس برای تماس گروهی بیشتر از ۴-۵ نفر توصیه نمی‌شه.

## محدودیت‌ها

- نتفلیکس/یوتیوب/... مستقیم تو پخش‌کننده باز نمی‌شن (DRM)؛ برای اونا از **اشتراک صفحه** استفاده کنید.
- فایل‌های mkv/avi بسته به کدک ممکنه تو مرورگر پخش نشن؛ mp4 (H.264) امن‌ترین فرمته.
- لینک ویدیو باید مستقیم باشه (به خود فایل یا m3u8 اشاره کنه، نه صفحه‌ی وب).

## ساختار پروژه

```
server.js                 سرور HTTP + WebSocket
render.yaml               تنظیمات Render (اختیاری)
public/index.html         صفحه
public/style.css          ظاهر
public/core.js           هسته: اتصال، همگام‌سازی، API افزونه‌ها
public/features/
  chat.js                 چت
  playlist.js             صف پخش
  subtitles.js            زیرنویس
  room.js                 تنظیمات اتاق / میزبان
  reactions.js            ری‌اکشن‌ها
  countdown.js            شمارش معکوس
  call.js                 تماس + اشتراک صفحه + استریم ویدیوی محلی (WebRTC)
  hotkeys.js              میانبرها
```

## اضافه کردن قابلیت جدید

هر قابلیت = یه فایل تو `public/features/` + یه خط `<script>` تو `index.html` (ترتیب خط‌ها = ترتیب تب‌ها).

### روش ۱: فقط سمت کلاینت (بدون دست زدن به سرور)

```js
WT.register({
  name: 'myFeature',
  init(ctx) {
    const panel = ctx.addSidePanel('عنوان', { icon: '⭐' });   // تب جدید
    // یا: const box = ctx.addStageExtra();                    // ظرف زیر ویدیو

    const btn = document.createElement('button');
    btn.textContent = 'سلام بفرست';
    btn.onclick = () => ctx.sendPlugin('myFeature', { hello: 'world' });
    panel.body.appendChild(btn);

    ctx.onPlugin('myFeature', (data, fromId) => ctx.toast('رسید: ' + data.hello));
  },
});
```

### روش ۲: قابلیتی که سرور هم باید بدونه

تو `server.js` یه هندلر به آبجکت `handlers` اضافه کن:

```js
vote({ ws, client, room, msg }) {
  room.votes = room.votes || {};
  room.votes[client.id] = msg.choice;
  broadcast(room, { type: 'votes', votes: room.votes });
},
```

سمت کلاینت:

```js
ctx.send('vote', { choice: 'A' });
ctx.on('votes', (msg) => { /* msg.votes */ });
```

### API کلاینت (`ctx`)

| | |
|---|---|
| `ctx.video`, `ctx.player`, `ctx.overlay` | ویدیو، کانتینر تمام‌صفحه، لایه‌ی روی ویدیو |
| `ctx.me`, `ctx.users()`, `ctx.hostId` | کاربر فعلی، حاضرین، میزبان |
| `ctx.isHost()`, `ctx.canControl()` | دسترسی‌ها |
| `ctx.currentSrc` | لینک ویدیوی فعلی |
| `ctx.send(type, payload)` / `ctx.on(type, fn)` | پیام خام با سرور |
| `ctx.sendPlugin(name, data)` / `ctx.onPlugin(name, fn)` | ارتباط افزونه‌ای بدون تغییر سرور |
| `ctx.addSidePanel(title, {icon})` | تب جدید → `{ body, show(), setBadge(n), active, onShow }` |
| `ctx.addStageExtra()` | ظرف جدید زیر ویدیو |
| `ctx.applyState(s)` / `ctx.sendState()` | کنترل همگام پخش |
| `ctx.toggleFullscreen()`, `ctx.toast(text)` | |

### ایده برای قابلیت‌های بعدی

حساب کاربری و لاگین، ذخیره‌ی اتاق‌ها تو دیتابیس، پخش یوتیوب با IFrame API، رأی‌گیری برای فیلم بعدی، تم‌های ظاهری، کامنت‌های زمان‌دار، اعلان صوتی پیام جدید.
