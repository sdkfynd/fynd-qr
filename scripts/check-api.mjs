import assert from 'node:assert/strict';
import { validatePublicConfig } from '../src/public-config.ts';

const url=process.env.QR_SUPABASE_URL || '',key=process.env.QR_SUPABASE_PUBLISHABLE_KEY || '',api=process.env.QR_API_URL || '';
assert.ok(url && key && api,'Set QR_SUPABASE_URL, QR_SUPABASE_PUBLISHABLE_KEY and QR_API_URL before publishing.');
validatePublicConfig(url,key,api);
const origin='https://sdkfynd.github.io';
const request=path=>fetch(api+path,{headers:{Origin:origin,apikey:key},signal:AbortSignal.timeout(15_000)});
const [health,configuration,anonymous,invalidScan,settings]=await Promise.all([
  request('/health'),request('/api/config'),request('/api/codes'),request('/api/resolve/invalid'),
  fetch(url+'/auth/v1/settings',{headers:{apikey:key},signal:AbortSignal.timeout(15_000)}),
]);
assert.ok(health.ok && (await health.json()).status==='ok','The QR database/API health check did not pass.');
assert.ok(configuration.ok,'The QR configuration endpoint is unavailable.');
assert.equal(configuration.headers.get('access-control-allow-origin'),origin,'Allow the GitHub Pages origin.');
const config=await configuration.json();
assert.equal(config.authProvider,'supabase');assert.equal(config.googleLogin,true);
assert.equal(config.localPreview,false,'Development authentication must never be published.');
assert.equal(config.scanPage,'https://sdkfynd.github.io/fynd-qr/','Preserve the published QR scan address.');
assert.equal(anonymous.status,401,'Anonymous users must not read saved codes.');
assert.equal(invalidScan.status,404,'Public scan resolution must reach the function without a login.');
assert.ok(settings.ok && (await settings.json()).external?.google===true,'Enable the Google provider in Supabase Auth before publishing.');
console.log('Supabase Auth/Google, private API, public scan routing, database health and CORS verified.');
