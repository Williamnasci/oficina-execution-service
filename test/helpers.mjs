import { ConflictError } from '../src/infrastructure/contracts.mjs';
export class MemoryStore {
  constructor() { this.records = new Map(); this.inbox = new Map(); this.outbox = []; }
  async transact(id, key, hash, decide) {
    const combined = `${id}:${key}`;
    if (this.inbox.has(combined)) {
      if (this.inbox.get(combined) !== hash) throw new ConflictError('Idempotency key reused with different content');
      return { data: structuredClone(this.records.get(id)), duplicate: true };
    }
    const result = await decide(structuredClone(this.records.get(id) ?? null));
    this.records.set(id, structuredClone(result.data)); this.inbox.set(combined, hash);
    this.outbox.push(...structuredClone(result.messages ?? []));
    return { data: structuredClone(result.data), duplicate: false };
  }
  async get(id) { return structuredClone(this.records.get(id) ?? null); }
  async list() { return [...this.records].map(([id, data]) => ({ id, data })); }
  async pending() { return this.outbox.map(envelope => ({ id: envelope.id, envelope })); }
  async markSent(id) { this.outbox = this.outbox.filter(envelope => envelope.id !== id); }
  async ping() {}
  async close() {}
}
