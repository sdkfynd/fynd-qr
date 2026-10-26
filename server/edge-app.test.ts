import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PNG } from 'pngjs';
import { deflateSync } from 'node:zlib';
import { createEdgeApp, edgeConfig, type EdgeConfig } from './edge-app.ts';
import { SupabaseStore } from './supabase-store.ts';
import { supabaseVerifier, googleIdentity } from './supabase-auth.ts';
import { normalizeEdgeLogo } from './edge-logos.ts';
import { PostgresStore } from './postgres-store.ts';
import { DEFAULT_DESIGN } from '../src/qr.ts';
import type { CodeDoc } from './repository.ts';
import { assertPublishableKey } from '../src/public-config.ts';

const alice={id:'11111111-1111-4111-8111-111111111111',email:'alice@gmail.com',subject:'google-alice'};
const bob={id:'22222222-2222-4222-8222-222222222222',email:'bob@another.org',subject:'google-bob'};
const user=(a=alice) => ({id:a.id,email:a.email,email_confirmed_at:'2026-01-01T00:00:00Z',
  identities:[{provider:'google',identity_data:{sub:a.subject,email:a.email,email_verified:true,name:'QR creator'}}]});
const secret=randomBytes(32), origin='https://sdkfynd.github.io';
const sign=(sub:string,expires=Math.floor(Date.now()/1000)+300,key=secret) => {
  const body=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub,exp:expires})).toString('base64url')].join('.');
  return `${body}.${createHmac('sha256',key).update(body).digest('base64url')}`;
};
const auth=createServer((req,res) => {
  assert.equal(req.url,'/auth/v1/user'); assert.equal(req.headers.apikey,'public-test-key');
  try {
    const [header,payload,sig]=(req.headers.authorization || '').slice(7).split('.');
    const correct=createHmac('sha256',secret).update(`${header}.${payload}`).digest();
    const supplied=Buffer.from(sig,'base64url'), claims=JSON.parse(Buffer.from(payload,'base64url').toString());
    if (correct.length!==supplied.length || !timingSafeEqual(correct,supplied) || claims.exp<=Date.now()/1000) throw new Error('Invalid JWT');
    const account=claims.sub===alice.id?alice:claims.sub===bob.id?bob:null;
    if (!account) throw new Error('Missing user');
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(user(account)));
  } catch { res.writeHead(401,{'Content-Type':'application/json'}); res.end('{"message":"Invalid token"}'); }
});
let db:PGlite,store:SupabaseStore,handle:(request:Request)=>Promise<Response>,config:EdgeConfig;
const tokenA=sign(alice.id),tokenB=sign(bob.id);
const draft=(name='QR campaign',kind='dynamic') => ({kind,name,contentType:'url',fields:{url:'https://example.com/first'},design:DEFAULT_DESIGN});
async function call(path:string,token:string|null=tokenA,method='GET',body?:unknown,key?:string) {
  return handle(new Request(config.apiUrl+path,{method,headers:{Origin:origin,
    ...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),
    ...(key?{'Idempotency-Key':key}:{}),'User-Agent':'Mozilla/5.0 (iPhone) Safari/605.1'},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})}));
}
async function create(name='QR campaign',kind='dynamic') { const response=await call('/api/codes',tokenA,'POST',draft(name,kind),randomBytes(16).toString('hex')); assert.equal(response.status,201,await response.clone().text()); return (await response.json()).code; }
before(async()=>{
  await new Promise<void>(resolve=>auth.listen(0,'127.0.0.1',resolve));
  db=await PGlite.create();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create table public.bins(id int primary key); insert into public.bins values(1);');
  for (let pass=0;pass<2;pass++) for (const file of ['001_fynd_qr.sql','002_password_accounts.sql','003_supabase_auth.sql']) await db.exec(readFileSync(new URL(`./migrations/${file}`,import.meta.url),'utf8'));
  await db.exec('set role fynd_qr_app'); store=new SupabaseStore(db);
  const address=auth.address() as {port:number};
  config={supabaseUrl:`http://127.0.0.1:${address.port}`,publishableKey:'public-test-key',apiUrl:'https://project.supabase.co/functions/v1/qr-api',origins:[origin],analyticsSecret:'test-analytics-secret-32-characters-long',scanPage:'https://sdkfynd.github.io/fynd-qr/'};
  handle=createEdgeApp(config,store);
});
after(async()=>{await db?.close();await new Promise<void>(resolve=>auth.close(()=>resolve()));});

