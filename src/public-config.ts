export function assertPublishableKey(key:string) {
  if (/^sb_publishable_[A-Za-z\d_-]{16,}$/.test(key)) return;
  try {
    const parts=key.split('.');
    const claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (parts.length===3 && claims.role==='anon') return;
  } catch { /* Invalid or privileged keys must never reach the static artifact. */ }
  throw new Error('Use a Supabase publishable key or legacy anon key, never a secret/service-role key.');
}
export function validatePublicConfig(url:string,key:string,api:string) {
  if (!!url!==!!key) throw new Error('Configure both the Supabase URL and publishable key.');
  if (!url) return;
  if (!/^https:\/\/[^/]+$/.test(url) || new URL(url).username || new URL(url).password) throw new Error('Use the HTTPS Supabase project URL.');
  assertPublishableKey(key);
  if (api!==`${url}/functions/v1/qr-api`) throw new Error('The QR API and Supabase Auth must use the same project.');
}
