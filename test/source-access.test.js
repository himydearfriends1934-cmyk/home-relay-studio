import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSourceFetchUrl } from '../src/source-access.js';

test('prefers the local URL for same-VPS sources', () => {
  assert.equal(
    resolveSourceFetchUrl({
      kind: 'url',
      sameVps: true,
      url: 'https://public.example.com/sub',
      localUrl: 'http://127.0.0.1:8080/sub',
    }),
    'http://127.0.0.1:8080/sub',
  );
});

test('derives a local URL from the public URL when same-VPS is on', () => {
  assert.equal(
    resolveSourceFetchUrl({
      kind: 'url',
      sameVps: true,
      url: 'https://public.example.com:8443/sub?x=1',
      localUrl: '',
    }),
    'https://127.0.0.1:8443/sub?x=1',
  );
});

test('ignores the local URL when same-VPS is off', () => {
  assert.equal(
    resolveSourceFetchUrl({
      kind: 'url',
      sameVps: false,
      url: 'https://public.example.com/sub',
      localUrl: 'http://127.0.0.1:8080/sub',
    }),
    'https://public.example.com/sub',
  );
});

test('adds http:// when the URL is written without a scheme', () => {
  assert.equal(
    resolveSourceFetchUrl({
      kind: 'url',
      sameVps: true,
      url: 'public.example.com/sub',
      localUrl: '127.0.0.1:8080/sub',
    }),
    'http://127.0.0.1:8080/sub',
  );
});
