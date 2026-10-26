import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { APIError } from './validation.ts';
import type { Account, LogoSummary } from '../src/models.ts';
import type { QRStore, LogoDoc } from './repository.ts';

export async function normalizeStoredLogo(image: string) {
  if (image.length > 330_000 || !/^data:image\/png;base64,[A-Za-z\d+/]+=*$/.test(image)) throw new APIError(400, 'Use a PNG logo prepared by the editor.');
  try {
    const input = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
    if (!input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Not PNG');
    const buffer = await sharp(input, { limitInputPixels: 240 * 240, failOn: 'warning' }).rotate().png().toBuffer();
    return { buffer, image: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch { throw new APIError(400, 'This logo could not be read. Upload a valid PNG, JPG or WebP through the editor.'); }
}
export function logoSummary(doc: LogoDoc): LogoSummary {
  return { id: doc._id, name: doc.name, thumbnail: doc.thumbnail, createdAt: doc.createdAt.toISOString() };
}
export function registerLogoRoutes(app: FastifyInstance, store: QRStore, account: (request: FastifyRequest) => Promise<Account>) {
  app.get('/api/logos', async request => {
    const user = await account(request);
    const logos = await store.listLogos(user.id);
    return { logos: logos.map(logoSummary) };
  });
  app.get('/api/logos/:id', async request => {
    const user = await account(request), { id } = request.params as { id: string };
    const logo = /^[a-f\d]{24}$/.test(id) && await store.getLogo(id, user.id);
    if (!logo) throw new APIError(404, 'This logo could not be found in your account.');
    return { logo: { ...logoSummary(logo), image: logo.image } };
  });
  app.post('/api/logos', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const user = await account(request);
    const parsed = z.object({ name: z.string().trim().min(1).max(80), image: z.string().max(330_000) }).strict().safeParse(request.body);
    if (!parsed.success) throw new APIError(400, 'Choose a valid logo and a name shorter than 81 characters.');
    const normalized = await normalizeStoredLogo(parsed.data.image);
    const digest = createHash('sha256').update(normalized.buffer).digest('hex');
    const existing = await store.getLogoByDigest(user.id, digest);
    if (existing) return { logo: logoSummary(existing), duplicate: true };
    if (await store.countLogos(user.id) >= 100) throw new APIError(409, 'Your logo library has reached its 100-logo limit. This logo can still be used in your current QR.');
    const thumbnail = await sharp(normalized.buffer).resize(96, 96, { fit: 'contain', background: '#ffffff00' }).png().toBuffer();
    const logo: LogoDoc = { _id: randomBytes(12).toString('hex'), ownerId: user.id, name: parsed.data.name, digest, image: normalized.image, thumbnail: `data:image/png;base64,${thumbnail.toString('base64')}`, createdAt: new Date() };
    try { await store.insertLogo(logo); } catch (error) {
      const concurrent = await store.getLogoByDigest(user.id, digest);
      if (concurrent) return { logo: logoSummary(concurrent), duplicate: true }; throw error;
    }
    return reply.code(201).send({ logo: logoSummary(logo), duplicate: false });
  });
}
