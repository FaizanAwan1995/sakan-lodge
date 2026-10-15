// SAKAN Lodge — cycle arithmetic. Pure functions, no I/O. Dates are 'YYYY-MM-DD' strings;
// internally converted to whole UTC day numbers so timezones and DST can never shift a date.

export const LEDGER_START = '2026-07-01';
const DAY = 86400000;

export const d2n = (s) => Math.round(Date.parse(s + 'T00:00:00Z') / DAY);
export const n2d = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const todayStr = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide' }).format(new Date());
const mod = (a, b) => ((a % b) + b) % b;
export const money = (x) => Math.round((+x || 0) * 100) / 100;
export const floor5 = (x) => Math.floor(x / 5 + 1e-9) * 5;
const num = (x) => (x === null || x === undefined || x === '' ? null : +x);

/** First cycle date on or after `day` (day number), for a cycle anchored at `anchor`. */
export function nextCycleOnOrAfter(anchor, day) {
  return day + mod(d2n(anchor) - day, 14);
}

/** Rule 3.3: pro-rata for a mid-cycle arrival. Arrival day is charged; rounded DOWN to $5 as a proposal. */
export function proposeFirstCharge(weekly, arrival, anchor) {
  const s = d2n(arrival);
  const nc = nextCycleOnOrAfter(anchor, s);
  const days = nc - s;
  return { days, exact: money((weekly / 7) * days), proposed: floor5((weekly / 7) * days), nextCycle: n2d(nc) };
}

export function isActive(p, today) {
  return !p.end_date || p.end_date > today;
}

/** Rent charges for one person, due on or before asOf. Derived, never stored (spec §4). */
export function rentCharges(person, property, asOf) {
  const out = [];
  if (!property || !person.start_date) return out;
  const lim = d2n(asOf);
  const base = { kind: 'rent', person_id: person.id, derived: true };

  if (person.stay_type === 'short' || person.stay_type === 'per_night') {
    // Rule 3.4: one charge for the whole booking at the nightly rate.
    const s = d2n(person.start_date);
    const e = person.end_date ? d2n(person.end_date) : s + 1;
    const nights = Math.max(1, e - s);
    const covered = person.paid_up_to && d2n(person.paid_up_to) >= s;
    if (!covered && s <= lim) {
      const amt = num(person.first_charge_amount) ?? money(nights * (+person.nightly_rate || 0));
      out.push({ ...base, period_start: n2d(s), period_end: n2d(e - 1), due_date: n2d(s), amount: amt, note: `${nights} night(s)` });
    }
    return out;
  }

  // Long stay — rules 3.2 / 3.3. Charges begin the day after paid_up_to, else on move-in.
  const w = +person.weekly_rate || 0;
  let s = person.paid_up_to ? d2n(person.paid_up_to) + 1 : d2n(person.start_date);
  // Never create charges before the actual move-in date, even if `paid_up_to`
  // was imported with an earlier date.
  s = Math.max(s, d2n(person.start_date), d2n(LEDGER_START));
  const end = person.end_date ? d2n(person.end_date) : Infinity; // end_date = move-out day, not charged
  let first = true;
  while (s < end && s <= lim) {
    const nc = nextCycleOnOrAfter(property.lease_anchor, s);
    let pe, amt, note;
    if (nc > s) {
      pe = Math.min(nc, end);
      const days = pe - s;
      // Only use the override for the resident's actual move-in part period.
      // It must not be reused when resuming charges after `paid_up_to`, or for
      // a resident whose stay began before this ledger's 1 July 2026 start.
      const isInitialMoveIn = first && !person.paid_up_to &&
        s === d2n(person.start_date) && s >= d2n(LEDGER_START);
      const override = isInitialMoveIn ? num(person.first_charge_amount) : null;
      amt = override ?? floor5((w / 7) * days);
      note = `Part period, ${days} day(s)`;
    } else {
      pe = Math.min(s + 14, end);
      const days = pe - s;
      amt = days === 14 ? 2 * w : floor5((w / 7) * days);
      note = days === 14 ? 'Fortnight' : `Final part period, ${days} day(s)`;
    }
    out.push({ ...base, period_start: n2d(s), period_end: n2d(pe - 1), due_date: n2d(s), amount: amt, note });
    s = pe;
    first = false;
  }
  return out;
}

export function openingCharge(person) {
  if (!(+person.opening_balance > 0)) return [];
  const due = person.created_at ? String(person.created_at).slice(0, 10) : person.start_date;
  return [{ kind: 'opening', person_id: person.id, derived: true, due_date: due, period_start: due, period_end: due, amount: +person.opening_balance, note: 'Opening balance' }];
}

