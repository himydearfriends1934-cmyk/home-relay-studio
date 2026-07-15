export function resolveSourceFetchUrl(source) {
  if (!source || source.kind === 'text') return '';
  const localUrl = normalizeUrl(source.localUrl);
  const remoteUrl = normalizeUrl(source.url);
  if (source.sameVps) {
    if (localUrl) return localUrl;
    const derivedLocalUrl = deriveLocalUrl(remoteUrl);
    if (derivedLocalUrl) return derivedLocalUrl;
  }
  return remoteUrl;
}

function normalizeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(text)) return text;
  if (text.startsWith('//')) return `http:${text}`;
  return `http://${text}`;
}

function deriveLocalUrl(value) {
  const text = normalizeUrl(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hostname = '127.0.0.1';
    return url.toString();
  } catch {
    return text;
  }
}
