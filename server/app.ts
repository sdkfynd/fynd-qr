import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { z } from 'zod';
import type { Account } from '../src/models.ts';
import type { Config } from './config.ts';
import { Store, type CodeDoc } from './store.ts';
import { registerLogoRoutes, normalizeStoredLogo } from './logos.ts';
import { APIError, parseDraft } from './validation.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const hexId = () => randomBytes(12).toString('hex');
const google = new OAuth2Client();
export function companyAccount(payload?: TokenPayload): Account {
  if (!payload?.sub || !payload.email_verified || payload.hd !== 'gofynd.com' || !payload.email?.toLowerCase().endsWith('@gofynd.com')) throw new APIError(403, 'Use your gofynd.com Google Workspace account to continue.');
  return { id: payload.sub, email: payload.email.toLowerCase(), name: payload.name?.slice(0, 80) || payload.email.split('@')[0] };
}
function scanMetadata(request: FastifyRequest, config: Config, id: string, pageScan = false) {
  const ua = String(request.headers['user-agent'] || '').slice(0, 1000);
  const automated = /bot|crawl|spider|preview|slack|discord|facebookexternalhit|headless|monitor|curl|wget/i.test(ua) || /prefetch/i.test(String(request.headers['sec-purpose'] || request.headers.purpose || ''));
  const device = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobile|iphone|android/i.test(ua) ? 'Mobile' : ua ? 'Desktop' : 'Unknown';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\//i.test(ua) ? 'Opera' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Other';
  let referrer = 'Direct / unknown';
  try { if (request.headers.referer) referrer = new URL(request.headers.referer).hostname.slice(0, 200); } catch { /* No reliable referrer. */ }
  if (pageScan) {
    const source = String(request.headers['x-qr-referrer'] || '');
    referrer = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/i.test(source) && source.length <= 253 ? source.toLowerCase() : 'Direct / unknown';
  }
  const countryValue = config.countryHeader && config.trustProxy && (request.ips?.length || 0) > 1 ? String(request.headers[config.countryHeader] || '').toUpperCase() : '';
  const country = /^[A-Z]{2}$/.test(countryValue) && countryValue !== 'XX' ? countryValue : 'Unknown';
  // Raw IP and user agent are consumed transiently, never persisted in analytics.
  const visitor = createHmac('sha256', config.analyticsSecret).update(`${id}\n${request.ip}\n${ua}`).digest('hex');
  return { automated, device, browser, referrer, country, visitor };
}
function scanError(title: string, message: string) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Fynd QR</title><style>body{margin:0;font:16px/1.6 system-ui;background:#f8f8f9;color:#242424;min-height:100vh;display:grid;place-items:center}main{max-width:420px;padding:40px}b{font-size:22px}h1{font-size:30px;line-height:1.2}p{color:#656565}</style><main><b>Fynd QR</b><h1>${title}</h1><p>${message}</p></main></html>`;
}
export async function buildApp(config: Config, store: Store, verifyGoogle?: (credential: string) => Promise<TokenPayload | undefined>) {
  const app = Fastify({ logger: false, trustProxy: config.trustProxy, bodyLimit: 420_000, exposeHeadRoutes: false, requestTimeout: 10_000 });
  await app.register(cors, { origin: config.origins, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-QR-Referrer'] });
  await app.register(rateLimit, { global: true, max: 240, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    const origin = request.headers.origin;
    if (request.url.startsWith('/api/') && origin && !config.origins.includes(origin)) throw new APIError(403, 'This website is not allowed to access the account service.');
    if (request.url.startsWith('/api/') && ['POST', 'PATCH', 'DELETE'].includes(request.method) && (!origin || !config.origins.includes(origin))) throw new APIError(403, 'A trusted app origin is required.');
  });
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode || 500;
    if (status >= 500) console.error('Account service request failed', { route: request.routeOptions.url, type: (error as Error).name });
    reply.code(status).send({ error: status >= 500 ? 'The account service is temporarily unavailable. Please try again.' : (error as Error).message });
  });
  async function checkedDraft(body: unknown) {
    const parsed = parseDraft(body, config.scanBase);
    if (parsed.destination) {
      const url = new URL(parsed.destination);
      if (config.scanPage && url.origin === new URL(config.scanPage).origin) throw new APIError(400, 'Choose a destination outside this scan service.');
      if (config.allowedDomains.length && !config.allowedDomains.includes(url.hostname)) throw new APIError(400, 'This destination domain is not approved for the pilot. Contact your administrator.');
    }
    if (parsed.draft.design.logo) parsed.draft.design.logo = (await normalizeStoredLogo(parsed.draft.design.logo)).image;
    return parsed;
  }
  async function account(request: FastifyRequest) {
    const match = /^Bearer ([a-f\d]{64})$/i.exec(request.headers.authorization || '');
    const session = match && await store.sessions.findOne({ _id: hash(match[1]), expiresAt: { $gt: new Date() } });
    if (!session || (config.production && session.account.localPreview)) throw new APIError(401, 'Please sign in to continue. Your current design is still here.');
    return session.account;
  }
  async function owned(request: FastifyRequest) {
    const user = await account(request); const { id } = request.params as { id: string };
    const code = /^[a-f\d]{24}$/.test(id) && await store.codes.findOne({ _id: id, ownerId: user.id });
    if (!code) throw new APIError(404, 'This code could not be found in your account.');
    return code;
  }
  async function session(user: Account) {
    const token = randomBytes(32).toString('hex');
    await store.sessions.insertOne({ _id: hash(token), account: user, expiresAt: new Date(Date.now() + 12 * 3600_000) });
    return { token, account: user };
  }
  registerLogoRoutes(app, store, account);
  app.get('/health', async () => { await store.db.command({ ping: 1 }); return { status: 'ok' }; });
  app.get('/api/config', async () => ({ googleClientId: config.googleClientId, localPreview: config.localPreview, scanBase: config.scanBase }));
  app.post('/api/auth/challenge', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async () => {
    if (!config.googleClientId) throw new APIError(503, 'Google sign-in is not configured yet.');
    const id = hexId(), nonce = randomBytes(24).toString('hex');
    await store.challenges.insertOne({ _id: id, nonce, expiresAt: new Date(Date.now() + 5 * 60_000) });
    return { id, nonce };
  });
  app.post('/api/auth/google', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async request => {
    const parsed = z.object({ credential: z.string().min(10).max(10_000), challengeId: z.string().regex(/^[a-f\d]{24}$/) }).strict().safeParse(request.body);
    if (!parsed.success || !config.googleClientId) throw new APIError(400, 'Google sign-in could not be verified. Please try again.');
    let payload: TokenPayload | undefined;
    try { payload = verifyGoogle ? await verifyGoogle(parsed.data.credential) : (await google.verifyIdToken({ idToken: parsed.data.credential, audience: config.googleClientId })).getPayload(); }
    catch { throw new APIError(401, 'Google sign-in expired or could not be verified. Please try again.'); }
    const user = companyAccount(payload);
    const nonce = (payload as TokenPayload & { nonce?: string }).nonce;
    if (!nonce || !await store.challenges.findOneAndDelete({ _id: parsed.data.challengeId, nonce, expiresAt: { $gt: new Date() } })) throw new APIError(401, 'This sign-in request expired. Please try again.');
    return session(user);
  });
  if (config.localPreview) app.post('/api/auth/local-preview', async request => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.raw.socket.remoteAddress || '')) throw new APIError(403, 'Local testing only.');
    return session({ id: 'local-preview', name: 'Local preview', email: 'preview@gofynd.com', localPreview: true });
  });
  app.get('/api/me', async request => ({ account: await account(request) }));
  app.post('/api/auth/logout', async request => {
    await account(request); await store.sessions.deleteOne({ _id: hash(request.headers.authorization!.slice(7)) }); return { ok: true };
  });
  app.get('/api/codes', async request => {
    const user = await account(request);
    return { codes: (await store.codes.find({ ownerId: user.id }).sort({ updatedAt: -1 }).limit(501).toArray()).map(code => store.view(code)) };
  });
  app.post('/api/codes', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await account(request); const key = String(request.headers['idempotency-key'] || '');
    if (!/^[a-z\d-]{16,80}$/i.test(key)) throw new APIError(400, 'A unique save request is required.');
    const existing = await store.codes.findOne({ ownerId: user.id, requestKey: key });
    if (existing) return { code: store.view(existing) };
    const { draft, payload, destination } = await checkedDraft(request.body);
    if (await store.codes.countDocuments({ ownerId: user.id }) >= 500) throw new APIError(409, 'Your account has reached its 500-code limit.');
    const id = hexId(), slug = draft.kind === 'dynamic' ? randomBytes(9).toString('base64url') : null, now = new Date();
    const scanUrl = slug ? (config.scanPage ? `${config.scanPage}#r/${slug}` : `${config.scanBase}/r/${slug}`) : null;
    const code: CodeDoc = { ...draft, id, _id: id, ownerId: user.id, requestKey: key, slug, scanUrl, destination, payload: scanUrl || payload, status: 'active', createdAt: now, updatedAt: now, lastScanAt: null, totalScans: 0, revision: 1 };
    try { await store.codes.insertOne(code); } catch (error) {
      const concurrent = await store.codes.findOne({ ownerId: user.id, requestKey: key });
      if (concurrent) return { code: store.view(concurrent) }; throw error;
    }
    reply.code(201); return { code: store.view(code) };
  });
  app.patch('/api/codes/:id', async request => {
    const code = await owned(request);
    const parsed = z.object({ revision: z.number().int().positive(), draft: z.unknown().optional(), status: z.enum(['active', 'paused', 'archived']).optional() }).strict().safeParse(request.body);
    if (!parsed.success || (parsed.data.draft === undefined && !parsed.data.status)) throw new APIError(400, 'Choose a change to save.');
    const patch: Partial<CodeDoc> = { updatedAt: new Date() };
    if (parsed.data.draft) {
      const { draft, payload, destination } = await checkedDraft(parsed.data.draft);
      if (draft.kind !== code.kind) throw new APIError(400, 'A saved code cannot change between static and dynamic.');
      Object.assign(patch, draft, { destination, payload: code.scanUrl || payload });
    }
    if (parsed.data.status) patch.status = parsed.data.status;
    const updated = await store.codes.findOneAndUpdate({ _id: code.id, ownerId: code.ownerId, revision: parsed.data.revision }, { $set: patch, $inc: { revision: 1 } }, { returnDocument: 'after' });
    if (!updated) throw new APIError(409, 'This code changed in another tab. Reopen it from My QR Codes before saving.');
    return { code: store.view(updated) };
  });
  app.get('/api/codes/:id/analytics', async request => {
    const code = await owned(request);
    if (code.kind !== 'dynamic') throw new APIError(400, 'Scan analytics are available for dynamic codes only.');
    const days = Number((request.query as { days?: string }).days || 30);
    if (![7, 30, 90].includes(days)) throw new APIError(400, 'Choose 7, 30, or 90 days.');
    return { analytics: await store.analytics(code.id, days), code: store.view(code) };
  });
  app.get('/api/resolve/:slug', { config: { rateLimit: false } }, async request => {
    const { slug } = request.params as { slug: string };
    if (!/^[A-Za-z\d_-]{12}$/.test(slug)) throw new APIError(404, 'This QR link is incomplete.');
    const code = await store.codes.findOne({ slug, kind: 'dynamic' }, { maxTimeMS: 2500 });
    if (!code || code.status === 'archived') throw new APIError(404, 'This code is no longer available. Contact the person who shared it.');
    if (code.status !== 'active') throw new APIError(410, 'The owner has paused this code. Please check with them for the latest link.');
    try { await store.recordScan(code, scanMetadata(request, config, code.id, true)); } catch { console.error('Scan analytics write failed; destination preserved.'); }
    return { destination: code.destination };
  });
  app.route({ method: ['GET', 'HEAD'], url: '/r/:slug', config: { rateLimit: false }, handler: async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (!/^[A-Za-z\d_-]{12}$/.test(slug)) return reply.code(404).type('text/html').send(scanError('Code not found', 'Check the link or ask the person who shared this QR code.'));
    let code: CodeDoc | null;
    try { code = await store.codes.findOne({ slug, kind: 'dynamic' }, { maxTimeMS: 2500 }); }
    catch { return reply.code(503).header('Retry-After', '30').type('text/html').send(scanError('A brief pause', 'We could not open this link right now. Please try again in a moment.')); }
    if (!code || code.status === 'archived') return reply.code(404).type('text/html').send(scanError('Code unavailable', 'This QR code is no longer available. Please contact the person who shared it.'));
    if (code.status !== 'active') return reply.code(410).type('text/html').send(scanError('This code is paused', 'The owner has temporarily paused this QR code. Please check with them for the latest link.'));
    if (request.method === 'GET') {
      try { await store.recordScan(code, scanMetadata(request, config, code.id)); }
      catch { console.error('Scan analytics write failed; redirect preserved.'); }
    }
    return reply.code(302).header('Location', code.destination!).send();
  } });
  return app;
}
