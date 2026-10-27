// Bir foydalanuvchining e'lonlarini ketma-ket kanalga yuborish (ommaviy).
//
//   node src/bulk.js --user 354 --from 502            # Otajon Kutbiddinov, 502 dan boshlab hammasi
//   node src/bulk.js --user 354 --from 502 --to 553   # oraliq
//   node src/bulk.js --user 354 --from 502 --dry      # yubormaydi, faqat ro'yxat va matnlarni ko'rsatadi
//
// Yuborilganlar bulk-posted.json ga yoziladi — qayta ishga tushirilsa takrorlamaydi.
// Telegram cheklovi (kanalga ~20 xabar/daqiqa) uchun postlar orasida pauza, 429 bo'lsa kutib qayta uradi.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Bot } from 'grammy';
import { fetchAnnouncement } from './rentmi.js';
import { buildCaption, initialFields } from './post.js';
import { mediaGroup } from './photos.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : null)).filter(Boolean));
const USER = Number(args.user);
const FROM = Number(args.from);
const TO = args.to ? Number(args.to) : null;
const DRY = Boolean(args.dry);
const PAUSE_MS = Number(args.pause || 12_000);
if (!USER || !FROM) { console.error('Kerak: --user <rentmi user id> --from <e\'lon id> [--to N] [--dry]'); process.exit(1); }

const env = {
  POST_PHONE: process.env.POST_PHONE || '',
  POST_SIGNATURE: process.env.POST_SIGNATURE || '',
  POST_COMMISSION: process.env.POST_COMMISSION || '',
};
const CHANNEL_ID = process.env.CHANNEL_ID;
if (!DRY && (!process.env.BOT_TOKEN || !CHANNEL_ID)) { console.error('.env da BOT_TOKEN va CHANNEL_ID kerak'); process.exit(1); }

const POSTED_FILE = new URL('../bulk-posted.json', import.meta.url);
const posted = existsSync(POSTED_FILE) ? JSON.parse(readFileSync(POSTED_FILE, 'utf8')) : {};
const savePosted = () => writeFileSync(POSTED_FILE, JSON.stringify(posted, null, 1));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'https://rentmi.uz/api/v1/admin/property/announcements/detail';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

/** E'lon egasi va holati; 404 → null; 429 → kutib qayta uradi */
async function probe(id) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}/${id}/for-site/`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res) { await sleep(3000); continue; }
    if (res.status === 404) return null;
    if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
    if (!res.ok) { await sleep(3000); continue; }
    const j = await res.json();
    const d = j && j.data && typeof j.data === 'object' ? j.data : j;
    return { id, user: d.user_info?.id, name: d.user_info?.full_name, status: d.moderated_status, available: d.is_available, title: d.title };
  }
  throw new Error(`E'lon #${id}: rentmi javob bermadi`);
}

// 1) Foydalanuvchining e'lonlarini topish: FROM dan boshlab, ketma-ket 20 ta 404 bo'lguncha (yoki TO gacha)
console.log(`Qidiruv: user=${USER}, id ${FROM}..${TO ?? '∞'}`);
const ids = [];
let misses = 0, ownerName = '';
for (let id = FROM; TO ? id <= TO : misses < 20; id++) {
  const p = await probe(id);
  if (!p) { misses++; continue; }
  misses = 0;
  if (p.user !== USER) continue;
  ownerName = p.name;
  if (p.status !== 'approved' || !p.available) { console.log(`  #${id} o'tkazib yuborildi (${p.status}${p.available ? '' : ', mavjud emas'})`); continue; }
  ids.push(id);
  await sleep(150);
}
console.log(`${ownerName || USER}: ${ids.length} ta e'lon → ${ids.join(', ')}`);
const todo = ids.filter((id) => !posted[id]);
if (todo.length !== ids.length) console.log(`${ids.length - todo.length} tasi avval yuborilgan, qoldi ${todo.length}`);

// 2) Yuborish
const bot = DRY ? null : new Bot(process.env.BOT_TOKEN);
let n = 0;
for (const id of todo) {
  n++;
  try {
    const a = await fetchAnnouncement(id);
    if (!a.photos.length) { console.log(`[${n}/${todo.length}] #${id}: rasm yo'q, o'tkazildi`); continue; }
    const fields = initialFields(a, env);
    const caption = buildCaption(fields, process.env.POST_LINKS === '1' ? a.url : null);
    const draft = { url: a.url, photos: a.photos.slice(0, 10), fileIds: [] };
    if (DRY) {
      console.log(`\n[${n}/${todo.length}] #${id} — ${draft.photos.length} ta rasm\n${caption.replace(/<[^>]+>/g, '')}`);
      continue;
    }
    const media = await mediaGroup(draft, caption); // rasmlar yuklanadi, watermark olib tashlanadi
    for (let attempt = 0; ; attempt++) {
      try {
        await bot.api.sendMediaGroup(CHANNEL_ID, media);
        break;
      } catch (e) {
        const wait = e?.parameters?.retry_after;
        if (wait && attempt < 5) { console.log(`  429: ${wait}s kutilmoqda`); await sleep((wait + 1) * 1000); continue; }
        throw e;
      }
    }
    posted[id] = new Date().toISOString();
    savePosted();
    console.log(`[${n}/${todo.length}] #${id} yuborildi (${draft.photos.length} rasm)`);
    if (n < todo.length) await sleep(PAUSE_MS);
  } catch (e) {
    console.error(`[${n}/${todo.length}] #${id} XATO: ${e.message}`);
    await sleep(5000);
  }
}
console.log(DRY ? '\nQuruq rejim tugadi (hech narsa yuborilmadi).' : `\nTugadi: ${Object.keys(posted).length} ta e'lon kanalda.`);
