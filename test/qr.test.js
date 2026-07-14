import assert from 'node:assert/strict';
import test from 'node:test';
import { getQrPayload } from '../src/qr.js';

test('keeps Shadowrocket QR payload as the subscription URL', () => {
  const url = 'https://example.com/api/export/shadowrocket';
  assert.equal(getQrPayload('shadowrocket', url), url);
});

test('keeps other QR payloads unchanged', () => {
  const url = 'https://example.com/api/export/clash';
  assert.equal(getQrPayload('clash', url), url);
});
