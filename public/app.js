const root = document.getElementById('app');

const PROTOCOL_OPTIONS = ['http', 'socks', 'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'];
const PROTOCOL_LABELS = {
  http: 'HTTP',
  socks: 'SOCKS5',
  shadowsocks: 'Shadowsocks',
  vmess: 'VMess',
  vless: 'VLESS',
  trojan: 'Trojan',
  hysteria2: 'Hysteria2',
  tuic: 'TUIC',
};
const SOURCE_KIND_OPTIONS = ['url', 'text'];
const FORMAT_OPTIONS = ['auto', 'sing-box', 'clash', 'uri', 'json', 'yaml'];
const TARGET_MODE_OPTIONS = ['append', 'replace'];
const ROUTE_COLORS = ['#0f766e', '#b45309', '#2563eb', '#be123c', '#7c3aed', '#15803d', '#c2410c', '#0369a1'];
const EXPORT_FORMATS = [
  { id: 'shadowrocket', label: 'Shadowrocket' },
  { id: 'sing-box', label: 'Sing-box' },
  { id: 'clash', label: 'Clash' },
  { id: 'v2ray', label: 'V2RayN' },
];
const EXPORT_VIEWS = [
  { id: 'qr', label: '二维码' },
  { id: 'link', label: '订阅链接' },
];

const CLICK_FEEDBACK_SELECTOR = 'button, .button-link, summary, [data-route-set], [data-select-collection], [data-output-view], [data-view]';
const IMPORT_RENDER_DELAY_MS = 300;
const EMPTY_NODE_SELECTION = '__none__';

const ui = {
  mode: 'config',
  generated: null,
  diagnosis: null,
  previews: {},
  sourceTests: {},
  autoTestingSources: new Set(),
  exportFormat: 'shadowrocket',
  exportView: 'qr',
  activeItems: {
    sources: '',
    egresses: '',
    rules: '',
  },
  upgrade: {
    running: false,
    result: null,
    error: '',
  },
  saveTimer: null,
  saveChain: Promise.resolve(),
  editRevision: 0,
  saveStatus: 'saved',
  saveError: '',
  preflight: {
    running: false,
    error: '',
  },
  routeCopySheet: null,
  openDetails: new Set(),
  actionFeedbackTimer: null,
};

let state = null;
let runtime = { publicBaseUrl: '', subscriptionToken: '' };

await boot();

async function boot() {
  [state, runtime] = await Promise.all([api('/api/state'), api('/api/runtime')]);
  renderShell();
  wireEvents();
  renderEditors();
  renderOutput();
  renderUpgradePanel();
}

function renderShell() {
  root.innerHTML = `
    <div class="shell">
      <section class="topbar">
        <div class="title-block">
          <h1>Home Relay Studio</h1>
          <div class="subtle">配置订阅来源、家庭出口和分流规则。</div>
          <input class="project-name" data-path="projectName" value="${escapeHtml(state.projectName)}" />
        </div>
        <div class="top-actions">
          <span class="save-status" id="save-status" data-status="saved">已自动保存</span>
          <button class="primary" data-action="generate">生成 / 预检</button>
          <button data-action="upgrade-now">一键更新</button>
          <details class="tools-menu">
            <summary>工具</summary>
            <div class="tools-popover">
              <button data-action="save">立即保存</button>
              <button data-action="diagnose">运行诊断</button>
            </div>
          </details>
        </div>
      </section>

      <section class="upgrade-strip is-hidden" id="upgrade-panel"></section>

      <section class="route-set-panel" id="route-set-panel"></section>
      <div class="action-feedback" id="action-feedback" aria-live="polite" role="status"></div>
      <div id="route-copy-sheet"></div>

      <div class="config-grid">
        <section class="band config-section" data-collection="sources">
          <div class="section-head">
            <div class="section-title-block">
              <h2>Sources <span class="section-count" id="source-count">0</span></h2>
              <div class="meta">订阅来源</div>
            </div>
            <button class="add-button" data-action="add-source" aria-label="Add source">＋ 添加</button>
          </div>
          <div class="entity-list" id="source-list"></div>
        </section>

        <section class="band config-section" data-collection="egresses">
          <div class="section-head">
            <div class="section-title-block">
              <h2>Egresses <span class="section-count" id="egress-count">0</span></h2>
              <div class="meta">家庭出口</div>
            </div>
            <button class="add-button" data-action="add-egress" aria-label="Add egress">＋ 添加</button>
          </div>
          <div class="entity-list" id="egress-list"></div>
        </section>

        <section class="band config-section" data-collection="rules">
          <div class="section-head">
            <div class="section-title-block">
              <h2>Rules <span class="section-count" id="rule-count">0</span></h2>
              <div class="meta">来源到出口的分流映射</div>
            </div>
            <button class="add-button" data-action="add-rule" aria-label="Add rule">＋ 添加</button>
          </div>
          <div class="entity-list" id="rule-list"></div>
        </section>
      </div>

    </div>
  `;
}

function renderEditors() {
  renderRouteSetPanel();
  renderCollection('sources');
  renderCollection('egresses');
  renderCollection('rules');
  const exportGrid = root.querySelector('#export-grid');
  if (exportGrid) exportGrid.innerHTML = renderExportGrid();
  renderRouteCopySheet();
  updateCounts();
}

function renderRouteSetPanel() {
  const panel = root.querySelector('#route-set-panel');
  if (!panel) return;
  const sets = getRouteSets();
  const outputMap = getRouteOutputMap();
  const outputs = Array.from(outputMap.values()).filter((output) => output?.code);
  const rows = sets.map((set) => {
    const active =
      (set.sourceIds[0] && ui.activeItems.sources === set.sourceIds[0]) ||
      (set.egressIds[0] && ui.activeItems.egresses === set.egressIds[0]) ||
      (set.ruleId && ui.activeItems.rules === set.ruleId);
    const sourceNames = set.sourceIds
      .map((id) => state.sources.find((item) => item.id === id)?.name || id)
      .join(', ') || 'Any source';
    const egressNames = set.egressIds
      .map((id) => state.egresses.find((item) => item.id === id)?.name || id)
      .join(', ') || 'No egress';
    const output = outputMap.get(set.key);
    const protocols = output?.protocols?.length
      ? output.protocols.map((protocol) => PROTOCOL_LABELS[protocol] || protocol).join(', ')
      : getRouteSetProtocolText(set);
    const outputCode = output?.code || 'Generate to save this route output.';
    const outputLines = outputCode.split('\n').slice(0, 3).join('\n');
    return `
      <tr
        class="route-set-row ${active ? 'active' : ''} ${set.enabled ? '' : 'is-off'}"
        data-route-set="${set.index}"
        style="--route-color:${escapeHtml(set.color)}"
      >
        <td><span class="route-set-index">${set.index + 1}</span></td>
        <td>
          <strong>${escapeHtml(sourceNames)}</strong>
          <div class="muted">${escapeHtml(set.enabled ? 'running' : 'saved')}</div>
        </td>
        <td>${escapeHtml(egressNames)}</td>
        <td>
          <strong>${escapeHtml(set.title)}</strong>
          <div class="muted">${escapeHtml(set.ruleId || 'no rule')}</div>
        </td>
        <td>${escapeHtml(protocols)}</td>
        <td>
          <pre class="route-output-code">${escapeHtml(outputLines)}</pre>
          <div class="muted">${output ? `${formatNodeCount(output.nodeCount)} | saved ${escapeHtml(output.updatedAt || '')}` : 'not generated yet'}</div>
        </td>
        <td>
          ${renderRouteCopyMenu(set, output)}
        </td>
      </tr>
    `;
  }).join('');
  panel.innerHTML = `
    <div class="route-set-head">
      <div>
        <h2>Route Links</h2>
        <div class="meta">Saved source / egress / rule outputs. Click a row to edit that link.</div>
      </div>
      <div class="route-set-actions">
        <button class="primary" data-action="generate">生成 / 预检</button>
        <div class="route-set-count">${sets.length}</div>
      </div>
    </div>
    ${renderRouteSetStatus(outputs)}
    ${rows
      ? `<div class="route-set-table-wrap">
          <table class="route-set-table">
            <thead>
              <tr>
                <th>Link</th>
                <th>Source</th>
                <th>Egress</th>
                <th>Rule</th>
                <th>Protocols</th>
                <th>Output code</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : '<div class="muted">No saved route links yet. Add a source, egress, and rule to create one.</div>'}
  `;
}

function renderRouteSetStatus(outputs) {
  if (ui.preflight.running) {
    return '<div class="route-set-status" data-status="working"><strong>正在生成</strong><span>正在刷新链路输出...</span></div>';
  }
  if (ui.preflight.error) {
    return `
      <div class="route-set-status" data-status="failed">
        <strong>生成失败</strong>
        <span>${escapeHtml(ui.preflight.error)}</span>
        <button data-action="generate">重试</button>
      </div>
    `;
  }
  const count = Array.isArray(outputs) ? outputs.length : 0;
  if (count === 0) return '';
  const nodes = outputs.reduce((total, output) => total + Number(output.nodeCount || 0), 0);
  return `<div class="route-set-status" data-status="done"><strong>已生成</strong><span>${count} 条链路 · ${formatNodeCount(nodes)}</span></div>`;
}

function getRouteSets() {
  const sources = state.sources || [];
  const egresses = state.egresses || [];
  const rules = state.rules || [];
  if (rules.length > 0) {
    return rules.map((rule, index) => {
      const sourceIds = rule.match?.sourceIds?.length
        ? rule.match.sourceIds.filter((id) => sources.some((source) => source.id === id))
        : sources.filter((source) => source.enabled).map((source) => source.id);
      const egressIds = (rule.targets || []).filter((id) => egresses.some((egress) => egress.id === id));
      return {
        index,
        key: `rule:${rule.id}`,
        color: ROUTE_COLORS[index % ROUTE_COLORS.length],
        title: rule.name || `Route ${index + 1}`,
        enabled: rule.enabled,
        ruleId: rule.id,
        ruleName: rule.name || '',
        protocols: rule.match?.protocols || [],
        sourceIds,
        egressIds,
      };
    });
  }
  const count = Math.max(sources.length, egresses.length);
  return Array.from({ length: count }, (_, index) => ({
    index,
    key: `pair:${index}`,
    color: ROUTE_COLORS[index % ROUTE_COLORS.length],
    title: `Route ${index + 1}`,
    enabled: Boolean(sources[index]?.enabled && egresses[index]?.enabled),
    ruleId: '',
    ruleName: '',
    protocols: [],
    sourceIds: sources[index] ? [sources[index].id] : [],
    egressIds: egresses[index] ? [egresses[index].id] : [],
  }));
}

function getRouteOutputMap() {
  const outputs = buildRouteOutputSnapshots(ui.generated);
  if (outputs.length > 0) {
    return new Map(outputs.map((output) => [output.key, output]));
  }
  const savedOutputs = Array.isArray(state.export?.routeOutputs) ? state.export.routeOutputs : [];
  return new Map(savedOutputs.map((output) => [output.key, output]));
}

function getRouteSetProtocolText(set) {
  const protocols = Array.isArray(set.protocols) && set.protocols.length > 0 ? set.protocols : PROTOCOL_OPTIONS;
  return protocols.map((protocol) => PROTOCOL_LABELS[protocol] || protocol).join(', ');
}

function formatNodeCount(count) {
  return `${Number(count || 0)} 个节点`;
}

function buildRouteOutputSnapshots(generated) {
  const assignments = Array.isArray(generated?.assignments) ? generated.assignments : [];
  if (assignments.length === 0) return [];
  const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return getRouteSets().map((set) => {
    const matched = assignments.filter((assignment) => assignmentBelongsToRouteSet(assignment, set));
    const protocols = uniqueStrings(matched.map((assignment) => assignment.node?.protocol || '').filter(Boolean));
    const sourceNames = set.sourceIds.map((id) => state.sources.find((source) => source.id === id)?.name || id);
    const egressNames = set.egressIds.map((id) => state.egresses.find((egress) => egress.id === id)?.name || id);
    const links = matched
      .map((assignment, index) => {
        const protocol = normalizeRouteProtocol(assignment.node?.protocol);
        const label = String(assignment.node?.name || '').trim() || assignment.tag || `Node ${index + 1}`;
        const uri = String(assignment.uri || '').trim();
        return {
          index,
          label,
          protocol,
          protocolLabel: PROTOCOL_LABELS[protocol] || protocol,
          sourceName: assignment.sourceName || sourceNames.join(', ') || '',
          egressName: assignment.egress?.name || egressNames.join(', ') || '',
          ruleName: assignment.ruleName || set.ruleName || '',
          tag: assignment.tag || '',
          uri,
        };
      })
      .filter((link) => link.uri);
    return {
      key: set.key,
      index: set.index,
      title: set.title,
      ruleId: set.ruleId,
      ruleName: set.ruleName || set.title,
      sourceNames,
      egressNames,
      protocols,
      nodeCount: matched.length,
      linkCount: links.length,
      links,
      code: buildRouteOutputCode(set, matched, sourceNames, egressNames),
      updatedAt,
    };
  });
}

function assignmentBelongsToRouteSet(assignment, set) {
  if (set.ruleId) return assignment.ruleId === set.ruleId;
  const sourceMatch = set.sourceIds.length === 0 || set.sourceIds.includes(assignment.sourceId);
  const egressMatch = set.egressIds.length === 0 || set.egressIds.includes(assignment.egressId);
  return sourceMatch && egressMatch;
}

function buildRouteOutputCode(set, assignments, sourceNames, egressNames) {
  const lines = [
    `# Link ${set.index + 1}: ${set.title}`,
    `# Source: ${sourceNames.join(', ') || 'Any source'}`,
    `# Egress: ${egressNames.join(', ') || 'No egress'}`,
    `# Rule: ${set.ruleName || set.ruleId || 'No rule'}`,
  ];
  if (assignments.length === 0) {
    lines.push('# No output nodes generated for this link.');
    return lines.join('\n');
  }
  for (const [index, assignment] of assignments.entries()) {
    lines.push(`${index + 1}. ${assignment.node?.protocol || 'unknown'} | ${assignment.node?.name || 'unnamed'} -> ${assignment.egress?.name || assignment.egressId || 'egress'} | ${assignment.tag}`);
  }
  return lines.join('\n');
}

