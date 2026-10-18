import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/booking.js', import.meta.url), 'utf8');

function setup({withSubmit = true, spaces = 1, enabled = true, fails = false, token = 'synthetic-challenge'} = {}) {
  const formEvents = {}, checkEvents = {}, calls = [];
  const values = {
    arrival_date: '2030-01-01', departure_date: '2030-03-01',
    spaces_requested: '1', full_name: 'Test Applicant',
    email: 'test@example.test', phone: '0400000000',
    'cf-turnstile-response': token
  };
  const field = (key) => ({
    get value() { return values[key]; },
    set value(value) { values[key] = value; },
    reportValidity: () => true,
  });
  const submit = withSubmit ? {disabled: true} : null;
  const form = {
    dataset: {room: 'synthetic-room'},
    elements: {
      arrival_date: field('arrival_date'),
      departure_date: field('departure_date'),
      spaces_requested: field('spaces_requested'),
    },
    addEventListener: (name, fn) => { formEvents[name] = fn; },
    reportValidity: () => true,
    querySelectorAll: () => submit ? [submit] : [],
  };
  const result = {textContent: ''}, message = {textContent: ''};
  const check = {addEventListener: (name, fn) => {checkEvents[name] = fn;}};
  const elements = {
    '#reservation-form': form,
    '#availability-result': result,
    '#request-result': message,
    '#check-availability': check,
    '#submit-request': submit,
  };
  class MockFormData {
    constructor() {}
    [Symbol.iterator]() { return Object.entries(values)[Symbol.iterator](); }
  }
  vm.runInNewContext(source, {
    document: {querySelector: (selector) => elements[selector]},
    Intl, Date, crypto, URLSearchParams,
    FormData: MockFormData,
    window: {turnstile: {reset() {}}},
    fetch: async (url, options) => {
      calls.push({url, options});
      if (url === '/api/reservations') {
        return {ok: true, json: async () => ({code: 'SAKAN-TEST'})};
      }
      return {
        ok: !fails,
        json: async () => fails ? {error: 'Unable to verify availability'} :
          {spaces, weekly_rate: 255, requests_enabled: enabled, offer_type: 'private'},
      };
    },
  });
  return {form, formEvents, checkEvents, calls, result, message, check, submit, values};
}

test('availability-only pages do not collect details or submit', async () => {
  const c = setup({withSubmit: false, enabled: false});
  await c.checkEvents.click();
  assert.equal(c.calls.length, 1);
  assert.match(c.result.textContent, /currently unavailable/);
  let prevented = false;
  c.formEvents.submit({preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(c.calls.length, 1);
});

test('enabled request button is immediately clickable and automatically checks availability', async () => {
  const c = setup();
  assert.equal(c.submit.disabled, false);
  await c.formEvents.submit({preventDefault() {}});
  assert.equal(c.calls.length, 2);
  assert.match(c.calls[0].url, /^\/api\/availability\?/);
  assert.equal(c.calls[1].url, '/api/reservations');
  assert.equal(c.calls[1].options.method, 'POST');
  assert.match(c.message.textContent, /SAKAN-TEST/);
  assert.equal(c.submit.disabled, true);
});

test('closed database gate blocks a request without submitting applicant data', async () => {
  const c = setup({enabled: false});
  await c.formEvents.submit({preventDefault() {}});
  assert.equal(c.calls.length, 1);
  assert.equal(c.submit.disabled, false);
  assert.match(c.result.textContent, /currently unavailable/);
});

test('insufficient spaces or failed availability cannot create a request', async () => {
  for (const options of [{spaces: 0}, {fails: true}]) {
    const c = setup(options);
    await c.formEvents.submit({preventDefault() {}});
    assert.equal(c.calls.length, 1);
    assert.equal(c.submit.disabled, false);
    assert.match(c.message.textContent, /not been sent/);
  }
});

test('turnstile verification is required before sending personal data', async () => {
  const c = setup({token: ''});
  await c.formEvents.submit({preventDefault() {}});
  assert.equal(c.calls.length, 1);
  assert.match(c.message.textContent, /verification challenge/);
  assert.equal(c.submit.disabled, false);
});

test('editing the dates requires a fresh availability check without disabling submit', async () => {
  const c = setup();
  await c.checkEvents.click();
  c.values.arrival_date = '2030-02-01';
  c.formEvents.input();
  assert.equal(c.submit.disabled, false);
  assert.match(c.result.textContent, /checked when you submit/);
  await c.formEvents.submit({preventDefault() {}});
  assert.equal(c.calls.filter(x => x.url.startsWith('/api/availability')).length, 2);
});
