import { createClient } from '@supabase/supabase-js';
import { validatePublicConfig } from './public-config';

const url=(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/,'');
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
validatePublicConfig(url,key,(import.meta.env.VITE_API_URL || '').replace(/\/$/,''));
export const supabase = url ? createClient(url,key,{auth:{
  flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:true,
  storageKey:`fynd-qr-auth-${new URL(url).hostname.split('.')[0]}`,
}}) : null;
export const supabaseKey=key;
export async function signInGoogle() {
  if (!supabase) throw new Error('Google sign-in is not configured yet.');
  const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{
    redirectTo:new URL(import.meta.env.BASE_URL,location.origin).href,
    scopes:'openid email profile', queryParams:{prompt:'select_account'},
  }});
  if (error) throw new Error('Google sign-in could not start. Please try again.');
}
