import { Buffer } from 'node:buffer';
import yaml from 'js-yaml';
import { DEFAULT_HEALTHCHECK_URL } from './constants.js';
import { generateSingBoxConfig } from './generator.js';
import { normalizeName, sanitizeTag, splitCsv, uniqueBy } from './utils.js';

export const CLIENT_EXPORTS = [
  {
    id: 'sing-box',
    aliases: ['singbox'],
    filename: 'sing-box.config.json',
    contentType: 'application/json; charset=utf-8',
  },
  {
    id: 'clash',
    aliases: ['clash-meta', 'mihomo'],
    filename: 'clash.yaml',
    contentType: 'text/yaml; charset=utf-8',
  },
  {
    id: 'v2ray',
    aliases: ['v2rayn', 'v2rayng', 'uri'],
    filename: 'v2ray-subscription.txt',
    contentType: 'text/plain; charset=utf-8',
  },
  {
    id: 'shadowrocket',
    aliases: ['rocket'],
    filename: 'shadowrocket-subscription.txt',
    contentType: 'text/plain; charset=utf-8',
  },
];

export function resolveClientExportId(format) {
  const normalized = normalizeName(format).toLowerCase();
  const match = CLIENT_EXPORTS.find((item) => item.id === normalized || item.aliases.includes(normalized));
  return match?.id || '';
}

export function getClientExport(format, state, parsedSources) {
  const id = resolveClientExportId(format);
  if (!id) return null;
  const singBox = generateSingBoxConfig(state, parsedSources);
  const meta = CLIENT_EXPORTS.find((item) => item.id === id);

  if (id === 'sing-box') {
    return {
      ...meta,
      body: JSON.stringify(singBox.config, null, 2),
    };
  }

  if (id === 'clash') {
    return {
      ...meta,
      body: yaml.dump(generateClashConfig(state, singBox.assignments), {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
      }),
    };
  }

  const uriText = generateUriSubscription(state, singBox.assignments).join('\n');
  return {
    ...meta,
    body: Buffer.from(uriText, 'utf8').toString('base64'),
  };
}

