import yaml from 'js-yaml';
import {
  decodeLooseBase64,
  isPlainObject,
  looksLikeBase64,
  normalizeName,
  safeJsonParse,
  splitCsv,
  splitHostPort,
  trimBom,
  toInt,
} from './utils.js';
import { SOURCE_NODE_PROTOCOLS } from './constants.js';

const SKIP_SING_BOX_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns', 'wireguard', 'unknown']);

export function parseSubscriptionContent(text, source = {}) {
  const cleaned = trimBom(text);
  const result = parseNestedContent(cleaned, source, 0);
  return result;
}

function parseNestedContent(text, source, depth) {
  if (depth > 4) {
    return {
      format: 'unknown',
      nodes: [],
      warnings: ['Subscription looks nested too deeply.'],
      errors: [],
    };
  }

  const json = safeJsonParse(text);
  if (json !== null) {
    if (isPlainObject(json)) {
      const singBox = parseSingBoxObject(json, source);
      if (singBox.nodes.length || singBox.warnings.length) return singBox;
      const clash = parseClashObject(json, source);
      if (clash.nodes.length || clash.warnings.length) return clash;
    }
    if (Array.isArray(json)) {
      const clash = parseClashObject({ proxies: json }, source);
      if (clash.nodes.length || clash.warnings.length) return clash;
    }
  }

  if (looksLikeBase64(text) && !text.includes('://')) {
    const decoded = decodeLooseBase64(text);
    if (decoded && decoded !== text) {
      const nested = parseNestedContent(decoded, source, depth + 1);
      if (nested.nodes.length || nested.warnings.length) {
        nested.format = nested.format === 'unknown' ? 'base64->' + nested.format : `base64->${nested.format}`;
        nested.warnings = ['Decoded base64 payload.'].concat(nested.warnings || []);
        return nested;
      }
    }
  }

  const yamlObject = parseYamlObject(text);
  if (yamlObject) {
    const clash = parseClashObject(yamlObject, source);
    if (clash.nodes.length || clash.warnings.length) return clash;
  }

  const uriList = parseUriList(text, source);
  if (uriList.nodes.length || uriList.warnings.length) return uriList;

  return {
    format: 'unknown',
    nodes: [],
    warnings: ['Unrecognized subscription format.'],
    errors: [],
  };
}