function renderRouteCopyMenu(set, output) {
  if (!output?.code) return '<button disabled>复制</button>';
  return `<button data-action="open-route-copy-sheet" data-route-set-index="${set.index}" class="primary">复制</button>`;
}

function renderRouteCopySheet() {
  const panel = root.querySelector('#route-copy-sheet');
  if (!panel) return;
  const data = getRouteCopySheetData();
  if (!data) {
    panel.innerHTML = '';
    return;
  }
  const { set, sheet, output } = data;
  const tab = sheet.tab === 'links' ? 'links' : 'subscription';
  const sourceNames = set?.sourceIds?.map((id) => state.sources.find((item) => item.id === id)?.name || id).join(', ') || 'Any source';
  const egressNames = set?.egressIds?.map((id) => state.egresses.find((item) => item.id === id)?.name || id).join(', ') || 'No egress';
  panel.innerHTML = `
    <div class="route-copy-backdrop" data-action="close-route-copy-sheet"></div>
    <section class="route-copy-sheet" role="dialog" aria-modal="true" aria-labelledby="route-copy-sheet-title">
      <div class="route-copy-sheet-head">
        <div>
          <div class="route-copy-sheet-kicker">QrCode</div>
          <h2 id="route-copy-sheet-title">${escapeHtml(set?.title || `Route ${output.index + 1}`)}</h2>
          <div class="meta">${escapeHtml(sourceNames)} · ${escapeHtml(egressNames)}</div>
        </div>
        <button class="route-copy-close" data-action="close-route-copy-sheet" aria-label="关闭">×</button>
      </div>
      <div class="tabs route-copy-sheet-tabs">
        <button data-route-copy-tab="subscription" class="${tab === 'subscription' ? 'active' : ''}">SUBSCRIPTION</button>
        <button data-route-copy-tab="links" class="${tab === 'links' ? 'active' : ''}">LINKS</button>
      </div>
      ${tab === 'subscription'
        ? renderRouteCopySubscriptionTab()
        : renderRouteCopyLinksTab(output)}
    </section>
  `;
}

function renderRouteCopySubscriptionTab() {
  return `
    <div class="route-copy-sheet-body">
      <div class="route-copy-card-grid">
        ${EXPORT_FORMATS.map((meta) => renderRouteCopyQrCard(
          meta,
          meta.id,
          getSubscriptionCardLabel(meta.id),
          getSubscriptionCardHint(meta.id),
        )).join('')}
      </div>
    </div>
  `;
}

function getSubscriptionCardLabel(format) {
  return {
    shadowrocket: 'Subscription',
    'sing-box': 'JSON Subscription',
    clash: 'Clash Subscription',
    v2ray: 'URI Subscription',
  }[format] || 'Subscription';
}

function getSubscriptionCardHint(format) {
  return {
    shadowrocket: 'Shadowrocket 导入',
    'sing-box': 'sing-box JSON',
    clash: 'Clash / Mihomo',
    v2ray: 'V2RayN / V2RayNG',
  }[format] || '订阅链接';
}

function renderRouteCopyQrCard(meta, format, label, hint) {
  const exportUrl = getExportUrl(format);
  const shadowrocketAction = format === 'shadowrocket'
    ? `<a class="button-link primary" href="${escapeHtml(getShadowrocketImportUrl(exportUrl))}">添加到 Shadowrocket</a>`
    : '';
  return `
    <div class="route-copy-card">
      <div class="route-copy-card-label">${escapeHtml(label)}</div>
      <button
        type="button"
        class="route-copy-qr-button"
        data-action="copy-route-link"
        data-route-link="${escapeHtml(exportUrl)}"
        data-route-label="${escapeHtml(meta.label)}"
        aria-label="复制 ${escapeHtml(meta.label)} 链接"
      >
        <img class="qr-image route-copy-qr" src="${escapeHtml(getExportQrUrl(format))}" alt="${escapeHtml(meta.label)} QR" />
      </button>
      <strong class="route-copy-card-title">${escapeHtml(meta.label)}</strong>
      <div class="muted">${escapeHtml(hint)}</div>
      <div class="route-copy-card-actions">
        ${shadowrocketAction}
        <button data-action="copy-export-format-link" data-export-format="${escapeHtml(format)}">复制链接</button>
        <button data-action="open-export-format-link" data-export-format="${escapeHtml(format)}">打开链接</button>
        <a class="button-link" href="${escapeHtml(getExportUrl(format, true))}">下载</a>
      </div>
    </div>
  `;
}

function renderRouteCopyLinksTab(output) {
  const links = Array.isArray(output.links) ? output.links : [];
  const protocolChoices = getRouteCopySheetProtocolChoices(output);
  const selectedProtocols = getRouteCopySheetSelectedProtocols(output);
  const protocolSummary = selectedProtocols.length
    ? selectedProtocols.map((protocol) => PROTOCOL_LABELS[protocol] || protocol).join(', ')
    : '未选择协议';
  let preview = '';
  if (selectedProtocols.length === 0) preview = '请至少选择一个协议。';
  else {
    try {
      preview = filterRouteOutputByProtocols(output.code, selectedProtocols);
    } catch (error) {
      preview = formatActionError(error);
    }
  }
  return `
    <div class="route-copy-sheet-body">
      <div class="route-copy-sheet-summary">
        <strong>${formatNodeCount(links.length || output.nodeCount || 0)}</strong>
        <span class="muted">点击二维码直接复制对应链接</span>
      </div>
      <div class="route-copy-link-list">
        ${links.length > 0
          ? links.map((link) => renderRouteCopyLinkCard(link)).join('')
          : '<div class="route-copy-empty"><span class="muted">当前链路还没有二维码链接。</span><button class="primary" data-action="generate">生成 / 预检</button></div>'}
      </div>
      <details class="route-copy-advanced">
        <summary>协议筛选</summary>
        <div class="route-copy-advanced-body">
          <div class="route-copy-toolbar">
            <button data-action="copy-route-output" data-route-set-index="${output.index}" data-copy-mode="links">复制全部链接</button>
            <button data-action="copy-route-output" data-route-set-index="${output.index}" data-copy-mode="nodes">复制节点列表</button>
            <button class="primary" data-action="copy-route-output" data-route-set-index="${output.index}" data-copy-mode="protocols">复制所选协议</button>
          </div>
          <div class="route-copy-protocol-head">
            <div>
              <strong>协议选择</strong>
              <div class="muted">${escapeHtml(protocolSummary)}</div>
            </div>
            <button data-action="reset-route-copy-protocols" data-route-set-index="${output.index}">恢复默认</button>
          </div>
          <div class="protocol-check-list route-copy-protocol-list">
            ${protocolChoices.map((protocol) => {
              const checked = selectedProtocols.includes(protocol);
              const count = getRouteOutputProtocolCounts(output.code).get(normalizeRouteProtocol(protocol)) || 0;
              return `
                <label class="protocol-check-item ${checked ? 'checked' : ''}">
                  <input data-route-copy-protocol="${escapeHtml(protocol)}" type="checkbox" ${checked ? 'checked' : ''} />
                  <span class="protocol-check-name">${escapeHtml(PROTOCOL_LABELS[protocol] || protocol)}</span>
                  <small>${count} 个节点</small>
                </label>
              `;
            }).join('')}
          </div>
          <label class="field wide route-copy-preview">
            <span>输出预览</span>
            <textarea class="code" readonly>${escapeHtml(preview)}</textarea>
          </label>
        </div>
      </details>
    </div>
  `;
}

function renderRouteCopyLinkCard(link) {
  const label = link.label || link.displayName || 'Node';
  const protocolLabel = link.protocolLabel || PROTOCOL_LABELS[link.protocol] || link.protocol || '';
  const subtitle = [protocolLabel, link.egressName || link.ruleName || ''].filter(Boolean).join(' · ');
  return `
    <div class="route-copy-card route-copy-node-card">
      <div class="route-copy-card-label">${escapeHtml(label)}</div>
      <button
        type="button"
        class="route-copy-qr-button"
        data-action="copy-route-link"
        data-route-link="${escapeHtml(link.uri)}"
        data-route-label="${escapeHtml(label)}"
        aria-label="复制 ${escapeHtml(label)} 链接"
      >
        <img class="qr-image route-copy-qr" src="${escapeHtml(getTextQrUrl(link.uri))}" alt="${escapeHtml(label)} QR" />
      </button>
      <strong class="route-copy-card-title">${escapeHtml(protocolLabel || 'Link')}</strong>
      <div class="muted">${escapeHtml(subtitle)}</div>
    </div>
  `;
}

function getRouteCopySheetData() {
  const sheet = ui.routeCopySheet;
  if (!sheet) return null;
  const output = getRouteOutputByIndex(sheet.index);
  if (!output?.code) return null;
  const set = getRouteSets().find((item) => item.index === sheet.index) || null;
  return { sheet, output, set };
}

function getRouteCopySheetProtocolChoices(output) {
  const choices = Array.isArray(output.protocols) && output.protocols.length ? output.protocols : PROTOCOL_OPTIONS;
  return uniqueStrings(choices.filter(Boolean));
}

function getRouteCopySheetSelectedProtocols(output) {
  const sheet = ui.routeCopySheet;
  const choices = getRouteCopySheetProtocolChoices(output);
  const selected = Array.isArray(sheet?.protocols) ? sheet.protocols.filter((protocol) => choices.includes(protocol)) : [];
  return selected;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value)).filter(Boolean)));
}

function safeRegexTest(pattern, value) {
  try {
    return new RegExp(pattern, 'i').test(String(value ?? ''));
  } catch {
    return false;
  }
}

function getEntityRouteMeta(collection, item) {
  const sets = getRouteSets();
  const match = sets.find((set) => {
    if (collection === 'sources') return set.sourceIds.includes(item.id);
    if (collection === 'egresses') return set.egressIds.includes(item.id);
    if (collection === 'rules') return set.ruleId === item.id;
    return false;
  });
  return match || null;
}

function selectRouteSet(index) {
  const set = getRouteSets().find((item) => item.index === index);
  if (!set) return;
  if (set.sourceIds[0]) ui.activeItems.sources = set.sourceIds[0];
  if (set.egressIds[0]) ui.activeItems.egresses = set.egressIds[0];
  if (set.ruleId) ui.activeItems.rules = set.ruleId;
  renderEditors();
}

function renderCollection(collection) {
  const definitions = {
    sources: {
      selector: '#source-list',
      label: 'Source',
      renderer: renderSource,
      summary: summarizeSourceCard,
      empty: ['还没有订阅来源。', '点击“添加”，填入订阅链接或粘贴内容。'],
    },
    egresses: {
      selector: '#egress-list',
      label: 'Egress',
      renderer: renderEgress,
      summary: summarizeEgressCard,
      empty: ['还没有家庭出口。', '点击“添加”，配置一个家庭宽带出口。'],
    },
    rules: {
      selector: '#rule-list',
      label: 'Rule',
      renderer: renderRule,
      summary: summarizeRuleCard,
      empty: ['还没有分流规则。', '点击“添加”，把来源映射到出口。'],
    },
  };
  const definition = definitions[collection];
  const element = root.querySelector(definition.selector);
  if (!element) return;
  const items = state[collection];
  element.innerHTML = items.length
    ? renderEntityDeck(collection, definition.label, items, definition.renderer, definition.summary)
    : emptyState(definition.empty[0], definition.empty[1]);
  if (collection === 'rules') queueRuleAutoSourceChecks();
  updateCounts();
}

function renderEntityDeck(collection, label, items, renderItem, summarizeItem) {
  const selectedId = ensureActiveItem(collection);
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const selectedItem = items[selectedIndex];
  return `
    <div class="entity-deck">
      ${renderEntityCards(collection, label, items, selectedItem.id, summarizeItem)}
      <div class="entity-editor">
        ${renderItem(selectedItem, selectedIndex)}
      </div>
    </div>
  `;
}

function renderEntityCards(collection, label, items, selectedId, summarizeItem) {
  return `
    <div class="entity-card-row" role="tablist" aria-label="${escapeHtml(label)} selector">
      ${items
        .map((item, index) => {
          const selected = item.id === selectedId;
          const status = item.enabled ? 'on' : 'off';
          const name = item.name || item.id;
          const tooltip = `${name} | ${summarizeItem(item)}`;
          const routeMeta = getEntityRouteMeta(collection, item);
          const routeIndex = routeMeta ? routeMeta.index + 1 : index + 1;
          return `
            <div
              class="entity-card has-route-color ${selected ? 'active' : ''} ${item.enabled ? '' : 'is-off'}"
              data-collection="${escapeHtml(collection)}"
              data-entity-id="${escapeHtml(item.id)}"
              style="--route-color:${escapeHtml(routeMeta?.color || '#64748b')}"
            >
              <button
                type="button"
                class="entity-card-select"
                data-select-collection="${escapeHtml(collection)}"
                data-id="${escapeHtml(item.id)}"
                role="tab"
                aria-selected="${selected ? 'true' : 'false'}"
                title="${escapeHtml(tooltip)}"
              >
                <span class="entity-card-index">${escapeHtml(routeIndex)}</span>
                <span class="entity-card-icon" aria-hidden="true">${renderEntityIcon(collection, item)}</span>
                <span class="entity-card-title">${escapeHtml(name)}</span>
              </button>
              <span class="entity-state-dot ${item.enabled ? 'ok' : 'off'}" title="${escapeHtml(status)}"></span>
              <button
                type="button"
                class="entity-card-rename"
                data-action="rename-entity"
                data-collection="${escapeHtml(collection)}"
                data-id="${escapeHtml(item.id)}"
                aria-label="Rename ${escapeHtml(name)}"
                title="Rename"
              >&#9998;</button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderEntityIcon(collection, item) {
  if (collection === 'sources') {
    return item.kind === 'text'
      ? '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg>';
  }
  if (collection === 'egresses') {
    return '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/><path d="M16 7h5m-2-2 2 2-2 2"/></svg>';
  }
  return '<svg viewBox="0 0 24 24"><path d="M5 4v5a3 3 0 0 0 3 3h8"/><path d="m13 9 3 3-3 3"/><path d="M5 20v-3a3 3 0 0 1 3-3h8"/><circle cx="5" cy="4" r="2"/></svg>';
}

