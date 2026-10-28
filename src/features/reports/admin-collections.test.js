import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminCollections,collectionSummaryRows,collectionTransactionRows} from './admin-collections.js';
import {csvRows} from './finance-utils.js';
const pay=(id,amount,kind='rent',method='cash',received_by='Faizan',date='2026-10-15')=>({id,person_id:'p',property_id:'h',amount,kind,method,received_by,date});
const db={people:[{id:'p',name:'Synthetic tenant',property_id:'h'}],properties:[{id:'h',name:'Synthetic house'}],payments:[pay('rent',100),pay('bond',300,'bond','transfer','Danish'),pay('refund',50,'bond_refund','transfer','Danish'),pay('applied',85,'bond_applied','adjustment','Danish'),pay('retained',20,'bond_deducted','transfer','Danish'),pay('opening',300,'bond','adjustment','Historical reconciliation'),pay('joint',60,'rent','transfer','Joint account')]};
const opts={start:'2026-10-01',end:'2026-10-31',asOf:'2026-10-29'};
test('admin collections separate receipts, refunds and noncash bond allocations',()=>{
 const r=createAdminCollections(db,opts);assert.equal(r.totals.received,460);assert.equal(r.totals.rentReceived,160);assert.equal(r.totals.bondReceived,300);assert.equal(r.totals.refunded,50);assert.equal(r.totals.net,410);assert.equal(r.excluded.length,3);assert.equal(r.reconciled,true);
 const danish=r.rows.find(x=>x.admin==='Danish');assert.equal(danish.transferReceived,300);assert.equal(danish.refunded,50);assert.equal(danish.net,250);
 assert.equal(r.rows.find(x=>x.admin==='Joint account').received,60);
});
test('admin and mode filters apply consistently to details, summary and exports',()=>{
 const r=createAdminCollections(db,{...opts,admin:'Danish',method:'transfer'});assert.equal(r.entries.length,2);assert.equal(r.totals.received,300);assert.equal(r.excluded.length,1);
 const summary=collectionSummaryRows(r),transactions=collectionTransactionRows(r);assert.ok(summary.every(row=>row.length===summary[0].length));assert.ok(transactions.every(row=>row.length===transactions[0].length));assert.equal(summary.at(-1)[5],300);assert.equal(transactions.slice(1).reduce((n,row)=>n+row[9],0),300);assert.equal(transactions.slice(1).reduce((n,row)=>n+row[10],0),50);
 const cash=createAdminCollections(db,{...opts,method:'cash'});assert.equal(cash.totals.received,100);assert.equal(cash.totals.refunded,0);
});
test('date boundaries are inclusive and future or undated payments cannot enter collections',()=>{
 const r=createAdminCollections({...db,payments:[pay('before',100,'rent','cash','Faizan','2026-09-30'),pay('start',10,'rent','cash','Faizan','2026-10-01'),pay('today',20,'rent','cash','Faizan','2026-10-29'),pay('future',30,'rent','cash','Faizan','2026-10-30'),pay('undated',40,'rent','cash','Faizan',null)]},opts);
 assert.equal(r.totals.received,30);assert.equal(r.undated,1);
 const single=createAdminCollections({...db,payments:[pay('x',10)]},{...opts,start:'2026-10-15',end:'2026-10-15'});assert.equal(single.totals.received,10);
});
test('unknown handlers and payment modes are explicit, not assigned to either admin',()=>{
 const r=createAdminCollections({...db,payments:[pay('blank',10,'rent','cash',''),pay('case',20,'rent','transfer',' faizan '),pay('unknown-mode',30,'rent','other','Danish'),pay('rent-adjustment',40,'rent','adjustment','Danish')]},opts);
 assert.equal(r.unknownHandlers,1);assert.equal(r.rows.find(x=>x.admin==='Other / unassigned').received,10);assert.equal(r.rows.find(x=>x.admin==='Faizan').received,20);assert.equal(r.unverifiedModes,1);assert.equal(r.totals.received,30);
});
test('refund-only periods can have negative net receipts without becoming negative collections',()=>{
 const r=createAdminCollections({...db,payments:[pay('refund',215,'bond_refund','transfer','Danish')]},opts);assert.equal(r.totals.received,0);assert.equal(r.totals.net,-215);
});
test('invalid ranges and amounts fail clearly; CSV text remains formula safe',()=>{
 for(const changes of [{start:'2026-10-32'},{start:'2026-10-30',end:'2026-10-01'},{method:'adjustment'},{admin:'Unknown'}])assert.throws(()=>createAdminCollections(db,{...opts,...changes}));
 for(const amount of [NaN,Infinity,-1,0,0.001])assert.throws(()=>createAdminCollections({...db,payments:[pay('bad',amount)]},opts));
 const r=createAdminCollections({...db,people:[{id:'p',name:'=HYPERLINK("bad")'}]},opts);assert.ok(csvRows(collectionTransactionRows(r)).includes("'=HYPERLINK"));
 assert.equal(createAdminCollections({payments:[]},opts).totals.received,0);
});
