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
