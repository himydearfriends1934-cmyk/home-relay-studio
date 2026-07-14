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
  assert.equal(outbound.type, 'socks');
  assert.match(outbound.detour, /^front-/);
  const front = result.config.outbounds.find((item) => item.tag === outbound.detour);
  assert.equal(front.type, 'vless');
  assert.equal(front.detour, undefined);
  assert.equal(result.config.route.final, 'relay-main');
});

test('chains every supported source protocol through the final home egress', () => {
  const protocols = ['http', 'socks', 'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'];
  for (const protocol of protocols) {
    const state = normalizeState({
      sources: [{ id: 'src-1', name: 'All protocols', kind: 'text', enabled: true }],
      egresses: [{ id: 'eg-fr', name: 'France home', protocol: 'socks', server: 'home.example.com', port: 1080, enabled: true }],
      rules: [{ id: 'rule-all', name: 'All to France', enabled: true, priority: 1, targetMode: 'replace', stop: true, match: {}, targets: ['eg-fr'] }],
    });
    const node = {
      protocol,
      name: `${protocol}-node`,
      server: 'front.example.com',
      port: 443,
      username: 'user',
      password: 'pass',
      uuid: '11111111-1111-1111-1111-111111111111',
      method: 'aes-128-gcm',
    };
    const result = generateSingBoxConfig(state, [{ source: state.sources[0], nodes: [node], warnings: [], errors: [] }]);
    const assignment = result.assignments[0];
    const finalHop = result.config.outbounds.find((item) => item.tag === assignment.tag);
    const frontHop = result.config.outbounds.find((item) => item.tag === finalHop.detour);
    assert.equal(finalHop.type, 'socks', `${protocol} should finish at the home egress`);
    assert.equal(frontHop.type, protocol, `${protocol} should be the front hop`);
  }
});
