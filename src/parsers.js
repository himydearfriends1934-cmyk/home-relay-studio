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
const URI_HINTS = new Set(['uri', 'v2rayn', 'v2rayng']);
const CLASH_HINTS = new Set(['clash', 'shadowrocket', 'throne', 'sfi', 'sfa', 'sfm']);

export function parseSubscriptionContent(text, source = {}) {
  const cleaned = trimBom(text);
  const hint = normalizeName(source.formatHint || 'auto').toLowerCase();
  const result = parseNestedContent(cleaned, source, 0, hint);
  const nodes = [];
  const warnings = [...(result.warnings || [])];
  for (const node of result.nodes || []) {
    const reason = invalidNodeReason(node);
    if (reason) {
      warnings.push(`Skipped invalid node "${node.name || node.protocol || 'unnamed'}": ${reason}.`);
    } else {
      nodes.push(node);
    }
  }
  return { ...result, nodes, warnings };
}

function invalidNodeReason(node) {
  if (!node.server) return 'missing server';
  if (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535) return 'invalid port';
  if ((node.protocol === 'vmess' || node.protocol === 'vless') && !node.uuid) return 'missing UUID';
  if ((node.protocol === 'trojan' || node.protocol === 'hysteria2') && !node.password) return 'missing password';
  if (node.protocol === 'shadowsocks' && (!node.method || !node.password)) return 'missing cipher or password';
  if (node.protocol === 'tuic' && (!node.uuid || !node.password)) return 'missing UUID or password';
  return '';
}

