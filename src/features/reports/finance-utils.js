import { money, derive, todayStr } from '../../ledger.js';
import { createLedgerReport } from './report-model.js';

export function tenantStatement(db, personId, asOf) {
  const state = derive(db, asOf);
  const person = state.people.find(p => String(p.id) === String(personId));
  if (!person) return null;
  const property = state.props[person.property_id];
  const charges = person.charges.filter(c => c.due_date && c.due_date <= asOf);
  const payments = person.payments.filter(p => p.date && p.date <= asOf);
  const rows = [
    ...charges.map(c => ({ date: c.due_date, description: c.kind === 'adjustment' && +c.amount < 0 ? 'Admin balance credit: '+(c.note || '') : c.kind || 'Charge', debit: Math.max(0,+c.amount || 0), credit: Math.max(0,-c.amount || 0) })),
    ...payments.filter(p => !p.kind || ['rent','bond_applied'].includes(p.kind)).map(p => ({ date: p.date, description: p.kind==='bond_applied'?'Bond applied to rent (no new cash)':'Rent received', debit: 0, credit: +p.amount || 0 })),
  ].filter(r => r.date && r.date <= asOf).sort((a,b) => a.date.localeCompare(b.date) || b.debit - a.debit);
  let balance = 0;
  const transactions = rows.map(r => ({ ...r, balance: balance = money(balance + r.debit - r.credit) }));
  let held = 0;
  const bondTransactions = payments.filter(p => ['bond','bond_refund','bond_deducted','bond_applied'].includes(p.kind))
    .sort((a,b) => a.date.localeCompare(b.date) || Number(b.kind === 'bond') - Number(a.kind === 'bond'))
    .map(p => ({ date: p.date, kind: p.kind, amount: +p.amount, balance: held = money(held + (p.kind === 'bond' ? +p.amount : -(+p.amount))) }));
  return { person, property, transactions, balance: money(balance), bondHeld: person.bond_held, bondTransactions, bondIssue: held < 0 };
}

export function propertyProfitability(db, start, end, asOf = todayStr()) {
  return createLedgerReport(db, { start, end, asOf }).rows.map(row => ({
    property: row.property, rent: row.rentReceived, expenses: row.recordedCost, net: row.receiptsLessCosts,
    earned: row.earnedRent, operatingExpenses: row.operatingCost, operatingNet: row.operatingNet,
  }));
}

export function csvRows(rows) {
  const escape = v => {
    let text = String(v ?? '');
    if (typeof v === 'string' && /^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
