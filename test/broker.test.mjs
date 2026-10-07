import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Broker } from '../src/infrastructure/broker.mjs';
import { message } from '../src/infrastructure/contracts.mjs';
import { MemoryStore } from './helpers.mjs';
import { EventEmitter } from 'node:events';

function fixture(service = 'billing') {
  const calls = []; const store = new MemoryStore();
  const broker = new Broker({ service, store, url: '', handle: async () => {}, log: () => {}, maxAttempts: 1 });
  broker.channel = {
    ack: delivery => calls.push(['ack', delivery]), nack: (...args) => calls.push(['nack', ...args]),
    publish: (...args) => { calls.push(['publish', ...args.slice(0, 4)]); args[4](); },
    sendToQueue: (...args) => { calls.push(['queue', ...args.slice(0, 3)]); args[3](); },
    cancel: async () => {}, close: async () => {},
  };
  broker.connection = { close: async () => {} };
  const envelope = message({ id: 'a', orderId: 'order-1' }, 'os', service, 'CreateQuote');
  const delivery = { content: Buffer.from(JSON.stringify(envelope)), properties: { headers: {}, messageId: envelope.id } };
  return { broker, calls, store, envelope, delivery };
}
test('topology is durable and connection loss removes readiness', async () => {
  const f = fixture(); const connection = new EventEmitter(); const calls = [];
  const channel = {
    ...f.broker.channel, assertExchange: async (...args) => calls.push(args),
    assertQueue: async (...args) => calls.push(args), bindQueue: async () => {}, prefetch: async () => {},
    consume: async (_queue, handler) => { await handler(null); return { consumerTag: 'tag' }; },
  };
  connection.createConfirmChannel = async () => channel; connection.close = async () => {};
  f.broker.connect = async () => connection;
  await f.broker.init(); assert.equal(f.broker.ready, true); assert.equal(calls.length, 10);
  connection.emit('error', new Error('network')); connection.emit('close'); assert.equal(f.broker.ready, false);
  await f.broker.close(); connection.emit('close');
});
test('consumer ACK happens after commit; failures retry with attempt and DLQ at exhaustion', async () => {
  const f = fixture();
  f.broker.handle = async () => f.calls.push(['commit']);
  await f.broker.consume(f.delivery); assert.equal(f.calls[0][0], 'commit'); assert.equal(f.calls[1][0], 'ack');
  f.calls.length = 0; f.broker.handle = async () => { throw new Error('temporary'); };
  await f.broker.consume(f.delivery);
  assert.equal(f.calls[0][0], 'queue'); assert.equal(f.calls[0][1], 'oficina.billing.retry'); assert.equal(f.calls[0][3].headers.attempt, 1);
  f.calls.length = 0; f.delivery.properties.headers.attempt = 1;
  await f.broker.consume(f.delivery);
  assert.equal(f.calls[0][1], 'oficina.billing.dlq'); assert.equal(f.store.outbox[0].type, 'StepFailed');
  const compensation = fixture('execution'); compensation.envelope.type = 'CancelExecution'; compensation.delivery.content = Buffer.from(JSON.stringify(compensation.envelope)); compensation.delivery.properties.headers.attempt = 1; compensation.broker.handle = f.broker.handle;
  await compensation.broker.consume(compensation.delivery); assert.equal(compensation.store.outbox[0].type, 'CompensationFailed');
});
test('bad envelopes and wrong route are rejected; failed republish retains delivery', async () => {
  const f = fixture(); f.delivery.content = Buffer.from('{'); await f.broker.consume(f.delivery); assert.equal(f.calls[0][1], 'oficina.billing.dlq');
  f.delivery.content = Buffer.from(JSON.stringify({ ...f.envelope, target: 'os' })); await f.broker.consume(f.delivery);
  f.broker.publish = async () => { throw new Error('broker down'); };
  await f.broker.consume(f.delivery); assert.ok(f.calls.some(call => call[0] === 'nack'));
  await f.broker.consume(null); assert.equal(f.broker.ready, false);
});
test('relay marks only confirmed publishes, skips parallel flush and preserves failures', async () => {
  const f = fixture();
  await f.store.transact('order-1', 'x', 'x', async () => ({ data: {}, messages: [f.envelope] }));
  await f.broker.flush(); assert.equal(f.store.outbox.length, 1);
  f.broker.ready = true; f.broker.flushing = true; await f.broker.flush(); assert.equal(f.store.outbox.length, 1); f.broker.flushing = false;
  await f.broker.flush(); assert.equal(f.store.outbox.length, 0);
  f.store.outbox.push(f.envelope); f.broker.channel.publish = (...args) => args[4](new Error('nack'));
  await assert.rejects(f.broker.flush()); assert.equal(f.store.outbox.length, 1); assert.equal(f.broker.flushing, false);
  f.broker.channel.publish = () => { throw new Error('closed'); }; await assert.rejects(f.broker.publish(f.envelope));
  f.broker.consumer = { consumerTag: 'tag' }; await f.broker.close(); assert.equal(f.broker.ready, false);
});
