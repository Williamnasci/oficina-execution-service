import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoStore } from '../src/infrastructure/mongo-store.mjs';

function fixture() {
  let document = null; let conflict = 0; let insertError; const calls = [];
  const collection = {
    createIndex: async () => {},
    findOne: async () => structuredClone(document),
    insertOne: async value => { if (insertError) { const error = insertError; insertError = null; throw error; } document = structuredClone(value); },
    updateOne: async (filter, update) => {
      if (filter['outbox.id']) { document.outbox.find(item => item.id === filter['outbox.id']).sent = true; return {}; }
      if (conflict) { conflict--; return { modifiedCount: 0 }; }
      document.data = structuredClone(update.$set.data); document.version++; document.inbox.push(update.$push.inbox); document.outbox.push(...update.$push.outbox.$each);
      return { modifiedCount: 1 };
    },
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => document ? [document] : [] }) }) }),
    aggregate: () => ({ toArray: async () => document.outbox.filter(item => !item.sent).map(item => ({ id: item.id, envelope: item.envelope })) }),
  };
  const db = { collection: () => collection, command: async () => calls.push('ping') };
  const client = { connect: async () => {}, db: () => db, close: async () => calls.push('close') };
  return { store: new MongoStore('', client), calls, conflict: value => { conflict = value; }, insertError: value => { insertError = value; } };
}
test('Mongo atomically inserts/updates state, inbox and outbox and retries version conflict', async () => {
  const f = fixture(); await f.store.init(); await f.store.ping(); assert.equal(await f.store.get('o'), null);
  await f.store.transact('o', 'a', 'hash', async () => ({ data: { status: 'OPEN' }, messages: [{ id: 'out' }] }));
  assert.equal((await f.store.get('o')).status, 'OPEN'); assert.equal((await f.store.list()).length, 1);
  assert.equal((await f.store.pending()).length, 1); await f.store.markSent('out'); assert.equal((await f.store.pending()).length, 0);
  const duplicate = await f.store.transact('o', 'a', 'hash', async () => { throw new Error('Should not run'); }); assert.equal(duplicate.duplicate, true);
  await assert.rejects(f.store.transact('o', 'a', 'other', () => {}), /Idempotency/);
  f.conflict(1); await f.store.transact('o', 'b', 'hash', async data => ({ data: { ...data, status: 'DONE' } }));
  assert.equal((await f.store.get('o')).status, 'DONE');
  f.conflict(20); await assert.rejects(f.store.transact('o', 'c', 'hash', async data => ({ data })), /contention/);
  await f.store.close(); assert.deepEqual(f.calls, ['ping', 'close']);
});
test('Mongo duplicate insertion retries but real DB errors propagate', async () => {
  const f = fixture(); await f.store.init();
  f.insertError({ code: 11000 }); await f.store.transact('o', 'a', 'hash', async () => ({ data: {} }));
  const other = fixture(); await other.store.init(); other.insertError(new Error('DB failure'));
  await assert.rejects(other.store.transact('o', 'a', 'hash', async () => ({ data: {} })), /DB failure/);
  await assert.rejects(other.store.transact('o', 'a', 'hash', async () => ({})), /Decision/);
  const defaultClient = new MongoStore('mongodb://localhost:27017/test'); await defaultClient.close();
});
