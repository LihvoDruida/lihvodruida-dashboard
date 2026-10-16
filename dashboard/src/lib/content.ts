/** Content source of truth: dashboard document store (PostgreSQL).
 * The public site is a read-only consumer; no GitHub commits on mutations.
 */
import { createHash, randomUUID } from "node:crypto";
import { getDocumentDb, documentStoreMode } from "@/lib/documentDb";
import { pgQuery } from "@/lib/db/pgPool";
import type { DashboardSession } from "@/lib/auth";
import { canManageSiteContent } from "@/lib/permissions";
import {CONTENT_TEXT_LIMITS,slugify,kyivDate,type ContentStatus} from "@/lib/contentModel";
export {CONTENT_TEXT_LIMITS,slugify,type ContentStatus} from "@/lib/contentModel";
export class ContentMutationError extends Error { constructor(message:string,readonly code:string,readonly status=400){super(message);} }

export type ContentKind = "news" | "guides";
export type CreateContentInput = { kind: ContentKind; requestId?: string; status?: ContentStatus; date?: string; title: string; description: string; body: string; categories: string; tags: string; slug?: string; image?: File | null; author: string; user: DashboardSession };
export type UpdateContentInput = CreateContentInput & { path: string; expectedRevision: string; date?: string; lastModifiedAt?: string; existingImage?: string; removeImage?: boolean };
export type SiteContentItem = { status: ContentStatus; kind: ContentKind; path: string; sha?: string; name: string; title: string; slug: string; description: string; date: string; updated_at: string; last_modified_at: string; author: string; categories: string; tags: string; image: string; body: string };

