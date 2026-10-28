import { money,derive } from '../../ledger.js';
import { tenantStatement } from './finance-utils.js';
const sum=rows=>money(rows.reduce((n,r)=>n+Number(r.amount),0));
export function reconcileReport(db,report){
 const periods=new Map(report.rows.map(r=>[r.property.id,r.range]));
 const people=new Map((db.people || []).map(p=>[p.id,p]));
 const inPeriod=(row,date)=>{const range=periods.get(row.property_id || people.get(row.person_id)?.property_id) || report;return date&&date>=range.start&&date<=range.end&&date<=report.closingDate;};
 const payments=db.payments || [], dated=payments.filter(p=>p.date&&p.date<=report.closingDate);
 const rent=sum(payments.filter(p=>(p.kind || 'rent')==='rent'&&inPeriod(p,p.date)));
 const cost=sum((db.expenses || []).filter(e=>inPeriod(e,e.date)));
 const held=rows=>money(rows.reduce((n,p)=>n+(p.kind==='bond'?Number(p.amount):['bond_refund','bond_deducted','bond_applied'].includes(p.kind)?-Number(p.amount):0),0));
 const movements=dated.filter(p=>p.date>=report.start),total=kind=>sum(movements.filter(p=>p.kind===kind));
 const bond={opening:held(dated.filter(p=>p.date<report.start)),received:total('bond'),refunded:total('bond_refund'),retained:total('bond_deducted'),applied:total('bond_applied'),closing:held(dated)};
 const check=(label,source,reported)=>({label,source,reported,difference:money(reported-source)});
 const checks=[check('Recorded rent payments',rent,report.totals.rentReceived),check('Recorded expense receipts',cost,report.totals.recordedCost),check('Closing bond held',bond.closing,report.totals.bondHeld)];
 const state=derive(db,report.closingDate);
 const statementMismatches=state.people.filter(p=>tenantStatement(db,p.id,report.closingDate).balance!==money(p.owed-p.credit)).length;
 return {checks,bond,statementMismatches,allMatch:checks.every(c=>c.difference===0)&&statementMismatches===0};
}
