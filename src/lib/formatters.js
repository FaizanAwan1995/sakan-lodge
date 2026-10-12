export const fmt = (n) => '$' + (+n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const sum = (xs, f = (x) => x) => Math.round((xs.reduce((s, x) => s + (+f(x) || 0), 0) + Number.EPSILON) * 100) / 100;
export const nice = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
export const dayAfter = (s) => { if (!s) return undefined; const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
