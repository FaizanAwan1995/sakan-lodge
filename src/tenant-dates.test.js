import test from 'node:test';import assert from 'node:assert/strict';import {tenantDateError} from './tenant-dates.js';
test('tenancy dates reject mistyped years, impossible dates and reversed periods',()=>{
 assert.ok(tenantDateError({start_date:'0006-07-15'}));assert.ok(tenantDateError({start_date:'2026-02-30'}));assert.ok(tenantDateError({start_date:'2026-07-15',end_date:'2026-07-15'}));assert.ok(tenantDateError({start_date:'2026-07-15',paid_up_to:'2026-07-13'}));assert.equal(tenantDateError({start_date:'2026-07-15',paid_up_to:'2026-07-14'}),'');assert.equal(tenantDateError({start_date:'2026-07-15',paid_up_to:'2026-10-12'}),'');
});
test('database rules reject invalid tenancy dates even without the form',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile}=await import('node:fs/promises');const db=new PGlite();
 try{await db.exec('create table people(start_date date,end_date date,paid_up_to date,rent_cycle_anchor date)');await db.exec(await readFile(new URL('../supabase/migrations/20261026081512_logical_tenant_dates.sql',import.meta.url),'utf8'));
 await assert.rejects(()=>db.exec("insert into people(start_date) values('0006-07-15')"),/tenant_dates_plausible/);
 await assert.rejects(()=>db.exec("insert into people(start_date,end_date) values('2026-07-15','2026-07-14')"),/tenant_dates_ordered/);
 await db.exec("insert into people(start_date,paid_up_to) values('2026-07-15','2026-10-12')");
 }finally{await db.close();}
});