test('Edge auth accepts personal Gmail and other Google domains, with no Workspace requirement',async()=>{
  for (const token of [tokenA,tokenB]) { const response=await call('/api/me',token);assert.equal(response.status,200);assert.ok((await response.json()).account.email); }
  for (const account of [alice,bob]) assert.equal(googleIdentity(user(account)).id,account.id);
  const unverified=user();unverified.identities[0].identity_data.email_verified=false;assert.throws(()=>googleIdentity(unverified));
  assert.throws(()=>googleIdentity({...user(),identities:[{provider:'email',identity_data:{email_verified:true,sub:'forged'}}]}));
  assert.throws(()=>googleIdentity({...user(),identities:[],user_metadata:{provider:'google',email_verified:true}}));
  const workspace=user({id:alice.id,email:'person@company.example',subject:'workspace-sub'});
  Object.assign(workspace.identities[0].identity_data,{custom_claims:{hd:'company.example'}});
  assert.equal(googleIdentity(workspace).authoritativeEmail,true);
  const consumer=user({id:alice.id,email:'person@company.example',subject:'consumer-sub'});
  assert.equal(googleIdentity(consumer).authoritativeEmail,false);
});
test('Edge rejects missing, malformed, forged and expired tokens on every management surface',async()=>{
  for (const token of [null,'not-a-jwt',sign(alice.id,Math.floor(Date.now()/1000)-1),sign(alice.id,Math.floor(Date.now()/1000)+300,randomBytes(32))]) {
    for (const path of ['/api/me','/api/codes','/api/logos','/api/codes/aaaaaaaaaaaaaaaaaaaaaaaa/analytics']) assert.equal((await call(path,token)).status,401);
    assert.equal((await call('/api/codes',token,'POST',draft(),'a'.repeat(32))).status,401);
  }
});
test('Hosted gateway and full invoke paths keep public routes public and management authenticated',async()=>{
  for (const prefix of ['/qr-api','/functions/v1/qr-api']) {
    const request=(path:string,token?:string)=>handle(new Request('https://project.supabase.co'+prefix+path,{headers:{Origin:origin,...(token?{Authorization:`Bearer ${token}`}:{})}}));
    assert.equal((await request('/health')).status,200);
    assert.equal((await request('/api/config')).status,200);
    assert.equal((await request('/api/resolve/abcdefghijkl')).status,404);
    assert.equal((await request('/api/codes')).status,401);
    assert.equal((await request('/api/me',tokenA)).status,200);
  }
  assert.equal((await handle(new Request('https://project.supabase.co/qr-api-extra/health',{headers:{Origin:origin}}))).status,401);
});
test('Auth service outages fail closed and preserve an existing session in the browser',async()=>{
  const verify=supabaseVerifier(config,async()=>new Response('down',{status:503}));
  await assert.rejects(verify(`Bearer ${tokenA}`),(e:any)=>e.statusCode===503);
});
test('Edge keeps public scans anonymous, preserves the scan URL through edits, and enforces owner isolation',async()=>{
  const code=await create();assert.equal(code.scanUrl,`${config.scanPage}#r/${code.slug}`);
  assert.equal('ownerId' in code,false);assert.equal('requestKey' in code,false);
  assert.deepEqual((await (await call('/api/codes',tokenB)).json()).codes,[]);
  assert.equal((await call(`/api/codes/${code.id}/analytics`,tokenB)).status,404);
  assert.equal((await call(`/api/codes/${code.id}`,tokenB,'PATCH',{revision:1,status:'paused'})).status,404);
  const changed=await call(`/api/codes/${code.id}`,tokenA,'PATCH',{revision:1,draft:{...draft(),fields:{url:'https://example.org/next'}}});
  assert.equal(changed.status,200);const updated=(await changed.json()).code;
  assert.equal(updated.scanUrl,code.scanUrl);assert.equal(updated.payload,code.payload);assert.equal(updated.slug,code.slug);
  const scan=await call(`/api/resolve/${code.slug}`,null);assert.equal(scan.status,200);assert.equal((await scan.json()).destination,'https://example.org/next');
  assert.equal((await call(`/api/codes/${code.id}`,tokenA,'PATCH',{revision:1,status:'paused'})).status,409);
  const redirect=await call(`/r/${code.slug}`,null,'HEAD');assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),'https://example.org/next');
  const analytics=(await (await call(`/api/codes/${code.id}/analytics?days=7`)).json()).analytics;
  assert.equal(analytics.scans,1);assert.equal(analytics.visitors,1);assert.equal(analytics.daily.length,7);
  for (const [revision,status,expected] of [[2,'paused',410],[3,'active',200],[4,'archived',404],[5,'active',200]] as const) {
    assert.equal((await call(`/api/codes/${code.id}`,tokenA,'PATCH',{revision,status})).status,200);
    assert.equal((await call(`/api/resolve/${code.slug}`,null)).status,expected);
  }
});
test('Edge idempotency and static saved designs retain their existing behavior',async()=>{
  const key=randomBytes(16).toString('hex');
  const a=await call('/api/codes',tokenA,'POST',draft('Once','static'),key),b=await call('/api/codes',tokenA,'POST',draft('Once','static'),key);
  assert.equal(a.status,201);assert.equal(b.status,200);const code=(await a.json()).code;
  assert.equal((await b.json()).code.id,code.id);assert.equal(code.payload,'https://example.com/first');assert.equal(code.scanUrl,null);
  assert.equal((await call(`/api/codes/${code.id}/analytics`)).status,400);
});
test('Legacy Google and provisioned account owners remain accessible without rewriting any saved QR address',async()=>{
  const now=new Date(),legacy=new PostgresStore(db),legacyId=randomBytes(12).toString('hex');
  const record:CodeDoc={...draft('Legacy'),kind:'dynamic',contentType:'url',id:legacyId,_id:legacyId,ownerId:alice.subject,requestKey:'legacy-request',slug:'legacySlug12',scanUrl:'https://sdkfynd.github.io/fynd-qr/#r/legacySlug12',destination:'https://example.com/old',payload:'https://sdkfynd.github.io/fynd-qr/#r/legacySlug12',status:'active',createdAt:now,updatedAt:now,lastScanAt:null,totalScans:12,revision:1};
  await legacy.insertCode(record);
  const credentialId='manual:existing';await legacy.insertCredential({_id:credentialId,email:alice.email,name:'Previous owner',passwordHash:'unused',version:1,mustChangePassword:true,disabled:false,failedAttempts:0,lockedUntil:null,createdAt:now,updatedAt:now});
  const manualId=randomBytes(12).toString('hex');await legacy.insertCode({...record,_id:manualId,id:manualId,ownerId:credentialId,slug:'manualSlug12',scanUrl:'https://old-api.example/r/manualSlug12',payload:'https://old-api.example/r/manualSlug12'});
  const codes=(await (await call('/api/codes')).json()).codes;
  for (const expected of [record,{...record,id:manualId,scanUrl:'https://old-api.example/r/manualSlug12'}]) {
    const found=codes.find((c:any)=>c.id===expected.id);assert.ok(found);assert.equal(found.scanUrl,expected.scanUrl);assert.equal(found.totalScans,12);
  }
  assert.equal((await call(`/api/codes/${legacyId}/analytics`,tokenB)).status,404);
  assert.equal((await call(`/api/codes/${manualId}`,tokenA,'PATCH',{revision:1,status:'paused'})).status,200);
});
test('An identity collision fails closed atomically and disabled legacy accounts remain blocked',async()=>{
  await assert.rejects(store.linkIdentity({id:bob.id,email:bob.email,name:'Bob',googleSubject:alice.subject}),(e:any)=>e.statusCode===409);
  const now=new Date();await store.insertCredential({_id:'manual:disabled',email:'disabled@gmail.com',name:'Disabled',passwordHash:'unused',version:1,mustChangePassword:false,disabled:true,failedAttempts:0,lockedUntil:null,createdAt:now,updatedAt:now});
  await assert.rejects(store.linkIdentity({id:alice.id,email:'disabled@gmail.com',name:'Disabled',googleSubject:'disabled-sub'}),(e:any)=>e.statusCode===403);
  assert.equal((await db.query("select * from fynd_qr.auth_owner_links where owner_id='disabled-sub'")).rows.length,0);
});
test('Third-party Google emails cannot claim manual legacy work without an administrator approval',async()=>{
  const now=new Date(),manual='manual:third-party';
  await store.insertCredential({_id:manual,email:bob.email,name:'Legacy person',passwordHash:'unused',version:1,mustChangePassword:false,disabled:false,failedAttempts:0,lockedUntil:null,createdAt:now,updatedAt:now});
  const legacyId=randomBytes(12).toString('hex');
  await store.insertCode({...draft('Prior work'),kind:'static',contentType:'url',_id:legacyId,id:legacyId,ownerId:manual,requestKey:'third-party-legacy',slug:null,scanUrl:null,destination:null,payload:'https://example.com/first',status:'active',createdAt:now,updatedAt:now,lastScanAt:null,totalScans:0,revision:1});
  assert.equal((await call('/api/me',tokenB)).status,409);
  await assert.rejects(db.query('insert into fynd_qr.owner_claim_approvals(owner_id,auth_user_id) values($1,$2)',[manual,bob.id]),/permission denied/);
  await db.exec('reset role');try{await db.query('insert into fynd_qr.owner_claim_approvals(owner_id,auth_user_id) values($1,$2)',[manual,bob.id]);}finally{await db.exec('set role fynd_qr_app');}
  assert.equal((await call('/api/me',tokenB)).status,200);assert.ok(await store.getCode(legacyId,bob.id));
  await store.disableCredential(manual,true);
  await assert.rejects(store.linkIdentity({id:bob.id,email:'renamed@gmail.com',name:'Same Google user',googleSubject:bob.subject,authoritativeEmail:true}),(e:any)=>e.statusCode===403);
  await store.disableCredential(manual,false);
});
test('Edge PNG normalization bounds dimensions before decompression and logos are private and deduplicated',async()=>{
  const png=new PNG({width:240,height:240});png.data.fill(255);const image=`data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
  const response=await call('/api/logos',tokenA,'POST',{name:'My logo',image});assert.equal(response.status,201);const logo=(await response.json()).logo;
  assert.equal(PNG.sync.read(Buffer.from(logo.thumbnail.slice(22),'base64')).width,96);
  assert.equal((await call(`/api/logos/${logo.id}`,tokenB)).status,404);assert.deepEqual((await (await call('/api/logos',tokenB)).json()).logos,[]);
  const duplicate=await call('/api/logos',tokenA,'POST',{name:'Same',image});assert.equal((await duplicate.json()).duplicate,true);
  const chunk=(type:string,data:Buffer) => {
    const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
    for (const byte of bytes) {crc^=byte;for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);bytes.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  const signature=Buffer.from([137,80,78,71,13,10,26,10]),end=chunk('IEND',Buffer.alloc(0));
  const duplicateHeader=Buffer.from(header);duplicateHeader.writeUInt32BE(241);
  const duplicatePng=Buffer.concat([signature,chunk('IHDR',header),chunk('IHDR',duplicateHeader),chunk('IDAT',deflateSync(Buffer.alloc(965))),end]);
  const bomb=Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(128*1024))),end]);
  const interlacedHeader=Buffer.from(header);interlacedHeader[12]=1;
  const interlaced=Buffer.concat([signature,chunk('IHDR',interlacedHeader),chunk('IDAT',deflateSync(Buffer.alloc(5))),end]);
  for (const invalid of [duplicatePng,bomb,interlaced]) assert.throws(()=>normalizeEdgeLogo(`data:image/png;base64,${invalid.toString('base64')}`));
  const oversized=Buffer.from(PNG.sync.write(png));oversized.writeUInt32BE(100000,16);
  for (const value of ['data:image/png;base64,YmFk',`data:image/png;base64,${oversized.toString('base64')}`,'https://private.example/logo.png']) assert.throws(()=>normalizeEdgeLogo(value));
});
test('Edge schema permissions do not expose QR or unrelated tables to public API roles',async()=>{
  await assert.rejects(db.query('select * from public.bins'),/permission denied/);
  await db.exec('reset role');assert.deepEqual((await db.query('select * from public.bins')).rows,[{id:1}]);
  try { for (const role of ['anon','authenticated','service_role']) { await db.exec(`set role ${role}`); for (const table of ['qr_codes','logos','auth_owner_links','request_limits']) await assert.rejects(db.query(`select * from fynd_qr.${table}`),/permission denied/);await db.exec('reset role'); } }
  finally {await db.exec('reset role');await db.exec('set role fynd_qr_app');}
});
test('Edge CORS, body validation, public readiness, malformed scans and persistent rate limits',async()=>{
  const preflight=await handle(new Request(config.apiUrl+'/api/codes',{method:'OPTIONS',headers:{Origin:origin}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await handle(new Request(config.apiUrl+'/api/codes',{headers:{Origin:'https://evil.example',Authorization:`Bearer ${tokenA}`}}))).status,403);
  assert.equal((await call('/health',null)).status,200);const publicConfig=await (await call('/api/config',null)).json();assert.equal(publicConfig.localPreview,false);assert.equal(publicConfig.authProvider,'supabase');assert.equal(JSON.stringify(publicConfig).includes('secret'),false);
  assert.equal((await call('/api/resolve/bad',null)).status,404);
  assert.equal((await call('/api/codes',tokenA,'POST',{...draft(),ownerId:bob.id},randomBytes(16).toString('hex'))).status,400);
  assert.equal((await call('/api/codes',tokenA,'POST',{...draft(),fields:{url:'http://127.0.0.1/admin'}},randomBytes(16).toString('hex'))).status,400);
  assert.equal(await store.rateLimit('test-window',1),true);assert.equal(await store.rateLimit('test-window',1),false);
  assert.throws(()=>edgeConfig({SUPABASE_URL:'http://localhost',SUPABASE_ANON_KEY:'test',QR_ANALYTICS_SECRET:'a'.repeat(32)}));
  assertPublishableKey('sb_publishable_'+'a'.repeat(24));
  const legacyKey=(role:string)=>`header.${Buffer.from(JSON.stringify({role})).toString('base64url')}.signature`;
  assertPublishableKey(legacyKey('anon'));
  for(const key of ['sb_secret_'+'a'.repeat(24),legacyKey('service_role'),legacyKey('authenticated')]) assert.throws(()=>assertPublishableKey(key));
});
