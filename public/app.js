const root = document.getElementById('app');

const PROTOCOL_OPTIONS = ['http', 'socks', 'shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic'];
const SOURCE_KIND_OPTIONS = ['url', 'text'];
const FORMAT_OPTIONS = ['auto', 'sing-box', 'clash', 'uri', 'json', 'yaml'];
const TARGET_MODE_OPTIONS = ['append', 'replace'];
const EXPORT_FORMATS = [
  { id: 'sing-box', label: 'Sing-box' },
  { id: 'clash', label: 'Clash' },
  { id: 'v2ray', label: 'V2Ray' },
  { id: 'shadowrocket', label: 'Shadowrocket' },
];
const EXPORT_VIEWS = [
  { id: 'link', label: 'Link' },
  { id: 'qr', label: 'QR' },
];

const ui = {
  mode: 'config',
  generated: null,
  diagnosis: null,
  previews: {},
  exportFormat: 'sing-box',
  exportView: 'link',
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
};

let state = null;
let runtime = { publicBaseUrl: '' };

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
          <div class="subtle">Build sources, home egresses, and relay rules in one place.</div>
          <input class="project-name" data-path="projectName" value="${escapeHtml(state.projectName)}" />
        </div>
        <div class="toolbar">
          <button data-action="add-source">Add source</button>
          <button data-action="add-egress">Add egress</button>
          <button data-action="add-rule">Add rule</button>
          <button class="primary" data-action="save">Save</button>
          <button class="primary" data-action="generate">Generate</button>
          <button class="primary" data-action="diagnose">Diagnose</button>
          <button data-action="upgrade-now">一键升级</button>
        </div>
      </section>

      <section class="upgrade-strip is-hidden" id="upgrade-panel"></section>

      <section class="band stats" id="stats"></section>

      <div class="config-grid">
        <section class="band config-section">
          <div class="section-head">
            <h2>Sources</h2>
            <div class="meta">Raw subscription catalog</div>
          </div>
          <div class="entity-list" id="source-list"></div>
        </section>

        <section class="band config-section">
          <div class="section-head">
            <h2>Egresses</h2>
            <div class="meta">Home broadband catalog</div>
          </div>
          <div class="entity-list" id="egress-list"></div>
        </section>

        <section class="band config-section">
          <div class="section-head">
            <h2>Rules</h2>
            <div class="meta">Map protocols, names, and sources to egresses</div>
          </div>
          <div class="entity-list" id="rule-list"></div>
        </section>
      </div>

      <div class="workflow-grid full-row">
        <section class="band full">
          <div class="section-head">
            <h2>Export</h2>
            <div class="meta">Subscription export settings</div>
          </div>
          <div class="field-grid" id="export-grid"></div>
        </section>

        <section class="band full">
          <div class="section-head">
            <h2>Output</h2>
            <div class="tabs">
              <button data-view="config" class="active">Export</button>
              <button data-view="report">Diagnose</button>
            </div>
          </div>
          <div id="output-panel"></div>
        </section>
      </div>
    </div>
  `;
}

function renderEditors() {
  root.querySelector('#source-list').innerHTML = state.sources.length
    ? renderEntityDeck('sources', 'Source', state.sources, renderSource, summarizeSourceCard)
    : emptyState('No sources yet.', 'Add one raw subscription URL or paste a payload.');

  root.querySelector('#egress-list').innerHTML = state.egresses.length
    ? renderEntityDeck('egresses', 'Egress', state.egresses, renderEgress, summarizeEgressCard)
    : emptyState('No egresses yet.', 'Add one or more home broadband exits.');

  root.querySelector('#rule-list').innerHTML = state.rules.length
    ? renderEntityDeck('rules', 'Rule', state.rules, renderRule, summarizeRuleCard)
    : emptyState('No rules yet.', 'Use rules to map protocols or node names to egress IDs.');

  root.querySelector('#export-grid').innerHTML = renderExportGrid();
  updateStats();
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
          return `
            <div
              class="entity-card ${selected ? 'active' : ''} ${item.enabled ? '' : 'is-off'}"
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
                <span class="entity-card-icon" aria-hidden="true">${renderEntityIcon(collection, item)}</span>
                <span class="entity-card-title">${escapeHtml(name)}</span>
                <span class="entity-card-index">${escapeHtml(label)} ${index + 1}</span>
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
  const isText = source.kind === 'text';
  return `
    <details class="entity" open data-kind="source" data-id="${source.id}">
      <summary>
        <div class="summary-left">
          <span class="summary-title">${escapeHtml(source.name)}</span>
          <span class="pill">${escapeHtml(source.kind)}</span>
          <span class="pill ${source.enabled ? 'ok' : 'off'}">${source.enabled ? 'on' : 'off'}</span>
          <span class="pill">${escapeHtml(source.formatHint)}</span>
        </div>
        <div class="summary-actions">
          <button data-action="preview-source" data-id="${source.id}">Preview</button>
          <button data-action="duplicate-source" data-id="${source.id}">Duplicate</button>
          <button class="danger" data-action="delete-source" data-id="${source.id}">Delete</button>
        </div>
      </summary>
      <div class="entity-body">
        <div class="field-grid">
          ${textField(`sources.${index}.name`, 'Name', source.name)}
          ${selectField(`sources.${index}.kind`, 'Kind', SOURCE_KIND_OPTIONS, source.kind)}
          ${checkboxField(`sources.${index}.enabled`, 'Enabled', source.enabled)}
          ${selectField(`sources.${index}.formatHint`, 'Format', FORMAT_OPTIONS, source.formatHint)}
          ${isText ? textareaField(`sources.${index}.content`, 'Content', source.content || '', 'wide') : textField(`sources.${index}.url`, 'URL', source.url, 'wide')}
        </div>
        <details class="advanced">
          <summary>Raw content and headers</summary>
          <div class="field-grid" style="margin-top:10px">
            ${!isText ? textField(`sources.${index}.headersJson`, 'Headers JSON', source.headersJson || '', 'wide') : ''}
            ${!isText ? textareaField(`sources.${index}.content`, 'Content', source.content || '', 'wide') : ''}
            ${textField(`sources.${index}.notes`, 'Notes', source.notes, 'wide')}
          </div>
        </details>
        <div class="preview-box">
          ${preview ? renderPreview(preview) : '<div class="muted">No preview yet.</div>'}
        </div>
      </div>
    </details>
  `;
}