/** Rule 3.7: automatic landlord rent, nothing before lease start or ledger start. */
export function landlordExpenses(p, asOf) {
  const lim = d2n(asOf);
  const ledger = d2n(LEDGER_START);
  const mk = (d, amount, note) => ({ id: `auto-${p.id}-${n2d(d)}`, property_id: p.id, date: n2d(d), category: 'Landlord rent', amount, note, paid_from: 'business', reimbursed: false, auto: true });
  const out = [];
  let d;
  if (p.lease_start && d2n(p.lease_start) >= ledger) {
    const ls = d2n(p.lease_start);
    const nc = nextCycleOnOrAfter(p.lease_anchor, ls);
    const amt = num(p.lease_first_amount) ?? (nc === ls ? +p.lease_rent : money((p.lease_rent / 14) * (nc - ls)));
    if (ls <= lim) out.push(mk(ls, amt, 'First payment'));
    d = nc === ls ? ls + 14 : nc;
  } else {
    d = nextCycleOnOrAfter(p.lease_anchor, ledger);
  }
  for (; d <= lim; d += 14) out.push(mk(d, +p.lease_rent, 'Landlord rent'));
  return out;
}

export function nextLandlordPayment(p, today) {
  const from = d2n(today);
  if (p.lease_start && d2n(p.lease_start) > from) {
    const start = d2n(p.lease_start);
    const firstCycle = nextCycleOnOrAfter(p.lease_anchor, start);
    const firstAmount = num(p.lease_first_amount) ??
      (firstCycle === start ? +p.lease_rent : money((+p.lease_rent / 14) * (firstCycle - start)));
    return { date: p.lease_start, days: start - from, amount: firstAmount };
  }
  const n = nextCycleOnOrAfter(p.lease_anchor, from);
  return { date: n2d(n), days: n - from, amount: +p.lease_rent };
}

export function landlordPaymentStatus(property, today, expenses = []) {
  const next = nextLandlordPayment(property, today);
  const matchingExpense = expenses
    .filter((expense) => expense.property_id === property.id && expense.category === 'Landlord rent')
    .find((expense) => expense.date === next.date && +expense.amount >= +next.amount * 0.99);

  const paid = Boolean(matchingExpense);
  const status = paid ? 'Paid' : next.days <= 0 ? 'Unpaid' : 'Upcoming';
  return { next, paid, status, days: next.days };
}

/** Balance with oldest-first allocation of payments, for "days late". */
export function balance(charges, payments, asOf) {
  const due = charges.filter((c) => c.due_date <= asOf).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const charged = money(due.reduce((s, c) => s + +c.amount, 0));
  // Only receipts taken by the report date count toward the balance. Future-dated
  // entries must not hide today's arrears when someone is entering payments in advance.
  const received = payments.filter((p) => (!p.kind || p.kind === 'rent') && p.date && p.date <= asOf);
  const paid = money(received.reduce((s, p) => s + +p.amount, 0));
  let rem = paid, oldest = null;
  for (const c of due) {
    if (rem + 0.005 >= +c.amount) rem -= +c.amount;
    else { oldest = c.due_date; break; }
  }
  return {
    charged, paid,
    owed: money(Math.max(0, charged - paid)),
    credit: money(Math.max(0, paid - charged)),
    daysLate: oldest ? d2n(asOf) - d2n(oldest) : 0,
    oldestUnpaid: oldest,
  };
}

/** Rule 3.6: excess over cap split pro-rata by nights in the quarter, current residents only. */
export function electricitySplit({ amount, cap, qStart, qEnd, billDate, people }) {
  const excess = money(Math.max(0, +amount - +cap));
  const qs = d2n(qStart), qe = d2n(qEnd) + 1, bd = d2n(billDate);
  const rows = people
    .filter((p) => d2n(p.start_date) <= bd && (!p.end_date || d2n(p.end_date) > bd))
    .map((p) => {
      const s = Math.max(qs, d2n(p.start_date));
      const e = Math.min(qe, p.end_date ? d2n(p.end_date) : qe);
      return { person: p, nights: Math.max(0, e - s) };
    })
    .filter((r) => r.nights > 0);
  const totalNights = rows.reduce((s, r) => s + r.nights, 0);
  let alloc = 0;
  rows.forEach((r, i) => {
    r.amount = i === rows.length - 1 ? money(excess - alloc) : money((excess * r.nights) / totalNights);
    alloc = money(alloc + r.amount);
  });
  return { excess, totalNights, shares: excess > 0 ? rows : [] };
}

