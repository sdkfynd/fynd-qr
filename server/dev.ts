import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readConfig } from './config.ts';
import { connectStore } from './store.ts';
import { buildApp } from './app.ts';

const webPort = Number(process.env.DEV_WEB_PORT || 4300);
const apiPort = Number(process.env.PORT || 4301);
await mkdir('.local-data/mongo', { recursive: true });
const secretFile = '.local-data/analytics-secret';
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const mongod = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', dbPath: resolve('.local-data/mongo'), storageEngine: 'wiredTiger' } });
const config = readConfig({ ...process.env, NODE_ENV: 'development', API_HOST: '127.0.0.1', PORT: String(apiPort), SCAN_BASE_URL: `http://localhost:${apiPort}`, APP_ORIGINS: `http://localhost:${webPort},http://127.0.0.1:${webPort}`, MONGODB_URI: mongod.getUri(), LOCAL_PREVIEW_AUTH: '1', SCAN_PAGE_URL: `http://localhost:${webPort}/`, ANALYTICS_SECRET: readFileSync(secretFile, 'utf8') });
const { client, store } = await connectStore(config.mongoUri, config.database);
const app = await buildApp(config, store);
await app.listen({ host: config.host, port: config.port });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { stdio: 'inherit', env: { ...process.env, QR_API_DEV_PORT: String(apiPort) } });
console.log(`Local full-stack preview: http://localhost:${webPort}. Test accounts are enabled on loopback only.`);
let closing = false;
async function close() { if (closing) return; closing = true; vite.kill(); await app.close(); await client.close(); await mongod.stop({ doCleanup: false }); process.exit(0); }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void close());
vite.on('exit', () => void close());
