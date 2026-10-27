// Bot tokensiz tekshirish: node src/preview.js https://rentmi.uz/announcement/538
import { fetchAnnouncement, parseAnnouncementId } from './rentmi.js';
import { buildCaption, initialFields } from './post.js';

const id = parseAnnouncementId(process.argv[2]);
if (!id) { console.error('Link yoki ID bering'); process.exit(1); }
const a = await fetchAnnouncement(id);
console.log(buildCaption(initialFields(a, { POST_COMMISSION: '', POST_PHONE: '+998-78-113-88-78', POST_SIGNATURE: '@rentmi1' }), process.env.POST_LINKS === '1' ? a.url : null));
console.log(`\nRasmlar: ${a.photos.length} ta`);
a.photos.forEach((u) => console.log(' ', u));
