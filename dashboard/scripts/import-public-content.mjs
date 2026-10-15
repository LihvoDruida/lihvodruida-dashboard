#!/usr/bin/env node
/** One-time, non-destructive import of the former static Markdown pages into
 * the dashboard document store. Default mode is DRY RUN. Requires --apply.
 * Run after db-init and after backing up the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse as yamlParse} from 'yaml';
import pg from 'pg';
const here=path.dirname(fileURLToPath(import.meta.url));
const sourceArg=process.argv.find(x=>x.startsWith('--from='));
const source=path.resolve(sourceArg?sourceArg.slice('--from='.length):path.join(here,'../../import/legacy-site'));
const apply=process.argv.includes('--apply');
function slugify(value){return String(value||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90);}
const items=[];
for(const kind of ['guides','news']){
 const dir=path.join(source,`_${kind}`);if(!fs.existsSync(dir))continue;
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.md'))){
  const raw=fs.readFileSync(path.join(dir,file),'utf8').replace(/\r\n/g,'\n');
  const match=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);if(!match)throw new Error(`Invalid markdown: ${file}`);
  const meta=yamlParse(match[1])||{};
  const slug=slugify(meta.slug||file.replace(/^\d{4}-\d{2}-\d{2}-/,'').replace(/\.md$/,''));
  if(!slug)throw new Error(`Invalid slug for ${file}`);
  const date=String(meta.date||file.slice(0,10)).slice(0,10);
  const item={kind,slug,title:String(meta.title||slug),description:String(meta.description||''),body:match[2].trim(),author:String(meta.author||'Sebas'),date,last_modified_at:String(meta.last_modified_at||date).slice(0,10),tags:Array.isArray(meta.tags)?meta.tags.join(', '):String(meta.tags||''),categories:Array.isArray(meta.categories)?meta.categories.join(', '):String(meta.categories||''),image:String(meta.image||'/assets/img/news-placeholder.webp'),revision:1,updated_at:new Date().toISOString()};
  items.push(item);
 }
}
console.log(`${apply?'IMPORT':'DRY RUN'}: ${items.length} articles from ${source}`);
for(const item of items)console.log(`  ${item.kind}/${item.slug}: ${item.title}`);
if(!apply){console.log('No changes. Supply --apply after database backup.');process.exit(0);}
const connectionString=process.env.DATABASE_URL||process.env.POSTGRES_URL;if(!connectionString)throw new Error('DATABASE_URL or POSTGRES_URL is required');
const client=new pg.Client({connectionString});await client.connect();
try{await client.query('BEGIN');for(const item of items){await client.query("INSERT INTO documents(collection,doc_id,data) VALUES('siteArticles',$1,$2::jsonb) ON CONFLICT(collection,doc_id) DO NOTHING",[`${item.kind}:${item.slug}`,JSON.stringify(item)]);}await client.query('COMMIT');console.log(`Import completed; preexisting articles were kept unchanged.`);}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
