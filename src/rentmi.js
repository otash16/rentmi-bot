const API = 'https://rentmi.uz/api/v1/admin/property/announcements/detail';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

/** "https://rentmi.uz/announcement/538", "rentmi.uz/ru/announcement/538" yoki shunchaki "538" dan ID ajratadi */
export function parseAnnouncementId(text) {
  const t = (text || '').trim();
  const m = t.match(/rentmi\.uz\/(?:[a-z]{2}\/)?announcement\/(\d+)/i) || t.match(/^(\d{1,8})$/);
  return m ? m[1] : null;
}

export async function fetchAnnouncement(id) {
  const res = await fetch(`${API}/${id}/for-site/`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new Error(`E'lon #${id} topilmadi (404)`);
  if (!res.ok) throw new Error(`rentmi.uz javob bermadi: HTTP ${res.status}`);
  const json = await res.json();
  const d = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json;
  return normalize(d, id);
}

function normalize(d, id) {
  const p = d.property && typeof d.property === 'object' ? d.property : d;
  const photos = [];
  for (const key of ['photos', 'attachments', 'images', 'property_attachments']) {
    const arr = Array.isArray(p[key]) ? [...p[key]] : [];
    arr.sort((a, b) => (b?.is_main ? 1 : 0) - (a?.is_main ? 1 : 0));
    for (const x of arr) {
      if (typeof x === 'string') photos.push(x);
      else if (x && typeof x === 'object') {
        const u = x.file || x.image || x.url || x.attachment;
        if (typeof u === 'string' && u) photos.push(u);
      }
    }
  }
  if (typeof d.main_image === 'string') photos.push(d.main_image);
  if (typeof d.image === 'string') photos.push(d.image);

  const currency = d.currency || 'UZS';
  const usd = num(d.usd_price) ?? (currency === 'USD' ? num(d.price) : undefined);

  return {
    id: String(d.id ?? id),
    url: `https://rentmi.uz/announcement/${d.id ?? id}`,
    title: str(d.title),
    description: str(d.description),
    address: str(p.address) || str(d.address),
    rooms: num(p.n_rooms) ?? num(d.number_of_rooms) ?? num(d.rooms),
    floor: num(p.floor) ?? num(d.floor),
    totalFloors: num(p.total_floors) ?? num(d.total_floors),
    area: num(p.area) ?? num(d.area),
    price: num(d.price),
    currency,
    usdPrice: usd,
    isFurniture: p.is_furniture === true,
    photos: [...new Set(photos)].filter((u) => /^https?:\/\//.test(u)),
    owner: d.user_info?.full_name || '',
  };
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
