import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectStore } from './store.ts';
import { connectPostgresStore } from './postgres-store.ts';
import { hashPassword, accountEmail } from './passwords.ts';

// Operator-only tool: credentials are never accepted through shell arguments or a public endpoint.
async function main() {
  const args = process.argv.slice(2), local = args.includes('--local');
  const [action, rawEmail, name, ...extra] = args.filter(a => a !== '--local');
  if (!['create', 'reset', 'disable', 'enable'].includes(action) || !rawEmail || extra.length || (action === 'create' && !name?.trim()) || (action !== 'create' && name)) throw new Error('Usage: pnpm accounts [--local] create email "Name" | reset email | disable email | enable email');
  const email = accountEmail(rawEmail);
  let mongoUri = process.env.MONGODB_URI || '', postgresUri = process.env.DATABASE_URL || '', database = process.env.MONGODB_DATABASE || 'fynd_qr';
  if (local) {
    const connection = JSON.parse(await readFile('.local-data/dev-connection.json', 'utf8'));
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(connection.uri)) throw new Error('Start pnpm dev:full before managing local accounts.');
    mongoUri = connection.uri; database = connection.database; postgresUri = '';
  }
  if ((!mongoUri && !postgresUri) || (mongoUri && postgresUri)) throw new Error('Choose one database connection in .env.server, or use --local with the local preview running.');
  const { store, client } = postgresUri ? await connectPostgresStore(postgresUri, process.env.DATABASE_CA_FILE) : await connectStore(mongoUri, database);
  try {
    const existing = await store.getCredentialByEmail(email);
    if (action === 'create' && existing) throw new Error('This account already exists. Use reset to issue a new temporary password.');
    if (action !== 'create' && !existing) throw new Error('Account not found.');
    if (action === 'disable' || action === 'enable') {
      await store.disableCredential(existing!._id, action === 'disable');
      console.log(`Account ${action === 'disable' ? 'disabled' : 'enabled'}: ${email}. Previous sessions are invalid.`); return;
    }
    if (existing?.disabled) throw new Error('Enable this account before resetting its password.');
    const password = randomBytes(24).toString('base64url'), passwordHash = await hashPassword(password), now = new Date();
    const directory = resolve('.local-data/invites');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = resolve(directory, `${local ? 'local' : 'issued'}-${randomBytes(8).toString('hex')}.txt`);
    await writeFile(file, `${local ? 'LOCAL TEST ACCOUNT — works only on this computer' : 'Fynd QR — individual account'}\nName: ${existing?.name || name.trim().slice(0, 80)}\nEmail: ${email}\nTemporary password: ${password}\n\nSet your own password after signing in. Share these credentials privately with this person only, after verifying their work identity. Remove this file after delivery.\n`, { mode: 0o600, flag: 'wx' });
    try {
      if (existing) {
        if (!await store.updateCredentialPassword(existing._id, existing.version, passwordHash, true)) throw new Error('Account changed during reset. Please retry.');
      } else await store.insertCredential({ _id: `manual:${randomBytes(16).toString('hex')}`, email, name: name.trim().slice(0, 80), passwordHash, version: 1, mustChangePassword: true, disabled: false, failedAttempts: 0, lockedUntil: null, createdAt: now, updatedAt: now });
    } catch (error) { await unlink(file); throw error; }
    console.log(`Account ${existing ? 'reset' : 'created'}: ${email}. Temporary credentials saved in a private, Git-ignored file:\n${file}`);
  } finally { await client.close(); }
}
main().catch(error => { console.error(error instanceof Error && !('code' in error) ? error.message : 'Account operation failed. Check database access and migrations.'); process.exitCode = 1; });
