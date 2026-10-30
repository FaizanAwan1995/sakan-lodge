export const LEDGER_TABLES = ['properties', 'rooms', 'people', 'charges', 'payments', 'expenses', 'maintenance'];

/** One database snapshot avoids partial pages and mixed concurrent table loads. */
export async function loadLedgerSnapshot(client) {
  const request = client.rpc('ledger_snapshot');
  const { data, error } = await (typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(15000)) : request);
  if (error) {
    if (['PGRST202','42883'].includes(error.code))
      throw new Error('The ledger database update is pending. Complete the tested migration before deploying this release. Existing records are preserved.');
    throw error;
  }
  if (!data || [...LEDGER_TABLES, 'audit'].some((table) => !Array.isArray(data[table])))
    throw new Error('Unable to read a complete ledger snapshot. Refresh and try again.');
  return Object.fromEntries([...LEDGER_TABLES, 'audit'].map((table) => [table, data[table]]));
}