function summarizeSourceCard(source) {
  return [source.kind || 'url', source.formatHint || 'auto', source.id].filter(Boolean).join(' | ');
}

function summarizeEgressCard(egress) {
  const endpoint = egress.server ? `${egress.server}${egress.port ? `:${egress.port}` : ''}` : 'unset';
  return [egress.protocol || 'http', endpoint].filter(Boolean).join(' | ');
}

function summarizeRuleCard(rule) {
  const targetCount = Array.isArray(rule.targets) ? rule.targets.length : 0;
  return [`priority ${rule.priority ?? 0}`, rule.targetMode || 'replace', `${targetCount} target${targetCount === 1 ? '' : 's'}`].join(' | ');
}

function ensureActiveItem(collection) {
  const items = Array.isArray(state[collection]) ? state[collection] : [];
  if (items.length === 0) {
    ui.activeItems[collection] = '';
    return '';
  }
  if (!items.some((item) => item.id === ui.activeItems[collection])) {
    ui.activeItems[collection] = items[0].id;
  }
  return ui.activeItems[collection];
}

function setActiveItem(collection, id) {
  const items = Array.isArray(state[collection]) ? state[collection] : [];
  if (!items.some((item) => item.id === id)) return;
  ui.activeItems[collection] = id;
}

function renderSource(source, index) {
  const preview = ui.previews[source.id];
  const sourceTest = ui.sourceTests[source.id];
  const isText = source.kind === 'text';
  return `
    <div class="entity" data-kind="source" data-id="${source.id}">
      <div class="entity-summary">
        <div class="summary-left">
          <span class="summary-title">${escapeHtml(source.name)}</span>
          <span class="pill">${escapeHtml(source.kind)}</span>
          <span class="pill ${source.enabled ? 'ok' : 'off'}">${source.enabled ? 'on' : 'off'}</span>
        </div>
        <div class="summary-actions">
          <button data-action="preview-source" data-id="${source.id}">解析</button>
          <button data-action="test-source" data-id="${source.id}">测试</button>
          ${renderMoreActions('source', source.id)}
        </div>
      </div>
      <div class="entity-body">
        <div class="field-grid">
          ${textField(`sources.${index}.name`, '名称', source.name)}
          ${selectField(`sources.${index}.kind`, '来源类型', SOURCE_KIND_OPTIONS, source.kind)}
          ${checkboxField(`sources.${index}.enabled`, '启用', source.enabled)}
          ${isText ? textareaField(`sources.${index}.content`, '订阅内容', source.content || '', 'wide') : textField(`sources.${index}.url`, '订阅 URL', source.url, 'wide')}
        </div>
        <details class="advanced" data-details-key="source:${escapeHtml(source.id)}:advanced" ${detailsOpen(`source:${source.id}:advanced`)}>
          <summary>格式、请求头与备注</summary>
          <div class="field-grid" style="margin-top:10px">
            ${selectField(`sources.${index}.formatHint`, '格式识别', FORMAT_OPTIONS, source.formatHint)}
            ${!isText ? textField(`sources.${index}.headersJson`, 'Headers JSON', source.headersJson || '', 'wide') : ''}
            ${!isText ? textareaField(`sources.${index}.content`, '备用原始内容', source.content || '', 'wide') : ''}
            ${textField(`sources.${index}.notes`, '备注', source.notes, 'wide')}
          </div>
        </details>
        ${preview ? `<div class="preview-box">${renderPreview(preview)}</div>` : ''}
        ${sourceTest ? `<div class="preview-box">${renderSourceTest(sourceTest)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderEgress(egress, index) {
  const authFields = renderEgressAuthFields(egress, index);
  const advancedFields = renderEgressAdvancedFields(egress, index);
  const quickImport = renderEgressQuickImport(index);
  return `
    <div class="entity" data-kind="egress" data-id="${egress.id}">
      <div class="entity-summary">
        <div class="summary-left">
          <span class="summary-title">${escapeHtml(egress.name)}</span>
          <span class="pill">${escapeHtml(egress.protocol)}</span>
          <span class="pill ${egress.enabled ? 'ok' : 'off'}">${egress.enabled ? 'on' : 'off'}</span>
        </div>
        <div class="summary-actions">
          ${renderMoreActions('egress', egress.id)}
        </div>
      </div>
      <div class="entity-body">
        ${quickImport}
        <div class="field-grid">
          ${textField(`egresses.${index}.name`, '名称', egress.name)}
          ${selectField(`egresses.${index}.protocol`, '协议', PROTOCOL_OPTIONS, egress.protocol)}
          ${checkboxField(`egresses.${index}.enabled`, '启用', egress.enabled)}
          ${textField(`egresses.${index}.server`, '服务器', egress.server)}
          ${numberField(`egresses.${index}.port`, '端口', egress.port)}
          ${authFields}
        </div>
        <details class="advanced" data-details-key="egress:${escapeHtml(egress.id)}:advanced" ${detailsOpen(`egress:${egress.id}:advanced`)}>
          <summary>高级连接、路由与备注</summary>
          <div class="field-grid" style="margin-top:10px">
            ${advancedFields}
          </div>
        </details>
      </div>
    </div>
  `;
}

function renderEgressQuickImport(index) {
  return `
    <div class="egress-quick-import">
      <label class="field wide">
        <span>快速识别</span>
        <textarea
          class="egress-quick-import-input"
          data-egress-import="${index}"
          placeholder="粘贴 host:port:user:pass 或代理链接"
        ></textarea>
      </label>
      <div class="egress-quick-import-actions">
        <button type="button" data-action="import-egress" data-index="${index}">识别</button>
        <small class="field-hint">支持 host:port:user:pass、http(s)://user:pass@host:port、socks5://... 等格式。</small>
      </div>
    </div>
  `;
}

function renderRule(rule, index) {
  const sourceOptions = state.sources.map((source) => ({ value: source.id, label: source.name, meta: source.id }));
  const egressOptions = state.egresses.map((egress) => ({ value: egress.id, label: egress.name, meta: `${egress.protocol} ${egress.id}` }));
  const nodeChoices = getRuleNodeChoices(rule, index);
  const nodeLocks = getRuleNodeLocks(rule, index, nodeChoices);
  return `
    <div class="entity" data-kind="rule" data-id="${rule.id}">
      <div class="entity-summary">
        <div class="summary-left">
          <span class="summary-title">${escapeHtml(rule.name)}</span>
          <span class="pill ${rule.enabled ? 'ok' : 'off'}">${rule.enabled ? 'on' : 'off'}</span>
        </div>
        <div class="summary-actions">
          ${renderMoreActions('rule', rule.id)}
        </div>
      </div>
      <div class="entity-body">
        <div class="field-grid">
          ${textField(`rules.${index}.name`, '名称', rule.name)}
          ${checkboxField(`rules.${index}.enabled`, '启用', rule.enabled)}
          ${pickerField(`rules.${index}.match.sourceIds`, '来源', sourceOptions, rule.match?.sourceIds || [], 'wide')}
          ${nodeChecklistField(`rules.${index}`, '节点筛选', nodeChoices, 'wide', nodeLocks)}
          ${pickerField(`rules.${index}.targets`, '目标出口', egressOptions, rule.targets || [], 'wide')}
        </div>
        <details class="advanced" data-details-key="rule:${escapeHtml(rule.id)}:advanced" ${detailsOpen(`rule:${rule.id}:advanced`)}>
          <summary>匹配方式、优先级与备注</summary>
          <div class="field-grid" style="margin-top:10px">
            ${numberField(`rules.${index}.priority`, '优先级', rule.priority)}
            ${selectField(`rules.${index}.targetMode`, '目标模式', TARGET_MODE_OPTIONS, rule.targetMode)}
            ${checkboxField(`rules.${index}.stop`, '匹配后停止', rule.stop)}
            ${textField(`rules.${index}.match.sourceNameRegex`, '来源名称正则', rule.match?.sourceNameRegex || '', 'wide')}
            ${textField(`rules.${index}.match.nodeNameRegex`, '节点名称正则', rule.match?.nodeNameRegex || '', 'wide')}
            ${nodeSummaryField('已选节点', summarizeNodeSelection(rule), 'wide')}
            ${textField(`rules.${index}.notes`, '备注', rule.notes, 'wide')}
          </div>
        </details>
      </div>
    </div>
  `;
}

function getRuleSourceIds(rule) {
  const ids = Array.isArray(rule.match?.sourceIds) ? rule.match.sourceIds.filter(Boolean) : [];
  if (ids.length > 0) return ids;
  return state.sources.filter((source) => source.enabled).map((source) => source.id);
}

function getRuleNodeChoices(rule, ruleIndex) {
  const sourceIds = getRuleSourceIds(rule);
  const choices = [];
  for (const sourceId of sourceIds) {
    const source = state.sources.find((item) => item.id === sourceId);
    if (!source) continue;
    const preview = ui.previews[sourceId];
    const test = ui.sourceTests[sourceId];
    const testMap = getSourceTestLookup(test);
    const nodes = getPreviewNodesForRule(preview, test);
    if (nodes.length === 0) {
      choices.push({
        id: `source:${sourceId}:pending`,
        sourceId,
        sourceName: source.name,
        name: '等待解析',
        protocol: 'unknown',
        server: '',
        port: null,
        latencyMs: null,
        status: 'pending',
        message: 'Please open this rule to load source nodes.',
        placeholder: true,
      });
      continue;
    }
    nodes.forEach((node, nodeIndex) => {
      const nodeId = normalizeSelectValue(node.id || `${source.id}-node-${nodeIndex}`);
      const tested = lookupSourceTest(testMap, source, node, nodeIndex);
      choices.push({
        id: nodeId,
        sourceId,
        sourceName: source.name,
        name: node.name || nodeId,
        protocol: normalizeRouteProtocol(node.protocol || tested?.protocol || ''),
        server: node.server || tested?.server || '',
        port: node.port ?? tested?.port ?? null,
        status: tested?.status || node.status || '',
        latencyMs: tested?.latencyMs ?? null,
        message: tested?.message || '',
      });
    });
  }
  return choices;
}

function getPreviewNodesForRule(preview, test) {
  if (Array.isArray(preview?.nodes) && preview.nodes.length > 0) {
    return preview.nodes;
  }
  if (Array.isArray(test?.nodesList) && test.nodesList.length > 0) {
    return test.nodesList;
  }
  if (Array.isArray(test?.checks) && test.checks.length > 0) {
    return test.checks.map((check, index) => ({
      id: check.id || `check-${index}`,
      name: check.name || `node-${index + 1}`,
      protocol: check.protocol || 'unknown',
      server: check.server || '',
      port: check.port ?? null,
    }));
  }
  return [];
}

function getSourceTestLookup(test) {
  const lookup = new Map();
  for (const check of Array.isArray(test?.checks) ? test.checks : []) {
    const id = normalizeSelectValue(check.id || '');
    if (id) lookup.set(id, check);
    const key = nodeTestKey(check.name, check.protocol, check.server, check.port);
    lookup.set(key, check);
  }
  return lookup;
}

function lookupSourceTest(testMap, source, node, nodeIndex = 0) {
  const id = normalizeSelectValue(node.id || '');
  if (id && testMap.has(id)) return testMap.get(id);
  const key = nodeTestKey(node.name, node.protocol, node.server, node.port);
  if (testMap.has(key)) return testMap.get(key);
  const nameKey = nodeTestKey(node.name, node.protocol, '', '');
  if (testMap.has(nameKey)) return testMap.get(nameKey);
  const fallbackKey = nodeTestKey(node.name || `${source.name}-${nodeIndex + 1}`, node.protocol, node.server, node.port);
  return testMap.get(fallbackKey) || null;
}

function nodeTestKey(name, protocol, server, port) {
  return [
    normalizeSelectValue(name).toLowerCase(),
    normalizeSelectValue(protocol).toLowerCase(),
    normalizeSelectValue(server).toLowerCase(),
    normalizeSelectValue(port),
  ].join('|');
}

function summarizeNodeSelection(rule) {
  const nodeIds = Array.isArray(rule.match?.nodeIds) ? rule.match.nodeIds.filter((id) => id && id !== EMPTY_NODE_SELECTION) : [];
  if (Array.isArray(rule.match?.nodeIds) && rule.match.nodeIds.includes(EMPTY_NODE_SELECTION) && nodeIds.length === 0) {
    return '未选择节点';
  }
  if (nodeIds.length > 0) {
    const names = getRuleNodeChoices(rule, state.rules.findIndex((candidate) => candidate.id === rule.id))
      .filter((choice) => nodeIds.includes(choice.id) && !choice.placeholder)
      .map((choice) => choice.name)
      .filter(Boolean);
    if (names.length > 0) return names.slice(0, 4).join(', ');
    return `${nodeIds.length} selected node${nodeIds.length === 1 ? '' : 's'}`;
  }
  const protocols = Array.isArray(rule.match?.protocols) ? rule.match.protocols.filter(Boolean) : [];
  if (protocols.length === 0) return '所有节点';
  return protocols.map((protocol) => PROTOCOL_LABELS[protocol] || protocol).join(', ');
}

function isExplicitNodeSelection(rule) {
  const nodeIds = Array.isArray(rule.match?.nodeIds) ? rule.match.nodeIds.filter((id) => id && id !== EMPTY_NODE_SELECTION) : [];
  return nodeIds.length > 0 || (Array.isArray(rule.match?.nodeIds) && rule.match.nodeIds.includes(EMPTY_NODE_SELECTION));
}

function isRuleNodeChoiceChecked(rule, choice) {
  if (choice.placeholder) return false;
  const selectedNodeIds = Array.isArray(rule.match?.nodeIds) ? rule.match.nodeIds.filter((id) => id && id !== EMPTY_NODE_SELECTION) : [];
  if (selectedNodeIds.length > 0 || (Array.isArray(rule.match?.nodeIds) && rule.match.nodeIds.includes(EMPTY_NODE_SELECTION))) {
    return selectedNodeIds.includes(choice.id);
  }
  const protocols = Array.isArray(rule.match?.protocols) ? rule.match.protocols : [];
  return protocols.length === 0 || protocols.includes(choice.protocol);
}

function ruleMatchesNodeChoice(rule, choice) {
  if (!choice || choice.placeholder) return false;
  if (!rule.enabled) return false;
  const match = rule.match || {};
  if (Array.isArray(match.sourceIds) && match.sourceIds.length > 0 && !match.sourceIds.includes(choice.sourceId)) {
    return false;
  }
  if (Array.isArray(match.nodeIds) && match.nodeIds.length > 0) {
    if (match.nodeIds.includes(EMPTY_NODE_SELECTION)) return false;
    if (!match.nodeIds.includes(choice.id)) return false;
  }
  if (Array.isArray(match.protocols) && match.protocols.length > 0) {
    if (!match.protocols.includes(choice.protocol)) return false;
  }
  if (match.sourceNameRegex) {
    if (!safeRegexTest(match.sourceNameRegex, choice.sourceName)) return false;
  }
  if (match.nodeNameRegex) {
    if (!safeRegexTest(match.nodeNameRegex, choice.name)) return false;
  }
  return true;
}

function getRuleNodeLocks(rule, ruleIndex, nodeChoices) {
  const locks = {};
  for (const choice of nodeChoices) {
    const owner = state.rules.find((candidate, index) => {
      if (index === ruleIndex || candidate.enabled === false) return false;
      if (!rulesOverlapSources(rule, candidate)) return false;
      return ruleMatchesNodeChoice(candidate, choice);
    });
    if (owner) {
      locks[choice.id] = {
        ruleName: owner.name || owner.id,
      };
    }
  }
  return locks;
}

function rulesOverlapSources(a, b) {
  const aSources = getRuleSourceIds(a);
  const bSources = getRuleSourceIds(b);
  if (aSources.length === 0 || bSources.length === 0) return true;
  return aSources.some((id) => bSources.includes(id));
}

function renderMoreActions(kind, id) {
  return `
    <details class="more-menu">
      <summary aria-label="更多操作" title="更多操作">•••</summary>
      <div class="more-popover">
        <button data-action="duplicate-${escapeHtml(kind)}" data-id="${escapeHtml(id)}">复制</button>
        <button class="danger" data-action="delete-${escapeHtml(kind)}" data-id="${escapeHtml(id)}">删除</button>
      </div>
    </details>
  `;
}

function renderEgressAuthFields(egress, index) {
  switch (egress.protocol) {
    case 'http':
    case 'socks':
      return [
        textField(`egresses.${index}.username`, 'Username', egress.username),
        textField(`egresses.${index}.password`, 'Password', egress.password, '', 'password'),
      ].join('');
    case 'shadowsocks':
      return [
        textField(`egresses.${index}.method`, 'Method', egress.method),
        textField(`egresses.${index}.password`, 'Password', egress.password, '', 'password'),
      ].join('');
    case 'vmess':
    case 'vless':
      return textField(`egresses.${index}.uuid`, 'UUID', egress.uuid);
    case 'trojan':
    case 'hysteria2':
      return textField(`egresses.${index}.password`, 'Password', egress.password, '', 'password');
    case 'tuic':
      return [
        textField(`egresses.${index}.uuid`, 'UUID', egress.uuid),
        textField(`egresses.${index}.password`, 'Password', egress.password, '', 'password'),
      ].join('');
    default:
      return '';
  }
}

function renderEgressAdvancedFields(egress, index) {
  const protocolFields = [];
  if (egress.protocol === 'shadowsocks') {
    protocolFields.push(
      textField(`egresses.${index}.plugin`, 'SIP003 插件', egress.plugin),
      textField(`egresses.${index}.pluginOptions`, '插件参数', egress.pluginOptions, 'wide'),
    );
  }
  if (egress.protocol === 'vmess') {
    protocolFields.push(
      textField(`egresses.${index}.security`, '加密方式', egress.security || 'auto'),
      numberField(`egresses.${index}.alterId`, 'Alter ID', egress.alterId ?? 0),
    );
  }
  if (egress.protocol === 'vless') {
    protocolFields.push(
      selectField(
        `egresses.${index}.security`,
        '安全层',
        [
          { value: '', label: '无 / 自动' },
          { value: 'tls', label: 'TLS' },
          { value: 'reality', label: 'Reality' },
        ],
        egress.security || '',
      ),
      textField(`egresses.${index}.flow`, 'Flow', egress.flow),
      textField(`egresses.${index}.packetEncoding`, 'Packet encoding', egress.packetEncoding),
      textField(`egresses.${index}.realityPublicKey`, 'Reality public key', egress.realityPublicKey, 'wide'),
      textField(`egresses.${index}.realityShortId`, 'Reality short ID', egress.realityShortId),
      textField(`egresses.${index}.realitySpiderX`, 'Reality spider X', egress.realitySpiderX),
    );
  }
  if (['http', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'].includes(egress.protocol)) {
    protocolFields.push(
      checkboxField(`egresses.${index}.tlsEnabled`, 'TLS', egress.tlsEnabled),
      checkboxField(`egresses.${index}.allowInsecure`, '允许不安全证书', egress.allowInsecure),
      textField(`egresses.${index}.sni`, 'SNI', egress.sni),
    );
  }
  if (['vmess', 'vless', 'trojan'].includes(egress.protocol)) {
    protocolFields.push(
      textField(`egresses.${index}.transportType`, '传输方式', egress.transportType),
      textField(`egresses.${index}.path`, 'Path', egress.path),
      textField(`egresses.${index}.host`, 'Host header', egress.host),
      textField(`egresses.${index}.serviceName`, 'Service name', egress.serviceName),
      textField(`egresses.${index}.alpn`, 'ALPN', egress.alpn),
      textField(`egresses.${index}.fingerprint`, 'Fingerprint', egress.fingerprint),
    );
  }
  if (egress.protocol === 'hysteria2') {
    protocolFields.push(
      textField(`egresses.${index}.alpn`, 'ALPN', egress.alpn),
      textField(`egresses.${index}.obfs`, '混淆', egress.obfs),
      textField(`egresses.${index}.obfsPassword`, '混淆密码', egress.obfsPassword, '', 'password'),
      numberField(`egresses.${index}.upMbps`, '上行 Mbps', egress.upMbps),
      numberField(`egresses.${index}.downMbps`, '下行 Mbps', egress.downMbps),
    );
  }
  if (egress.protocol === 'tuic') {
    protocolFields.push(
      textField(`egresses.${index}.alpn`, 'ALPN', egress.alpn),
      textField(`egresses.${index}.congestionControl`, '拥塞控制', egress.congestionControl),
      textField(`egresses.${index}.udpRelayMode`, 'UDP relay mode', egress.udpRelayMode),
    );
  }
  return [
    ...protocolFields,
    textField(`egresses.${index}.bindInterface`, '绑定网卡', egress.bindInterface),
    textField(`egresses.${index}.routingMark`, 'Routing mark', egress.routingMark),
    textField(`egresses.${index}.tagsText`, '标签', (egress.tags || []).join(', '), 'wide'),
    textField(`egresses.${index}.notes`, '备注', egress.notes, 'wide'),
  ]
    .filter(Boolean)
    .join('');
}

function renderExportGrid() {
  const exp = state.export || {};
  const egressOptions = [{ value: '', label: '自动选择' }].concat(
    state.egresses.map((item) => ({ value: item.id, label: `${item.name} (${item.protocol})` })),
  );
  return [
    textField('export.nameTemplate', '节点名称模板', exp.nameTemplate || ''),
    selectField('export.defaultEgressId', '默认出口', egressOptions, exp.defaultEgressId || ''),
    checkboxField('export.includeInbound', '包含本地入站', exp.includeInbound),
    textField('export.inboundTag', '入站标签', exp.inboundTag || ''),
    numberField('export.inboundPort', '入站端口', exp.inboundPort),
    textField('export.inboundListen', '监听地址', exp.inboundListen || ''),
    checkboxField('export.includeSelectors', '包含 Selector', exp.includeSelectors),
    checkboxField('export.includeUrlTest', '包含 URLTest', exp.includeUrlTest),
    textField('export.selectorTag', '主 Selector 标签', exp.selectorTag || ''),
  ].join('');
}

function wireEvents() {
  root.addEventListener('pointerdown', onPointerFeedback);
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('paste', onPaste);
  root.addEventListener('toggle', onToggle, true);
}

function onPointerFeedback(event) {
  const clickable = event.target.closest(CLICK_FEEDBACK_SELECTOR);
  if (!clickable || clickable.disabled || clickable.getAttribute('aria-disabled') === 'true') return;
  pulseClickFeedback(clickable);
}

function onClick(event) {
  const interactive = event.target.closest(CLICK_FEEDBACK_SELECTOR);
  if (interactive && interactive.getAttribute('aria-disabled') !== 'true' && !interactive.disabled) {
    pulseClickFeedback(interactive);
  }

  const exportViewButton = event.target.closest('[data-output-view]');
  if (exportViewButton) {
    ui.exportView = exportViewButton.dataset.outputView;
    renderOutput();
    showActionFeedback('已切换输出视图', 'done');
    return;
  }

  const entityCard = event.target.closest('[data-select-collection]');
  if (entityCard) {
    setActiveItem(entityCard.dataset.selectCollection, entityCard.dataset.id);
    renderEditors();
    showActionFeedback('已选中项目', 'done');
    return;
  }

  const routeSetCard = event.target.closest('[data-route-set]');
  if (routeSetCard && !event.target.closest('[data-action], .route-copy-sheet')) {
    selectRouteSet(Number(routeSetCard.dataset.routeSet));
    showActionFeedback('已打开链路', 'done');
    return;
  }

  const routeCopyTabButton = event.target.closest('[data-route-copy-tab]');
  if (routeCopyTabButton) {
    setRouteCopySheetTab(routeCopyTabButton.dataset.routeCopyTab);
    return;
  }

  const tabButton = event.target.closest('[data-view]');
  if (tabButton) {
    ui.mode = tabButton.dataset.view;
    renderOutput();
    showActionFeedback('已切换面板', 'done');
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const menu = button.closest('.tools-menu, .more-menu');
  if (menu) menu.removeAttribute('open');

  switch (action) {
    case 'add-source':
      return runButtonAction(button, '添加 Source', () => addSource());
    case 'add-egress':
      return runButtonAction(button, '添加 Egress', () => addEgress());
    case 'add-rule':
      return runButtonAction(button, '添加 Rule', () => addRule());
    case 'duplicate-source':
      return runButtonAction(button, '复制 Source', () => duplicateItem('sources', id, 'src'));
    case 'duplicate-egress':
      return runButtonAction(button, '复制 Egress', () => duplicateItem('egresses', id, 'eg'));
    case 'duplicate-rule':
      return runButtonAction(button, '复制 Rule', () => duplicateItem('rules', id, 'rule'));
    case 'rename-entity':
      return runButtonAction(button, '重命名', () => renameItem(button.dataset.collection, id));
    case 'delete-source':
      return runButtonAction(button, '删除 Source', () => removeItem('sources', id));
    case 'delete-egress':
      return runButtonAction(button, '删除 Egress', () => removeItem('egresses', id));
    case 'delete-rule':
      return runButtonAction(button, '删除 Rule', () => removeItem('rules', id));
    case 'save':
      return runButtonAction(button, '保存', () => saveNow());
    case 'generate':
      return runButtonAction(button, '生成 / 预检', () => generateConfig());
    case 'diagnose':
      return runButtonAction(button, '运行诊断', () => diagnose());
    case 'upgrade-now':
      return runButtonAction(button, '一键更新', () => upgradeNow());
    case 'preview-source':
      return runButtonAction(button, '解析 Source', () => previewSource(id));
    case 'test-source':
      return runButtonAction(button, '测试 Source', () => testSource(id));
    case 'import-egress':
      return runButtonAction(button, '识别 Egress', () => importEgressFromQuickBox(Number(button.dataset.index)));
    case 'copy-config':
      return runButtonAction(button, '复制配置', () => copyCurrentConfig());
    case 'open-route-copy-sheet':
      return openRouteCopySheet(Number(button.dataset.routeSetIndex));
    case 'copy-route-output': {
      const mode = button.dataset.copyMode || 'full';
      const label = getRouteCopyActionLabel(mode);
      return runButtonAction(button, label, () => copyRouteOutput(Number(button.dataset.routeSetIndex), mode));
    }
    case 'copy-route-link': {
      const label = button.dataset.routeLabel || '节点';
      const link = button.dataset.routeLink || '';
      return runButtonAction(button, `复制 ${label} 链接`, () => {
        if (!link) throw new Error('链接为空。');
        return copyText(link);
      });
    }
    case 'copy-export-link':
      return runButtonAction(button, '复制链接', () => copyText(getExportUrl(ui.exportFormat)));
    case 'copy-export-format-link':
      return runButtonAction(button, '复制链接', () => copyText(getExportUrl(button.dataset.exportFormat || ui.exportFormat)));
    case 'open-export-link':
      return runButtonAction(button, '打开链接', () => {
        const opened = window.open(getExportUrl(ui.exportFormat), '_blank', 'noopener');
        if (!opened) throw new Error('浏览器拦截了弹窗。');
        return opened;
      });
    case 'open-export-format-link':
      return runButtonAction(button, '打开链接', () => {
        const opened = window.open(getExportUrl(button.dataset.exportFormat || ui.exportFormat), '_blank', 'noopener');
        if (!opened) throw new Error('浏览器拦截了弹窗。');
        return opened;
      });
    case 'download-config':
      return runButtonAction(button, '下载配置', () => downloadText('sing-box.config.json', JSON.stringify(ui.generated?.config || {}, null, 2)));
    case 'download-snapshot':
      return runButtonAction(button, '下载快照', () => downloadText('relay.snapshot.json', JSON.stringify(ui.generated?.snapshot || {}, null, 2)));
    case 'close-route-copy-sheet':
      return closeRouteCopySheet();
    case 'reset-route-copy-protocols':
      return resetRouteCopySheetProtocols();
    default:
      return runButtonAction(button, '操作', () => {});
  }
}

function pulseClickFeedback(element) {
  element.classList.remove('click-feedback');
  // Restart the animation even when the same control is clicked repeatedly.
  void element.offsetWidth;
  element.classList.add('click-feedback');
  window.setTimeout(() => element.classList.remove('click-feedback'), 260);
}

function showActionFeedback(message, status = 'done') {
  const element = root.querySelector('#action-feedback');
  if (!element) return;
  clearTimeout(ui.actionFeedbackTimer);
  element.dataset.status = status;
  element.textContent = message;
  element.classList.add('is-visible');
  if (status !== 'working') {
    ui.actionFeedbackTimer = window.setTimeout(() => {
      element.classList.remove('is-visible');
    }, 1600);
  }
}

function runButtonAction(button, label, action) {
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return undefined;
  button.classList.remove('is-done', 'is-failed');
  button.classList.add('is-working');
  button.dataset.actionStatus = 'working';
  button.setAttribute('aria-busy', 'true');
  showActionFeedback(`正在${label}...`, 'working');

  let result;
  try {
    result = action();
  } catch (error) {
    markButtonActionStatus(button, 'failed');
    showActionFeedback(`${label} 失败：${formatActionError(error)}`, 'failed');
    console.error(error);
    return undefined;
  }

  return Promise.resolve(result)
    .then((value) => {
      markButtonActionStatus(button, 'done');
      showActionFeedback(value === false ? `${label}：没有变更` : `${label} 已完成`, 'done');
      return value;
    })
    .catch((error) => {
      markButtonActionStatus(button, 'failed');
      showActionFeedback(`${label} 失败：${formatActionError(error)}`, 'failed');
      console.error(error);
      return undefined;
    });
}

function formatActionError(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'Unknown error');
}

function markButtonActionStatus(button, status) {
  if (!button) return;
  button.classList.remove('is-working');
  button.removeAttribute('aria-busy');
  delete button.dataset.actionStatus;
  button.classList.add(status === 'failed' ? 'is-failed' : 'is-done');
  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.classList.remove('is-done', 'is-failed');
  }, 900);
}

function onInput(event) {
  const target = event.target;
  if (target.matches('[data-egress-import]')) return;
  if (!target.matches('[data-path]')) return;
  updateStateFromInput(target);
  maybeInvalidateSourceCache(target.dataset.path || '');
  queueSave(false);
}

function onChange(event) {
  const target = event.target;
  if (target.matches('[data-output-format-select]')) {
    ui.exportFormat = target.value;
    renderOutput();
    return;
  }
  if (target.matches('[data-route-copy-protocol]')) {
    updateRouteCopySheetProtocol(target.dataset.routeCopyProtocol, target.checked);
    return;
  }
  if (target.matches('[data-rule-node-choice]')) {
    updateRuleNodeChoice(target);
    return;
  }
  if (target.matches('[data-array-path]')) {
    updateArrayFromInput(target);
    queueSave(true);
    target.closest('.picker-chip')?.classList.toggle('picked', target.checked);
    target.closest('.protocol-check-item')?.classList.toggle('checked', target.checked);
    if (target.dataset.arrayPath?.includes('.match.sourceIds')) {
      renderCollection('rules');
    }
    return;
  }
  if (!target.matches('[data-path]')) return;
  updateStateFromInput(target);
  maybeInvalidateSourceCache(target.dataset.path || '');
  queueSave(true);
  const path = target.dataset.path || '';
  const collection = path.split('.')[0];
  if (['sources', 'egresses', 'rules'].includes(collection) && shouldRefreshCollection(path)) {
    renderCollection(collection);
    if ((collection === 'sources' || collection === 'egresses') && /\.(name|protocol)$/.test(path)) {
      renderCollection('rules');
    }
    if (collection === 'egresses' && /\.(name|enabled|protocol)$/.test(path)) {
      const exportGrid = root.querySelector('#export-grid');
      if (exportGrid) exportGrid.innerHTML = renderExportGrid();
    }
  }
}

function onPaste(event) {
  const target = event.target;
  if (!target.matches('[data-egress-import]')) return;
  window.setTimeout(() => {
    if (!target.isConnected) return;
    importEgressQuickText(target.value, Number(target.dataset.egressImport));
  }, 0);
}

function onToggle(event) {
  const details = event.target;
  const key = details?.dataset?.detailsKey;
  if (!key) return;
  if (details.open) ui.openDetails.add(key);
  else ui.openDetails.delete(key);
}

function detailsOpen(key) {
  return ui.openDetails.has(key) ? 'open' : '';
}

function shouldRefreshCollection(path) {
  return /\.(name|enabled|kind|protocol)$/.test(path);
}

function addSource() {
  const source = {
    id: newId('src'),
    name: `Source ${state.sources.length + 1}`,
    kind: 'url',
    url: '',
    content: '',
    formatHint: 'auto',
    enabled: true,
    notes: '',
    headersJson: '',
  };
  state.sources.push(source);
  ui.activeItems.sources = source.id;
  renderEditors();
  queueSave(true);
}

function addEgress() {
  const egress = {
    id: newId('eg'),
    name: `Egress ${state.egresses.length + 1}`,
    protocol: 'http',
    enabled: true,
    server: '',
    port: '',
    username: '',
    password: '',
    uuid: '',
    method: '',
    plugin: '',
    pluginOptions: '',
    security: '',
    alterId: 0,
    flow: '',
    packetEncoding: '',
    realityPublicKey: '',
    realityShortId: '',
    realitySpiderX: '',
    tlsEnabled: false,
    allowInsecure: false,
    sni: '',
    transportType: '',
    path: '',
    host: '',
    serviceName: '',
    alpn: '',
    fingerprint: '',
    congestionControl: '',
    udpRelayMode: '',
    obfs: '',
    obfsPassword: '',
    bindInterface: '',
    routingMark: '',
    upMbps: '',
    downMbps: '',
    tags: [],
    notes: '',
  };
  state.egresses.push(egress);
  ui.activeItems.egresses = egress.id;
  renderEditors();
  queueSave(true);
}

function addRule() {
  const defaultSourceIds = state.sources.filter((item) => item.enabled).slice(0, 1).map((item) => item.id);
  const defaultTargets = state.egresses.filter((item) => item.enabled).slice(0, 1).map((item) => item.id);
  const rule = {
    id: newId('rule'),
    name: `Rule ${state.rules.length + 1}`,
    enabled: true,
    priority: 100,
    targetMode: 'replace',
    stop: true,
    match: { sourceIds: defaultSourceIds, sourceNameRegex: '', nodeNameRegex: '', protocols: PROTOCOL_OPTIONS.slice() },
    targets: defaultTargets,
    notes: '',
  };
  state.rules.push(rule);
  ui.activeItems.rules = rule.id;
  renderEditors();
  queueSave(true);
}

function duplicateItem(collection, id, prefix) {
  const list = state[collection];
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const clone = structuredClone(list[index]);
  clone.id = newId(prefix);
  clone.name = `${clone.name} copy`;
  list.splice(index + 1, 0, clone);
  ui.activeItems[collection] = clone.id;
  renderEditors();
  queueSave(true);
  return true;
}

function renameItem(collection, id) {
  const list = state[collection];
  if (!Array.isArray(list)) return false;
  const item = list.find((entry) => entry.id === id);
  if (!item) return false;
  const nextName = window.prompt('修改名称', item.name || item.id);
  if (nextName === null) return false;
  const name = nextName.trim();
  if (!name || name === item.name) return false;
  item.name = name;
  ui.activeItems[collection] = item.id;
  renderEditors();
  queueSave(true);
  return true;
}

function removeItem(collection, id) {
  const list = state[collection];
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return false;
  const itemName = list[index]?.name || id;
  if (!window.confirm(`确定删除“${itemName}”吗？`)) return false;
  list.splice(index, 1);
  if (collection === 'sources') {
    delete ui.previews[id];
    delete ui.sourceTests[id];
    state.rules.forEach((rule) => {
      rule.match.sourceIds = (rule.match?.sourceIds || []).filter((sourceId) => sourceId !== id);
    });
  }
  if (collection === 'egresses') {
    state.rules.forEach((rule) => {
      rule.targets = (rule.targets || []).filter((egressId) => egressId !== id);
    });
    if (state.export?.defaultEgressId === id) state.export.defaultEgressId = '';
  }
  if (ui.activeItems[collection] === id || !list.some((item) => item.id === ui.activeItems[collection])) {
    ui.activeItems[collection] = list[Math.min(index, list.length - 1)]?.id || '';
  }
  renderEditors();
  queueSave(true);
  return true;
}

function updateStateFromInput(target) {
  const path = target.dataset.path;
  const value = readInputValue(target);
  setByPath(state, path, value);
  if (/^egresses\.\d+\.protocol$/.test(path) && ['trojan', 'hysteria2', 'tuic'].includes(value)) {
    const index = Number(path.split('.')[1]);
    if (state.egresses[index]) state.egresses[index].tlsEnabled = true;
  }
  if (/^egresses\.\d+\.security$/.test(path) && ['tls', 'reality'].includes(value)) {
    const index = Number(path.split('.')[1]);
    if (state.egresses[index]) state.egresses[index].tlsEnabled = true;
  }
}

function maybeInvalidateSourceCache(path) {
  const match = /^sources\.(\d+)\.(kind|url|content|formatHint|headersJson)$/.exec(String(path || ''));
  if (!match) return;
  const index = Number(match[1]);
  const source = state.sources[index];
  if (!source) return;
  delete ui.previews[source.id];
  delete ui.sourceTests[source.id];
}

function queueRuleAutoSourceChecks() {
  const rule = state.rules.find((item) => item.id === ui.activeItems.rules) || state.rules[0];
  if (!rule) return;
  for (const sourceId of getRuleSourceIds(rule)) {
    if (!sourceId) continue;
    if (!ui.sourceTests[sourceId] && !ui.autoTestingSources.has(sourceId)) {
      ui.autoTestingSources.add(sourceId);
      testSource(sourceId)
        .catch(() => {})
        .finally(() => {
          ui.autoTestingSources.delete(sourceId);
        });
    }
  }
}

function readInputValue(target) {
  if (target.type === 'checkbox') return target.checked;
  if (target.type === 'number') return target.value === '' ? '' : Number(target.value);
  return target.value;
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (Array.isArray(cursor)) {
      cursor = cursor[Number(key)];
    } else {
      cursor[key] = cursor[key] ?? {};
      cursor = cursor[key];
    }
  }
  const last = parts[parts.length - 1];
  if (last === 'tagsText') {
    cursor.tags = splitCsvValue(value);
  } else if (last === 'sourceIdsText') {
    cursor.sourceIds = splitCsvValue(value);
  } else if (last === 'protocolsText') {
    cursor.protocols = splitCsvValue(value).map((item) => item.toLowerCase());
  } else if (last === 'targetsText') {
    cursor.targets = splitCsvValue(value);
  } else {
    cursor[last] = value;
  }
}

