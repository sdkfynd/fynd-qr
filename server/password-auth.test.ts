import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { PGlite } from '@electric-sql/pglite';
import { connectStore } from './store.ts';
import { PostgresStore } from './postgres-store.ts';
import { buildApp } from './app.ts';
import { readConfig } from './config.ts';
import { hashPassword, verifyPassword, checkPassword, workEmail } from './passwords.ts';
import type { QRStore, CredentialDoc } from './repository.ts';
import { DEFAULT_DESIGN } from '../src/qr.ts';
import type { TokenPayload } from 'google-auth-library';
const origin = 'http://localhost:4173';
const initial = 'local-test temporary passphrase';
const next = 'local-test replacement passphrase';
const config = readConfig({ NODE_ENV: 'test', PASSWORD_LOGIN: '1', GOOGLE_CLIENT_ID: 'test', SCAN_PAGE_URL: `${origin}/` });
const headers = (token?: string) => ({ origin, ...(token ? { authorization: `Bearer ${token}` } : {}) });
const draft = { name: 'Password account code', kind: 'dynamic', contentType: 'url', fields: { url: 'https://example.com/first' }, design: { ...DEFAULT_DESIGN } };

test('passwords use independent salts, bounded passphrases, and exact work domains', async () => {
  const a = await hashPassword(initial), b = await hashPassword(initial);
  assert.notEqual(a, b); assert.ok(!a.includes(initial)); assert.ok(await verifyPassword(initial, a));
  assert.equal(await verifyPassword('wrong', a), false); assert.equal(await verifyPassword(initial), false);
  assert.throws(() => checkPassword('short')); assert.throws(() => checkPassword('a'.repeat(129))); assert.throws(() => checkPassword('password123456789'));
  checkPassword('a unicode phrase with spaces 🌱');
  assert.equal(workEmail(' Person@GoFynd.com '), 'person@gofynd.com');
  for (const email of ['a@other.com', 'a@gofynd.com.evil', 'a@@gofynd.com', 'a b@gofynd.com']) assert.throws(() => workEmail(email));
  const production = { NODE_ENV: 'production', PASSWORD_LOGIN: '1', MONGODB_URI: 'mongodb://example', ANALYTICS_SECRET: 'a'.repeat(32), APP_ORIGINS: 'https://sdkfynd.github.io', SCAN_BASE_URL: 'https://api.example' };
  assert.equal(readConfig(production).googleClientId, ''); assert.throws(() => readConfig({ ...production, PASSWORD_LOGIN: '0' }));
  assert.throws(() => readConfig({ ...production, LOCAL_PREVIEW_AUTH: '1' }));
});
for (const backend of ['MongoDB', 'PostgreSQL']) test(`${backend} individual account lifecycle`, async t => {
  let store: QRStore, close: () => Promise<unknown>;
  if (backend === 'MongoDB') {
    const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
    const connection = await connectStore(mongo.getUri(), 'password_tests'); store = connection.store;
    close = async () => { await connection.client.close(); await mongo.stop(); };
  } else {
    const db = await PGlite.create();
    for (const name of ['001_fynd_qr', '002_password_accounts']) await db.exec(readFileSync(new URL(`./migrations/${name}.sql`, import.meta.url), 'utf8'));
    await db.exec('set role fynd_qr_app'); store = new PostgresStore(db); close = () => db.close();
  }
  const passwordHash = await hashPassword(initial);
  async function fixture(mustChangePassword = true) {
    const id = randomBytes(12).toString('hex'), now = new Date();
    const doc: CredentialDoc = { _id: `manual:${id}`, email: `${id}@gofynd.com`, name: 'Pilot tester', passwordHash, version: 1, mustChangePassword, disabled: false, failedAttempts: 0, lockedUntil: null, createdAt: now, updatedAt: now };
    await store.insertCredential(doc); return doc;
  }
  const app = await buildApp(config, store);
  const login = (doc: CredentialDoc, password = initial, application = app) => application.inject({ method: 'POST', url: '/api/auth/password-login', headers: headers(), payload: { email: doc.email.toUpperCase(), password } });
  const change = (token: string, currentPassword = initial, newPassword = next) => app.inject({ method: 'POST', url: '/api/auth/password', headers: headers(token), payload: { currentPassword, newPassword } });
  try {
    await t.test('configuration exposes readiness, never hashes, and no anonymous private access', async () => {
      const c = (await app.inject({ url: '/api/config' })).json(); assert.equal(c.passwordLogin, true); assert.equal(c.passwordAccountsConfigured, false);
      for (const url of ['/api/codes', '/api/logos', '/api/me']) assert.equal((await app.inject({ url })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: '/api/codes', headers: { ...headers(), 'idempotency-key': randomBytes(16).toString('hex') }, payload: draft })).statusCode, 401);
      const unavailable = await buildApp({ ...config, passwordLogin: false }, store);
      try { assert.equal((await login(await fixture(), initial, unavailable)).statusCode, 404); } finally { await unavailable.close(); }
    });
    await t.test('temporary password cannot access codes or logos until changed; resets invalidate old sessions', async () => {
      const doc = await fixture(), signedIn = await login(doc); assert.equal(signedIn.statusCode, 200, signedIn.body);
      const temporary = signedIn.json(); assert.equal(temporary.account.mustChangePassword, true); assert.ok(!signedIn.body.includes(passwordHash));
      assert.equal((await app.inject({ url: '/api/me', headers: headers(temporary.token) })).statusCode, 200);
      for (const url of ['/api/codes', '/api/logos']) assert.equal((await app.inject({ url, headers: headers(temporary.token) })).statusCode, 403);
      assert.equal((await change(temporary.token, 'wrong')).statusCode, 400);
      assert.equal((await change(temporary.token, initial, initial)).statusCode, 400);
      assert.equal((await change(temporary.token, initial, 'short')).statusCode, 400);
      const changed = await change(temporary.token); assert.equal(changed.statusCode, 200, changed.body); const current = changed.json();
      assert.equal(current.account.mustChangePassword, false); assert.equal((await app.inject({ url: '/api/me', headers: headers(temporary.token) })).statusCode, 401);
      const created = await app.inject({ method: 'POST', url: '/api/codes', headers: { ...headers(current.token), 'idempotency-key': randomBytes(16).toString('hex') }, payload: draft });
      assert.equal(created.statusCode, 201, created.body); const code = created.json().code;
      assert.equal((await app.inject({ url: `/r/${code.slug}` })).headers.location, draft.fields.url, 'Scanning remains anonymous');
      const other = (await login(await fixture(false))).json();
      assert.deepEqual((await app.inject({ url: '/api/codes', headers: headers(other.token) })).json().codes, []);
      assert.equal((await app.inject({ url: `/api/codes/${code.id}/analytics`, headers: headers(other.token) })).statusCode, 404);
      assert.equal((await login(doc, initial)).statusCode, 401); assert.equal((await login(doc, next)).statusCode, 200);
      const credential = (await store.getCredentialById(doc._id))!;
      assert.ok(await store.updateCredentialPassword(doc._id, credential.version, passwordHash, true));
      assert.equal(await store.updateCredentialPassword(doc._id, credential.version, passwordHash, true), null, 'Concurrent/stale reset rejected');
      assert.equal((await app.inject({ url: '/api/codes', headers: headers(current.token) })).statusCode, 401);
      assert.equal((await store.listCodes(doc._id)).length, 1, 'Reset preserves ownership');
    });
    await t.test('five failures lock the account across server instances and reset clears the lock', async () => {
      const doc = await fixture(false), otherApp = await buildApp(config, store);
      try {
        let message = '';
        for (let i = 0; i < 5; i++) { const result = await login(doc, 'wrong', otherApp); assert.equal(result.statusCode, 401); message = result.json().error; }
        const locked = (await store.getCredentialById(doc._id))!; assert.equal(locked.failedAttempts, 5); assert.ok(locked.lockedUntil! > new Date());
        assert.equal((await login(doc, initial, otherApp)).json().error, message);
        const freshApp = await buildApp(config, store);
        try { assert.equal((await login(doc, initial, freshApp)).statusCode, 401); } finally { await freshApp.close(); }
        assert.equal((await login({ ...doc, email: 'unknown@gofynd.com' }, 'wrong', otherApp)).json().error, message);
        assert.equal(await store.confirmPasswordLogin(doc._id, 1), null);
        const future = new Date(+locked.lockedUntil! + 1);
        await store.recordLoginFailure(doc._id, future); const afterExpiry = (await store.getCredentialById(doc._id))!;
        assert.equal(afterExpiry.failedAttempts, 1); assert.equal(afterExpiry.lockedUntil, null);
        await store.updateCredentialPassword(doc._id, 1, passwordHash, true);
        assert.equal((await login(doc, initial, otherApp)).statusCode, 200);
      } finally { await otherApp.close(); }
    });
    await t.test('disabled accounts cannot sign in or reuse sessions; verified Google preserves ownership', async () => {
      const doc = await fixture(false);
      const googleApp = await buildApp(config, store, async () => payload);
      let payload: TokenPayload & { nonce?: string };
      const googleLogin = async () => {
        const challenge = (await googleApp.inject({ method: 'POST', url: '/api/auth/challenge', headers: headers() })).json();
        payload = { sub: 'google-new-identity', email: doc.email, email_verified: true, hd: 'gofynd.com', nonce: challenge.nonce } as typeof payload;
        return googleApp.inject({ method: 'POST', url: '/api/auth/google', headers: headers(), payload: { credential: 'verified-test-token', challengeId: challenge.id } });
      };
      try {
        const signedIn = await login(doc, initial, googleApp); assert.equal(signedIn.statusCode, 200);
        const linked = await googleLogin(); assert.equal(linked.statusCode, 200); assert.equal(linked.json().account.id, doc._id);
        await store.disableCredential(doc._id, true);
        assert.equal((await login(doc, initial, googleApp)).statusCode, 401); assert.equal((await googleLogin()).statusCode, 403);
        for (const token of [signedIn.json().token, linked.json().token]) assert.equal((await googleApp.inject({ url: '/api/me', headers: headers(token) })).statusCode, 401);
        await store.disableCredential(doc._id, false); assert.equal((await login(doc, initial, googleApp)).statusCode, 200);
        assert.equal((await googleApp.inject({ url: '/api/me', headers: headers(signedIn.json().token) })).statusCode, 401);
      } finally { await googleApp.close(); }
    });
    await t.test('IP throttling and trusted-origin checks protect login', async () => {
      const limited = await buildApp(config, store);
      try {
        assert.equal((await limited.inject({ method: 'POST', url: '/api/auth/password-login', payload: { email: 'a@gofynd.com', password: initial } })).statusCode, 403);
        for (let i = 0; i < 10; i++) assert.equal((await limited.inject({ method: 'POST', url: '/api/auth/password-login', headers: headers(), payload: {} })).statusCode, 401);
        assert.equal((await limited.inject({ method: 'POST', url: '/api/auth/password-login', headers: headers(), payload: {} })).statusCode, 429);
      } finally { await limited.close(); }
    });
  } finally { await app.close(); await close(); }
});
