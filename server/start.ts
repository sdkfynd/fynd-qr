import { readConfig } from './config.ts';
import { connectStore } from './store.ts';
import { connectPostgresStore } from './postgres-store.ts';
import { buildApp } from './app.ts';

const config = readConfig();
if (!config.postgresUri && !config.mongoUri) throw new Error('Set DATABASE_URL for Supabase, MONGODB_URI for MongoDB, or use pnpm dev:full locally.');
const { client, store } = config.postgresUri ? await connectPostgresStore(config.postgresUri, config.postgresCaFile) : await connectStore(config.mongoUri, config.database);
const app = await buildApp(config, store);
await app.listen({ host: config.host, port: config.port });
console.log(`Fynd QR account service listening on port ${config.port}.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => client.close()).then(() => process.exit(0)); });
