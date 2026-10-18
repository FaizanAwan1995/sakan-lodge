const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const money = value => {
  const amount = Number(value);
  if (value === null || value === undefined || !Number.isFinite(amount) || amount < 0) throw new Error('Agreement amount is missing or invalid');
  return 'AUD $' + amount.toFixed(2);
};
export function agreementDocument(contract, code) {
  const f = contract.fields;
  if (!f?.terms || !f.full_name || !f.arrival_date || !f.departure_date) throw new Error('Incomplete agreement snapshot');
  const nightly = f.billing_type === 'nightly';
  if (nightly && !(Number(f.nightly_rate) > 0)) throw new Error('Approved nightly rate required');
  const row = (name, value) => `<tr><th>${escape(name)}</th><td>${escape(value)}</td></tr>`;
  const people = f.resident_names || [f.full_name];
  const signatures = people.map(name => `<div class="signature"><strong>${escape(name)}</strong><p>Resident signature: __________________________</p><p>Date: __________________</p></div>`).join('');
  const terms = f.terms.split(/\n\s*\n/).map(part => `<p class="clause">${escape(part)}</p>`).join('');
  const rate = nightly ? money(f.nightly_rate) + '/night per resident' : money(f.weekly_rate) + '/week' + (f.offer_type === 'shared' ? ' per resident' : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Agreement ${escape(code)} v${Number(contract.version)}</title><style>
@page{size:A4;margin:18mm;@bottom-right{content:counter(page);font:9pt Arial;color:#53665b}}*{box-sizing:border-box}body{font:10.5pt/1.4 Arial,sans-serif;color:#182b25;max-width:760px;margin:0 auto;padding:20px}h1{font-size:24pt;line-height:1.15}h2{font-size:15pt;margin-top:22px;break-after:avoid}table{width:100%;border-collapse:collapse}tr{break-inside:avoid}th,td{padding:6px;border-bottom:1px solid #d6ddd8;vertical-align:top;text-align:left}th{width:32%}.clause{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px;widows:3;orphans:3}.meta{color:#53665b;font-size:10pt}.signature{break-inside:avoid;border-top:1px solid #b5c5ba;margin-top:28px;padding-top:12px}.notice{border:1px solid #b5c5ba;padding:12px}@media print{body{padding:0}button{display:none}thead{display:table-header-group}}</style></head><body>
<h1>SAKAN Lodge<br>Rooming house agreement</h1><p class="meta">${escape(code)} · Version ${Number(contract.version)} · ${escape(contract.status)}<br>Template: ${escape(f.template_reference)}</p>
${contract.status === 'draft' ? '<p class="notice">DRAFT — administrator review and approval required before signature.</p>' : ''}
<h2>Parties and premises</h2><table>${row('Proprietor',f.proprietor?.name || 'As stated in the approved terms')}${row('Proprietor address',f.proprietor?.address || 'As stated in the approved terms')}${row('Proprietor contact',f.proprietor?.phone || 'As stated in the approved terms')}${row('Resident(s)',people.join('; '))}${row('Applicant email',f.email || '')}${row('Applicant phone',f.phone || '')}${row('Premises',f.premises_address || 'As stated in the approved terms')}${row('Room',f.room_label || f.room_id)}</table>
<h2>Term, rent and bond</h2><table>${row('Arrival',f.arrival_date)}${row('Departure',f.departure_date)}${row('Agreed term',f.term_description || `${f.arrival_date} to ${f.departure_date}`)}${row('Rent',rate)}${row('Payment',f.payment_method || 'As stated in the approved terms')}${row('First rent due',f.first_rent_due || f.arrival_date)}${row('Bond per resident',f.bond === undefined ? 'As stated in the approved terms' : money(f.bond))}${row('Utilities','Electricity, water, gas and internet included without additional charges')}</table>
<h2>Terms and house rules</h2>${terms}<h2>Fresh signatures</h2><p>Read all terms before signing. A copy of this agreement must be given to each resident.</p>${signatures}<div class="signature"><strong>${escape(f.proprietor?.name || 'Proprietor')}</strong><p>Proprietor signature: __________________________</p><p>Date: __________________</p></div></body></html>`;
}
