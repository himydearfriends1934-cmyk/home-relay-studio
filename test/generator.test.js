import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSingBoxConfig } from '../src/generator.js';
import { normalizeState } from '../src/state.js';
import { parseSubscriptionContent } from '../src/parsers.js';

test('generates chained config with detour', () => {
  const state = normalizeState({
    projectName: 'Test',
    sources: [
      {
        id: 'src-1',
        name: 'Main',
        kind: 'text',
        content: 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2Fchat#node-a',
        enabled: true,
      },
    ],
    egresses: [
      {
        id: 'eg-1',
        name: 'ISP-1',
        protocol: 'socks',
        server: 'home.example.com',
        port: 1080,
        enabled: true,
      },
    ],
    rules: [
      {
        id: 'rule-1',
        name: 'VLESS to ISP-1',
        enabled: true,
        priority: 10,
        targetMode: 'append',
        match: { sourceIds: [], sourceNameRegex: '', nodeNameRegex: '', protocols: ['vless'] },
        targets: ['eg-1'],
      },
    ],
  });

  const parsedSources = state.sources.map((source) => ({
    source,
    ...parseSubscriptionContent(source.content, source),
  }));

  const result = generateSingBoxConfig(state, parsedSources);
  assert.equal(result.assignments.length, 1);
  const outbound = result.config.outbounds.find((item) => item.tag === result.assignments[0].tag);
  assert.ok(outbound);
  assert.equal(outbound.detour, 'egress-eg-1');
  assert.equal(result.config.route.final, 'relay-main');
});