function updateArrayFromInput(target) {
  const path = target.dataset.arrayPath;
  const value = target.dataset.arrayValue;
  const list = readPath(state, path);
  const allValues = splitCsvValue(target.dataset.arrayAllValues || '');
  const usesImplicitAll = target.dataset.arrayImplicitAll === 'true';
  const next = usesImplicitAll && allValues.length && (!Array.isArray(list) || list.length === 0)
    ? allValues.slice()
    : Array.isArray(list)
      ? list.slice()
    : [];
  if (target.checked) {
    if (!next.includes(value)) next.push(value);
  } else {
    const index = next.indexOf(value);
    if (index >= 0) next.splice(index, 1);
  }
  setPath(state, path, next);
  const sourceMatch = /^rules\.(\d+)\.match\.sourceIds$/.exec(String(path || ''));
  if (sourceMatch) {
    const ruleIndex = Number(sourceMatch[1]);
    const rule = state.rules[ruleIndex];
    if (rule) {
      const choices = getRuleNodeChoices(rule, ruleIndex).filter((choice) => !choice.placeholder);
      const allowedIds = new Set(choices.map((choice) => choice.id));
      const currentIds = Array.isArray(rule.match?.nodeIds) ? rule.match.nodeIds.filter((id) => id && id !== EMPTY_NODE_SELECTION) : [];
      if (currentIds.length > 0) {
        const nextIds = currentIds.filter((id) => allowedIds.has(id));
        rule.match.nodeIds = nextIds.length > 0 ? nextIds : [EMPTY_NODE_SELECTION];
        rule.match.protocols = [...new Set(choices.filter((choice) => nextIds.includes(choice.id)).map((choice) => choice.protocol).filter(Boolean))];
      }
    }
  }
}