export function generateClashConfig(state, assignments) {
  const usedNames = new Set();
  const proxies = [];
  const groups = [];
  const egressTags = new Map();
  const sourceGroups = [];
  const egressAutoGroups = [];
  const nodeTagsBySource = new Map();
  const nodeTagsByEgress = new Map();

  for (const egress of state.egresses.filter((item) => item.enabled)) {
    const tag = makeUniqueName(`egress-${egress.name || egress.id}`, usedNames);
    egressTags.set(egress.id, egress.protocol === 'direct' ? 'DIRECT' : tag);
    if (egress.protocol !== 'direct') {
      proxies.push(buildClashProxy(egress, tag));
    }
  }

  for (const assignment of assignments) {
    const egressTag = egressTags.get(assignment.egressId);
    if (!egressTag) continue;
    const displayName = formatAssignmentName(assignment, state.export?.nameTemplate);
    const tag = makeUniqueName(displayName, usedNames);
    proxies.push(buildClashProxy(assignment.node, tag, egressTag === 'DIRECT' ? '' : egressTag));

    if (!nodeTagsBySource.has(assignment.sourceId)) nodeTagsBySource.set(assignment.sourceId, []);
    nodeTagsBySource.get(assignment.sourceId).push(tag);

    if (!nodeTagsByEgress.has(assignment.egressId)) nodeTagsByEgress.set(assignment.egressId, []);
    nodeTagsByEgress.get(assignment.egressId).push(tag);
  }

  for (const [sourceId, tags] of nodeTagsBySource.entries()) {
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source || tags.length === 0) continue;
    const name = makeUniqueName(`source-${source.name || source.id}`, usedNames);
    sourceGroups.push(name);
    groups.push({
      name,
      type: 'select',
      proxies: uniqueBy(tags, (value) => value),
    });
  }

  for (const [egressId, tags] of nodeTagsByEgress.entries()) {
    const egress = state.egresses.find((item) => item.id === egressId);
    if (!egress || tags.length === 0) continue;
    const name = makeUniqueName(`auto-${egress.name || egress.id}`, usedNames);
    egressAutoGroups.push(name);
    groups.push({
      name,
      type: 'url-test',
      proxies: uniqueBy(tags, (value) => value),
      url: state.export?.healthcheckUrl || DEFAULT_HEALTHCHECK_URL,
      interval: toClashInterval(state.export?.autoInterval || '5m'),
    });
  }

  const mainTag = state.export?.selectorTag || 'relay-main';
  const autoTag = state.export?.urlTestTag || 'relay-auto';
  const mainCandidates = uniqueBy(egressAutoGroups, (value) => value);

  if (sourceGroups.length > 0) {
    groups.push({
      name: 'relay-sources',
      type: 'select',
      proxies: sourceGroups,
    });
  }

  if (mainCandidates.length > 0 && state.export?.includeUrlTest !== false) {
    groups.push({
      name: autoTag,
      type: 'url-test',
      proxies: mainCandidates,
      url: state.export?.healthcheckUrl || DEFAULT_HEALTHCHECK_URL,
      interval: toClashInterval(state.export?.autoInterval || '5m'),
    });
  }

  groups.push({
    name: mainTag,
    type: 'select',
    proxies: uniqueBy(
      [
        state.export?.includeUrlTest !== false && mainCandidates.length > 0 ? autoTag : '',
        ...mainCandidates,
        sourceGroups.length > 0 ? 'relay-sources' : '',
        ...Array.from(egressTags.values()).filter((value) => value && value !== 'DIRECT'),
        'DIRECT',
      ].filter(Boolean),
      (value) => value,
    ),
  });

  return compactObject({
    port: undefined,
    'socks-port': undefined,
    'mixed-port': state.export?.includeInbound !== false ? state.export?.inboundPort || 1080 : undefined,
    mode: 'rule',
    proxies,
    'proxy-groups': groups,
    rules: [`MATCH,${mainTag}`],
  });
}

export function generateUriSubscription(state, assignments) {
  const lines = [];
  const seen = new Set();
  for (const assignment of assignments) {
    const uri = buildUri({
      ...assignment.node,
      name: formatAssignmentName(assignment, state.export?.nameTemplate),
    });
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    lines.push(uri);
  }
  return lines;
}

export function formatAssignmentName(assignment, template = '{sourceName} via {egressName}') {
  const values = {
    sourceName: assignment.sourceName || assignment.source?.name || '',
    nodeName: assignment.node?.name || '',
    egressName: assignment.egress?.name || '',
    protocol: assignment.node?.protocol || '',
  };
  const formatted = String(template || '{nodeName} via {egressName}').replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => {
    return values[key] ?? '';
  });
  return normalizeName(formatted) || normalizeName(`${values.nodeName} via ${values.egressName}`) || 'relay-node';
}

