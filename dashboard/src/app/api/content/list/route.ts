import {getSession} from '@/lib/auth';
import {canManageSiteContent} from '@/lib/permissions';
import {listSiteContent} from '@/lib/content';
import {contentJson} from '@/lib/contentApi';
import {logDashboardEvent} from '@/lib/security';
export const dynamic='force-dynamic';
export async function GET(){
 const session=await getSession();if(!session)return contentJson({error:'Увійди знову.',code:'unauthorized'},401);
 if(!canManageSiteContent(session))return contentJson({error:'Недостатньо прав.',code:'forbidden'},403);
 try{return contentJson({items:await listSiteContent(false),checkedAt:new Date().toISOString()});}
 catch{logDashboardEvent('error','content.list.failed');return contentJson({error:'Не вдалося отримати матеріали. Спробуй оновити список.'},503);}
}
