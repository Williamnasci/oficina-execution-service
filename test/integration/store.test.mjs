import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoStore } from '../../src/infrastructure/mongo-store.mjs';

test('real database: concurrent updates, inbox deduplication, outbox commit and restart', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  let store = new MongoStore(process.env.TEST_DATABASE_URL); await store.init();
  const id = `integration-${randomUUID()}`;
  try {
    await store.transact(id, 'opening', 'opening', async () => ({ data: { count: 0 }, messages: [{ id: `${id}:out`, orderId: id }] }));
    await Promise.all(Array.from({ length: 10 }, (_, index) => store.transact(id, `increment-${index}`, 'increment', async data => ({ data: { count: data.count + 1 } }))));
    assert.equal((await store.get(id)).count, 10);
    await store.transact(id, 'increment-1', 'increment', async () => { throw new Error('Duplicate must not execute'); });
    await assert.rejects(store.transact(id, 'increment-1', 'different-content', async () => ({ data: {} })), /Idempotency/);
    await assert.rejects(store.transact(id, 'failed', 'failed', async () => { throw new Error('Abort local transaction'); }));
    assert.equal((await store.get(id)).count, 10);
    assert.ok((await store.pending()).some(item => item.id === `${id}:out`));
    await store.close(); store = new MongoStore(process.env.TEST_DATABASE_URL); await store.init();
    assert.equal((await store.get(id)).count, 10);
    await store.markSent(`${id}:out`); assert.ok(!(await store.pending()).some(item => item.id === `${id}:out`));
  } finally { await store.close(); }
});
