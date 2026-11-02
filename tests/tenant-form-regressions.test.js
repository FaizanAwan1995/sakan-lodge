import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing form boundary: ${start}`);
  return app.slice(a, b);
};

test('departure form uses only its own busy state and submits an audit reason', () => {
  const form = between('function CheckoutForm(', 'const PF =');
  assert.match(form, /const \[busy, setBusy\] = useState\(false\)/);
  assert.doesNotMatch(form, /photoBusy/);
  assert.match(form, /updateTenantDetails\(person,\s*\{\s*end_date:\s*date\s*\},\s*`Scheduled departure for \$\{date\}`\)/);
});

test('resident details form never uses room-photo busy state', () => {
  const form = between('function PersonForm(', '/* ---------------- Rent');
  assert.match(form, /const \[busy, setBusy\] = useState\(false\)/);
  assert.doesNotMatch(form, /photoBusy/);
  assert.match(form, /disabled=\{busy\} onClick=\{done\}/);
});

test('room photo form retains its own photoBusy state', () => {
  const form = between('function RoomForm(', 'function CheckoutForm(');
  assert.match(form, /const \[photoBusy,\s*setPhotoBusy\] = useState\(false\)/);
});
