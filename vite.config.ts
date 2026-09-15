import { defineConfig } from 'vite';

// GitHub Pages supplies its current base path; custom domains use '/'.
const base = process.env.QR_BASE_PATH || '/';
if (!/^\/(?:[a-zA-Z0-9_.-]+\/)*$/.test(base)) throw new Error('QR_BASE_PATH must be a slash-delimited path, such as /fynd-qr/.');

export default defineConfig({ base });
