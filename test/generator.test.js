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

test('omits the implicit TCP transport from sing-box outbounds', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'TCP source', kind: 'text', enabled: true }],
    egresses: [{ id: 'eg-1', name: 'Home', protocol: 'socks', server: 'home.example.com', port: 1080, enabled: true }],
    export: { defaultEgressId: 'eg-1' },
  });
  const parsed = parseSubscriptionContent(
    'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=tcp#tcp-node',
    state.sources[0],
  );
  const result = generateSingBoxConfig(state, [{ source: state.sources[0], ...parsed }]);
  const finalHop = result.config.outbounds.find((item) => item.tag === result.assignments[0].tag);
  const frontHop = result.config.outbounds.find((item) => item.tag === finalHop.detour);

  assert.equal(frontHop.type, 'vless');
  assert.equal(frontHop.transport, undefined);
});

test('routes through an assignment when selectors are disabled', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'Main', kind: 'text', enabled: true }],
    egresses: [{ id: 'eg-1', name: 'Home', protocol: 'socks', server: 'home.example.com', port: 1080, enabled: true }],
    export: { defaultEgressId: 'eg-1', includeSelectors: false },
  });
  const node = { id: 'node-1', name: 'node', protocol: 'socks', server: 'front.example.com', port: 1080 };
  const result = generateSingBoxConfig(state, [
    { source: state.sources[0], nodes: [node], warnings: [], errors: [] },
  ]);

  assert.equal(result.assignments.length, 1);
  assert.equal(result.config.route.final, result.assignments[0].tag);
  assert.notEqual(result.config.route.final, 'direct');
});

test('generates unique sing-box tags for duplicate node names', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'Main', kind: 'text', enabled: true }],
    egresses: [{ id: 'eg-1', name: 'Home', protocol: 'socks', server: 'home.example.com', port: 1080, enabled: true }],
    export: { defaultEgressId: 'eg-1' },
  });
  const common = { name: 'duplicate', protocol: 'socks', server: 'front.example.com', port: 1080 };
  const result = generateSingBoxConfig(state, [
    {
      source: state.sources[0],
      nodes: [
        { ...common, id: 'node-1' },
        { ...common, id: 'node-2' },
      ],
      warnings: [],
      errors: [],
    },
  ]);
  const tags = result.config.outbounds.map((item) => item.tag).filter(Boolean);

  assert.equal(result.assignments.length, 2);
  assert.equal(new Set(result.assignments.map((item) => item.tag)).size, 2);
  assert.equal(new Set(tags).size, tags.length);
});

test('keeps Shadowsocks SIP003 plugins on the chained front hop', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'Plugin source', kind: 'text', enabled: true }],
    egresses: [{ id: 'eg-1', name: 'Home', protocol: 'socks', server: 'home.example.com', port: 1080, enabled: true }],
    export: { defaultEgressId: 'eg-1' },
  });
  const credentials = Buffer.from('aes-128-gcm:secret', 'utf8').toString('base64url');
  const plugin = encodeURIComponent('v2ray-plugin;mode=websocket;tls;host=cdn.example.com');
  const parsed = parseSubscriptionContent(
    `ss://${credentials}@front.example.com:8388?plugin=${plugin}#plugin-node`,
    state.sources[0],
  );
  const result = generateSingBoxConfig(state, [{ source: state.sources[0], ...parsed }]);
  const finalHop = result.config.outbounds.find((item) => item.tag === result.assignments[0].tag);
  const frontHop = result.config.outbounds.find((item) => item.tag === finalHop.detour);

  assert.equal(frontHop.type, 'shadowsocks');
  assert.equal(frontHop.plugin, 'v2ray-plugin');
  assert.equal(frontHop.plugin_opts, 'mode=websocket;tls;host=cdn.example.com');
});

test('enables mandatory TLS for Trojan, Hysteria2, and TUIC egresses', () => {
  for (const protocol of ['trojan', 'hysteria2', 'tuic']) {
    const egress = {
      id: 'eg-1',
      name: 'Home',
      protocol,
      server: 'home.example.com',
      port: 443,
      password: 'secret',
      uuid: '11111111-1111-1111-1111-111111111111',
      enabled: true,
    };
    const state = normalizeState({
      sources: [{ id: 'src-1', name: 'Source', kind: 'text', enabled: true }],
      egresses: [egress],
      export: { defaultEgressId: 'eg-1' },
    });
    const node = { name: 'front', protocol: 'socks', server: 'front.example.com', port: 1080 };
    const result = generateSingBoxConfig(state, [
      { source: state.sources[0], nodes: [node], warnings: [], errors: [] },
    ]);
    const finalHop = result.config.outbounds.find((item) => item.tag === result.assignments[0].tag);
    assert.equal(finalHop.tls?.enabled, true, `${protocol} should always enable TLS`);
  }
});

test('fails closed when an explicit rule targets a disabled egress', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'Source', kind: 'text', enabled: true }],
    egresses: [
      { id: 'eg-fr', name: 'France', protocol: 'socks', server: 'fr.example.com', port: 1080, enabled: false },
      { id: 'eg-us', name: 'US', protocol: 'socks', server: 'us.example.com', port: 1080, enabled: true },
    ],
    rules: [
      {
        id: 'rule-1',
        name: 'France only',
        enabled: true,
        priority: 100,
        targetMode: 'replace',
        stop: true,
        match: { sourceIds: ['src-1'] },
        targets: ['eg-fr'],
      },
    ],
  });
  const node = { name: 'front', protocol: 'socks', server: 'front.example.com', port: 1080 };
  const result = generateSingBoxConfig(state, [
    { source: state.sources[0], nodes: [node], warnings: [], errors: [] },
  ]);

  assert.equal(result.assignments.length, 0);
  assert.ok(result.assignmentWarnings.some((warning) => warning.type === 'unassigned-node'));
});

test('source-scoped protocol rules block default fallback for unselected protocols', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'Mixed source', kind: 'text', enabled: true }],
    egresses: [{ id: 'eg-1', name: 'France', protocol: 'socks', server: 'fr.example.com', port: 1080, enabled: true }],
    rules: [
      {
        id: 'rule-vless',
        name: 'Only VLESS',
        enabled: true,
        priority: 100,
        targetMode: 'replace',
        stop: true,
        match: { sourceIds: ['src-1'], protocols: ['vless'] },
        targets: ['eg-1'],
      },
    ],
  });
  const result = generateSingBoxConfig(state, [
    {
      source: state.sources[0],
      nodes: [
        { name: 'vless-node', protocol: 'vless', server: 'front.example.com', port: 443, uuid: '11111111-1111-1111-1111-111111111111' },
        { name: 'trojan-node', protocol: 'trojan', server: 'front.example.com', port: 443, password: 'secret' },
      ],
      warnings: [],
      errors: [],
    },
  ]);

  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].node.protocol, 'vless');
  assert.ok(result.assignmentWarnings.some((warning) => warning.nodeName === 'trojan-node'));
});