function parseYamlObject(text) {
  try {
    const parsed = yaml.load(text);
    return isPlainObject(parsed) || Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseSingBoxObject(obj, source) {
  const nodes = [];
  const warnings = [];
  const outbounds = Array.isArray(obj.outbounds) ? obj.outbounds : [];
  for (const outbound of outbounds) {
    if (!isPlainObject(outbound)) continue;
    const type = normalizeName(outbound.type || '').toLowerCase();
    if (!SOURCE_NODE_PROTOCOLS.has(type) || SKIP_SING_BOX_TYPES.has(type)) {
      continue;
    }
    nodes.push(nodeFromSingBoxOutbound(outbound, source));
  }
  if (nodes.length === 0) warnings.push('No proxy outbounds were found in the sing-box config.');
  return { format: 'sing-box', nodes, warnings, errors: [] };
}

function nodeFromSingBoxOutbound(outbound, source) {
  const type = normalizeName(outbound.type || '').toLowerCase();
  const transport = outbound.transport || {};
  const tls = isPlainObject(outbound.tls) ? outbound.tls : {};
  return {
    id: `${source.id || 'source'}-${nodesafe(outbound.tag || outbound.name || type)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(outbound.tag || outbound.name || type || 'node'),
    protocol: type,
    server: normalizeName(outbound.server || ''),
    port: toInt(outbound.server_port, null),
    username: normalizeName(outbound.username || ''),
    password: String(outbound.password ?? ''),
    uuid: normalizeName(outbound.uuid || ''),
    method: normalizeName(outbound.method || ''),
    security: normalizeName(outbound.security || ''),
    tlsEnabled: Boolean(tls.enabled ?? outbound.tls === true),
    allowInsecure: Boolean(tls.insecure),
    sni: normalizeName(tls.server_name || ''),
    alpn: Array.isArray(tls.alpn) ? tls.alpn.map(normalizeName).filter(Boolean).join(',') : normalizeName(tls.alpn || ''),
    transportType: normalizeName(transport.type || ''),
    path: normalizeName(transport.path || ''),
    host: normalizeName(transport.host || transport.headers?.Host || ''),
    serviceName: normalizeName(transport.service_name || ''),
    congestionControl: normalizeName(outbound.congestion_control || ''),
    udpRelayMode: normalizeName(outbound.udp_relay_mode || ''),
    obfs: normalizeName(outbound.obfs?.type || ''),
    obfsPassword: String(outbound.obfs?.password ?? ''),
    upMbps: toInt(outbound.up_mbps, null),
    downMbps: toInt(outbound.down_mbps, null),
    fingerprint: normalizeName(tls.utls?.fingerprint || outbound.fingerprint || ''),
    rawSingBoxOutbound: structuredClone(outbound),
    supportsUdp: inferSupportsUdp(type),
    requiresUdp: inferRequiresUdp(type),
    original: {
      format: 'sing-box',
      tag: normalizeName(outbound.tag || ''),
    },
  };
}

function parseClashObject(obj, source) {
  const nodes = [];
  const warnings = [];
  const proxies = Array.isArray(obj.proxies) ? obj.proxies : Array.isArray(obj) ? obj : [];
  for (const proxy of proxies) {
    if (!isPlainObject(proxy)) continue;
    const type = normalizeName(proxy.type || '').toLowerCase();
    if (!type) continue;
    const node = nodeFromClashProxy(proxy, source);
    if (node) nodes.push(node);
  }
  if (nodes.length === 0 && Array.isArray(obj.proxies)) warnings.push('No Clash proxies were found.');
  return { format: 'clash', nodes, warnings, errors: [] };
}

function nodeFromClashProxy(proxy, source) {
  const type = normalizeName(proxy.type || '').toLowerCase();
  if (!SOURCE_NODE_PROTOCOLS.has(type) && !['socks5'].includes(type)) return null;
  const transportType = normalizeName(proxy.network || proxy.type || '');
  const wsOpts = proxy['ws-opts'] || {};
  const grpcOpts = proxy['grpc-opts'] || {};
  const tls = Boolean(proxy.tls);
  const protocol = type === 'socks5' ? 'socks' : type;
  return {
    id: `${source.id || 'source'}-${nodesafe(proxy.name || protocol)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(proxy.name || protocol),
    protocol,
    server: normalizeName(proxy.server || ''),
    port: toInt(proxy.port, null),
    username: normalizeName(proxy.username || ''),
    password: String(proxy.password ?? ''),
    uuid: normalizeName(proxy.uuid || ''),
    method: normalizeName(proxy.cipher || proxy.method || ''),
    security: normalizeName(proxy.security || ''),
    tlsEnabled: tls,
    allowInsecure: Boolean(proxy['skip-cert-verify'] || proxy.insecure),
    sni: normalizeName(proxy.servername || proxy.sni || ''),
    alpn: Array.isArray(proxy.alpn) ? proxy.alpn.map(normalizeName).filter(Boolean).join(',') : normalizeName(proxy.alpn || ''),
    transportType:
      transportType === 'ws'
        ? 'ws'
        : transportType === 'grpc'
        ? 'grpc'
        : transportType === 'h2'
        ? 'http'
        : transportType === 'http'
        ? 'http'
        : transportType === 'quic'
        ? 'quic'
        : '',
    path: normalizeName(wsOpts.path || proxy.path || proxy['ws-path'] || ''),
    host: normalizeName(wsOpts.headers?.Host || proxy.host || proxy['ws-headers']?.Host || ''),
    serviceName: normalizeName(grpcOpts['grpc-service-name'] || proxy['grpc-service-name'] || ''),
    congestionControl: normalizeName(proxy['congestion-control'] || ''),
    udpRelayMode: normalizeName(proxy['udp-relay-mode'] || ''),
    obfs: normalizeName(proxy.obfs || ''),
    obfsPassword: String(proxy['obfs-password'] ?? ''),
    upMbps: toInt(proxy['up-mbps'], null),
    downMbps: toInt(proxy['down-mbps'], null),
    fingerprint: normalizeName(proxy.fingerprint || proxy.fp || ''),
    rawClashProxy: structuredClone(proxy),
    supportsUdp: inferSupportsUdp(protocol),
    requiresUdp: inferRequiresUdp(protocol),
    original: {
      format: 'clash',
      name: normalizeName(proxy.name || ''),
    },
  };
}

function parseUriList(text, source) {
  const nodes = [];
  const warnings = [];
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  for (const line of lines) {
    const node = parseUriLine(line, source);
    if (node) {
      nodes.push(node);
    } else if (line.includes('://')) {
      warnings.push(`Skipped unsupported URI scheme in line: ${line.slice(0, 32)}`);
    }
  }

  if (nodes.length === 0 && lines.length > 0) {
    warnings.push('No supported proxy URIs were found.');
  }
  return { format: 'uri-list', nodes, warnings, errors: [] };
}

function parseUriLine(line, source) {
  if (!line.includes('://')) return null;
  const scheme = line.slice(0, line.indexOf('://')).toLowerCase();
  switch (scheme) {
    case 'vmess':
      return parseVmessUri(line, source);
    case 'vless':
      return parseVlessUri(line, source);
    case 'trojan':
      return parseTrojanUri(line, source);
    case 'ss':
      return parseSsUri(line, source);
    case 'socks':
    case 'socks5':
      return parseSocksUri(line, source);
    case 'http':
    case 'https':
      return parseHttpUri(line, source);
    case 'hysteria2':
    case 'hy2':
      return parseHysteria2Uri(line, source);
    case 'tuic':
      return parseTuicUri(line, source);
    default:
      return null;
  }
}

function parseVmessUri(line, source) {
  const raw = line.slice(line.indexOf('://') + 3);
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const name = hashIndex >= 0 ? decodeURIComponent(raw.slice(hashIndex + 1)) : 'vmess';
  const decoded = decodeLooseBase64(withoutHash) || withoutHash;
  const json = safeJsonParse(decoded);
  if (!json || !isPlainObject(json)) return null;
  const server = normalizeName(json.add || json.server || '');
  return {
    id: `${source.id || 'source'}-${nodesafe(name)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(name || json.ps || 'vmess'),
    protocol: 'vmess',
    server,
    port: toInt(json.port, null),
    uuid: normalizeName(json.id || ''),
    method: normalizeName(json.scy || json.security || ''),
    security: normalizeName(json.tls || json.security || ''),
    tlsEnabled: String(json.tls || '').toLowerCase() === 'tls',
    allowInsecure: Boolean(json.allowInsecure),
    sni: normalizeName(json.sni || ''),
    alpn: splitCsv(json.alpn).join(','),
    transportType: normalizeName(json.net || ''),
    path: normalizeName(json.path || ''),
    host: normalizeName(json.host || ''),
    serviceName: normalizeName(json.serviceName || ''),
    fingerprint: normalizeName(json.fp || ''),
    rawUri: line,
    rawVmess: json,
    supportsUdp: inferSupportsUdp('vmess'),
    requiresUdp: inferRequiresUdp('vmess'),
    original: { format: 'vmess-uri', name: normalizeName(name || '') },
  };
}

function parseVlessUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'vless');
  const params = url.searchParams;
  return buildUriNode({
    source,
    protocol: 'vless',
    name,
    url,
    params,
    username: url.username,
    password: url.password,
    rawUri: line,
  });
}

function parseTrojanUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'trojan');
  const params = url.searchParams;
  return buildUriNode({
    source,
    protocol: 'trojan',
    name,
    url,
    params,
    username: url.username,
    password: url.password,
    rawUri: line,
  });
}

function parseSsUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'ss');
  const params = url.searchParams;
  let method = '';
  let password = '';
  let username = decodeURIComponent(url.username || '');
  let host = url.hostname;
  let port = toInt(url.port, null);

  if (username.includes(':')) {
    [method, password] = username.split(/:(.+)/);
  } else {
    const decoded = decodeLooseBase64(username);
    if (decoded && decoded.includes(':')) {
      [method, password] = decoded.split(/:(.+)/);
    } else if (url.password) {
      method = username;
      password = decodeURIComponent(url.password);
    } else {
      const colon = decoded?.indexOf(':') ?? -1;
      if (colon >= 0) {
        method = decoded.slice(0, colon);
        password = decoded.slice(colon + 1);
      }
    }
  }

  return {
    id: `${source.id || 'source'}-${nodesafe(name)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(name || 'ss'),
    protocol: 'shadowsocks',
    server: normalizeName(host || ''),
    port,
    username: '',
    password: password || '',
    method: normalizeName(method || ''),
    tlsEnabled: false,
    allowInsecure: false,
    sni: '',
    alpn: '',
    transportType: '',
    path: '',
    host: '',
    serviceName: '',
    rawUri: line,
    rawSs: {
      plugin: normalizeName(params.get('plugin') || ''),
      pluginOpts: normalizeName(params.get('plugin-opts') || ''),
    },
    supportsUdp: inferSupportsUdp('shadowsocks'),
    requiresUdp: inferRequiresUdp('shadowsocks'),
    original: { format: 'ss-uri', name: normalizeName(name || '') },
  };
}

function parseSocksUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'socks');
  return buildUriNode({
    source,
    protocol: 'socks',
    name,
    url,
    params: url.searchParams,
    username: url.username,
    password: url.password,
    rawUri: line,
  });
}

function parseHttpUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'http');
  return buildUriNode({
    source,
    protocol: 'http',
    name,
    url,
    params: url.searchParams,
    username: url.username,
    password: url.password,
    rawUri: line,
  });
}

