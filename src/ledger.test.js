import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './ledger.js';
import { bondStatusLabel, tabFromPath } from './app-helpers.js';

const fulham = { id: 'f', lease_rent: 1500, lease_anchor: '2026-09-02', lease_start: null };
const woodville = { id: 'w', lease_rent: 1650, lease_anchor: '2026-09-11', lease_start: null };
const clapham = { id: 'c', lease_rent: 1680, lease_anchor: '2026-08-29', lease_start: '2026-08-29', lease_first_amount: 1680 };

test('room URLs resolve to the rooms tab and bond labels are readable', () => {
  assert.equal(tabFromPath('/rooms/abc123'), 'rooms');
  assert.equal(tabFromPath('/home'), 'today');
  assert.equal(bondStatusLabel('not_paid'), 'Not paid');
  assert.equal(bondStatusLabel('paid'), 'Paid');
});

test('spec example: $170/week arriving Tuesday before Friday cycle proposes $70', () => {
  const r = L.proposeFirstCharge(170, '2026-09-22', woodville.lease_anchor);
  assert.equal(r.days, 3);
  assert.equal(r.exact, 72.86);
  assert.equal(r.proposed, 70);
  assert.equal(r.nextCycle, '2026-09-25');
});

test('arrival on cycle date has no part period', () => {
  assert.equal(L.proposeFirstCharge(170, '2026-09-25', woodville.lease_anchor).days, 0);
});

test('part-period rent is followed by fortnights on the house cycle', () => {
  const p = { id: 'p', stay_type: 'long', weekly_rate: 170, start_date: '2026-09-22' };
  const c = L.rentCharges(p, woodville, '2026-10-11');
  assert.deepEqual(c.map((x) => [x.due_date, x.amount]), [
    ['2026-09-22', 70], ['2026-09-25', 340], ['2026-10-09', 340],
  ]);
});

test('manual first part-period amount is respected only on initial move-in', () => {
  const p = { id: 'p', stay_type: 'long', weekly_rate: 170, start_date: '2026-09-22', first_charge_amount: 72.86 };
  assert.equal(L.rentCharges(p, woodville, '2026-09-24')[0].amount, 72.86);
  const resumed = L.rentCharges({ ...p, paid_up_to: '2026-10-08' }, woodville, '2026-10-11');
  assert.deepEqual(resumed.map((x) => [x.due_date, x.amount]), [['2026-10-09', 340]]);
});

test('paid-up-to starts charges the following day', () => {
  const p = { id: 'p', stay_type: 'long', weekly_rate: 170, start_date: '2025-03-01', paid_up_to: '2026-10-08' };
  assert.deepEqual(L.rentCharges(p, woodville, '2026-10-11').map((x) => x.due_date), ['2026-10-09']);
});

test('an imported paid-up-to date cannot create charges before move-in', () => {
  const p = { id: 'p', stay_type: 'long', weekly_rate: 170, start_date: '2026-09-22', paid_up_to: '2026-09-01' };
  const c = L.rentCharges(p, woodville, '2026-09-24');
  assert.equal(c[0].due_date, '2026-09-22');
});

test('short stay is charged once at nightly rate', () => {
  const p = { id: 's', stay_type: 'short', nightly_rate: 45, start_date: '2026-10-01', end_date: '2026-10-04' };
  const c = L.rentCharges(p, fulham, '2026-10-11');
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 135);
});

test('Clapham landlord rent starts at lease start then every 14 days', () => {
  const e = L.landlordExpenses(clapham, '2026-09-26');
  assert.deepEqual(e.map((x) => [x.date, x.amount]), [
    ['2026-08-29', 1680], ['2026-09-12', 1680], ['2026-09-26', 1680],
  ]);
});

test('pre-ledger leases project from their cycle anchor without a July 1 charge', () => {
  const e = L.landlordExpenses(fulham, '2026-07-31');
  assert.deepEqual(e.map((x) => x.date), ['2026-07-08', '2026-07-22']);
  assert.equal(L.landlordExpenses(clapham, '2026-08-28').length, 0);
});

test('upcoming landlord payment reflects a future first-payment override', () => {
  const p = { ...woodville, lease_start: '2026-10-20', lease_first_amount: 1234 };
  assert.deepEqual(L.nextLandlordPayment(p, '2026-10-11'), { date: '2026-10-20', days: 9, amount: 1234 });
});

test('Fulham uses the next scheduled cycle date from its anchor rather than a stale past due date', () => {
  const state = L.landlordPaymentStatus({ ...fulham, lease_anchor: '2026-10-13' }, '2026-10-12', []);
  assert.equal(state.status, 'Upcoming');
  assert.equal(state.next.date, '2026-10-13');
  assert.equal(state.next.days, 1);
  assert.equal(state.next.amount, 1500);
  assert.equal(state.paid, false);
});

test('the next scheduled landlord payment follows the property anchor, even when an older cycle has passed', () => {
  const p = { ...woodville, lease_start: null };
  const state = L.landlordPaymentStatus(p, '2026-10-11', []);
  assert.equal(state.status, 'Upcoming');
  assert.equal(state.next.date, '2026-10-23');
  assert.equal(state.next.days, 12);
  assert.equal(state.next.amount, 1650);
  assert.equal(state.paid, false);
});

test('balance allocates payments oldest-first and reports late days', () => {
  const charges = [{ due_date: '2026-09-25', amount: 340 }, { due_date: '2026-10-09', amount: 340 }];
  const b = L.balance(charges, [{ date: '2026-10-01', amount: 340 }], '2026-10-11');
  assert.equal(b.owed, 340);
  assert.equal(b.daysLate, 2);
});

