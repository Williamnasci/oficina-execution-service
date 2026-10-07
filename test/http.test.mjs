import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { createHttp, authorize, assertOwner } from '../src/infrastructure/http.mjs';
import { ConflictError, NotFoundError } from '../src/infrastructure/contracts.mjs';

const secret = 'test-secret-at-least-thirty-two-characters';
const token = jwt.sign({ sub: 'customer', document: '52998224725', role: 'customer' }, secret);
test('authentication validates signature, subject, role and ownership', () => {
  assert.throws(() => authorize({ headers: {} }, secret), { status: 401 });
  assert.throws(() => authorize({ headers: { authorization: 'Bearer invalid' } }, secret), { status: 401 });
  assert.throws(() => authorize({ headers: { authorization: `Bearer ${jwt.sign({}, secret)}` } }, secret), { status: 403 });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const principal = authorize(req, secret);
  assert.throws(() => authorize(req, secret, ['operator']), { status: 403 });
  assertOwner({ owner: 'customer' }, principal);
  assertOwner({ customer: { document: '52998224725' } }, principal);
  assertOwner({}, { sub: 'operator', role: 'operator' });
  assertOwner({}, { sub: 'admin', role: 'admin' });
  assert.throws(() => assertOwner({}, { sub: 'other' }), { status: 403 });
});
test('Nest HTTP adapter parses body, documents API, exports metrics and enforces errors', async () => {
  await assert.rejects(createHttp({ secret: 'short' }));
  let healthy = true;
  const broker = { ready: true };
  const store = { ping: async () => { if (!healthy) throw new Error('database unavailable'); } };
  const app = await createHttp({ service: 'os', store, broker, secret, port: 0, spec: { openapi: '3.0.3', info: { title: 'test', version: '1' }, paths: {} }, routes: [
    { method: 'post', path: '/echo', handle: req => req.body },
    { method: 'get', path: '/admin', roles: ['admin'], handle: () => ({ allowed: true }) },
    { method: 'get', path: '/bad', public: true, handle: () => z.string().parse(1) },
    { method: 'get', path: '/conflict', public: true, handle: () => { throw new ConflictError('Conflict'); } },
    { method: 'get', path: '/missing', public: true, handle: () => { throw new NotFoundError('Not found'); } },
    { method: 'get', path: '/domain', public: true, handle: () => { throw new Error('Invalid transition'); } },
    { method: 'get', path: '/void', public: true, handle: () => undefined },
  ] });
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  try {
    const echo = await fetch(`${url}/echo`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ hello: 'world' }) });
    assert.deepEqual(await echo.json(), { hello: 'world' });
    assert.equal((await fetch(`${url}/admin`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
    assert.equal((await fetch(`${url}/echo`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/ready`)).status, 200);
    broker.ready = false; assert.equal((await fetch(`${url}/ready`)).status, 503); broker.ready = true;
    healthy = false; assert.equal((await fetch(`${url}/ready`)).status, 503);
    assert.equal((await fetch(`${url}/openapi.json`)).status, 200);
    assert.ok((await (await fetch(`${url}/metrics`)).text()).includes('oficina_http_requests_total'));
    for (const [path, status] of [['bad', 400], ['conflict', 409], ['missing', 404], ['domain', 422], ['void', 200]]) assert.equal((await fetch(`${url}/${path}`)).status, status);
  } finally { await app.close(); }
  const initialized = await createHttp({ service: 'os', store, broker, secret, listen: false, spec: { openapi: '3.0.3', info: { title: 'test', version: '1' }, paths: {} }, routes: [] });
  await initialized.close();
});
