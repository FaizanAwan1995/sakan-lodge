import assert from 'node:assert/strict';
export async function verifyAdminActions({t,sql,rpc,STAFF,OTHER,applyMigration,assertSingleAllocation}){
 await applyMigration();await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
 const prop=crypto.randomUUID(),room=crypto.randomUUID(),person=crypto.randomUUID();
 const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text today")).rows[0].today;
 await sql("insert into properties(id,name,lease_rent,lease_anchor) values($1,'Checkout synthetic',500,$2::date-5)",[prop,today]);
 await sql("insert into rooms(id,property_id,label,capacity) values($1,$2,'Checkout 1',1)",[room,prop]);
 await sql("insert into people(id,name,property_id,room_id,stay_type,weekly_rate,start_date,end_date) values($1,'Same day synthetic',$2,$3,'long',255,$4::date,$4::date+1)",[person,prop,room,today]);
 await t.test('nonstaff cannot force checkout or clear a balance',async()=>{await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);await assert.rejects(()=>rpc('admin_tenant_action',[person,'checkout_now',null,'Test checkout',null]),/Staff/);await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);});
 await t.test('same-day admin checkout frees the bed atomically and preserves the one-night debt',async()=>{
 const r=await rpc('admin_tenant_action',[person,'checkout_now',null,'Synthetic checkout test',null]);assert.equal(r.owed,35);assert.ok(r.person.checked_out_at);assert.notEqual(r.person.end_date,today);
 assert.equal((await sql('select sakan_private.free_spaces($1,$2::date,$2::date+1) free',[room,today])).rows[0].free,1);
 await assert.rejects(()=>rpc('admin_tenant_action',[person,'checkout_now',null,'Repeated checkout',null]),/already/);
 });
 await t.test('credit is audited, bounded, idempotent against stale balances, and never a receipt',async()=>{
 const before=(await sql('select count(*)::int n from payments')).rows[0].n;
 await assert.rejects(()=>rpc('admin_tenant_action',[person,'clear_balance',36,'Synthetic over-credit',35]),/within/);
 await assert.rejects(()=>rpc('admin_tenant_action',[person,'clear_balance',35,'',35]),/reason/);
 const r=await rpc('admin_tenant_action',[person,'clear_balance',35,'Dummy account waived',35]);assert.equal(r.owed,0);
 assert.equal((await sql('select count(*)::int n from payments')).rows[0].n,before);
 const c=(await sql("select * from charges where person_id=$1 and kind='adjustment'",[person])).rows[0];assert.equal(Number(c.amount),-35);assert.match(c.note,/Dummy account waived/);
 await assert.rejects(()=>rpc('admin_tenant_action',[person,'clear_balance',35,'Repeated credit',35]),/changed/);
 });
 await t.test('concurrent balance credits cannot both clear the same amount',{skip:!process.env.SAKAN_TEST_DATABASE_URL},async()=>{
 await sql("insert into charges(person_id,kind,due_date,amount,note) values($1,'adjustment',$2,20,'Synthetic new charge')",[person,today]);
 const clients=await Promise.all([0,1].map(async()=>{const pg=await import('pg');const c=new pg.default.Client({connectionString:process.env.SAKAN_TEST_DATABASE_URL});await c.connect();await c.query("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);return c;}));
 try{const results=await Promise.allSettled(clients.map(c=>c.query("select public.admin_tenant_action($1,'clear_balance',20,'Concurrent synthetic credit',20)",[person])));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);}finally{await Promise.all(clients.map(c=>c.end()));}
 });
}
