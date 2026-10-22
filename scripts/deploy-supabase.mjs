import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Read the deployment token only from the environment, never CLI arguments.
const token=process.env.SUPABASE_ACCESS_TOKEN || '',ref=process.env.SUPABASE_PROJECT_REF || '';
assert.ok(token && /^[a-z]{20}$/.test(ref),'Configure the selected QR project reference and deployment access token.');
assert.equal(process.env.QR_SUPABASE_URL,`https://${ref}.supabase.co`,'Deploy only to the selected QR project.');
async function management(path,body) {
  const response=await fetch('https://api.supabase.com/v1'+path,{method:body?'POST':'GET',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`Supabase management request failed (${response.status}); no response body or credentials were logged.`);
  return response.json();
}
const query=(project,sql)=>management(`/projects/${project}/database/query`,{query:sql});
async function inventory(project) {
  const [found]=await query(project,"select to_regclass('fynd_qr.qr_codes')::text as codes, to_regclass('fynd_qr.logos')::text as logos");
  return {codes:found.codes?await query(project,'select id,owner_id,slug,scan_url from fynd_qr.qr_codes order by id'):[],
    logos:found.logos?await query(project,'select id,owner_id,digest from fynd_qr.logos order by id'):[]};
}
const before=await inventory(ref),legacyRef=process.env.QR_LEGACY_PROJECT_REF;
if (legacyRef && legacyRef!==ref) {
  assert.match(legacyRef,/^[a-z]{20}$/);
  const legacy=await inventory(legacyRef);
  for (const table of ['codes','logos']) for (const record of legacy[table]) {
    const same=before[table].find(row=>row.id===record.id);
    assert.ok(same && JSON.stringify(same)===JSON.stringify(record),'Migrate existing QR ownership and addresses before changing projects. No legacy data was modified.');
  }
  console.log('Legacy QR inventory matched the destination; existing ownership and addresses are preserved.');
}
assert.ok(before.codes.every(row=>!row.scan_url || row.scan_url.startsWith('https://sdkfynd.github.io/fynd-qr/#r/')),
  'Some existing codes use another scan origin. Keep that origin working and review routing before this release. No QR URL was rewritten.');
if (process.argv.includes('--migrate')) {
  for (const file of ['001_fynd_qr.sql','002_password_accounts.sql','003_supabase_auth.sql']) await query(ref,await readFile(new URL(`../server/migrations/${file}`,import.meta.url),'utf8'));
  assert.ok(JSON.stringify(await inventory(ref))===JSON.stringify(before),'Migration must preserve QR ownership, ids, slugs and scan addresses.');
  console.log('QR-only migrations applied; existing codes, logos and scan addresses verified.');
}
const auth=await management(`/projects/${ref}/config/auth`);
assert.equal(auth.external_google_enabled,true,'Enable Google in the selected QR project.');
assert.equal(auth.disable_signup,false,'Allow ordinary Google accounts to create their QR account.');
assert.equal(auth.site_url,'https://sdkfynd.github.io/fynd-qr/','Use the stable GitHub Pages site URL.');
if (process.argv.includes('--deploy')) {
  const child=spawn('pnpm',['dlx','supabase@2.121.0','functions','deploy','qr-api','--project-ref',ref,'--use-api'],{stdio:'inherit',env:process.env});
  const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
  assert.equal(result,0,'Edge Function deployment failed.');
}
console.log(`QR deployment target verified; ${before.codes.length} saved codes and ${before.logos.length} logos retained.`);
