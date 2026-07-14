import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { getQrPayload } from '../src/qr.js';

test('wraps a Shadowrocket subscription URL in an add/sub deep link', () => {
  const url = 'https://example.com/api/export/shadowrocket';
  const payload = getQrPayload('shadowrocket', url);
  assert.match(payload, /^shadowrocket:\/\/add\/sub:\/\//);
  const encoded = payload.slice('shadowrocket://add/sub://'.length).split('?')[0];
  assert.equal(Buffer.from(encoded, 'base64url').toString('utf8'), url);
  assert.match(payload, /[?&]remark=Home%20Relay%20Studio(?:&|$)/);
});

test('keeps other QR payloads unchanged', () => {
  const url = 'https://example.com/api/export/clash';
  assert.equal(getQrPayload('clash', url), url);
});
