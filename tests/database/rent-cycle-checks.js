import assert from 'node:assert/strict';
export async function verifyRentCycle({t,sql,rpc,STAFF,OTHER}) {
  await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
  const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
  const prop=(await sql("insert into properties(name,lease_rent,lease_anchor) values('Cycle synthetic',500,$1::date+5) returning id",[today])).rows[0].id;
  const id=(await sql("insert into people(name,property_id,stay_type,weekly_rate,start_date,end_date) values('Cycle synthetic',$1,'long',300,$2,$2::date+14) returning id",[prop,today])).rows[0].id;
  await t.test('check-in cycle persists through staff edits; server due is 600 instead of 210',async()=>{
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[id])).rows[0].due),210);
    let expected=(await sql('select to_jsonb(p) row from people p where id=$1',[id])).rows[0].row;
    await rpc('update_tenant_details',[id,expected,{rent_cycle_anchor:today}]);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[id])).rows[0].due),600);
    expected=(await sql('select to_jsonb(p) row from people p where id=$1',[id])).rows[0].row;
    await rpc('update_tenant_details',[id,expected,{first_charge_amount:550}]);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[id])).rows[0].due),550);
    await sql("insert into payments(person_id,date,amount,kind,property_id,method,received_by) values($1,$2,550,'rent',$3,'transfer','Synthetic')",[id,today,prop]);
    assert.equal(Number((await sql('select sakan_private.person_due($1) due',[id])).rows[0].due),0);
  });
  await t.test('nonstaff cannot change an anchor; a stale edit cannot restore old billing',async()=>{
    const expected=(await sql('select to_jsonb(p) row from people p where id=$1',[id])).rows[0].row;
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
    await assert.rejects(()=>rpc('update_tenant_details',[id,expected,{rent_cycle_anchor:null}]),/Staff/);
    await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
    await assert.rejects(()=>rpc('update_tenant_details',[id,{...expected,first_charge_amount:600},{rent_cycle_anchor:null}]),/changed/);
  });
}
