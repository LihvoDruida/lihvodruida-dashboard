import AdminPageHeader from "@/components/AdminPageHeader";
import {redirect} from 'next/navigation';
import DashboardIdentity from '@/components/DashboardIdentity';
import ContentEditor from '@/components/content/ContentEditor';
import ContentLibrary from '@/components/content/ContentLibrary';
import {getSession} from '@/lib/auth';
import {getOwnProfilePath} from '@/lib/profiles';
import {resolveAuthorIdentity} from '@/lib/authorIdentity';
import {canManageSiteContent} from '@/lib/permissions';
import {getSiteContent,isManagedContentPath,listSiteContent} from '@/lib/content';
import {buildPageMetadata} from '@/lib/seo';
export const metadata=buildPageMetadata({title:'Матеріали сайту',description:'Бібліотека, чернетки та публікація новин і гайдів.',path:'/content'});
export const dynamic='force-dynamic';
export const revalidate=0;
export default async function ContentPage({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const user=await getSession();if(!user)redirect('/login');if(!canManageSiteContent(user))redirect(await getOwnProfilePath(user));
 const params=await searchParams,isNew=params.new==='1'||params.action==='new',editing=!isNew&&!!params.edit;
 let failure='';let item:Awaited<ReturnType<typeof getSiteContent>>=null;let items:Awaited<ReturnType<typeof listSiteContent>>=[];let identity:Awaited<ReturnType<typeof resolveAuthorIdentity>>|null=null;
 try{
  const [authorIdentity,selectedItem,libraryItems] = await Promise.all([
   isNew||editing?resolveAuthorIdentity(user):Promise.resolve(null),
   editing&&isManagedContentPath(params.edit!)?getSiteContent(params.edit!):Promise.resolve(null),
   !isNew&&!editing?listSiteContent(false):Promise.resolve([]),
  ]);
  identity=authorIdentity;item=selectedItem;items=libraryItems;
  if(editing&&!item)failure=isManagedContentPath(params.edit!)?'Матеріал не знайдено. Він міг бути видалений або перейменований.':'Некоректна адреса матеріалу.';
 }catch{failure='Не вдалося завантажити матеріали. Перевір підключення до сховища та повтори спробу.';}
 const siteUrl=(process.env.PUBLIC_SITE_URL||'https://lihvodruida.pp.ua').replace(/\/+$/,'');
 return <main className="container app-page"><section className="dashboard-shell app-page-stack" aria-label="Керування матеріалами сайту"><DashboardIdentity user={user} activeSection="content"/>
  <AdminPageHeader eyebrow="Лігво Друїда / Редакція" title={isNew?'Створення матеріалу':item?'Редагування матеріалу':'Контент сайту'} description={isNew||item?'Підготуй текст, перевір вигляд і збережи чернетку або опублікуй.':<>Новини та гайди: від першої чернетки до публікації на сайті. Картки спільнот на головній — <a href="/content/communities">Спільноти на сайті</a>.</>} />
  {params.published||params.updated?<div className="notice panel success" role="status">Матеріал збережено.</div>:null}
  {params.deleted?<div className="notice panel success" role="status">Матеріал видалено.</div>:null}{params.error?<div className="notice panel error-note" role="alert">{params.error}</div>:null}
  {failure?<section className="notice panel error-note" role="alert"><p>{failure}</p><a className="btn subtle" href={editing?`/content?edit=${encodeURIComponent(params.edit!)}`:'/content'}>Повторити</a> <a className="btn subtle" href="/content">До бібліотеки</a></section>:isNew||item?<ContentEditor key={item?.path||'new'} initialItem={item} author={identity!.primaryName} authorSuggestions={identity!.suggestions} siteUrl={siteUrl} userId={user.id}/>:<ContentLibrary initial={items} siteUrl={siteUrl}/>}
 </section></main>;
}