test('future-dated and undated receipts do not reduce arrears today', () => {
  const charges = [{ due_date: '2026-10-01', amount: 100 }];
  assert.equal(L.balance(charges, [{ date: '2026-10-12', amount: 100 }], '2026-10-11').owed, 100);
  assert.equal(L.balance(charges, [{ amount: 100 }], '2026-10-11').owed, 100);
});

test('electricity excess is allocated by quarter nights and excludes departed residents', () => {
  const people = [
    { id: 'a', start_date: '2026-01-01' },
    { id: 'b', start_date: '2026-08-01' },
    { id: 'c', start_date: '2026-07-01', end_date: '2026-09-01' },
  ];
  const r = L.electricitySplit({ amount: 1106, cap: 800, qStart: '2026-07-01', qEnd: '2026-09-30', billDate: '2026-10-10', people });
  assert.equal(r.excess, 306);
  assert.deepEqual(r.shares.map((s) => [s.person.id, s.nights]), [['a', 92], ['b', 61]]);
  assert.equal(r.shares.reduce((s, x) => s + x.amount, 0), 306);
  assert.equal(r.shares[0].amount, 184);
});

test('electricity under the cap creates no resident charges', () => {
  const r = L.electricitySplit({ amount: 700, cap: 800, qStart: '2026-07-01', qEnd: '2026-09-30', billDate: '2026-10-10', people: [{ start_date: '2026-01-01' }] });
  assert.equal(r.shares.length, 0);
});

test('this fortnight and last fortnight ranges are calculated correctly', () => {
  assert.deepEqual(L.thisFortnightRange('2026-10-12'), { start: '2026-09-29', end: '2026-10-12', label: 'This fortnight' });
  assert.deepEqual(L.lastFortnightRange('2026-10-12'), { start: '2026-09-15', end: '2026-09-28', label: 'Last fortnight' });
});

test('property fortnight ranges are anchored per property instead of sharing one global window', () => {
  const clapham = { lease_anchor: '2026-10-23' };
  const woodville = { lease_anchor: '2026-10-11' };
  assert.deepEqual(L.lastFortnightRangeForProperty(clapham), { start: '2026-10-10', end: '2026-10-22', label: 'Last fortnight' });
  assert.deepEqual(L.thisFortnightRangeForProperty(woodville), { start: '2026-10-11', end: '2026-10-24', label: 'This fortnight' });
});

test('upcoming fortnight uses the next property cycle on or after today', () => {
  const clapham = { lease_anchor: '2026-10-23' };
  const woodville = { lease_anchor: '2026-10-11' };
  assert.deepEqual(L.upcomingFortnightRangeForProperty(clapham, '2026-10-12'), { start: '2026-10-23', end: '2026-11-05', label: 'Upcoming fortnight' });
  assert.deepEqual(L.upcomingFortnightRangeForProperty(woodville, '2026-10-12'), { start: '2026-10-25', end: '2026-11-07', label: 'Upcoming fortnight' });
});

test('last-fortnight rent collected uses the property fortnight rent schedule when tenants are all paid', () => {
  const property = { id: 'prop-1', name: 'Clapham' };
  const people = [
    { id: 'p1', property_id: 'prop-1', name: 'Alice', weekly_rate: 350 },
    { id: 'p2', property_id: 'prop-1', name: 'Bob', weekly_rate: 450 },
  ];
  const payments = [
    { person_id: 'p1', property_id: 'prop-1', kind: 'rent', date: '2026-10-10', amount: 400 },
    { person_id: 'p2', property_id: 'prop-1', kind: 'rent', date: '2026-10-20', amount: 500 },
    { person_id: 'p2', property_id: 'prop-1', kind: 'bond', date: '2026-10-20', amount: 1000 },
    { person_id: 'p3', property_id: 'prop-2', kind: 'rent', date: '2026-10-20', amount: 250 },
  ];
  assert.equal(L.propertyCycleRentCollected(property, people, payments, '2026-10-10', '2026-10-22'), 900);
  assert.equal(L.money(350 + 450), 800);
});

test('monthly default rent is calculated from each resident room rate when no manual totals are entered', () => {
  const property = { id: 'prop-1', name: 'Sample property' };
  const people = [
    { id: 'p1', property_id: 'prop-1', stay_type: 'long', weekly_rate: 350, start_date: '2026-09-01', end_date: null },
    { id: 'p2', property_id: 'prop-1', stay_type: 'short', nightly_rate: 80, start_date: '2026-09-05', end_date: '2026-09-10' },
  ];

  assert.equal(L.defaultRentForPeriod(people[0], property, '2026-09-01', '2026-09-30'), 1500);
  assert.equal(L.defaultRentForPeriod(people[1], property, '2026-09-01', '2026-09-30'), 400);
  assert.equal(L.money(1500 + 400), 1900);
});

test('derive tolerates null or missing table payloads instead of blanking the app', () => {
  const out = L.derive({ properties: null, people: null, charges: null, payments: null, expenses: null }, '2026-10-12');
  assert.deepEqual(out.props, {});
  assert.deepEqual(out.people, []);
  assert.deepEqual(out.expenses, []);
});

test('Australian financial-year boundaries are 1 July through 30 June', () => {
  assert.equal(L.fyEndYear('2026-10-11'), 2027);
  assert.equal(L.fyEndYear('2027-06-30'), 2027);
  assert.deepEqual(L.fyRange(2027), { start: '2026-07-01', end: '2027-06-30', label: 'FY 2026–27' });
});
