import assert from 'node:assert/strict';
export async function verifyTenantIdentity({t,sql,rpc,STAFF,OTHER,PROP}) {
  const id=crypto.randomUUID();
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  await sql("insert into people(id,name,property_id,stay_type,weekly_rate,start_date,bond_status) values($1,'Original synthetic tenant',$2,'long',185,'2027-01-01','not_paid')",[id,PROP]);
  const original=(await sql('select to_jsonb(p) row from people p where id=$1',[id])).rows[0].row;
  await t.test('tenant ID cannot be replaced and unsupported edit fields are rejected',async()=>{
    await assert.rejects(()=>sql('update people set id=$1 where id=$2',[crypto.randomUUID(),id]),/permanent/);
    await assert.rejects(()=>rpc('update_tenant_details',[id,original,{checked_out_at:null}]),/Unsupported/);
  });
  await t.test('canonical account edit updates one row and stale or nonstaff edits fail',async()=>{
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
    await assert.rejects(()=>rpc('update_tenant_details',[id,original,{name:'Unauthorized'}]),/Staff/);
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
    const changed=await rpc('update_tenant_details',[id,original,{name:'Renamed synthetic tenant',email:'synthetic@example.test'}]);
    assert.equal(changed.id,id);assert.equal(changed.name,'Renamed synthetic tenant');
    await assert.rejects(()=>rpc('update_tenant_details',[id,original,{name:'Stale edit'}]),/changed/);
  });
  await t.test('financial accounts cannot be deleted through the RPC or a direct delete',async()=>{
    const financeId=crypto.randomUUID();
    await sql("insert into people(id,name,property_id,stay_type,weekly_rate,start_date) values($1,'Financial synthetic',$2,'long',185,'2027-01-01')",[financeId,PROP]);
    await sql("insert into charges(person_id,kind,due_date,amount,note) values($1,'adjustment','2027-01-01',10,'Synthetic charge')",[financeId]);
    await assert.rejects(()=>rpc('remove_test_tenant',[financeId,'Synthetic removal']),/financial history/);
    await assert.rejects(()=>sql('delete from people where id=$1',[financeId]),/financial history/);
    assert.equal((await sql('select count(*)::int n from charges where person_id=$1',[financeId])).rows[0].n,1);
  });
  await t.test('linked booking tenant cannot be deleted even without a receipt',async()=>{
    const linked=(await sql('select checked_in_person_id id from reservations where checked_in_person_id is not null limit 1')).rows[0];
    assert.ok(linked);
    await assert.rejects(()=>rpc('remove_test_tenant',[linked.id,'Synthetic removal']),/linked to a booking|financial history/);
  });
  await t.test('test tenant removal preserves both original and renamed identity snapshots',async()=>{
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
    await assert.rejects(()=>rpc('remove_test_tenant',[id,'Synthetic removal']),/Staff/);
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
    await assert.rejects(()=>rpc('remove_test_tenant',[id,' ']),/reason/);
    await rpc('remove_test_tenant',[id,'Unused synthetic test']);
    assert.equal((await sql('select count(*)::int n from people where id=$1',[id])).rows[0].n,0);
    const logs=(await sql('select * from audit where tenant_id=$1 order by id',[id])).rows;
    assert.equal(logs[0].tenant_name,'Original synthetic tenant');
    assert.ok(logs.some(r=>r.tenant_name==='Renamed synthetic tenant'&&r.action.includes('Unused synthetic test')));
    assert.ok(logs.every(r=>r.action.includes(id)));
    await assert.rejects(()=>sql('update audit set tenant_name=$1 where tenant_id=$2',['Altered',id]),/cannot be changed/);
    await assert.rejects(()=>sql('delete from audit where tenant_id=$1',[id]),/cannot be changed/);
  });
  await t.test('new RPCs do not grant execution to anonymous clients',async()=>{
    const rows=(await sql("select has_function_privilege('anon','public.update_tenant_details(uuid,jsonb,jsonb)','EXECUTE') edits,has_function_privilege('anon','public.remove_test_tenant(uuid,text)','EXECUTE') removes")).rows[0];
    assert.equal(rows.edits,false);assert.equal(rows.removes,false);
  });
}