function buildClashProxy(item, name, dialerProxy = '') {
  const common = {
    name,
    server: item.server || undefined,
    port: item.port || undefined,
    udp: item.protocol !== 'http' ? true : undefined,
    'dialer-proxy': dialerProxy || undefined,
  };

  switch (item.protocol) {
    case 'http':
      return compactObject({
        ...common,
        type: 'http',
        username: item.username || undefined,
        password: item.password || undefined,
        tls: item.tlsEnabled || undefined,
        sni: item.sni || undefined,
        'skip-cert-verify': item.allowInsecure || undefined,
      });
    case 'socks':
      return compactObject({
        ...common,
        type: 'socks5',
        username: item.username || undefined,
        password: item.password || undefined,
      });
    case 'shadowsocks':
      return compactObject({
        ...common,
        type: 'ss',
        cipher: item.method || undefined,
        password: item.password || undefined,
      });
    case 'vmess':
      return compactObject({
        ...common,
        type: 'vmess',
        uuid: item.uuid || undefined,
        alterId: item.alterId ?? 0,
        cipher: item.security || 'auto',
        tls: item.tlsEnabled || undefined,
        servername: item.sni || undefined,
        'skip-cert-verify': item.allowInsecure || undefined,
        network: clashNetwork(item.transportType),
        ...clashTransportOptions(item),
      });
    case 'vless':
      return compactObject({
        ...common,
        type: 'vless',
        uuid: item.uuid || undefined,
        flow: item.flow || undefined,
        tls: item.tlsEnabled || undefined,
        servername: item.sni || undefined,
        'skip-cert-verify': item.allowInsecure || undefined,
        network: clashNetwork(item.transportType),
        ...clashTransportOptions(item),
      });
    case 'trojan':
      return compactObject({
        ...common,
        type: 'trojan',
        password: item.password || undefined,
        sni: item.sni || undefined,
        'skip-cert-verify': item.allowInsecure || undefined,
        network: clashNetwork(item.transportType),
        ...clashTransportOptions(item),
      });
    case 'hysteria2':
      return compactObject({
        ...common,
        type: 'hysteria2',
        password: item.password || undefined,
        sni: item.sni || undefined,
        'skip-cert-verify': item.allowInsecure || undefined,
        obfs: item.obfs || undefined,
        'obfs-password': item.obfsPassword || undefined,
      });
    case 'tuic':
      return compactObject({
        ...common,
        type: 'tuic',
        uuid: item.uuid || undefined,
        password: item.password || undefined,
        sni: item.sni || undefined,
        'skip-cert-verify': item.allowInsecure || undefined,
        'congestion-controller': item.congestionControl || undefined,
        'udp-relay-mode': item.udpRelayMode || undefined,
      });
    default:
      return compactObject({
        ...common,
        type: 'direct',
      });
  }
}

function clashNetwork(value) {
  const network = normalizeName(value).toLowerCase();
  if (network === 'ws' || network === 'grpc' || network === 'http' || network === 'h2') return network;
  return undefined;
}

function clashTransportOptions(item) {
  const network = clashNetwork(item.transportType);
  if (network === 'ws') {
    return {
      'ws-opts': compactObject({
        path: item.path || '/',
        headers: item.host ? { Host: item.host } : undefined,
      }),
    };
  }
  if (network === 'grpc') {
    return {
      'grpc-opts': compactObject({
        'grpc-service-name': item.serviceName || item.path || undefined,
      }),
    };
  }
  if (network === 'http' || network === 'h2') {
    return {
      'h2-opts': compactObject({
        path: item.path ? [item.path] : undefined,
        host: item.host ? [item.host] : undefined,
      }),
    };
  }
  return {};
}

function buildUri(node) {
  if (!node.server || !node.port) return '';
  switch (node.protocol) {
    case 'vmess':
      return buildVmessUri(node);
    case 'vless':
      return buildStandardProxyUri('vless', node, node.uuid, buildCommonParams(node));
    case 'trojan':
      return buildStandardProxyUri('trojan', node, node.password, buildCommonParams(node));
    case 'shadowsocks':
      return buildShadowsocksUri(node);
    case 'socks':
      return buildAuthProxyUri('socks5', node);
    case 'http':
      return buildAuthProxyUri('http', node);
    case 'hysteria2':
      return buildStandardProxyUri('hysteria2', node, node.password, buildHysteria2Params(node));
    case 'tuic':
      return buildStandardProxyUri('tuic', node, [node.uuid, node.password], buildTuicParams(node));
    default:
      return '';
  }
}

