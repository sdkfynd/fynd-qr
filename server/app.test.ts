import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { buildApp, companyAccount } from './app.ts';
import { readConfig } from './config.ts';
import { connectStore } from './store.ts';
import { DEFAULT_DESIGN } from '../src/qr.ts';
import { destinationURL } from './validation.ts';
import type { QRRecord } from '../src/models.ts';
import type { TokenPayload } from 'google-auth-library';

let mongod: MongoMemoryServer, db: Awaited<ReturnType<typeof connectStore>>, app: Awaited<ReturnType<typeof buildApp>>;
let googlePayload: TokenPayload & { nonce?: string };
const origin = 'http://localhost:4173';
const config = readConfig({ NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'test-client', SCAN_PAGE_URL: `${origin}/` });
const tokenA = randomBytes(32).toString('hex'), tokenB = randomBytes(32).toString('hex');
const headers = (token = tokenA) => ({ origin, authorization: `Bearer ${token}` });
const draft = (name = 'Campaign', kind: 'dynamic' | 'static' = 'dynamic') => ({ name, kind, contentType: 'url', fields: { url: 'https://example.com/first' }, design: { ...DEFAULT_DESIGN } });
async function create(name = 'Campaign', kind: 'dynamic' | 'static' = 'dynamic') {
  const response = await app.inject({ method: 'POST', url: '/api/codes', headers: { ...headers(), 'idempotency-key': randomBytes(16).toString('hex') }, payload: draft(name, kind) });
  assert.equal(response.statusCode, 201, response.body); return response.json().code as QRRecord;
}
before(async () => {
  mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  db = await connectStore(mongod.getUri(), 'fynd_qr_tests');
  for (const [id, token] of [['alice', tokenA], ['bob', tokenB]]) await db.store.sessions.insertOne({ _id: createHash('sha256').update(token).digest('hex'), account: { id, name: id, email: `${id}@gofynd.com` }, expiresAt: new Date(Date.now() + 3600_000) });
  app = await buildApp(config, db.store, async credential => { if (credential === 'invalid-signature') throw new Error('Bad token'); return googlePayload; });
});
after(async () => { await app?.close(); await db?.client.close(); await mongod?.stop(); });

