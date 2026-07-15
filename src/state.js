import { createId, deepClone, normalizeName, sanitizeTag, toInt } from './utils.js';

export function createDefaultState() {
  return {
    version: 1,
    projectName: 'Home Relay Studio',
    sources: [],
    egresses: [],
    rules: [],
    export: {
      nameTemplate: '{egressName} - {nodeName}',
      includeSelectors: true,
      includeUrlTest: true,
      includeInbound: true,
      inboundTag: 'mixed-in',
      inboundListen: '127.0.0.1',
      inboundPort: 1080,
      defaultEgressId: '',
      selectorTag: 'relay-main',
      urlTestTag: 'relay-auto',
      healthcheckUrl: 'https://www.gstatic.com/generate_204',
      autoInterval: '5m',
      routeOutputs: [],
    },
  };
}

export function normalizeState(input) {
  const state = deepClone(input ?? createDefaultState());
  state.version = 1;
  state.projectName = normalizeName(state.projectName) || 'Home Relay Studio';

  state.sources = Array.isArray(state.sources) ? state.sources : [];
  state.egresses = Array.isArray(state.egresses) ? state.egresses : [];
  state.rules = Array.isArray(state.rules) ? state.rules : [];

  state.export = {
    ...createDefaultState().export,
    ...(state.export ?? {}),
  };
  state.export.nameTemplate = normalizeName(state.export.nameTemplate) || '{egressName} - {nodeName}';
  if (
    state.export.nameTemplate === '{sourceName} via {egressName}' ||
    state.export.nameTemplate === '{nodeName} via {egressName}'
  ) {
    state.export.nameTemplate = '{egressName} - {nodeName}';
  }
  state.export.includeSelectors = Boolean(state.export.includeSelectors);
  state.export.includeUrlTest = Boolean(state.export.includeUrlTest);
  state.export.includeInbound = Boolean(state.export.includeInbound);
  state.export.inboundTag = sanitizeTag(state.export.inboundTag || 'mixed-in');
  state.export.inboundListen = normalizeName(state.export.inboundListen) || '127.0.0.1';
  state.export.inboundPort = toInt(state.export.inboundPort, 1080) ?? 1080;
  state.export.defaultEgressId = normalizeName(state.export.defaultEgressId || '');
  state.export.selectorTag = sanitizeTag(state.export.selectorTag || 'relay-main');
  state.export.urlTestTag = sanitizeTag(state.export.urlTestTag || 'relay-auto');
  state.export.healthcheckUrl = normalizeName(state.export.healthcheckUrl) || 'https://www.gstatic.com/generate_204';
  state.export.autoInterval = normalizeName(state.export.autoInterval) || '5m';
  state.export.routeOutputs = Array.isArray(state.export.routeOutputs)
    ? state.export.routeOutputs.map(normalizeRouteOutput)
    : [];

  state.sources = state.sources.map((source, index) => normalizeSource(source, index));
  state.egresses = state.egresses.map((egress, index) => normalizeEgress(egress, index));
  state.rules = state.rules.map((rule, index) => normalizeRule(rule, index));

  if (state.sources.length === 0) {
    state.sources = [];
  }
  if (state.egresses.length === 0) {
    state.egresses = [];
  }

  return state;
}

export function normalizeSource(source, index = 0) {
  const item = { ...(source ?? {}) };
  item.id = item.id || createId('src');
  item.name = normalizeName(item.name) || `Source ${index + 1}`;
  item.kind = item.kind === 'text' ? 'text' : 'url';
  item.url = normalizeName(item.url || '');
  item.sameVps = Boolean(item.sameVps);
  item.localUrl = normalizeName(item.localUrl || '');
  item.content = String(item.content ?? '');
  item.formatHint = normalizeName(item.formatHint || 'auto').toLowerCase() || 'auto';
  item.enabled = item.enabled !== false;
  item.notes = normalizeName(item.notes || '');
  item.headersJson = String(item.headersJson ?? '');
  return item;
}

function normalizeRouteOutput(output) {
  const item = { ...(output ?? {}) };
  item.key = normalizeName(item.key || '');
  item.index = toInt(item.index, 0) ?? 0;
  item.title = normalizeName(item.title || '');
  item.ruleId = normalizeName(item.ruleId || '');
  item.ruleName = normalizeName(item.ruleName || '');
  item.sourceNames = Array.isArray(item.sourceNames)
    ? item.sourceNames.map((value) => normalizeName(value)).filter(Boolean)
    : [];
  item.egressNames = Array.isArray(item.egressNames)
    ? item.egressNames.map((value) => normalizeName(value)).filter(Boolean)
    : [];
  item.protocols = Array.isArray(item.protocols)
    ? item.protocols.map((value) => normalizeName(value).toLowerCase()).filter(Boolean)
    : [];
  item.nodeCount = toInt(item.nodeCount, 0) ?? 0;
  item.linkCount = toInt(item.linkCount, item.links?.length || 0) ?? 0;
  item.links = Array.isArray(item.links)
    ? item.links.map(normalizeRouteOutputLink).filter(Boolean)
    : [];
  item.code = String(item.code ?? '');
  item.updatedAt = normalizeName(item.updatedAt || '');
  return item;
}

