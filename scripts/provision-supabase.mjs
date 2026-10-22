import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, pbkdf2Sync, createHmac, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';

// Private operator input is outside source control. Its contents are never
// logged. Only the explicitly selected dedicated QR project can be modified.
const file=process.env.QR_PRIVATE_CREDENTIAL_FILE || '';
assert.ok(file,'Provide the private project credential file path.');
assert.equal((await stat(file)).mode & 0o777,0o600,'The credential file must have owner-only permissions.');
const credentials=JSON.parse(await readFile(file,'utf8')),ref=process.env.SUPABASE_PROJECT_REF || '';
assert.match(ref,/^[a-z]{20}$/);assert.equal(credentials.project_ref,ref);
assert.equal(credentials.project_url,`https://${ref}.supabase.co`);
const host=credentials.transaction_pooler_host;
assert.ok(typeof host==='string' && host.endsWith('.pooler.supabase.com'),'Use the pooler host verified in the selected project dashboard.');
const url=new URL('postgresql://localhost/postgres');url.hostname=host;url.port='5432';url.username=`postgres.${ref}`;url.password=credentials.db_password;
const ca=credentials.database_ca || (process.env.QR_DATABASE_CA_FILE?await readFile(process.env.QR_DATABASE_CA_FILE,'utf8'):'');
const options={max:1,connectionTimeoutMillis:8000,statement_timeout:15_000,query_timeout:16_000,idleTimeoutMillis:1000,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}};
const pool=new Pool({...options,connectionString:url.href});
const secretFile=new URL('../.env.edge',import.meta.url);
try {
  // A dedicated empty public schema prevents accidentally treating another
  // application/project as this new QR deployment target.
  const {rows:[other]}=await pool.query("select count(*)::int as count from pg_tables where schemaname='public'");
  assert.equal(other.count,0,'This operator setup requires the dedicated QR project, with no unrelated public application tables.');
  const {rows:[found]}=await pool.query("select to_regclass('fynd_qr.qr_codes')::text as codes");
  const before=found.codes?(await pool.query('select id,owner_id,slug,scan_url from fynd_qr.qr_codes order by id')).rows:[];
  for (const name of ['001_fynd_qr.sql','002_password_accounts.sql','003_supabase_auth.sql']) await pool.query(await readFile(new URL(`../server/migrations/${name}`,import.meta.url),'utf8'));
  const after=(await pool.query('select id,owner_id,slug,scan_url from fynd_qr.qr_codes order by id')).rows;
  assert.ok(JSON.stringify(before)===JSON.stringify(after),'QR ids, ownership and scan addresses must stay unchanged.');
  const {rows:[role]}=await pool.query("select rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname='fynd_qr_app'");
  assert.ok(role && !role.rolsuper && !role.rolbypassrls && !role.rolcreatedb && !role.rolcreaterole,'Runtime role must be restricted to the QR schema.');
  if (existsSync(secretFile)) {
    assert.equal((await stat(secretFile)).mode & 0o777,0o600);
    process.loadEnvFile(secretFile);
  } else {
    assert.equal(role.rolcanlogin,false,'An active app role has no staged credential. Refusing to reset it.');
    const password=randomBytes(32).toString('base64url'),appUrl=new URL(url);appUrl.port='6543';appUrl.username=`fynd_qr_app.${ref}`;appUrl.password=password;
    const secrets={QR_DATABASE_URL:appUrl.href,QR_ANALYTICS_SECRET:randomBytes(32).toString('hex'),QR_SCAN_PAGE_URL:'https://sdkfynd.github.io/fynd-qr/',QR_APP_ORIGINS:'https://sdkfynd.github.io',...(ca?{QR_DATABASE_CA:ca}:{})};
    await writeFile(secretFile,Object.entries(secrets).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
    process.loadEnvFile(secretFile);
  }
  const appUrl=new URL(process.env.QR_DATABASE_URL);
  assert.equal(appUrl.hostname,host);assert.equal(appUrl.username,`fynd_qr_app.${ref}`);
  if (!role.rolcanlogin) {
    // PostgreSQL receives a SCRAM verifier, never a raw password in query history.
    const password=decodeURIComponent(appUrl.password),salt=randomBytes(16),salted=pbkdf2Sync(password,salt,4096,32,'sha256');
    const client=createHmac('sha256',salted).update('Client Key').digest();
    const stored=createHash('sha256').update(client).digest('base64'),server=createHmac('sha256',salted).update('Server Key').digest('base64');
    const verifier=`SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
    assert.match(verifier,/^[A-Za-z\d$:+/=-]+$/);
    await pool.query(`alter role fynd_qr_app login password '${verifier}'`);
  }
  const app=new Pool({...options,connectionString:appUrl.href});
  try {
    const {rows:[runtime]}=await app.query('select current_user as name');assert.equal(runtime.name,'fynd_qr_app');
    for (const table of ['qr_codes','logos','password_accounts','auth_owner_links','owner_claim_approvals','request_limits']) await app.query(`select 1 from fynd_qr.${table} limit 0`);
    const {rows:[permissions]}=await app.query("select has_schema_privilege(current_user,'public','CREATE') as can_create");assert.equal(permissions.can_create,false);
  } finally {await app.end();}
  if (process.argv.includes('--upload')) {
    assert.ok(process.env.SUPABASE_ACCESS_TOKEN,'Provide a QR-project-scoped token to upload Edge secrets.');
    const child=spawn('pnpm',['dlx','supabase@2.121.0','secrets','set','--project-ref',ref,'--env-file',secretFile.pathname],{stdio:'inherit',env:process.env});
    const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});assert.equal(result,0);
  }
  console.log('QR migrations, preserved scan addresses, restricted app login and verified TLS connection passed. Private Edge secrets are staged with mode 0600.');
} catch(error) {
  // pg errors can include connection text. Report only a safe code/category.
  console.error('QR project provisioning stopped:',error.code || error.name || 'Error');
  process.exitCode=1;
} finally {await pool.end();}