function updateRuleNodeChoice(target) {
  const ruleIndex = Number(target.dataset.ruleIndex);
  const rule = state.rules[ruleIndex];
  if (!rule) return;
  const choices = getRuleNodeChoices(rule, ruleIndex).filter((choice) => !choice.placeholder);
  const currentIds = choices.filter((choice) => isRuleNodeChoiceChecked(rule, choice)).map((choice) => choice.id);
  const nextIds = new Set(currentIds);
  const nodeId = normalizeSelectValue(target.dataset.ruleNodeId || '');
  if (!nodeId) return;
  if (target.checked) nextIds.add(nodeId);
  else nextIds.delete(nodeId);

  const selectedIds = choices.filter((choice) => nextIds.has(choice.id)).map((choice) => choice.id);
  if (selectedIds.length === 0) {
    rule.match.nodeIds = [EMPTY_NODE_SELECTION];
    rule.match.protocols = [];
  } else {
    rule.match.nodeIds = selectedIds;
    rule.match.protocols = [...new Set(choices.filter((choice) => selectedIds.includes(choice.id)).map((choice) => choice.protocol).filter(Boolean))];
  }
  renderCollection('rules');
  queueSave(true);
}

function readPath(obj, path) {
  const parts = String(path).split('.');
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (Array.isArray(cursor)) {
      cursor = cursor[Number(key)];
    } else {
      cursor[key] = cursor[key] ?? {};
      cursor = cursor[key];
    }
  }
  cursor[parts[parts.length - 1]] = value;
}