function parseNestedContent(text, source, depth, hint = 'auto') {
  if (depth > 4) {
    return {
      format: 'unknown',
      nodes: [],
      warnings: ['Subscription looks nested too deeply.'],
      errors: [],
    };
  }

  if (looksLikeBase64(text) && !text.includes('://')) {
    const decoded = decodeLooseBase64(text);
    if (decoded && decoded !== text) {
      const nested = parseNestedContent(decoded, source, depth + 1, hint);
      if (nested.nodes.length || nested.warnings.length) {
        nested.format = nested.format === 'unknown' ? 'base64->' + nested.format : `base64->${nested.format}`;
        nested.warnings = ['Decoded base64 payload.'].concat(nested.warnings || []);
        return nested;
      }
    }
  }

  const structured = parseStructuredByHint(text, source, hint);
  if (structured.nodes.length || structured.warnings.length) return structured;

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
  const reality = isPlainObject(tls.reality) ? tls.reality : {};
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
    security: reality.enabled ? 'reality' : normalizeName(outbound.security || ''),
    alterId: toInt(outbound.alter_id, 0) ?? 0,
    flow: normalizeName(outbound.flow || ''),
    packetEncoding: normalizeName(outbound.packet_encoding || ''),
    plugin: normalizeName(outbound.plugin || ''),
    pluginOptions: String(outbound.plugin_opts ?? ''),
    pluginOpts: parsePluginOptions(outbound.plugin_opts),
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
    realityPublicKey: normalizeName(reality.public_key || ''),
    realityShortId: normalizeName(reality.short_id || ''),
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
  const protocol = type === 'socks5' ? 'socks' : type === 'ss' ? 'shadowsocks' : type;
  if (!SOURCE_NODE_PROTOCOLS.has(protocol)) return null;
  const transportType = normalizeName(proxy.network || '');
  const wsOpts = proxy['ws-opts'] || {};
  const httpOpts = proxy['http-opts'] || {};
  const h2Opts = proxy['h2-opts'] || {};
  const grpcOpts = proxy['grpc-opts'] || {};
  const realityOpts = proxy['reality-opts'] || {};
  const tls = Boolean(proxy.tls);
  const transportPath =
    firstText(wsOpts.path) ||
    firstText(h2Opts.path) ||
    firstText(httpOpts.path) ||
    firstText(proxy.path) ||
    firstText(proxy['ws-path']);
  const transportHost =
    firstText(wsOpts.headers?.Host || wsOpts.headers?.host) ||
    firstText(h2Opts.host) ||
    firstText(httpOpts.headers?.Host || httpOpts.headers?.host) ||
    firstText(proxy.host) ||
    firstText(proxy['ws-headers']?.Host || proxy['ws-headers']?.host);
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
    security: Object.keys(realityOpts).length > 0 ? 'reality' : normalizeName(proxy.security || ''),
    alterId: toInt(proxy.alterId ?? proxy['alter-id'], 0) ?? 0,
    flow: normalizeName(proxy.flow || ''),
    packetEncoding: normalizeName(proxy['packet-encoding'] || ''),
    plugin: normalizeName(proxy.plugin || ''),
    pluginOptions: stringifyPluginOptions(proxy['plugin-opts']),
    pluginOpts: isPlainObject(proxy['plugin-opts']) ? structuredClone(proxy['plugin-opts']) : {},
    tlsEnabled: tls || ['trojan', 'hysteria2', 'tuic'].includes(protocol),
    allowInsecure: Boolean(proxy['skip-cert-verify'] || proxy.insecure),
    sni: normalizeName(proxy.servername || proxy.sni || ''),
    alpn: Array.isArray(proxy.alpn) ? proxy.alpn.map(normalizeName).filter(Boolean).join(',') : normalizeName(proxy.alpn || ''),
    transportType,
    path: normalizeName(transportPath),
    host: normalizeName(transportHost),
    serviceName: normalizeName(grpcOpts['grpc-service-name'] || proxy['grpc-service-name'] || ''),
    congestionControl: normalizeName(proxy['congestion-control'] || ''),
    udpRelayMode: normalizeName(proxy['udp-relay-mode'] || ''),
    obfs: normalizeName(proxy.obfs || ''),
    obfsPassword: String(proxy['obfs-password'] ?? ''),
    upMbps: toInt(proxy['up-mbps'], null),
    downMbps: toInt(proxy['down-mbps'], null),
    fingerprint: normalizeName(proxy['client-fingerprint'] || proxy.fingerprint || proxy.fp || ''),
    realityPublicKey: normalizeName(realityOpts['public-key'] || proxy.pbk || ''),
    realityShortId: normalizeName(realityOpts['short-id'] || proxy.sid || ''),
    transportOptions: compactTransportOptions(proxy),
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
    try {
      const node = parseUriLine(line, source);
      if (node) {
        nodes.push(node);
      } else if (line.includes('://')) {
        warnings.push(`Skipped unsupported URI scheme in line: ${line.slice(0, 32)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Skipped malformed proxy URI (${line.slice(0, 20)}…): ${message}`);
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
  const hashName = hashIndex >= 0 ? decodeURIComponent(raw.slice(hashIndex + 1)) : '';
  const decoded = decodeLooseBase64(withoutHash) || withoutHash;
  const json = safeJsonParse(decoded);
  if (!json || !isPlainObject(json)) return null;
  const server = normalizeName(json.add || json.server || '');
  const name = normalizeName(hashName || json.ps || 'vmess');
  return {
    id: `${source.id || 'source'}-${nodesafe(name)}`,
    sourceId: source.id || '',
    sourceName: normalizeName(source.name || ''),
    name,
    protocol: 'vmess',
    server,
    port: toInt(json.port, null),
    uuid: normalizeName(json.id || ''),
    method: normalizeName(json.scy || json.security || 'auto'),
    security: normalizeName(json.scy || json.security || 'auto'),
    alterId: toInt(json.aid ?? json.alterId, 0) ?? 0,
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
    original: { format: 'vmess-uri', name },
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
  const node = buildUriNode({
    source,
    protocol: 'trojan',
    name,
    url,
    params,
    username: '',
    password: url.username || url.password,
    rawUri: line,
  });
  // Trojan uses TLS by design; many valid share links omit the redundant security=tls query.
  node.tlsEnabled = true;
  return node;
}

function parseSsUri(line, source) {
  const raw = line.slice(line.indexOf('://') + 3);
  const hashIndex = raw.indexOf('#');
  const name = decodeURIComponent(hashIndex >= 0 ? raw.slice(hashIndex + 1) : 'ss');
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf('?');
  const authority = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);
  let method = '';
  let password = '';
  let host = '';
  let port = null;
  const decodedLegacy = !authority.includes('@') ? decodeLooseBase64(authority) : '';

  if (decodedLegacy && decodedLegacy.includes('@')) {
    const at = decodedLegacy.lastIndexOf('@');
    const credentials = decodedLegacy.slice(0, at);
    const endpoint = splitHostPort(decodedLegacy.slice(at + 1));
    [method, password] = credentials.split(/:(.+)/);
    host = endpoint.host;
    port = endpoint.port;
  } else {
    const url = new URL(line);
    const username = decodeURIComponent(url.username || '');
    host = url.hostname;
    port = toInt(url.port, null);
    if (username.includes(':')) {
      [method, password] = username.split(/:(.+)/);
    } else {
      const decoded = decodeLooseBase64(username);
      if (decoded && decoded.includes(':')) {
        [method, password] = decoded.split(/:(.+)/);
      } else if (url.password) {
        method = username;
        password = decodeURIComponent(url.password);
      }
    }
  }

  const pluginSpec = parsePluginSpec(params.get('plugin') || '');
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
    plugin: pluginSpec.plugin,
    pluginOptions: pluginSpec.pluginOptions,
    pluginOpts: pluginSpec.pluginOpts,
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
      plugin: pluginSpec.plugin,
      pluginOptions: pluginSpec.pluginOptions,
    },
    supportsUdp: inferSupportsUdp('shadowsocks'),
    requiresUdp: inferRequiresUdp('shadowsocks'),
    original: { format: 'ss-uri', name: normalizeName(name || '') },
  };
}

