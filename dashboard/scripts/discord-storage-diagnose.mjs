#!/usr/bin/env node
/** Read-only PostgreSQL diagnostics. Does not print credentials or profile data. */
import pg from 'pg';
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
await client.connect();
try{
 const result=await client.query("SELECT collection,count(*)::integer AS documents FROM documents WHERE collection=ANY($1) GROUP BY collection ORDER BY collection",[['dashboardProfiles','raids','raidEvents','polls','guildApplications','siteArticles']]);
 console.log(JSON.stringify({store:'postgres',collections:result.rows},null,2));
}finally{await client.end();}
