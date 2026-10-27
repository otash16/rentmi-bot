import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { Bot, InlineKeyboard } from 'grammy';
import { fetchAnnouncement, parseAnnouncementId } from './rentmi.js';
import { buildCaption, plainTemplate, initialFields, FIELDS } from './post.js';
import { mediaGroup } from './photos.js';

const env = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,
  POST_PHONE: process.env.POST_PHONE || '',
  POST_SIGNATURE: process.env.POST_SIGNATURE || '',
  POST_COMMISSION: process.env.POST_COMMISSION || '',
};
if (!env.BOT_TOKEN) throw new Error('.env da BOT_TOKEN yo‘q');
if (!env.CHANNEL_ID) console.warn('CHANNEL_ID bo‘sh — botni kanalga admin qilib qo‘shing, o‘zi aniqlab oladi (yoki /setchannel @kanal)');

const allowed = new Set((process.env.ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean));
const bot = new Bot(env.BOT_TOKEN);

/**
 * chatId -> draft
 * { photos: string[] (URL), fileIds: string[] (Telegram file_id, birinchi previewdan keyin),
 *   fields: {...}, customCaption: string|null, awaiting: 'field:<name>'|'caption'|null,
 *   captionMsgId, controlMsgId }
 */
const drafts = new Map();

// Draftlar diskda ham saqlanadi — bot qayta ishga tushganda preview'lar yo'qolmasin
const DRAFTS_FILE = new URL('../drafts.json', import.meta.url);
try {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(DRAFTS_FILE, 'utf8')))) drafts.set(Number(k), v);
  if (drafts.size) console.log(`Diskdan ${drafts.size} ta draft tiklandi`);
} catch { /* fayl yo'q — birinchi ishga tushish */ }
function persistDrafts() {
  try { writeFileSync(DRAFTS_FILE, JSON.stringify(Object.fromEntries(drafts))); } catch (e) { console.error('drafts.json yozilmadi:', e.message); }
}

function saveChannel(id, title) {
  env.CHANNEL_ID = String(id);
  try {
    const envPath = new URL('../.env', import.meta.url);
    let txt = readFileSync(envPath, 'utf8');
    txt = /^CHANNEL_ID=.*$/m.test(txt) ? txt.replace(/^CHANNEL_ID=.*$/m, `CHANNEL_ID=${env.CHANNEL_ID}`) : txt + `\nCHANNEL_ID=${env.CHANNEL_ID}\n`;
    writeFileSync(envPath, txt);
  } catch (e) { console.error('.env ga yozib bo‘lmadi:', e.message); }
  console.log('Kanal saqlandi:', env.CHANNEL_ID, title || '');
}

bot.use(async (ctx, next) => {
  if (allowed.size && ctx.from && !allowed.has(String(ctx.from.id))) {
    if (ctx.message) await ctx.reply(`Ruxsat yo‘q. Sizning ID: ${ctx.from.id}`);
    return;
  }
  await next();
});

bot.command('start', (ctx) =>
  ctx.reply(
    'Salom! Menga rentmi.uz e’lon linkini yuboring (masalan https://rentmi.uz/announcement/538).\n' +
      'Men rasmlar + ma’lumotlardan post tayyorlab ko‘rsataman. Har bir qatorni tugma bilan o‘zgartirib, keyin “Kanalga yuborish”ni bosasiz.',
  ),
);
bot.command('id', (ctx) => ctx.reply(`Sizning Telegram ID: ${ctx.from.id}`));
bot.command('cancel', async (ctx) => { drafts.delete(ctx.chat.id); persistDrafts(); await ctx.reply('Bekor qilindi.'); });

bot.command('setchannel', async (ctx) => {
  const arg = (ctx.match || '').trim();
  if (!arg) return ctx.reply(`Hozirgi kanal: ${env.CHANNEL_ID || '— (o‘rnatilmagan)'}\nO‘rnatish: /setchannel @kanal_username`);
  try {
    const chat = await ctx.api.getChat(arg);
    saveChannel(chat.id, chat.title);
    await ctx.reply(`✅ Kanal o‘rnatildi: ${chat.title} (${chat.id})`);
  } catch (e) { await ctx.reply(`❌ Kanal topilmadi: ${e.message}`); }
});

// Bot kanalga admin qilib qo‘shilganda kanalni avtomatik saqlash
bot.on('my_chat_member', async (ctx) => {
  const { chat, new_chat_member } = ctx.myChatMember;
  if (chat.type === 'channel' && new_chat_member.status === 'administrator') saveChannel(chat.id, chat.title);
});

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text.trim();
  const d = drafts.get(chatId);

  // Tahrir uchun javob kutilayotgan bo‘lsa
  if (d?.awaiting) {
    if (d.awaiting === 'caption') {
      d.customCaption = text;
    } else {
      const name = d.awaiting.slice('field:'.length);
      d.fields[name] = text;
      d.customCaption = null; // maydon o‘zgardi — shablon qayta quriladi
    }
    d.awaiting = null;
    await refreshPreview(ctx, d);
    persistDrafts();
    return;
  }

  const id = parseAnnouncementId(text);
  if (!id) {
    await ctx.reply('Bu rentmi.uz linkiga o‘xshamadi. Masalan: https://rentmi.uz/announcement/538');
    return;
  }

  const wait = await ctx.reply(`⏳ E’lon #${id} yuklanmoqda...`);
  try {
    const a = await fetchAnnouncement(id);
    if (!a.photos.length) throw new Error('E’londa rasm topilmadi');
    const draft = { url: a.url, photos: a.photos.slice(0, 10), fileIds: [], fields: initialFields(a, env), customCaption: null, awaiting: null };
    drafts.set(chatId, draft);
    persistDrafts();
    await ctx.api.deleteMessage(chatId, wait.message_id).catch(() => {});
    await sendPreview(ctx, draft);
  } catch (e) {
    await ctx.api.editMessageText(chatId, wait.message_id, `❌ Xato: ${e.message}`).catch(() => ctx.reply(`❌ Xato: ${e.message}`));
  }
});

