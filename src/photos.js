// Rasmlarni yuklash, OLX watermarkini olib tashlash va Telegram media-guruhini yig'ish.
// bot.js (interaktiv) va bulk.js (ommaviy yuborish) ikkalasi shu moduldan foydalanadi.
import { InputFile, InputMediaBuilder } from 'grammy';
import sharp from 'sharp';
import { removeOlxWatermark } from './watermark.js';

const HTML = { parse_mode: 'HTML' };

/** Preview yuborilgan bo‘lsa file_id, bo‘lmasa rasmlarni yuklab fayl sifatida beradi */
export async function mediaGroup(d, caption) {
  if (d.fileIds.length === d.photos.length) {
    return d.fileIds.map((fid, i) => InputMediaBuilder.photo(fid, i === 0 ? { caption, ...HTML } : undefined));
  }
  const files = await Promise.all(d.photos.map(download));
  return files.map((buf, i) => InputMediaBuilder.photo(new InputFile(buf, `photo_${i + 1}.jpg`), i === 0 ? { caption, ...HTML } : undefined));
}

// OLX'dan olingan rasmlar (nomi parsed_ bilan boshlanadi) o‘ng pastki burchakda olx.uz logosi bilan keladi.
// PHOTO_WM=remove (default) — logo matematik yo‘l bilan olib tashlanadi, rasm kesilmaydi (src/watermark.js);
// PHOTO_WM=crop — eski usul, pastki chiziq kesiladi; PHOTO_WM=off — tegilmaydi.
// Logo topilmasa (odatda rasmda watermark yo‘q) asl rasm ketadi; PHOTO_WM_FALLBACK=crop bo‘lsa pastki chiziq kesiladi.
const PHOTO_WM = process.env.PHOTO_WM || (process.env.PHOTO_CROP === '0' ? 'off' : 'remove');
const WM_FALLBACK = process.env.PHOTO_WM_FALLBACK || 'none';
const isOlxPhoto = (url) => /\/parsed_[^/]*$/.test(url);

export async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Rasm yuklanmadi (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (PHOTO_WM === 'off' || !isOlxPhoto(url)) return buf;
  if (PHOTO_WM === 'crop') return cropBottom(buf);
  try {
    const r = await removeOlxWatermark(buf);
    if (r) return r.buffer;
    console.log('Watermark topilmadi (rasm toza):', url.split('/').pop(), WM_FALLBACK === 'crop' ? '— kesildi' : '');
  } catch (e) {
    console.error('Watermark olib tashlashda xato:', e.message);
  }
  return WM_FALLBACK === 'crop' ? cropBottom(buf) : buf;
}

async function cropBottom(buf) {
  try {
    const img = sharp(buf).rotate(); // EXIF bo‘yicha to‘g‘rilab olamiz
    const { width, height } = await img.metadata();
    if (!width || !height) return buf;
    const cut = Math.round(52 * Math.max(1, width / 420));
    if (height - cut < 200) return buf;
    return await img.extract({ left: 0, top: 0, width, height: height - cut }).jpeg({ quality: 92 }).toBuffer();
  } catch (e) {
    console.error('Rasmni kesib bo‘lmadi:', e.message);
    return buf;
  }
}