function renderEgress(egress, index) {
  const authFields = renderEgressAuthFields(egress, index);
  const advancedFields = renderEgressAdvancedFields(egress, index);
  return `
    <details class="entity" open data-kind="egress" data-id="${egress.id}">
      <summary>
        <div class="summary-left">
          <span class="summary-title">${escapeHtml(egress.name)}</span>
          <span class="pill">${escapeHtml(egress.protocol)}</span>
          <span class="pill ${egress.enabled ? 'ok' : 'off'}">${egress.enabled ? 'on' : 'off'}</span>
          <span class="pill">${escapeHtml(egress.server || 'unset')}${egress.port ? `:${egress.port}` : ''}</span>
          <span class="pill">${escapeHtml(egress.id)}</span>
        </div>
        <div class="summary-actions">
          <button data-action="duplicate-egress" data-id="${egress.id}">Duplicate</button>
          <button class="danger" data-action="delete-egress" data-id="${egress.id}">Delete</button>
        </div>
      </summary>
      <div class="entity-body">
        <div class="field-grid">
          ${textField(`egresses.${index}.name`, 'Name', egress.name)}
          ${selectField(`egresses.${index}.protocol`, 'Protocol', PROTOCOL_OPTIONS, egress.protocol)}
          ${checkboxField(`egresses.${index}.enabled`, 'Enabled', egress.enabled)}
          ${textField(`egresses.${index}.server`, 'Server', egress.server)}
          ${numberField(`egresses.${index}.port`, 'Port', egress.port)}
          ${authFields}
        </div>
        <details class="advanced">
          <summary>Advanced egress options</summary>
          <div class="field-grid" style="margin-top:10px">
            ${advancedFields}
          </div>
        </details>
      </div>
    </details>
  `;
}

