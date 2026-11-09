import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { StockItem } from '../dist/modules/stock-items/domain/entities/stock-item.entity.js';
import { StockRepository, stockRoutes, stockPriceToCents } from '../dist/stock.mjs';
import { createHttp } from '../dist/infrastructure/http.mjs';
import { ExecutionService } from '../dist/service.mjs';
import { message } from '../dist/infrastructure/contracts.mjs';
import { MemoryStore } from './helpers.mjs';

const principal = { sub: 'operator', role: 'operator' };
async function fixture() {
  const store = new MemoryStore(), stock = new StockRepository(store);
  const id = randomUUID(); await stock.create(new StockItem({ id, name: ' Brake pad ', quantity: 3, unitPrice: 50, sku: 'BRAKE' }));
  return { store, stock, id };
}
const command = (orderId, type, payload = {}, suffix = type) => message({ id: `${orderId}-${suffix}`, orderId }, 'os', 'execution', type, payload);

test('stock reserve, snapshot, consume and cancellation fences are atomic and idempotent', async () => {
  const { stock, id } = await fixture();
  assert.equal(stockPriceToCents(1.005), 101); assert.equal(stockPriceToCents(0), 0);
  for (const value of [-1, NaN, Infinity, 100000000]) assert.throws(() => stockPriceToCents(value));
  assert.equal(await stock.findById('missing'), null); assert.equal(await stock.findBySku('missing'), null);
  assert.equal((await stock.findBySku('BRAKE')).id, id); assert.equal((await stock.findAll(true)).length, 1);
  const plan = [{ stockItemId: id, quantity: 1 }, { stockItemId: id, quantity: 1 }];
  const reserved = await stock.reserve('order-one', plan);
  assert.equal(reserved.lines.length, 1); assert.equal(reserved.lines[0].quantity, 2); assert.equal(reserved.lines[0].unitPriceCents, 5000);
  await stock.reserve('order-one', [{ stockItemId: id, quantity: 2 }]);
  assert.deepEqual(await stock.availability(id), { id, quantity: 3, reserved: 2, available: 1, isActive: true });
  await assert.rejects(stock.reserve('order-two', [{ stockItemId: id, quantity: 2 }]), /Insufficient/);
  await assert.rejects(stock.reserve('order-one', [{ stockItemId: id, quantity: 1 }]), /Idempotency/);
  const updated = await stock.findById(id); updated.update({ unitPrice: 75, description: 'Updated' }); await stock.update(updated);
  assert.equal((await stock.reserve('order-one', plan)).lines[0].unitPriceCents, 5000);
  await stock.consume('order-one'); await stock.consume('order-one');
  assert.deepEqual(await stock.availability(id), { id, quantity: 1, reserved: 0, available: 1, isActive: true });
  await assert.rejects(stock.release('order-one'), /manual intervention/);
  await stock.release('cancel-before-reserve'); await stock.release('cancel-before-reserve');
  await assert.rejects(stock.reserve('cancel-before-reserve', [{ stockItemId: id, quantity: 1 }]), /cancelled/);
  await assert.rejects(stock.consume('cancel-before-reserve'), /Active reservation/);
  await assert.rejects(stock.consume('missing-reservation'), /Active reservation/);
  await stock.reserve('release-after-reserve', [{ stockItemId: id, quantity: 1 }]);
  await stock.release('release-after-reserve'); await stock.release('release-after-reserve');
  await assert.rejects(stock.reserve('release-after-reserve', [{ stockItemId: id, quantity: 1 }]), /cancelled/);
  assert.equal((await stock.availability(id)).available, 1);
  assert.equal(await stock.reservation('missing'), null);
  await assert.rejects(stock.availability('missing'), /not found/);
});

