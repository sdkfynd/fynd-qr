import { Pool } from 'pg';
import { createEdgeApp, edgeConfig } from '../../../server/edge-app.ts';
import { SupabaseStore } from '../../../server/supabase-store.ts';
import { postgresConnectionOptions } from '../../../server/postgres-store.ts';

const config=edgeConfig(Deno.env.toObject());
const databaseUrl=Deno.env.get('QR_DATABASE_URL') || '';
// Use the restricted application's transaction-pooler URI, never the default
// SUPABASE_DB_URL/admin connection. pg uses unnamed queries (no prepare cache).
const parsed=new URL(databaseUrl);
if (!decodeURIComponent(parsed.username).startsWith('fynd_qr_app.') || parsed.port!=='6543' || !parsed.hostname.endsWith('.pooler.supabase.com') || parsed.pathname!=='/postgres') throw new Error('QR_DATABASE_URL must use fynd_qr_app and the Supabase transaction pooler on port 6543.');
const pool=new Pool({...postgresConnectionOptions(databaseUrl),max:1,idleTimeoutMillis:1000,
  ...(Deno.env.get('QR_DATABASE_CA') ? {ssl:{rejectUnauthorized:true,ca:Deno.env.get('QR_DATABASE_CA')}} : {})});
pool.on('error',()=>console.error('QR database idle connection failed.'));
const store=new SupabaseStore(pool);
let ready:Promise<void> | undefined;
async function verifyRole() {
  const {rows:[role]}=await pool.query('select current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user');
  if (role?.name!=='fynd_qr_app' || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) throw new Error('Use the restricted fynd_qr_app database role.');
  await store.health();
}
const handle=createEdgeApp(config,store);
Deno.serve(async request => {
  try { await (ready ||= verifyRole().catch(error=>{ready=undefined;throw error;})); }
  catch { return Response.json({error:'The account service is temporarily unavailable. Please try again.'},{status:503,headers:{'Cache-Control':'no-store'}}); }
  return handle(request);
});
