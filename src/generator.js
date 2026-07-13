import { DEFAULT_HEALTHCHECK_URL } from './constants.js';
import { buildAssignments } from './mapping.js';
import {
  deepClone,
  normalizeName,
  sanitizeTag,
  splitCsv,
  uniqueBy,
} from './utils.js';

export function generateSingBoxConfig(state, parsedSources) {
  const assignmentsResult = buildAssignments(state, parsedSources);
  const { assignments } = assignmentsResult;
  const outbounds = [];
  const egressTags = new Map();
  const nodeTagsBySource = new Map();
  const nodeTagsByEgress = new Map();
  let finalTag = 'direct';

  for (const egress of state.egresses.filter((item) => item.enabled)) {
    const tag = sanitizeTag(`egress-${egress.id}`);
    egressTags.set(egress.id, tag);
    outbounds.push(buildEgressOutbound(egress, tag));
  }

  for (const assignment of assignments) {
    const egressTag = egressTags.get(assignment.egressId);
    if (!egressTag) continue;
    const tag = assignment.tag;
    const outbound = buildProxyOutbound(assignment.node, tag, egressTag);
    outbounds.push(outbound);

    if (!nodeTagsBySource.has(assignment.sourceId)) nodeTagsBySource.set(assignment.sourceId, []);
    nodeTagsBySource.get(assignment.sourceId).push(tag);

    if (!nodeTagsByEgress.has(assignment.egressId)) nodeTagsByEgress.set(assignment.egressId, []);
    nodeTagsByEgress.get(assignment.egressId).push(tag);
  }

  if (state.export?.includeSelectors !== false && assignments.length > 0) {
    const sourceSelectorTags = [];
    const egressSelectorTags = [];

    for (const [sourceId, tags] of nodeTagsBySource.entries()) {
      const source = state.sources.find((item) => item.id === sourceId);
      if (!source || tags.length === 0) continue;
      const tag = sanitizeTag(`source-${source.id}`);
      sourceSelectorTags.push(tag);
      outbounds.push({
        type: 'selector',
        tag,
        outbounds: uniqueBy(tags, (value) => value),
        default: tags[0],
      });
    }

    for (const [egressId, tags] of nodeTagsByEgress.entries()) {
      const egress = state.egresses.find((item) => item.id === egressId);
      if (!egress || tags.length === 0) continue;
      const tag = sanitizeTag(`auto-${egress.id}`);
      egressSelectorTags.push(tag);
      outbounds.push({
        type: 'urltest',
        tag,
        outbounds: uniqueBy(tags, (value) => value),
        url: state.export?.healthcheckUrl || DEFAULT_HEALTHCHECK_URL,
        interval: state.export?.autoInterval || '5m',
      });
    }

    const mainTag = state.export?.selectorTag || 'relay-main';
    const autoTag = state.export?.urlTestTag || 'relay-auto';
    const mainCandidates = uniqueBy(egressSelectorTags, (value) => value);
    if (state.export?.includeUrlTest !== false && mainCandidates.length > 0) {
      outbounds.push({
        type: 'urltest',
        tag: autoTag,
        outbounds: mainCandidates,
        url: state.export?.healthcheckUrl || DEFAULT_HEALTHCHECK_URL,
        interval: state.export?.autoInterval || '5m',
      });
      outbounds.push({
        type: 'selector',
        tag: mainTag,
        outbounds: uniqueBy([autoTag].concat(mainCandidates), (value) => value),
        default: autoTag,
      });
      finalTag = mainTag;
    } else {
      outbounds.push({
        type: 'selector',
        tag: mainTag,
        outbounds: mainCandidates,
        default: mainCandidates[0] || '',
      });
      finalTag = mainTag;
    }

    if (sourceSelectorTags.length > 0) {
      outbounds.push({
        type: 'selector',
        tag: sanitizeTag('relay-sources'),
        outbounds: sourceSelectorTags,
        default: sourceSelectorTags[0],
      });
    }
  }

  outbounds.push({ type: 'direct', tag: 'direct' });
  outbounds.push({ type: 'block', tag: 'block' });

  const config = {
    log: { level: 'info' },
    inbounds: [],
    outbounds,
    route: {},
  };

  if (state.export?.includeInbound !== false) {
    config.inbounds.push({
      type: 'mixed',
      tag: state.export?.inboundTag || 'mixed-in',
      listen: state.export?.inboundListen || '127.0.0.1',
      listen_port: state.export?.inboundPort || 1080,
    });
  }

  config.route.final = finalTag;

  return {
    config,
    assignments,
    assignmentWarnings: assignmentsResult.warnings,
    counts: {
      sources: state.sources.length,
      egresses: state.egresses.length,
      rules: state.rules.length,
      nodes: assignments.length,
      outbounds: outbounds.length,
    },
  };
}

export function generateNormalizedSnapshot(state, parsedSources) {
  const assignmentsResult = buildAssignments(state, parsedSources);
  return {
    state: deepClone(state),
    parsedSources,
    assignments: assignmentsResult.assignments,
    warnings: assignmentsResult.warnings,
  };
}

