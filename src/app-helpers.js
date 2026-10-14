export function accountChoices() {
  return ['Danish', 'Faizan', 'Joint account'];
}

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

export function visibleTodaySections(sectionOrder = [], { behind = [], followups = [], leaseReviews = [] } = {}) {
  const visible = new Set(['balanceHero', 'propertyPulse', 'shortcuts', 'schedule', 'bonds']);
  if (behind.length) visible.add('attention');
  if (followups.length) visible.add('repairFollowUps');
  if (leaseReviews.length) visible.add('leaseReviews');

  return sectionOrder.filter((sectionId) => visible.has(sectionId));
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

export function sortPeopleByRentUrgency(people = []) {
  return [...people].sort((a, b) => {
    const owedDiff = Number(b?.owed ?? 0) - Number(a?.owed ?? 0);
    if (owedDiff !== 0) return owedDiff;

    const lateDiff = Number(b?.daysLate ?? 0) - Number(a?.daysLate ?? 0);
    if (lateDiff !== 0) return lateDiff;

    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  });
}

export function sortRoomsByRentUrgency(rooms = [], people = []) {
  const byRoomId = new Map();
  for (const person of people) {
    const roomId = person?.room_id;
    if (!roomId) continue;

    const current = byRoomId.get(roomId) ?? 0;
    byRoomId.set(roomId, current + Number(person?.owed ?? 0));
  }

  return [...rooms].sort((a, b) => {
    const aPriority = byRoomId.get(a?.id) ?? 0;
    const bPriority = byRoomId.get(b?.id) ?? 0;
    if (aPriority !== bPriority) return bPriority - aPriority;

    const aSort = Number(a?.sort ?? Number.MAX_SAFE_INTEGER);
    const bSort = Number(b?.sort ?? Number.MAX_SAFE_INTEGER);
    if (aSort !== bSort) return aSort - bSort;

    return String(a?.label ?? '').localeCompare(String(b?.label ?? ''));
  });
}
