import { money } from './ledger.js';
export function settlementPlan(person, apply, refund, retain = 0) {
 const applied=Number(apply), refunded=Number(refund), retained=Number(retain), held=Number(person.bond_held || 0), owed=Number(person.owed || 0);
 if (![applied,refunded,retained].every(n=>Number.isFinite(n)&&n>=0&&Math.abs(n*100-Math.round(n*100))<1e-7) || applied+refunded+retained<=0) throw Error('Enter positive settlement amounts with at most two decimal places.');
 if (applied>owed) throw Error('The amount applied cannot exceed outstanding rent and charges.');
 if (money(applied+refunded+retained)>held) throw Error('Settlement exceeds recorded bond held. Record or reconcile the original bond receipt first.');
 return {applied,refunded,retained,bond_held:money(held-applied-refunded-retained),owed:money(owed-applied)};
}
export function guidedSettlementPlan(person, apply, retain, refundPaid) {
 const refundable=money(Math.max(0,Number(person.bond_held || 0)-Number(apply)-Number(retain)));
 const complete=settlementPlan(person,apply,refundable,retain);
 return {...complete,refunded:refundPaid ? refundable : 0,bond_held:refundPaid ? 0 : refundable,refundable};
}
