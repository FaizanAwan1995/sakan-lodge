import assert from 'node:assert/strict';
import pg from 'pg';
const original=new URL(process.env.SAKAN_TEST_DATABASE_URL);
assert.ok(['localhost','127.0.0.1'].includes(original.hostname),'Restore test must use a local disposable service');
assert.equal(original.pathname,'/sakan_test');
const restored=new URL(original);restored.pathname='/sakan_restore_test';
const source=new pg.Client({connectionString:original.toString()}),copy=new pg.Client({connectionString:restored.toString()});
await source.connect();await copy.connect();
try{
 const tables=await source.query("select schemaname,tablename from pg_tables where schemaname in ('public','sakan_private','auth','storage') order by schemaname,tablename");
 for(const table of tables.rows){
  const name='"'+table.schemaname+'"."'+table.tablename+'"';
  const query=`select count(*)::int n,md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),'')) hash from ${name} t`;
  assert.deepEqual((await copy.query(query)).rows,(await source.query(query)).rows,'Restored rows differ: '+name);
 }
 const definitions="select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='sakan_private' or (n.nspname='public' and p.proname in ('ledger_snapshot','manage_reservation','create_template_contract')) order by 1,2,3";
 assert.deepEqual((await copy.query(definitions)).rows,(await source.query(definitions)).rows,'Private functions or execution grants differ');
 await copy.query('set role anon');
 await assert.rejects(()=>copy.query('select * from public.people'),/permission denied/);
 await copy.query('reset role');
 await copy.query('set role authenticated');
 await copy.query("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false)");
 assert.equal((await copy.query('select count(*)::int n from public.agreement_templates')).rows[0].n,0);
 await assert.rejects(()=>copy.query('select public.ledger_snapshot()'),/staff|Staff|Administrator/);
 console.log('Encrypted synthetic dump restored all application/private tables and functions, preserved grants and rejected anonymous/non-staff financial access.');
}finally{await source.end();await copy.end();}
