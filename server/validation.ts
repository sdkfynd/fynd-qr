import { z } from 'zod';
import { buildPayload, validateDesign, type Design } from '../src/qr.ts';
import { BODY_SHAPES, FRAME_SHAPES, BALL_SHAPES } from '../src/shapes.ts';

export class APIError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
const color = z.string().regex(/^#[a-f\d]{6}$/i);
const designSchema = z.object({
  foreground: color, background: color,
  pattern: z.enum(BODY_SHAPES.map(s => s.id)),
  eyeFrame: z.enum(FRAME_SHAPES.map(s => s.id)).optional(),
  eyeBall: z.enum(BALL_SHAPES.map(s => s.id)).optional(),
  eyeFrameColor: color.optional(), eyeBallColor: color.optional(),
  logo: z.string().max(180_000).regex(/^data:image\/png;base64,[A-Za-z\d+/]+=*$/).optional(),
}).strict();
export const draftSchema = z.object({
  kind: z.enum(['static', 'dynamic']), name: z.string().trim().min(1).max(80),
  contentType: z.enum(['url', 'text', 'wifi', 'email', 'phone', 'sms', 'contact']),
  fields: z.record(z.string().max(30), z.string().max(1200)).refine(v => Object.keys(v).length <= 16),
  design: designSchema,
}).strict();
export function destinationURL(input: string, scanBase: string) {
  const value = input.trim();
  if (/[\x00-\x20\x7f\\]/.test(value)) throw new APIError(400, 'Enter a complete public website URL without spaces.');
  let url: URL;
  try { url = new URL(value.includes('://') ? value : `https://${value}`); } catch { throw new APIError(400, 'Enter a valid website URL.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2000) throw new APIError(400, 'Use an HTTP or HTTPS website URL without embedded credentials.');
  if (url.origin === scanBase || host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.startsWith('[') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new APIError(400, 'Choose a public website, not a local address or another scan link.');
  return url.href;
}
export function parseDraft(body: unknown, scanBase: string) {
  const result = draftSchema.safeParse(body);
  if (!result.success) throw new APIError(400, 'Check the code name, content and design, then try again.');
  const draft = result.data;
  try { validateDesign(draft.design as Design); } catch (error) { throw new APIError(400, (error as Error).message); }
  if (draft.kind === 'dynamic' && draft.contentType !== 'url') throw new APIError(400, 'Dynamic codes currently link to websites.');
  let payload: string;
  try { payload = buildPayload(draft.contentType, draft.fields); } catch (error) { throw new APIError(400, (error as Error).message); }
  const destination = draft.kind === 'dynamic' ? destinationURL(draft.fields.url || '', scanBase) : null;
  if (destination) draft.fields = { url: destination };
  return { draft, payload, destination };
}
