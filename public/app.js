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

const ui = {
  mode: 'config',
  generated: null,
  diagnosis: null,
  previews: {},
  sourceTests: {},
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
  openDetails: new Set(),
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

      <div class="workflow-grid full-row">
        <section class="band full">
          <div class="section-head">
            <div>
              <h2>订阅输出</h2>
              <div class="meta">先生成预检，再复制、扫码或一键导入。</div>
            </div>
          </div>
          <div id="output-panel"></div>
          <details class="advanced export-settings" data-details-key="export:advanced" ${detailsOpen('export:advanced')}>
            <summary>高级导出设置</summary>
            <div class="field-grid" id="export-grid"></div>
          </details>
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
  root.querySelector('#export-grid').innerHTML = renderExportGrid();
  updateCounts();
}

function renderRouteSetPanel() {
  const panel = root.querySelector('#route-set-panel');
  if (!panel) return;
  const sets = getRouteSets();
  const outputMap = getRouteOutputMap();
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
          <div class="muted">${output ? `${output.nodeCount} output nodes | saved ${escapeHtml(output.updatedAt || '')}` : 'not generated yet'}</div>
        </td>
        <td>
          <button data-action="copy-route-output" data-route-set-index="${set.index}" ${output ? '' : 'disabled'}>Copy</button>
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
      <div class="route-set-count">${sets.length}</div>
    </div>
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

function buildRouteOutputSnapshots(generated) {
  const assignments = Array.isArray(generated?.assignments) ? generated.assignments : [];
  if (assignments.length === 0) return [];
  const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return getRouteSets().map((set) => {
    const matched = assignments.filter((assignment) => assignmentBelongsToRouteSet(assignment, set));
    const protocols = uniqueStrings(matched.map((assignment) => assignment.node?.protocol || '').filter(Boolean));
    const sourceNames = set.sourceIds.map((id) => state.sources.find((source) => source.id === id)?.name || id);
    const egressNames = set.egressIds.map((id) => state.egresses.find((egress) => egress.id === id)?.name || id);
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

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value)).filter(Boolean)));
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

