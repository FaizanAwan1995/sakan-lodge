import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from './ledger.js';
import { staySummary, roomResidents, stayEvents, historyMatches } from './stay-history.js';
import { settlementPlan } from './bond-settlement.js';
import { tenantStatement } from './features/reports/finance-utils.js';
import { createLedgerReport,reportTransactionRows } from './features/reports/report-model.js';
const today='2026-10-26';
const person={id:'p',name:'Synthetic former tenant',property_id:'h',room_id:'r',start_date:'2026-09-23',end_date:'2026-10-25',paid_up_to:'2026-10-24',stay_type:'long',weekly_rate:170,bond:300,bond_status:'paid'};
const db={properties:[{id:'h',name:'House',lease_rent:0,lease_anchor:'2026-09-25'}],rooms:[{id:'r',capacity:1}],people:[person],payments:[],charges:[],expenses:[]};
test('past stay summary separates elapsed scheduled checkout from actual confirmation and never invents receipts',()=>{
 const p=derive(db,today).people[0], summary=staySummary(p,today);
 assert.equal(summary.nights,32);assert.equal(summary.confirmed,false);assert.equal(summary.rentReceived,0);assert.equal(summary.bondReceived,0);assert.equal(p.legacy_bond_declared,300);
 assert.throws(()=>settlementPlan(p,0,300),/recorded bond/);
 assert.equal(staySummary({...p,checked_out_at:'2026-10-24T14:00:00Z'},today).end,'2026-10-25');
});
test('room histories retain previous room assignments and old names remain searchable by identity',()=>{
 const audit=[{id:1,tenant_id:'p',entity_table:'people',at:'2026-10-01T00:00:00Z',before_values:{...person,room_id:'old',name:'Former name'},after_values:person}];
 assert.equal(roomResidents([person],'old',audit).length,1);assert.equal(historyMatches(person,'Former name',audit),true);
 assert.equal(roomResidents([{...person,id:'different'}],'old',audit).length,0);
 assert.equal(stayEvents(person,audit)[0].title,'Room assignment changed');
 const elapsed={id:2,tenant_id:'p',entity_table:'people',action:'scheduled_checkout_elapsed',at:'2026-10-26T00:00:00Z',after_values:person};
 assert.match(stayEvents(person,[elapsed])[0].description,/not been confirmed/);
 assert.match(stayEvents({...person,end_date:'2026-10-30'},[elapsed])[0].description,/Previous scheduled/);
});
test('bond applied is a noncash settlement: debt and liability reduce once, while cash and earned rent stay unchanged',()=>{
 const base={...db,people:[{...person,paid_up_to:null}],payments:[{id:'bond',person_id:'p',property_id:'h',kind:'bond',date:'2026-09-23',amount:300,method:'transfer'}]};
 const before=derive(base,today).people[0];
 const afterDb={...base,payments:[...base.payments,{person_id:'p',property_id:'h',kind:'bond_applied',date:today,amount:85,method:'adjustment',settlement_id:'s'},{person_id:'p',property_id:'h',kind:'bond_refund',date:today,amount:215,method:'transfer',settlement_id:'s'}]};
 const after=derive(afterDb,today).people[0];assert.equal(after.owed,before.owed-85);assert.equal(after.bond_held,0);assert.equal(after.bond_applied,85);
 const statement=tenantStatement(afterDb,'p',today);assert.equal(statement.balance,after.owed);assert.equal(statement.bondHeld,0);assert.match(statement.transactions.find(t=>t.credit===85).description,/no new cash/);
 const options={start:'2026-09-01',end:today,asOf:today};const a=createLedgerReport(base,options), b=createLedgerReport(afterDb,options);
 assert.equal(a.totals.earnedRent,b.totals.earnedRent);assert.equal(a.totals.rentReceived,b.totals.rentReceived);assert.equal(b.bondActivity.appliedToRent,85);
 const rows=reportTransactionRows(b);assert.ok(rows.every(r=>r.length===rows[0].length));
 assert.equal(derive(afterDb,'2026-10-25').people[0].bond_held,300);
});
test('settlement preview rejects excess amounts, fractional cents and invalid amounts',()=>{
 const p={bond_held:300,owed:85};assert.deepEqual(settlementPlan(p,85,215),{applied:85,refunded:215,retained:0,bond_held:0,owed:0});
 for(const [a,r] of [[86,214],[85,216],[-1,300],[0,0],[NaN,1],[0.001,1],[Infinity,1]])assert.throws(()=>settlementPlan(p,a,r));
});

