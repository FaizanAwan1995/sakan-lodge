const SENSITIVE_KEYS = /password|token|authorization|api[_-]?key|secret|email|phone|address|person|tenant|resident/i;

export function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  if (status === 401 || code === 'PGRST301' || /jwt expired|invalid jwt/i.test(message)) return { kind:'auth', message:'Your session has expired. Sign in again and retry.' };
  if (status === 403 || code === '42501') return { kind:'permission', message:'You do not have permission to perform this action.' };
  if (status === 429) return { kind:'rate-limit', message:'Too many requests. Please wait a moment and try again.' };
  if (status >= 500 || /failed to fetch|networkerror|network request failed|timed out|timeouterror|aborterror/i.test(message)) return { kind:'network', message:'The service is temporarily unavailable. Check your connection and retry.' };
  if (code === '23P01') return { kind:'availability', message:'This room is occupied, held or blocked during these dates. Refresh availability and choose another room or date.' };
  if (code === '40001') return { kind:'conflict', message:'Another session changed this record. Refresh and review the latest details before saving.' };
  if (code === '23505') return { kind:'conflict', message:'This record already exists. Refresh and check before trying again.' };
  if (code === '23503') return { kind:'related-records', message:'This record is linked to other data and cannot be removed safely.' };
  if (code === '23514' || code === '23502') return { kind:'validation', message:'Some required information is missing or invalid. Check the form and retry.' };
  return { kind:'unknown', message:'Something went wrong. Your changes may not have been saved. Refresh and retry.' };
}

export function safeErrorDetails(error) {
  const result = { name: String(error?.name || 'Error').slice(0,80), status: Number(error?.status || 0), code: String(error?.code || '').slice(0,40) };
  return result;
}

export function reportError(context, error) {
  // Do not log personal or financial record contents in browser console.
  const safeContext = String(context).replace(/[^a-zA-Z0-9 _.-]/g,'').slice(0,100);
  console.error('[Sakan Lodge]', safeContext, safeErrorDetails(error));
}

export function errorMessage(error) { return classifyError(error).message; }