function normalizeRouteOutputLink(link) {
  if (!link || typeof link !== 'object') return null;
  const item = { ...(link ?? {}) };
  item.index = toInt(item.index, 0) ?? 0;
  item.displayName = normalizeName(item.displayName || '');
  item.label = normalizeName(item.label || item.displayName || '');
  item.protocol = normalizeName(item.protocol || '').toLowerCase();
  item.protocolLabel = normalizeName(item.protocolLabel || '');
  item.sourceName = normalizeName(item.sourceName || '');
  item.egressName = normalizeName(item.egressName || '');
  item.ruleName = normalizeName(item.ruleName || '');
  item.tag = normalizeName(item.tag || '');
  item.uri = String(item.uri ?? '').trim();
  return item;
}

export function normalizeEgress(egress, index = 0) {
  const item = { ...(egress ?? {}) };
  item.id = item.id || createId('eg');
  item.name = normalizeName(item.name) || `Egress ${index + 1}`;
  item.protocol = normalizeName(item.protocol || 'socks').toLowerCase();
  item.enabled = item.enabled !== false;
  item.server = normalizeName(item.server || '');
  item.port = toInt(item.port, null);
  item.username = normalizeName(item.username || '');
  item.password = String(item.password ?? '');
  item.uuid = normalizeName(item.uuid || '');
  item.method = normalizeName(item.method || '');
  item.plugin = normalizeName(item.plugin || '');
  item.pluginOptions = String(item.pluginOptions ?? '');
  item.security = normalizeName(item.security || '');
  item.alterId = toInt(item.alterId, 0) ?? 0;
  item.flow = normalizeName(item.flow || '');
  item.packetEncoding = normalizeName(item.packetEncoding || '');
  item.tlsEnabled =
    ['trojan', 'hysteria2', 'tuic'].includes(item.protocol) || ['tls', 'reality'].includes(item.security)
      ? true
      : Boolean(item.tlsEnabled);
  item.sni = normalizeName(item.sni || '');
  item.allowInsecure = Boolean(item.allowInsecure);
  item.network = normalizeName(item.network || '');
  item.transportType = normalizeName(item.transportType || '');
  item.path = normalizeName(item.path || '');
  item.host = normalizeName(item.host || '');
  item.serviceName = normalizeName(item.serviceName || '');
  item.alpn = normalizeName(item.alpn || '');
  item.fingerprint = normalizeName(item.fingerprint || '');
  item.realityPublicKey = normalizeName(item.realityPublicKey || '');
  item.realityShortId = normalizeName(item.realityShortId || '');
  item.realitySpiderX = normalizeName(item.realitySpiderX || '');
  item.congestionControl = normalizeName(item.congestionControl || '');
  item.udpRelayMode = normalizeName(item.udpRelayMode || '');
  item.obfs = normalizeName(item.obfs || '');
  item.obfsPassword = String(item.obfsPassword ?? '');
  item.bindInterface = normalizeName(item.bindInterface || '');
  item.routingMark = normalizeName(item.routingMark || '');
  item.upMbps = toInt(item.upMbps, null);
  item.downMbps = toInt(item.downMbps, null);
  item.tags = Array.isArray(item.tags)
    ? item.tags.map((tag) => normalizeName(tag)).filter(Boolean)
    : [];
  item.notes = normalizeName(item.notes || '');
  return item;
}

export function normalizeRule(rule, index = 0) {
  const item = { ...(rule ?? {}) };
  item.id = item.id || createId('rule');
  item.name = normalizeName(item.name) || `Rule ${index + 1}`;
  item.enabled = item.enabled !== false;
  item.priority = toInt(item.priority, 0) ?? 0;
  item.targetMode = item.targetMode === 'replace' ? 'replace' : 'append';
  item.stop = Boolean(item.stop);
  item.match = {
    sourceIds: Array.isArray(item.match?.sourceIds) ? item.match.sourceIds.map(normalizeName).filter(Boolean) : [],
    sourceNameRegex: normalizeName(item.match?.sourceNameRegex || ''),
    nodeNameRegex: normalizeName(item.match?.nodeNameRegex || ''),
    nodeIds: Array.isArray(item.match?.nodeIds)
      ? item.match.nodeIds.map(normalizeName).filter(Boolean)
      : [],
    protocols: Array.isArray(item.match?.protocols)
      ? item.match.protocols.map((value) => normalizeName(value).toLowerCase()).filter(Boolean)
      : [],
  };
  item.targets = Array.isArray(item.targets) ? item.targets.map(normalizeName).filter(Boolean) : [];
  item.notes = normalizeName(item.notes || '');
  return item;
}