test('final-week rent deducted from bond leaves a pending refund until money is returned',()=>{
 const base={...db,people:[{...person,paid_up_to:null}],payments:[{id:'bond',person_id:'p',property_id:'h',kind:'bond',date:'2026-09-23',amount:300,method:'transfer'}]};
 const before=derive(base,today).people[0];
 assert.deepEqual(settlementPlan({...before,owed:85},85,0),{applied:85,refunded:0,retained:0,bond_held:215,owed:0});
 const deducted={...base,payments:[...base.payments,{id:'deduction',person_id:'p',property_id:'h',kind:'bond_applied',date:today,amount:85,method:'adjustment',settlement_id:'deduction-only'}]};
 const after=derive(deducted,today).people[0];
 assert.equal(after.bond_held,215);assert.equal(after.bond_refunded,0);assert.equal(after.owed,before.owed-85);
 const statement=tenantStatement(deducted,'p',today);assert.equal(statement.bondHeld,215);assert.equal(statement.balance,after.owed);
 const options={start:'2026-09-01',end:today,asOf:today};
 const report=createLedgerReport(deducted,options), original=createLedgerReport(base,options);
 assert.deepEqual(report.bondActivity,{received:300,refunded:0,retained:0,appliedToRent:85});
 assert.equal(report.totals.bondHeld,215);assert.equal(report.totals.arrears,original.totals.arrears-85);
 assert.equal(report.totals.rentReceived,original.totals.rentReceived);assert.equal(report.totals.operatingNet,original.totals.operatingNet);
 const csv=reportTransactionRows(report),row=csv.find(r=>r[0]==='bond_applied');
 assert.equal(row[csv[0].indexOf('Bond applied to rent AUD')],85);assert.equal(row[csv[0].indexOf('Rent received AUD')],0);
 const refunded={...deducted,payments:[...deducted.payments,{person_id:'p',property_id:'h',kind:'bond_refund',date:today,amount:215,method:'transfer'}]};
 assert.equal(derive(refunded,today).people[0].bond_held,0);
 assert.equal(createLedgerReport(refunded,options).bondActivity.refunded,215);
});

test('guided settlement report separates rent allocation, other deductions and the actual refund',()=>{
 const base={...db,people:[{...person,paid_up_to:null}],payments:[{person_id:'p',property_id:'h',kind:'bond',date:'2026-09-23',amount:300}]};
 const settled={...base,payments:[...base.payments,...[['bond_applied',85],['bond_deducted',20],['bond_refund',195]].map(([kind,amount])=>({person_id:'p',property_id:'h',date:today,kind,amount,settlement_id:'guided'}))]};
 const options={start:'2026-09-01',end:today,asOf:today},before=createLedgerReport(base,options),after=createLedgerReport(settled,options);
 assert.deepEqual(after.bondActivity,{received:300,refunded:195,retained:20,appliedToRent:85});
 assert.equal(after.totals.bondHeld,0);assert.equal(after.totals.rentReceived,before.totals.rentReceived);
 assert.equal(after.totals.arrears,before.totals.arrears-85);
 const statement=tenantStatement(settled,'p',today);assert.equal(statement.bondTransactions.at(-1).balance,0);
 const csv=reportTransactionRows(after),headers=csv[0];
 for(const [kind,column,amount] of [['bond_applied','Bond applied to rent AUD',85],['bond_deducted','Bond retained AUD',20],['bond_refund','Bond refunded AUD',195]])assert.equal(csv.find(r=>r[0]===kind)[headers.indexOf(column)],amount);
});