function splitCsvValue(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

async function previewSource(id) {
  const source = state.sources.find((item) => item.id === id);
  if (!source) return;
  ui.previews[id] = { loading: true, nodes: [], warnings: [], errors: [] };
  renderCollection('sources');
  let previewError = null;
  try {
    ui.previews[id] = await api('/api/parse-source', {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
  } catch (error) {
    previewError = error;
    ui.previews[id] = {
      format: 'error',
      nodes: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  renderEditors();
  if (previewError) throw previewError;
}

async function testSource(id) {
  const source = state.sources.find((item) => item.id === id);
  if (!source) return;
  ui.sourceTests[id] = { loading: true, checks: [], warnings: [], errors: [] };
  renderCollection('sources');
  let testError = null;
  try {
    ui.sourceTests[id] = await api('/api/test-source', {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
  } catch (error) {
    testError = error;
    ui.sourceTests[id] = {
      status: 'error',
      checks: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  renderEditors();
  if (testError) throw testError;
}

async function generateConfig() {
  ui.mode = 'config';
  ui.preflight = { running: true, error: '' };
  renderRouteSetPanel();
  updateGenerateButton();
  renderOutput();
  try {
    await flushSave();
    const revision = ui.editRevision;
    const generated = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    if (revision !== ui.editRevision) {
      ui.generated = null;
      ui.preflight.error = '配置在检查过程中发生了变化，请重新生成。';
    } else {
      ui.generated = generated;
      state.export = state.export || {};
      state.export.routeOutputs = buildRouteOutputSnapshots(generated);
      saveNow().catch(() => {});
    }
  } catch (error) {
    ui.generated = null;
    ui.preflight.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    ui.preflight.running = false;
    renderRouteSetPanel();
    updateGenerateButton();
    renderOutput();
  }
}

async function diagnose() {
  try {
    await flushSave();
    ui.diagnosis = await api('/api/diagnose', {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    ui.mode = 'report';
    renderOutput();
  } catch (error) {
    ui.diagnosis = null;
    ui.mode = 'report';
    renderOutput();
    throw error;
  }
}

async function upgradeNow() {
  ui.upgrade = {
    running: true,
    result: null,
    error: '',
  };
  renderUpgradePanel();
  try {
    const result = await api('/api/upgrade/run', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    ui.upgrade = {
      running: false,
      result,
      error: '',
    };
  } catch (error) {
    ui.upgrade = {
      running: false,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  } finally {
    renderUpgradePanel();
  }
}

async function saveNow() {
  clearTimeout(ui.saveTimer);
  ui.saveTimer = null;
  const revision = ui.editRevision;
  const snapshot = structuredClone(state);
  setSaveStatus('saving');
  const request = ui.saveChain
    .catch(() => {})
    .then(() => api('/api/state', {
      method: 'PUT',
      body: JSON.stringify(snapshot),
    }));
  ui.saveChain = request;
  try {
    const result = await request;
    setSaveStatus(revision === ui.editRevision ? 'saved' : 'pending');
    return result;
  } catch (error) {
    if (revision === ui.editRevision) {
      setSaveStatus('error', error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
}

function queueSave(immediate) {
  ui.editRevision += 1;
  invalidatePreflight();
  clearTimeout(ui.saveTimer);
  setSaveStatus('pending');
  ui.saveTimer = setTimeout(() => {
    saveNow().catch(() => {});
  }, immediate ? 0 : 400);
}

async function flushSave() {
  let revision;
  do {
    clearTimeout(ui.saveTimer);
    ui.saveTimer = null;
    revision = ui.editRevision;
    await saveNow();
  } while (revision !== ui.editRevision);
}

function invalidatePreflight() {
  const shouldRender = Boolean(ui.generated || ui.preflight.error);
  ui.generated = null;
  ui.preflight.error = '';
  if (shouldRender) renderOutput();
}

function setSaveStatus(status, error = '') {
  ui.saveStatus = status;
  ui.saveError = error;
  const element = root.querySelector('#save-status');
  if (!element) return;
  const labels = {
    pending: '等待自动保存',
    saving: '正在保存…',
    saved: '已自动保存',
    error: '保存失败',
  };
  element.dataset.status = status;
  element.textContent = labels[status] || labels.saved;
  element.title = error || '';
}

function updateGenerateButton() {
  root.querySelectorAll('[data-action="generate"]').forEach((button) => {
    button.disabled = ui.preflight.running;
    button.textContent = ui.preflight.running ? '正在预检…' : '生成 / 预检';
  });
}

function renderOutput() {
  const panel = root.querySelector('#output-panel');
  if (panel) {
    panel.innerHTML = ui.mode === 'config' ? renderExportOutput() : renderDiagnoseOutput();
  }
  renderRouteCopySheet();
  root.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === ui.mode);
  });
}

function renderUpgradePanel() {
  const panel = root.querySelector('#upgrade-panel');
  if (!panel) return;
  const content = renderUpgradeContent();
  panel.classList.toggle('is-hidden', !content);
  panel.innerHTML = content;
}

function renderUpgradeContent() {
  if (ui.upgrade.running) {
    return '<strong>一键升级</strong><span class="muted">正在从 GitHub 检查并拉取更新...</span>';
  }
  if (ui.upgrade.error) {
    return `<strong>Upgrade failed</strong><span class="error">${escapeHtml(ui.upgrade.error)}</span>`;
  }
  const result = ui.upgrade.result;
  if (!result) return '';
  const status = result.status || {};
  if (!status.configured) {
    return `<strong>Upgrade not configured</strong><span class="warn">${escapeHtml(status.message || 'Missing GitHub repository.')}</span>`;
  }
  if (!result.changed) {
    return `<strong>Already current</strong><span class="muted">${escapeHtml(status.repo || '')} ${escapeHtml(status.branch || 'main')} ${escapeHtml(status.remote?.short || '')}</span>`;
  }
  const restartText = result.restartScheduled ? 'Restart scheduled.' : 'Restart not configured.';
  return `<strong>Updated</strong><span class="muted">${escapeHtml(status.repo || '')} ${escapeHtml(status.remote?.short || '')}. ${restartText}</span>`;
}

function renderExportOutput() {
  const exportUrl = getExportUrl(ui.exportFormat);
  const meta = EXPORT_FORMATS.find((item) => item.id === ui.exportFormat) || EXPORT_FORMATS[0];
  const nodeCount = Number(ui.generated?.counts?.nodes || 0);
  const outboundCount = Number(ui.generated?.counts?.outbounds || 0);
  const ready = Boolean(ui.generated && nodeCount > 0 && !ui.preflight.running && !ui.preflight.error);
  return `
    <div class="report-box">
      <div class="output-controls">
        <label class="field output-client-select">
          <span>客户端</span>
          <select data-output-format-select>
            ${EXPORT_FORMATS.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === ui.exportFormat ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
        <div>
          <strong>${escapeHtml(meta.label)}</strong>
          <div class="meta">${ready ? `可用节点 ${nodeCount} · 出站 ${outboundCount}` : '生成预检通过后开放导入和二维码'}</div>
        </div>
      </div>
      ${renderPreflightState(nodeCount)}
      ${ready ? renderReadyExport(meta, exportUrl) : ''}
      ${ready && ui.exportFormat === 'shadowrocket' && hasAssignedHttpEgress() ? renderHttpUdpNotice() : ''}
      ${ready && ui.exportFormat === 'v2ray' && hasChainedAssignments() ? renderV2RayNotice() : ''}
      ${ui.generated && ui.exportFormat === 'sing-box'
        ? `
          <details class="advanced" style="margin-top:12px" data-details-key="output:raw" ${detailsOpen('output:raw')}>
            <summary>原始 Sing-box 配置</summary>
            <div class="toolbar" style="margin:10px 0">
              <button data-action="copy-config">复制</button>
              <button data-action="download-config">下载配置</button>
              <button data-action="download-snapshot">下载快照</button>
            </div>
            <textarea class="code" readonly>${escapeHtml(JSON.stringify(ui.generated.config, null, 2))}</textarea>
          </details>
        `
        : ''}
    </div>
  `;
}

function renderPreflightState(nodeCount) {
  if (ui.preflight.running) {
    return '<div class="status-panel info"><strong>正在生成并检查订阅…</strong><span>会先完成自动保存，再解析来源和分流规则。</span></div>';
  }
  if (ui.preflight.error) {
    return `<div class="status-panel danger"><strong>生成失败</strong><span>${escapeHtml(ui.preflight.error)}</span><button data-action="generate">重试</button></div>`;
  }
  if (!ui.generated) {
    return '<div class="status-panel"><strong>尚未预检</strong><span>点击“生成 / 预检”，确认订阅能产生可用节点。</span><button data-action="generate">现在生成</button></div>';
  }
  if (nodeCount <= 0) {
    const sourceError = ui.generated.snapshot?.parsedSources?.find((bundle) => bundle.errors?.length)?.errors?.[0];
    const warning =
      sourceError ||
      ui.generated.assignmentWarnings?.[0]?.message ||
      '没有可用节点。请先测试来源，并检查启用的出口和规则目标。';
    return `<div class="status-panel danger"><strong>未生成可用节点</strong><span>${escapeHtml(warning)}</span><button data-action="generate">重新检查</button></div>`;
  }
  const warnings = ui.generated.assignmentWarnings || [];
  return warnings.length
    ? `<div class="status-panel warn"><strong>预检通过，共 ${nodeCount} 个节点</strong><span>${escapeHtml(warnings[0].message || '部分节点存在提示。')}</span></div>`
    : `<div class="status-panel success"><strong>预检通过，共 ${nodeCount} 个可用节点</strong><span>现在可以导入、扫码或复制订阅链接。</span></div>`;
}

function renderReadyExport(meta, exportUrl) {
  const shadowrocket = ui.exportFormat === 'shadowrocket';
  const primaryAction = shadowrocket
    ? `<a class="button-link primary" href="${escapeHtml(getShadowrocketImportUrl(exportUrl))}">添加到 Shadowrocket</a>`
    : '';
  return `
    <div class="output-view-tabs tabs">
      ${EXPORT_VIEWS.map((item) => `<button data-output-view="${escapeHtml(item.id)}" class="${item.id === ui.exportView ? 'active' : ''}">${escapeHtml(item.label)}</button>`).join('')}
    </div>
    ${ui.exportView === 'qr'
      ? `
        <div class="qr-panel">
          <img class="qr-image" src="${escapeHtml(getExportQrUrl(ui.exportFormat))}" alt="${escapeHtml(meta.label)} QR" />
          <div class="output-actions">
            ${primaryAction}
            <button data-action="copy-export-link">复制订阅链接</button>
            <a class="button-link" href="${escapeHtml(getExportUrl(ui.exportFormat, true))}">下载</a>
          </div>
          <div class="muted">二维码仅在预检产生可用节点后显示。</div>
        </div>
      `
      : `
        <label class="field wide">
          <span>订阅链接</span>
          <input type="text" readonly value="${escapeHtml(exportUrl)}" />
        </label>
        <div class="output-actions" style="margin-top:10px">
          ${primaryAction}
          <button data-action="copy-export-link">复制链接</button>
          <button data-action="open-export-link">打开链接</button>
          <a class="button-link" href="${escapeHtml(getExportUrl(ui.exportFormat, true))}">下载</a>
        </div>
      `}
  `;
}

function hasAssignedHttpEgress() {
  const assignments = Array.isArray(ui.generated?.assignments) ? ui.generated.assignments : [];
  if (assignments.some((item) => item?.egress?.protocol === 'http')) return true;
  return state.egresses.some((item) => item.enabled && item.protocol === 'http');
}

function hasChainedAssignments() {
  const assignments = Array.isArray(ui.generated?.assignments) ? ui.generated.assignments : [];
  return assignments.some((item) => item?.egress?.protocol && item.egress.protocol !== 'direct');
}

function renderHttpUdpNotice() {
  return `
    <div class="compat-notice">
      <strong>HTTP 家宽出口仅支持 TCP</strong>
      <span>请在 Shadowrocket 中把“不支持 UDP 的行为”设为 REJECT，并关闭或阻断 QUIC，避免 UDP 直连。需要完整 UDP 时，请改用支持 UDP 的 SOCKS5 或 Shadowsocks 家宽出口。</span>
    </div>
  `;
}

function renderV2RayNotice() {
  return `
    <div class="compat-notice">
      <strong>V2RayN 只支持普通 URI 订阅</strong>
      <span>当前配置包含家宽链式出口，V2RayN 订阅无法携带这层链路；需要保留家宽出口时，请使用 Shadowrocket、Clash 或 Sing-box。</span>
    </div>
  `;
}

function renderDiagnoseOutput() {
  if (!ui.diagnosis) {
    return '<div class="preview-box"><div class="toolbar"><button data-view="config">返回订阅输出</button></div><div class="muted" style="margin-top:10px">诊断未完成，请从“工具”中重新运行。</div></div>';
  }
  const report = ui.diagnosis;
  return `
    <div class="report-box">
      <div class="toolbar" style="margin-bottom:12px"><button data-view="config">返回订阅输出</button></div>
      <div class="stats" style="margin-bottom:12px">
        ${statCard('Sources', report.summary.sources)}
        ${statCard('Assignments', report.summary.assignments)}
        ${statCard('Warnings', report.summary.warnings)}
        ${statCard('Errors', report.summary.errors)}
      </div>
      <div class="list">
        ${renderReportSection('Source reports', report.sourceReports, renderSourceReport)}
        ${renderReportSection('Rule coverage', report.ruleCoverage, renderRuleCoverage)}
        ${renderReportSection('Egress checks', report.egressChecks, renderEgressCheck)}
        ${renderReportSection('Chain checks', report.chainChecks, renderChainCheck)}
      </div>
    </div>
  `;
}

function renderSourceReport(item) {
  return `
    <strong>${escapeHtml(item.sourceName)}</strong>
    <div class="muted">${escapeHtml(item.format)} | nodes ${item.nodes}</div>
    ${item.warnings.length ? `<div class="warn">Warnings: ${escapeHtml(item.warnings.join(' | '))}</div>` : ''}
    ${item.errors.length ? `<div class="error">Errors: ${escapeHtml(item.errors.join(' | '))}</div>` : ''}
  `;
}

function renderRuleCoverage(item) {
  return `
    <strong>${escapeHtml(item.ruleName)}</strong>
    <div class="muted">matches ${item.matches}</div>
  `;
}

function renderEgressCheck(item) {
  return `
    <strong>${escapeHtml(item.egressName)}</strong>
    <div class="muted">${escapeHtml(item.protocol)} | ${escapeHtml(item.endpoint.host || 'unset')}${item.endpoint.port ? `:${item.endpoint.port}` : ''}</div>
    ${item.tcp ? `<div>${escapeHtml(item.tcp.status)}${item.tcp.message ? ` - ${escapeHtml(item.tcp.message)}` : ''}</div>` : '<div class="muted">No TCP endpoint to test.</div>'}
    ${item.warnings.length ? `<div class="warn">${escapeHtml(item.warnings.join(' | '))}</div>` : ''}
  `;
}

function renderChainCheck(item) {
  return `
    <strong>${escapeHtml(item.tag)}</strong>
    <div class="muted">${escapeHtml(item.sourceName)} / ${escapeHtml(item.nodeName)} -> ${escapeHtml(item.egressName)}</div>
    ${item.issues.length ? `<div class="warn">${escapeHtml(item.issues.join(' | '))}</div>` : '<div class="muted">No obvious chain issues.</div>'}
  `;
}

function renderReportSection(title, items, renderItem) {
  if (!items || items.length === 0) {
    return `<div class="list-item"><strong>${escapeHtml(title)}</strong><div class="muted">Nothing to show.</div></div>`;
  }
  return `
    <div class="list-item">
      <strong>${escapeHtml(title)}</strong>
      <div class="list" style="margin-top:8px">
        ${items.map((item) => `<div class="list-item">${renderItem(item)}</div>`).join('')}
      </div>
    </div>
  `;
}

function renderPreview(preview) {
  if (preview.loading) {
    return '<strong>正在解析…</strong><div class="muted">正在读取并检查这个订阅来源。</div>';
  }
  const count = preview.nodes?.length ?? 0;
  const warnings = preview.warnings?.length ?? 0;
  const errors = preview.errors?.length ?? 0;
  const sample = (preview.nodes || [])
    .slice(0, 4)
    .map((node) => `${node.name} (${node.protocol})`)
    .join(' | ');
  return `
    <strong>${escapeHtml(preview.format || 'unknown')}</strong>
    <div class="muted">nodes ${count} | warnings ${warnings} | errors ${errors}</div>
    ${sample ? `<div>${escapeHtml(sample)}</div>` : ''}
    ${warnings ? `<div class="warn">${escapeHtml(preview.warnings.join(' | '))}</div>` : ''}
    ${errors ? `<div class="error">${escapeHtml(preview.errors.join(' | '))}</div>` : ''}
  `;
}

function renderSourceTest(result) {
  if (result.loading) {
    return '<strong>Testing...</strong><div class="muted">Reading source, parsing nodes, and checking TCP reachability.</div>';
  }
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const openCount = checks.filter((item) => item.status === 'open').length;
  const latencyValues = checks.map((item) => Number(item.latencyMs)).filter((value) => Number.isFinite(value));
  const avgLatency = latencyValues.length
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : null;
  const protocols = Object.entries(result.protocolCounts || {})
    .map(([protocol, count]) => `${protocol} ${count}`)
    .join(' | ');
  const rows = checks.slice(0, 10).map((item) => {
    const latency = item.latencyMs == null ? '' : ` ${item.latencyMs}ms`;
    const message = item.message ? ` - ${item.message}` : '';
    return `
      <div class="list-item">
        <strong>${escapeHtml(item.name || 'unnamed')}</strong>
        <div class="muted">${escapeHtml(item.protocol || 'unknown')} | ${escapeHtml(item.status || 'unknown')}${escapeHtml(latency)}${escapeHtml(message)}</div>
      </div>
    `;
  }).join('');
  return `
    <strong>Source test</strong>
    <div class="muted">
      ${escapeHtml(result.status || 'unknown')} | nodes ${Number(result.nodes || 0)} | checked ${Number(result.checked || 0)} | open ${openCount}${avgLatency == null ? '' : ` | avg ${avgLatency}ms`}
    </div>
    <div class="muted">fetch ${Number(result.fetchMs || 0)}ms | parse ${Number(result.parseMs || 0)}ms | total ${Number(result.elapsedMs || 0)}ms | ${Number(result.bytes || 0)} bytes</div>
    ${protocols ? `<div>${escapeHtml(protocols)}</div>` : ''}
    ${result.truncated ? '<div class="warn">Only the first 20 nodes were tested.</div>' : ''}
    ${rows ? `<div class="list" style="margin-top:8px">${rows}</div>` : ''}
    ${result.warnings?.length ? `<div class="warn">${escapeHtml(result.warnings.join(' | '))}</div>` : ''}
    ${result.errors?.length ? `<div class="error">${escapeHtml(result.errors.join(' | '))}</div>` : ''}
  `;
}

function updateCounts() {
  const counts = {
    '#source-count': state.sources.length,
    '#egress-count': state.egresses.length,
    '#rule-count': state.rules.length,
  };
  Object.entries(counts).forEach(([selector, value]) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = String(value);
  });
}

function statCard(label, value) {
  return `<div class="stat"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(String(value ?? 0))}</div></div>`;
}

function emptyState(title, subtitle) {
  return `<div class="list-item"><strong>${escapeHtml(title)}</strong><div class="muted">${escapeHtml(subtitle)}</div></div>`;
}

function textField(path, label, value, extraClass = '', type = 'text') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `<label class="${cls}"><span>${escapeHtml(label)}</span><input data-path="${escapeHtml(path)}" type="${type}" value="${escapeHtml(value ?? '')}" /></label>`;
}

function numberField(path, label, value, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `<label class="${cls}"><span>${escapeHtml(label)}</span><input data-path="${escapeHtml(path)}" type="number" value="${value ?? ''}" /></label>`;
}

function checkboxField(path, label, checked, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `<label class="${cls}"><span>${escapeHtml(label)}</span><input data-path="${escapeHtml(path)}" type="checkbox" ${checked ? 'checked' : ''} /></label>`;
}

function selectField(path, label, options, value, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `
    <label class="${cls}">
      <span>${escapeHtml(label)}</span>
      <select data-path="${escapeHtml(path)}">
        ${options
          .map((option) => {
            const entry = typeof option === 'string' ? { value: option, label: option } : option;
            const selected = normalizeSelectValue(entry.value) === normalizeSelectValue(value);
            return `<option value="${escapeHtml(entry.value)}" ${selected ? 'selected' : ''}>${escapeHtml(entry.label)}</option>`;
          })
          .join('')}
      </select>
    </label>
  `;
}

function pickerField(path, label, options, selectedValues, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  const selected = new Set((selectedValues || []).map((value) => String(value)));
  return `
    <div class="${cls}">
      <span>${escapeHtml(label)}</span>
      <div class="picker-grid">
        ${options
          .map((option) => {
            const entry = typeof option === 'string' ? { value: option, label: option, meta: '' } : option;
            const checked = selected.has(String(entry.value));
            return `
              <label class="picker-chip ${checked ? 'picked' : ''}">
                <input data-array-path="${escapeHtml(path)}" data-array-value="${escapeHtml(entry.value)}" type="checkbox" ${checked ? 'checked' : ''} />
                <span>${escapeHtml(entry.label)}</span>
                ${entry.meta ? `<small>${escapeHtml(entry.meta)}</small>` : ''}
              </label>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function protocolChecklistField(path, label, selectedValues, extraClass = '', locks = {}) {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  const selected = new Set((selectedValues || []).map((value) => String(value)));
  const implicitAll = selected.size === 0;
  const allValues = PROTOCOL_OPTIONS.join(',');
  return `
    <div class="${cls}">
      <span>${escapeHtml(label)}</span>
      <div class="protocol-check-list">
        ${PROTOCOL_OPTIONS.map((protocol) => {
          const checked = implicitAll || selected.has(protocol);
          const lock = locks[protocol];
          const disabled = Boolean(lock && !checked);
          const title = lock ? `Used by ${lock.ruleName}` : '';
          return `
            <label class="protocol-check-item ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}" title="${escapeHtml(title)}">
              <input
                data-array-path="${escapeHtml(path)}"
                data-array-value="${escapeHtml(protocol)}"
                data-array-implicit-all="true"
                data-array-all-values="${escapeHtml(allValues)}"
                type="checkbox"
                ${checked ? 'checked' : ''}
                ${disabled ? 'disabled' : ''}
              />
              <span class="protocol-check-name">${escapeHtml(PROTOCOL_LABELS[protocol] || protocol)}</span>
              <small>${escapeHtml(lock ? `used: ${lock.ruleName}` : protocol)}</small>
            </label>
          `;
        }).join('')}
      </div>
      <small class="field-hint">Checked protocols are exported for this rule. A protocol already used by another overlapping source rule is locked here; choose multiple target egresses in one rule if you intentionally want the same protocol to go to multiple homes.</small>
    </div>
  `;
}

function nodeChecklistField(path, label, choices, extraClass = '', locks = {}) {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  const visibleChoices = Array.isArray(choices) ? choices.filter((choice) => !choice.placeholder) : [];
  const ruleIndex = Number(String(path).match(/^rules\.(\d+)/)?.[1] ?? -1);
  const rule = state.rules[ruleIndex];
  const explicit = isExplicitNodeSelection(rule || {});
  const selectedNodeIds = Array.isArray(rule?.match?.nodeIds)
    ? rule.match.nodeIds.filter((id) => id && id !== EMPTY_NODE_SELECTION)
    : [];
  return `
    <div class="${cls}">
      <span>${escapeHtml(label)}</span>
      <div class="protocol-check-list node-check-list">
        ${visibleChoices.length > 0
          ? visibleChoices.map((choice) => {
              const checked = isRuleNodeChoiceChecked(rule || {}, choice);
              const lock = locks[choice.id];
              const disabled = Boolean(lock && !checked);
              const latency = choice.latencyMs == null ? '—' : `${choice.latencyMs}ms`;
              const endpoint = [choice.server, choice.port].filter(Boolean).join(':');
              const subtitle = [PROTOCOL_LABELS[choice.protocol] || choice.protocol, endpoint, choice.sourceName, latency].filter(Boolean).join(' · ');
              const titleParts = [choice.name, subtitle, lock ? `used by ${lock.ruleName}` : ''].filter(Boolean);
              return `
                <label class="protocol-check-item node-check-item ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}" title="${escapeHtml(titleParts.join(' | '))}">
                  <input
                    data-rule-node-choice
                    data-rule-index="${ruleIndex}"
                    data-rule-node-id="${escapeHtml(choice.id)}"
                    data-rule-node-name="${escapeHtml(choice.name)}"
                    data-rule-node-protocol="${escapeHtml(choice.protocol)}"
                    type="checkbox"
                    ${checked ? 'checked' : ''}
                    ${disabled ? 'disabled' : ''}
                    aria-describedby="node-choice-${escapeHtml(choice.id)}"
                  />
                  <span class="node-check-main">
                    <span class="protocol-check-name">${escapeHtml(choice.name)}</span>
                    <small id="node-choice-${escapeHtml(choice.id)}">${escapeHtml(subtitle)}${choice.message ? ` · ${choice.message}` : ''}</small>
                  </span>
                  <small>${escapeHtml(lock ? `used: ${lock.ruleName}` : explicit ? (selectedNodeIds.length > 0 ? 'selected' : 'none') : 'auto')}</small>
                </label>
              `;
            }).join('')
          : `<div class="node-check-empty">${escapeHtml(nodeChoicesEmptyMessage(rule, choices))}</div>`}
      </div>
      <small class="field-hint">选中具体节点后，会只输出这些节点；如果没有手动选节点，就按协议筛选回退。已被其他 Rule 占用的节点会变灰。</small>
    </div>
  `;
}

function nodeChoicesEmptyMessage(rule, choices) {
  if (!rule) return '先选择一个 Rule。';
  const sourceIds = getRuleSourceIds(rule);
  if (!sourceIds.length) return '先选一个 Source。';
  const loadingSource = sourceIds.find((sourceId) => ui.previews[sourceId]?.loading || ui.sourceTests[sourceId]?.loading);
  if (loadingSource) return '正在自动测试来源节点…';
  if (Array.isArray(choices) && choices.length === 0) return '当前 Source 没有可用节点。';
  return '暂无节点。';
}

function textareaField(path, label, value, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `<label class="${cls}"><span>${escapeHtml(label)}</span><textarea data-path="${escapeHtml(path)}">${escapeHtml(value ?? '')}</textarea></label>`;
}

function nodeSummaryField(label, value, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `<div class="${cls}"><span>${escapeHtml(label)}</span><div class="node-summary-box">${escapeHtml(value || '未选择')}</div></div>`;
}

function normalizeSelectValue(value) {
  return String(value ?? '');
}

function importEgressFromQuickBox(index) {
  const input = root.querySelector(`[data-egress-import="${Number(index)}"]`);
  if (!input || !input.value.trim()) throw new Error('先粘贴一行出口配置。');
  return importEgressQuickText(input.value, index, { notify: false, throwOnError: true });
}

function importEgressQuickText(value, index, options = {}) {
  const parsed = parseEgressQuickInput(value);
  if (!parsed) {
    if (options.throwOnError) throw new Error('无法识别这个出口格式。');
    return false;
  }
  const egress = state.egresses[index];
  if (!egress) {
    if (options.throwOnError) throw new Error('没有找到这个 Egress。');
    return false;
  }
  applyParsedEgress(egress, parsed);
  ui.activeItems.egresses = egress.id;
  queueSave(true);
  window.setTimeout(() => renderEditors(), IMPORT_RENDER_DELAY_MS);
  if (options.notify !== false) showActionFeedback('Egress 已识别', 'done');
  return true;
}

function parseEgressQuickInput(value) {
  const line = String(value ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return null;
  const normalized = line
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
  return parseEgressUrl(normalized) || parseColonEgress(normalized);
}

function parseEgressUrl(value) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(':', '').toLowerCase();
  const protocol = normalizeImportProtocol(scheme);
  const port = parseImportPort(url.port || defaultImportPort(scheme));
  const server = stripHostBrackets(url.hostname);
  if (!protocol || !server || !port) return null;

  const parsed = {
    protocol,
    server,
    port,
    tlsEnabled: scheme === 'https' || ['trojan', 'hysteria2', 'tuic'].includes(protocol),
  };
  const nodeName = decodeUrlPart(url.hash.replace(/^#/, ''));
  if (nodeName) parsed.name = nodeName;
  assignImportedCredentials(parsed, protocol, decodeUrlPart(url.username), decodeUrlPart(url.password));
  applyImportedUrlParams(parsed, url, scheme);
  return parsed;
}

function parseColonEgress(value) {
  const parts = value.split(':').map((part) => part.trim());
  if (parts.length < 2) return null;
  let username = '';
  let password = '';
  if (parts.length >= 4) {
    password = parts.pop();
    username = parts.pop();
  }
  const port = parseImportPort(parts.pop());
  const hostInfo = parseImportHost(parts.join(':'));
  if (!hostInfo.server || !port) return null;
  const protocol = hostInfo.protocol || 'http';
  const parsed = {
    protocol,
    server: hostInfo.server,
    port,
    tlsEnabled: Boolean(hostInfo.tlsEnabled || ['trojan', 'hysteria2', 'tuic'].includes(protocol)),
  };
  assignImportedCredentials(parsed, protocol, username, password);
  return parsed;
}

function parseImportHost(value) {
  let host = String(value ?? '').trim();
  let protocol = '';
  let tlsEnabled = false;
  const schemeMatch = host.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    protocol = normalizeImportProtocol(scheme);
    tlsEnabled = scheme === 'https';
    host = schemeMatch[2];
  }
  if (host.includes('@')) host = host.slice(host.lastIndexOf('@') + 1);
  host = host.replace(/[/?#].*$/, '').replace(/^\/+/, '');
  return { protocol, server: stripHostBrackets(host), tlsEnabled };
}

function normalizeImportProtocol(value) {
  const protocol = String(value ?? '').toLowerCase();
  if (protocol === 'https') return 'http';
  if (['socks', 'socks4', 'socks5'].includes(protocol)) return 'socks';
  if (['ss', 'shadowsocks'].includes(protocol)) return 'shadowsocks';
  if (['hy2', 'hysteria2'].includes(protocol)) return 'hysteria2';
  return PROTOCOL_OPTIONS.includes(protocol) ? protocol : '';
}

function defaultImportPort(scheme) {
  if (scheme === 'http') return 80;
  if (scheme === 'socks' || scheme === 'socks4' || scheme === 'socks5') return 1080;
  if (scheme === 'shadowsocks' || scheme === 'ss') return 8388;
  return ['https', 'trojan', 'hysteria2', 'hy2', 'tuic'].includes(scheme) ? 443 : '';
}

function assignImportedCredentials(parsed, protocol, username, password) {
  if (protocol === 'http' || protocol === 'socks') {
    parsed.username = username || '';
    parsed.password = password || '';
    return;
  }
  if (protocol === 'shadowsocks') {
    const decoded = !password && username ? decodeBase64Url(username) : '';
    const decodedParts = decoded ? splitOnce(decoded, ':') : null;
    parsed.method = decodedParts?.[0] || username || '';
    parsed.password = decodedParts?.[1] || password || '';
    return;
  }
  if (protocol === 'vmess' || protocol === 'vless') {
    parsed.uuid = username || '';
    return;
  }
  if (protocol === 'trojan' || protocol === 'hysteria2') {
    parsed.password = username || password || '';
    return;
  }
  if (protocol === 'tuic') {
    parsed.uuid = username || '';
    parsed.password = password || '';
  }
}

function applyImportedUrlParams(parsed, url, scheme) {
  const params = url.searchParams;
  const fieldMap = [
    ['security', ['security']],
    ['flow', ['flow']],
    ['packetEncoding', ['packetEncoding', 'packet-encoding', 'packet_encoding']],
    ['sni', ['sni', 'peer', 'servername', 'serverName']],
    ['transportType', ['type', 'transport', 'network']],
    ['path', ['path']],
    ['host', ['host']],
    ['serviceName', ['serviceName', 'service_name']],
    ['alpn', ['alpn']],
    ['fingerprint', ['fp', 'fingerprint']],
    ['realityPublicKey', ['pbk', 'publicKey', 'public_key']],
    ['realityShortId', ['sid', 'shortId', 'short_id']],
    ['realitySpiderX', ['spx', 'spiderX', 'spider_x']],
    ['plugin', ['plugin']],
    ['pluginOptions', ['pluginOpts', 'plugin-opts', 'plugin_opts']],
    ['obfs', ['obfs']],
    ['obfsPassword', ['obfsPassword', 'obfs-password', 'obfs_password']],
    ['congestionControl', ['congestionControl', 'congestion_control']],
    ['udpRelayMode', ['udpRelayMode', 'udp_relay_mode']],
  ];
  fieldMap.forEach(([field, names]) => {
    const value = readUrlParam(params, names);
    if (value) parsed[field] = value;
  });
  const tlsValue = readUrlParam(params, ['tls']);
  const security = parsed.security || '';
  if (
    scheme === 'https' ||
    ['tls', 'reality'].includes(security.toLowerCase()) ||
    ['1', 'true', 'yes', 'on'].includes(String(tlsValue).toLowerCase())
  ) {
    parsed.tlsEnabled = true;
  }
  const allowInsecure = readUrlParam(params, ['allowInsecure', 'allow_insecure', 'skip-cert-verify']);
  if (allowInsecure) parsed.allowInsecure = ['1', 'true', 'yes', 'on'].includes(String(allowInsecure).toLowerCase());
}

function applyParsedEgress(egress, parsed) {
  if (parsed.name && (!egress.name || /^Egress \d+$/i.test(egress.name))) {
    egress.name = parsed.name;
  }
  [
    'protocol',
    'server',
    'port',
    'username',
    'password',
    'uuid',
    'method',
    'security',
    'flow',
    'packetEncoding',
    'tlsEnabled',
    'allowInsecure',
    'sni',
    'transportType',
    'path',
    'host',
    'serviceName',
    'alpn',
    'fingerprint',
    'realityPublicKey',
    'realityShortId',
    'realitySpiderX',
    'plugin',
    'pluginOptions',
    'obfs',
    'obfsPassword',
    'congestionControl',
    'udpRelayMode',
  ].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(parsed, field)) {
      egress[field] = parsed[field];
    }
  });
}

function parseImportPort(value) {
  if (value === '' || value == null) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function stripHostBrackets(value) {
  return String(value ?? '').trim().replace(/^\[(.*)]$/, '$1');
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(String(value ?? '')).trim();
  } catch {
    return String(value ?? '').trim();
  }
}

function decodeBase64Url(value) {
  try {
    const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function splitOnce(value, delimiter) {
  const index = String(value).indexOf(delimiter);
  if (index < 0) return null;
  return [String(value).slice(0, index), String(value).slice(index + delimiter.length)];
}

function readUrlParam(params, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of params.entries()) {
    if (wanted.has(key.toLowerCase())) return value;
  }
  return '';
}

function copyCurrentConfig() {
  if (!ui.generated?.config) throw new Error('请先生成配置。');
  return copyText(JSON.stringify(ui.generated.config, null, 2));
}

function openRouteCopySheet(index) {
  const output = getRouteOutputByIndex(index);
  if (!output?.code) throw new Error('请先生成这个链路输出。');
  ui.routeCopySheet = {
    index,
    tab: 'subscription',
    protocols: getRouteCopySheetProtocolChoices(output),
  };
  renderRouteCopySheet();
  showActionFeedback('已打开复制面板', 'done');
}

function closeRouteCopySheet() {
  if (!ui.routeCopySheet) return;
  ui.routeCopySheet = null;
  renderRouteCopySheet();
  showActionFeedback('已关闭复制面板', 'done');
}

function setRouteCopySheetTab(tab) {
  if (!ui.routeCopySheet) return;
  ui.routeCopySheet.tab = tab === 'links' ? 'links' : 'subscription';
  renderRouteCopySheet();
}

function resetRouteCopySheetProtocols() {
  const data = getRouteCopySheetData();
  if (!data) return;
  ui.routeCopySheet.protocols = getRouteCopySheetProtocolChoices(data.output);
  renderRouteCopySheet();
}

function updateRouteCopySheetProtocol(protocol, checked) {
  const sheet = ui.routeCopySheet;
  if (!sheet) return;
  const current = new Set(Array.isArray(sheet.protocols) ? sheet.protocols : []);
  if (checked) current.add(protocol);
  else current.delete(protocol);
  sheet.protocols = Array.from(current);
  renderRouteCopySheet();
}

function copyText(value) {
  const text = String(value ?? '');
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('剪贴板不可用。');
  return Promise.resolve();
}

function copyRouteOutput(index, mode = 'full') {
  const output = getRouteOutputByIndex(index);
  if (!output?.code) throw new Error('请先生成这个链路输出。');
  if (mode === 'links') return copyText(getRouteOutputLinkList(output));
  if (mode === 'nodes') return copyText(getRouteOutputNodeList(output.code));
  if (mode === 'protocols') return copyText(filterRouteOutputByProtocols(output.code, getSelectedRouteCopyProtocols(output)));
  return copyText(output.code);
}

function getRouteOutputByIndex(index) {
  return Array.from(getRouteOutputMap().values()).find((item) => item.index === index) || null;
}

function getRouteCopyActionLabel(mode) {
  if (mode === 'links') return '复制全部链接';
  if (mode === 'nodes') return '复制节点列表';
  if (mode === 'protocols') return '复制选中协议';
  return '复制订阅内容';
}

function getSelectedRouteCopyProtocols(output) {
  const selected = Array.isArray(ui.routeCopySheet?.protocols) ? ui.routeCopySheet.protocols.filter(Boolean) : [];
  return uniqueStrings(selected.filter((protocol) => getRouteCopySheetProtocolChoices(output).includes(protocol)));
}

function getRouteOutputNodeList(code) {
  const entries = splitRouteOutputCode(code).entries;
  if (entries.length === 0) throw new Error('这个链路没有可复制的节点。');
  return entries.join('\n');
}

function getRouteOutputLinkList(output) {
  const links = Array.isArray(output?.links) ? output.links.map((link) => String(link?.uri || '').trim()).filter(Boolean) : [];
  if (links.length === 0) throw new Error('这个链路没有可复制的链接。');
  return links.join('\n');
}

function filterRouteOutputByProtocols(code, protocols) {
  const selected = new Set(protocols.map(normalizeRouteProtocol).filter(Boolean));
  if (selected.size === 0) throw new Error('请先选择至少一个协议。');
  const { header, entries } = splitRouteOutputCode(code);
  const filtered = entries.filter((line) => selected.has(getRouteOutputLineProtocol(line)));
  if (filtered.length === 0) throw new Error('所选协议没有对应输出。');
  return [...header, ...renumberRouteOutputEntries(filtered)].join('\n');
}

function getRouteOutputProtocolCounts(code) {
  const counts = new Map();
  for (const line of splitRouteOutputCode(code).entries) {
    const protocol = getRouteOutputLineProtocol(line);
    if (!protocol) continue;
    counts.set(protocol, (counts.get(protocol) || 0) + 1);
  }
  return counts;
}

function splitRouteOutputCode(code) {
  const lines = String(code || '').split(/\r?\n/);
  const entryStart = lines.findIndex((line) => /^\d+\.\s/.test(line));
  if (entryStart < 0) return { header: lines, entries: [] };
  return {
    header: lines.slice(0, entryStart),
    entries: lines.slice(entryStart),
  };
}

function getRouteOutputLineProtocol(line) {
  const match = String(line || '').match(/^\d+\.\s*([^|]+?)\s*\|/);
  return normalizeRouteProtocol(match?.[1]);
}

function normalizeRouteProtocol(value) {
  return String(value || '').trim().toLowerCase();
}

function renumberRouteOutputEntries(entries) {
  return entries.map((line, index) => String(line).replace(/^\d+\./, `${index + 1}.`));
}

function getExportUrl(format, download = false) {
  const baseUrl = runtime.publicBaseUrl || window.location.origin;
  const url = new URL(`/api/export/${encodeURIComponent(format)}`, baseUrl);
  if (runtime.subscriptionToken) url.searchParams.set('token', runtime.subscriptionToken);
  if (download) url.searchParams.set('download', '1');
  return url.toString();
}

function getExportQrUrl(format) {
  return getTextQrUrl(getExportUrl(format));
}

function getTextQrUrl(text) {
  return `/api/qr?text=${encodeURIComponent(String(text ?? ''))}`;
}

function getShadowrocketImportUrl(exportUrl) {
  return `shadowrocket://add/sub://${base64Encode(exportUrl)}?remark=${encodeURIComponent('Home Relay Studio')}`;
}

function base64Encode(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error || message;
    } catch {
      // Keep the plain response text.
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function newId(prefix) {
  const time = Date.now().toString(36).slice(-6);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${time}${random}`;
}
