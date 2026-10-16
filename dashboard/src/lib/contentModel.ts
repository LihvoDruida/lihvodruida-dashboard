/** Browser-safe CMS contract shared by the editor and server. */
export type ContentStatus = 'draft' | 'published';
export const CONTENT_TEXT_LIMITS = { title:160, slug:90, description:600, categories:400, tags:400, author:120, body:200_000 } as const;
export function slugify(value:string) {
 const map:Record<string,string> = {а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia'};
 return Array.from(String(value||'').toLowerCase().trim()).map(ch=>map[ch]??ch).join('').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90).replace(/-+$/,'');
}
export function contentImageUrl(path:string,siteUrl:string) {
 const value=String(path||'').trim();
 if(/^\/api\/site\/media\/[a-f0-9]{64}$/.test(value))return value;
 if(/^https:\/\/(?:guild|admin)\.lihvodruida\.pp\.ua\/api\/site\/media\/[a-f0-9]{64}$/.test(value))return new URL(value).pathname;
 if(/^\/assets\/[A-Za-z0-9_./-]+$/.test(value)&&!value.includes('..'))return `${siteUrl.replace(/\/+$/,'')}${value}`;
 return '';
}
export function contentPublicUrl(kind:string,slug:string,siteUrl:string){return `${siteUrl.replace(/\/+$/,'')}/${kind==='guides'?'guides':'news'}/${encodeURIComponent(slug)}`;}
export function kyivDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
