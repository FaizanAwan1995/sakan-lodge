export function tabFromPath(pathname = '/') {
  const path = (pathname || '/').toLowerCase();
  if (path === '/' || path === '/home' || path.startsWith('/home/') || path === '/today' || path.startsWith('/today/')) return 'today';
  if (path === '/rooms' || path.startsWith('/rooms/')) return 'rooms';
  if (path === '/rent' || path.startsWith('/rent/')) return 'rent';
  if (path === '/expenses' || path.startsWith('/expenses/')) return 'expenses';
  if (path === '/reports' || path.startsWith('/reports/')) return 'reports';
  if (path === '/activity' || path.startsWith('/activity/')) return 'activity';
  return 'today';
}

export function reorderList(items, fromIndex, toIndex) {
  if (!Array.isArray(items) || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (typeof moved === 'undefined') return items;
  next.splice(toIndex, 0, moved);
  return next;
}

export function bondStatusLabel(value) {
  const normalized = String(value || '').toLowerCase();
  switch (normalized) {
    case 'paid':
    case 'held':
      return 'Paid';
    case 'refunded':
      return 'Refunded';
    case 'deducted':
      return 'Deducted';
    case 'not_paid':
    case 'not paid':
    default:
      return 'Not paid';
  }
}
