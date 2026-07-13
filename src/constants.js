export const DEFAULT_LISTEN_PORT = 8787;
export const DEFAULT_STATE_FILE = 'data/state.json';
export const DEFAULT_HEALTHCHECK_URL = 'https://www.gstatic.com/generate_204';

export const SOURCE_FORMATS = ['auto', 'sing-box', 'clash', 'uri', 'json', 'yaml'];
export const EGRESS_PROTOCOLS = [
  'direct',
  'http',
  'socks',
  'shadowsocks',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'tuic',
];

export const SOURCE_NODE_PROTOCOLS = new Set([
  'http',
  'socks',
  'shadowsocks',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'tuic',
]);

export const UNSTABLE_UDP_PROTOCOLS = new Set(['http']);
