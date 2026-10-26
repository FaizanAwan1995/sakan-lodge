import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../ledger.js';
import { createLedgerReport, reportTransactionRows, reportForecastRows } from './report-model.js';
import { tenantStatement, csvRows } from './finance-utils.js';

const property = { id:'a', name:'Test A', lease_rent:200, lease_start:'2026-10-01', lease_anchor:'2026-10-01' };
const person = { id:'one', name:'Test Resident', property_id:'a', start_date:'2026-10-01', stay_type:'long', weekly_rate:100, bond:200 };
const fixture = (changes = {}) => ({ properties:[{...property}], people:[{...person}], charges:[], expenses:[], payments:[], ...changes });
const run = (db, changes = {}) => createLedgerReport(db, { start:'2026-10-01', end:'2026-10-05', asOf:'2026-10-05', ...changes });
const rent = (amount, date = '2026-10-02', other = {}) => ({ person_id:'one', property_id:'a', kind:'rent', amount, date, ...other });
const expense = (amount, other = {}) => ({ property_id:'a', amount, date:'2026-10-04', category:'Repairs & maintenance', ...other });

test('zero receipts stay zero while earned rent and forecasts remain separate', () => {
  const r = run(fixture());
  assert.equal(r.totals.rentReceived,0);
  assert.equal(r.totals.earnedRent,200);
  assert.equal(r.totals.forecastRent,200);
  assert.equal(r.totals.arrears,200);
  assert.equal(r.totals.recordedCost,0);
  assert.equal(r.totals.operatingCost,200);
});
test('imported paid-through balances do not erase earnings or invent cash', () => {
  const r = run(fixture({people:[{...person,paid_up_to:'2026-10-14'}]}));
  assert.equal(r.totals.earnedRent,200);
  assert.equal(r.totals.rentReceived,0);
  assert.equal(r.totals.arrears,0);
  assert.equal(r.quality.importedBalances,1);
});
test('future and undated receipts and expenses cannot become recorded results', () => {
  const r = run(fixture({payments:[rent(40),rent(100,'2026-10-06'),rent(100,undefined,{date:null})],expenses:[expense(25),expense(100,{date:'2026-10-06'})]}), {end:'2026-10-10'});
  assert.equal(r.totals.rentReceived,40);
  assert.equal(r.totals.recordedCost,25);
});
test('receipt property snapshot wins over a resident current property', () => {
  const r = run(fixture({properties:[property,{...property,id:'b',name:'Test B'}],people:[{...person,property_id:'b'}],payments:[rent(200)]}));
  assert.equal(r.rows.find(x=>x.property.id==='a').rentReceived,200);
  assert.equal(r.rows.find(x=>x.property.id==='b').rentReceived,0);
  assert.equal(r.totals.rentReceived,200);
});
test('old receipts without a property fall back to one resident property only', () => {
  const r = run(fixture({payments:[rent(200,undefined,{property_id:null})]}));
  assert.equal(r.totals.rentReceived,200);
});
test('full recorded landlord costs replace the scheduled cost on the same date', () => {
  const r = run(fixture({expenses:[expense(200,{date:'2026-10-01',category:'Landlord rent'})]}));
  assert.equal(r.totals.operatingCost,200);
  assert.equal(r.totals.recordedCost,200);
  assert.equal(r.entries.filter(e=>e.kind==='landlord_schedule').length,0);
});
test('partial landlord payment keeps only the unrecorded obligation as scheduled', () => {
  const r = run(fixture({expenses:[expense(75,{date:'2026-10-01',category:'Landlord rent'})]}));
  assert.equal(r.totals.operatingCost,200);
  assert.equal(r.totals.recordedCost,75);
  assert.equal(r.entries.find(e=>e.kind==='landlord_schedule').amount,125);
});
test('recorded costs above the scheduled obligation are preserved', () => {
  const r = run(fixture({expenses:[expense(250,{date:'2026-10-01',category:'Landlord rent'})]}));
  assert.equal(r.totals.operatingCost,250);
  assert.equal(r.totals.recordedCost,250);
});
test('off-cycle landlord entries remain visible and require allocation review', () => {
  const r=run(fixture({expenses:[expense(200,{date:'2026-10-02',category:'Landlord rent'})]}));
  assert.equal(r.quality.unmatchedLandlordCosts,1);
  assert.equal(r.totals.recordedCost,200);
});
test('business overhead is deducted exactly once from both business results', () => {
  const r = run(fixture({payments:[rent(200)],expenses:[expense(25),expense(10,{property_id:null})]}));
  assert.equal(r.rows[0].operatingNet,-25);
  assert.equal(r.totals.operatingNet,-35);
  assert.equal(r.totals.recordedCost,35);
  assert.equal(r.totals.receiptsLessCosts,165);
  assert.equal(r.overhead,10);
});
test('opening arrears are not new operating income', () => {
  const r = run(fixture({people:[{...person,opening_balance:50,created_at:'2026-10-01T00:00:00Z'}]}));
  assert.equal(r.totals.earnedRent,200);
  assert.equal(r.totals.otherEarned,0);
  assert.equal(r.totals.arrears,250);
  assert.equal(r.entries.find(e=>e.kind==='opening_balance').amount,50);
});
test('manual first part-period agreements and exclusive checkout dates are preserved', () => {
  const r = run(fixture({people:[{...person,start_date:'2026-10-03',weekly_rate:105,first_charge_amount:175}]}),{start:'2026-10-03',end:'2026-10-15',asOf:'2026-10-15'});
  assert.equal(r.totals.earnedRent,385);
  const departed = run(fixture({people:[{...person,end_date:'2026-10-05'}]}));
  assert.equal(departed.totals.earnedRent,55);
  assert.equal(departed.totals.forecastRent,55);
});
test('shared residents retain individual agreed rates rather than new public prices', () => {
  const r = run(fixture({people:[person,{...person,id:'two',weekly_rate:150}]}));
  assert.equal(r.totals.earnedRent,500);
});
test('legacy nightly residents retain their nightly rate and checkout excludes the last day', () => {
  const r = run(fixture({people:[{...person,stay_type:'short',nightly_rate:45,end_date:'2026-10-04'}]}));
  assert.equal(r.totals.earnedRent,135);
  assert.equal(r.totals.forecastRent,135);
});
test('one resident credit never clears another resident arrears', () => {
  const r = run(fixture({people:[person,{...person,id:'two'}],payments:[rent(500,undefined,{person_id:'two'})]}));
  assert.equal(r.totals.arrears,200);
  assert.equal(r.totals.credit,300);
});
test('bond receipts, refunds and retained amounts remain outside every income result', () => {
  const payments=[rent(200,undefined,{kind:'bond'}),rent(50,'2026-10-03',{kind:'bond_refund'}),rent(25,'2026-10-04',{kind:'bond_deducted'}),rent(100,'2026-10-06',{kind:'bond'})];
  const db=fixture({payments});
  const r=run(db), s=tenantStatement(db,'one','2026-10-05');
  assert.equal(r.totals.rentReceived,0);
  assert.equal(r.totals.bondHeld,125);
  assert.deepEqual(r.bondActivity,{received:200,refunded:50,retained:25,appliedToRent:0});
  assert.equal(s.bondHeld,125);
  assert.equal(s.balance,r.totals.arrears);
  assert.equal(s.bondTransactions.length,3);
});
test('bond liabilities carry across financial years independently of the selected activity', () => {
  const r=run(fixture({payments:[rent(200,'2027-06-30',{kind:'bond'}),rent(50,'2027-07-01',{kind:'bond_refund'}),rent(25,'2027-07-02',{kind:'bond_deducted'})]}),{start:'2027-07-01',end:'2027-07-03',asOf:'2027-07-03'});
  assert.equal(r.totals.bondHeld,125);
  assert.deepEqual(r.bondActivity,{received:0,refunded:50,retained:25,appliedToRent:0});
});
test('bond over-refunds are reported for reconciliation without hiding the discrepancy', () => {
  const db=fixture({payments:[rent(50,undefined,{kind:'bond_refund'})]});
  assert.equal(run(db).quality.bondIssues,1);
  assert.equal(tenantStatement(db,'one','2026-10-05').bondIssue,true);
});
test('personal reimbursements never add a second expense', () => {
  const unpaid=run(fixture({expenses:[expense(25,{paid_from:'personal',reimbursed:false})]}));
  const paid=run(fixture({expenses:[expense(25,{paid_from:'personal',reimbursed:true})]}));
  assert.equal(unpaid.totals.operatingCost,225);
  assert.equal(paid.totals.operatingCost,225);
  assert.equal(unpaid.unreimbursed,25);
  assert.equal(paid.unreimbursed,0);
});
test('utilities budgets are projections and cannot duplicate a recorded bill', () => {
  const r=run(fixture({properties:[{...property,lease_rent:0,bills_amount:310,bills_frequency:'monthly'}],people:[],expenses:[expense(200,{category:'Electricity'})]}),{end:'2026-10-31'});
  assert.equal(r.totals.operatingCost,200);
  assert.equal(r.totals.forecastUtilities,310);
  assert.equal(r.totals.forecastNet,-310);
});
test('calendar-month and leap-year budgets do not assume 30 or 365 days', () => {
  assert.equal(L.propertyBillsForPeriod({bills_amount:310},'2026-10-01','2026-10-31'),310);
  assert.equal(L.propertyBillsForPeriod({bills_amount:290},'2028-02-01','2028-02-29'),290);
  assert.equal(L.propertyBillsForPeriod({bills_amount:3660,bills_frequency:'yearly'},'2028-01-01','2028-12-31'),3660);
  assert.equal(L.propertyBillsForPeriod({bills_amount:300},'2026-09-30','2026-10-01'),19.68);
});
test('previous property cycles roll from historical anchors and contain exactly fourteen days', () => {
  const r=L.lastFortnightRangeForProperty({lease_anchor:'2026-07-01'},'2026-10-18');
  assert.deepEqual(r,{start:'2026-10-07',end:'2026-10-20',label:'Previous rent cycle'});
  assert.equal(L.d2n(r.end)-L.d2n(r.start)+1,14);
});
test('property cycle scopes and transaction CSV use identical windows', () => {
  const db=fixture({properties:[{...property,lease_anchor:'2026-09-02'},{...property,id:'b',name:'Test B',lease_anchor:'2026-09-07'}],payments:[rent(100,'2026-10-14'),rent(900,'2026-10-10'),rent(200,'2026-10-10',{property_id:'b'}),rent(800,'2026-10-20',{property_id:'b'})]});
  const r=run(db,{mode:'lastFortnight',asOf:'2026-10-18'}), rows=reportTransactionRows(r);
  assert.equal(r.totals.rentReceived,300);
  assert.equal(rows.slice(1).reduce((s,x)=>s+x[8],0),300);
  assert.equal(rows[0][0],'Type');
  assert.ok(!rows.slice(1).some(row=>row[5]===900||row[5]===800));
});
test('actual CSV columns reconcile to report totals and header stays first', () => {
  const r=run(fixture({payments:[rent(50)],expenses:[expense(25),expense(10,{property_id:null})]}));
  const rows=reportTransactionRows(r), values=rows.slice(1);
  for(const [column,key] of [[6,'earnedRent'],[8,'rentReceived'],[9,'operatingCost'],[10,'recordedCost']])
    assert.equal(L.money(values.reduce((sum,row)=>sum+row[column],0)),r.totals[key]);
  assert.match(csvRows(rows),/^\uFEFF"Type","Date"/);
  assert.equal(reportForecastRows(r).at(-1).at(-1),r.totals.forecastNet);
});
test('the Australian year boundary separates receipts without reallocating earned cycles', () => {
  const db=fixture({payments:[rent(100,'2027-06-30'),rent(200,'2027-07-01')]});
  assert.equal(run(db,{mode:'fy',fy:2027,asOf:'2027-07-02'}).totals.rentReceived,100);
  assert.equal(run(db,{mode:'fy',fy:2028,asOf:'2027-07-02'}).totals.rentReceived,200);
});
test('pending and held reservations are not income and cannot create projected resident rent', () => {
  const r=run(fixture({people:[],reservations:[{status:'held',weekly_rate:255,spaces_requested:2}]}));
  assert.equal(r.totals.rentReceived,0);
  assert.equal(r.totals.earnedRent,0);
  assert.equal(r.totals.forecastRent,0);
});
test('forecasts follow the same agreed due schedule as earned rent', () => {
  const r=run(fixture(),{end:'2026-10-31'});
  assert.equal(r.totals.earnedRent,200);
  assert.equal(r.totals.forecastRent,600);
  assert.equal(r.totals.rentReceived,0);
});
test('legacy paid bond declarations remain visible without fabricating receipt dates', () => {
  const r=run(fixture({people:[{...person,bond:350,bond_status:'paid'}]}));
  assert.equal(r.totals.bondHeld,0);
  assert.equal(r.quality.legacyPaidBonds,1);
  assert.equal(r.quality.legacyPaidBondAmount,350);
  assert.equal(r.bondActivity.received,0);
});
test('bad date inputs fail cleanly instead of rendering invented zero totals', () => {
  for(const values of [{start:'2026-02-30'},{start:'2026-10-06'},{mode:'month',month:'2026-13'},{end:'2026-06-30'}])
    assert.throws(()=>run(fixture(),values),/valid/);
});
test('invalid transaction amounts cannot silently become zero', () => {
  for(const amount of [null,'NaN','Infinity']) assert.throws(()=>run(fixture({payments:[rent(amount)]})),/amounts are invalid/);
});
test('an unknown agreed rate is not reported as a free stay', () => {
  assert.throws(()=>run(fixture({people:[{...person,weekly_rate:null}]})),/valid agreed rent rate/);
});
test('financial CSV cells neutralize spreadsheet formulas while numbers remain numeric', () => {
  const csv=csvRows([['=1+1',' +1','@value','-value','\t=2','\r=3',-10,'quote",comma']]);
  for(const text of ['=1+1',' +1','@value','-value','\t=2','\r=3']) assert.ok(csv.includes('"\''+text+'"'));
  assert.ok(csv.includes('"-10"'));
  assert.ok(csv.includes('"quote"",comma"'));
});
test('reporting never mutates resident agreements or transaction records', () => {
  const db=fixture({people:[{...person,paid_up_to:'2026-10-14',weekly_rate:175,bond:350}],payments:[rent(175)],expenses:[expense(25)]});
  const before=JSON.stringify(db);
  run(db);tenantStatement(db,'one','2026-10-05');
  assert.equal(JSON.stringify(db),before);
});
