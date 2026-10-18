import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleRecipients, uniqueRecipientEmails, hasUnfilledPlaceholders } from './email-utils.js';

const today = '2026-10-16';
const tenant = (id, email, property_id = 'a') => ({ id, name: 'Tenant', email, property_id, start_date: '2026-01-01', end_date: null });

test('selects active tenants with valid email, scoped to property', () => {
  const people = [tenant(1, 'Tenant@Example.com'), tenant(2, 'not-an-email'), tenant(3, 'other@example.com', 'b')];
  assert.deepEqual(eligibleRecipients(people, today, 'a').map(p => p.id), [1]);
});

test('deduplicates emails case-insensitively without exposing duplicates', () => {
  assert.deepEqual(uniqueRecipientEmails([tenant(1, ' A@Example.com '), tenant(2, 'a@example.com')]), ['a@example.com']);
});

test('blocks unfinished manual email templates', () => {
  assert.equal(hasUnfilledPlaceholders('Date: [ENTER DATE AND TIME]'), true);
  assert.equal(hasUnfilledPlaceholders('Amount: [VERIFY AMOUNT]'), true);
  assert.equal(hasUnfilledPlaceholders('Inspection on 20 October at 10 AM'), false);
});


test('future arrivals and checked-out people are excluded from current tenant emails', () => {
  const current = tenant(1, 'current@example.test');
  const future = { ...tenant(2, 'future@example.test'), start_date: '2026-10-17' };
  const departed = { ...tenant(3, 'past@example.test'), end_date: today };
  assert.deepEqual(eligibleRecipients([current, future, departed], today).map(p => p.id), [1]);
});
