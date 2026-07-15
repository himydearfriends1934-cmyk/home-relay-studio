import assert from 'node:assert/strict';
import test from 'node:test';
import yaml from 'js-yaml';
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
  const config = yaml.load(output.body);
  const finalProxy = config.proxies.find((item) => item.type === 'http' && item['dialer-proxy']);
  assert.ok(finalProxy);
  assert.equal(finalProxy.type, 'http');
  const frontProxy = config.proxies.find((item) => item.name === finalProxy['dialer-proxy']);
  assert.equal(frontProxy.type, 'vless');
  assert.match(output.body, /MATCH,relay-main/);
});

test('exports Shadowrocket subscriptions as flattened final egress nodes', () => {
  const { state, parsedSources } = buildFixture();
  const output = getClientExport('shadowrocket', state, parsedSources);
  assert.equal(output.contentType, 'text/yaml; charset=utf-8');
  const config = yaml.load(output.body);
  assert.deepEqual(Object.keys(config), ['proxies']);
  assert.ok(Array.isArray(config.proxies));
  assert.ok(config.proxies.length > 0);
  assert.equal(config.proxies.length, 1);
  assert.equal(config.proxies[0].type, 'http');
  assert.equal(config.proxies[0].server, 'isp.example.com');
  assert.equal(config.proxies[0].name, 'node-a via france');
  assert.equal(config.proxies[0]['dialer-proxy'], undefined);
  assert.equal(output.body.includes('dialer-proxy:'), false);
});

test('keeps Shadowsocks plugin options in Shadowrocket subscriptions', () => {
  const credentials = Buffer.from('aes-128-gcm:secret', 'utf8').toString('base64url');
  const plugin = encodeURIComponent('v2ray-plugin;mode=websocket;tls;host=cdn.example.com');
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'SS', kind: 'text', enabled: true }],
    egresses: [{ id: 'eg-direct', name: 'Direct', protocol: 'direct', enabled: true }],
    export: { defaultEgressId: 'eg-direct' },
  });
  const parsed = parseSubscriptionContent(
    `ss://${credentials}@front.example.com:8388?plugin=${plugin}#plugin-node`,
    state.sources[0],
  );
  const output = getClientExport('shadowrocket', state, [{ source: state.sources[0], ...parsed }]);
  const config = yaml.load(output.body);
  const frontProxy = config.proxies.find((item) => item.type === 'ss' && item.plugin === 'v2ray-plugin');

  assert.ok(frontProxy);
  assert.deepEqual(frontProxy['plugin-opts'], {
    mode: 'websocket',
    tls: true,
    host: 'cdn.example.com',
  });
});

test('rejects V2Ray URI export when assignments require a chained egress', () => {
  const { state, parsedSources } = buildFixture();
  const output = getClientExport('v2ray', state, parsedSources);

  assert.equal(output.nodeCount, 0);
  assert.equal(output.body, '');
  assert.match(output.error, /v2ray.*(?:chain|egress)|(?:chain|egress).*v2ray/i);
});

test('exports V2RayN URI subscriptions for direct assignments', () => {
  const state = normalizeState({
    sources: [
      {
        id: 'src-1',
        name: 'Direct source',
        kind: 'text',
        content:
          'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2Fchat#direct-node',
        enabled: true,
      },
    ],
    egresses: [{ id: 'eg-direct', name: 'Direct', protocol: 'direct', enabled: true }],
    export: { defaultEgressId: 'eg-direct' },
  });
  const parsedSources = state.sources.map((source) => ({
    source,
    ...parseSubscriptionContent(source.content, source),
  }));
  const output = getClientExport('v2rayn', state, parsedSources);
  const decoded = Buffer.from(output.body, 'base64').toString('utf8');

  assert.equal(output.filename, 'v2ray-subscription.txt');
  assert.match(decoded, /^vless:\/\//);
  assert.match(decoded, /#direct-node%20via%20Direct$/);
});

test('keeps raw Clash H2 options intact while attaching the home-egress chain in Clash exports', () => {
  const state = normalizeState({
    sources: [{ id: 'src-1', name: 'H2', kind: 'text', enabled: true }],
    egresses: [
      {
        id: 'eg-1',
        name: 'France Home',
        protocol: 'http',
        server: 'home.example.com',
        port: 3128,
        enabled: true,
      },
    ],
    export: { defaultEgressId: 'eg-1' },
  });
  const parsed = parseSubscriptionContent(
    `
proxies:
  - name: h2-node
    type: vless
    server: h2.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    udp: false
    network: h2
    alpn: [h2]
    h2-opts:
      host: [cdn.example.com]
      path: /relay
`,
    state.sources[0],
  );

  const output = getClientExport('clash', state, [{ source: state.sources[0], ...parsed }]);
  const config = yaml.load(output.body);
  const finalProxy = config.proxies.find((proxy) => proxy['dialer-proxy']);
  const helper = config.proxies.find((proxy) => proxy.name === finalProxy['dialer-proxy']);

  assert.equal(finalProxy.udp, false, 'HTTP home egress must explicitly disable UDP');
  assert.equal(helper.network, 'h2');
  assert.equal(helper.udp, false, 'an explicit source UDP setting must not be overwritten');
  assert.deepEqual(helper.alpn, ['h2']);
  assert.deepEqual(helper['h2-opts'], {
    host: ['cdn.example.com'],
    path: '/relay',
  });
  assert.equal(helper['dialer-proxy'], undefined);
});
