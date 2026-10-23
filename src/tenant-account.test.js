import test from 'node:test';
import assert from 'node:assert/strict';
import {rentCharges,billingTermsAt,defaultRentForPeriod,accountSummary,balance} from './ledger.js';
const property={lease_anchor:'2026-10-02'};
const person={id:'a',stay_type:'long',start_date:'2026-10-02',weekly_rate:170};
test('future rates preserve all earlier charges and the original baseline',()=>{
 const scheduled={...person,billing_schedule:[{effective_from:'2026-10-30',weekly_rate:200,rent_cycle_anchor:'2026-10-30'}]};
 assert.deepEqual(rentCharges(scheduled,property,'2026-10-29'),rentCharges(person,property,'2026-10-29'));
 assert.deepEqual(rentCharges(scheduled,property,'2026-11-13').map(c=>c.amount),[340,340,400,400]);
 assert.equal(billingTermsAt(scheduled,'2026-10-29').weekly_rate,170);
 assert.equal(billingTermsAt(scheduled,'2026-10-30').weekly_rate,200);
 assert.equal(defaultRentForPeriod(scheduled,property,'2026-10-23','2026-11-05'),370);
 assert.equal(scheduled.weekly_rate,170);
});
test('future alignment change only prorates the new period, keeping earlier fortnights',()=>{
 const scheduled={...person,rent_cycle_anchor:'2026-10-02',billing_schedule:[{effective_from:'2026-10-30',weekly_rate:210,rent_cycle_anchor:null}]};
 const prop={lease_anchor:'2026-10-07'};
 const charges=rentCharges(scheduled,prop,'2026-11-04');
 assert.deepEqual(charges.map(c=>[c.due_date,c.amount]),[['2026-10-02',340],['2026-10-16',340],['2026-10-30',150],['2026-11-04',420]]);
});
test('account summary separates overdue, today and credit after oldest-first partial payments',()=>{
 const charges=[{due_date:'2026-10-02',amount:340},{due_date:'2026-10-16',amount:340}];
 const payments=[{date:'2026-10-16',amount:350,kind:'rent'},{date:'2026-10-16',amount:340,kind:'bond'}];
 const p={...person,charges,payments,...balance(charges,payments,'2026-10-16')};
 const summary=accountSummary(p,property,'2026-10-16');
 assert.equal(summary.overdue,0);assert.equal(summary.dueToday,330);assert.equal(summary.next.due_date,'2026-10-30');
 const partial=[{date:'2026-10-16',amount:100,kind:'rent'}];
 const other=accountSummary({...p,payments:partial,...balance(charges,partial,'2026-10-16')},property,'2026-10-16');
 assert.equal(other.overdue,240);assert.equal(other.dueToday,340);
});

test('a credit entered today pays oldest arrears before today’s charge',()=>{
 const charges=[{due_date:'2026-10-02',amount:340},{due_date:'2026-10-16',amount:340},{due_date:'2026-10-16',amount:-100}];
 const p={...person,charges,payments:[],...balance(charges,[],'2026-10-16')};
 const summary=accountSummary(p,property,'2026-10-16');
 assert.equal(summary.overdue,240);assert.equal(summary.dueToday,340);
});