function parseHysteria2Uri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'hysteria2');
  const params = url.searchParams;
  return {
    id: `${source.id || 'source'}-${nodesafe(name)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(name),
    protocol: 'hysteria2',
    server: normalizeName(url.hostname || ''),
    port: toInt(url.port, null),
    username: '',
    password: decodeURIComponent(url.username || ''),
    method: '',
    tlsEnabled: true,
    allowInsecure: params.get('insecure') === '1' || params.get('insecure') === 'true',
    sni: normalizeName(params.get('sni') || ''),
    alpn: splitCsv(params.get('alpn')).join(','),
    transportType: '',
    path: '',
    host: '',
    serviceName: '',
    obfs: normalizeName(params.get('obfs') || ''),
    obfsPassword: normalizeName(params.get('obfs-password') || ''),
    upMbps: toInt(params.get('upmbps'), null),
    downMbps: toInt(params.get('downmbps'), null),
    rawUri: line,
    supportsUdp: true,
    requiresUdp: true,
    original: { format: 'hysteria2-uri', name: normalizeName(name || '') },
  };
}

function parseTuicUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'tuic');
  const params = url.searchParams;
  const userParts = decodeURIComponent(url.username || '').split(':');
  const uuid = userParts[0] || '';
  const password = decodeURIComponent(url.password || userParts.slice(1).join(':') || '');
  return {
    id: `${source.id || 'source'}-${nodesafe(name)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(name),
    protocol: 'tuic',
    server: normalizeName(url.hostname || ''),
    port: toInt(url.port, null),
    username: '',
    password,
    uuid: normalizeName(uuid),
    method: '',
    tlsEnabled: true,
    allowInsecure: params.get('allow_insecure') === '1' || params.get('allow_insecure') === 'true',
    sni: normalizeName(params.get('sni') || ''),
    alpn: splitCsv(params.get('alpn')).join(','),
    transportType: '',
    path: '',
    host: '',
    serviceName: '',
    congestionControl: normalizeName(params.get('congestion_control') || ''),
    udpRelayMode: normalizeName(params.get('udp_relay_mode') || ''),
    rawUri: line,
    supportsUdp: true,
    requiresUdp: true,
    original: { format: 'tuic-uri', name: normalizeName(name || '') },
  };
}