function renderRule(rule, index) {
  const sourceOptions = state.sources.map((source) => ({ value: source.id, label: source.name, meta: source.id }));
  const egressOptions = state.egresses.map((egress) => ({ value: egress.id, label: egress.name, meta: `${egress.protocol} ${egress.id}` }));
  return `
    <details class="entity" open data-kind="rule" data-id="${rule.id}">
      <summary>
        <div class="summary-left">
          <span class="summary-title">${escapeHtml(rule.name)}</span>
          <span class="pill">${escapeHtml(rule.targetMode)}</span>
          <span class="pill ${rule.enabled ? 'ok' : 'off'}">${rule.enabled ? 'on' : 'off'}</span>
          <span class="pill">priority ${rule.priority}</span>
        </div>
        <div class="summary-actions">
          <button data-action="duplicate-rule" data-id="${rule.id}">Duplicate</button>
          <button class="danger" data-action="delete-rule" data-id="${rule.id}">Delete</button>
        </div>
      </summary>
      <div class="entity-body">
        <div class="field-grid">
          ${textField(`rules.${index}.name`, 'Name', rule.name)}
          ${checkboxField(`rules.${index}.enabled`, 'Enabled', rule.enabled)}
          ${numberField(`rules.${index}.priority`, 'Priority', rule.priority)}
          ${selectField(`rules.${index}.targetMode`, 'Target mode', TARGET_MODE_OPTIONS, rule.targetMode)}
          ${checkboxField(`rules.${index}.stop`, 'Stop after match', rule.stop)}
          ${pickerField(`rules.${index}.targets`, 'Target egresses', egressOptions, rule.targets || [], 'wide')}
          ${pickerField(`rules.${index}.match.sourceIds`, 'Sources', sourceOptions, rule.match?.sourceIds || [], 'wide')}
          ${pickerField(`rules.${index}.match.protocols`, 'Protocols', PROTOCOL_OPTIONS, rule.match?.protocols || [], 'wide')}
        </div>
        <details class="advanced">
          <summary>Advanced rule options</summary>
          <div class="field-grid" style="margin-top:10px">
            ${textField(`rules.${index}.match.sourceNameRegex`, 'Source name regex', rule.match?.sourceNameRegex || '', 'wide')}
            ${textField(`rules.${index}.match.nodeNameRegex`, 'Node name regex', rule.match?.nodeNameRegex || '', 'wide')}
            ${textField(`rules.${index}.notes`, 'Notes', rule.notes, 'wide')}
          </div>
        </details>
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
  return [
    checkboxField(`egresses.${index}.tlsEnabled`, 'TLS', egress.tlsEnabled),
    checkboxField(`egresses.${index}.allowInsecure`, 'Allow insecure', egress.allowInsecure),
    textField(`egresses.${index}.sni`, 'SNI', egress.sni),
    textField(`egresses.${index}.transportType`, 'Transport', egress.transportType),
    textField(`egresses.${index}.path`, 'Path', egress.path),
    textField(`egresses.${index}.host`, 'Host header', egress.host),
    textField(`egresses.${index}.serviceName`, 'Service name', egress.serviceName),
    textField(`egresses.${index}.alpn`, 'ALPN', egress.alpn),
    textField(`egresses.${index}.fingerprint`, 'Fingerprint', egress.fingerprint),
    textField(`egresses.${index}.congestionControl`, 'Congestion control', egress.congestionControl),
    textField(`egresses.${index}.udpRelayMode`, 'UDP relay mode', egress.udpRelayMode),
    textField(`egresses.${index}.obfs`, 'Obfs', egress.obfs),
    textField(`egresses.${index}.obfsPassword`, 'Obfs password', egress.obfsPassword, '', 'password'),
    textField(`egresses.${index}.bindInterface`, 'Bind interface', egress.bindInterface),
    textField(`egresses.${index}.routingMark`, 'Routing mark', egress.routingMark),
    numberField(`egresses.${index}.upMbps`, 'Up Mbps', egress.upMbps),
    numberField(`egresses.${index}.downMbps`, 'Down Mbps', egress.downMbps),
    textField(`egresses.${index}.tagsText`, 'Tags', (egress.tags || []).join(', '), 'wide'),
    textField(`egresses.${index}.notes`, 'Notes', egress.notes, 'wide'),
  ]
    .filter(Boolean)
    .join('');
}

function renderExportGrid() {
  const exp = state.export || {};
  const egressOptions = [{ value: '', label: 'Auto' }].concat(
    state.egresses.map((item) => ({ value: item.id, label: `${item.name} (${item.protocol})` })),
  );
  return [
    textField('export.nameTemplate', 'Name template', exp.nameTemplate || ''),
    selectField('export.defaultEgressId', 'Default egress', egressOptions, exp.defaultEgressId || ''),
    checkboxField('export.includeInbound', 'Include inbound', exp.includeInbound),
    textField('export.inboundTag', 'Inbound tag', exp.inboundTag || ''),
    numberField('export.inboundPort', 'Inbound port', exp.inboundPort),
    textField('export.inboundListen', 'Inbound listen', exp.inboundListen || ''),
    checkboxField('export.includeSelectors', 'Include selectors', exp.includeSelectors),
    checkboxField('export.includeUrlTest', 'Include urltest', exp.includeUrlTest),
    textField('export.selectorTag', 'Main selector tag', exp.selectorTag || ''),
  ].join('');
}

function wireEvents() {
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
}

function onClick(event) {
  const formatButton = event.target.closest('[data-output-format]');
  if (formatButton) {
    ui.exportFormat = formatButton.dataset.outputFormat;
    renderOutput();
    return;
  }

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
  if (action === 'save') saveNow().catch(console.error);
  if (action === 'generate') generateConfig().catch(console.error);
  if (action === 'diagnose') diagnose().catch(console.error);
  if (action === 'upgrade-now') upgradeNow().catch(console.error);
  if (action === 'preview-source') previewSource(id);
  if (action === 'copy-config') copyCurrentConfig();
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
  if (target.matches('[data-array-path]')) {
    updateArrayFromInput(target);
    queueSave(true);
    renderEditors();
    return;
  }
  if (!target.matches('[data-path]')) return;
  updateStateFromInput(target);
  queueSave(true);
  renderEditors();
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
    match: { sourceIds: defaultSourceIds, sourceNameRegex: '', nodeNameRegex: '', protocols: [] },
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
  const nextName = window.prompt('Rename item', item.name || item.id);
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
  list.splice(index, 1);
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
  const next = Array.isArray(list) ? list.slice() : [];
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
  try {
    ui.previews[id] = await api('/api/parse', {
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

async function generateConfig() {
  ui.generated = await api('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
  ui.mode = 'config';
  renderOutput();
}

async function diagnose() {
  ui.diagnosis = await api('/api/diagnose', {
    method: 'POST',
    body: JSON.stringify({ state }),
  });
  ui.mode = 'report';
  renderOutput();
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
  state = await api('/api/state', {
    method: 'PUT',
    body: JSON.stringify(state),
  });
  renderEditors();
}

function queueSave(immediate) {
  clearTimeout(ui.saveTimer);
  if (immediate) {
    saveNow().catch(console.error);
    return;
  }
  ui.saveTimer = setTimeout(() => {
    saveNow().catch(console.error);
  }, 350);
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
  const qrUrl = getExportQrUrl(ui.exportFormat);
  const meta = EXPORT_FORMATS.find((item) => item.id === ui.exportFormat) || EXPORT_FORMATS[0];
  return `
    <div class="report-box">
      <div class="section-head compact">
        <div>
          <h2 style="margin:0 0 4px;font-size:15px">${escapeHtml(meta.label)}</h2>
          <div class="meta">${ui.generated ? `Nodes ${ui.generated.counts.nodes} | Outbounds ${ui.generated.counts.outbounds}` : 'Ready to export from the current state.'}</div>
        </div>
        <div class="tabs">
          ${EXPORT_FORMATS.map((item) => `<button data-output-format="${escapeHtml(item.id)}" class="${item.id === ui.exportFormat ? 'active' : ''}">${escapeHtml(item.label)}</button>`).join('')}
        </div>
      </div>
      <div class="tabs" style="margin-bottom:12px">
        ${EXPORT_VIEWS.map((item) => `<button data-output-view="${escapeHtml(item.id)}" class="${item.id === ui.exportView ? 'active' : ''}">${escapeHtml(item.label)}</button>`).join('')}
      </div>
      ${ui.exportView === 'qr'
        ? `
          <div class="qr-panel">
            <img class="qr-image" src="${escapeHtml(qrUrl)}" alt="${escapeHtml(meta.label)} QR" />
            <div class="muted">${ui.exportFormat === 'shadowrocket' ? 'Shadowrocket config QR for chained home egress' : escapeHtml(exportUrl)}</div>
          </div>
        `
        : `
          <div class="field-grid">
            <label class="field wide">
              <span>Link</span>
              <input type="text" readonly value="${escapeHtml(exportUrl)}" />
            </label>
          </div>
          <div class="toolbar" style="margin-top:10px">
            <button data-action="copy-export-link">Copy link</button>
            <button data-action="open-export-link">Open link</button>
            <a class="button-link" href="${escapeHtml(exportUrl)}?download=1">Download</a>
          </div>
        `
      }
      ${ui.generated && ui.exportFormat === 'sing-box'
        ? `
          <details class="advanced" style="margin-top:12px" open>
            <summary>Raw sing-box preview</summary>
            <div class="toolbar" style="margin:10px 0">
              <button data-action="copy-config">Copy</button>
              <button data-action="download-config">Download config</button>
              <button data-action="download-snapshot">Download snapshot</button>
            </div>
            <textarea class="code" readonly>${escapeHtml(JSON.stringify(ui.generated.config, null, 2))}</textarea>
          </details>
        `
        : ''}
    </div>
  `;
}

function renderDiagnoseOutput() {
  if (!ui.diagnosis) {
    return '<div class="preview-box"><div class="muted">Run Diagnose to inspect ports, UDP fit, and mapping coverage.</div></div>';
  }
  const report = ui.diagnosis;
  return `
    <div class="report-box">
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

function updateStats() {
  const el = root.querySelector('#stats');
  if (!el) return;
  el.innerHTML = `
    ${statCard('Sources', state.sources.length)}
    ${statCard('Egresses', state.egresses.length)}
    ${statCard('Rules', state.rules.length)}
    ${statCard('Enabled sources', state.sources.filter((item) => item.enabled).length)}
  `;
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

function getExportUrl(format, download = false) {
  const baseUrl = runtime.publicBaseUrl || window.location.origin;
  const url = new URL(`/api/export/${encodeURIComponent(format)}`, baseUrl);
  if (download) url.searchParams.set('download', '1');
  return url.toString();
}

function getExportQrUrl(format) {
  return `/api/qr?format=${encodeURIComponent(format)}&text=${encodeURIComponent(getExportUrl(format))}`;
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
