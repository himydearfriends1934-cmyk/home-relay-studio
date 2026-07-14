import { Buffer } from 'node:buffer';

export function getQrPayload(format, text) {
  const value = String(text || '');
  if (format === 'shadowrocket') {
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    return `shadowrocket://add/sub://${encoded}?remark=${encodeURIComponent('Home Relay Studio')}`;
  }
  return value;
}
