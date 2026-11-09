import { z } from 'zod';
import { startDiagnosis, diagnose, queue, startRepair, finishRepair, cancel, cancellationTombstone } from './work-order.ts';
import { message, fingerprint, diagnosisSchema, lineSchema, NotFoundError, RetryableError } from './infrastructure/contracts.mjs';
import { assertOwner } from './infrastructure/http.mjs';
import { stockPlanSchema } from './stock.mjs';
const executionDiagnosisSchema = diagnosisSchema.extend({ lines: z.array(lineSchema).max(100), stockItems: stockPlanSchema.optional() });

export class ExecutionService {
  constructor(store, { failQueue = false, stock } = {}) { Object.assign(this, { store, failQueue, stock }); }
  async get(id, principal) { if (id.startsWith('stock:')) throw new NotFoundError('Execution not found'); const data = await this.store.get(id); if (!data) throw new NotFoundError('Execution not found'); assertOwner(data, principal); return data; }
  async consume(event) {
    if (event.orderId.startsWith('stock:')) throw new Error('Reserved aggregate identity');
    if (event.source !== 'os' || !['StartDiagnosis', 'QueueExecution', 'CancelExecution'].includes(event.type)) throw new Error('Invalid command producer/type');
    return this.store.transact(event.orderId, event.id, fingerprint({ type: event.type, payload: event.payload }), async data => {
      if (event.type === 'StartDiagnosis') {
        if (data?.status === 'CANCELLED') return { data };
        if (data) throw new Error('Execution already exists');
        return { data: { ...startDiagnosis(event.orderId), ...event.payload } };
      }
      if (event.type === 'QueueExecution') {
        if (!data) throw new RetryableError('Diagnosis not available yet');
        if (data.status === 'CANCELLED') return { data };
        if (this.failQueue && data.diagnosis === 'TEST:FAIL_QUEUE') throw new Error('Injected queue failure (test profile only)');
        const next = queue(data, event.payload.paymentId ?? '');
        if (this.stock) {
          let reservation = await this.stock.reservation(event.orderId);
          if (!reservation && !(data.stockItems?.length)) reservation = await this.stock.reserve(event.orderId, []);
          if (!reservation || reservation.state === 'RELEASED') throw new Error('Active stock reservation is required');
        }
        return { data: { ...data, ...next } };
      }
      const next = data ? { ...data, ...cancel(data) } : cancellationTombstone(event.orderId);
      if (this.stock) { await this.stock.release(event.orderId); next.stockReservation = 'RELEASED'; }
      return { data: next, messages: [message(event, 'execution', 'os', 'ExecutionCancelled')] };
    });
  }
  async diagnose(id, principal, body) {
    await this.get(id, principal);
    const input = executionDiagnosisSchema.parse(body);
    if (input.lines.some(line => line.stockItemId)) throw Object.assign(new Error('Select parts through stockItems'), { status: 400 });
    const event = { id: `${id}:diagnosis`, orderId: id };
    return this.store.transact(id, event.id, fingerprint(input), async data => {
      const next = diagnose(data, input.diagnosis);
      const plan = stockPlanSchema.parse(input.stockItems ?? data.stockItems ?? []);
      const requested = data.services ?? [];
      const labor = input.lines.length ? input.lines : requested.map(item => ({ serviceId: item.serviceId, quantity: item.quantity, description: 'Serviço do catálogo' }));
      if (!labor.length && !plan.length) throw Object.assign(new Error('Quote items are required'), { status: 400 });
      if (labor.length + plan.length > 100) throw Object.assign(new Error('Too many quote items'), { status: 400 });
      if (!this.stock && plan.length) throw new Error('Stock repository is required');
      const validatedLabor = z.array(lineSchema).parse(labor);
      const reserved = this.stock ? await this.stock.reserve(id, plan) : { lines: [] };
      const quote = diagnosisSchema.parse({ diagnosis: input.diagnosis, lines: [...validatedLabor, ...reserved.lines] });
      return { data: { ...data, ...next, lines: quote.lines, stockItems: plan, ...(this.stock ? { stockReservation: 'RESERVED' } : {}) }, messages: [message(event, 'execution', 'os', 'DiagnosisCompleted', quote)] };
    });
  }

  async repair(id, principal, action) {
    await this.get(id, principal);
    const event = { id: `${id}:${action}`, orderId: id };
    return this.store.transact(id, event.id, action, async data => {
      const next = action === 'start' ? startRepair(data) : finishRepair(data);
      if (this.stock && action === 'start') {
        if (!data.stockReservation && !(data.stockItems?.length)) await this.stock.reserve(id, []);
        await this.stock.consume(id);
        next.stockReservation = 'CONSUMED';
      }
      return { data: { ...data, ...next }, messages: [message(event, 'execution', 'os', action === 'start' ? 'ExecutionStarted' : 'ExecutionFinished')] };
    });
  }
}

export function executionRoutes(service) {
  return [
    { method: 'get', path: '/executions/:id', handle: (req, principal) => service.get(req.params.id, principal) },
    { method: 'post', path: '/executions/:id/diagnosis', roles: ['admin', 'operator'], handle: async (req, principal) => (await service.diagnose(req.params.id, principal, req.body)).data },
    ...['start', 'finish'].map(action => ({ method: 'post', path: `/executions/:id/${action}`, roles: ['admin', 'operator'], handle: async (req, principal) => (await service.repair(req.params.id, principal, action)).data })),
  ];
}
