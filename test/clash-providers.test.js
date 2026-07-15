import assert from 'node:assert/strict';
import test from 'node:test';
import { expandClashProxyProviders } from '../src/clash-providers.js';
import { parseSubscriptionContent } from '../src/parsers.js';

test('expands Clash proxy providers into parseable proxies', async () => {
  const sourceContent = `
proxies: null
proxy-providers:
  upstream:
    type: http
    url: https://example.com/proxies
`;
  const providerContent = `
proxies:
  - name: provider-node
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
`;

  const expanded = await expandClashProxyProviders(sourceContent, {
    baseUrl: 'https://example.com/clash',
    fetchText: async (url) => {
      assert.equal(url, 'https://example.com/proxies');
      return providerContent;
    },
  });

  assert.equal(expanded.expanded, true);
  const parsed = parseSubscriptionContent(expanded.content, { id: 'src-1', name: 'Demo' });
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.nodes[0].protocol, 'vless');
  assert.equal(parsed.nodes[0].server, 'example.com');
});
