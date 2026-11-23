import { isActive } from './ledger.js';

// This is the stored primary key, not a reference derived from a name or room.
export const tenantReference = person => String(person?.id || '');
export function tenantStatus(person, today) {
  if (!isActive(person, today)) return 'Checked out';
  return person.start_date > today ? 'Upcoming' : 'Active';
}
export function tenantMatches(person, query, status, today) {
  const current = tenantStatus(person, today);
  if (status !== 'all' && current !== status) return false;
  return [person.name, person.id, person.phone, person.email].some(value => String(value || '').toLowerCase().includes(query.trim().toLowerCase()));
}
export function reservationTenants(reservation, people) {
  const ids = new Set([reservation.checked_in_person_id, ...(Array.isArray(reservation.assigned_people) ? reservation.assigned_people : [])].filter(Boolean).map(String));
  return people.filter(person => ids.has(String(person.id)));
}
export function occupancyEnd(person) {
  const actual = person.checked_out_at ? new Intl.DateTimeFormat('en-CA', {timeZone:'Australia/Adelaide'}).format(new Date(person.checked_out_at)) : '9999-12-31';
  return [person.end_date || '9999-12-31', actual].sort()[0];
}
export function roomAtCapacity(people, room, person) {
  if (!room || !person.start_date || person.checked_out_at) return false;
  const end = person.end_date || '9999-12-31';
  const others = people.filter(p => p.id !== person.id && p.room_id === room.id && p.start_date < end && occupancyEnd(p) > person.start_date && occupancyEnd(p) > p.start_date);
  const checkpoints = [person.start_date, ...others.map(p => p.start_date).filter(day => day >= person.start_date && day < end)];
  return checkpoints.some(day => others.filter(p => p.start_date <= day && occupancyEnd(p) > day).length >= room.capacity);
}

/** Group the ledger display while retaining the individual records for occupancy. */
export function householdRows(people) {
  const primaryIds = new Set(people.map(person => person.id));
  const members = new Map();
  for (const person of people) {
    if (!primaryIds.has(person.billing_account_id)) continue;
    const group = members.get(person.billing_account_id) || [];
    group.push(person);
    members.set(person.billing_account_id, group);
  }
  return people.filter(person => !primaryIds.has(person.billing_account_id)).map(person =>
    members.has(person.id) ? { ...person, householdMembers: members.get(person.id) } : person
  );
}
