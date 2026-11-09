import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import express from 'express';
import { Registry, Counter, Histogram } from 'prom-client';
import tracer from 'dd-trace';
import { z } from 'zod';
import { ConflictError, NotFoundError } from './contracts.mjs';

export function authorize(req, secret, roles = []) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw Object.assign(new Error('Authentication required'), { status: 401 });
  let principal;
  try { principal = jwt.verify(token, secret, { algorithms: ['HS256'] }); }
  catch { throw Object.assign(new Error('Invalid or expired token'), { status: 401 }); }
  if (!principal.sub || (roles.length && !roles.includes(principal.role))) throw Object.assign(new Error('Forbidden'), { status: 403 });
  return principal;
}

export function assertOwner(data, principal) {
  const ownsBySubject = Boolean(data.owner) && data.owner === principal.sub;
  const ownsByDocument = Boolean(principal.document) && data.customer?.document === principal.document;
  if (principal.role !== 'admin' && principal.role !== 'operator' && !ownsBySubject && !ownsByDocument) throw Object.assign(new Error('Forbidden'), { status: 403 });
}

export async function createHttp({ service, store, broker, routes, spec, secret, port = 3000, listen = true }) {
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  class RootModule {}
  Module({})(RootModule);
  const app = await NestFactory.create(RootModule, { logger: false });
  const server = app.getHttpAdapter().getInstance();
  server.use(express.json({ limit: '128kb' }));
  server.use(helmet());
  const registry = new Registry();
  const requests = new Counter({ name: 'oficina_http_requests_total', help: 'HTTP requests', labelNames: ['service', 'route', 'status'], registers: [registry] });
  const duration = new Histogram({ name: 'oficina_http_duration_seconds', help: 'HTTP duration', labelNames: ['service', 'route'], registers: [registry] });
  server.use((req, res, next) => {
    const end = duration.startTimer();
    const span = tracer.scope().active();
    res.on('finish', () => {
      const route = req.route?.path ?? 'unmatched';
      requests.inc({ service, route, status: res.statusCode }); end({ service, route });
      console.log(JSON.stringify({ level: 'info', service, route, method: req.method, status: res.statusCode, trace_id: span?.context().toTraceId() }));
    });
    next();
  });
  server.get('/health', (_req, res) => res.json({ service, status: 'alive' }));
  server.get('/ready', async (_req, res) => {
    try { await store.ping(); if (!broker.ready) throw new Error('Broker disconnected'); res.json({ service, status: 'ready' }); }
    catch { res.status(503).json({ service, status: 'unavailable' }); }
  });
  server.get('/metrics', async (_req, res) => { res.type(registry.contentType).send(await registry.metrics()); });
  server.get('/openapi.json', (_req, res) => res.json(spec));
  server.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  for (const route of routes) {
    server[route.method](route.path, async (req, res) => {
      try {
        const principal = route.public ? undefined : authorize(req, secret, route.roles ?? []);
        const result = await route.handle(req, principal);
        res.status(route.status ?? 200).json(result ?? {});
      } catch (error) {
        const status = error.status ?? error.getStatus?.() ?? (error instanceof z.ZodError ? 400 : error instanceof ConflictError ? 409 : error instanceof NotFoundError ? 404 : 422);
        res.status(status).json({ statusCode: status, message: error instanceof z.ZodError ? 'Invalid request' : error.message });
      }
    });
  }
  // Initialize body parsing and Nest exception handling before serving the adapter routes.
  await app.init();
  if (listen) await app.listen(port, '0.0.0.0');
  return app;
}
