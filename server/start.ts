import { readConfig } from './config.ts';
import { connectStore } from './store.ts';
import { buildApp } from './app.ts';

const config = readConfig();
if (!config.mongoUri) throw new Error('Set MONGODB_URI or use pnpm dev:full for a local MongoDB.');
const { client, store } = await connectStore(config.mongoUri, config.database);
const app = await buildApp(config, store);
await app.listen({ host: config.host, port: config.port });
console.log(`Fynd QR account service listening on port ${config.port}.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => client.close()).then(() => process.exit(0)); });
