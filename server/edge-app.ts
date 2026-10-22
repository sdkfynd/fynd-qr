import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { APIError, parseDraft } from './validation.ts';
import { normalizeEdgeLogo } from './edge-logos.ts';
import { supabaseVerifier } from './supabase-auth.ts';
import type { GoogleIdentity, SupabaseStore } from './supabase-store.ts';
import type { CodeDoc, CodePatch, LogoDoc, ScanMeta } from './repository.ts';

export interface EdgeConfig {
  supabaseUrl: string; publishableKey: string; apiUrl: string; scanPage: string;
  origins: string[]; analyticsSecret: string;
}
export function edgeConfig(env: Record<string,string|undefined>): EdgeConfig {
  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/$/,'');
  const apiUrl = `${supabaseUrl}/functions/v1/qr-api`;
  const scanPage = env.QR_SCAN_PAGE_URL || 'https://sdkfynd.github.io/fynd-qr/';
  const origins = (env.QR_APP_ORIGINS || 'https://sdkfynd.github.io').split(',').map(s=>s.trim());
  const publishableKey = env.QR_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  const analyticsSecret = env.QR_ANALYTICS_SECRET || '';
  if (!/^https:\/\/[^/]+$/.test(supabaseUrl) || !publishableKey || analyticsSecret.length < 32 ||
      !/^https:\/\/.+\/$/.test(scanPage) || new URL(scanPage).hash || new URL(scanPage).search ||
      origins.some(origin=>new URL(origin).origin!==origin || !origin.startsWith('https://'))) throw new Error('Configure the Supabase project, publishable key, analytics secret and HTTPS app/scan URLs.');
  return { supabaseUrl, apiUrl, scanPage, origins, publishableKey, analyticsSecret };
}
const id = () => randomBytes(12).toString('hex');
const summary = (l: LogoDoc) => ({ id:l._id, name:l.name, thumbnail:l.thumbnail, createdAt:l.createdAt.toISOString() });
const validId = (value: string) => /^[a-f\d]{24}$/.test(value);
const patchSchema = z.object({ revision:z.number().int().positive(), draft:z.unknown().optional(), status:z.enum(['active','paused','archived']).optional() }).strict();
const logoSchema = z.object({ name:z.string().trim().min(1).max(80), image:z.string().max(330_000) }).strict();

function scanMeta(request: Request, secret: string, codeId: string, page: boolean): ScanMeta {
  const ua = (request.headers.get('user-agent') || '').slice(0,1000);
  const automated = /bot|crawl|spider|preview|slack|discord|facebookexternalhit|headless|monitor|curl|wget/i.test(ua) || /prefetch/i.test(request.headers.get('sec-purpose') || request.headers.get('purpose') || '');
  let referrer='Direct / unknown';
  if (page) {
    const source=request.headers.get('x-qr-referrer') || '';
    if (/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z\d-]{2,63}$/i.test(source) && source.length<=253) referrer=source.toLowerCase();
  } else { try { referrer=new URL(request.headers.get('referer') || '').hostname.slice(0,200); } catch { /* Usually unavailable. */ } }
  return { automated, referrer, country:'Unknown',
    device:/ipad|tablet/i.test(ua)?'Tablet':/mobile|iphone|android/i.test(ua)?'Mobile':ua?'Desktop':'Unknown',
    browser:/edg\//i.test(ua)?'Edge':/opr\//i.test(ua)?'Opera':/chrome|crios/i.test(ua)?'Chrome':/firefox|fxios/i.test(ua)?'Firefox':/safari/i.test(ua)?'Safari':'Other',
    visitor:createHmac('sha256',secret).update(`${codeId}\n${request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'}\n${ua}`).digest('hex') };
}

