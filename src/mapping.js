import { escapeRegExp, normalizeName, sanitizeTag, uniqueBy } from './utils.js';

export function buildAssignments(state, parsedSources) {
  const egressById = new Map(state.egresses.map((egress) => [egress.id, egress]));
  const defaultEgressId = state.export?.defaultEgressId || state.egresses.find((egress) => egress.enabled)?.id || '';
  const rules = [...state.rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority);

  const assignments = [];
  const warnings = [];

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
        assignments.push({
          sourceId: bundle.source.id,
          sourceName: bundle.source.name,
          node,
          egress,
          egressId: targetId,
          tag: createAssignmentTag(bundle.source.name, node.name, egress.name, targetId),
        });
      }
    }
  }

  return {
    assignments,
    warnings,
  };
}

export function resolveNodeTargets(node, source, rules, defaultEgressId, egressById) {
  let targets = [];
  for (const rule of rules) {
    if (!ruleMatchesNode(rule, node, source)) continue;
    if (rule.targetMode === 'replace') {
      targets = rule.targets.slice();
    } else {
      targets = targets.concat(rule.targets);
    }
    if (rule.stop) break;
  }

  targets = uniqueBy(targets.filter((id) => egressById.has(id)), (id) => id);
  if (targets.length === 0 && defaultEgressId && egressById.has(defaultEgressId)) {
    targets = [defaultEgressId];
  }
  return targets;
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
