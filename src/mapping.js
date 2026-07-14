import { SOURCE_NODE_PROTOCOLS } from './constants.js';
import { escapeRegExp, normalizeName, sanitizeTag, uniqueBy } from './utils.js';

export function buildAssignments(state, parsedSources) {
  const warnings = [];
  const enabledEgresses = state.egresses.filter((egress) => egress.enabled);
  const usableEgresses = enabledEgresses.filter((egress) => {
    const reason = invalidEgressReason(egress);
    if (reason) {
      warnings.push({
        type: 'invalid-egress',
        egressName: egress.name,
        message: `Egress "${egress.name}" was skipped: ${reason}.`,
      });
      return false;
    }
    return true;
  });
  const egressById = new Map(usableEgresses.map((egress) => [egress.id, egress]));
  const configuredDefault = state.export?.defaultEgressId || '';
  const defaultEgressId = configuredDefault
    ? egressById.has(configuredDefault)
      ? configuredDefault
      : ''
    : usableEgresses[0]?.id || '';
  if (configuredDefault && !defaultEgressId) {
    warnings.push({
      type: 'default-egress-unavailable',
      message: 'The configured default egress is unavailable; automatic fallback was blocked to prevent a wrong exit.',
    });
  }
  const rules = [...state.rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority);
  warnings.push(...findRuleProtocolOverlaps(rules, parsedSources));

  const assignments = [];
  const usedTags = new Set();

  for (const bundle of parsedSources) {
    for (const node of bundle.nodes) {
      const targets = resolveNodeTargets(node, bundle.source, rules, defaultEgressId, egressById);
      if (targets.length === 0) {
        warnings.push({
          type: 'unassigned-node',
          nodeName: node.name,
          sourceName: bundle.source.name,
          message: `Node "${node.name}" was not assigned to any egress.`,
        });
        continue;
      }
      for (const targetId of targets) {
        const egress = egressById.get(targetId);
        if (!egress) continue;
        const baseTag = createAssignmentTag(bundle.source.name, node.name, egress.name, targetId);
        let tag = baseTag;
        let suffix = 2;
        while (usedTags.has(tag)) {
          tag = sanitizeTag(`${baseTag}-${suffix}`);
          suffix += 1;
        }
        usedTags.add(tag);
        assignments.push({
          sourceId: bundle.source.id,
          sourceName: bundle.source.name,
          node,
          egress,
          egressId: targetId,
          tag,
        });
      }
    }
  }

  return {
    assignments,
    warnings,
  };
}

function invalidEgressReason(egress) {
  if (egress.protocol === 'direct') return '';
  if (!egress.server) return 'missing server';
  if (!Number.isInteger(egress.port) || egress.port < 1 || egress.port > 65535) return 'invalid port';
  if ((egress.protocol === 'vmess' || egress.protocol === 'vless') && !egress.uuid) return 'missing UUID';
  if ((egress.protocol === 'trojan' || egress.protocol === 'hysteria2') && !egress.password) return 'missing password';
  if (egress.protocol === 'shadowsocks' && (!egress.method || !egress.password)) return 'missing cipher or password';
  if (egress.protocol === 'tuic' && (!egress.uuid || !egress.password)) return 'missing UUID or password';
  return '';
}

export function resolveNodeTargets(node, source, rules, defaultEgressId, egressById) {
  let targets = [];
  let matchedExplicitTargets = false;
  const sourceHasScopedTargetRule = rules.some((rule) => ruleTargetsSource(rule, source));
  for (const rule of rules) {
    if (!ruleMatchesNode(rule, node, source)) continue;
    if (rule.targets.length > 0) matchedExplicitTargets = true;
    if (rule.targetMode === 'replace') {
      targets = rule.targets.slice();
    } else {
      targets = targets.concat(rule.targets);
    }
    if (rule.stop) break;
  }

  targets = uniqueBy(targets.filter((id) => egressById.has(id)), (id) => id);
  if (
    targets.length === 0 &&
    !matchedExplicitTargets &&
    !sourceHasScopedTargetRule &&
    defaultEgressId &&
    egressById.has(defaultEgressId)
  ) {
    targets = [defaultEgressId];
  }
  return targets;
}

function ruleTargetsSource(rule, source) {
  if (!rule.enabled || !Array.isArray(rule.targets) || rule.targets.length === 0) return false;
  const sourceIds = Array.isArray(rule.match?.sourceIds) ? rule.match.sourceIds : [];
  return sourceIds.length === 0 || sourceIds.includes(source.id);
}

function findRuleProtocolOverlaps(rules, parsedSources) {
  const warnings = [];
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const first = rules[i];
      const second = rules[j];
      if (!Array.isArray(first.targets) || first.targets.length === 0) continue;
      if (!Array.isArray(second.targets) || second.targets.length === 0) continue;
      const sourceIds = overlappingSourceIds(first, second, parsedSources);
      if (sourceIds.length === 0) continue;
      const protocols = overlappingProtocols(first, second);
      if (protocols.length === 0) continue;
      warnings.push({
        type: 'rule-protocol-overlap',
        ruleName: first.name,
        message: `Rules "${first.name}" and "${second.name}" both select ${formatProtocolList(protocols)} for overlapping sources. Put multiple target egresses in one rule if you intentionally want duplicate output.`,
      });
    }
  }
  return warnings;
}

function overlappingSourceIds(first, second, parsedSources) {
  const allSourceIds = parsedSources.map((bundle) => bundle.source.id).filter(Boolean);
  const firstIds = Array.isArray(first.match?.sourceIds) && first.match.sourceIds.length > 0
    ? first.match.sourceIds
    : allSourceIds;
  const secondIds = Array.isArray(second.match?.sourceIds) && second.match.sourceIds.length > 0
    ? second.match.sourceIds
    : allSourceIds;
  return firstIds.filter((id) => secondIds.includes(id));
}

function overlappingProtocols(first, second) {
  const allProtocols = Array.from(SOURCE_NODE_PROTOCOLS);
  const firstProtocols = Array.isArray(first.match?.protocols) && first.match.protocols.length > 0
    ? first.match.protocols
    : allProtocols;
  const secondProtocols = Array.isArray(second.match?.protocols) && second.match.protocols.length > 0
    ? second.match.protocols
    : allProtocols;
  return firstProtocols.filter((protocol) => secondProtocols.includes(protocol));
}

function formatProtocolList(protocols) {
  if (protocols.length > 3) return `${protocols.slice(0, 3).join(', ')} and ${protocols.length - 3} more protocols`;
  return protocols.join(', ');
}

export function ruleMatchesNode(rule, node, source) {
  if (!rule.enabled) return false;
  const match = rule.match || {};
  if (Array.isArray(match.sourceIds) && match.sourceIds.length > 0 && !match.sourceIds.includes(source.id)) {
    return false;
  }
  if (Array.isArray(match.protocols) && match.protocols.length > 0) {
    const protocol = normalizeName(node.protocol).toLowerCase();
    if (!match.protocols.includes(protocol)) return false;
  }
  if (match.sourceNameRegex) {
    if (!safeRegexTest(match.sourceNameRegex, source.name)) return false;
  }
  if (match.nodeNameRegex) {
    if (!safeRegexTest(match.nodeNameRegex, node.name)) return false;
  }
  return true;
}

export function createAssignmentTag(sourceName, nodeName, egressName, egressId) {
  return sanitizeTag(`${sourceName}-${nodeName}-${egressName}-${egressId}`);
}

function safeRegexTest(pattern, value) {
  try {
    return new RegExp(pattern, 'i').test(String(value ?? ''));
  } catch {
    return false;
  }
}
