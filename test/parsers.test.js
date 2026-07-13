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
