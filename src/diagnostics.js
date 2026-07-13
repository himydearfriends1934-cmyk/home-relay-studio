import net from 'node:net';
import { DEFAULT_HEALTHCHECK_URL } from './constants.js';
import { buildAssignments, ruleMatchesNode } from './mapping.js';
import { parseSubscriptionContent } from './parsers.js';
import { normalizeName, toInt } from './utils.js';

export async function diagnoseState(state, loader) {
  const load = loader || defaultLoader;
  const sourceReports = [];
  const parsedSources = [];
  const warnings = [];
  const errors = [];

  for (const source of state.sources.filter((item) => item.enabled)) {
    try {
      const content = await load(source);
      const parsed = parseSubscriptionContent(content, source);
      parsedSources.push({
        source,
        ...parsed,
      });
      sourceReports.push({
        sourceId: source.id,
        sourceName: source.name,
        format: parsed.format,
        nodes: parsed.nodes.length,
        warnings: parsed.warnings,
        errors: parsed.errors,
      });
      warnings.push(...parsed.warnings.map((message) => ({ type: 'source-warning', sourceId: source.id, message })));
      errors.push(...parsed.errors.map((message) => ({ type: 'source-error', sourceId: source.id, message })));
    } catch (error) {
      sourceReports.push({
        sourceId: source.id,
        sourceName: source.name,
        format: 'error',
        nodes: 0,
        warnings: [],
        errors: [error instanceof Error ? error.message : String(error)],
      });
      errors.push({
        type: 'source-fetch-error',
        sourceId: source.id,
        message: `Failed to load source "${source.name}".`,
      });
    }
  }

  const assignmentResult = buildAssignments(state, parsedSources);
  const assignmentWarnings = assignmentResult.warnings.map((item) => ({
    type: item.type,
    message: item.message,
    sourceName: item.sourceName,
    nodeName: item.nodeName,
  }));
  warnings.push(...assignmentWarnings);

  const ruleCoverage = state.rules.map((rule) => ({
    ruleId: rule.id,
    ruleName: rule.name,
    enabled: rule.enabled,
    matches: parsedSources.reduce((count, bundle) => {
      return count + bundle.nodes.filter((node) => ruleMatchesNode(rule, node, bundle.source)).length;
    }, 0),
  }));

  const egressChecks = [];
  for (const egress of state.egresses.filter((item) => item.enabled)) {
    const endpoint = makeEndpoint(egress);
    const transportWarnings = [];
    if (egress.protocol === 'http') {
      transportWarnings.push('HTTP egress cannot carry UDP.');
    }
    if (egress.protocol === 'direct' && egress.bindInterface) {
      transportWarnings.push(`Direct egress is bound to ${egress.bindInterface}.`);
    }
    const tcp = endpoint.host && endpoint.port ? await checkTcpEndpoint(endpoint.host, endpoint.port, 2500) : null;
    const report = {
      egressId: egress.id,
      egressName: egress.name,
      protocol: egress.protocol,
      endpoint,
      tcp,
      warnings: transportWarnings,
    };
    egressChecks.push(report);
    warnings.push(...transportWarnings.map((message) => ({ type: 'egress-warning', egressId: egress.id, message })));
    if (tcp && tcp.status !== 'open') {
      errors.push({
        type: 'egress-port',
        egressId: egress.id,
        message: `Port check failed for ${egress.name}: ${tcp.status}.`,
      });
    }
  }

  const chainChecks = assignmentResult.assignments.map((assignment) => {
    const node = assignment.node;
    const egress = assignment.egress;
    const issues = [];
    if (node.requiresUdp && egress.protocol === 'http') {
      issues.push('This chain requires UDP, but the selected egress is HTTP.');
    }
    if (node.requiresUdp && !node.supportsUdp) {
      issues.push('The source node itself does not look UDP-capable.');
    }
    if (node.protocol === 'http') {
      issues.push('Source protocol is HTTP and will not carry UDP.');
    }
    return {
      tag: assignment.tag,
      sourceName: assignment.sourceName,
      nodeName: node.name,
      egressName: egress.name,
      issues,
    };
  });

  return {
    summary: {
      sources: parsedSources.length,
      assignments: assignmentResult.assignments.length,
      warnings: warnings.length,
      errors: errors.length,
      healthcheckUrl: state.export?.healthcheckUrl || DEFAULT_HEALTHCHECK_URL,
    },
    sourceReports,
    ruleCoverage,
    egressChecks,
    chainChecks,
    warnings,
    errors,
  };
}

async function defaultLoader(source) {
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

function makeEndpoint(egress) {
  return {
    host: normalizeName(egress.server || ''),
    port: toInt(egress.port, null),
  };
}

async function checkTcpEndpoint(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ status: 'open' }));
    socket.once('timeout', () => done({ status: 'timeout' }));
    socket.once('error', (error) => {
      done({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
