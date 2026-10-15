/** Content source of truth: dashboard document store (PostgreSQL / Firestore).
 * The public site is a read-only consumer; no GitHub commits on mutations.
 */
import { createHash } from "node:crypto";
import { getFirebaseAdminDb, documentStoreMode } from "@/lib/firebaseAdmin";
import { pgQuery } from "@/lib/db/pgPool";
import type { DashboardSession } from "@/lib/auth";
import { canManageSiteContent } from "@/lib/permissions";

export type ContentKind = "news" | "guides";
export type CreateContentInput = { kind: ContentKind; title: string; description: string; body: string; categories: string; tags: string; slug?: string; image?: File | null; author: string; user: DashboardSession };
export type UpdateContentInput = CreateContentInput & { path: string; date?: string; lastModifiedAt?: string; existingImage?: string; removeImage?: boolean };
export type SiteContentItem = { kind: ContentKind; path: string; sha?: string; name: string; title: string; slug: string; description: string; date: string; last_modified_at: string; author: string; categories: string; tags: string; image: string; body: string };
export const CONTENT_TEXT_LIMITS = { title:160, slug:90, description:600, categories:400, tags:400, author:120, body:200_000 } as const;
const STORE = "siteArticles";
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const isContentKind = (kind:string):kind is ContentKind => kind === "news" || kind === "guides";
export function isManagedContentPath(path:string) { return /^_(news|guides)\/[a-z0-9-]{1,130}\.md$/.test(path) && !path.includes(".."); }
export function slugify(value:string) {
 const map:Record<string,string> = {а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia'};
 return Array.from(String(value||'').toLowerCase().trim()).map(ch=>map[ch]??ch).join('').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90);
}
function docKey(kind:ContentKind,slug:string) { return `${kind}:${slug}`; }
function publicPath(kind:ContentKind,slug:string) { return `_${kind}/${slug}.md`; }
function parsePath(path:string) { if(!isManagedContentPath(path)) throw new Error('Невірна адреса матеріалу.'); const [,kind,slug] = /^_(news|guides)\/([a-z0-9-]+)\.md$/.exec(path)!; return {kind:kind as ContentKind,slug}; }
const DANGEROUS_RAW_HTML_TAGS = /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|meta|link|style|form|input|button|textarea|select|option|base)\b/i;
const INLINE_EVENT_HANDLER = /\son[a-z0-9_-]+\s*=/i;
const DANGEROUS_URI_SCHEME = /(?:javascript|vbscript)\s*:/i;
const DANGEROUS_DATA_URI = /data\s*:\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i;
function checkMarkdown(text:string) {
 if (DANGEROUS_RAW_HTML_TAGS.test(text) || INLINE_EVENT_HANDLER.test(text) || DANGEROUS_URI_SCHEME.test(text) || DANGEROUS_DATA_URI.test(text)) throw new Error('Markdown містить небезпечний HTML або URL.');
}
function normalized(input:CreateContentInput) {
 if(!canManageSiteContent(input.user)) throw new Error('Недостатньо прав.');
 if(!isContentKind(input.kind)) throw new Error('Невідомий тип матеріалу.');
 const title=String(input.title||'').trim(),description=String(input.description||'').trim(),body=String(input.body||'').replace(/\r\n/g,'\n').trim(),slug=slugify(input.slug||title),author=String(input.author||input.user.name||'Mistblossom Admin').trim();
 if (title.length < 3 || description.length < 12 || body.length < 20 || !slug) throw new Error('Невірна довжина заголовка, опису або тексту.');
 if (title.length > CONTENT_TEXT_LIMITS.title) throw new Error('Завеликий заголовок.');
 if (description.length > CONTENT_TEXT_LIMITS.description) throw new Error('Завеликий опис.');
 if (body.length > CONTENT_TEXT_LIMITS.body) throw new Error('Завеликий текст матеріалу.');
 for (const key of ['categories', 'tags'] as const) if (String(input[key] || '').length > CONTENT_TEXT_LIMITS[key]) throw new Error('Завеликий список категорій або тегів.');
 if (author.length > CONTENT_TEXT_LIMITS.author) throw new Error('Завелике ім’я автора.');
 checkMarkdown(body);
 return {kind:input.kind,title,description,body,slug,author,categories:String(input.categories||'').trim(),tags:String(input.tags||'').trim()};
}
function validDate(raw?:string) { const value=String(raw||'');return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))?value:new Date().toISOString().slice(0,10); }
function safeImage(url:string) {
 const value=String(url||'').trim();
 if(/^https:\/\/(?:guild|admin)\.lihvodruida\.pp\.ua\/api\/site\/media\/[a-f0-9]{64}$/.test(value))return value;
 if(/^\/assets\/img-content\/[A-Za-z0-9_./-]+$/.test(value)&&!value.includes('..'))return value;
 return '/assets/img/news-placeholder.webp';
}
function imageSignatureMatches(bytes:Buffer,mime:string) {
 return (mime==='image/jpeg'&&bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) || (mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) || (mime==='image/gif'&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))) || (mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');
}
async function saveImage(file?:File|null) {
 if(!file||!file.size)return null;
 if(!MIME.has(file.type)||file.size>MAX_IMAGE_SIZE)throw new Error('Обкладинка: JPG/PNG/WEBP/GIF до 8 MB.');
 if(documentStoreMode()!=='postgres')throw new Error('Завантаження обкладинок у базу потребує PostgreSQL.');
 const bytes=Buffer.from(await file.arrayBuffer()); if(!imageSignatureMatches(bytes,file.type))throw new Error('Зображення не відповідає заявленому формату.');
 const id=createHash('sha256').update(bytes).digest('hex');
 await pgQuery('INSERT INTO site_content_media(id, mime_type, payload) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,file.type,bytes]);
 const base=String(process.env.PUBLIC_DASHBOARD_BASE_URL||'https://guild.lihvodruida.pp.ua').replace(/\/+$/,'');
 if(!/^https:\/\/(guild|admin)\.lihvodruida\.pp\.ua$/.test(base))throw new Error('PUBLIC_DASHBOARD_BASE_URL має вказувати на довірений домен дашборда.');
 return `${base}/api/site/media/${id}`;
}
function docRef(kind:ContentKind,slug:string) {return getFirebaseAdminDb().collection(STORE).doc(docKey(kind,slug));}
async function assertNotExists(kind:ContentKind,slug:string,except?:string) {const id=docKey(kind,slug);if(id!==except&&(await docRef(kind,slug).get()).exists)throw new Error('Матеріал із таким slug уже існує.');}
function toItem(raw:any):SiteContentItem|null {
 if(!raw||!isContentKind(String(raw.kind))||!slugify(String(raw.slug||''))||typeof raw.title!=='string'||typeof raw.body!=='string')return null;
 const slug=slugify(raw.slug);return {kind:raw.kind,path:publicPath(raw.kind,slug),name:`${slug}.md`,slug,title:raw.title,description:String(raw.description||''),body:raw.body,date:String(raw.date||''),last_modified_at:String(raw.last_modified_at||raw.date||''),author:String(raw.author||''),categories:String(raw.categories||''),tags:String(raw.tags||''),image:safeImage(raw.image),sha:String(raw.revision||'')};
}
export async function listSiteContent():Promise<SiteContentItem[]> {
 const rows=await getFirebaseAdminDb().collection(STORE).limit(500).get();
 return rows.docs.map(doc=>toItem(doc.data())).filter((v):v is SiteContentItem=>!!v).sort((a,b)=>b.date.localeCompare(a.date)||a.title.localeCompare(b.title));
}
export async function publicSiteContent() {
 const items=await listSiteContent();
 return {schema:'mistblossom.public-content.v1',updated_at:new Date().toISOString(),items:items.map(({path,name,sha,...item})=>({...item,tags:item.tags.split(',').map(x=>x.trim()).filter(Boolean),categories:item.categories.split(',').map(x=>x.trim()).filter(Boolean)}))};
}
export async function createSiteContent(input:CreateContentInput) {
 const norm=normalized(input);await assertNotExists(norm.kind,norm.slug);
 const date=validDate(),image=(await saveImage(input.image))||'/assets/img/news-placeholder.webp';
 const item={...norm,date,last_modified_at:date,image,revision:1,updated_at:new Date().toISOString()};
 await docRef(norm.kind,norm.slug).create(item);
 return {ok:true,slug:norm.slug,path:publicPath(norm.kind,norm.slug),image};
}
export async function updateSiteContent(input:UpdateContentInput) {
 const old=parsePath(input.path),norm=normalized(input); const previous=await docRef(old.kind,old.slug).get();
 if(!previous.exists)throw new Error('Матеріал не знайдено. Онови список.');
 const before=previous.data()||{};const oldKey=docKey(old.kind,old.slug);await assertNotExists(norm.kind,norm.slug,oldKey);
 const image=input.removeImage?'/assets/img/news-placeholder.webp':(await saveImage(input.image))||safeImage(input.existingImage||String(before.image||''));
 const record={...norm,date:validDate(input.date||String(before.date||'')),last_modified_at:validDate(input.lastModifiedAt),image,revision:Number(before.revision||0)+1,updated_at:new Date().toISOString()};
 const key=docKey(norm.kind,norm.slug);if(key===oldKey)await docRef(norm.kind,norm.slug).set(record);else {await docRef(norm.kind,norm.slug).create(record);await docRef(old.kind,old.slug).delete();}
 return {ok:true,slug:norm.slug,path:publicPath(norm.kind,norm.slug),image};
}
export async function deleteSiteContent(path:string) {const {kind,slug}=parsePath(path);const ref=docRef(kind,slug);if(!(await ref.get()).exists)throw new Error('Матеріал не знайдено.');await ref.delete();}
