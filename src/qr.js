export function getQrPayload(format, text) {
  const value = String(text || '');
  if (format === 'shadowrocket') {
    return `shadowrocket://config/add/${encodeURIComponent(value)}`;
  }
  return value;
}
