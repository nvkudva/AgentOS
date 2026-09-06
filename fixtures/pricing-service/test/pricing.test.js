import { test } from 'node:test';
import assert from 'node:assert';
import { discountedCents, orderTotal } from '../src/pricing.js';

test('discount rounds to the nearest cent', () => {
  assert.strictEqual(discountedCents(1999, 0.9), 1799);   // 1799.1 -> 1799
  assert.strictEqual(discountedCents(1000, 0.855), 855);
  assert.strictEqual(discountedCents(333, 0.5), 167);     // 166.5 -> 167, flooring gives 166
});
test('order totals add up', () => {
  assert.strictEqual(orderTotal([{ cents: 333, qty: 1 }, { cents: 333, qty: 1 }], 0.5), 334);
});
