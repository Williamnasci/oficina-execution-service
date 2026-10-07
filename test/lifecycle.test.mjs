import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorkers } from '../src/infrastructure/lifecycle.mjs';
test('workers relay durable messages, serialize deadlines and log failures', async () => {
  const logs = []; let relays = 0; let expirations = 0;
  const stop = startWorkers({ flush: async () => { relays++; throw new Error('relay failure'); } }, { expire: async () => { expirations++; throw new Error('deadline failure'); } }, { intervalMs: 10, log: value => logs.push(value) });
  await new Promise(resolve => setTimeout(resolve, 1100)); stop();
  assert.ok(relays > 0); assert.equal(expirations, 1); assert.ok(logs.some(value => value.includes('deadline')));
  const stopWithoutDeadline = startWorkers({ flush: async () => {} }, {}, { intervalMs: 10 }); stopWithoutDeadline();
});
