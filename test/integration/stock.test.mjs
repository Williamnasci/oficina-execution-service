import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoStore } from '../../dist/infrastructure/mongo-store.mjs';
import { StockRepository } from '../../dist/stock.mjs';
import { StockItem } from '../../dist/modules/stock-items/domain/entities/stock-item.entity.js';
import { ExecutionService } from '../../dist/service.mjs';
import { message } from '../../dist/infrastructure/contracts.mjs';
const enabled = Boolean(process.env.TEST_DATABASE_URL);
const principal = { sub: 'operator', role: 'operator' };
const command = (id, type, payload = {}) => message({ id: `${id}-${type}`, orderId: id }, 'os', 'execution', type, payload);
const connect = async () => { const store = new MongoStore(process.env.TEST_DATABASE_URL); await store.init(); return store; };

test('real MongoDB: concurrent reservation never oversells, multi-part abort is atomic, and SKU is unique', { skip: !enabled }, async () => {
  const store = await connect(), other = await connect(), aggregateId = `stock:test-${randomUUID()}`;
  const stock = new StockRepository(store, { aggregateId }), peer = new StockRepository(other, { aggregateId });
  try {
    const id = '00000000-0000-4000-8000-000000000001';
    await stock.create(new StockItem({ id, name: 'Original stock', sku: 'SKU', quantity: 3, unitPrice: 1.005 }));
    await assert.rejects(stock.reserve('partial', [{ stockItemId: id, quantity: 1 }, { stockItemId: 'ffffffff-ffff-4fff-bfff-ffffffffffff', quantity: 1 }]), /missing or inactive/);
    assert.equal((await stock.availability(id)).reserved, 0);
    const attempts = await Promise.allSettled([stock.reserve('order-one', [{ stockItemId: id, quantity: 2 }]), peer.reserve('order-two', [{ stockItemId: id, quantity: 2 }])]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1); assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await stock.availability(id)).available, 1);
    const winner = attempts[0].status === 'fulfilled' ? 'order-one' : 'order-two';
    const updated = await stock.findById(id); updated.update({ unitPrice: 5 }); await stock.update(updated);
    assert.equal((await stock.reservation(winner)).lines[0].unitPriceCents, 101);
    await Promise.all([stock.consume(winner), peer.consume(winner)]);
    assert.deepEqual(await stock.availability(id), { id, quantity: 1, reserved: 0, available: 1, isActive: true });
    await assert.rejects(stock.release(winner), /manual intervention/);
    const sku = 'Concurrent SKU';
    const inserts = await Promise.allSettled([stock.create(new StockItem({ id: randomUUID(), name: 'A', sku, unitPrice: 1 })), peer.create(new StockItem({ id: randomUUID(), name: 'B', sku, unitPrice: 1 }))]);
    assert.equal(inserts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await stock.findAll()).filter(item => item.sku === sku).length, 1);
  } finally { await store.close(); await other.close(); }
});

test('real MongoDB: cancellation racing diagnosis releases stock and fences delayed reservation after restart', { skip: !enabled }, async () => {
  let store = await connect(); const other = await connect(), aggregateId = `stock:test-${randomUUID()}`, id = randomUUID(), orderId = `os-${randomUUID()}`;
  try {
    let stock = new StockRepository(store, { aggregateId }); const peer = new StockRepository(other, { aggregateId });
    await stock.create(new StockItem({ id, name: 'Part', quantity: 3, unitPrice: 50 }));
    let service = new ExecutionService(store, { stock }); const cancelling = new ExecutionService(other, { stock: peer });
    await service.consume(command(orderId, 'StartDiagnosis', { stockItems: [{ stockItemId: id, quantity: 2 }] }));
    const results = await Promise.allSettled([service.diagnose(orderId, principal, { diagnosis: 'Race', lines: [] }), cancelling.consume(command(orderId, 'CancelExecution'))]);
    assert.equal(results[1].status, 'fulfilled');
    assert.equal((await store.get(orderId)).status, 'CANCELLED');
    assert.equal((await stock.availability(id)).available, 3); assert.equal((await stock.reservation(orderId)).state, 'RELEASED');
    await store.close(); store = await connect(); stock = new StockRepository(store, { aggregateId }); service = new ExecutionService(store, { stock });
    await service.consume(command(orderId, 'CancelExecution'));
    await assert.rejects(stock.reserve(orderId, [{ stockItemId: id, quantity: 2 }]), /cancelled/);
    assert.equal((await stock.availability(id)).reserved, 0);
    const entity = await stock.findById(id); entity.update({ quantity: 0 }); await stock.update(entity);
    assert.equal((await stock.availability(id)).quantity, 0);
  } finally { await store.close(); await other.close(); }
});

test('real MongoDB: crash between inventory and execution commits resumes without duplicate reserve or consume', { skip: !enabled }, async () => {
  let store = await connect(); const aggregateId = `stock:test-${randomUUID()}`, id = randomUUID(), orderId = `os-${randomUUID()}`;
  let stock = new StockRepository(store, { aggregateId }), service = new ExecutionService(store, { stock });
  const crash = operation => {
    const transact = store.transact.bind(store); let injected = false;
    store.transact = (aggregate, key, hash, decide) => transact(aggregate, key, hash, async data => {
      const result = await decide(data);
      if (!injected && aggregate === orderId && key === `${orderId}:${operation}`) { injected = true; throw new Error('Crash after inventory commit'); }
      return result;
    });
  };
  const restart = async () => { await store.close(); store = await connect(); stock = new StockRepository(store, { aggregateId }); service = new ExecutionService(store, { stock }); };
  try {
    await stock.create(new StockItem({ id, name: 'Recovery part', quantity: 3, unitPrice: 50 }));
    await service.consume(command(orderId, 'StartDiagnosis', { stockItems: [{ stockItemId: id, quantity: 2 }] }));
    const body = { diagnosis: 'Recovery', lines: [] };
    crash('diagnosis'); await assert.rejects(service.diagnose(orderId, principal, body), /Crash/);
    assert.equal((await stock.availability(id)).reserved, 2); assert.equal((await store.get(orderId)).status, 'DIAGNOSING');
    await restart(); await service.diagnose(orderId, principal, body); assert.equal((await stock.availability(id)).reserved, 2);
    await service.consume(command(orderId, 'QueueExecution', { paymentId: 'verified-payment' }));
    crash('start'); await assert.rejects(service.repair(orderId, principal, 'start'), /Crash/);
    assert.equal((await stock.availability(id)).quantity, 1); assert.equal((await store.get(orderId)).status, 'QUEUED');
    await restart(); await assert.rejects(service.consume(command(orderId, 'CancelExecution')), /manual intervention/);
    await service.repair(orderId, principal, 'start'); await service.repair(orderId, principal, 'start');
    assert.equal((await stock.availability(id)).quantity, 1); assert.equal((await store.get(orderId)).status, 'IN_PROGRESS');
    const record = await store.collection.findOne({ _id: orderId });
    assert.equal(record.outbox.filter(item => item.envelope.type === 'ExecutionStarted').length, 1);
  } finally { await store.close(); }
});
