import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { DEFAULT_LISTEN_PORT } from './constants.js';
import { diagnoseState } from './diagnostics.js';
import { getClientExport } from './exporters.js';
import { generateNormalizedSnapshot, generateSingBoxConfig } from './generator.js';
import { parseSubscriptionContent } from './parsers.js';
import { getQrPayload } from './qr.js';
import { normalizeState } from './state.js';
import { loadState, saveState } from './store.js';
import { getUpgradeStatus, runUpgrade, scheduleUpgradeRestart } from './upgrader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const installConfig = await loadInstallConfig();

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

async function loadInstallConfig() {
  try {
    const content = await fs.readFile(path.join(projectRoot, '.home-relay-studio.json'), 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function routeRequest(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
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
  if (req.method === 'POST' && url.pathname === '/api/generate') {
    const body = await readJsonBody(req);
    const viewState = normalizeState(body?.state || state);
    const parsedSources = await loadParsedSources(viewState);
    const generated = generateSingBoxConfig(viewState, parsedSources);
    return sendJson(res, 200, {
      ...generated,
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
  if (req.method === 'GET' && url.pathname.startsWith('/api/export/')) {
    const format = url.pathname.slice('/api/export/'.length);
    const viewState = normalizeState(state);
    const parsedSources = await loadParsedSources(viewState);
    const output = getClientExport(format, viewState, parsedSources);
    if (!output) {
      return sendText(res, 404, 'Unknown export format');
    }
    const headers = {
      'content-type': output.contentType,
      'cache-control': 'no-store',
    };
    if (url.searchParams.get('download') === '1') {
      headers['content-disposition'] = `attachment; filename="${output.filename}"`;
    }
    res.writeHead(200, headers);
    res.end(output.body);
    return;
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
    const report = await diagnoseState(viewState);
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

async function loadParsedSources(viewState) {
  const bundles = [];
  for (const source of viewState.sources.filter((item) => item.enabled)) {
    const content = await loadSourceContent(source);
    const parsed = parseSubscriptionContent(content, source);
    bundles.push({
      source,
      ...parsed,
    });
  }
  return bundles;
}

async function loadSourceContent(source) {
  if (source.kind === 'text' || !source.url) {
    return source.content || '';
  }
  const response = await fetch(source.url, {
    headers: {
      'user-agent': 'HomeRelayStudio/0.1',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while fetching source.`);
  }
  return response.text();
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

function sendJson(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
