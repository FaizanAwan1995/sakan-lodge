import test from 'node:test';
import assert from 'node:assert/strict';
import { guidedSettlementPlan,settlementPlan } from './bond-settlement.js';
const person={bond_held:300,owed:85};
test('guided final-rent deduction calculates the remainder and only marks paid refunds as paid',()=>{
 assert.deepEqual(guidedSettlementPlan(person,85,0,false),{applied:85,retained:0,refunded:0,bond_held:215,owed:0,refundable:215});
 assert.deepEqual(guidedSettlementPlan(person,85,0,true),{applied:85,retained:0,refunded:215,bond_held:0,owed:0,refundable:215});
 const later=guidedSettlementPlan({...person,owed:0,bond_held:215},0,0,true);assert.equal(later.refunded,215);assert.equal(later.applied,0);
});
test('other deductions reduce the remainder without clearing rent or increasing cash receipts',()=>{
 const p=guidedSettlementPlan(person,85,20,true);assert.equal(p.refunded,195);assert.equal(p.retained,20);assert.equal(p.owed,0);
 const leaveRent=guidedSettlementPlan(person,0,20,true);assert.equal(leaveRent.owed,85);assert.equal(leaveRent.refunded,280);
 assert.equal(guidedSettlementPlan(person,0,0,false).refundable,300);
});
test('bond limits, outstanding balance and cent precision validate combined deductions',()=>{
 for(const [rent,other] of [[85,216],[86,0],[0,301],[-1,0],[85,-1],[85,0.001],[NaN,0],[0,Infinity]])assert.throws(()=>guidedSettlementPlan(person,rent,other,true));
 assert.throws(()=>settlementPlan(person,0,0,0));
 assert.equal(guidedSettlementPlan({bond_held:100.1,owed:50.05},50.05,0.05,true).refunded,50);
 assert.equal(guidedSettlementPlan({bond_held:50,owed:85},50,0,true).owed,35);
});
