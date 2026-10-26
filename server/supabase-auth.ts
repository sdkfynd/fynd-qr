import { APIError } from './validation.ts';
import type { GoogleIdentity } from './supabase-store.ts';

export interface SupabaseAuthConfig { supabaseUrl: string; publishableKey: string }
export function googleIdentity(user: unknown): GoogleIdentity {
  const data = user as Record<string, any> | null;
  const identity = Array.isArray(data?.identities) && data.identities.find((i: any) => i.provider === 'google' && i.identity_data?.email_verified === true);
  const subject = identity?.identity_data?.sub;
  const email = typeof data?.email === 'string' ? data.email.toLowerCase() : '';
  // Identity data comes from the Auth server, never from browser-editable metadata.
  if (!data || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(data.id || '') ||
      !data.email_confirmed_at || !identity || typeof subject !== 'string' || !/^[a-z\d_-]{1,255}$/i.test(subject) ||
      identity.identity_data.email?.toLowerCase() !== email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || data.is_anonymous) {
    throw new APIError(401, 'Sign in with a verified Google account to continue.');
  }
  const domain=email.split('@')[1];
  const hostedDomain=identity.identity_data.custom_claims?.hd ?? identity.identity_data.hd;
  return { id: data.id, email, googleSubject: subject,
    authoritativeEmail: domain==='gmail.com' || (typeof hostedDomain==='string' && hostedDomain.toLowerCase()===domain),
    name: String(identity.identity_data.full_name || identity.identity_data.name || email.split('@')[0]).slice(0, 80) };
}
export function supabaseVerifier(config: SupabaseAuthConfig, transport: typeof fetch = fetch) {
  return async (authorization: string | null): Promise<GoogleIdentity> => {
    if (!authorization || !/^Bearer [A-Za-z\d_-]+\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+$/.test(authorization)) throw new APIError(401, 'Please sign in with Google to continue. Your design is still here.');
    let response: Response;
    try { response = await transport(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: config.publishableKey }, signal: AbortSignal.timeout(8000),
    }); } catch { throw new APIError(503, 'Sign-in verification is temporarily unavailable. Please try again.'); }
    if ([401, 403].includes(response.status)) throw new APIError(401, 'Your session has ended. Please sign in again.');
    if (!response.ok) throw new APIError(503, 'Sign-in verification is temporarily unavailable. Please try again.');
    return googleIdentity(await response.json());
  };
}
