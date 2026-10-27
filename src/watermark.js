// OLX watermarkini ("olx.uz", o'ng pastki burchak) rasmni KESMASDAN olib tashlash.
//
// Usul: OLX logoni oq rang bilan yarim shaffof (alpha-blend) qilib qo'yadi:
//   out = a*Wc + (1 - a)*orig,   a = ALPHA * S(x, y)
// S — logoning shakli (assets/olx-*.png, yuzlab rentmi rasmidan statistik hisoblangan),
// ALPHA/Wc — shaffoflik va rang (11 mingta tekis juftlikdan: ALPHA=0.207, Wc≈252, R/G/B uchun
// biroz farq qiladi — shuning uchun a*Wc ko'paytmasi kanal bo'yicha K[c] sifatida saqlanadi).
// Formulani teskari yechsak asl piksel qaytadi:
//   orig = (out - S*K[c]) / (1 - S*ALPHA)
// Logo o'lchami rasm kengligiga proporsional, chetdan masofa ~10-16 px. Aniq joyi har rasmda
// gradient korrelyatsiyasi bilan ±4 px qidiriladi; topilmasa (korrelyatsiya past) rasm o'zgartirilmaydi.
// Chetlardagi 1-2 px halqa qolmasligi uchun logo konturi bo'ylab yengil feathering (blur) qilinadi.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const ASSETS = new URL('../assets/', import.meta.url);
const META = JSON.parse(readFileSync(new URL('olx-watermark.json', ASSETS), 'utf8'));
const ALPHA = META.alpha; // 0.207
const K = META.k; // ALPHA*Wc har kanal uchun: [52.7, 51.9, 50.1]
const RADIUS = 4; // joylashuv qidiruvi, px
const MIN_SCORE = Number(process.env.PHOTO_WM_MIN_SCORE || 0.08); // shundan past bo'lsa logo yo'q deb hisoblanadi

/** Shablonlar bir marta yuklanadi: { refWidth, width, height, right, bottom, data: Float32Array } */
let templatesPromise;
function loadTemplates() {
  return (templatesPromise ??= Promise.all(
    META.templates.map(async (t) => {
      const { data, info } = await sharp(new URL(t.file, ASSETS).pathname).greyscale().toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
      const S = new Float32Array(info.width * info.height);
      for (let i = 0; i < S.length; i++) S[i] = data[i] / 255;
      return { ...t, width: info.width, height: info.height, data: S };
    }),
  ));
}

const cache = new Map();
/** Kerakli o'lchamga keltirilgan shablon (kesh bilan) */
async function scaledTemplate(t, tw, th) {
  if (tw === t.width && th === t.height) return t.data;
  const key = `${t.refWidth}:${tw}x${th}`;
  if (cache.has(key)) return cache.get(key);
  const src = Buffer.alloc(t.width * t.height);
  for (let i = 0; i < src.length; i++) src[i] = Math.round(t.data[i] * 255);
  // sharp bir kanalli raw'ni qayta o'lchaganda 3 kanal qaytarishi mumkin — stride bilan o'qiymiz
  const { data: out, info } = await sharp(src, { raw: { width: t.width, height: t.height, channels: 1 } })
    .resize(tw, th, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const S = new Float32Array(tw * th);
  for (let i = 0; i < S.length; i++) S[i] = out[i * info.channels] / 255;
  if (cache.size > 50) cache.clear();
  cache.set(key, S);
  return S;
}

/** Markaziy farq gradienti (x va y), kulrang massiv uchun */
function gradients(a, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0 && x < w - 1) gx[i] = (a[i + 1] - a[i - 1]) / 2;
      if (y > 0 && y < h - 1) gy[i] = (a[i + w] - a[i - w]) / 2;
    }
  return { gx, gy };
}

/**
 * Logoning aniq joyini topadi. Qaytaradi: { score, S, tw, th, x0, y0 } yoki null.
 * score — shablon gradienti bilan rasm gradienti orasidagi normalangan korrelyatsiya (0..1).
 */