export function createEdgeApp(config: EdgeConfig, store: SupabaseStore, verify=supabaseVerifier(config)) {
  let nextCleanup=0;
  return async (request: Request): Promise<Response> => {
    const origin=request.headers.get('origin');
    const headers: Record<string,string> = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', Vary:'Origin' };
    if (origin && config.origins.includes(origin)) headers['Access-Control-Allow-Origin']=origin;
    const json=(body:unknown,status=200) => Response.json(body,{status,headers});
    try {
      const url=new URL(request.url), base=new URL(config.apiUrl).pathname;
      const path=url.pathname.startsWith(base+'/')?url.pathname.slice(base.length):url.pathname;
      if (origin && !config.origins.includes(origin)) throw new APIError(403,'This website is not allowed to access the account service.');
      if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{...headers,
        'Access-Control-Allow-Methods':'GET, HEAD, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers':'authorization, apikey, content-type, idempotency-key, x-qr-referrer, x-client-info',
        'Access-Control-Max-Age':'600'}});
      if (['POST','PATCH','DELETE'].includes(request.method) && !origin) throw new APIError(403,'A trusted app origin is required.');
      if (Date.now()>nextCleanup) { nextCleanup=Date.now()+300_000; await store.cleanup(); }
      if (request.method==='GET' && path==='/health') { await store.health(); return json({status:'ok'}); }
      if (request.method==='GET' && path==='/api/config') return json({ authProvider:'supabase', googleLogin:true, localPreview:false, passwordLogin:false, scanBase:config.apiUrl, scanPage:config.scanPage });
      const rateKey=createHmac('sha256',config.analyticsSecret).update(request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').digest('hex');
      if (!await store.rateLimit(`ip:${rateKey}`,600)) throw new APIError(429,'Too many requests. Please try again in a minute.');
      const scan=/^\/(api\/resolve|r)\/([A-Za-z\d_-]{12})$/.exec(path);
      if (scan && ['GET','HEAD'].includes(request.method)) {
        const code=await store.getCodeBySlug(scan[2]);
        if (!code || code.status==='archived') throw new APIError(404,'This code is no longer available. Contact the person who shared it.');
        if (code.status!=='active') throw new APIError(410,'The owner has paused this code. Please check with them for the latest link.');
        if (request.method==='GET') { try { await store.recordScan(code,scanMeta(request,config.analyticsSecret,code.id,scan[1]==='api/resolve')); } catch { console.error('Scan analytics write failed; destination preserved.'); } }
        if (scan[1]==='r') return new Response(null,{status:302,headers:{...headers,Location:code.destination!}});
        return request.method==='HEAD'?new Response(null,{headers}):json({destination:code.destination});
      }
      if (path.startsWith('/api/resolve/') || path.startsWith('/r/')) throw new APIError(404,'This QR link is incomplete.');
      const identity:GoogleIdentity=await verify(request.headers.get('authorization'));
      await store.linkIdentity(identity);
      const user={id:identity.id,email:identity.email,name:identity.name};
      if (!await store.rateLimit(`user:${user.id}`,240)) throw new APIError(429,'Too many requests. Please try again in a minute.');
      if (path==='/api/me' && request.method==='GET') return json({account:user});
      const owned=async (codeId:string) => { const code=validId(codeId)?await store.getCode(codeId,user.id):null; if (!code) throw new APIError(404,'This code could not be found in your account.'); return code; };
      const body=async () => {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new APIError(415,'Send JSON content.');
        if (Number(request.headers.get('content-length') || 0)>420_000) throw new APIError(413,'This request is too large.');
        const reader=request.body?.getReader(); if (!reader) throw new APIError(400,'Send JSON content.');
        const parts:Uint8Array[]=[]; let size=0;
        for (;;) { const {value,done}=await reader.read(); if (done) break; size+=value.length; if (size>420_000) { await reader.cancel(); throw new APIError(413,'This request is too large.'); } parts.push(value); }
        const bytes=new Uint8Array(size); let offset=0; for (const part of parts) { bytes.set(part,offset); offset+=part.length; }
        try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new APIError(400,'Send valid JSON content.'); }
      };
      const checkedDraft=(value:unknown) => {
        const parsed=parseDraft(value,new URL(config.apiUrl).origin);
        if (parsed.destination && new URL(parsed.destination).origin===new URL(config.scanPage).origin) throw new APIError(400,'Choose a destination outside this scan service.');
        if (parsed.draft.design.logo) parsed.draft.design.logo=normalizeEdgeLogo(parsed.draft.design.logo).image;
        return parsed;
      };
      if (path==='/api/codes' && request.method==='GET') return json({codes:(await store.listCodes(user.id)).map(c=>store.view(c))});
      if (path==='/api/codes' && request.method==='POST') {
        if (!await store.rateLimit(`save:${user.id}`,30)) throw new APIError(429,'Please wait a minute before saving more codes.');
        const key=request.headers.get('idempotency-key') || '';
        if (!/^[a-z\d-]{16,80}$/i.test(key)) throw new APIError(400,'A unique save request is required.');
        const existing=await store.getCodeByRequest(user.id,key); if (existing) return json({code:store.view(existing)});
        const {draft,payload,destination}=checkedDraft(await body());
        if (await store.countCodes(user.id)>=500) throw new APIError(409,'Your account has reached its 500-code limit.');
        const codeId=id(),slug=draft.kind==='dynamic'?randomBytes(9).toString('base64url'):null,now=new Date();
        const scanUrl=slug?`${config.scanPage}#r/${slug}`:null;
        const code:CodeDoc={...draft,_id:codeId,id:codeId,ownerId:user.id,requestKey:key,slug,scanUrl,destination,payload:scanUrl||payload,status:'active',createdAt:now,updatedAt:now,lastScanAt:null,totalScans:0,revision:1};
        try { await store.insertCode(code); } catch(error) { const concurrent=await store.getCodeByRequest(user.id,key); if (concurrent) return json({code:store.view(concurrent)}); throw error; }
        return json({code:store.view(code)},201);
      }
      const codePath=/^\/api\/codes\/([^/]+)(\/analytics)?$/.exec(path);
      if (codePath) {
        const code=await owned(codePath[1]);
        if (codePath[2] && request.method==='GET') {
          if (code.kind!=='dynamic') throw new APIError(400,'Scan analytics are available for dynamic codes only.');
          const days=Number(url.searchParams.get('days') || 30);
          if (![7,30,90].includes(days)) throw new APIError(400,'Choose 7, 30, or 90 days.');
          return json({analytics:await store.analytics(code.id,days),code:store.view(code)});
        }
        if (!codePath[2] && request.method==='PATCH') {
          const parsed=patchSchema.safeParse(await body());
          if (!parsed.success || (parsed.data.draft===undefined && !parsed.data.status)) throw new APIError(400,'Choose a change to save.');
          const patch:CodePatch={updatedAt:new Date()};
          if (parsed.data.draft!==undefined) { const {draft,payload,destination}=checkedDraft(parsed.data.draft); if (draft.kind!==code.kind) throw new APIError(400,'A saved code cannot change between static and dynamic.'); Object.assign(patch,draft,{destination,payload:code.scanUrl||payload}); }
          if (parsed.data.status) patch.status=parsed.data.status;
          const updated=await store.updateCode(code.id,user.id,parsed.data.revision,patch);
          if (!updated) throw new APIError(409,'This code changed in another tab. Reopen it from My QR Codes before saving.');
          return json({code:store.view(updated)});
        }
      }
      if (path==='/api/logos' && request.method==='GET') return json({logos:(await store.listLogos(user.id)).map(summary)});
      const logoPath=/^\/api\/logos\/([^/]+)$/.exec(path);
      if (logoPath && request.method==='GET') { const logo=validId(logoPath[1])?await store.getLogo(logoPath[1],user.id):null; if (!logo) throw new APIError(404,'This logo could not be found in your account.'); return json({logo:{...summary(logo),image:logo.image}}); }
      if (path==='/api/logos' && request.method==='POST') {
        if (!await store.rateLimit(`logo:${user.id}`,20)) throw new APIError(429,'Please wait a minute before uploading more logos.');
        const parsed=logoSchema.safeParse(await body()); if (!parsed.success) throw new APIError(400,'Choose a valid logo and a name shorter than 81 characters.');
        const normalized=normalizeEdgeLogo(parsed.data.image), digest=createHash('sha256').update(normalized.buffer).digest('hex');
        const existing=await store.getLogoByDigest(user.id,digest); if (existing) return json({logo:summary(existing),duplicate:true});
        if (await store.countLogos(user.id)>=100) throw new APIError(409,'Your logo library has reached its 100-logo limit. This logo can still be used in your current QR.');
        const logo:LogoDoc={_id:id(),ownerId:user.id,name:parsed.data.name,digest,image:normalized.image,thumbnail:normalized.thumbnail,createdAt:new Date()};
        try { await store.insertLogo(logo); } catch(error) { const concurrent=await store.getLogoByDigest(user.id,digest); if (concurrent) return json({logo:summary(concurrent),duplicate:true}); throw error; }
        return json({logo:summary(logo),duplicate:false},201);
      }
      throw new APIError(404,'This API endpoint was not found.');
    } catch(error) {
      const status=error instanceof APIError?error.statusCode:503;
      if (status>=500) console.error('QR service request failed',{type:(error as Error).name});
      return json({error:status>=500?'The account service is temporarily unavailable. Please try again.':(error as Error).message},status);
    }
  };
}