// Rule 3.9: Australian FY. fyEndYear('2026-10-11') === 2027 (FY 2026–27).
export const fyEndYear = (s) => (+s.slice(5, 7) >= 7 ? +s.slice(0, 4) + 1 : +s.slice(0, 4));
export const fyRange = (y) => ({ start: `${y - 1}-07-01`, end: `${y}-06-30`, label: `FY ${y - 1}–${String(y).slice(2)}` });
export const thisFortnightRange = (s) => ({ start: n2d(d2n(s) - 13), end: s, label: 'This fortnight' });
export const lastFortnightRange = (s) => ({ start: n2d(d2n(s) - 27), end: n2d(d2n(s) - 14), label: 'Last fortnight' });
export const thisFortnightRangeForProperty = (property) => {
  const anchor = property?.lease_anchor || todayStr();
  const anchorDay = d2n(anchor);
  return { start: anchor, end: n2d(anchorDay + 13), label: 'This fortnight' };
};
export const lastFortnightRangeForProperty = (property) => {
  const anchor = property?.lease_anchor || todayStr();
  const anchorDay = d2n(anchor);
  return { start: n2d(anchorDay - 13), end: n2d(anchorDay - 1), label: 'Last fortnight' };
};
export const upcomingFortnightRangeForProperty = (property, asOf = todayStr()) => {
  const anchor = property?.lease_anchor || asOf;
  const start = nextCycleOnOrAfter(anchor, d2n(asOf));
  return { start: n2d(start), end: n2d(start + 13), label: 'Upcoming fortnight' };
};
export function defaultRentForPeriod(person, property, start, end) {
  if (!person || !start || !end || start > end) return 0;
  const activeStart = Math.max(d2n(person.start_date || start), d2n(start));
  const activeEndExclusive = Math.min(person.end_date ? d2n(person.end_date) : d2n(end) + 1, d2n(end) + 1);
  if (activeEndExclusive <= activeStart) return 0;

  if (person.stay_type === 'short' || person.stay_type === 'per_night') {
    return money((+person.nightly_rate || 0) * (activeEndExclusive - activeStart));
  }

  if (person.stay_type === 'long') {
    return money((+person.weekly_rate || 0) * ((activeEndExclusive - activeStart) / 7));
  }

  return 0;
}

export function propertyCycleRentCollected(property, people, payments, start, end) {
  if (!property) return 0;
  const rows = payments.filter((payment) => {
    const person = people.find((candidate) => candidate.id === payment.person_id);
    const propertyMatches = payment.property_id === property.id || (person && person.property_id === property.id);
    const isRent = !payment.kind || payment.kind === 'rent';
    return propertyMatches && isRent && payment.date >= start && payment.date <= end;
  });
  return money(rows.reduce((sum, payment) => sum + (+payment.amount || 0), 0));
}
export function propertyBillsForPeriod(property, start, end) {
  if (!property || !(+property.bills_amount > 0)) return 0;
  const amount = +property.bills_amount || 0;
  const cycle = property.bills_frequency === 'yearly' ? 'yearly' : 'monthly';
  const days = Math.max(1, d2n(end) - d2n(start) + 1);
  return money(cycle === 'yearly' ? (days / 365) * amount : (days / 30) * amount);
}

const asArray = (value) => Array.isArray(value) ? value : [];

/** Everything derived from stored rows. */
export function derive(db, asOf) {
  const safeDb = db || {};
  const properties = asArray(safeDb.properties);
  const peopleRows = asArray(safeDb.people);
  const chargesRows = asArray(safeDb.charges);
  const paymentsRows = asArray(safeDb.payments);
  const expensesRows = asArray(safeDb.expenses);

  const props = Object.fromEntries(properties.map((p) => [p.id, p]));
  const people = peopleRows.map((p) => {
    const charges = [...openingCharge(p), ...rentCharges(p, props[p.property_id], asOf), ...chargesRows.filter((c) => c.person_id === p.id)];
    const payments = paymentsRows.filter((x) => x.person_id === p.id);
    const bondTx = payments.filter((x) => ['bond', 'bond_refund', 'bond_deducted'].includes(x.kind) && x.date <= asOf);
    const bondReceived = money(bondTx.filter((x) => x.kind === 'bond').reduce((s, x) => s + +x.amount, 0));
    const bondRefunded = money(bondTx.filter((x) => x.kind === 'bond_refund').reduce((s, x) => s + +x.amount, 0));
    const bondDeducted = money(bondTx.filter((x) => x.kind === 'bond_deducted').reduce((s, x) => s + +x.amount, 0));
    const bondHeld = money(Math.max(0, bondReceived - bondRefunded - bondDeducted));
    return { ...p, charges, payments, bond_paid: bondReceived, bond_refunded: bondRefunded, bond_deducted: bondDeducted, bond_due: money(Math.max(0, (+p.bond || 0) - bondReceived)), bond_held: bondHeld, ...balance(charges, payments, asOf) };
  });
  const expenses = [...expensesRows, ...properties.flatMap((p) => landlordExpenses(p, asOf))];
  return { props, people, expenses };
}
