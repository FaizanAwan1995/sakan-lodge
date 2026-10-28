import { d2n,n2d,money,todayStr,LEDGER_START,paymentPropertyId } from '../../ledger.js';

export const COLLECTION_ADMINS=['Faizan','Danish','Joint account','Other / unassigned'];
const dateValid=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(d2n(v)) && n2d(d2n(v))===v;
const adminFor=value=>COLLECTION_ADMINS.slice(0,3).find(a=>a.toLowerCase()===String(value || '').trim().toLowerCase()) || 'Other / unassigned';
const sum=(rows,key)=>money(rows.reduce((n,r)=>n+(+r[key] || 0),0));
function totals(rows){
 const rentReceived=sum(rows.filter(r=>r.kind==='rent'),'received'),bondReceived=sum(rows.filter(r=>r.kind==='bond'),'received');
 const received=sum(rows,'received'),refunded=sum(rows,'refunded');
 return {rentReceived,bondReceived,received,refunded,net:money(received-refunded),
  cashReceived:sum(rows.filter(r=>r.method==='cash'),'received'),transferReceived:sum(rows.filter(r=>r.method==='transfer'),'received'),
  cashRefunded:sum(rows.filter(r=>r.method==='cash'),'refunded'),transferRefunded:sum(rows.filter(r=>r.method==='transfer'),'refunded'),count:rows.length};
}
export function createAdminCollections(db,{start,end,asOf=todayStr(),admin='all',method='all'}={}){
 if(!dateValid(start)||!dateValid(end)||!dateValid(asOf)||start>end||start<LEDGER_START)throw Error('Choose a valid collection date range on or after 1 July 2026.');
 if(admin!=='all'&&!COLLECTION_ADMINS.includes(admin))throw Error('Choose an administrator.');
 if(!['all','cash','transfer'].includes(method))throw Error('Choose cash, transfer or all payment modes.');
 const closingDate=end<asOf?end:asOf, people=new Map((db.people || []).map(p=>[p.id,p])),properties=new Map((db.properties || []).map(p=>[p.id,p]));
 const entries=[],excluded=[];let undated=0;
 for(const p of db.payments || []){
  if(!dateValid(p.date)){undated++;continue;}
  if(p.date<start||p.date>closingDate)continue;
  if(p.amount==null||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0||Math.abs(Number(p.amount)*100-Math.round(Number(p.amount)*100))>1e-7)throw Error('A selected transaction has an invalid amount. Reconcile it before using collection totals.');
  const row={id:p.id,date:p.date,kind:p.kind || 'rent',amount:Number(p.amount),method:p.method || '',admin:adminFor(p.received_by),handledBy:p.received_by || 'Not recorded',person:people.get(p.person_id)?.name || 'Unknown tenant',property:properties.get(paymentPropertyId(p,db.people || []))?.name || 'Unknown property',note:p.note || ''};
  if(admin!=='all'&&row.admin!==admin)continue;
  const actual=['rent','bond','bond_refund'].includes(row.kind)&&['cash','transfer'].includes(row.method);
  if(actual){if(method==='all'||method===row.method)entries.push({...row,received:row.kind==='bond_refund'?0:row.amount,refunded:row.kind==='bond_refund'?row.amount:0});}
  else if(method==='all'||method===row.method){
   const reason=['bond_applied','bond_deducted'].includes(row.kind)?'Bond allocation — no new money':row.method==='adjustment'?'Historical / noncash adjustment':'Payment mode not verified';
   excluded.push({...row,reason});
  }
 }
 entries.sort((a,b)=>b.date.localeCompare(a.date)||String(a.id).localeCompare(String(b.id)));excluded.sort((a,b)=>b.date.localeCompare(a.date));
 const rows=COLLECTION_ADMINS.filter(a=>admin==='all'||admin===a).map(a=>({admin:a,...totals(entries.filter(e=>e.admin===a))}));
 const result={start,end,closingDate,admin,method,entries,excluded,rows,totals:totals(entries),undated};
 result.reconciled=['received','refunded','net','rentReceived','bondReceived','cashReceived','transferReceived'].every(k=>sum(rows,k)===result.totals[k]);
 result.unknownHandlers=entries.filter(e=>e.admin==='Other / unassigned').length;
 result.unverifiedModes=excluded.filter(e=>e.reason==='Payment mode not verified').length;
 return result;
}
export function collectionSummaryRows(report){
 return [['Admin / recorded handler','Cash received AUD','Transfer received AUD','Rent received AUD','Bond received AUD','Total collected AUD','Cash bond refunds AUD','Transfer bond refunds AUD','Bond refunded AUD','Net receipts after bond refunds AUD','Transactions','From','Through'],
 ...report.rows.map(r=>[r.admin,r.cashReceived,r.transferReceived,r.rentReceived,r.bondReceived,r.received,r.cashRefunded,r.transferRefunded,r.refunded,r.net,r.count,report.start,report.closingDate]),
 ['TOTAL',report.totals.cashReceived,report.totals.transferReceived,report.totals.rentReceived,report.totals.bondReceived,report.totals.received,report.totals.cashRefunded,report.totals.transferRefunded,report.totals.refunded,report.totals.net,report.totals.count,report.start,report.closingDate]];
}
export function collectionTransactionRows(report){
 return [['Transaction ID','Date','Admin group','Recorded handler','Tenant','Property','Type','Mode','Amount AUD','Collected AUD','Bond refunded AUD','Included in collections','Exclusion reason','Note'],
 ...report.entries.map(r=>[r.id,r.date,r.admin,r.handledBy,r.person,r.property,r.kind,r.method,r.amount,r.received,r.refunded,'Yes','',r.note]),
 ...report.excluded.map(r=>[r.id,r.date,r.admin,r.handledBy,r.person,r.property,r.kind,r.method,r.amount,0,0,'No',r.reason,r.note])];
}