// Havola bloki hozircha o‘chirilgan; yoqish uchun .env da POST_LINKS=1
const captionOf = (d) => buildCaption(d.fields, process.env.POST_LINKS === '1' ? d.url : null, d.customCaption);
const HTML = { parse_mode: 'HTML' };

function keyboard(d) {
  const kb = new InlineKeyboard();
  FIELDS.forEach(([name, label], i) => {
    kb.text(`✏️ ${label}`, `edit:${name}`);
    if (i % 2 === 1) kb.row();
  });
  if (FIELDS.length % 2) kb.row();
  kb.text('📝 Butun matnni yozish', 'edit:caption').row();
  if (d.customCaption) kb.text('↩️ Shablonga qaytarish', 'reset').row();
  kb.text('✅ Kanalga yuborish', 'publish').text('❌ Bekor', 'cancel');
  return kb;
}

async function sendPreview(ctx, d) {
  const caption = captionOf(d);
  const media = await mediaGroup(d, caption);
  const sent = await ctx.replyWithMediaGroup(media);
  // Telegram file_id larini saqlaymiz — keyin rasmlar qayta yuklanmaydi
  d.fileIds = sent.map((m) => m.photo?.at(-1)?.file_id).filter(Boolean);
  d.captionMsgId = sent[0].message_id;
  const ctl = await ctx.reply(`👆 Post shunday chiqadi (${d.photos.length} ta rasm). Kerakli qatorni tahrirlang yoki yuboring:`, { reply_markup: keyboard(d) });
  d.controlMsgId = ctl.message_id;
  persistDrafts();
}

/** Tahrirdan keyin: rasmlarni qayta yubormay, faqat birinchi rasm tagidagi matnni yangilaydi */
async function refreshPreview(ctx, d) {
  const chatId = ctx.chat.id;
  const caption = captionOf(d);
  try {
    await ctx.api.editMessageCaption(chatId, d.captionMsgId, { caption, ...HTML });
  } catch (e) {
    if (!/not modified/i.test(e.message)) { await sendPreview(ctx, d); return; }
  }
  // Boshqaruv xabarini pastga tushirish (yangi xabar), eskisini o‘chirish
  await ctx.api.deleteMessage(chatId, d.controlMsgId).catch(() => {});
  const ctl = await ctx.reply('✏️ Yangilandi. Yana tahrirlang yoki yuboring:', { reply_markup: keyboard(d) });
  d.controlMsgId = ctl.message_id;
}

bot.callbackQuery(/^edit:(\w+)$/, async (ctx) => {
  const d = drafts.get(ctx.chat.id);
  if (!d) return ctx.answerCallbackQuery({ text: 'Avval link yuboring', show_alert: true });
  const name = ctx.match[1];
  await ctx.answerCallbackQuery();
  if (name === 'caption') {
    d.awaiting = 'caption';
    persistDrafts();
    await ctx.reply('Postning butun matnini yozib yuboring (rasmlar o‘zgarmaydi). Hozirgi matn:\n\n' + (d.customCaption ?? plainTemplate(d.fields)));
    return;
  }
  const label = FIELDS.find(([n]) => n === name)?.[1] ?? name;
  d.awaiting = `field:${name}`;
  persistDrafts();
  await ctx.reply(`${label} uchun yangi qiymat yozing (hozir: ${d.fields[name]}):`);
});

bot.callbackQuery('reset', async (ctx) => {
  const d = drafts.get(ctx.chat.id);
  if (!d) return ctx.answerCallbackQuery({ text: 'Draft yo‘q', show_alert: true });
  d.customCaption = null;
  await ctx.answerCallbackQuery({ text: 'Shablonga qaytarildi' });
  await refreshPreview(ctx, d);
});

bot.callbackQuery('cancel', async (ctx) => {
  drafts.delete(ctx.chat.id);
  persistDrafts();
  await ctx.answerCallbackQuery({ text: 'Bekor qilindi' });
  await ctx.editMessageText('❌ Bekor qilindi.');
});

bot.callbackQuery('publish', async (ctx) => {
  const d = drafts.get(ctx.chat.id);
  if (!d) return ctx.answerCallbackQuery({ text: 'Draft topilmadi — linkni qayta yuboring', show_alert: true });
  if (!env.CHANNEL_ID) return ctx.answerCallbackQuery({ text: 'Kanal o‘rnatilmagan: botni kanalga admin qiling yoki /setchannel @kanal', show_alert: true });
  await ctx.answerCallbackQuery({ text: 'Yuborilmoqda...' });
  try {
    await ctx.api.sendMediaGroup(env.CHANNEL_ID, await mediaGroup(d, captionOf(d)));
    drafts.delete(ctx.chat.id);
    persistDrafts();
    await ctx.editMessageText(`✅ E’lon ${d.fields.id} kanalga yuborildi.`);
  } catch (e) {
    await ctx.editMessageText(`❌ Kanalga yuborishda xato: ${e.message}\n(Bot kanalda admin ekanini va kanal to‘g‘riligini tekshiring)`);
  }
});

bot.catch((err) => console.error('Bot xatosi:', err.error ?? err));
bot.start({ onStart: () => console.log('Bot ishga tushdi. Kanal:', env.CHANNEL_ID || '(o‘rnatilmagan)') });
