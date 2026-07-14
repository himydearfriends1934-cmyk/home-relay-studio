import net from 'node:net';
import { parseSubscriptionContent } from './parsers.js';

const DEFAULT_NODE_LIMIT = 20;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 2500;

export async function testSource(source, loader, options = {}) {
  const startedAt = Date.now();
  const limit = toPositiveInt(options.limit, DEFAULT_NODE_LIMIT);
  const concurrency = toPositiveInt(options.concurrency, DEFAULT_CONCURRENCY);
  const timeoutMs = toPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  try {
    const fetchStartedAt = Date.now();
    const content = await loader(source);
    const fetchMs = Date.now() - fetchStartedAt;
    const parseStartedAt = Date.now();
    const parsed = parseSubscriptionContent(content, source);
    const parseMs = Date.now() - parseStartedAt;
    const nodes = parsed.nodes || [];
    const checkedNodes = nodes.slice(0, limit);
    const checks = await mapLimit(checkedNodes, concurrency, (node) => testNode(node, timeoutMs));

    return {
      status: 'ok',
      elapsedMs: Date.now() - startedAt,
      fetchMs,
      parseMs,
      bytes: Buffer.byteLength(String(content || ''), 'utf8'),
      format: parsed.format,
      nodes: nodes.length,
      checked: checks.length,
      truncated: nodes.length > checks.length,
      protocolCounts: countProtocols(nodes),
      checks,
      warnings: parsed.warnings || [],
      errors: parsed.errors || [],
    };
  } catch (error) {
    return {
      status: 'error',
      elapsedMs: Date.now() - startedAt,
      fetchMs: 0,
      parseMs: 0,
      bytes: 0,
      format: 'error',
      nodes: 0,
      checked: 0,
      truncated: false,
      protocolCounts: {},
      checks: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function countProtocols(nodes) {
  const counts = {};
  for (const node of nodes) {
    const protocol = node.protocol || 'unknown';
    counts[protocol] = (counts[protocol] || 0) + 1;
  }
  return counts;
}

async function testNode(node, timeoutMs) {
  const startedAt = Date.now();
  const tcp = await checkTcpEndpoint(node.server, node.port, timeoutMs);
  return {
    name: node.name || '',
    protocol: node.protocol || 'unknown',
    status: tcp.status,
    latencyMs: tcp.status === 'open' ? Date.now() - startedAt : null,
    message: tcp.message || '',
  };
}

async function checkTcpEndpoint(host, port, timeoutMs) {
  if (!host || !Number.isInteger(port)) {
    return { status: 'skipped', message: 'missing endpoint' };
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ status: 'open' }));
    socket.once('timeout', () => done({ status: 'timeout' }));
    socket.once('error', (error) => {
      done({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
