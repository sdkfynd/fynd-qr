import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { PostgresStore, postgresConnectionOptions } from './postgres-store.ts';
import { buildApp } from './app.ts';
import { readConfig } from './config.ts';
import { DEFAULT_DESIGN } from '../src/qr.ts';
import type { TokenPayload } from 'google-auth-library';
import type { QRRecord } from '../src/models.ts';

let db: PGlite, store: PostgresStore, app: Awaited<ReturnType<typeof buildApp>>;
let payload: TokenPayload & { nonce?: string };
const origin = 'http://localhost:4173';
const tokenA = randomBytes(32).toString('hex'), tokenB = randomBytes(32).toString('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const headers = (token = tokenA) => ({ origin, authorization: `Bearer ${token}` });
const draft = (name = 'Campaign', kind: 'dynamic' | 'static' = 'dynamic') => ({ name, kind, contentType: 'url', fields: { url: 'https://example.com/first' }, design: { ...DEFAULT_DESIGN } });
async function create(name = 'Campaign', kind: 'dynamic' | 'static' = 'dynamic') {
  const response = await app.inject({ method: 'POST', url: '/api/codes', headers: { ...headers(), 'idempotency-key': randomBytes(16).toString('hex') }, payload: draft(name, kind) });
  assert.equal(response.statusCode, 201, response.body); return response.json().code as QRRecord;
}
before(async () => {
  db = await PGlite.create();
  // Simulate pre-existing project data and Supabase API roles without reading any real bin records.
  await db.exec("create table public.bins (id int primary key); insert into public.bins values (1); create role anon; create role authenticated; create role service_role bypassrls;");
  const migration = readFileSync(new URL('./migrations/001_fynd_qr.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration); // Additive and repeatable.
  const passwordMigration = readFileSync(new URL('./migrations/002_password_accounts.sql', import.meta.url), 'utf8');
  await db.exec(passwordMigration); await db.exec(passwordMigration);
  await db.exec('set role fynd_qr_app');
  store = new PostgresStore(db);
  for (const [id, token] of [['alice', tokenA], ['bob', tokenB]]) await store.saveSession({ _id: hash(token), account: { id, name: id, email: `${id}@gofynd.com` }, expiresAt: new Date(Date.now() + 3600_000) });
  app = await buildApp(readConfig({ NODE_ENV: 'test', GOOGLE_CLIENT_ID: 'test-client', SCAN_PAGE_URL: `${origin}/` }), store, async credential => { if (credential === 'invalid-signature') throw new Error('Bad token'); return payload; });
});
after(async () => { await app?.close(); await db?.close(); });

test('Postgres role is confined to QR tables and existing bin data survives the migration', async () => {
  await assert.rejects(db.query('select * from public.bins'), /permission denied/);
  await assert.rejects(db.query('create table fynd_qr.unwanted (id int)'), /permission denied/);
  await assert.rejects(db.query('drop table fynd_qr.qr_codes'), /must be owner/);
  await db.exec('reset role');
  try {
    assert.deepEqual((await db.query('select * from public.bins')).rows, [{ id: 1 }]);
    const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fynd_qr' and c.relkind = 'r'");
    assert.equal(rows.length, 6); assert.ok(rows.every(r => r.relrowsecurity));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from fynd_qr.qr_codes'), /permission denied/);
      await assert.rejects(db.query('select * from fynd_qr.password_accounts'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.exec('set role fynd_qr_app'); }
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
});
test('Postgres sessions and Google challenges enforce expiry, single use, any Google domain, and revocation', async () => {
  const challenge = (await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin } })).json();
  payload = { sub: 'google-test', email: 'test@gofynd.com', email_verified: true, hd: 'gofynd.com', nonce: 'wrong' } as typeof payload;
  const login = (credential = 'valid-test-credential') => app.inject({ method: 'POST', url: '/api/auth/google', headers: { origin }, payload: { credential, challengeId: challenge.id } });
  assert.equal((await login('invalid-signature')).statusCode, 401); assert.equal((await login()).statusCode, 401);
  payload.nonce = challenge.nonce; payload.hd = undefined; payload.email = 'person@gmail.com';
  const responses = await Promise.all([login(), login()]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 401]);
  const token = responses.find(r => r.statusCode === 200)!.json().token;
  assert.equal(await store.getSession(token), null);
  assert.equal((await app.inject({ url: '/api/me', headers: headers(token) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: headers(token) })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: headers(token) })).statusCode, 401);
  const expiredToken = randomBytes(32).toString('hex');
  await store.saveSession({ _id: hash(expiredToken), account: { id: 'expired', name: 'Expired', email: 'expired@gofynd.com' }, expiresAt: new Date(0) });
  await store.saveChallenge({ _id: 'expired', nonce: 'expired', expiresAt: new Date(0) });
  assert.equal(await store.consumeChallenge('expired', 'expired'), false);
  assert.equal((await app.inject({ url: '/api/me', headers: headers(expiredToken) })).statusCode, 401);
  await store.cleanup();
  assert.equal((await db.query('select * from fynd_qr.sessions where token_hash = $1', [hash(expiredToken)])).rows.length, 0);
  assert.equal((await db.query("select * from fynd_qr.login_challenges where id = 'expired'")).rows.length, 0);
});
test('Postgres saves are idempotent, private, parameterized, and protected from stale updates', async () => {
  const key = randomBytes(16).toString('hex');
  const request = { method: 'POST' as const, url: '/api/codes', headers: { ...headers(), 'idempotency-key': key }, payload: draft("Alice's campaign'; --") };
  const [a, b] = await Promise.all([app.inject(request), app.inject(request)]);
  assert.ok([200, 201].includes(a.statusCode), a.body); assert.ok([200, 201].includes(b.statusCode), b.body);
  const code = a.json().code as QRRecord; assert.equal(b.json().code.id, code.id);
  assert.equal(code.name, request.payload.name); assert.equal(code.scanUrl, `${origin}/#r/${code.slug}`);
  assert.equal('ownerId' in code, false); assert.equal('requestKey' in code, false);
  assert.equal((await app.inject({ url: '/api/codes' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/codes', headers: { ...headers(), origin: 'https://other.example' } })).statusCode, 403);
  assert.deepEqual((await app.inject({ url: '/api/codes', headers: headers(tokenB) })).json().codes, []);
  assert.equal((await app.inject({ url: `/api/codes/${code.id}/analytics`, headers: headers(tokenB) })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(tokenB), payload: { revision: 1, status: 'paused' } })).statusCode, 404);
  const change = () => app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: 1, draft: { ...draft('Updated'), fields: { url: 'https://example.org/updated' } } } });
  const changed = await Promise.all([change(), change()]); assert.deepEqual(changed.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(changed.find(r => r.statusCode === 200)!.json().code.payload, code.payload);
  assert.equal((await app.inject({ url: `/r/${code.slug}` })).headers.location, 'https://example.org/updated');
  assert.equal((await store.listCodes('alice')).length, await store.countCodes('alice'));
});
test('Postgres preserves static content and supports pause, archive, and reactivation on both scan paths', async () => {
  const staticCode = await create('Static', 'static'); assert.equal(staticCode.scanUrl, null); assert.equal(staticCode.payload, 'https://example.com/first');
  assert.equal((await app.inject({ url: `/api/codes/${staticCode.id}/analytics`, headers: headers() })).statusCode, 400);
  let code = await create('Lifecycle');
  for (const [status, expected] of [['paused', 410], ['archived', 404], ['active', 302]] as const) {
    const update = await app.inject({ method: 'PATCH', url: `/api/codes/${code.id}`, headers: headers(), payload: { revision: code.revision, status } });
    assert.equal(update.statusCode, 200, update.body); code = update.json().code;
    assert.equal((await app.inject({ url: `/r/${code.slug}` })).statusCode, expected);
    const resolved = await app.inject({ url: `/api/resolve/${code.slug}`, headers: { origin } });
    assert.equal(resolved.statusCode, expected === 302 ? 200 : expected);
    if (status === 'active') assert.deepEqual(resolved.json(), { destination: 'https://example.com/first' });
  }
});
test('Postgres analytics atomically count concurrent scans, exclude HEAD/bots, and aggregate UTC ranges', async () => {
  const c = await create('Analytics');
  const code = (await store.getCode(c.id, 'alice'))!;
  const meta = { automated: false, visitor: 'visitor-a', device: 'Mobile', browser: 'Safari', country: 'IN', referrer: 'example.org' };
  const now = new Date('2026-09-18T12:00:00Z');
  await Promise.all(Array.from({ length: 8 }, () => store.recordScan(code, meta, now)));
  await store.recordScan(code, { ...meta, visitor: 'visitor-b' }, new Date('2026-09-17T23:59:59Z'));
  await store.recordScan(code, { ...meta, automated: true }, now);
  await store.recordScan(code, meta, new Date('2026-09-01T12:00:00Z'));
  await store.recordScan(code, meta, new Date('2026-06-01T12:00:00Z'));
  const seven = await store.analytics(code.id, 7, now), thirty = await store.analytics(code.id, 30, now);
  assert.equal(seven.scans, 9); assert.equal(seven.visitors, 2); assert.equal(seven.automated, 1); assert.equal(seven.daily.length, 7);
  assert.equal(seven.daily.at(-1)!.scans, 8); assert.equal(seven.daily.at(-2)!.scans, 1); assert.equal(thirty.scans, 10);
  assert.deepEqual(seven.devices, [{ label: 'Mobile', count: 9 }]); assert.deepEqual(seven.countries, [{ label: 'IN', count: 9 }]);
  assert.equal((await store.getCode(code.id, 'alice'))!.totalScans, 11);
  assert.equal((await store.getCode(code.id, 'alice'))!.lastScanAt!.toISOString(), now.toISOString());
  await app.inject({ method: 'HEAD', url: `/r/${c.slug}` });
  assert.equal((await store.getCode(code.id, 'alice'))!.totalScans, 11);
  await store.cleanup(now);
  assert.equal((await db.query('select id from fynd_qr.scan_events where code_id = $1', [c.id])).rows.length, 11);
  assert.equal((await store.getCode(code.id, 'alice'))!.totalScans, 11, 'Lifetime total survives detailed-event expiry');
  for (const days of [7, 30, 90]) assert.equal((await app.inject({ url: `/api/codes/${c.id}/analytics?days=${days}`, headers: headers() })).statusCode, 200);
  const original = store.recordScan; store.recordScan = async () => { throw new Error('Injected analytics outage'); };
  try { assert.equal((await app.inject({ url: `/r/${c.slug}` })).statusCode, 302); } finally { store.recordScan = original; }
});
test('Postgres logo library deduplicates concurrent uploads and prevents cross-account reads', async () => {
  const image = `data:image/png;base64,${(await sharp({ create: { width: 240, height: 240, channels: 4, background: '#123456' } }).png().toBuffer()).toString('base64')}`;
  const upload = () => app.inject({ method: 'POST', url: '/api/logos', headers: headers(), payload: { name: 'My logo', image } });
  const [a, b] = await Promise.all([upload(), upload()]);
  assert.ok([200, 201].includes(a.statusCode), a.body); assert.ok([200, 201].includes(b.statusCode), b.body);
  assert.equal(a.json().logo.id, b.json().logo.id); assert.equal(await store.countLogos('alice'), 1);
  const id = a.json().logo.id;
  const saved = await app.inject({ url: `/api/logos/${id}`, headers: headers() }); assert.equal(saved.statusCode, 200);
  assert.ok(saved.json().logo.image.startsWith('data:image/png;base64,'));
  assert.equal((await app.inject({ url: `/api/logos/${id}`, headers: headers(tokenB) })).statusCode, 404);
  assert.deepEqual((await app.inject({ url: '/api/logos', headers: headers(tokenB) })).json().logos, []);
  assert.equal((await app.inject({ url: '/api/logos', headers: headers() })).json().logos.length, 1);
});
test('Postgres connection config verifies TLS and disallows conflicting storage settings', () => {
  const options = postgresConnectionOptions('postgresql://fynd_qr_app:example@db.example.com/postgres');
  assert.equal((options.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
  for (const setting of ['sslmode=disable', 'sslmode=require', 'sslrootcert=other', 'uselibpqcompat=true']) assert.throws(() => postgresConnectionOptions(`postgresql://db.example.com/postgres?${setting}`));
  assert.throws(() => readConfig({ MONGODB_URI: 'mongodb://localhost/test', DATABASE_URL: 'postgresql://localhost/test' }));
  const config = readConfig({ NODE_ENV: 'production', GOOGLE_CLIENT_ID: 'test-client', DATABASE_URL: 'postgresql://db.example.com/postgres', ANALYTICS_SECRET: 'a'.repeat(32), APP_ORIGINS: 'https://sdkfynd.github.io', SCAN_BASE_URL: 'https://api.example.com' });
  assert.equal(config.postgresUri, 'postgresql://db.example.com/postgres'); assert.equal(config.localPreview, false);
});

test('Postgres readiness fails when the password-account migration has not been applied', async () => {
  const unmigrated = await PGlite.create();
  try {
    await unmigrated.exec(readFileSync(new URL('./migrations/001_fynd_qr.sql', import.meta.url), 'utf8'));
    await assert.rejects(new PostgresStore(unmigrated).health(), /password_accounts.*does not exist/);
    await unmigrated.exec(readFileSync(new URL('./migrations/002_password_accounts.sql', import.meta.url), 'utf8'));
    await unmigrated.exec('set role fynd_qr_app');
    await new PostgresStore(unmigrated).health();
  } finally { await unmigrated.close(); }
});
