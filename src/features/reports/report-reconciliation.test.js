import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedgerReport} from './report-model.js';
import {reconcileReport} from './report-reconciliation.js';
const db={properties:[{id:'h',name:'Synthetic',lease_rent:0,lease_anchor:'2026-10-01'}],people:[{id:'p',property_id:'h',start_date:'2026-10-01',stay_type:'long',weekly_rate:0,bond:300}],payments:[{id:'bond',person_id:'p',property_id:'h',kind:'bond',date:'2026-09-30',amount:300},{id:'rent',person_id:'p',property_id:'h',kind:'rent',date:'2026-10-02',amount:100},{id:'applied',person_id:'p',property_id:'h',kind:'bond_applied',date:'2026-10-03',amount:85},{id:'refund',person_id:'p',property_id:'h',kind:'bond_refund',date:'2026-10-04',amount:215}],expenses:[{property_id:'h',category:'Repairs',date:'2026-10-02',amount:20}],charges:[]};
const opts={start:'2026-10-01',end:'2026-10-10',asOf:'2026-10-10'};
test('report source checks reconcile receipts, expenses, bond opening movements and tenant statements',()=>{
 const r=reconcileReport(db,createLedgerReport(db,opts));assert.equal(r.allMatch,true);assert.deepEqual(r.bond,{opening:300,received:0,refunded:215,retained:0,applied:85,closing:0});assert.equal(r.statementMismatches,0);
});
test('checks surface a missing or altered report total instead of claiming the figures reconcile',()=>{
 const report=createLedgerReport(db,opts);report.totals.rentReceived+=1;assert.equal(reconcileReport(db,report).allMatch,false);
 const unknown={...db,payments:[...db.payments,{person_id:'p',property_id:'missing',kind:'rent',date:'2026-10-05',amount:50}]};const r=reconcileReport(unknown,createLedgerReport(unknown,opts));assert.equal(r.checks[0].difference,-50);
});
