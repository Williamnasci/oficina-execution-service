import { startDiagnosis, diagnose, queue, startRepair, finishRepair, cancel, cancellationTombstone } from './work-order.ts';
import { message, fingerprint, diagnosisSchema, NotFoundError, RetryableError } from './infrastructure/contracts.mjs';
import { assertOwner } from './infrastructure/http.mjs';

export class ExecutionService {
  constructor(store, { failQueue = false } = {}) { Object.assign(this, { store, failQueue }); }
  async get(id, principal) { const data = await this.store.get(id); if (!data) throw new NotFoundError('Execution not found'); assertOwner(data, principal); return data; }
  async consume(event) {
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
        return { data: { ...data, ...queue(data, event.payload.paymentId ?? '') } };
      }
      const next = data ? { ...data, ...cancel(data) } : cancellationTombstone(event.orderId);
      return { data: next, messages: [message(event, 'execution', 'os', 'ExecutionCancelled')] };
    });
  }
  async diagnose(id, principal, body) {
    await this.get(id, principal);
    const input = diagnosisSchema.parse(body);
    const event = { id: `${id}:diagnosis`, orderId: id };
    return this.store.transact(id, event.id, fingerprint(input), async data => ({
      data: { ...data, ...diagnose(data, input.diagnosis), lines: input.lines },
      messages: [message(event, 'execution', 'os', 'DiagnosisCompleted', input)],
    }));
  }
  async repair(id, principal, action) {
    await this.get(id, principal);
    const event = { id: `${id}:${action}`, orderId: id };
    return this.store.transact(id, event.id, action, async data => ({
      data: { ...data, ...(action === 'start' ? startRepair(data) : finishRepair(data)) },
      messages: [message(event, 'execution', 'os', action === 'start' ? 'ExecutionStarted' : 'ExecutionFinished')],
    }));
  }
}

export function executionRoutes(service) {
  return [
    { method: 'get', path: '/executions/:id', handle: (req, principal) => service.get(req.params.id, principal) },
    { method: 'post', path: '/executions/:id/diagnosis', roles: ['admin', 'operator'], handle: async (req, principal) => (await service.diagnose(req.params.id, principal, req.body)).data },
    ...['start', 'finish'].map(action => ({ method: 'post', path: `/executions/:id/${action}`, roles: ['admin', 'operator'], handle: async (req, principal) => (await service.repair(req.params.id, principal, action)).data })),
  ];
}
