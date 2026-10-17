/**
 * Public accommodation pricing and date rules.
 * Pure functions shared by future public APIs and reservation validation.
 * Monetary values are AUD per week; existing resident agreements are unaffected.
 */
export const RATES = Object.freeze({
  sharedLong: 185,
  privateLong: 255,
  privateShort: 300,
});
export const UTILITIES_INCLUDED = Object.freeze(['electricity','water','gas','internet']);
export const INITIAL_PUBLIC_SUBURBS = Object.freeze(['Fulham','Clapham','Oaklands Park']);

export function addCalendarMonths(dateString, months = 2) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) throw new Error('A valid ISO arrival date is required.');
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0,10) !== dateString) throw new Error('Invalid calendar date.');
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth()+1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0,10);
}

export function classifyStay(arrivalDate, departureDate) {
  if (!departureDate || !/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) throw new Error('A departure date is required to classify a stay.');
  if (departureDate <= arrivalDate) throw new Error('Departure must be after arrival.');
  return departureDate < addCalendarMonths(arrivalDate,2) ? 'short' : 'long';
}

export function weeklyAdvertisedRate(offerType, stayType) {
  if (!['private','shared'].includes(offerType)) throw new Error('Unsupported accommodation type.');
  if (!['short','long'].includes(stayType)) throw new Error('Unsupported stay type.');
  if (offerType === 'shared' && stayType === 'short') throw new Error('Short-term shared accommodation is not currently offered.');
  return offerType === 'shared' ? RATES.sharedLong : stayType === 'short' ? RATES.privateShort : RATES.privateLong;
}

/** Date intervals are [start, end), so checkout and next check-in may share a date. */
export function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) throw new Error('Start dates are required.');
  return aStart < (bEnd || '9999-12-31') && bStart < (aEnd || '9999-12-31');
}

export function availableSpaces({capacity, residents = [], holds = [], blocks = [], arrival, departure, offerType}) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid room capacity.');
  if (!arrival || (departure && departure <= arrival)) throw new Error('Invalid requested dates.');
  const overlapping = items => items.filter(x=>dateRangesOverlap(x.start, x.end, arrival, departure));
  const activeResidents = overlapping(residents);
  const activeHolds = overlapping(holds);
  const activeBlocks = overlapping(blocks);
  const allocated = [...activeResidents,...activeHolds,...activeBlocks].reduce((n,x)=>n+(x.spaces ?? 1),0);
  const remaining = Math.max(0,capacity-allocated);
  if (offerType !== offerTypeForCapacity(capacity)) throw new Error('Offer type does not match room capacity.');
  if (offerType === 'private') return allocated === 0 ? 1 : 0;
  if (offerType === 'shared') return remaining;
  throw new Error('Unsupported accommodation type.');
}

/** Public offer type is determined by the ledger room capacity, never by a manual override. */
export function offerTypeForCapacity(capacity) {
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid room capacity.');
  return capacity === 1 ? 'private' : 'shared';
}

/** Enforce capacity-based offering before quoting or accepting a reservation. */
export function rateForCapacity(capacity, arrivalDate, departureDate) {
  const offerType = offerTypeForCapacity(capacity);
  const stayType = classifyStay(arrivalDate, departureDate);
  return { offerType, stayType, weeklyRate: weeklyAdvertisedRate(offerType, stayType) };
}