function buildVmessUri(node) {
  const payload = {
    v: '2',
    ps: node.name,
    add: node.server,
    port: String(node.port),
    id: node.uuid,
    aid: String(node.alterId ?? 0),
    scy: node.security || 'auto',
    net: node.transportType || 'tcp',
    type: 'none',
    host: node.host || '',
    path: node.path || '',
    tls: node.tlsEnabled ? 'tls' : '',
    sni: node.sni || '',
    fp: node.fingerprint || '',
  };
  return `vmess://${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
}

function buildStandardProxyUri(scheme, node, userInfo, params) {
  if (!userInfo || (Array.isArray(userInfo) && userInfo.every((part) => !normalizeName(part)))) return '';
  const query = params.toString();
  return `${scheme}://${formatUserInfo(userInfo)}@${formatHost(node.server)}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`;
}

function buildAuthProxyUri(scheme, node) {
  const auth =
    node.username || node.password
      ? `${encodeURIComponent(node.username || '')}:${encodeURIComponent(node.password || '')}@`
      : '';
  return `${scheme}://${auth}${formatHost(node.server)}:${node.port}#${encodeURIComponent(node.name)}`;
}

function buildShadowsocksUri(node) {
  if (!node.method || !node.password) return '';
  const encoded = base64Url(`${node.method}:${node.password}`);
  return `ss://${encoded}@${formatHost(node.server)}:${node.port}#${encodeURIComponent(node.name)}`;
}

function buildCommonParams(node) {
  const params = new URLSearchParams();
  if (node.protocol === 'vless') params.set('encryption', node.method || 'none');
  if (node.tlsEnabled) params.set('security', 'tls');
  if (node.sni) params.set('sni', node.sni);
  if (node.allowInsecure) params.set('allowInsecure', '1');
  if (node.fingerprint) params.set('fp', node.fingerprint);
  if (node.transportType) params.set('type', node.transportType);
  if (node.path) params.set('path', node.path);
  if (node.host) params.set('host', node.host);
  if (node.serviceName) params.set('serviceName', node.serviceName);
  if (node.alpn) params.set('alpn', splitCsv(node.alpn).join(','));
  if (node.flow) params.set('flow', node.flow);
  return params;
}

function buildHysteria2Params(node) {
  const params = new URLSearchParams();
  if (node.sni) params.set('sni', node.sni);
  if (node.allowInsecure) params.set('insecure', '1');
  if (node.obfs) params.set('obfs', node.obfs);
  if (node.obfsPassword) params.set('obfs-password', node.obfsPassword);
  if (node.alpn) params.set('alpn', splitCsv(node.alpn).join(','));
  return params;
}

function buildTuicParams(node) {
  const params = new URLSearchParams();
  if (node.sni) params.set('sni', node.sni);
  if (node.allowInsecure) params.set('allow_insecure', '1');
  if (node.congestionControl) params.set('congestion_control', node.congestionControl);
  if (node.udpRelayMode) params.set('udp_relay_mode', node.udpRelayMode);
  if (node.alpn) params.set('alpn', splitCsv(node.alpn).join(','));
  return params;
}

function makeUniqueName(value, used) {
  const base = normalizeName(value).slice(0, 88) || 'relay-item';
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function toClashInterval(value) {
  const text = normalizeName(value).toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/^(\d+)(s|m|h)$/);
  if (!match) return 300;
  const amount = Number(match[1]);
  if (match[2] === 'h') return amount * 3600;
  if (match[2] === 'm') return amount * 60;
  return amount;
}

function formatUserInfo(value) {
  if (Array.isArray(value)) {
    return value.map((item) => encodeURIComponent(String(item ?? ''))).join(':');
  }
  return encodeURIComponent(String(value ?? ''));
}

function base64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function formatHost(value) {
  const host = normalizeName(value);
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const compacted = compactObject(child);
    if (compacted === undefined || compacted === '' || compacted === null) continue;
    if (Array.isArray(compacted) && compacted.length === 0) continue;
    if (typeof compacted === 'object' && !Array.isArray(compacted) && Object.keys(compacted).length === 0) continue;
    result[key] = compacted;
  }
  return result;
}
