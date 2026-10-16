const ALLOWED_EVENTS = new Set(['app_boot','navigation','web_vital','unhandled_error','unhandled_rejection']);
const endpoint = import.meta.env.VITE_MONITORING_ENDPOINT || '';

export function recordTelemetry(event, fields = {}) {
  if (!ALLOWED_EVENTS.has(event)) return false;
  // Only numeric measurements and fixed, non-identifying labels leave the browser.
  const safe = {};
  for (const [key, value] of Object.entries(fields)) {
    if (['duration','value','status'].includes(key) && typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
    if (key === 'metric' && ['LCP','CLS','INP','FCP'].includes(value)) safe.metric = value;
  }
  if (!endpoint || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    return navigator.sendBeacon(url.toString(), new Blob([JSON.stringify({ event, ...safe, at: new Date().toISOString() })],{type:'application/json'}));
  } catch { return false; }
}

export function startMonitoring() {
  if (typeof window === 'undefined') return () => {};
  recordTelemetry('app_boot');
  const onError = () => recordTelemetry('unhandled_error');
  const onRejection = () => recordTelemetry('unhandled_rejection');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  let observer;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'largest-contentful-paint') recordTelemetry('web_vital',{metric:'LCP',value:entry.startTime});
          if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) recordTelemetry('web_vital',{metric:'CLS',value:entry.value});
        }
      });
      observer.observe({type:'largest-contentful-paint',buffered:true});
      observer.observe({type:'layout-shift',buffered:true});
    } catch { observer?.disconnect(); observer=undefined; }
  }
  return () => {window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);observer?.disconnect();};
}