function buildUriNode({ source, protocol, name, url, params, username, password, rawUri }) {
  const host = normalizeName(url.hostname || '');
  const transportType = normalizeName(params.get('type') || params.get('network') || '');
  const node = {
    id: `${source.id || 'source'}-${nodesafe(name)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name: normalizeName(name),
    protocol,
    server: host,
    port: toInt(url.port, null),
    username: normalizeName(username || ''),
    password: decodeURIComponent(password || ''),
    uuid: normalizeName(username || ''),
    method: normalizeName(params.get('encryption') || params.get('cipher') || ''),
    security: normalizeName(params.get('security') || ''),
    tlsEnabled:
      params.get('security') === 'tls' ||
      params.get('security') === 'reality' ||
      params.get('tls') === '1' ||
      params.get('tls') === 'true',
    allowInsecure:
      params.get('allowInsecure') === '1' ||
      params.get('allowInsecure') === 'true' ||
      params.get('insecure') === '1' ||
      params.get('insecure') === 'true',
    sni: normalizeName(params.get('sni') || params.get('peer') || ''),
    alpn: splitCsv(params.get('alpn')).join(','),
    transportType,
    path: normalizeName(params.get('path') || ''),
    host: normalizeName(params.get('host') || params.get('authority') || ''),
    serviceName: normalizeName(params.get('serviceName') || params.get('service-name') || ''),
    fingerprint: normalizeName(params.get('fp') || params.get('fingerprint') || ''),
    flow: normalizeName(params.get('flow') || ''),
    packetEncoding: normalizeName(params.get('packet-encoding') || ''),
    rawUri,
    supportsUdp: inferSupportsUdp(protocol),
    requiresUdp: inferRequiresUdp(protocol),
    original: { format: 'uri', name: normalizeName(name || '') },
  };
  return node;
}

function inferSupportsUdp(protocol) {
  const p = normalizeName(protocol).toLowerCase();
  if (!p) return false;
  if (p === 'http') return false;
  if (p === 'socks') return true;
  if (p === 'shadowsocks') return true;
  if (p === 'vmess' || p === 'vless' || p === 'trojan') return true;
  if (p === 'hysteria2' || p === 'tuic') return true;
  return false;
}

function inferRequiresUdp(protocol) {
  const p = normalizeName(protocol).toLowerCase();
  return p === 'hysteria2' || p === 'tuic';
}

function nodesafe(value) {
  return normalizeName(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'node';
}
