export function resolveSourceFetchUrl(source) {
  if (!source || source.kind === 'text') return '';
  const localUrl = normalizeUrl(source.localUrl);
  const remoteUrl = normalizeUrl(source.url);
  if (source.sameVps && localUrl) return localUrl;
  return remoteUrl;
}

function normalizeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(text)) return text;
  if (text.startsWith('//')) return `http:${text}`;
  return `http://${text}`;
}
