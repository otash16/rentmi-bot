// Tumanlarning o'zbekcha hashtag ko'rinishi (API manzilida har xil yozilishi mumkin)
const DISTRICTS = [
  [/mirabad|mirobod/i, 'mirobod'],
  [/yashnabad|yashnobod/i, 'yashnobod'],
  [/almazar|olmazor/i, 'olmazor'],
  [/chilanzar|chilonzor/i, 'chilonzor'],
  [/yunusabad|yunusobod/i, 'yunusobod'],
  [/yakkasaray|yakkasaroy/i, 'yakkasaroy'],
  [/shaykhantahur|shayxontohur|shaykhantaur/i, 'shayxontohur'],
  [/mirzo.?ulug/i, 'mirzoulugbek'],
  [/uchtepa/i, 'uchtepa'],
  [/sergeli/i, 'sergeli'],
  [/bektemir/i, 'bektemir'],
  [/yangihayot|yangi hayot/i, 'yangihayot'],
];

export function districtTag(address) {
  const first = (address || '').split(',')[0] || '';
  for (const [re, tag] of DISTRICTS) if (re.test(first)) return tag;
  const slug = first
    .toLowerCase()
    .replace(/\b(tumani|district|район|shahri|city)\b/g, '')
    .replace(/[^a-z0-9а-яё]/gi, '');
  return slug || 'toshkent';
}

/** Holatini sarlavha/tavsifdan taxmin qiladi; operator keyin tugma bilan o'zgartira oladi */
export function guessCondition(a) {
  const t = `${a.title} ${a.description}`.toLowerCase();
  if (/dizayner|дизайнер/.test(t)) return 'Dizaynerlik ishi';
  if (/yevro|evro|евро/.test(t)) return 'Yevro remont';
  if (/yangi ta.?mir|yangi remont|новый ремонт|свежий ремонт/.test(t)) return "Yangi ta'mir";
  if (/ta.?mirlangan|ta.?mirli|с ремонтом|ремонт/.test(t)) return "Ta'mirlangan";
  return 'Yaxshi';
}

/** Mo'ljal: sarlavhadan turar-joy kompleksi nomini olishga harakat qiladi, bo'lmasa tuman */
export function guessLandmark(a) {
  const m = a.title.match(/\b(NRG\s+\w+|Uz\s*makon|Mirobod\s+Avenue|[A-Z][\w'’-]+\s+(?:City|Residence|Tower|Park|Plaza|Avenue))\b/i);
  if (m) return m[1].trim();
  const first = (a.address || '').split(',')[0].replace(/\btumani\b/i, '').trim();
  return first || 'Toshkent';
}

export function formatPrice(a) {
  if (a.usdPrice !== undefined) return `${trimNum(a.usdPrice)} y.e`;
  if (a.price !== undefined) return `${a.price.toLocaleString('ru-RU')} so'm`;
  return '—';
}

const trimNum = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(0));

/** Postning tahrirlanadigan maydonlari — tartib tugmalar va matn uchun bir xil */
export const FIELDS = [
  ['id', 'ID'],
  ['tag', '# Hashtag'],
  ['rooms', '🏢 Xona'],
  ['floor', '🏬 Qavat'],
  ['landmark', '🚩 Mo‘ljal'],
  ['condition', '✅ Holati'],
  ['price', '💰 Narxi'],
  ['phone', '📞 Tel'],
  ['signature', 'Imzo'],
];

/** API ma'lumotidan boshlang'ich maydonlar */
export function initialFields(a, env) {
  return {
    id: a.id,
    tag: districtTag(a.address),
    rooms: a.rooms !== undefined ? `${a.rooms} xonali` : '—',
    floor: a.floor !== undefined ? `${a.floor}/${a.totalFloors ?? '—'}` : '—',
    landmark: guessLandmark(a),
    condition: guessCondition(a),
    price: formatPrice(a),
    commission: env.POST_COMMISSION,
    phone: env.POST_PHONE,
    signature: env.POST_SIGNATURE,
  };
}

export const PLAY_MARKET = 'https://play.google.com/store/apps/details?id=uz.iportal.uzrentme';
export const APP_STORE = 'https://apps.apple.com/us/app/rentmi/id6761826946';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** "Havola" bloki: e'lon linki (ilova o'rnatilgan bo'lsa ilovada ochiladi) + do'kon havolalari */
export function linkBlock(url) {
  return [
    `🔗 <a href="${esc(url)}">Havola</a> — to'liq ko'rish`,
    `📲 Ilova: <a href="${PLAY_MARKET}">Play Market</a> | <a href="${APP_STORE}">App Store</a>`,
  ].join('\n');
}

/** Shablon matni (linksiz, oddiy matn) — operatorga ko'rsatish uchun */
export function plainTemplate(f) {
  return [
    `ID: ${f.id}`,
    `#${f.tag.replace(/^#/, '')}`,
    `🏢 Xona: ${f.rooms}`,
    `🏬 Qavat: ${f.floor}`,
    `🚩 Mo'ljal: ${f.landmark}`,
    `✅ Holati: ${f.condition}`,
    `💰 Narxi: ${f.price}`,
    '',
    ...(f.commission ? [f.commission, ''] : []),
    `📞 Tel: ${f.phone}`,
    '',
    f.signature,
  ].join('\n');
}

/** Yakuniy HTML caption: shablon (yoki operator yozgan matn) + Havola bloki */
export function buildCaption(f, url, customText = null) {
  const body = customText != null ? esc(customText) : esc(plainTemplate(f));
  if (!url) return body;
  // Havola blokini imzodan oldin joylash: oxirgi qator imzo bo'lsa, undan oldin
  const lines = body.split('\n');
  const sig = f.signature && lines.at(-1)?.trim() === esc(f.signature).trim() ? lines.pop() : null;
  while (lines.length && lines.at(-1) === '') lines.pop();
  return [...lines, '', linkBlock(url), ...(sig ? ['', sig] : [])].join('\n');
}
