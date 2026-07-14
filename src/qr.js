export function getQrPayload(format, text) {
  const value = String(text || '');
  if (format === 'shadowrocket') {
    const encodedUrl = Buffer.from(value, 'utf8').toString('base64');
    return `sub://${encodedUrl}#Home%20Relay%20Studio`;
  }
  return value;
}
