import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool, type PoolConfig } from 'pg';
import { codeView, type QRStore, type CodeDoc, type LogoDoc, type SessionDoc, type ChallengeDoc, type CodePatch, type ScanMeta } from './repository.ts';
import type { Analytics } from '../src/models.ts';

export interface SQLDatabase { query<T extends Record<string, any> = Record<string, any>>(sql: string, values?: any[]): Promise<{ rows: T[] }> }
const date = (value: string | Date) => value instanceof Date ? value : new Date(value);
function code(row: Record<string, any>): CodeDoc {
  return { _id: row.id, id: row.id, ownerId: row.owner_id, requestKey: row.request_key, kind: row.kind, name: row.name,
    contentType: row.content_type, fields: row.fields, design: row.design, slug: row.slug, scanUrl: row.scan_url,
    destination: row.destination, payload: row.payload, status: row.status, createdAt: date(row.created_at), updatedAt: date(row.updated_at),
    lastScanAt: row.last_scan_at ? date(row.last_scan_at) : null, totalScans: Number(row.total_scans), revision: row.revision };
}
function logo(row: Record<string, any>): LogoDoc {
  return { _id: row.id, ownerId: row.owner_id, name: row.name, digest: row.digest, image: row.image, thumbnail: row.thumbnail, createdAt: date(row.created_at) };
}
export class PostgresStore implements QRStore {
  constructor(private sql: SQLDatabase) {}
  view = codeView;
  async health() { await this.sql.query('select id from fynd_qr.qr_codes limit 1'); }
  async getSession(hash: string, now = new Date()): Promise<SessionDoc | null> {
    const { rows: [r] } = await this.sql.query('select * from fynd_qr.sessions where token_hash = $1 and expires_at > $2', [hash, now]);
    return r ? { _id: r.token_hash, account: r.account, expiresAt: date(r.expires_at) } : null;
  }
  async saveSession(s: SessionDoc) { await this.sql.query('insert into fynd_qr.sessions (token_hash, account, expires_at) values ($1, $2, $3)', [s._id, JSON.stringify(s.account), s.expiresAt]); }
  async deleteSession(hash: string) { await this.sql.query('delete from fynd_qr.sessions where token_hash = $1', [hash]); }
  async saveChallenge(c: ChallengeDoc) { await this.sql.query('insert into fynd_qr.login_challenges (id, nonce, expires_at) values ($1, $2, $3)', [c._id, c.nonce, c.expiresAt]); }
  async consumeChallenge(id: string, nonce: string, now = new Date()) {
    const { rows } = await this.sql.query('delete from fynd_qr.login_challenges where id = $1 and nonce = $2 and expires_at > $3 returning id', [id, nonce, now]);
    return rows.length === 1;
  }
  async listCodes(owner: string) { return (await this.sql.query('select * from fynd_qr.qr_codes where owner_id = $1 order by updated_at desc, id limit 501', [owner])).rows.map(code); }
  async getCode(id: string, owner: string) { const { rows: [r] } = await this.sql.query('select * from fynd_qr.qr_codes where id = $1 and owner_id = $2', [id, owner]); return r ? code(r) : null; }
  async getCodeByRequest(owner: string, key: string) { const { rows: [r] } = await this.sql.query('select * from fynd_qr.qr_codes where owner_id = $1 and request_key = $2', [owner, key]); return r ? code(r) : null; }
  async getCodeBySlug(slug: string) { const { rows: [r] } = await this.sql.query("select * from fynd_qr.qr_codes where slug = $1 and kind = 'dynamic'", [slug]); return r ? code(r) : null; }
  async countCodes(owner: string) { const { rows: [r] } = await this.sql.query('select count(*) as count from fynd_qr.qr_codes where owner_id = $1', [owner]); return Number(r.count); }
  async insertCode(c: CodeDoc) {
    await this.sql.query(`insert into fynd_qr.qr_codes
      (id, owner_id, request_key, kind, name, content_type, fields, design, slug, scan_url, destination, payload, status, created_at, updated_at, last_scan_at, total_scans, revision)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [c.id, c.ownerId, c.requestKey, c.kind, c.name, c.contentType, JSON.stringify(c.fields), JSON.stringify(c.design), c.slug, c.scanUrl, c.destination, c.payload, c.status, c.createdAt, c.updatedAt, c.lastScanAt, c.totalScans, c.revision]);
  }
  async updateCode(id: string, owner: string, revision: number, patch: CodePatch) {
    // Column names come exclusively from this fixed allowlist; values are parameters.
    const columns = { name: 'name', contentType: 'content_type', fields: 'fields', design: 'design', destination: 'destination', payload: 'payload', status: 'status', updatedAt: 'updated_at' } as const;
    const values: unknown[] = [id, owner, revision];
    const assignments: string[] = [];
    for (const key of Object.keys(columns) as (keyof typeof columns)[]) if (patch[key] !== undefined) {
      values.push(['fields', 'design'].includes(key) ? JSON.stringify(patch[key]) : patch[key]);
      assignments.push(`${columns[key]} = $${values.length}`);
    }
    const { rows: [r] } = await this.sql.query(`update fynd_qr.qr_codes set ${[...assignments, 'revision = revision + 1'].join(', ')} where id = $1 and owner_id = $2 and revision = $3 returning *`, values);
    return r ? code(r) : null;
  }
  async listLogos(owner: string) { return (await this.sql.query('select * from fynd_qr.logos where owner_id = $1 order by created_at desc, id limit 100', [owner])).rows.map(logo); }
  async getLogo(id: string, owner: string) { const { rows: [r] } = await this.sql.query('select * from fynd_qr.logos where id = $1 and owner_id = $2', [id, owner]); return r ? logo(r) : null; }
  async getLogoByDigest(owner: string, digest: string) { const { rows: [r] } = await this.sql.query('select * from fynd_qr.logos where owner_id = $1 and digest = $2', [owner, digest]); return r ? logo(r) : null; }
  async countLogos(owner: string) { const { rows: [r] } = await this.sql.query('select count(*) as count from fynd_qr.logos where owner_id = $1', [owner]); return Number(r.count); }
  async insertLogo(l: LogoDoc) { await this.sql.query('insert into fynd_qr.logos (id, owner_id, name, digest, image, thumbnail, created_at) values ($1,$2,$3,$4,$5,$6,$7)', [l._id, l.ownerId, l.name, l.digest, l.image, l.thumbnail, l.createdAt]); }
  async recordScan(c: CodeDoc, meta: ScanMeta, now = new Date()) {
    // One SQL statement commits the event and counter together, including under concurrency.
    await this.sql.query(`with recorded as (
      insert into fynd_qr.scan_events (id, code_id, at, expires_at, visitor, automated, device, browser, country, referrer)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning code_id, automated, at
    ) update fynd_qr.qr_codes q set total_scans = total_scans + 1, last_scan_at = greatest(q.last_scan_at, r.at)
      from recorded r where q.id = r.code_id and not r.automated`,
    [randomBytes(16).toString('hex'), c.id, now, new Date(+now + 90 * 86400_000), meta.visitor, meta.automated, meta.device, meta.browser, meta.country, meta.referrer]);
  }
  async analytics(codeId: string, days: number, now = new Date()): Promise<Analytics> {
    const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1); start.setUTCHours(0, 0, 0, 0);
    // Every result comes from one statement snapshot, including breakdowns and totals.
    const { rows: [r] } = await this.sql.query(`with events as materialized (
      select * from fynd_qr.scan_events where code_id = $1 and at >= $2 and at <= $3
    ), people as (select * from events where not automated), daily as (
      select to_char(at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as scans, count(distinct visitor)::int as visitors from people group by 1
    ), breakdown as (
      select key, label, count(*)::int as count from people cross join lateral
      (values ('devices', device), ('browsers', browser), ('countries', country), ('referrers', referrer)) as dimensions(key, label) group by key, label
    ), ranked as (select *, row_number() over (partition by key order by count desc, label) as rank from breakdown)
    select (select count(*)::int from people) as scans,
      (select count(*)::int from events where automated) as automated,
      (select count(distinct visitor)::int from people) as visitors,
      coalesce((select jsonb_agg(daily) from daily), '[]'::jsonb) as daily,
      coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'count',count) order by key, count desc, label) from ranked where rank <= 10), '[]'::jsonb) as breakdown`, [codeId, start, end]);
    const daily = Array.from({ length: days }, (_, i) => {
      const day = new Date(+start + i * 86400_000).toISOString().slice(0, 10);
      const row = r.daily.find((entry: { day: string }) => entry.day === day);
      return { day, scans: row?.scans || 0, visitors: row?.visitors || 0 };
    });
    const breakdown = (key: string) => r.breakdown.filter((b: { key: string }) => b.key === key).map(({ label, count }: { label: string; count: number }) => ({ label, count }));
    return { days, scans: r.scans, automated: r.automated, visitors: r.visitors, daily, devices: breakdown('devices'), browsers: breakdown('browsers'), countries: breakdown('countries'), referrers: breakdown('referrers') };
  }
  async cleanup(now = new Date()) {
    for (const table of ['sessions', 'login_challenges', 'scan_events']) await this.sql.query(`delete from fynd_qr.${table} where expires_at <= $1`, [now]);
  }
}
export function postgresConnectionOptions(uri: string, caFile = ''): PoolConfig {
  const url = new URL(uri);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be a PostgreSQL connection string.');
  // Reject URI overrides that could silently disable certificate verification.
  if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl') || key === 'uselibpqcompat')) throw new Error('Remove SSL options from DATABASE_URL; TLS verification is configured by the service.');
  return { connectionString: uri, ssl: { rejectUnauthorized: true, ...(caFile ? { ca: readFileSync(caFile, 'utf8') } : {}) },
    max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000, statement_timeout: 5000, query_timeout: 6000, application_name: 'fynd-qr' };
}
export async function connectPostgresStore(uri: string, caFile = '') {
  const pool = new Pool(postgresConnectionOptions(uri, caFile));
  pool.on('error', () => console.error('PostgreSQL idle connection failed.'));
  const store = new PostgresStore(pool);
  try {
    // Require the dedicated restricted role; never run the app as the shared project administrator.
    const { rows: [role] } = await pool.query('select current_user as name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user');
    if (role?.name !== 'fynd_qr_app' || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole) throw new Error('Use the restricted fynd_qr_app database role.');
    await store.health(); await store.cleanup();
  } catch (error) { await pool.end(); throw error; }
  let cleaning = false;
  const timer = setInterval(async () => {
    if (cleaning) return; cleaning = true;
    try { await store.cleanup(); } catch { console.error('PostgreSQL expiry cleanup failed.'); } finally { cleaning = false; }
  }, 3600_000); timer.unref();
  return { store, client: { close: async () => { clearInterval(timer); await pool.end(); } } };
}
