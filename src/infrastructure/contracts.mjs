import { createHash } from 'node:crypto';
import { z } from 'zod';
import tracer from 'dd-trace';

export const envelopeSchema = z.object({
  id: z.string().min(1).max(200), orderId: z.string().min(1).max(100),
  type: z.string().min(1).max(80), source: z.enum(['os', 'billing', 'execution']),
  target: z.enum(['os', 'billing', 'execution']), schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(), correlationId: z.string().min(1),
  causationId: z.string().min(1), payload: z.record(z.string(), z.unknown()),
  trace: z.record(z.string(), z.string()).default({}),
}).strict();

export function message(input, source, target, type, payload = {}) {
  const trace = { ...(input.trace ?? {}) };
  const span = tracer.scope().active();
  if (span) tracer.inject(span, 'text_map', trace);
  return envelopeSchema.parse({
    id: `${input.id}:${type}`, orderId: input.orderId, source, target, type,
    schemaVersion: 1, occurredAt: new Date().toISOString(),
    correlationId: input.correlationId ?? input.orderId, causationId: input.id,
    payload, trace,
  });
}

export function fingerprint(value) {
  // Exclude retry/time/trace metadata; identity covers business content.
  const canonical = input => Array.isArray(input) ? input.map(canonical) : input && typeof input === 'object'
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export class RetryableError extends Error {}
export class ConflictError extends Error {}
export class NotFoundError extends Error {}

export const lineSchema = z.object({
  quantity: z.number().int().positive(), unitPriceCents: z.number().int().nonnegative(),
  description: z.string().min(1).max(200), sku: z.string().min(1).max(80).optional(),
}).strict();
export const diagnosisSchema = z.object({ diagnosis: z.string().trim().min(1).max(4000), lines: z.array(lineSchema).min(1).max(100) }).strict();
