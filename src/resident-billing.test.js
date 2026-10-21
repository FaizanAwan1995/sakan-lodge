import test from 'node:test';
import assert from 'node:assert/strict';
import { residentStayOption, residentBillingRow } from './resident-billing.js';
import { rentCharges, defaultRentForPeriod } from './ledger.js';
const person = { id:'test', stay_type:'short_weekly', weekly_rate:300, nightly_rate:300, start_date:'2026-10-22', end_date:'2026-11-05' };
const property = {lease_anchor:'2026-10-22'};
test('two-week short-term stay uses $300 weekly, not $300 nightly', () => {
  const saved = residentBillingRow(person);
  assert.equal(saved.stay_type, 'long');
  assert.equal(saved.nightly_rate, null);
  assert.equal(residentStayOption(saved), 'short_weekly');
  assert.equal(rentCharges(saved, property, '2026-11-05').reduce((sum,c) => sum+c.amount, 0), 600);
  assert.equal(defaultRentForPeriod(saved, property, person.start_date, '2026-11-04'), 600);
});
test('existing short and per-night agreements keep their historic nightly charges', () => {
  for (const stay_type of ['short','per_night']) {
    const nightly = {...person, stay_type};
    assert.equal(residentStayOption(nightly), 'per_night');
    assert.deepEqual(residentBillingRow(nightly), {...nightly, rent_cycle_anchor:null});
    assert.equal(rentCharges(nightly, property, '2026-11-05')[0].amount, 4200);
  }
});
test('short-term weekly needs a checkout; exactly two calendar months remains long-term', () => {
  assert.throws(()=>residentBillingRow({...person,end_date:''}), /check-out/);
  assert.equal(residentStayOption({...person, stay_type:'long',end_date:'2026-12-22'}), 'long');
});

test('check-in fortnight ignores the property anchor and never bills again at its next cycle', () => {
  const saved = residentBillingRow({...person, rent_cycle_anchor:person.start_date});
  const house = {lease_anchor:'2026-10-27'};
  const charges = rentCharges(saved, house, '2026-11-05');
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amount, 600);
  assert.equal(charges[0].period_start, '2026-10-22');
  assert.equal(charges[0].period_end, '2026-11-04');
  const extended = rentCharges({...saved,end_date:'2026-11-19',first_charge_amount:550}, house, '2026-11-05');
  assert.deepEqual(extended.map(c => [c.due_date,c.amount]), [['2026-10-22',550],['2026-11-05',600]]);
});
test('custom charge is not reapplied after paid-through and zero is an explicit override', () => {
  const saved = residentBillingRow({...person, rent_cycle_anchor:person.start_date, end_date:'2026-11-19',first_charge_amount:0});
  assert.equal(rentCharges(saved,{lease_anchor:'2026-10-27'},'2026-10-22')[0].amount,0);
  const charges = rentCharges({...saved,paid_up_to:'2026-11-04'},{lease_anchor:'2026-10-27'},'2026-11-05');
  assert.equal(charges[0].amount,600);
});
