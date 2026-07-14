import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSubscriptionToken,
  isUsableSubscriptionToken,
  subscriptionTokenMatches,
} from '../src/subscription-token.js';

test('subscription tokens are high-entropy URL-safe values', () => {
  const first = createSubscriptionToken();
  const second = createSubscriptionToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(isUsableSubscriptionToken(first), true);
});

test('subscription token comparison rejects missing, short, and different values', () => {
  const token = createSubscriptionToken();

  assert.equal(subscriptionTokenMatches(token, token), true);
  assert.equal(subscriptionTokenMatches(token, `${token.slice(0, -1)}x`), false);
  assert.equal(subscriptionTokenMatches(token, token.slice(1)), false);
  assert.equal(subscriptionTokenMatches('short', 'short'), false);
  assert.equal(subscriptionTokenMatches(token, ''), false);
});