async function locate(gray, W, H) {
  const templates = await loadTemplates();
  const t = templates.reduce((best, c) => (Math.abs(Math.log(W / c.refWidth)) < Math.abs(Math.log(W / best.refWidth)) ? c : best));
  const base = W / t.refWidth;
  const er = Math.round(10.5 + 0.0055 * W), eb = Math.round(9.5 + 0.0027 * W);
  const scales = Math.abs(base - 1) < 1e-6 ? [1] : [0.97, 1, 1.03];

  // Gradientni faqat o'ng pastki hududda hisoblaymiz
  const tw0 = Math.round(t.width * base * 1.03), th0 = Math.round(t.height * base * 1.03);
  const rw = Math.min(W, tw0 + er + RADIUS + 4), rh = Math.min(H, th0 + eb + RADIUS + 4);
  const rx = W - rw, ry = H - rh;
  const reg = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) reg[y * rw + x] = gray[(ry + y) * W + rx + x];
  const { gx: Ix, gy: Iy } = gradients(reg, rw, rh);

  let best = null;
  for (const f of scales) {
    const tw = Math.round(t.width * base * f), th = Math.round(t.height * base * f);
    if (tw < 8 || th < 4 || tw > W || th > H) continue;
    const S = await scaledTemplate(t, tw, th);
    const { gx: Sx, gy: Sy } = gradients(S, tw, th);
    let ns = 0;
    for (let i = 0; i < S.length; i++) ns += Sx[i] * Sx[i] + Sy[i] * Sy[i];
    ns = Math.sqrt(ns);
    const ex0 = W - er - tw, ey0 = H - eb - th;
    for (let dx = -RADIUS; dx <= RADIUS; dx++)
      for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        const x0 = ex0 + dx, y0 = ey0 + dy;
        if (x0 < rx || y0 < ry || x0 + tw > W || y0 + th > H) continue;
        let dot = 0, ni = 0;
        for (let y = 0; y < th; y++) {
          let ri = (y0 - ry + y) * rw + (x0 - rx), si = y * tw;
          for (let x = 0; x < tw; x++, ri++, si++) {
            dot += Sx[si] * Ix[ri] + Sy[si] * Iy[ri];
            ni += Ix[ri] * Ix[ri] + Iy[ri] * Iy[ri];
          }
        }
        const score = dot / (ns * Math.sqrt(ni) + 1e-6);
        if (!best || score > best.score) best = { score, S, tw, th, x0, y0 };
      }
  }
  return best;
}

function unblend(box, S, tw, th, ch) {
  const out = new Float32Array(box.length);
  for (let i = 0; i < tw * th; i++) {
    const s = S[i];
    for (let c = 0; c < ch; c++) {
      const p = i * ch + c;
      const v = s > 0.004 ? (box[p] - s * K[c]) / (1 - s * ALPHA) : box[p];
      out[p] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/**
 * Rasm buferidan OLX watermarkini olib tashlaydi.
 * Qaytaradi: { buffer, score } (o'zgartirilgan JPEG) yoki null (logo topilmadi — asl rasm ishlatilsin).
 */
export async function removeOlxWatermark(input, { png = false } = {}) {
  const { data, info } = await sharp(input).rotate().flatten({ background: '#fff' }).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  if (ch < 3 || W < 200 || H < 100) return null;

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) gray[i] = (data[i * ch] + data[i * ch + 1] + data[i * ch + 2]) / 3;

  const loc = await locate(gray, W, H);
  if (!loc || loc.score < MIN_SCORE) return null;
  const { S, tw, th, x0, y0 } = loc;

  // Logo hududini ajratib olamiz (faqat RGB)
  const box = new Float32Array(tw * th * 3);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const src = ((y0 + y) * W + x0 + x) * ch, dst = (y * tw + x) * 3;
      box[dst] = data[src]; box[dst + 1] = data[src + 1]; box[dst + 2] = data[src + 2];
    }

  const fixed = unblend(box, S, tw, th, 3);

  // Feathering: kontur atrofidagi 2 px ni yengil blur bilan almashtiramiz
  const fixedU8 = Buffer.alloc(fixed.length);
  for (let i = 0; i < fixed.length; i++) fixedU8[i] = Math.round(fixed[i]);
  const blurred = await sharp(fixedU8, { raw: { width: tw, height: th, channels: 3 } }).blur(1.3).raw().toBuffer();
  const band = new Uint8Array(tw * th);
  for (let i = 0; i < band.length; i++) if (S[i] > 0.03 && S[i] < 0.97) band[i] = 1;
  const dil = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      let on = 0;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(th - 1, y + 2) && !on; yy++)
        for (let xx = Math.max(0, x - 2); xx <= Math.min(tw - 1, x + 2); xx++) if (band[yy * tw + xx]) { on = 1; break; }
      dil[y * tw + x] = on;
    }

  // Natijani asl rasmga qaytarib yozamiz
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const i = y * tw + x, dst = ((y0 + y) * W + x0 + x) * ch, src = i * 3;
      const from = dil[i] ? blurred : fixedU8;
      data[dst] = from[src]; data[dst + 1] = from[src + 1]; data[dst + 2] = from[src + 2];
    }

  const img = sharp(data, { raw: { width: W, height: H, channels: ch } });
  const buffer = await (png ? img.png() : img.jpeg({ quality: 92 })).toBuffer();
  return { buffer, score: loc.score };
}
