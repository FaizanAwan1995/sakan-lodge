import { isActive } from '../../ledger.js';

export function eligibleRecipients(people, today, propertyId = '') {
  return people.filter((person) =>
    isActive(person, today) &&
    (!propertyId || String(person.property_id) === String(propertyId)) &&
    typeof person.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim())
  );
}

export function uniqueRecipientEmails(people) {
  return [...new Set(people.map((person) => person.email.trim().toLowerCase()))];
}

export function hasUnfilledPlaceholders(message) {
  return /\[(?:ENTER|VERIFY|ADD|CONFIRM|FORM TEMPLATE)[^\]]*\]/i.test(message);
}
