import { useState } from 'react';
import * as L from '../../ledger.js';
import { fmt, nice } from '../../lib/formatters.js';
import { csvRows } from './finance-utils.js';
import { createLedgerReport, reportTransactionRows, reportForecastRows } from './report-model.js';
import TenantStatements from './TenantStatements.jsx';

function download(rows, filename) {
  const url = URL.createObjectURL(new Blob([csvRows(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FinancialReports({ db, today }) {
  const [mode, setMode] = useState('upcomingFortnight');
  const [fy, setFy] = useState(L.fyEndYear(today));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [start, setStart] = useState(L.thisFortnightRange(today).start);
  const [end, setEnd] = useState(today);
  const years = Array.from({ length: Math.max(1, L.fyEndYear(today) - 2026) }, (_, i) => L.fyEndYear(today) - i);
  const months = [];
  for (let cursor = today.slice(0, 7); cursor >= '2026-07';) {
    months.push(cursor);
    const [year, number] = cursor.split('-').map(Number);
    cursor = new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
  }
  let report, error;
  try { report = createLedgerReport(db, { asOf: today, mode, fy, month, start, end }); }
  catch (problem) { error = problem.message; }
  return <>
    <h1>Property reports</h1>
    <div className="report-controls">
      <div className="seg">{[['fy','Financial year'],['month','Monthly'],['lastFortnight','Previous rent cycle'],['upcomingFortnight','Upcoming fortnight'],['custom','Date range']].map(([value,label]) =>
        <button type="button" key={value} className={mode === value ? 'on' : ''} onClick={() => setMode(value)}>{label}</button>)}</div>
      {mode === 'fy' && <label>Financial year<select value={fy} onChange={(e) => setFy(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{L.fyRange(y).label}</option>)}</select></label>}
      {mode === 'month' && <label>Month<select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{new Date(m + '-01T00:00:00').toLocaleDateString('en-AU',{month:'long',year:'numeric'})}</option>)}</select></label>}
      {mode === 'custom' && <div className="custom-range"><label>From<input type="date" min={L.LEDGER_START} value={start} onChange={(e) => setStart(e.target.value)} /></label><label>To<input type="date" min={L.LEDGER_START} value={end} onChange={(e) => setEnd(e.target.value)} /></label></div>}
    </div>
    {error && <p role="alert" className="err">{error}</p>}
    {report && <>
      <p>{nice(report.start)} – {nice(report.end)} · Recorded activity through {nice(report.closingDate)}.</p>
      {(report.quality.importedBalances > 0 || report.quality.noRecordedExpenses || report.quality.legacyPaidBonds > 0) && <p role="status" className="card">Historical receipts, costs or bonds need reconciliation. These figures use the current records and agreed rent schedule; review the reconciliation notes before relying on full-period totals.</p>}
      {['upcomingFortnight','lastFortnight'].includes(mode) && <p className="muted">Each property follows its own rent cycle; its dates are shown below. Previous cycle means the 14 days before its next due date.</p>}
      <div className="hero">
        <small>{mode === 'upcomingFortnight' ? 'Forecast operating result' : 'Operating result · rent due basis'}</small>
        <b>{fmt(mode === 'upcomingFortnight' ? report.totals.forecastNet : report.totals.operatingNet)}</b>
        <small>Rent received {fmt(report.totals.rentReceived)} · rent earned {fmt(report.totals.earnedRent)} · operating costs {fmt(report.totals.operatingCost)}</small>
      </div>
      <section className="card">
        <h2>Earned rent and recorded receipts</h2>
        <p className="muted">Earned rent follows agreed charges falling due. Receipts include only recorded rent payments. Operating costs include landlord rent falling due; budget estimates and bonds are excluded.</p>
        <div style={{overflowX:'auto'}}><table><thead><tr><th>Property</th><th>Period</th><th>Rent earned</th><th>Other charges</th><th>Rent received</th><th>Operating costs</th><th>Operating result</th></tr></thead><tbody>
          {report.rows.map((r) => <tr key={r.property.id}><td>{r.property.name}</td><td>{nice(r.range.start)} – {nice(r.range.end)}</td><td>{fmt(r.earnedRent)}</td><td>{fmt(r.otherEarned)}</td><td>{fmt(r.rentReceived)}</td><td>{fmt(r.operatingCost)}</td><td className={r.operatingNet < 0 ? 'err' : 'ok'}>{fmt(r.operatingNet)}</td></tr>)}
          {report.overhead !== 0 && <tr><td>Whole business overhead</td><td colSpan={4}>Included once in the business total</td><td>{fmt(report.overhead)}</td><td>{fmt(-report.overhead)}</td></tr>}
          <tr><th>Total</th><td></td><th>{fmt(report.totals.earnedRent)}</th><th>{fmt(report.totals.otherEarned)}</th><th>{fmt(report.totals.rentReceived)}</th><th>{fmt(report.totals.operatingCost)}</th><th>{fmt(report.totals.operatingNet)}</th></tr>
        </tbody></table></div>
        <p>Recorded costs {fmt(report.totals.recordedCost)} · receipts less recorded costs {fmt(report.totals.receiptsLessCosts)}.</p>
        <p className="muted">Recorded costs may have been paid personally. This figure does not represent a bank balance.</p>
      </section>
      <section className="card">
        <h2>Balances at {nice(report.closingDate)}</h2>
        <p>Resident arrears {fmt(report.totals.arrears)} · resident credits {fmt(report.totals.credit)} · bond balance from recorded transactions {fmt(report.totals.bondHeld)}.</p>
        <p>Bond activity in the selected periods: received {fmt(report.bondActivity.received)}, refunded {fmt(report.bondActivity.refunded)}, retained {fmt(report.bondActivity.retained)}, deducted from bond for rent / charges {fmt(report.bondActivity.appliedToRent)}. These deductions reduce arrears and bond held; they are not new cash receipts. Only paid refunds are included in the refunded total.</p>
        <p>Currently unreimbursed personal spending, through {nice(today)}: {fmt(report.unreimbursed)}.</p>
      </section>
      <section className="card">
        <h2>Forecast for the selected periods</h2>
        <p className="muted">Forecasts use the same rent due dates and agreed rates as the operating report, including known stay dates and part-period agreements. Utilities provision is the larger of the period budget and known bills. Forecasts are separate from payments received.</p>
        <div style={{overflowX:'auto'}}><table><thead><tr><th>Property</th><th>Scheduled rent</th><th>Other charges</th><th>Landlord</th><th>Utilities provision</th><th>Other known costs</th><th>Forecast result</th></tr></thead><tbody>
          {report.rows.map((r) => <tr key={r.property.id}><td>{r.property.name}</td><td>{fmt(r.forecastRent)}</td><td>{fmt(r.forecastOtherEarned)}</td><td>{fmt(r.landlord)}</td><td>{fmt(r.forecastUtilities)}</td><td>{fmt(r.otherForecastCosts)}</td><td>{fmt(r.forecastNet)}</td></tr>)}
          {report.forecastOverhead !== 0 && <tr><td>Whole business overhead</td><td colSpan={4}></td><td>{fmt(report.forecastOverhead)}</td><td>{fmt(-report.forecastOverhead)}</td></tr>}
          <tr><th>Total</th><th>{fmt(report.totals.forecastRent)}</th><th>{fmt(report.totals.forecastOtherEarned)}</th><th>{fmt(report.totals.landlord)}</th><th>{fmt(report.totals.forecastUtilities)}</th><th>{fmt(L.money(report.totals.otherForecastCosts + report.forecastOverhead))}</th><th>{fmt(report.totals.forecastNet)}</th></tr>
        </tbody></table></div>
      </section>
      <section className="card" aria-label="Report reconciliation notes">
        <h2>Reconciliation</h2>
        {report.quality.importedBalances > 0 && <p>{report.quality.importedBalances} resident(s) have imported paid-through balances in this period. Earlier cash receipts cannot be reconstructed from those balances; reconcile historical payments before treating received totals as complete.</p>}
        {report.quality.noRecordedExpenses && <p>No expense receipts are recorded through this date. Scheduled landlord costs are still shown as obligations; other historical costs need reconciliation.</p>}
        {report.quality.missingBondReceipts > 0 && <p>{report.quality.missingBondReceipts} resident(s) have an expected bond amount without a recorded bond receipt. Expected amounts are not counted as money held.</p>}
        {report.quality.legacyPaidBonds > 0 && <p>{report.quality.legacyPaidBonds} legacy resident record(s) mark bonds as paid, totalling {fmt(report.quality.legacyPaidBondAmount)}, without matching receipt history. Preserve those declarations and reconcile the opening bond liability; do not treat the transaction balance above as a complete bond total.</p>}
        {report.quality.unmatchedLandlordCosts > 0 && <p role="alert">{report.quality.unmatchedLandlordCosts} landlord cost entry/entries do not match a scheduled due date. Review their allocation before relying on the operating result; unmatched costs have been retained.</p>}
        {(report.quality.unknownPropertyEntries > 0 || report.quality.bondIssues > 0) && <p role="alert" className="err">Some transactions need review before relying on these totals: {report.quality.unknownPropertyEntries} unknown property reference(s), {report.quality.bondIssues} bond balance discrepancy/discrepancies.</p>}
        <p className="muted">Opening balances and resident credits are reported separately from new income. Arrears are calculated resident by resident; one resident’s credit does not clear another’s debt.</p>
      </section>
      <div className="screen-actions">
        <button className="primary" onClick={() => download(reportTransactionRows(report),`sakan-activity-${report.start}-${report.end}.csv`)}>Export recorded activity and rent due (CSV)</button>
        <button onClick={() => download(reportForecastRows(report),`sakan-forecast-${report.start}-${report.end}.csv`)}>Export forecast separately (CSV)</button>
      </div>
    </>}
    <TenantStatements db={db} today={today} />
  </>;
}