function parseStructuredJson(json, source) {
  if (isPlainObject(json)) {
    if (Array.isArray(json.outbounds)) {
      const singBox = parseSingBoxObject(json, source);
      if (singBox.nodes.length || singBox.warnings.length) return singBox;
    }
    if (Array.isArray(json.proxies)) {
      const clash = parseClashObject(json, source);
      if (clash.nodes.length || clash.warnings.length) return clash;
    }
  }
  if (Array.isArray(json)) {
    const clash = parseClashObject({ proxies: json }, source);
    if (clash.nodes.length || clash.warnings.length) return clash;
  }
  return { format: 'json', nodes: [], warnings: [], errors: [] };
}

function parseStructuredYaml(yamlObject, source) {
  if (isPlainObject(yamlObject) && Array.isArray(yamlObject.outbounds)) {
    const singBox = parseSingBoxObject(yamlObject, source);
    if (singBox.nodes.length || singBox.warnings.length) return singBox;
  }
  const clash = parseClashObject(yamlObject, source);
  if (clash.nodes.length || clash.warnings.length) return clash;
  return { format: 'yaml', nodes: [], warnings: [], errors: [] };
}

function parseStructuredByHint(text, source, hint) {
  const strategies = getStructuredStrategies(hint);
  let fallback = null;
  for (const strategy of strategies) {
    const result = strategy(text, source);
    if (result.nodes.length) return result;
    if (!fallback && result.warnings.length) fallback = result;
  }
  return fallback || { format: 'unknown', nodes: [], warnings: [], errors: [] };
}

function getStructuredStrategies(hint) {
  if (URI_HINTS.has(hint)) {
    return [parseUriList, parseJsonText, parseYamlText];
  }
  if (CLASH_HINTS.has(hint) || hint === 'sing-box' || hint === 'json' || hint === 'auto') {
    return [parseJsonText, parseYamlText, parseUriList];
  }
  if (hint === 'yaml') {
    return [parseYamlText, parseJsonText, parseUriList];
  }
  return [parseJsonText, parseYamlText, parseUriList];
}

function parseJsonText(text, source) {
  const json = safeJsonParse(text);
  if (json === null) return { format: 'json', nodes: [], warnings: [], errors: [] };
  return parseStructuredJson(json, source);
}

function parseYamlText(text, source) {
  const yamlObject = parseYamlObject(text);
  if (!yamlObject) return { format: 'yaml', nodes: [], warnings: [], errors: [] };
  return parseStructuredYaml(yamlObject, source);
}

function firstText(value) {
  if (Array.isArray(value)) return normalizeName(value.find((item) => normalizeName(item)) || '');
  return normalizeName(value || '');
}

function compactTransportOptions(proxy) {
  const result = {};
  for (const key of ['ws-opts', 'http-opts', 'h2-opts', 'grpc-opts', 'xhttp-opts']) {
    if (isPlainObject(proxy[key])) result[key] = structuredClone(proxy[key]);
  }
  return result;
}

function parsePluginSpec(value) {
  const parts = String(value ?? '').split(';').map((part) => part.trim()).filter(Boolean);
  const plugin = normalizeName(parts.shift() || '');
  const pluginOptions = parts.join(';');
  return { plugin, pluginOptions, pluginOpts: parsePluginOptions(pluginOptions) };
}

function parsePluginOptions(value) {
  if (isPlainObject(value)) return structuredClone(value);
  const options = {};
  for (const part of String(value ?? '').split(';').map((item) => item.trim()).filter(Boolean)) {
    const separator = part.indexOf('=');
    if (separator < 0) options[part] = true;
    else options[part.slice(0, separator)] = part.slice(separator + 1);
  }
  return options;
}

function stringifyPluginOptions(value) {
  if (!isPlainObject(value)) return String(value ?? '');
  return Object.entries(value)
    .filter(([, option]) => option !== undefined && option !== null && option !== false && option !== '')
    .map(([key, option]) => (option === true ? key : `${key}=${option}`))
    .join(';');
}

function parseSocksUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'socks');
  const node = buildUriNode({
    source,
    protocol: 'socks',
    name,
    url,
    params: url.searchParams,
    username: url.username,
    password: url.password,
    rawUri: line,
  });
  if (!node.port) node.port = 1080;
  return node;
}

function parseHttpUri(line, source) {
  const url = new URL(line);
  const name = decodeURIComponent(url.hash.slice(1) || 'http');
  const node = buildUriNode({
    source,
    protocol: 'http',
    name,
    url,
    params: url.searchParams,
    username: url.username,
    password: url.password,
    rawUri: line,
  });
  if (url.protocol === 'https:') node.tlsEnabled = true;
  if (!node.port) node.port = url.protocol === 'https:' ? 443 : 80;
  return node;
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
    username: normalizeName(decodeURIComponent(username || '')),
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
    realityPublicKey: normalizeName(params.get('pbk') || params.get('public-key') || ''),
    realityShortId: normalizeName(params.get('sid') || params.get('short-id') || ''),
    realitySpiderX: normalizeName(params.get('spx') || ''),
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
