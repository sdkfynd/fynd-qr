import type { ContentType, Design } from './qr';

export interface QRDraft {
  kind: 'static' | 'dynamic';
  name: string;
  contentType: ContentType;
  fields: Record<string, string>;
  design: Design;
}
export interface QRRecord extends QRDraft {
  id: string;
  slug: string | null;
  scanUrl: string | null;
  destination: string | null;
  payload: string;
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
  lastScanAt: string | null;
  totalScans: number;
  revision: number;
}
export interface Account { id: string; name: string; email: string; localPreview?: boolean }
export interface Analytics {
  days: number;
  scans: number;
  visitors: number;
  automated: number;
  daily: { day: string; scans: number; visitors: number }[];
  devices: { label: string; count: number }[];
  browsers: { label: string; count: number }[];
  countries: { label: string; count: number }[];
  referrers: { label: string; count: number }[];
}

export interface LogoSummary { id: string; name: string; thumbnail: string; createdAt: string }
export interface SavedLogo extends LogoSummary { image: string }