test('inventory rejects partial reservations, duplicate SKU, stale administration and quantity below reservations', async () => {
  const { stock, id } = await fixture();
  await assert.rejects(stock.reserve('partial', [{ stockItemId: id, quantity: 1 }, { stockItemId: randomUUID(), quantity: 1 }]), /missing or inactive/);
  assert.equal((await stock.availability(id)).reserved, 0); assert.equal(await stock.reservation('partial'), null);
  await assert.rejects(stock.create(new StockItem({ id, name: 'Duplicate', quantity: 1, unitPrice: 1 })), /ID already/);
  await assert.rejects(stock.create(new StockItem({ id: randomUUID(), name: 'Duplicate SKU', sku: 'BRAKE', unitPrice: 1 })), /SKU already/);
  await assert.rejects(stock.update(new StockItem({ id: randomUUID(), name: 'Missing', unitPrice: 1 })), /not found/);
  await assert.rejects(stock.create(new StockItem({ id: randomUUID(), name: 'Invalid quantity', quantity: 2147483648, unitPrice: 1 })), /Invalid stock quantity/);
  const stale = await stock.findById(id);
  await stock.reserve('held', [{ stockItemId: id, quantity: 2 }]);
  stale.update({ name: 'Stale admin' }); await assert.rejects(stock.update(stale), /changed/);
  const current = await stock.findById(id); current.update({ quantity: 1 }); await assert.rejects(stock.update(current), /lower than reserved/);
  const inactive = await stock.findById(id); inactive.update({ isActive: false }); await stock.update(inactive);
  assert.equal((await stock.findAll()).length, 1); assert.equal((await stock.findAll(true)).length, 0);
  await assert.rejects(stock.reserve('inactive', [{ stockItemId: id, quantity: 1 }]), /missing or inactive/);
  await stock.release('held'); assert.equal((await stock.availability(id)).reserved, 0);
  await assert.rejects(stock.reserve('__proto__', []));
});

