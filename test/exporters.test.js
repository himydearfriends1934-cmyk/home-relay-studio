import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { getClientExport } from '../src/exporters.js';
import { parseSubscriptionContent } from '../src/parsers.js';
import { normalizeState } from '../src/state.js';

function buildFixture() {
  const state = normalizeState({
    projectName: 'Export test',
    sources: [
      {
        id: 'src-1',
        name: 'Source 1',
        kind: 'text',
        content:
          'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2Fchat#node-a',
        enabled: true,
      },
    ],
    egresses: [
      {
        id: 'eg-1',
        name: 'france',
        protocol: 'http',
        server: 'isp.example.com',
        port: 10001,
        username: 'user',
        password: 'pass',
        enabled: true,
      },
    ],
    rules: [
      {
        id: 'rule-1',
        name: 'Source 1 to france',
        enabled: true,
        priority: 100,
        targetMode: 'replace',
        stop: true,
        match: { sourceIds: ['src-1'], protocols: [], sourceNameRegex: '', nodeNameRegex: '' },
        targets: ['eg-1'],
      },
    ],
  });
  const parsedSources = state.sources.map((source) => ({
    source,
    ...parseSubscriptionContent(source.content, source),
  }));
  return { state, parsedSources };
}

test('exports clash config with dialer proxy chain', () => {
  const { state, parsedSources } = buildFixture();
  const output = getClientExport('clash', state, parsedSources);
  assert.equal(output.filename, 'clash.yaml');
  assert.match(output.body, /dialer-proxy:/);
  assert.match(output.body, /egress-france/);
  assert.match(output.body, /MATCH,relay-main/);
});

test('exports base64 URI subscription for v2ray compatible clients', () => {
  const { state, parsedSources } = buildFixture();
  const output = getClientExport('v2ray', state, parsedSources);
  const decoded = Buffer.from(output.body, 'base64').toString('utf8');
  assert.match(decoded, /^vless:\/\//);
  assert.match(decoded, /Source%201%20via%20france/);
});
