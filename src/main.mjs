import { readFile } from 'node:fs/promises';
import { MongoStore } from './infrastructure/mongo-store.mjs';
import { Broker } from './infrastructure/broker.mjs';
import { createHttp } from './infrastructure/http.mjs';
import { startWorkers } from './infrastructure/lifecycle.mjs';
import { ExecutionService, executionRoutes } from './service.mjs';

const store = new MongoStore(process.env.DATABASE_URL);
await store.init();

const service = new ExecutionService(store, { failQueue: process.env.APP_ENV === 'test' && process.env.ENABLE_TEST_FAULTS === 'true' });
const broker = new Broker({ url: process.env.AMQP_URL, service: 'execution', store, handle: event => service.consume(event), onDisconnect: () => process.exit(1) });
await broker.init();
const spec = JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8'));
const app = await createHttp({ service: 'execution', store, broker, routes: executionRoutes(service), spec, secret: process.env.JWT_SECRET, port: Number(process.env.PORT ?? 3000) });
const stop = startWorkers(broker, service);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true; stop(); await app.close(); await broker.close(); await store.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
