import crypto from 'node:crypto';

export function createId(prefix = 'item') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function trimBom(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(value) {
  const base = normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'item';
}

export function sanitizeTag(value) {
  const base = normalizeName(value)
    .replace(/[^A-Za-z0-9_.@-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'tag';
}

export function toInt(value, fallback = null) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deepClone(value) {
  return structuredClone(value);
}

export function decodeLooseBase64(text) {
  const compact = String(text ?? '').replace(/\s+/g, '');
  if (compact.length < 8) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const printable = decoded.replace(/\u0000/g, '').trim();
    return printable || null;
  } catch {
    return null;
  }
}

export function looksLikeBase64(text) {
  const compact = String(text ?? '').replace(/\s+/g, '');
  return compact.length >= 8 && /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

export function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function splitHostPort(value) {
  const text = String(value ?? '').trim();
  if (!text) return { host: '', port: null };
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end > 0) {
      const host = text.slice(1, end);
      const rest = text.slice(end + 1);
      const port = rest.startsWith(':') ? toInt(rest.slice(1), null) : null;
      return { host, port };
    }
  }
  const parts = text.split(':');
  if (parts.length <= 1) return { host: text, port: null };
  const port = toInt(parts.pop(), null);
  return { host: parts.join(':'), port };
}

export function getProtocolSupport(protocol) {
  const p = String(protocol ?? '').toLowerCase();
  return {
    tcp: true,
    udp:
      ['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria2', 'tuic', 'socks'].includes(p) ||
      p === 'http'
        ? p !== 'http'
        : false,
    requiresUdp: ['hysteria2', 'tuic'].includes(p),
  };
}
