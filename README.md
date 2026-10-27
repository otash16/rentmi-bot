# rentmi-bot

rentmi.uz e'lon linkini yuborsangiz, Telegram kanal uchun tayyor post (rasmlar + ma'lumot) yasab beradigan bot.

## O'rnatish (bir marta)

1. Telegramda **@BotFather** → `/newbot` → token oling.
2. Botni kanalga **admin** qilib qo'shing (postlar yuborish huquqi bilan).
3. `.env` yarating:
   ```
   cp .env.example .env
   ```
   va `BOT_TOKEN`, `CHANNEL_ID` (kanal @username yoki -100... ID), telefon, imzo kiriting.
4. `npm install` (allaqachon qilingan) → `npm start`.

## Ishlatish

- Botga `https://rentmi.uz/announcement/538` ko'rinishidagi linkni (yoki shunchaki `538`) yuboring.
- Bot preview ko'rsatadi: 10 tagacha rasm + matn.
- **✅ Kanalga yuborish** — kanalga chiqadi. **✏️ Holati / ✏️ Mo'ljal** — matnni o'zgartirish. **❌ Bekor**.
- `/id` — o'z Telegram ID'ingizni bilish (ALLOWED_USER_IDS uchun).

Tokensiz tekshirish: `node src/preview.js 538`

## Post formati

```
ID: 538
#yashnobod
🏢 Xona: 3 xonali
🏬 Qavat: 7/12
🚩 Mo'ljal: NRG Zamon
✅ Holati: Yangi ta'mir
💰 Narxi: 800 y.e

📞 Tel: +998-78-113-88-78

@rentmi1
```

Matn shabloni `src/post.js` → `buildCaption` da. Tuman hashtaglari ham o'sha faylda.

## OLX logosi

OLX'dan olingan rasmlar (fayl nomi `parsed_` bilan boshlanadi) o'ng pastki burchakda yarim shaffof `olx.uz` logosi bilan keladi. Bot uni **kesmasdan** olib tashlaydi (`src/watermark.js`):

- OLX logoni oq rang bilan alpha-blend qiladi: `out = a·Wc + (1−a)·orig`. Yuzlab rentmi rasmidan logoning shakli (`assets/olx-*.png`), shaffofligi (a=0.207) va rangi (Wc≈252, kanal bo'yicha `k` = a·Wc) statistik hisoblab olingan — faqat tekis joylardagi 11 ming juft pikseldan, naqshli fon xatoga olib kelmasligi uchun.
- Har rasmda logoning aniq joyi gradient korrelyatsiyasi bilan topiladi (o'lchami rasm kengligiga proporsional), keyin formula teskari yechilib asl piksellar qaytariladi, kontur bo'ylab yengil feathering qilinadi.
- Logo topilmasa (rasm toza) rasm o'zgartirilmaydi. 464 ta namunada 460 tasi topildi, qolgan 4 tasida watermark yo'q edi; bir rasm ~10 ms.
- Juda naqshli yoki juda qorong'i fonda yaqindan qaraganda xira iz qolishi mumkin, lekin logo o'qilmaydi.

Rejimlar `.env` da: `PHOTO_WM=remove|crop|off` (crop — eski usul, pastki ~52 px kesiladi), `PHOTO_WM_FALLBACK=none|crop`.

## Manba

rentmi.uz ochiq API: `GET https://rentmi.uz/api/v1/admin/property/announcements/detail/<id>/for-site/` (auth kerak emas).
