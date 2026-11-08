import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function verifyReferralCredit({t,sql,rpc,STAFF,OTHER,applyMigration}) {
 await applyMigration();
 await t.test('referral credit is atomic, retry-safe, separate from cash, and corrected with its invoice',async()=>{
  await sql('begin');
  try {
   await sql('reset role');
   await sql("select set_config('request.jwt.claim.sub',$1,false)",[STAFF]);
   const today=(await sql("select (now() at time zone 'Australia/Adelaide')::date::text d")).rows[0].d;
   const property=(await sql("insert into properties(name,lease_rent,lease_anchor,invoice_address) values('Referral test',500,$1,'10 Test Road') returning id",[today])).rows[0].id;
   const person=(await sql("insert into people(name,email,property_id,stay_type,weekly_rate,start_date) values('Referral test','referral@example.test',$1,'long',175,$2) returning id",[property,today])).rows[0].id;
   const data={kind:'rent',date:today,amount:250,method:'cash',received_by:'Faizan',referral_credit:100,referred_person:'New Resident'};
   const key=randomUUID();
   const payment=await rpc('account_transaction',[key,person,data]);
   assert.deepEqual(await rpc('account_transaction',[key,person,data]),payment);
   let credits=(await sql('select * from charges where referral_payment_id=$1',[payment.id])).rows;
   assert.equal(credits.length,1);assert.equal(Number(credits[0].amount),-100);
   assert.equal(Number((await sql("select sum(amount) n from payments where person_id=$1 and kind='rent'",[person])).rows[0].n),250);
   assert.equal(Number((await sql('select sakan_private.person_due($1) n',[person])).rows[0].n),0);
   let invoice=(await sql("select * from sakan_private.rent_invoices where payment_id=$1 and status<>'void'",[payment.id])).rows[0];
   assert.equal(Number(invoice.snapshot.payment.amount),250);
   assert.equal(Number(invoice.snapshot.referral_credit),100);
   assert.equal(Number(invoice.snapshot.total_settled),350);
   assert.equal(invoice.snapshot.referred_person,'New Resident');
   assert.equal(invoice.snapshot.lines.reduce((n,l)=>n+Number(l.amount),0),350);
   // Correct the referral without adding another cash payment or discount.
   const corrected=await rpc('account_transaction',[randomUUID(),person,{...data,amount:300,referral_credit:50},payment,'Correct referral amount']);
   credits=(await sql('select * from charges where referral_payment_id=$1',[payment.id])).rows;
   assert.equal(credits.length,1);assert.equal(Number(credits[0].amount),-50);
   assert.equal(Number((await sql('select sakan_private.person_due($1) n',[person])).rows[0].n),0);
   assert.equal((await sql('select status from sakan_private.rent_invoices where id=$1',[invoice.id])).rows[0].status,'void');
   await rpc('account_transaction',[randomUUID(),person,{...data,amount:350,referral_credit:0},corrected,'Remove referral credit']);
   assert.equal(Number((await sql('select amount from charges where referral_payment_id=$1',[payment.id])).rows[0].amount),0);
   for(const extra of [{referral_credit:-100},{referral_credit:100.123},{kind:'bond'},{referral_credit:'NaN'}]) {
    await sql('savepoint bad_referral');
    await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person,{...data,...extra}]),/referral/i);
    await sql('rollback to savepoint bad_referral');
   }
   await sql("select set_config('request.jwt.claim.sub',$1,false)",[OTHER]);
   await sql('set local role authenticated');
   await sql('savepoint outsider');
   await assert.rejects(()=>rpc('account_transaction',[randomUUID(),person,data]),/Staff/);
   await sql('rollback to savepoint outsider');
  } finally {await sql('rollback');}
 });
}
