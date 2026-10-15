import { money, rentCharges, openingCharge, landlordExpenses } from '../../ledger.js';

export function tenantStatement(db, personId, asOf) {
  const person = db.people.find(p => String(p.id) === String(personId));
  if (!person) return null;
  const property = db.properties.find(p => p.id === person.property_id);
  const charges = [...openingCharge(person), ...rentCharges(person, property, asOf), ...db.charges.filter(c => c.person_id === person.id && c.due_date <= asOf)];
  const payments = db.payments.filter(p => p.person_id === person.id && p.date <= asOf);
  const rows = [
    ...charges.map(c => ({ date: c.due_date, description: c.kind || 'Charge', debit: +c.amount || 0, credit: 0 })),
    ...payments.filter(p => !p.kind || p.kind === 'rent').map(p => ({ date: p.date, description: 'Rent received', debit: 0, credit: +p.amount || 0 })),
  ].filter(r => r.date && r.date <= asOf).sort((a,b) => a.date.localeCompare(b.date) || b.debit - a.debit);
  let balance = 0;
  const transactions = rows.map(r => ({ ...r, balance: balance = money(balance + r.debit - r.credit) }));
  const bonds = payments.filter(p => ['bond','bond_refund','bond_deducted'].includes(p.kind));
  const bondHeld = money(bonds.reduce((sum,p) => sum + (p.kind === 'bond' ? +p.amount : -(+p.amount)),0));
  return { person, property, transactions, balance: money(balance), bondHeld };
}

export function propertyProfitability(db, start, end) {
  return db.properties.map(property => {
    const tenants = new Set(db.people.filter(p => p.property_id === property.id).map(p => p.id));
    const rent = money(db.payments.filter(p => p.date >= start && p.date <= end && (!p.kind || p.kind === 'rent') && (p.property_id === property.id || tenants.has(p.person_id))).reduce((s,p) => s + (+p.amount || 0),0));
    const expenses = money([...db.expenses, ...landlordExpenses(property,end)].filter(e => e.property_id === property.id && e.date >= start && e.date <= end).reduce((s,e) => s + (+e.amount || 0),0));
    return { property, rent, expenses, net: money(rent - expenses) };
  });
}

export function csvRows(rows) {
  const escape = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}
