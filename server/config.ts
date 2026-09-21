export interface Config {
  production: boolean;
  host: string;
  port: number;
  mongoUri: string;
  postgresUri: string;
  postgresCaFile: string;
  database: string;
  origins: string[];
  scanBase: string;
  scanPage: string;
  allowedDomains: string[];
  googleClientId: string;
  passwordLogin: boolean;
  analyticsSecret: string;
  localPreview: boolean;
  trustProxy: string[] | false;
  countryHeader: string;
}
export function readConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const host = env.API_HOST || '127.0.0.1';
  const origins = (env.APP_ORIGINS || 'http://localhost:4173,http://127.0.0.1:4173').split(',').map(s => s.trim());
  const scanBase = (env.SCAN_BASE_URL || 'http://localhost:4174').replace(/\/$/, '');
  const scanPage = env.SCAN_PAGE_URL || '';
  if (scanPage && (!['https:', 'http:'].includes(new URL(scanPage).protocol) || new URL(scanPage).hash || new URL(scanPage).search || new URL(scanPage).username || new URL(scanPage).password || !scanPage.endsWith('/'))) throw new Error('SCAN_PAGE_URL must be a page URL ending in / without query, fragment or credentials.');
  const localPreview = env.LOCAL_PREVIEW_AUTH === '1';
  const loopback = (url: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error('APP_ORIGINS must contain exact origins.');
  if (!['https:', 'http:'].includes(new URL(scanBase).protocol) || new URL(scanBase).username || new URL(scanBase).password || new URL(scanBase).pathname !== '/' || new URL(scanBase).search || new URL(scanBase).hash) throw new Error('SCAN_BASE_URL must be a stable origin.');
  if (localPreview && (production || host !== '127.0.0.1' || !origins.every(loopback) || !loopback(scanBase) || (scanPage && !loopback(scanPage)))) throw new Error('Local preview authentication requires loopback-only development.');
  if (env.MONGODB_URI && env.DATABASE_URL) throw new Error('Set either DATABASE_URL or MONGODB_URI, not both.');
  if (production && ((!env.GOOGLE_CLIENT_ID && env.PASSWORD_LOGIN !== '1') || (!env.MONGODB_URI && !env.DATABASE_URL) || (env.ANALYTICS_SECRET?.length || 0) < 32 || !env.APP_ORIGINS || !env.SCAN_BASE_URL)) throw new Error('Production requires an enabled sign-in method, a database, analytics secret, app origins, and scan origin configuration.');
  if (production && [...origins, scanBase, ...(scanPage ? [scanPage] : [])].some(url => new URL(url).protocol !== 'https:')) throw new Error('Production origins must use HTTPS.');
  if (!Number.isInteger(Number(env.PORT || 4174)) || Number(env.PORT || 4174) < 1 || Number(env.PORT || 4174) > 65535) throw new Error('Invalid API port.');
  return {
    production, host, port: Number(env.PORT || 4174), mongoUri: env.MONGODB_URI || '', postgresUri: env.DATABASE_URL || '', postgresCaFile: env.DATABASE_CA_FILE || '', database: env.MONGODB_DATABASE || 'fynd_qr', origins, scanBase, scanPage, allowedDomains: (env.ALLOWED_DESTINATION_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    googleClientId: env.GOOGLE_CLIENT_ID || '', passwordLogin: env.PASSWORD_LOGIN === '1', analyticsSecret: env.ANALYTICS_SECRET || 'local-development-only-analytics-secret', localPreview,
    trustProxy: env.TRUSTED_PROXY_CIDRS ? env.TRUSTED_PROXY_CIDRS.split(',').map(s => s.trim()) : false,
    countryHeader: env.TRUSTED_COUNTRY_HEADER?.toLowerCase() || '',
  };
}
