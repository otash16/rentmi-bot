// Kanaldagi eski postlarda imzoni almashtirish.
//   node src/fix-signature.js --scan --to 747          # xabarlarni o'qib, @rentmi1 borlarini signature-scan.json ga yozadi
//   node src/fix-signature.js --apply                  # topilganlarni @Rentmi_support ga tahrirlaydi
// O'qish usuli: Bot API kanal tarixini bermaydi, shuning uchun har xabar ALLOWED_USER_IDS[0] chatiga
// ovozsiz forward qilinadi (caption olinadi) va darhol o'chiriladi.
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Bot } from 'grammy';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const OLD = opt('old') || '@rentmi1';
const NEW = opt('new') || process.env.POST_SIGNATURE || '@Rentmi_support';
const FROM = Number(opt('from') || 1);
const TO = Number(opt('to') || 747);
const FILE = new URL('../signature-scan.json', import.meta.url);
const bot = new Bot(process.env.BOT_TOKEN);
const CH = process.env.CHANNEL_ID;
const ME = opt('me') || (process.env.ALLOWED_USER_IDS || '').split(',')[0].trim();
if (!ME) { console.error('Kerak: --me <telegram chat id> yoki .env ALLOWED_USER_IDS'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const wait = e?.parameters?.retry_after;
      if (wait && attempt < 8) { console.log(`  429: ${wait}s`); await sleep((wait + 1) * 1000); continue; }
      throw e;
    }
  }
}

const found = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const save = () => writeFileSync(FILE, JSON.stringify(found, null, 1));

if (argv.includes('--scan')) {
  let seen = 0, missing = 0;
  for (let id = FROM; id <= TO; id++) {
    let fwd;
    try {
      fwd = await withRetry(() => bot.api.forwardMessage(ME, CH, id, { disable_notification: true }));
    } catch (e) {
      if (/not found|MESSAGE_ID_INVALID/i.test(e.description || e.message)) { missing++; continue; }
      console.error(`#${id}: ${e.description || e.message}`); await sleep(2000); continue;
    }
    seen++;
    const cap = fwd.caption || fwd.text || '';
    await bot.api.deleteMessage(ME, fwd.message_id).catch(() => {});
    if (cap.includes(OLD)) { found[id] = { caption: cap, done: found[id]?.done || false }; save(); }
    if (id % 50 === 0) console.log(`...${id}: topildi ${Object.keys(found).length}`);
    await sleep(350);
  }
  console.log(`Skan tugadi: ${seen} xabar mavjud, ${missing} yo'q, "${OLD}" bor: ${Object.keys(found).length}`);
}

if (argv.includes('--apply')) {
  const todo = Object.entries(found).filter(([, v]) => !v.done);
  console.log(`${todo.length} ta post tahrirlanadi (${OLD} → ${NEW})`);
  let n = 0;
  for (const [id, v] of todo) {
    const caption = v.caption.split(OLD).join(NEW);
    try {
      await withRetry(() => bot.api.editMessageCaption(CH, Number(id), { caption }));
      v.done = true; save(); n++;
    } catch (e) {
      if (/not modified/i.test(e.description || '')) { v.done = true; save(); continue; }
      console.error(`#${id} XATO: ${e.description || e.message}`);
    }
    await sleep(3000);
  }
  console.log(`Tahrirlandi: ${n}, jami tayyor: ${Object.values(found).filter((v) => v.done).length}/${Object.keys(found).length}`);
}
