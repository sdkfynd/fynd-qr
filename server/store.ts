import { MongoClient, type Db, type Collection } from 'mongodb';
import { randomBytes } from 'node:crypto';
import type { Analytics } from '../src/models.ts';
import { codeView, type QRStore, type CodeDoc, type LogoDoc, type EventDoc, type SessionDoc, type ChallengeDoc, type CodePatch, type CredentialDoc } from './repository.ts';
export type { CodeDoc, LogoDoc } from './repository.ts';

export class Store implements QRStore {
  credentials: Collection<CredentialDoc>;
  codes: Collection<CodeDoc>;
  logos: Collection<LogoDoc>;
  events: Collection<EventDoc>;
  sessions: Collection<SessionDoc>;
  challenges: Collection<ChallengeDoc>;
  constructor(public db: Db) {
    this.credentials = db.collection<CredentialDoc>('password_accounts');
    this.logos = db.collection<LogoDoc>('logos');
    this.codes = db.collection<CodeDoc>('qr_codes'); this.events = db.collection<EventDoc>('scan_events');
    this.sessions = db.collection<SessionDoc>('sessions'); this.challenges = db.collection<ChallengeDoc>('login_challenges');
  }
  async initialize() {
    await Promise.all([
      this.credentials.createIndex({ email: 1 }, { unique: true }),
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
  getCredentialByEmail(email: string) { return this.credentials.findOne({ email }); }
  getCredentialById(id: string) { return this.credentials.findOne({ _id: id }); }
  async insertCredential(doc: CredentialDoc) { await this.credentials.insertOne(doc); }
  updateCredentialPassword(id: string, version: number, passwordHash: string, mustChangePassword: boolean) {
    return this.credentials.findOneAndUpdate({ _id: id, version, disabled: false }, { $set: { passwordHash, mustChangePassword, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() }, $inc: { version: 1 } }, { returnDocument: 'after' });
  }
  async disableCredential(id: string, disabled: boolean) { await this.credentials.updateOne({ _id: id }, { $set: { disabled, updatedAt: new Date() }, $inc: { version: 1 } }); }
  async recordLoginFailure(id: string, now = new Date()) {
    await this.credentials.updateOne({ _id: id, disabled: false, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, [
      { $set: { failedAttempts: { $cond: [{ $and: [{ $ne: ['$lockedUntil', null] }, { $lte: ['$lockedUntil', now] }] }, 1, { $add: ['$failedAttempts', 1] }] } } },
      { $set: { lockedUntil: { $cond: [{ $gte: ['$failedAttempts', 5] }, new Date(+now + 15 * 60_000), null] } } },
    ]);
  }
  confirmPasswordLogin(id: string, version: number, now = new Date()) {
    return this.credentials.findOneAndUpdate({ _id: id, version, disabled: false, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] }, { $set: { failedAttempts: 0, lockedUntil: null } }, { returnDocument: 'after' });
  }
  async hasPasswordAccounts() { return !!await this.credentials.findOne({ disabled: false }, { projection: { _id: 1 } }); }
  view = codeView;
  async health() { await this.db.command({ ping: 1 }); }
  getSession(hash: string, now = new Date()) { return this.sessions.findOne({ _id: hash, expiresAt: { $gt: now } }); }
  async saveSession(session: SessionDoc) { await this.sessions.insertOne(session); }
  async deleteSession(hash: string) { await this.sessions.deleteOne({ _id: hash }); }
  async saveChallenge(challenge: ChallengeDoc) { await this.challenges.insertOne(challenge); }
  async consumeChallenge(id: string, nonce: string, now = new Date()) { return !!await this.challenges.findOneAndDelete({ _id: id, nonce, expiresAt: { $gt: now } }); }
  listCodes(ownerId: string) { return this.codes.find({ ownerId }).sort({ updatedAt: -1 }).limit(501).toArray(); }
  getCode(id: string, ownerId: string) { return this.codes.findOne({ _id: id, ownerId }); }
  getCodeByRequest(ownerId: string, requestKey: string) { return this.codes.findOne({ ownerId, requestKey }); }
  getCodeBySlug(slug: string) { return this.codes.findOne({ slug, kind: 'dynamic' }, { maxTimeMS: 2500 }); }
  countCodes(ownerId: string) { return this.codes.countDocuments({ ownerId }); }
  async insertCode(code: CodeDoc) { await this.codes.insertOne(code); }
  updateCode(id: string, ownerId: string, revision: number, patch: CodePatch) { return this.codes.findOneAndUpdate({ _id: id, ownerId, revision }, { $set: patch, $inc: { revision: 1 } }, { returnDocument: 'after' }); }
  listLogos(ownerId: string) { return this.logos.find({ ownerId }).sort({ createdAt: -1 }).limit(100).toArray(); }
  getLogo(id: string, ownerId: string) { return this.logos.findOne({ _id: id, ownerId }); }
  getLogoByDigest(ownerId: string, digest: string) { return this.logos.findOne({ ownerId, digest }); }
  countLogos(ownerId: string) { return this.logos.countDocuments({ ownerId }); }
  async insertLogo(logo: LogoDoc) { await this.logos.insertOne(logo); }
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
