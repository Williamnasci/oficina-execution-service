import { test } from 'node:test';
import assert from 'node:assert/strict';
import { message, envelopeSchema, fingerprint, lineSchema } from '../src/infrastructure/contracts.mjs';
test('versioned envelopes preserve causation and deterministic business identity', () => {
  const value = message({ id: 'event-1', orderId: 'order-1' }, 'os', 'billing', 'CreateQuote');
  assert.equal(value.id, 'event-1:CreateQuote'); assert.equal(value.causationId, 'event-1');
  assert.equal(value.correlationId, 'order-1'); assert.deepEqual(value.trace, {});
  assert.equal(message({ id: 'x', orderId: 'o', correlationId: 'c', trace: { traceparent: 't' } }, 'os', 'billing', 'cmd').correlationId, 'c');
  assert.throws(() => envelopeSchema.parse({ ...value, schemaVersion: 2 }));
  assert.equal(fingerprint({ a: 1, b: [2, { d: 3, c: 2 }] }), fingerprint({ b: [2, { c: 2, d: 3 }], a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.equal(lineSchema.parse({ description: 'Filtro', quantity: 1, serviceId: 'filter' }).unitPriceCents, undefined);
  assert.throws(() => lineSchema.parse({ description: 'Filtro', quantity: 1 }));
});
