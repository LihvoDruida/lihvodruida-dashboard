#!/usr/bin/env node
/** Preview by default; --apply commits the scoped removal. Never prints data/tokens. */
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--apply')||args.length>1){console.error('Usage: npm run db:remove-media -- [--apply]');process.exit(1);}
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required.');process.exit(1);}
const apply=args.includes('--apply');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='require'?{rejectUnauthorized:false}:undefined,connectionTimeoutMillis:10000});
let client;
try{
 client=await pool.connect();await client.query('BEGIN');
 await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='60s'");
 const sql=await readFile(new URL('./sql/remove-media.sql',import.meta.url),'utf8');
 const result=await client.query(sql);
 await client.query(apply?'COMMIT':'ROLLBACK');
 console.table(result.rows);
 console.log(apply?'Removal committed.':'Preview only: no changes committed. Use --apply after stopping the old workers.');
}catch{
 if(client)await client.query('ROLLBACK').catch(()=>{});
 console.error('Removal failed; transaction rolled back. Check database access and schema.');process.exitCode=1;
}finally{client?.release();await pool.end();}
