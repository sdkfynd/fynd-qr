import { defineConfig, loadEnv } from 'vite';
import { validatePublicConfig } from './src/public-config';

// GitHub Pages supplies its current base path; custom domains use '/'.
const base = process.env.QR_BASE_PATH || '/';
if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(base)) throw new Error('QR_BASE_PATH must be a slash-delimited path, such as /fynd-qr/.');

export default defineConfig(({mode}) => {
  const env={...loadEnv(mode,process.cwd(),'VITE_'),...process.env};
  validatePublicConfig((env.VITE_SUPABASE_URL || '').replace(/\/$/,''),env.VITE_SUPABASE_PUBLISHABLE_KEY || '',(env.VITE_API_URL || '').replace(/\/$/,''));
  return { base, server: { proxy: { '/api': `http://127.0.0.1:${process.env.QR_API_DEV_PORT || '4301'}` } } };
});