test('verified Google Workspace identity is required, not merely an email suffix', () => {
  const payload = { sub: 'user', email: 'user@gofynd.com', email_verified: true, hd: 'gofynd.com' } as TokenPayload;
  assert.equal(companyAccount(payload).id, 'user');
  for (const changed of [{ hd: undefined }, { hd: 'other.com' }, { email_verified: false }, { email: 'user@notgofynd.com' }, { sub: '' }]) assert.throws(() => companyAccount({ ...payload, ...changed }));
});
test('Google challenge is nonce-bound, expiring, single-use, and issues a revocable session', async () => {
  const challenge = (await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin } })).json();
  googlePayload = { sub: 'google-user', email: 'google-user@gofynd.com', email_verified: true, hd: 'gofynd.com', nonce: 'wrong' } as typeof googlePayload;
  const login = (credential = 'valid-test-credential') => app.inject({ method: 'POST', url: '/api/auth/google', headers: { origin }, payload: { credential, challengeId: challenge.id } });
  assert.equal((await login('invalid-signature')).statusCode, 401);
  assert.equal((await login()).statusCode, 401);
  googlePayload.nonce = challenge.nonce;
  const successful = await login(); assert.equal(successful.statusCode, 200);
  const session = successful.json(); assert.equal(session.token.length, 64);
  assert.equal((await login()).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/me', headers: headers(session.token) })).statusCode, 200);
  assert.equal(await db.store.sessions.countDocuments({ _id: session.token }), 0, 'Only a hash of session token is stored');
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(session.token) });
  assert.equal((await app.inject({ url: '/api/me', headers: headers(session.token) })).statusCode, 401);
  const expired = (await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin } })).json();
  await db.store.challenges.updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(0) } }); googlePayload.nonce = expired.nonce;
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/google', headers: { origin }, payload: { credential: 'valid-test-credential', challengeId: expired.id } })).statusCode, 401);
});
test('anonymous and foreign-origin account access is denied', async () => {
  assert.equal((await app.inject({ url: '/api/codes' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/codes', headers: { ...headers(), origin: 'https://evil.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/codes', headers: { authorization: `Bearer ${tokenA}` }, payload: draft() })).statusCode, 403);
  const preflight = await app.inject({ method: 'OPTIONS', url: '/api/codes', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,idempotency-key' } });
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.headers['access-control-allow-origin'], origin);
});
test('creation retries are idempotent and account ownership is enforced on reads and updates', async () => {
  const key = randomBytes(16).toString('hex');
  const request = { method: 'POST' as const, url: '/api/codes', headers: { ...headers(), 'idempotency-key': key }, payload: draft('Owned code') };
  const [a, b] = await Promise.all([app.inject(request), app.inject(request)]);
  const code = a.json().code as QRRecord; assert.equal(code.id, b.json().code.id);
  assert.equal(await db.store.codes.countDocuments({ requestKey: key }), 1);
  assert.equal(code.scanUrl, `${origin}/#r/${code.slug}`); assert.equal(code.payload, code.scanUrl);
  const response = await app.inject({ url: '/api/codes', headers: headers(tokenB) }); assert.deepEqual(response.json().codes, []);
  for (const url of [`/api/codes/${code.id}/analytics`, `/api/codes/${code.id}`]) {
    const r = await app.inject({ url, method: url.endsWith('analytics') ? 'GET' : 'PATCH', headers: headers(tokenB), ...(url.endsWith('analytics') ? {} : { payload: { revision: 1, status: 'paused' } }) });
    assert.equal(r.statusCode, 404);
  }
  assert.equal('ownerId' in code, false); assert.equal('requestKey' in code, false);
});
test('a changed destination preserves the encoded link and rejects stale edits', async () => {
  const code = await create('Mutable destination');
  const changed = { ...draft(code.name), fields: { url: 'https://example.org/updated' } };
  const save = await app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: 1, draft: changed } });
  assert.equal(save.statusCode, 200, save.body); const updated = save.json().code;
  assert.equal(updated.revision, 2); assert.equal(updated.scanUrl, code.scanUrl); assert.equal(updated.payload, code.payload);
  assert.equal((await app.inject({ url: `/r/${code.slug}` })).headers.location, 'https://example.org/updated');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: 1, draft: changed } })).statusCode, 409);
});
test('static saves preserve direct content and have no scan analytics', async () => {
  const code = await create('Static design', 'static'); assert.equal(code.scanUrl, null); assert.equal(code.payload, 'https://example.com/first');
  assert.equal((await app.inject({ url: `/api/codes/${code.id}/analytics`, headers: headers() })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: 1, draft: draft(code.name, 'dynamic') } })).statusCode, 400);
});
test('redirects distinguish repeat scans, estimated visitors, bots and HEAD requests', async () => {
  const code = await create('Analytics fixture');
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const req = { url: `/r/${code.slug}`, headers: { 'user-agent': ua, referer: 'https://example.org/private?secret=do-not-store' } };
  const first = await app.inject(req); assert.equal(first.statusCode, 302); assert.equal(first.headers['cache-control'], 'no-store');
  await app.inject(req);
  await app.inject({ ...req, method: 'HEAD' });
  await app.inject({ url: `/r/${code.slug}`, headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' } });
  const result = (await app.inject({ url: `/api/codes/${code.id}/analytics?days=7`, headers: headers() })).json();
  assert.equal(result.analytics.scans, 2); assert.equal(result.analytics.visitors, 1); assert.equal(result.analytics.automated, 1); assert.equal(result.code.totalScans, 2);
  assert.equal(result.analytics.daily.length, 7); assert.equal(result.analytics.daily.at(-1).scans, 2);
  assert.deepEqual(result.analytics.devices, [{ label: 'Mobile', count: 2 }]); assert.deepEqual(result.analytics.referrers, [{ label: 'example.org', count: 2 }]);
  const events = await db.store.events.find({ codeId: code.id }).toArray(); const serialized = JSON.stringify(events);
  for (const forbidden of ['127.0.0.1', ua, 'do-not-store']) assert.equal(serialized.includes(forbidden), false);
  assert.equal(events[0].expiresAt.getTime() - events[0].at.getTime(), 90 * 86400_000);
});
test('GitHub Pages resolver records scans without disclosing private code data', async () => {
  const code = await create('Page scan');
  const response = await app.inject({ url: `/api/resolve/${code.slug}`, headers: { origin, 'user-agent': 'Mozilla/5.0 Safari/605.1' } });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { destination: 'https://example.com/first' });
  assert.equal((await db.store.codes.findOne({ _id: code.id }))!.totalScans, 1);
  assert.equal((await app.inject({ url: '/api/resolve/not-valid' })).statusCode, 404);
});
test('pause, archive and reactivation apply to both public scan paths', async () => {
  let code = await create('Lifecycle');
  for (const [status, expected] of [['paused', 410], ['archived', 404], ['active', 302]] as const) {
    const response = await app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: code.revision, status } }); code = response.json().code;
    assert.equal((await app.inject({ url: `/r/${code.slug}` })).statusCode, expected);
    assert.equal((await app.inject({ url: `/api/resolve/${code.slug}`, headers: { origin } })).statusCode, expected === 302 ? 200 : expected);
  }
});
test('analytics failures do not break redirects', async () => {
  const code = await create('Analytics outage'); const original = db.store.recordScan;
  db.store.recordScan = async () => { throw new Error('Fixture failure'); };
  try { assert.equal((await app.inject({ url: `/r/${code.slug}` })).statusCode, 302); assert.equal((await app.inject({ url: `/api/resolve/${code.slug}` })).statusCode, 200); }
  finally { db.store.recordScan = original; }
});
test('unsafe schemes, credentials, private hosts and redirect loops are rejected', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.com', 'http://127.0.0.1', 'http://10.1.2.3', 'http://[::1]', 'http://localhost', 'http://host.local', 'http://localhost:4174/r/example', 'https://example.com/with space']) assert.throws(() => destinationURL(url, config.scanBase), url);
  const result = await app.inject({ method: 'POST', url: '/api/codes', headers: { ...headers(), 'idempotency-key': randomBytes(16).toString('hex') }, payload: { ...draft(), fields: { url: `${origin}/#r/Ab7k92Mx4pQz` } } });
  assert.equal(result.statusCode, 400);
  assert.equal(destinationURL('example.org/page', config.scanBase), 'https://example.org/page');
});
test('approved destination domains are enforced on create and destination changes', async () => {
  const restricted = await buildApp({ ...config, allowedDomains: ['example.com'] }, db.store);
  try {
    const code = await create('Pilot');
    const response = await restricted.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: code.revision, draft: { ...draft(), fields: { url: 'https://example.com.evil.test' } } } });
    assert.equal(response.statusCode, 400);
    const createResponse = await restricted.inject({ method: 'POST', url: '/api/codes', headers: { ...headers(), 'idempotency-key': randomBytes(16).toString('hex') }, payload: { ...draft(), fields: { url: 'https://other.example.org' } } });
    assert.equal(createResponse.statusCode, 400);
  } finally { await restricted.close(); }
});
test('local testing sign-in is absent by default and cannot be enabled in production', async () => {
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/local-preview', headers: { origin } })).statusCode, 404);
  assert.throws(() => readConfig({ NODE_ENV: 'production', LOCAL_PREVIEW_AUTH: '1' }));
  assert.throws(() => readConfig({ LOCAL_PREVIEW_AUTH: '1', API_HOST: '0.0.0.0' }));
  assert.throws(() => readConfig({ LOCAL_PREVIEW_AUTH: '1', SCAN_PAGE_URL: 'https://example.org/' }));
  assert.throws(() => readConfig({ NODE_ENV: 'production' }));
  const local = await buildApp(readConfig({ LOCAL_PREVIEW_AUTH: '1' }), db.store);
  try { assert.equal((await local.inject({ method: 'POST', url: '/api/auth/local-preview', headers: { origin }, remoteAddress: '127.0.0.1' })).statusCode, 200); assert.equal((await local.inject({ method: 'POST', url: '/api/auth/local-preview', headers: { origin }, remoteAddress: '8.8.8.8' })).statusCode, 403); }
  finally { await local.close(); }
});
test('expired account sessions are rejected even before Mongo TTL cleanup', async () => {
  const token = randomBytes(32).toString('hex');
  await db.store.sessions.insertOne({ _id: createHash('sha256').update(token).digest('hex'), account: { id: 'expired', name: 'Expired', email: 'expired@gofynd.com' }, expiresAt: new Date(0) });
  assert.equal((await app.inject({ url: '/api/me', headers: headers(token) })).statusCode, 401);
});
test('page scan referrers describe the referring site, not the API page or private URL', async () => {
  const code = await create('Page referral');
  await app.inject({ url: `/api/resolve/${code.slug}`, headers: { origin, referer: `${origin}/`, 'x-qr-referrer': 'news.example.org', 'user-agent': 'Mozilla/5.0' } });
  await app.inject({ url: `/api/resolve/${code.slug}`, headers: { origin, referer: `${origin}/`, 'x-qr-referrer': 'https://private.example.org/path?secret=value', 'user-agent': 'Mozilla/5.0' } });
  const events = await db.store.events.find({ codeId: code.id }).sort({ at: 1 }).toArray();
  assert.deepEqual(events.map(e => e.referrer), ['news.example.org', 'Direct / unknown']);
});
test('country information is ignored when the request bypasses the trusted proxy', async () => {
  const code = await create('Country boundary');
  const proxied = await buildApp({ ...config, trustProxy: ['127.0.0.1'], countryHeader: 'x-country' }, db.store);
  try {
    await proxied.inject({ url: `/r/${code.slug}`, headers: { 'x-country': 'IN', 'x-forwarded-for': '203.0.113.10' }, remoteAddress: '8.8.8.8' });
    await proxied.inject({ url: `/r/${code.slug}`, headers: { 'x-country': 'IN', 'x-forwarded-for': '203.0.113.10' }, remoteAddress: '127.0.0.1' });
    const events = await db.store.events.find({ codeId: code.id }).sort({ at: 1 }).toArray();
    assert.deepEqual(events.map(e => e.country), ['Unknown', 'IN']);
  } finally { await proxied.close(); }
});
