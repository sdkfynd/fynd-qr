// Execute with Deno, the Edge Functions runtime family. This complements the
// Node integration suite and is not a substitute for a hosted smoke check.
import { PGlite } from 'npm:@electric-sql/pglite@0.5.8';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';
import { createEdgeApp } from '../server/edge-app.ts';
import { SupabaseStore } from '../server/supabase-store.ts';
import { DEFAULT_DESIGN } from '../src/qr.ts';
import { normalizeEdgeLogo } from '../server/edge-logos.ts';
import { APIError } from '../server/validation.ts';

Deno.test('Deno: private SQL storage, public resolution, owner checks and PNG processing',async()=>{
  const db=await PGlite.create();
  try {
    for (const file of ['001_fynd_qr.sql','002_password_accounts.sql','003_supabase_auth.sql']) await db.exec(await Deno.readTextFile(new URL(`../server/migrations/${file}`,import.meta.url)));
    await db.exec('set role fynd_qr_app');
    const store=new SupabaseStore(db),origin='https://sdkfynd.github.io',apiUrl='https://example.supabase.co/functions/v1/qr-api';
    const handle=createEdgeApp({supabaseUrl:'https://example.supabase.co',publishableKey:'public-test',apiUrl,scanPage:origin+'/fynd-qr/',origins:[origin],analyticsSecret:'test-only-32-character-analytics-secret'},store,async authorization=>{
      if (authorization!=='Bearer test') throw new APIError(401,'Sign in');
      return {id:'11111111-1111-4111-8111-111111111111',email:'person@gmail.com',googleSubject:'google-person',name:'Test',authoritativeEmail:true};
    });
    const invoke=(path:string,method='GET',body?:unknown,authenticated=true)=>handle(new Request(apiUrl+path,{method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':'runtime-test-request-12345',...(authenticated?{Authorization:'Bearer test'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
    const response=await invoke('/api/codes','POST',{kind:'dynamic',name:'Deno runtime',contentType:'url',fields:{url:'https://example.com/'},design:DEFAULT_DESIGN});
    if (response.status!==201) throw new Error(`Create failed: ${await response.text()}`);
    const {code}=await response.json();
    if ((await invoke('/api/codes','GET',undefined,false)).status!==401) throw new Error('Anonymous ownership bypass');
    const resolved=await invoke(`/api/resolve/${code.slug}`,'GET',undefined,false);
    if ((await resolved.json()).destination!=='https://example.com/') throw new Error('Scan failed');
    const logo=new PNG({width:240,height:240});logo.data.fill(255);
    const image=`data:image/png;base64,${PNG.sync.write(logo).toString('base64')}`;
    const normalized=normalizeEdgeLogo(image);
    if (PNG.sync.read(Buffer.from(normalized.thumbnail.slice(22),'base64')).width!==96) throw new Error('Thumbnail failed');
    const uploaded=await invoke('/api/logos','POST',{name:'Deno logo',image});
    if (uploaded.status!==201) throw new Error(`Logo failed: ${await uploaded.text()}`);
    const paused=await invoke(`/api/codes/${code.id}`,'PATCH',{revision:1,status:'paused'});
    if (paused.status!==200 || (await invoke(`/api/resolve/${code.slug}`,'GET',undefined,false)).status!==410) throw new Error('Pause failed');
  } finally {await db.close();}
});
