const FINANCIAL_TABLES = new Set(['payments', 'charges', 'expenses']);
export function validateFinancialRow(table, row) {
  if (!FINANCIAL_TABLES.has(table)) return null;
  const values = Array.isArray(row) ? row : [row];
  for (const item of values) {
    if (!item || typeof item !== 'object') return 'Invalid transaction data.';
    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(item.amount))) return 'Enter a positive amount with no more than two decimal places.';
    if (item.date && (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date)) || Number.isNaN(Date.parse(String(item.date) + 'T00:00:00Z')) || new Date(String(item.date) + 'T00:00:00Z').toISOString().slice(0, 10) !== String(item.date))) return 'Enter a valid transaction date.';
    if (table === 'payments' && !item.person_id) return 'Select a resident before saving the payment.';
  }
  return null;
}

export function canDeleteFinancialRow(table, confirmation) {
  if (!FINANCIAL_TABLES.has(table)) return true;
  return confirmation === 'DELETE';
}

export function findPossibleDuplicatePayment(rows, row, id) {
  if (!row || !row.person_id || !row.date) return null;
  return rows.find(p => p.id !== id && p.person_id === row.person_id && p.date === row.date &&
    Number(p.amount) === Number(row.amount) && (p.kind || 'rent') === (row.kind || 'rent') &&
    (p.method || '') === (row.method || '') && (p.note || '') === (row.note || '')) || null;
}