function renderRule(rule, index) {
  const sourceOptions = state.sources.map((source) => ({ value: source.id, label: source.name, meta: source.id }));
  const egressOptions = state.egresses.map((egress) => ({ value: egress.id, label: egress.name, meta: `${egress.protocol} ${egress.id}` }));
  const protocolLocks = getRuleProtocolLocks(rule, index);
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
          ${protocolChecklistField(`rules.${index}.match.protocols`, '协议筛选', rule.match?.protocols || [], 'wide', protocolLocks)}
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
            ${textField(`rules.${index}.notes`, '备注', rule.notes, 'wide')}
          </div>
        </details>
      </div>
    </div>
  `;
}

function getRuleProtocolLocks(rule, ruleIndex) {
  const locks = {};
  for (const protocol of PROTOCOL_OPTIONS) {
    const owner = state.rules.find((candidate, index) => {
      if (index === ruleIndex || candidate.enabled === false) return false;
      if (!rulesOverlapSources(rule, candidate)) return false;
      const protocols = candidate.match?.protocols || [];
      return protocols.length === 0 || protocols.includes(protocol);
    });
    if (owner) {
      locks[protocol] = {
        ruleName: owner.name || owner.id,
      };
    }
  }
  return locks;
}

function rulesOverlapSources(a, b) {
  const aSources = a.match?.sourceIds || [];
  const bSources = b.match?.sourceIds || [];
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
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('toggle', onToggle, true);
}

function onClick(event) {
  const exportViewButton = event.target.closest('[data-output-view]');
  if (exportViewButton) {
    ui.exportView = exportViewButton.dataset.outputView;
    renderOutput();
    return;
  }

  const entityCard = event.target.closest('[data-select-collection]');
  if (entityCard) {
    setActiveItem(entityCard.dataset.selectCollection, entityCard.dataset.id);
    renderEditors();
    return;
  }

  const routeSetCard = event.target.closest('[data-route-set]');
  if (routeSetCard && !event.target.closest('[data-action]')) {
    selectRouteSet(Number(routeSetCard.dataset.routeSet));
    return;
  }

  const tabButton = event.target.closest('[data-view]');
  if (tabButton) {
    ui.mode = tabButton.dataset.view;
    renderOutput();
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  const menu = button.closest('.tools-menu, .more-menu');
  if (menu) menu.removeAttribute('open');

  if (action === 'add-source') addSource();
  if (action === 'add-egress') addEgress();
  if (action === 'add-rule') addRule();
  if (action === 'duplicate-source') duplicateItem('sources', id, 'src');
  if (action === 'duplicate-egress') duplicateItem('egresses', id, 'eg');
  if (action === 'duplicate-rule') duplicateItem('rules', id, 'rule');
  if (action === 'rename-entity') renameItem(button.dataset.collection, id);
  if (action === 'delete-source') removeItem('sources', id);
  if (action === 'delete-egress') removeItem('egresses', id);
  if (action === 'delete-rule') removeItem('rules', id);
  if (action === 'save') saveNow().catch(() => {});
  if (action === 'generate') generateConfig();
  if (action === 'diagnose') diagnose().catch(console.error);
  if (action === 'upgrade-now') upgradeNow().catch(console.error);
  if (action === 'preview-source') previewSource(id).catch(console.error);
  if (action === 'test-source') testSource(id).catch(console.error);
  if (action === 'copy-config') copyCurrentConfig();
  if (action === 'copy-route-output') copyRouteOutput(Number(button.dataset.routeSetIndex)).catch(console.error);
  if (action === 'copy-export-link') copyText(getExportUrl(ui.exportFormat)).catch(console.error);
  if (action === 'open-export-link') window.open(getExportUrl(ui.exportFormat), '_blank', 'noopener');
  if (action === 'download-config') downloadText('sing-box.config.json', JSON.stringify(ui.generated?.config || {}, null, 2));
  if (action === 'download-snapshot') downloadText('relay.snapshot.json', JSON.stringify(ui.generated?.snapshot || {}, null, 2));
}

function onInput(event) {
  const target = event.target;
  if (!target.matches('[data-path]')) return;
  updateStateFromInput(target);
  queueSave(false);
}

function onChange(event) {
  const target = event.target;
  if (target.matches('[data-output-format-select]')) {
    ui.exportFormat = target.value;
    renderOutput();
    return;
  }
  if (target.matches('[data-array-path]')) {
    updateArrayFromInput(target);
    queueSave(true);
    target.closest('.picker-chip')?.classList.toggle('picked', target.checked);
    target.closest('.protocol-check-item')?.classList.toggle('checked', target.checked);
    return;
  }
  if (!target.matches('[data-path]')) return;
  updateStateFromInput(target);
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
  if (index < 0) return;
  const clone = structuredClone(list[index]);
  clone.id = newId(prefix);
  clone.name = `${clone.name} copy`;
  list.splice(index + 1, 0, clone);
  ui.activeItems[collection] = clone.id;
  renderEditors();
  queueSave(true);
}

function renameItem(collection, id) {
  const list = state[collection];
  if (!Array.isArray(list)) return;
  const item = list.find((entry) => entry.id === id);
  if (!item) return;
  const nextName = window.prompt('修改名称', item.name || item.id);
  if (nextName === null) return;
  const name = nextName.trim();
  if (!name || name === item.name) return;
  item.name = name;
  ui.activeItems[collection] = item.id;
  renderEditors();
  queueSave(true);
}

function removeItem(collection, id) {
  const list = state[collection];
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;
  const itemName = list[index]?.name || id;
  if (!window.confirm(`确定删除“${itemName}”吗？`)) return;
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
  try {
    ui.previews[id] = await api('/api/parse-source', {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
  } catch (error) {
    ui.previews[id] = {
      format: 'error',
      nodes: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  renderEditors();
}

async function testSource(id) {
  const source = state.sources.find((item) => item.id === id);
  if (!source) return;
  ui.sourceTests[id] = { loading: true, checks: [], warnings: [], errors: [] };
  renderCollection('sources');
  try {
    ui.sourceTests[id] = await api('/api/test-source', {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
  } catch (error) {
    ui.sourceTests[id] = {
      status: 'error',
      checks: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  renderEditors();
}

async function generateConfig() {
  ui.mode = 'config';
  ui.preflight = { running: true, error: '' };
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
  } finally {
    ui.preflight.running = false;
    updateGenerateButton();
    renderRouteSetPanel();
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
  }
  renderUpgradePanel();
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
  const button = root.querySelector('[data-action="generate"]');
  if (!button) return;
  button.disabled = ui.preflight.running;
  button.textContent = ui.preflight.running ? '正在预检…' : '生成 / 预检';
}

function renderOutput() {
  const panel = root.querySelector('#output-panel');
  if (!panel) return;
  panel.innerHTML = ui.mode === 'config' ? renderExportOutput() : renderDiagnoseOutput();
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

function textareaField(path, label, value, extraClass = '') {
  const cls = extraClass ? `field ${extraClass}` : 'field';
  return `<label class="${cls}"><span>${escapeHtml(label)}</span><textarea data-path="${escapeHtml(path)}">${escapeHtml(value ?? '')}</textarea></label>`;
}

function normalizeSelectValue(value) {
  return String(value ?? '');
}

function copyCurrentConfig() {
  if (!ui.generated?.config) return;
  navigator.clipboard.writeText(JSON.stringify(ui.generated.config, null, 2)).catch(() => {});
}

function copyText(value) {
  return navigator.clipboard.writeText(String(value ?? '')).catch(() => {});
}

function copyRouteOutput(index) {
  const output = Array.from(getRouteOutputMap().values()).find((item) => item.index === index);
  return copyText(output?.code || '');
}

function getExportUrl(format, download = false) {
  const baseUrl = runtime.publicBaseUrl || window.location.origin;
  const url = new URL(`/api/export/${encodeURIComponent(format)}`, baseUrl);
  if (runtime.subscriptionToken) url.searchParams.set('token', runtime.subscriptionToken);
  if (download) url.searchParams.set('download', '1');
  return url.toString();
}

function getExportQrUrl(format) {
  return `/api/qr?format=${encodeURIComponent(format)}&text=${encodeURIComponent(getExportUrl(format))}`;
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
