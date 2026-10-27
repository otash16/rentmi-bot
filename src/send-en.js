// Bitta e'lonni INGLIZ tilida kanalga yuborish.
//   node src/send-en.js 561 [--dry] [--landmark "Alay bazaar"] [--condition "Good"] [--note "For foreigners only"]
import 'dotenv/config';
import { Bot } from 'grammy';
import { fetchAnnouncement } from './rentmi.js';
import { districtTag, esc } from './post.js';
import { mediaGroup } from './photos.js';

const argv = process.argv.slice(2);
const id = argv.find((a) => /^\d+$/.test(a));
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes('--dry');
if (!id) { console.error('Kerak: node src/send-en.js <id> [--dry]'); process.exit(1); }

const a = await fetchAnnouncement(id);
const price = a.usdPrice !== undefined ? `$${Math.round(a.usdPrice)}` : a.price !== undefined ? `${a.price.toLocaleString('en-US')} UZS` : '—';
const lines = [
  `ID: ${a.id}`,
  `#${opt('tag') || districtTag(a.address)}`,
  `🏢 Rooms: ${a.rooms ?? '—'}`,
  `🏬 Floor: ${a.floor ?? '—'}/${a.totalFloors ?? '—'}`,
  ...(a.area ? [`📐 Area: ${a.area} m²`] : []),
  `🚩 Landmark: ${opt('landmark') || (a.address || '').split(',')[0].replace(/\btumani\b/i, 'district').trim()}`,
  `✅ Condition: ${opt('condition') || 'Good'}`,
  `💰 Price: ${price} / month`,
  ...(opt('note') ? ['', opt('note')] : []),
  '',
  ...(process.env.POST_COMMISSION ? [process.env.POST_COMMISSION, ''] : []),
  `📞 Phone: ${process.env.POST_PHONE}`,
  '',
  process.env.POST_SIGNATURE,
];
const caption = esc(lines.join('\n'));
console.log(caption + `\n\n(${a.photos.length} photos)`);
if (DRY) process.exit(0);

const bot = new Bot(process.env.BOT_TOKEN);
const media = await mediaGroup({ url: a.url, photos: a.photos.slice(0, 10), fileIds: [] }, caption);
const msgs = await bot.api.sendMediaGroup(process.env.CHANNEL_ID, media);
console.log(`Sent: ${msgs.length} media, first message_id=${msgs[0].message_id}`);
