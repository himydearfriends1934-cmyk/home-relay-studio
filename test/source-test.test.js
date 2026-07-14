import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { testSource } from '../src/source-test.js';

test('source test reports protocol counts and TCP reachability', async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const port = server.address().port;
  const source = {
    id: 'src-test',
    name: 'Local nodes',
    kind: 'text',
    content: `socks5://127.0.0.1:${port}#local-socks`,
  };
  const result = await testSource(source, (item) => item.content, { timeoutMs: 1000 });

  assert.equal(result.status, 'ok');
  assert.equal(result.nodes, 1);
  assert.equal(result.protocolCounts.socks, 1);
  assert.equal(result.checked, 1);
  assert.equal(result.checks[0].status, 'open');
  assert.equal(result.checks[0].protocol, 'socks');
  assert.equal(typeof result.checks[0].latencyMs, 'number');
});
