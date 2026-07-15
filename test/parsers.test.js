import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubscriptionContent } from '../src/parsers.js';

test('parses vless uri', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const text = 'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=tls&type=ws&host=example.com&path=%2Fchat#node-a';
  const parsed = parseSubscriptionContent(text, source);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'vless');
  assert.equal(parsed.nodes[0].transportType, 'ws');
  assert.equal(parsed.nodes[0].server, 'example.com');
});

test('parses clash yaml', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const text = `
proxies:
  - name: socks-node
    type: socks5
    server: 1.2.3.4
    port: 1080
    username: alice
    password: secret
`;
  const parsed = parseSubscriptionContent(text, source);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'socks');
  assert.equal(parsed.nodes[0].server, '1.2.3.4');
});

test('source format hints parse shared client subscription shapes', () => {
  const clashText = `
proxies:
  - name: hinted-vless
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
`;
  for (const formatHint of ['clash', 'shadowrocket', 'throne', 'sfi', 'sfa', 'sfm']) {
    const parsed = parseSubscriptionContent(clashText, { id: 'src-1', name: 'Demo', formatHint });
    assert.equal(parsed.nodes.length, 1, formatHint);
    assert.equal(parsed.nodes[0].protocol, 'vless', formatHint);
  }

  const uriText = Buffer.from(
    'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none#hinted-uri',
    'utf8',
  ).toString('base64');
  for (const formatHint of ['v2rayn', 'v2rayng', 'uri']) {
    const parsed = parseSubscriptionContent(uriText, { id: 'src-1', name: 'Demo', formatHint });
    assert.equal(parsed.nodes.length, 1, formatHint);
    assert.equal(parsed.nodes[0].protocol, 'vless', formatHint);
  }
});

test('parses base64 sing-box config', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const json = JSON.stringify({
    outbounds: [
      {
        type: 'vmess',
        tag: 'vmess-node',
        server: 'example.com',
        server_port: 443,
        uuid: '11111111-1111-1111-1111-111111111111',
      },
    ],
  });
  const text = Buffer.from(json, 'utf8').toString('base64');
  const parsed = parseSubscriptionContent(text, source);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'vmess');
});

test('parses sing-box yaml config', () => {
  const source = { id: 'src-1', name: 'Demo', formatHint: 'sing-box' };
  const parsed = parseSubscriptionContent(
    `
outbounds:
  - type: vmess
    tag: yaml-vmess
    server: example.com
    server_port: 443
    uuid: 11111111-1111-1111-1111-111111111111
`,
    source,
  );

  assert.equal(parsed.format, 'sing-box');
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'vmess');
});

test('parses Trojan URI password and enables its implicit TLS default', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent('trojan://secret@example.com:443?type=tcp#trojan-node', source);

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'trojan');
  assert.equal(parsed.nodes[0].password, 'secret');
  assert.equal(parsed.nodes[0].tlsEnabled, true);
});

test('maps Clash ss proxies to the normalized shadowsocks protocol', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent(
    `
proxies:
  - name: ss-node
    type: ss
    server: 1.2.3.4
    port: 8388
    cipher: aes-128-gcm
    password: secret
`,
    source,
  );

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'shadowsocks');
  assert.equal(parsed.nodes[0].method, 'aes-128-gcm');
  assert.equal(parsed.nodes[0].password, 'secret');
});

test('parses legacy fully encoded Shadowsocks URIs', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const authority = Buffer.from('aes-128-gcm:secret@example.com:8388', 'utf8').toString('base64');
  const parsed = parseSubscriptionContent(`ss://${authority}#legacy-ss`, source);

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'shadowsocks');
  assert.equal(parsed.nodes[0].server, 'example.com');
  assert.equal(parsed.nodes[0].port, 8388);
  assert.equal(parsed.nodes[0].method, 'aes-128-gcm');
  assert.equal(parsed.nodes[0].password, 'secret');
});

test('preserves TLS for HTTPS proxy URIs', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent('https://alice:secret@example.com:8443#secure-http', source);

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'http');
  assert.equal(parsed.nodes[0].tlsEnabled, true);
  assert.equal(parsed.nodes[0].username, 'alice');
  assert.equal(parsed.nodes[0].password, 'secret');
});

