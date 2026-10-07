import { MongoClient } from 'mongodb';
import { ConflictError, RetryableError } from './contracts.mjs';

/** A single-document CAS atomically commits state, inbox and outbox; no replica-set dependency. */
export class MongoStore {
  constructor(url, client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 })) { this.client = client; }
  async init() {
    await this.client.connect();
    this.db = this.client.db();
    this.collection = this.db.collection('aggregates');
    await this.collection.createIndex({ 'outbox.sent': 1 });
    await this.collection.createIndex({ 'data.status': 1 });
  }
  async transact(id, messageId, hash, decide) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const existing = await this.collection.findOne({ _id: id });
      const duplicate = existing?.inbox.find(item => item.id === messageId);
      if (duplicate) {
        if (duplicate.hash !== hash) throw new ConflictError('Idempotency key reused with different content');
        return { data: existing.data, duplicate: true };
      }
      const result = await decide(existing?.data ?? null);
      if (!result?.data) throw new Error('Decision must return aggregate data');
      const inbox = { id: messageId, hash };
      const outbox = (result.messages ?? []).map(envelope => ({ id: envelope.id, envelope, sent: false }));
      if (!existing) {
        try {
          await this.collection.insertOne({ _id: id, version: 0, data: result.data, inbox: [inbox], outbox, updatedAt: new Date() });
          return { data: result.data, duplicate: false };
        } catch (error) { if (error.code !== 11000) throw error; }
      } else {
        const update = await this.collection.updateOne({ _id: id, version: existing.version }, {
          $set: { data: result.data, updatedAt: new Date() }, $inc: { version: 1 },
          $push: { inbox, outbox: { $each: outbox } },
        });
        if (update.modifiedCount) return { data: result.data, duplicate: false };
      }
    }
    throw new RetryableError('Aggregate contention');
  }
  async get(id) { return (await this.collection.findOne({ _id: id }))?.data ?? null; }
  async list() { return (await this.collection.find({}).sort({ updatedAt: -1 }).limit(500).toArray()).map(doc => ({ id: doc._id, data: doc.data })); }
  async pending() {
    return this.collection.aggregate([
      { $match: { 'outbox.sent': false } }, { $unwind: '$outbox' },
      { $match: { 'outbox.sent': false } }, { $limit: 100 },
      { $project: { _id: 0, id: '$outbox.id', envelope: '$outbox.envelope' } },
    ]).toArray();
  }
  async markSent(id) { await this.collection.updateOne({ 'outbox.id': id }, { $set: { 'outbox.$.sent': true } }); }
  async ping() { await this.db.command({ ping: 1 }); }
  async close() { await this.client.close(); }
}