const STORE = "siteArticles";
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const isContentKind = (kind:string):kind is ContentKind => kind === "news" || kind === "guides";
export function isManagedContentPath(path:string) { return /^_(news|guides)\/[a-z0-9-]{1,130}\.md$/.test(path) && !path.includes(".."); }
function docKey(kind:ContentKind,slug:string) { return `${kind}:${slug}`; }
function publicPath(kind:ContentKind,slug:string) { return `_${kind}/${slug}.md`; }
function parsePath(path:string) { if(!isManagedContentPath(path)) throw new ContentMutationError('Невірна адреса матеріалу.','invalid_path'); const [,kind,slug] = /^_(news|guides)\/([a-z0-9-]+)\.md$/.exec(path)!; return {kind:kind as ContentKind,slug}; }
const DANGEROUS_RAW_HTML_TAGS = /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|meta|link|style|form|input|button|textarea|select|option|base)\b/i;
const INLINE_EVENT_HANDLER = /\son[a-z0-9_-]+\s*=/i;
const DANGEROUS_URI_SCHEME = /(?:javascript|vbscript)\s*:/i;
const DANGEROUS_DATA_URI = /data\s*:\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)/i;
function checkMarkdown(text:string) {
 if (DANGEROUS_RAW_HTML_TAGS.test(text) || INLINE_EVENT_HANDLER.test(text) || DANGEROUS_URI_SCHEME.test(text) || DANGEROUS_DATA_URI.test(text)) throw new ContentMutationError('Markdown містить небезпечний HTML або URL.','unsafe_markdown');
}
function normalized(input:CreateContentInput) {
 if(!canManageSiteContent(input.user)) throw new ContentMutationError('Недостатньо прав.','forbidden',403);
 if(!isContentKind(input.kind)) throw new ContentMutationError('Невідомий тип матеріалу.','invalid_kind');
 const status=input.status??'published';
 if(status!=='draft'&&status!=='published')throw new ContentMutationError('Невідомий стан матеріалу.','invalid_status');
 const title=String(input.title||'').trim(),description=String(input.description||'').trim(),body=String(input.body||'').replace(/\r\n/g,'\n').trim(),slug=slugify(input.slug||title),author=String(input.author||input.user.name||'Mistblossom Admin').trim();
 if (title.length < 3 || (status==='published'&&(description.length < 12 || body.length < 20)) || !slug) throw new ContentMutationError('Невірна довжина заголовка, опису або тексту.','invalid_fields');
 if (title.length > CONTENT_TEXT_LIMITS.title) throw new ContentMutationError('Завеликий заголовок.','invalid_fields');
 if (description.length > CONTENT_TEXT_LIMITS.description) throw new ContentMutationError('Завеликий опис.','invalid_fields');
 if (body.length > CONTENT_TEXT_LIMITS.body) throw new ContentMutationError('Завеликий текст матеріалу.','invalid_fields');
 for (const key of ['categories', 'tags'] as const) if (String(input[key] || '').length > CONTENT_TEXT_LIMITS[key]) throw new ContentMutationError('Завеликий список категорій або тегів.','invalid_fields');
 if (author.length > CONTENT_TEXT_LIMITS.author) throw new ContentMutationError('Завелике ім’я автора.','invalid_fields');
 checkMarkdown(body);
 return {kind:input.kind,status,title,description,body,slug,author,categories:String(input.categories||'').trim(),tags:String(input.tags||'').trim()};
}
function validDate(raw?:string) {
 const value=String(raw||'').trim();if(!value)return kyivDate();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new ContentMutationError('Вкажи коректну дату.','invalid_date');
 return value;
}
function safeImage(url:string) {
 const value=String(url||'').trim();
 if(/^\/api\/site\/media\/[a-f0-9]{64}$/.test(value))return value;
 if(/^https:\/\/(?:guild|admin)\.lihvodruida\.pp\.ua\/api\/site\/media\/[a-f0-9]{64}$/.test(value))return new URL(value).pathname;
 if(/^\/assets\/img-content\/[A-Za-z0-9_./-]+$/.test(value)&&!value.includes('..'))return value;
 return '/assets/img/news-placeholder.webp';
}
function imageSignatureMatches(bytes:Buffer,mime:string) {
 return (mime==='image/jpeg'&&bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) || (mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) || (mime==='image/gif'&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))) || (mime==='image/webp'&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');
}
async function saveImage(file?:File|null) {
 if(!file||!file.size)return null;
 if(!MIME.has(file.type)||file.size>MAX_IMAGE_SIZE)throw new ContentMutationError('Обкладинка: JPG/PNG/WEBP/GIF до 8 MB.','invalid_image');
 if(documentStoreMode()!=='postgres')throw new ContentMutationError('Завантаження обкладинок тимчасово недоступне.','storage_unavailable',503);
 const bytes=Buffer.from(await file.arrayBuffer()); if(!imageSignatureMatches(bytes,file.type))throw new ContentMutationError('Зображення не відповідає заявленому формату.','invalid_image');
 const id=createHash('sha256').update(bytes).digest('hex');
 await pgQuery('INSERT INTO site_content_media(id, mime_type, payload) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[id,file.type,bytes]);
 return `/api/site/media/${id}`;
}
function docRef(kind:ContentKind,slug:string) {return getDocumentDb().collection(STORE).doc(docKey(kind,slug));}
function revisionOf(raw:Record<string,unknown>){return typeof raw.revision_token==='string'&&raw.revision_token?raw.revision_token:String(raw.revision||1);}
function toItem(raw:any):SiteContentItem|null {
 if(!raw||!isContentKind(String(raw.kind))||!slugify(String(raw.slug||''))||typeof raw.title!=='string'||typeof raw.body!=='string')return null;
 const slug=slugify(raw.slug);return {status:raw.status==='draft'?'draft':'published',kind:raw.kind,path:publicPath(raw.kind,slug),name:`${slug}.md`,slug,title:raw.title,description:String(raw.description||''),body:raw.body,date:String(raw.date||''),updated_at:String(raw.updated_at||raw.last_modified_at||raw.date||''),last_modified_at:String(raw.last_modified_at||raw.date||''),author:String(raw.author||''),categories:String(raw.categories||''),tags:String(raw.tags||''),image:safeImage(raw.image),sha:revisionOf(raw)};
}
export async function listSiteContent(includeBody=true):Promise<SiteContentItem[]> {
 const rows=await getDocumentDb().collection(STORE).get();
 return rows.docs.map(doc=>{const item=toItem(doc.data());return item&&!includeBody?{...item,body:''}:item;}).filter((v):v is SiteContentItem=>!!v).sort((a,b)=>b.date.localeCompare(a.date)||a.path.localeCompare(b.path));
}
export async function getSiteContent(path:string):Promise<SiteContentItem|null>{
 const {kind,slug}=parsePath(path);const doc=await docRef(kind,slug).get();return doc.exists?toItem(doc.data()):null;
}
export async function publicSiteContent(page=1) {
 const items=(await listSiteContent()).filter(item=>item.status==='published');
 if(items.length>500)throw new ContentMutationError('Публічний каталог перевищує ліміт контракту: 500 матеріалів.','catalog_limit',503);
 const revision=createHash('sha256').update(JSON.stringify(items)).digest('hex');
 const limit=20,start=(page-1)*limit;
 return {schema:'mistblossom.public-content.v2',revision,total:items.length,next_page:start+limit<items.length?page+1:null,updated_at:new Date().toISOString(),items:items.slice(start,start+limit).map(({path,name,sha,...item})=>({...item,tags:item.tags.split(',').map(x=>x.trim()).filter(Boolean),categories:item.categories.split(',').map(x=>x.trim()).filter(Boolean)}))};
}

export async function createSiteContent(input:CreateContentInput) {
 const norm=normalized(input),requestId=String(input.requestId||'');
 if(requestId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestId))throw new ContentMutationError('Некоректний ідентифікатор надсилання.','invalid_request_id');
 if(requestId&&!input.user.id)throw new ContentMutationError('Потрібна чинна сесія редактора.','forbidden',403);
 const date=validDate(input.date),image=(await saveImage(input.image))||'/assets/img/news-placeholder.webp';
 const fingerprint=createHash('sha256').update(JSON.stringify({...norm,date,image})).digest('hex');
 const operation=requestId?getDocumentDb().collection('siteContentOperations').doc(createHash('sha256').update(JSON.stringify([input.user.id,requestId])).digest('hex')):null;
 return getDocumentDb().runTransaction(async tx=>{
  if(operation){
   const previous=await tx.get(operation);
   if(previous.exists){
    const receipt=previous.data()||{};
    if(receipt.fingerprint!==fingerprint)throw new ContentMutationError('Це надсилання вже виконано з іншим вмістом. Перевір матеріал у бібліотеці.','request_mismatch',409);
    if(!isManagedContentPath(String(receipt.path||'')))throw new ContentMutationError('Підтвердження недоступне. Перевір бібліотеку.','operation_superseded',409);
    const target=parsePath(String(receipt.path)),stored=await tx.get(docRef(target.kind,target.slug)),current=stored.exists?toItem(stored.data()):null;
    if(!current||current.sha!==receipt.revision)throw new ContentMutationError('Матеріал уже збережено, а потім змінено або видалено. Відкрий актуальну версію в бібліотеці.','operation_superseded',409);
    return {ok:true,duplicate:true,slug:current.slug,path:current.path,image:current.image,revision:current.sha!,status:current.status,item:current};
   }
  }
  const ref=docRef(norm.kind,norm.slug);
  if((await tx.get(ref)).exists)throw new ContentMutationError('Матеріал із такою адресою вже існує.','slug_exists',409);
  const item={...norm,date,last_modified_at:date,image,revision:1,revision_token:randomUUID(),updated_at:new Date().toISOString()};
  tx.create(ref,item);
  if(operation)tx.create(operation,{fingerprint,path:publicPath(norm.kind,norm.slug),revision:item.revision_token,created_at:new Date().toISOString()});
  return {ok:true,duplicate:false,slug:norm.slug,path:publicPath(norm.kind,norm.slug),image,revision:revisionOf(item),status:norm.status,item:toItem(item)!};
 });
}
export async function updateSiteContent(input:UpdateContentInput) {
 const old=parsePath(input.path);
 if(!canManageSiteContent(input.user))throw new ContentMutationError('Недостатньо прав.','forbidden',403);
 // Media uses its own pooled connection. Finish it before holding an article transaction.
 const current=await docRef(old.kind,old.slug).get();
 if(!current.exists)throw new ContentMutationError('Матеріал не знайдено. Онови список.','not_found',404);
 const initial=current.data()||{};
 if(revisionOf(initial)!==input.expectedRevision)throw new ContentMutationError('Матеріал уже змінено іншим редактором. Твої зміни залишились у формі.','revision_conflict',409);
 const norm=normalized({...input,status:input.status??(initial.status==='draft'?'draft':'published')});
 const date=validDate(input.date||String(initial.date||'')),modified=validDate(input.lastModifiedAt);
 if(input.removeImage&&input.image?.size)throw new ContentMutationError('Обери одну дію: замінити або прибрати обкладинку.','image_action');
 const uploaded=await saveImage(input.image);
 return getDocumentDb().runTransaction(async tx=>{
  const oldRef=docRef(old.kind,old.slug),previous=await tx.get(oldRef);
  if(!previous.exists)throw new ContentMutationError('Матеріал не знайдено. Онови список.','not_found',404);
  const before=previous.data()||{};
  if(revisionOf(before)!==input.expectedRevision)throw new ContentMutationError('Матеріал уже змінено іншим редактором. Твої зміни залишились у формі.','revision_conflict',409);
  const key=docKey(norm.kind,norm.slug),oldKey=docKey(old.kind,old.slug),nextRef=docRef(norm.kind,norm.slug);
  if(key!==oldKey&&(await tx.get(nextRef)).exists)throw new ContentMutationError('Матеріал із такою адресою вже існує.','slug_exists',409);
  const image=input.removeImage?'/assets/img/news-placeholder.webp':uploaded||safeImage(String(before.image||''));
  const record={...norm,date,last_modified_at:modified,image,revision:Number(before.revision||1)+1,revision_token:randomUUID(),updated_at:new Date().toISOString()};
  if(key===oldKey)tx.set(oldRef,record);else {tx.create(nextRef,record);tx.delete(oldRef);}
  return {ok:true,slug:norm.slug,path:publicPath(norm.kind,norm.slug),image,revision:revisionOf(record),status:norm.status,item:toItem(record)!};
 });
}
export async function deleteSiteContent(path:string,expectedRevision:string) {
 const {kind,slug}=parsePath(path),ref=docRef(kind,slug);
 await getDocumentDb().runTransaction(async tx=>{
  const previous=await tx.get(ref);if(!previous.exists)throw new ContentMutationError('Матеріал не знайдено.','not_found',404);
  if(revisionOf(previous.data()||{})!==expectedRevision)throw new ContentMutationError('Матеріал уже змінено. Онови сторінку перед видаленням.','revision_conflict',409);
  tx.delete(ref);
 });
}