test('keeps VMess cipher, alterId, and TLS as separate fields', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const payload = Buffer.from(
    JSON.stringify({
      v: '2',
      ps: 'vmess-node',
      add: 'example.com',
      port: '443',
      id: '11111111-1111-1111-1111-111111111111',
      aid: '64',
      scy: 'auto',
      net: 'ws',
      host: 'example.com',
      path: '/ws',
      tls: 'tls',
    }),
    'utf8',
  ).toString('base64');
  const parsed = parseSubscriptionContent(`vmess://${payload}`, source);

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].name, 'vmess-node');
  assert.equal(parsed.nodes[0].security, 'auto');
  assert.equal(parsed.nodes[0].alterId, 64);
  assert.equal(parsed.nodes[0].tlsEnabled, true);
});

test('preserves VLESS Reality parameters', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent(
    'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none&security=reality&type=tcp&pbk=PUBLIC_KEY&sid=abcd&fp=chrome#reality-node',
    source,
  );

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'vless');
  assert.equal(parsed.nodes[0].security, 'reality');
  assert.equal(parsed.nodes[0].tlsEnabled, true);
  assert.equal(parsed.nodes[0].realityPublicKey, 'PUBLIC_KEY');
  assert.equal(parsed.nodes[0].realityShortId, 'abcd');
  assert.equal(parsed.nodes[0].fingerprint, 'chrome');
});

test('preserves Shadowsocks SIP003 plugin options', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const credentials = Buffer.from('aes-128-gcm:secret', 'utf8').toString('base64url');
  const plugin = encodeURIComponent('v2ray-plugin;mode=websocket;tls;host=cdn.example.com;path=/ws');
  const parsed = parseSubscriptionContent(
    `ss://${credentials}@example.com:8388?plugin=${plugin}#plugin-ss`,
    source,
  );

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].plugin, 'v2ray-plugin');
  assert.equal(parsed.nodes[0].pluginOptions, 'mode=websocket;tls;host=cdn.example.com;path=/ws');
  assert.deepEqual(parsed.nodes[0].pluginOpts, {
    mode: 'websocket',
    tls: true,
    host: 'cdn.example.com',
    path: '/ws',
  });
});

test('preserves Clash protocol-specific fields and inherent TLS', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent(
    `
proxies:
  - name: vmess-special
    type: vmess
    server: vmess.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    alterId: 32
    cipher: auto
  - name: trojan-default-tls
    type: trojan
    server: trojan.example.com
    port: 443
    password: secret
`,
    source,
  );

  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.nodes[0].alterId, 32);
  assert.equal(parsed.nodes[0].transportType, '');
  assert.equal(parsed.nodes[1].tlsEnabled, true);
  assert.equal(parsed.nodes[1].transportType, '');
});

test('routes JSON objects with proxies to the Clash parser', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent(
    JSON.stringify({
      proxies: [
        {
          name: 'json-socks',
          type: 'socks5',
          server: '1.2.3.4',
          port: 1080,
        },
      ],
    }),
    source,
  );

  assert.equal(parsed.format, 'clash');
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'socks');
});

test('skips one malformed URI without discarding valid nodes', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent(
    [
      'vless://11111111-1111-1111-1111-111111111111@example.com:443?encryption=none#valid',
      'trojan://secret@example.com:443#bad%ZZ',
    ].join('\n'),
    source,
  );

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].name, 'valid');
  assert.ok(parsed.warnings.some((warning) => warning.includes('malformed')));
});

test('preserves Clash H2 transport type, options, path, and host', () => {
  const source = { id: 'src-1', name: 'Demo' };
  const parsed = parseSubscriptionContent(
    `
proxies:
  - name: h2-node
    type: vless
    server: h2.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    network: h2
    h2-opts:
      host: [cdn.example.com]
      path: /relay
`,
    source,
  );

  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].transportType, 'h2');
  assert.equal(parsed.nodes[0].host, 'cdn.example.com');
  assert.equal(parsed.nodes[0].path, '/relay');
  assert.deepEqual(parsed.nodes[0].transportOptions['h2-opts'], {
    host: ['cdn.example.com'],
    path: '/relay',
  });
});