function buildEgressOutbound(egress, tag) {
  const base = {
    tag,
    detour: undefined,
  };
  switch (egress.protocol) {
    case 'direct':
      return {
        ...base,
        type: 'direct',
        bind_interface: egress.bindInterface || undefined,
        routing_mark: egress.routingMark || undefined,
      };
    case 'http':
      return {
        ...base,
        type: 'http',
        server: egress.server,
        server_port: egress.port,
        username: egress.username || undefined,
        password: egress.password || undefined,
        tls: egress.tlsEnabled
          ? {
              enabled: true,
              server_name: egress.sni || undefined,
              insecure: Boolean(egress.allowInsecure),
            }
          : undefined,
      };
    case 'socks':
      return {
        ...base,
        type: 'socks',
        version: '5',
        server: egress.server,
        server_port: egress.port,
        username: egress.username || undefined,
        password: egress.password || undefined,
      };
    case 'shadowsocks':
      return {
        ...base,
        type: 'shadowsocks',
        server: egress.server,
        server_port: egress.port,
        method: egress.method || undefined,
        password: egress.password || undefined,
      };
    case 'vmess':
      return {
        ...base,
        type: 'vmess',
        server: egress.server,
        server_port: egress.port,
        uuid: egress.uuid || undefined,
        security: egress.security || 'auto',
        tls: buildTlsConfig(egress),
        transport: buildTransportConfig(egress),
      };
    case 'vless':
      return {
        ...base,
        type: 'vless',
        server: egress.server,
        server_port: egress.port,
        uuid: egress.uuid || undefined,
        flow: egress.flow || undefined,
        tls: buildTlsConfig(egress),
        transport: buildTransportConfig(egress),
        packet_encoding: egress.packetEncoding || undefined,
      };
    case 'trojan':
      return {
        ...base,
        type: 'trojan',
        server: egress.server,
        server_port: egress.port,
        password: egress.password || undefined,
        tls: buildTlsConfig(egress),
        transport: buildTransportConfig(egress),
      };
    case 'hysteria2':
      return {
        ...base,
        type: 'hysteria2',
        server: egress.server,
        server_port: egress.port,
        password: egress.password || undefined,
        tls: buildTlsConfig(egress),
        up_mbps: egress.upMbps ?? undefined,
        down_mbps: egress.downMbps ?? undefined,
        obfs: egress.obfs
          ? {
              type: egress.obfs,
              password: egress.obfsPassword || undefined,
            }
          : undefined,
      };
    case 'tuic':
      return {
        ...base,
        type: 'tuic',
        server: egress.server,
        server_port: egress.port,
        uuid: egress.uuid || undefined,
        password: egress.password || undefined,
        congestion_control: egress.congestionControl || undefined,
        udp_relay_mode: egress.udpRelayMode || undefined,
        tls: buildTlsConfig(egress),
      };
    default:
      return {
        ...base,
        type: 'direct',
      };
  }
}

function buildProxyOutbound(node, tag, detourTag) {
  if (node.rawSingBoxOutbound) {
    const clone = deepClone(node.rawSingBoxOutbound);
    clone.tag = tag;
    clone.detour = detourTag;
    return clone;
  }

  const outbound = {
    tag,
    detour: detourTag,
    type: node.protocol,
    server: node.server || undefined,
    server_port: node.port || undefined,
  };

  switch (node.protocol) {
    case 'http':
      outbound.username = node.username || undefined;
      outbound.password = node.password || undefined;
      outbound.tls = buildTlsConfig(node);
      break;
    case 'socks':
      outbound.version = '5';
      outbound.username = node.username || undefined;
      outbound.password = node.password || undefined;
      break;
    case 'shadowsocks':
      outbound.method = node.method || undefined;
      outbound.password = node.password || undefined;
      break;
    case 'vmess':
      outbound.uuid = node.uuid || undefined;
      outbound.security = node.security || 'auto';
      outbound.tls = buildTlsConfig(node);
      outbound.transport = buildTransportConfig(node);
      break;
    case 'vless':
      outbound.uuid = node.uuid || undefined;
      outbound.flow = node.flow || undefined;
      outbound.packet_encoding = node.packetEncoding || undefined;
      outbound.tls = buildTlsConfig(node);
      outbound.transport = buildTransportConfig(node);
      break;
    case 'trojan':
      outbound.password = node.password || undefined;
      outbound.tls = buildTlsConfig(node);
      outbound.transport = buildTransportConfig(node);
      break;
    case 'hysteria2':
      outbound.password = node.password || undefined;
      outbound.tls = buildTlsConfig(node);
      outbound.up_mbps = node.upMbps ?? undefined;
      outbound.down_mbps = node.downMbps ?? undefined;
      outbound.obfs = node.obfs
        ? { type: node.obfs, password: node.obfsPassword || undefined }
        : undefined;
      break;
    case 'tuic':
      outbound.uuid = node.uuid || undefined;
      outbound.password = node.password || undefined;
      outbound.congestion_control = node.congestionControl || undefined;
      outbound.udp_relay_mode = node.udpRelayMode || undefined;
      outbound.tls = buildTlsConfig(node);
      break;
    default:
      break;
  }

  return outbound;
}

function buildTlsConfig(item) {
  if (!item.tlsEnabled && !item.allowInsecure && !item.sni && !item.fingerprint) {
    return undefined;
  }
  const tls = {
    enabled: true,
  };
  if (item.sni) tls.server_name = item.sni;
  if (item.allowInsecure) tls.insecure = true;
  if (item.alpn) tls.alpn = splitCsv(item.alpn);
  if (item.fingerprint) tls.utls = { enabled: true, fingerprint: item.fingerprint };
  return tls;
}

function buildTransportConfig(item) {
  const type = normalizeName(item.transportType || '').toLowerCase();
  if (!type) return undefined;
  switch (type) {
    case 'ws':
      return {
        type: 'ws',
        path: item.path || '/',
        headers: item.host ? { Host: item.host } : undefined,
      };
    case 'grpc':
      return {
        type: 'grpc',
        service_name: item.serviceName || item.path || '',
      };
    case 'http':
      return {
        type: 'http',
        path: item.path || '/',
        headers: item.host ? { Host: item.host } : undefined,
      };
    case 'quic':
      return {
        type: 'quic',
      };
    default:
      return {
        type,
      };
  }
}