test('extracted stock HTTP CRUD preserves legacy contract and grants operators availability only', async () => {
  const store = new MemoryStore(), stock = new StockRepository(store), secret = 'stock-contract-at-least-thirty-two-characters';
  const headers = { Authorization: `Bearer ${jwt.sign({ sub: 'admin', role: 'admin' }, secret)}`, 'Content-Type': 'application/json' };
  const app = await createHttp({ service: 'execution', store, broker: { ready: true }, secret, port: 0, spec: {}, routes: stockRoutes(stock) });
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`, call = (path, method = 'GET', body) => fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const response = await call('/stock-items', 'POST', { name: 'Part', unitPrice: 1.005 }); assert.equal(response.status, 201);
    const { id } = await response.json(); assert.match(id, /^[\da-f-]{36}$/);
    const found = await (await call(`/stock-items/${id}`)).json(); assert.equal(found.quantity, 0); assert.equal(found.unitPrice, 1.01); assert.equal(found.sku, null);
    assert.equal((await (await call('/stock-items')).json()).length, 1);
    assert.equal((await call(`/stock-items/${id}`, 'PATCH', { name: 'Updated', description: null, sku: 'NEW', quantity: 5, unitPrice: 2, isActive: true })).status, 204);
    assert.equal((await (await call(`/stock-items/${id}/availability`)).json()).available, 5);
    const operator = { Authorization: `Bearer ${jwt.sign({ sub: 'operator', role: 'operator' }, secret)}` };
    assert.equal((await fetch(base + `/stock-items/${id}/availability`, { headers: operator })).status, 200);
    assert.equal((await fetch(base + '/stock-items', { headers: operator })).status, 403);
    assert.equal((await call('/stock-items', 'POST', { name: 'Duplicate', unitPrice: 1, sku: 'NEW' })).status, 409);
    for (const body of [null, [], { name: 'Invalid', unitPrice: -1 }, { name: 'Invalid', unitPrice: 100000000 }, { name: 'Invalid', unitPrice: 1, quantity: 2147483648 }, { name: 'Invalid', unitPrice: 1, reserved: 1 }]) assert.equal((await call('/stock-items', 'POST', body)).status, 400);
    assert.equal((await call('/stock-items', 'POST', { name: ' ', unitPrice: 1 })).status, 422);
    for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await call('/stock-items/missing', method, method === 'PATCH' ? {} : undefined)).status, 404);
    assert.equal((await call(`/stock-items/${id}`, 'DELETE')).status, 204); assert.equal((await (await call(`/stock-items/${id}`)).json()).isActive, false);
  } finally { await app.close(); }
});

test('diagnosis snapshots parts, paid repair consumes once, and cancelled diagnosis cannot resurrect reservations', async () => {
  const { store, stock, id } = await fixture(), service = new ExecutionService(store, { stock });
  await service.consume(command('order', 'StartDiagnosis', { owner: 'operator', stockItems: [{ stockItemId: id, quantity: 2 }] }));
  await service.diagnose('order', principal, { diagnosis: 'Brakes', lines: [] });
  assert.equal(store.outbox.at(-1).payload.lines[0].unitPriceCents, 5000); assert.equal(store.outbox.at(-1).payload.lines[0].stockItemId, id);
  await assert.rejects(service.repair('order', principal, 'start'), /not queued/);
  await service.consume(command('order', 'QueueExecution', { paymentId: 'verified' }));
  await service.repair('order', principal, 'start'); await service.repair('order', principal, 'start');
  assert.equal((await stock.availability(id)).quantity, 1); assert.equal((await stock.reservation('order')).state, 'CONSUMED');
  await assert.rejects(service.consume(command('order', 'CancelExecution')), /manual intervention/);
  await service.repair('order', principal, 'finish');
  await service.consume(command('cancelled', 'CancelExecution')); await service.consume(command('cancelled', 'StartDiagnosis'));
  await assert.rejects(service.diagnose('cancelled', principal, { diagnosis: 'Late', lines: [], stockItems: [{ stockItemId: id, quantity: 1 }] }), /Invalid diagnosis/);
  assert.equal((await stock.availability(id)).available, 1);
  await assert.rejects(service.get('stock:warehouse', principal), /not found/);
  await assert.rejects(service.consume(command('stock:warehouse', 'StartDiagnosis')), /Reserved aggregate/);
});

test('crash after stock commit is recoverable before diagnosis or repair state commit', async () => {
  const { store, stock, id } = await fixture();
  const original = store.transact.bind(store); let fail;
  store.transact = (aggregate, key, hash, decide) => original(aggregate, key, hash, async data => {
    const result = await decide(data);
    if (aggregate === 'recovery' && fail === key) { fail = null; throw new Error('Crash after inventory commit'); }
    return result;
  });
  const service = new ExecutionService(store, { stock });
  await service.consume(command('recovery', 'StartDiagnosis', { stockItems: [{ stockItemId: id, quantity: 2 }] }));
  const body = { diagnosis: 'Recovery', lines: [] };
  fail = 'recovery:diagnosis'; await assert.rejects(service.diagnose('recovery', principal, body), /Crash/);
  assert.equal((await store.get('recovery')).status, 'DIAGNOSING'); assert.equal((await stock.availability(id)).reserved, 2);
  await service.diagnose('recovery', principal, body); assert.equal((await stock.availability(id)).reserved, 2);
  await service.consume(command('recovery', 'QueueExecution', { paymentId: 'verified' }));
  fail = 'recovery:start'; await assert.rejects(service.repair('recovery', principal, 'start'), /Crash/);
  assert.equal((await store.get('recovery')).status, 'QUEUED'); assert.equal((await stock.availability(id)).quantity, 1);
  await assert.rejects(service.consume(command('recovery', 'CancelExecution')), /manual intervention/);
  await service.repair('recovery', principal, 'start'); assert.equal((await stock.availability(id)).quantity, 1);
  assert.equal(store.outbox.filter(event => event.type === 'ExecutionStarted').length, 1);
});
