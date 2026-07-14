import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { findAvailablePort, isPortAvailable } from '../scripts/preflight.js';

test('detects an occupied port and suggests a replacement', async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const occupiedPort = server.address().port;
  assert.equal(await isPortAvailable(occupiedPort), false);
  const replacement = await findAvailablePort(occupiedPort + 1, '127.0.0.1', 20);
  assert.ok(replacement > occupiedPort);
  assert.equal(await isPortAvailable(replacement), true);
});
