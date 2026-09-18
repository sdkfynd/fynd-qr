import type { QRRecord, Analytics, Account } from '../src/models.ts';

export interface CodeDoc extends Omit<QRRecord, 'createdAt' | 'updatedAt' | 'lastScanAt'> {
  _id: string; ownerId: string; createdAt: Date; updatedAt: Date; lastScanAt: Date | null; requestKey: string;
}
export interface LogoDoc { _id: string; ownerId: string; name: string; digest: string; image: string; thumbnail: string; createdAt: Date }
export interface EventDoc {
  _id: string; codeId: string; at: Date; expiresAt: Date; visitor: string; automated: boolean;
  device: string; browser: string; country: string; referrer: string;
}
export interface SessionDoc { _id: string; account: Account; expiresAt: Date }
export interface ChallengeDoc { _id: string; nonce: string; expiresAt: Date }
export type ScanMeta = Omit<EventDoc, '_id' | 'codeId' | 'at' | 'expiresAt'>;
export type CodePatch = Partial<Pick<CodeDoc, 'name' | 'contentType' | 'fields' | 'design' | 'destination' | 'payload' | 'status' | 'updatedAt'>>;
export function codeView(code: CodeDoc): QRRecord {
  const { _id, ownerId, requestKey, ...record } = code;
  return { ...record, createdAt: code.createdAt.toISOString(), updatedAt: code.updatedAt.toISOString(), lastScanAt: code.lastScanAt?.toISOString() || null };
}
export interface QRStore {
  health(): Promise<void>;
  view(code: CodeDoc): QRRecord;
  getSession(hash: string, now?: Date): Promise<SessionDoc | null>;
  saveSession(session: SessionDoc): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  saveChallenge(challenge: ChallengeDoc): Promise<void>;
  consumeChallenge(id: string, nonce: string, now?: Date): Promise<boolean>;
  listCodes(owner: string): Promise<CodeDoc[]>;
  getCode(id: string, owner: string): Promise<CodeDoc | null>;
  getCodeByRequest(owner: string, key: string): Promise<CodeDoc | null>;
  getCodeBySlug(slug: string): Promise<CodeDoc | null>;
  countCodes(owner: string): Promise<number>;
  insertCode(code: CodeDoc): Promise<void>;
  updateCode(id: string, owner: string, revision: number, patch: CodePatch): Promise<CodeDoc | null>;
  listLogos(owner: string): Promise<LogoDoc[]>;
  getLogo(id: string, owner: string): Promise<LogoDoc | null>;
  getLogoByDigest(owner: string, digest: string): Promise<LogoDoc | null>;
  countLogos(owner: string): Promise<number>;
  insertLogo(logo: LogoDoc): Promise<void>;
  recordScan(code: CodeDoc, meta: ScanMeta, now?: Date): Promise<void>;
  analytics(codeId: string, days: number, now?: Date): Promise<Analytics>;
}
