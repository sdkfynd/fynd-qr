import QRCode from 'qrcode';
import { BODY_SHAPES, FRAME_SHAPES, BALL_SHAPES, renderBody, renderEyeFrame, renderEyeBall, type BodyShape, type EyeFrame, type EyeBall } from './shapes';

export type ContentType = 'url' | 'text' | 'wifi' | 'email' | 'phone' | 'sms' | 'contact';
export type Pattern = BodyShape;
export interface Design { foreground: string; background: string; pattern: BodyShape; eyeFrame?: EyeFrame; eyeBall?: EyeBall; eyeFrameColor?: string; eyeBallColor?: string; logo?: string }
export const DEFAULT_DESIGN: Design = { foreground: '#173d38', background: '#ffffff', pattern: 'square', eyeFrame: 'square', eyeBall: 'square' };
export const MAX_BYTES = 1200;
export type ColorKey = 'foreground' | 'background' | 'eyeFrameColor' | 'eyeBallColor';
export class DesignError extends Error {
  constructor(message: string, public field: ColorKey) { super(message); }
}
const escapeWifi = (value: string) => value.replace(/[\\;,:\"]/g, '\\$&');
const escapeCard = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[;,]/g, '\\$&');
function requireValue(value: string, message: string) { if (!value.trim()) throw new Error(message); return value; }
function emailAddress(value: string) {
  if (!/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(value)) throw new Error('Enter a valid email address.');
  return value;
}
function phoneNumber(value: string) {
  if (!/^\+?[\d\s().-]{6,25}$/.test(value) || value.replace(/\D/g, '').length < 6) throw new Error('Enter a phone number, including the country code.');
  return value.replace(/[\s().-]/g, '');
}
export function websiteUrl(value: string) {
  requireValue(value, 'Enter the website you want people to visit.');
  if (/\s/.test(value)) throw new Error('Remove spaces from your website address.');
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = `https://${value}`;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid website, such as example.com.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error('Use an http:// or https:// website address without login details.');
  return url.href;
}
export function buildPayload(type: ContentType, values: Record<string, string>): string {
  const value = (key: string) => (values[key] || '').trim();
  let result: string;
  switch (type) {
    case 'url': result = websiteUrl(value('url')); break;
    case 'text': result = requireValue(values.text || '', 'Add a message to create your QR code.'); break;
    case 'wifi': {
      const ssid = requireValue(values.ssid || '', 'Enter your Wi-Fi network name.');
      const security = ['WPA', 'WEP', 'nopass'].includes(value('security')) ? value('security') : 'WPA';
      const password = security === 'nopass' ? '' : requireValue(values.password || '', 'Enter the Wi-Fi password, or choose an open network.');
      result = `WIFI:T:${security};S:${escapeWifi(ssid)};P:${escapeWifi(password)};H:${value('hidden') === 'true'};;`; break;
    }
    case 'email': {
      const address = emailAddress(value('email'));
      const query = [['subject', values.subject], ['body', values.body]].filter(([, v]) => !!v).map(([key, v]) => `${key}=${encodeURIComponent(v!)}`).join('&');
      result = `mailto:${address}${query ? `?${query}` : ''}`; break;
    }
    case 'phone': result = `tel:${phoneNumber(value('phone'))}`; break;
    case 'sms': result = `sms:${phoneNumber(value('phone'))}${values.message ? `?body=${encodeURIComponent(values.message)}` : ''}`; break;
    case 'contact': {
      if (!value('firstName') && !value('lastName')) throw new Error('Add a first or last name for your contact.');
      const fields = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeCard(value('lastName'))};${escapeCard(value('firstName'))};;;`, `FN:${escapeCard([value('firstName'), value('lastName')].filter(Boolean).join(' '))}`];
      if (value('organization')) fields.push(`ORG:${escapeCard(value('organization'))}`);
      if (value('email')) fields.push(`EMAIL:${escapeCard(emailAddress(value('email')))}`);
      if (value('phone')) fields.push(`TEL;TYPE=CELL:${phoneNumber(value('phone'))}`);
      if (value('website')) fields.push(`URL:${escapeCard(websiteUrl(value('website')))}`);
      fields.push('END:VCARD'); result = fields.join('\r\n'); break;
    }
  }
  if (new TextEncoder().encode(result).length > MAX_BYTES) throw new Error('That’s a little too much to fit. Shorten your content to 1,200 bytes or less.');
  return result;
}
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
export function validateDesign(design: Design): number {
  if (!BODY_SHAPES.some(s => s.id === design.pattern) || !FRAME_SHAPES.some(s => s.id === (design.eyeFrame ?? 'square')) || !BALL_SHAPES.some(s => s.id === (design.eyeBall ?? 'square'))) throw new Error('Choose one of the available QR shapes.');
  const colors = [design.foreground, design.background, design.eyeFrameColor ?? design.foreground, design.eyeBallColor ?? design.foreground];
  const keys: ColorKey[] = ['foreground','background','eyeFrameColor','eyeBallColor'];
  const labels = ['code','background','eye-frame','eye-ball'];
  for (let i=0;i<colors.length;i++) if (!/^#[0-9a-f]{6}$/i.test(colors[i])) throw new DesignError(`Use a six-digit hex ${labels[i]} color, such as #173D38.`,keys[i]);
  const light = luminance(design.background);
  const ratios = [colors[0], colors[2], colors[3]].map(c => (light + .05) / (luminance(c) + .05));
  const ratio = Math.min(...ratios);
  if (ratio < 4.5) {
    const index = [0,2,3][ratios.findIndex(r => r < 4.5)];
    throw new DesignError(`Darken the ${labels[index]} color or choose a lighter background for a clear scan.`,keys[index]);
  }
  return ratio;
}
export function recommendedPngSize(payload: string): number {
  const cells = QRCode.create(payload, { errorCorrectionLevel: 'H' }).modules.size + 8;
  return [512, 1024, 2048, 4096].find(size => size >= cells * 8) || 4096;
}
export function buildSVG(payload: string, design: Design, pixels = 1024): string {
  validateDesign(design);
  if (new TextEncoder().encode(payload).length > MAX_BYTES) throw new Error('Shorten your content to 1,200 bytes or less.');
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size, total = n + 8;
  const safePixels = Math.min(4096, Math.max(256, Math.round(pixels)));
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${safePixels}" height="${safePixels}" viewBox="0 0 ${total} ${total}"><rect width="${total}" height="${total}" fill="${design.background}"/><g fill="${design.foreground}">`];
  const inFinder = (row: number, col: number) => (row < 7 && (col < 7 || col >= n-7)) || (row >= n-7 && col < 7);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    if (!qr.modules.get(row, col) || !qr.modules.isReserved(row,col) || inFinder(row,col)) continue;
    const x = col + 4, y = row + 4;
    // Timing, alignment, format and version modules stay square and unchanged.
    parts.push(`<path shape-rendering="crispEdges" d="M${x} ${y}h1v1h-1z"/>`);
  }
  parts.push(renderBody(design.pattern,n,(r,c) => !!qr.modules.get(r,c) && !qr.modules.isReserved(r,c)));
  parts.push('</g>');
  const origins = [[4,4],[n-3,4],[4,n-3]];
  for (const [x,y] of origins) {
    parts.push(`<g fill="${design.eyeFrameColor ?? design.foreground}">${renderEyeFrame(design.eyeFrame ?? 'square',x,y)}</g>`);
    parts.push(`<g fill="${design.eyeBallColor ?? design.foreground}">${renderEyeBall(design.eyeBall ?? 'square',x+2,y+2)}</g>`);
  }
  if (design.logo && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(design.logo)) {
    const logoSize = Math.max(3, Math.floor(n * .14)), plate = logoSize + 1.5;
    const pos = (total - logoSize) / 2;
    parts.push(`<rect x="${(total - plate) / 2}" y="${(total - plate) / 2}" width="${plate}" height="${plate}" rx=".5" fill="${design.background}"/><image href="${design.logo}" x="${pos}" y="${pos}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
