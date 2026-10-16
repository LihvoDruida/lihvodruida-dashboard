import {pgQuery} from '@/lib/db/pgPool';
export const SITE_SYNC_SCHEMA='mistblossom.public-sync.v1';
/** Header-only row versions: no article bodies, contacts or browser credentials. */
export async function publicSiteSync(){
 const applications=process.env.STORAGE_APPLICATIONS_COLLECTION||'guildApplications';
 const result=await pgQuery<{resource:string;revision:string}>(`
 WITH resource_rows AS (
  SELECT 'content'::text AS resource,collection,doc_id,xmin::text AS row_version,updated_at
  FROM documents WHERE collection='siteArticles' AND COALESCE(data->>'status','published')='published'
  UNION ALL
  SELECT 'applications',collection,doc_id,xmin::text,updated_at FROM documents WHERE collection=$1
  UNION ALL
  SELECT 'guild',collection,doc_id,xmin::text,updated_at FROM documents
   WHERE collection IN ('guildRosterRecords','guildRuntimeCache','guildRaidHistory','dashboardRaids','dashboardSettings')
      OR collection LIKE 'guildRosterRecords/%/memberChunks'
 ), resources(resource) AS (VALUES ('content'),('applications'),('guild'))
 SELECT resources.resource,md5(COALESCE(string_agg(resource_rows.collection||'/'||doc_id||':'||row_version||':'||updated_at::text,',' ORDER BY resource_rows.collection,doc_id),'')) AS revision
 FROM resources LEFT JOIN resource_rows USING(resource) GROUP BY resources.resource`,[applications]);
 const resources=Object.fromEntries(result.rows.map(row=>[row.resource,row.revision]));
 if(!['content','applications','guild'].every(key=>/^[a-f0-9]{32}$/.test(resources[key]||'')))throw new Error('Invalid synchronization metadata');
 // Date transitions can remove a past scheduled raid without changing a DB row.
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'}).format(new Date());
 resources.guild=resources.guild+':'+day;
 return {schema:SITE_SYNC_SCHEMA,resources,checked_at:new Date().toISOString()};
}
