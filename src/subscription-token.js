import crypto from 'node:crypto';

const MIN_TOKEN_LENGTH = 32;

export function createSubscriptionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function isUsableSubscriptionToken(value) {
  return typeof value === 'string' && value.length >= MIN_TOKEN_LENGTH;
}

export function subscriptionTokenMatches(expected, provided) {
  if (!isUsableSubscriptionToken(expected) || typeof provided !== 'string') return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  if (expectedBytes.length !== providedBytes.length) return false;
  return crypto.timingSafeEqual(expectedBytes, providedBytes);
}
