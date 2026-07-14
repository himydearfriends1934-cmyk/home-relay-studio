import assert from 'node:assert/strict';
import test from 'node:test';
import { getQrPayload } from '../src/qr.js';

test('wraps a Shadowrocket subscription URL in a sub deep link', () => {
  const url = 'http://100.80.43.40:8788/api/export/shadowrocket';
  const payload = getQrPayload('shadowrocket', url);
  assert.match(payload, /^sub:\/\//);
  const encoded = payload.slice('sub://'.length).split('#')[0];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), url);
});

test('keeps other QR payloads unchanged', () => {
  const url = 'https://example.com/api/export/clash';
  assert.equal(getQrPayload('clash', url), url);
});
