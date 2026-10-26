import * as L from '../../ledger.js';

const list = (v) => Array.isArray(v) ? v : [];
const total = (rows, key) => L.money(rows.reduce((sum, row) => sum + (+row[key] || 0), 0));
const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(L.d2n(v)) && L.n2d(L.d2n(v)) === v;
const utility = (e) => ['Electricity', 'Gas', 'Water', 'Internet'].includes(e.category);

/** One report model supplies both screen values and transaction exports. */
export function createLedgerReport(input, options = {}) {
  const db = Object.fromEntries(['properties', 'people', 'payments', 'charges', 'expenses'].map((key) => [key, list(input?.[key])]));
  const asOf = options.asOf || L.todayStr();
  if (!validDate(asOf)) throw new Error('Choose a valid report date.');
  if ([...db.payments,...db.charges,...db.expenses].some((row) => row.amount == null || !Number.isFinite(Number(row.amount))))
    throw new Error('Some transaction amounts are invalid. Reconcile those records before generating a report.');
  if (db.people.some((p) => {
    const rate = ['short','per_night'].includes(p.stay_type) ? p.nightly_rate : p.weekly_rate;
    return rate == null || !Number.isFinite(Number(rate)) || Number(rate) < 0;
  })) throw new Error('A resident is missing a valid agreed rent rate. Review their record before generating a report.');
  const mode = options.mode || 'custom';
  let base = { start: options.start, end: options.end };
  if (mode === 'fy') base = L.fyRange(options.fy || L.fyEndYear(asOf));
  if (mode === 'month') {
    const month = options.month || asOf.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid month.');
    const [year, number] = month.split('-').map(Number);
    base = { start: month + '-01', end: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
  }
  const cycle = (property) => mode === 'upcomingFortnight'
    ? L.upcomingFortnightRangeForProperty(property, asOf)
    : L.lastFortnightRangeForProperty(property, asOf);
  const perProperty = new Map(db.properties.map((p) => [p.id, ['upcomingFortnight', 'lastFortnight'].includes(mode) ? cycle(p) : base]));
  if (['upcomingFortnight', 'lastFortnight'].includes(mode)) {
    const ranges = [...perProperty.values()];
    if (!ranges.length) ranges.push(cycle({ lease_anchor: asOf }));
    base = { start: ranges.map((r) => r.start).sort()[0], end: ranges.map((r) => r.end).sort().at(-1) };
  }
  if (!validDate(base.start) || !validDate(base.end) || base.start > base.end || base.end < L.LEDGER_START)
    throw new Error('Choose a valid range on or after 1 July 2026.');
  const start = base.start < L.LEDGER_START ? L.LEDGER_START : base.start, end = base.end;
  const closingDate = end < asOf ? end : asOf;
  const people = new Map(db.people.map((p) => [p.id, p]));
  const properties = new Map(db.properties.map((p) => [p.id, p]));
  const range = (propertyId) => {
    const r = perProperty.get(propertyId) || { start, end };
    return { start: r.start < L.LEDGER_START ? L.LEDGER_START : r.start, end: r.end };
  };
  const inside = (propertyId, date, cutoff = closingDate) => {
    const r = propertyId ? range(propertyId) : { start, end };
    return Boolean(date && date >= r.start && date <= r.end && date <= cutoff);
  };
  const closing = L.derive(db, closingDate);
  const entries = [];
  function entry(kind, row, propertyId, date, values = {}) {
    entries.push({ kind, date, property_id: propertyId || null, resident: people.get(row.person_id)?.name || '',
      category: row.category || row.kind || kind, amount: +row.amount || 0, method: row.method || row.paid_from || '',
      handledBy: row.received_by || '', note: row.note || '', ...values });
  }
  // Paid-through dates are an imported balance baseline, not a reduction of earned rent
  // and never evidence of a cash receipt. The resident balance still honors that baseline.
  for (const person of db.people) {
    const property = properties.get(person.property_id);
    const earned = L.rentCharges({ ...person, paid_up_to: null }, property, closingDate);
    for (const charge of [...earned, ...db.charges.filter((c) => c.person_id === person.id)]) {
      const propertyId = charge.property_id || person.property_id;
      if (!inside(propertyId, charge.due_date)) continue;
      entry(charge.kind === 'opening' ? 'opening_balance' : 'charge', charge, propertyId, charge.due_date,
        charge.kind === 'rent' ? { earnedRent: +charge.amount } : charge.kind === 'opening' ? {} : { otherEarned: +charge.amount });
    }
    for (const charge of L.openingCharge(person))
      if (inside(person.property_id, charge.due_date)) entry('opening_balance', charge, person.property_id, charge.due_date);
  }
  for (const payment of db.payments) {
    const propertyId = L.paymentPropertyId(payment, db.people);
    if (!inside(propertyId, payment.date)) continue;
    const kind = payment.kind || 'rent';
    entry(kind === 'rent' ? 'receipt' : kind, payment, propertyId, payment.date,
      kind === 'rent' ? { rentReceived: +payment.amount } : { [kind]: +payment.amount });
  }
  const costs = L.operatingExpenses(db.properties, db.expenses, closingDate);
  for (const expense of costs) {
    if (!inside(expense.property_id, expense.date)) continue;
    entry(expense.source === 'recorded' ? 'expense' : 'landlord_schedule', expense, expense.property_id, expense.date,
      { operatingCost: +expense.amount, recordedCost: expense.source === 'recorded' ? +expense.amount : 0 });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || String(a.property_id).localeCompare(String(b.property_id)));
  const forecastCosts = L.operatingExpenses(db.properties, db.expenses, end);
  const rows = [...db.properties].sort((a, b) => a.name.localeCompare(b.name)).map((property) => {
    const r = range(property.id), data = entries.filter((e) => e.property_id === property.id);
    const residents = closing.people.filter((p) => p.property_id === property.id);
    const planned = forecastCosts.filter((e) => e.property_id === property.id && inside(property.id, e.date, end));
    const forecastCharges = [
      ...db.people.filter((p) => p.property_id === property.id).flatMap((p) => L.rentCharges({ ...p, paid_up_to: null }, property, r.end)),
      ...db.charges.filter((c) => (c.property_id || people.get(c.person_id)?.property_id) === property.id),
    ].filter((c) => c.due_date >= r.start && c.due_date <= r.end && c.kind !== 'opening');
    const forecastRent = total(forecastCharges.filter((c) => c.kind === 'rent'), 'amount');
    const forecastOtherEarned = total(forecastCharges.filter((c) => c.kind !== 'rent'), 'amount');
    const landlord = total(planned.filter((e) => e.category === 'Landlord rent'), 'amount');
    const utilityBudget = L.propertyBillsForPeriod(property, r.start, r.end);
    const knownUtilities = total(planned.filter(utility), 'amount');
    const otherForecastCosts = total(planned.filter((e) => e.category !== 'Landlord rent' && !utility(e)), 'amount');
    const earnedRent = total(data, 'earnedRent'), otherEarned = total(data, 'otherEarned');
    const rentReceived = total(data, 'rentReceived'), recordedCost = total(data, 'recordedCost'), operatingCost = total(data, 'operatingCost');
    return { property, range: r, earnedRent, otherEarned, rentReceived, recordedCost, operatingCost,
      operatingNet: L.money(earnedRent + otherEarned - operatingCost), receiptsLessCosts: L.money(rentReceived - recordedCost),
      arrears: total(residents, 'owed'), credit: total(residents, 'credit'), bondHeld: total(residents, 'bond_held'),
      forecastRent, forecastOtherEarned, landlord, utilityBudget, forecastUtilities: Math.max(utilityBudget, knownUtilities), otherForecastCosts,
      forecastNet: L.money(forecastRent + forecastOtherEarned - landlord - Math.max(utilityBudget, knownUtilities) - otherForecastCosts) };
  });
  const overheadEntries = entries.filter((e) => e.property_id == null && e.operatingCost != null);
  const overhead = total(overheadEntries, 'operatingCost'), recordedOverhead = total(overheadEntries, 'recordedCost');
  const forecastOverhead = total(forecastCosts.filter((e) => e.property_id == null && inside(null, e.date, end)), 'amount');
  const keys = ['earnedRent','otherEarned','rentReceived','recordedCost','operatingCost','operatingNet','receiptsLessCosts','arrears','credit','bondHeld','forecastRent','forecastOtherEarned','landlord','utilityBudget','forecastUtilities','otherForecastCosts','forecastNet'];
  const totals = Object.fromEntries(keys.map((key) => [key, total(rows, key)]));
  totals.recordedCost = L.money(totals.recordedCost + recordedOverhead);
  totals.operatingCost = L.money(totals.operatingCost + overhead);
  totals.operatingNet = L.money(totals.operatingNet - overhead);
  totals.receiptsLessCosts = L.money(totals.receiptsLessCosts - recordedOverhead);
  totals.forecastNet = L.money(totals.forecastNet - forecastOverhead);
  const bondActivity = { received: total(entries, 'bond'), refunded: total(entries, 'bond_refund'), retained: total(entries, 'bond_deducted'), appliedToRent: total(entries, 'bond_applied') };
  const unreimbursed = total(db.expenses.filter((e) => e.paid_from === 'personal' && !e.reimbursed && e.date && e.date <= asOf), 'amount');
  const importedBalances = db.people.filter((p) => p.paid_up_to && p.paid_up_to >= start && p.start_date <= closingDate).length;
  const missingBondReceipts = closing.people.filter((p) => +p.bond > 0 && p.bond_paid === 0).length;
  const legacyPaidBonds = closing.people.filter((p) => p.legacy_bond_declared > 0);
  const unknownPropertyEntries = entries.filter((e) => e.property_id && !properties.has(e.property_id)).length;
  const unmatchedLandlordCosts = db.expenses.filter((e) => e.category === 'Landlord rent' && inside(e.property_id,e.date) &&
    !L.landlordExpenses(properties.get(e.property_id) || {id:e.property_id,lease_rent:0,lease_anchor:asOf},closingDate).some((due) => due.date === e.date)).length;
  const bondIssues = db.people.filter((p) => {
    const tx = db.payments.filter((r) => r.person_id === p.id && r.date && r.date <= closingDate);
    return L.money(tx.reduce((s, r) => s + (r.kind === 'bond' ? +r.amount : ['bond_refund','bond_deducted','bond_applied'].includes(r.kind) ? -r.amount : 0), 0)) < 0;
  }).length;
  return { mode, start, end, closingDate, rows, entries, totals, overhead, recordedOverhead, forecastOverhead, bondActivity, unreimbursed,
    quality: { importedBalances, noRecordedExpenses: !db.expenses.some((e) => e.date && e.date <= closingDate) && db.properties.length > 0, missingBondReceipts, legacyPaidBonds: legacyPaidBonds.length, legacyPaidBondAmount: total(legacyPaidBonds,'legacy_bond_declared'), unknownPropertyEntries, bondIssues, unmatchedLandlordCosts } };
}

export function reportTransactionRows(report) {
  const house = (id) => report.rows.find((r) => r.property.id === id)?.property.name || (id ? 'Unknown property' : 'Whole business');
  return [['Type','Date','Property','Resident','Category','Amount AUD','Rent earned AUD','Other charges AUD','Rent received AUD','Operating costs AUD','Recorded costs AUD','Bond received AUD','Bond refunded AUD','Bond retained AUD','Bond applied to rent AUD','Method','Handled by','Note','Period start','Period end'],
    ...report.entries.map((e) => {
      const r = report.rows.find((row) => row.property.id === e.property_id)?.range || report;
      return [e.kind,e.date,house(e.property_id),e.resident,e.category,e.amount,e.earnedRent || 0,e.otherEarned || 0,e.rentReceived || 0,e.operatingCost || 0,e.recordedCost || 0,e.bond || 0,e.bond_refund || 0,e.bond_deducted || 0,e.bond_applied || 0,e.method,e.handledBy,e.note,r.start,r.end];
    })];
}

export function reportForecastRows(report) {
  return [['Property','Period start','Period end','Scheduled rent AUD','Other charges due AUD','Landlord cost AUD','Utilities provision AUD','Other known costs AUD','Forecast result AUD'],
    ...report.rows.map((r) => [r.property.name,r.range.start,r.range.end,r.forecastRent,r.forecastOtherEarned,r.landlord,r.forecastUtilities,r.otherForecastCosts,r.forecastNet]),
    ['Whole business overhead',report.start,report.end,0,0,0,0,report.forecastOverhead,-report.forecastOverhead],
    ['TOTAL',report.start,report.end,report.totals.forecastRent,report.totals.forecastOtherEarned,report.totals.landlord,report.totals.forecastUtilities,L.money(report.totals.otherForecastCosts + report.forecastOverhead),report.totals.forecastNet]];
}
