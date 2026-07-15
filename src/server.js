import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { expandClashProxyProviders } from './clash-providers.js';
import { DEFAULT_LISTEN_PORT } from './constants.js';
import { diagnoseState } from './diagnostics.js';
import { buildAssignmentExportNode, buildUri, getClientExport } from './exporters.js';
import { generateNormalizedSnapshot, generateSingBoxConfig } from './generator.js';
import { parseSubscriptionContent } from './parsers.js';
import { getQrPayload } from './qr.js';
import { resolveSourceFetchUrl } from './source-access.js';
import { testSource } from './source-test.js';
import { normalizeState } from './state.js';
import { loadState, saveState } from './store.js';
import {
  createSubscriptionToken,
  isUsableSubscriptionToken,
  subscriptionTokenMatches,
} from './subscription-token.js';
import { getUpgradeStatus, runUpgrade, scheduleUpgradeRestart } from './upgrader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const installConfig = await loadInstallConfig();
const subscriptionToken = await resolveSubscriptionToken(installConfig);
const publicBaseUrl = normalizePublicBaseUrl(
  process.env.PUBLIC_BASE_URL || installConfig.publicBaseUrl || installConfig.publicSubscriptionBaseUrl || '',
);

const state = await loadState();

const server = http.createServer(async (req, res) => {
  try {
    await routeRequest(req, res);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

const port = Number.parseInt(process.env.PORT || String(installConfig.port || DEFAULT_LISTEN_PORT), 10) || DEFAULT_LISTEN_PORT;
const host = process.env.HOST || installConfig.host || '127.0.0.1';
server.listen(port, host, () => {
  console.log(`Home Relay Studio running at http://${host}:${port}`);
});

const publicSubscriptionPort = parseOptionalPort(
  process.env.PUBLIC_SUBSCRIPTION_PORT || installConfig.publicSubscriptionPort || '',
);
const publicSubscriptionHost = process.env.PUBLIC_SUBSCRIPTION_HOST || installConfig.publicSubscriptionHost || '0.0.0.0';
if (publicSubscriptionPort) {
  const publicSubscriptionServer = http.createServer(async (req, res) => {
    try {
      await routePublicSubscriptionRequest(req, res);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  publicSubscriptionServer.listen(publicSubscriptionPort, publicSubscriptionHost, () => {
    console.log(`Home Relay Studio public subscription export running at http://${publicSubscriptionHost}:${publicSubscriptionPort}`);
  });
}

async function loadInstallConfig() {
  try {
    const content = await fs.readFile(path.join(projectRoot, '.home-relay-studio.json'), 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function resolveSubscriptionToken(config) {
  const configuredByEnvironment = String(process.env.SUBSCRIPTION_TOKEN || '').trim();
  if (configuredByEnvironment) {
    if (!isUsableSubscriptionToken(configuredByEnvironment)) {
      throw new Error('SUBSCRIPTION_TOKEN must contain at least 32 characters.');
    }
    return configuredByEnvironment;
  }

  if (isUsableSubscriptionToken(config.subscriptionToken)) {
    await restrictInstallConfigPermissions();
    return config.subscriptionToken;
  }

  const token = createSubscriptionToken();
  const nextConfig = { ...config, subscriptionToken: token };
  const configPath = path.join(projectRoot, '.home-relay-studio.json');
  await fs.writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await restrictInstallConfigPermissions();
  Object.assign(config, nextConfig);
  return token;
}

async function restrictInstallConfigPermissions() {
  if (process.platform === 'win32') return;
  try {
    await fs.chmod(path.join(projectRoot, '.home-relay-studio.json'), 0o600);
  } catch {
    // A read-only environment may provide the token through SUBSCRIPTION_TOKEN instead.
  }
}

async function routeRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/api/runtime') {
    return sendJson(res, 200, {
      publicBaseUrl,
      subscriptionToken,
    }, { 'cache-control': 'no-store' });
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return sendJson(res, 200, state);
  }
  if (req.method === 'PUT' && url.pathname === '/api/state') {
    const body = await readJsonBody(req);
    const next = normalizeState(body);
    Object.assign(state, next);
    await saveState(state);
    return sendJson(res, 200, state);
  }
  if (req.method === 'POST' && url.pathname === '/api/parse-source') {
    const body = await readJsonBody(req);
    const source = body?.source || {};
    const content = await loadSourceContent(source);
    const parsed = parseSubscriptionContent(content, source);
    return sendJson(res, 200, parsed);
  }
  if (req.method === 'POST' && url.pathname === '/api/test-source') {
    const body = await readJsonBody(req);
    const source = body?.source || {};
    const result = await testSource(source, loadSourceContent);
    return sendJson(res, 200, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const body = await readJsonBody(req);
    const viewState = normalizeState(body?.state || state);
    const parsedSources = await loadParsedSources(viewState);
    const generated = generateSingBoxConfig(viewState, parsedSources);
    const assignments = Array.isArray(generated.assignments)
      ? generated.assignments.map((assignment) => ({
          ...assignment,
          uri: buildUri(buildAssignmentExportNode(assignment, viewState.export?.nameTemplate)),
        }))
      : [];
    return sendJson(res, 200, {
      ...generated,
      assignments,
      snapshot: generateNormalizedSnapshot(viewState, parsedSources),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/upgrade/status') {
    const status = await getUpgradeStatus(projectRoot);
    return sendJson(res, 200, status);
  }
  if (req.method === 'POST' && url.pathname === '/api/upgrade/run') {
    const result = await runUpgrade(projectRoot);
    const restartScheduled = result.changed ? scheduleUpgradeRestart() : false;
    return sendJson(res, 200, {
      ...result,
      restartScheduled,
    });
  }
  if (isExportMethod(req.method) && url.pathname.startsWith('/api/export/')) {
    return handleExportRequest(url, res, req.method === 'HEAD');
  }
  if (req.method === 'GET' && url.pathname === '/api/qr') {
    const text = url.searchParams.get('text') || '';
    if (!text) {
      return sendText(res, 400, 'Missing text parameter');
    }
    const payload = getQrPayload(url.searchParams.get('format') || '', text);
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      width: 260,
      errorCorrectionLevel: 'M',
    });
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(svg);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/diagnose') {
    const body = await readJsonBody(req);
    const viewState = normalizeState(body?.state || state);
    const report = await diagnoseState(viewState, loadSourceContent);
    return sendJson(res, 200, report);
  }
  if (req.method === 'POST' && url.pathname === '/api/parse') {
    const body = await readJsonBody(req);
    const source = body?.source || {};
    const content = typeof body?.content === 'string' ? body.content : await loadSourceContent(source);
    return sendJson(res, 200, parseSubscriptionContent(content, source));
  }

  return serveStatic(req, res, url.pathname);
}

function normalizePublicBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseOptionalPort(value) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

async function routePublicSubscriptionRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (isExportMethod(req.method) && url.pathname.startsWith('/api/export/')) {
    return handleExportRequest(url, res, req.method === 'HEAD');
  }
  return sendText(res, 404, 'Not found');
}

function isExportMethod(method) {
  return method === 'GET' || method === 'HEAD';
}

async function handleExportRequest(url, res, headOnly = false) {
  if (!subscriptionTokenMatches(subscriptionToken, url.searchParams.get('token') || '')) {
    return sendText(res, 403, 'Invalid or missing subscription token.', { headOnly });
  }
  const format = url.pathname.slice('/api/export/'.length);
  const viewState = normalizeState(state);
  const parsedSources = await loadParsedSources(viewState);
  const exportUrl = publicBaseUrl ? buildPublicExportUrl(format) : '';
  const output = getClientExport(format, viewState, parsedSources, { exportUrl });
  if (!output) {
    return sendText(res, 404, 'Unknown export format', { headOnly });
  }
  if (output.error) {
    return sendText(res, 422, output.error, { headOnly });
  }
  if (!output.nodeCount) {
    const failedSource = parsedSources.find((bundle) => bundle.errors?.length);
    const detail = failedSource
      ? ` Source "${failedSource.source.name}": ${failedSource.errors[0]}`
      : '';
    return sendText(res, 422, `No usable nodes were generated. Check the source preview, enabled egress, and rule targets.${detail}`, { headOnly });
  }
  const headers = {
    'content-type': output.contentType,
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(output.body)),
    'x-relay-node-count': String(output.nodeCount),
  };
  if (output.id === 'shadowrocket') {
    headers['content-disposition'] = `inline; filename="${output.filename}"`;
  }
  if (url.searchParams.get('download') === '1') {
    headers['content-disposition'] = `attachment; filename="${output.filename}"`;
  }
  res.writeHead(200, headers);
  res.end(headOnly ? undefined : output.body);
}

function buildPublicExportUrl(format) {
  const url = new URL(`${publicBaseUrl}/api/export/${encodeURIComponent(format)}`);
  url.searchParams.set('token', subscriptionToken);
  return url.toString();
}

async function loadParsedSources(viewState) {
  const bundles = [];
  for (const source of viewState.sources.filter((item) => item.enabled)) {
    try {
      const content = await loadSourceContent(source);
      const parsed = parseSubscriptionContent(content, source);
      bundles.push({
        source,
        ...parsed,
      });
    } catch (error) {
      bundles.push({
        source,
        format: 'error',
        nodes: [],
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
  return bundles;
}

async function loadSourceContent(source) {
  if (source.kind === 'text') {
    const content = source.content || '';
    const expanded = await expandClashProxyProviders(content, {
      baseUrl: source.url || '',
    });
    return expanded.content || content;
  }
  const resolvedUrl = resolveSourceFetchUrl(source);
  if (!resolvedUrl) {
    return source.content || '';
  }
  let customHeaders = {};
  if (String(source.headersJson || '').trim()) {
    try {
      const parsed = JSON.parse(source.headersJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object');
      customHeaders = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    } catch (error) {
      throw new Error(`Invalid headers JSON for source "${source.name || source.id}": ${error.message}`);
    }
  }
  const response = await fetch(resolvedUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'user-agent': 'HomeRelayStudio/0.1',
      ...customHeaders,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching source.`);
  }
  const rawContent = await response.text();
  const expanded = await expandClashProxyProviders(rawContent, {
    baseUrl: resolvedUrl,
    headers: customHeaders,
  });
  return expanded.content || rawContent;
}

async function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDir, `.${target}`);
  if (!filePath.startsWith(publicDir)) {
    return sendText(res, 403, 'Forbidden');
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType(filePath),
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function sendJson(res, statusCode, value, headers = {}) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, statusCode, text, options = {}) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(options.headOnly ? undefined : text);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
