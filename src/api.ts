import type { Account } from './models';
import { supabase, supabaseKey } from './supabase';

const configured = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
if (configured && (!/^https?:$/.test(new URL(configured).protocol) || new URL(configured).search || new URL(configured).hash || new URL(configured).username || new URL(configured).password)) throw new Error('Use a valid account service URL.');
let token = '';
try { if (!supabase) token = sessionStorage.getItem('fynd-qr-session') || ''; } catch { /* Storage may be disabled. */ }
export let account: Account | null = null;
export let sessionError = '';
const listeners = new Set<() => void>();
const change = () => listeners.forEach(listener => listener());
export function onAccountChange(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); }
export class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, options: { method?: string; body?: unknown; key?: string; referrerHost?: string; anonymous?: boolean } = {}): Promise<T> {
  if (supabase && !options.anonymous) {
    const {data,error}=await supabase.auth.getSession();
    if (error) throw new RequestError(401, 'Please sign in again. Your design is still here.');
    token=data.session?.access_token || '';
  }
  const requestToken = token;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${configured}/api${path}`, {
      method: options.method || 'GET', signal: controller.signal, cache: 'no-store', credentials: 'omit',
      headers: { ...(supabaseKey ? { apikey: supabaseKey } : {}), ...(token && !options.anonymous ? { Authorization: `Bearer ${token}` } : {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...(options.referrerHost ? { 'X-QR-Referrer': options.referrerHost } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401 && requestToken && token === requestToken) clearSession();
    if (!response.ok || !data) throw new RequestError(response.status, data?.error || 'The account service is unavailable right now. Please try again shortly.');
    return data;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(0, 'Could not reach the account service. Check your connection and try again. Your design is still here.');
  } finally { clearTimeout(timer); }
}
export function acceptSession(session: { token: string; account: Account }) {
  token = session.token; account = session.account;
  try { sessionStorage.setItem('fynd-qr-session', token); } catch { /* Session still works until refresh. */ }
  change();
}
export function clearSession() {
  token = ''; account = null; sessionError = '';
  try { sessionStorage.removeItem('fynd-qr-session'); } catch { /* Nothing to clear. */ }
  change();
}
export async function restoreSession() {
  if (supabase) {
    const {data,error}=await supabase.auth.getSession();
    if (error) { sessionError='Google sign-in could not finish. Please try again.'; change(); return; }
    token=data.session?.access_token || '';
    const page=new URL(location.href);
    if (page.searchParams.has('code')) { page.searchParams.delete('code'); history.replaceState(null,'',page); }
  }
  if (!token) return;
  const restoringToken = token;
  try { const restored = (await api<{ account: Account }>('/me')).account; if (token === restoringToken) { account = restored; sessionError=''; change(); } }
  catch (error) {
    // In particular, display legacy ownership checks instead of silently showing
    // a fresh empty workspace after the OAuth redirect.
    sessionError=(error as Error).message; change();
  }
}
export async function logout() {
  if (supabase) { const {error}=await supabase.auth.signOut({scope:'local'}); if (error) throw new RequestError(0,'Could not sign out. Please try again.'); }
  else if (token) await api('/auth/logout', { method: 'POST' });
  clearSession();
}
if (supabase) supabase.auth.onAuthStateChange((event,session) => {
  token=session?.access_token || '';
  if (event==='SIGNED_OUT') clearSession();
  else if (event==='SIGNED_IN' || event==='TOKEN_REFRESHED') setTimeout(() => { void restoreSession(); },0);
});

type GoogleResponse = { credential: string };
declare global {
  interface Window { google?: { accounts: { id: { initialize(options: { client_id: string; nonce: string; callback: (response: GoogleResponse) => void; auto_select: boolean }): void; renderButton(container: HTMLElement, options: Record<string, unknown>): void; disableAutoSelect(): void } } } }
}
let googleScript: Promise<void> | undefined;
export function loadGoogle() {
  return googleScript ||= new Promise<void>((resolve, reject) => {
    if (window.google) { resolve(); return; }
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timeout = setTimeout(() => { script.remove(); googleScript = undefined; reject(new Error('Google sign-in could not load. Please retry.')); }, 12_000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); googleScript = undefined; reject(new Error('Google sign-in could not load. Check your connection and retry.')); };
    document.head.append(script);
  });
}
