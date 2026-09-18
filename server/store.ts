import { MongoClient, type Db, type Collection } from 'mongodb';
import { randomBytes } from 'node:crypto';
import type { QRRecord, Analytics, Account } from '../src/models.ts';

export interface CodeDoc extends Omit<QRRecord, 'createdAt' | 'updatedAt' | 'lastScanAt'> {
  _id: string; ownerId: string; createdAt: Date; updatedAt: Date; lastScanAt: Date | null; requestKey: string;
}
export interface LogoDoc { _id: string; ownerId: string; name: string; digest: string; image: string; thumbnail: string; createdAt: Date }
interface EventDoc {
  _id: string; codeId: string; at: Date; expiresAt: Date; visitor: string; automated: boolean;
  device: string; browser: string; country: string; referrer: string;
}
export interface SessionDoc { _id: string; account: Account; expiresAt: Date }
export interface ChallengeDoc { _id: string; nonce: string; expiresAt: Date }
export class Store {
  codes: Collection<CodeDoc>;
  logos: Collection<LogoDoc>;
  events: Collection<EventDoc>;
  sessions: Collection<SessionDoc>;
  challenges: Collection<ChallengeDoc>;
  constructor(public db: Db) {
    this.logos = db.collection<LogoDoc>('logos');
    this.codes = db.collection<CodeDoc>('qr_codes'); this.events = db.collection<EventDoc>('scan_events');
    this.sessions = db.collection<SessionDoc>('sessions'); this.challenges = db.collection<ChallengeDoc>('login_challenges');
  }
  async initialize() {
    await Promise.all([
      this.logos.createIndex({ ownerId: 1, digest: 1 }, { unique: true }),
      this.logos.createIndex({ ownerId: 1, createdAt: -1 }),
      this.codes.createIndex({ ownerId: 1, updatedAt: -1 }),
      this.codes.createIndex({ ownerId: 1, requestKey: 1 }, { unique: true }),
      this.codes.createIndex({ slug: 1 }, { unique: true, partialFilterExpression: { kind: 'dynamic' } }),
      this.events.createIndex({ codeId: 1, at: -1 }), this.events.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
  }
  view(code: CodeDoc): QRRecord {
    const { _id, ownerId, requestKey, ...record } = code;
    return { ...record, createdAt: code.createdAt.toISOString(), updatedAt: code.updatedAt.toISOString(), lastScanAt: code.lastScanAt?.toISOString() || null };
  }
  async recordScan(code: CodeDoc, meta: Omit<EventDoc, '_id' | 'codeId' | 'at' | 'expiresAt'>, now = new Date()) {
    await this.events.insertOne({ _id: randomBytes(16).toString('hex'), codeId: code.id, at: now, expiresAt: new Date(+now + 90 * 86400_000), ...meta });
    if (!meta.automated) await this.codes.updateOne({ _id: code.id }, { $inc: { totalScans: 1 }, $max: { lastScanAt: now } });
  }
  async analytics(codeId: string, days: number, now = new Date()): Promise<Analytics> {
    const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1); start.setUTCHours(0, 0, 0, 0);
    const breakdown = (key: string) => [{ $match: { automated: false } }, { $group: { _id: `$${key}`, count: { $sum: 1 } } }, { $sort: { count: -1 as const } }, { $limit: 10 }];
    const [result] = await this.events.aggregate([
      { $match: { codeId, at: { $gte: start, $lte: end } } },
      { $facet: {
        totals: [{ $group: { _id: '$automated', count: { $sum: 1 } } }],
        visitors: [{ $match: { automated: false } }, { $group: { _id: '$visitor' } }, { $count: 'count' }],
        daily: [{ $match: { automated: false } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: 'UTC' } }, scans: { $sum: 1 }, visitors: { $addToSet: '$visitor' } } }, { $project: { scans: 1, visitors: { $size: '$visitors' } } }],
        devices: breakdown('device'), browsers: breakdown('browser'), countries: breakdown('country'), referrers: breakdown('referrer'),
      } },
    ], { maxTimeMS: 5000 }).toArray();
    const daily = Array.from({ length: days }, (_, i) => { const day = new Date(+start + i * 86400_000).toISOString().slice(0, 10); const row = result.daily.find((r: any) => r._id === day); return { day, scans: row?.scans || 0, visitors: row?.visitors || 0 }; });
    const map = (key: string) => result[key].map((r: any) => ({ label: r._id, count: r.count }));
    return { days, scans: result.totals.find((r: any) => !r._id)?.count || 0, automated: result.totals.find((r: any) => r._id)?.count || 0, visitors: result.visitors[0]?.count || 0, daily, devices: map('devices'), browsers: map('browsers'), countries: map('countries'), referrers: map('referrers') };
  }
}
export async function connectStore(uri: string, database: string) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 5000, maxPoolSize: 20 });
  await client.connect(); const store = new Store(client.db(database)); await store.initialize();
  return { client, store };
}
