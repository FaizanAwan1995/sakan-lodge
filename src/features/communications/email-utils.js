import { isActive } from '../../ledger.js';

export function isValidTenantEmail(email) {
  return typeof email === 'string' && /^[^\s@<>,;:\"\\]+@[^\s@<>,;:\"\\]+\.[^\s@<>,;:\"\\]+$/.test(email.trim());
}

export function eligibleRecipients(people, today, propertyId = '') {
  return people.filter((person) =>
    person.start_date <= today && isActive(person, today) &&
    (!propertyId || String(person.property_id) === String(propertyId)) &&
    isValidTenantEmail(person.email)
  );
}

export function uniqueRecipientEmails(people) {
  return [...new Set(people.map((person) => person.email.trim().toLowerCase()))];
}

export function hasUnfilledPlaceholders(message) {
  return /\[(?:ENTER|VERIFY|ADD|CONFIRM|FORM TEMPLATE|DATE|TIME|AMOUNT|PERIOD|ADDRESS|NAME|RATE|[A-Z]+(?:_[A-Z]+)+)[^\]]*\]|\{\{[^}]+\}\}/i.test(message);
}
