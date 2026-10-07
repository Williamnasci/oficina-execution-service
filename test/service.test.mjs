import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionService, executionRoutes } from '../src/service.mjs';
import { message } from '../src/infrastructure/contracts.mjs';
import { MemoryStore } from './helpers.mjs';

const principal = { sub: 'op', role: 'operator' };
const diagnosis = { diagnosis: 'Trocar filtro', lines: [{ description: 'Filtro', quantity: 1, unitPriceCents: 100 }] };
const event = (type, payload = {}, id = type) => message({ id, orderId: 'o' }, 'os', 'execution', type, payload);
test('execution persists diagnosis, gates paid queue and publishes repair progress', async () => {
  const store = new MemoryStore(); const service = new ExecutionService(store);
  await assert.rejects(service.get('o', principal), /not found/);
  await assert.rejects(service.consume({ ...event('StartDiagnosis'), source: 'billing' }), /producer/);
  await assert.rejects(service.consume(event('QueueExecution')), /not available/);
  await service.consume(event('StartDiagnosis', { owner: 'op' }));
  await assert.rejects(service.consume(event('StartDiagnosis', {}, 'different')), /already exists/);
  await service.diagnose('o', principal, diagnosis); await service.consume(event('QueueExecution', { paymentId: 'mp' }));
  assert.equal((await service.get('o', principal)).status, 'QUEUED');
  await service.repair('o', principal, 'start'); await service.repair('o', principal, 'finish');
  assert.equal((await store.get('o')).status, 'FINISHED'); assert.deepEqual(store.outbox.map(e => e.type), ['DiagnosisCompleted', 'ExecutionStarted', 'ExecutionFinished']);
});
test('cancellation tombstone wins against delayed opening and delayed queue', async () => {
  const store = new MemoryStore(); const service = new ExecutionService(store);
  await service.consume(event('CancelExecution')); await service.consume(event('StartDiagnosis')); await service.consume(event('QueueExecution', { paymentId: 'mp' }));
  assert.equal((await store.get('o')).status, 'CANCELLED'); assert.equal(store.outbox.length, 1);
  const other = new ExecutionService(new MemoryStore()); await other.consume(event('StartDiagnosis')); await other.consume(event('CancelExecution')); assert.equal((await other.store.get('o')).status, 'CANCELLED');
});
test('test profile injects queue failure and routes expose authorized operations', async () => {
  const store = new MemoryStore(); const service = new ExecutionService(store, { failQueue: true });
  await service.consume(event('StartDiagnosis')); const routes = executionRoutes(service); const req = { params: { id: 'o' }, body: { ...diagnosis, diagnosis: 'TEST:FAIL_QUEUE' } };
  assert.equal((await routes[0].handle(req, principal)).status, 'DIAGNOSING');
  await routes[1].handle(req, principal); await assert.rejects(service.consume(event('QueueExecution', { paymentId: 'mp' })), /Injected/);
  await assert.rejects(routes[2].handle(req, principal)); await assert.rejects(routes[3].handle(req, principal));
});
