import { money } from './ledger.js';
export function settlementPlan(person, apply, refund) {
 const applied=Number(apply), refunded=Number(refund), held=Number(person.bond_held || 0), owed=Number(person.owed || 0);
 if (![applied,refunded].every(n=>Number.isFinite(n)&&n>=0&&Math.abs(n*100-Math.round(n*100))<1e-7) || applied+refunded<=0) throw Error('Enter positive settlement amounts with at most two decimal places.');
 if (applied>owed) throw Error('The amount applied cannot exceed outstanding rent and charges.');
 if (money(applied+refunded)>held) throw Error('Settlement exceeds recorded bond held. Record or reconcile the original bond receipt first.');
 return {applied,refunded,bond_held:money(held-applied-refunded),owed:money(owed-applied)};
}
