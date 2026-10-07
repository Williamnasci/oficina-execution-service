import amqp from 'amqplib';
import tracer from 'dd-trace';
import { envelopeSchema, message } from './contracts.mjs';

export class Broker {
  constructor({ url, service, store, handle, log = console.log, maxAttempts = 5, connect = amqp.connect, onDisconnect = () => {} }) {
    Object.assign(this, { url, service, store, handle, log, maxAttempts, connect, onDisconnect }); this.ready = false; this.flushing = false;
  }
  async init() {
    this.connection = await this.connect(this.url);
    this.connection.on('error', error => this.log(JSON.stringify({ level: 'error', component: 'broker', message: error.message })));
    this.connection.on('close', () => { this.ready = false; if (!this.closing) this.onDisconnect(); });
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange('oficina.v1', 'direct', { durable: true });
    for (const service of ['os', 'billing', 'execution']) {
      await this.channel.assertQueue(`oficina.${service}`, { durable: true });
      await this.channel.bindQueue(`oficina.${service}`, 'oficina.v1', service);
      await this.channel.assertQueue(`oficina.${service}.retry`, { durable: true, arguments: {
        'x-message-ttl': 1500, 'x-dead-letter-exchange': 'oficina.v1', 'x-dead-letter-routing-key': service,
      } });
      await this.channel.assertQueue(`oficina.${service}.dlq`, { durable: true });
    }
    await this.channel.prefetch(10);
    this.consumer = await this.channel.consume(`oficina.${this.service}`, delivery => this.consume(delivery), { noAck: false });
    this.ready = true;
  }
  async publish(envelope, queue, headers = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Publisher confirmation timeout')), 10000);
      const callback = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
      const options = { persistent: true, contentType: 'application/json', messageId: envelope.id, headers };
      const bytes = Buffer.from(JSON.stringify(envelope));
      try {
        if (queue) this.channel.sendToQueue(queue, bytes, options, callback);
        else this.channel.publish('oficina.v1', envelope.target, bytes, options, callback);
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }
  async consume(delivery) {
    if (!delivery) { this.ready = false; return; }
    let envelope;
    try {
      envelope = envelopeSchema.parse(JSON.parse(delivery.content.toString()));
      if (envelope.target !== this.service) throw new Error('Message routed to wrong service');
      const parent = tracer.extract('text_map', envelope.trace);
      await tracer.trace('oficina.consume', { childOf: parent, tags: { 'saga.id': envelope.orderId, 'event.type': envelope.type } }, async () => this.handle(envelope));
      this.channel.ack(delivery);
    } catch (error) {
      const attempt = Number(delivery.properties.headers?.attempt ?? 0);
      this.log(JSON.stringify({ level: 'error', component: 'consumer', eventId: envelope?.id, orderId: envelope?.orderId, attempt, message: error.message }));
      try {
        const value = envelope ?? { id: delivery.properties.messageId ?? 'invalid', raw: delivery.content.toString().slice(0, 1000) };
        if (envelope && attempt < this.maxAttempts) {
          await this.publish(value, `oficina.${this.service}.retry`, { attempt: attempt + 1 });
        } else {
          // Durably notify the coordinator BEFORE acknowledging the failed command.
          if (envelope && this.service !== 'os' && envelope.source === 'os') {
            const compensation = ['CancelExecution', 'CompensateBilling'].includes(envelope.type);
            const failed = message(envelope, this.service, 'os', compensation ? 'CompensationFailed' : 'StepFailed', { failedType: envelope.type, reason: 'Command retries exhausted' });
            await this.store.transact(envelope.orderId, `${envelope.id}:exhausted`, envelope.id, async data => ({ data: data ?? { orderId: envelope.orderId, status: 'FAILED' }, messages: [failed] }));
          }
          await this.publish(value, `oficina.${this.service}.dlq`, { attempt, failure: error.name });
        }
        this.channel.ack(delivery);
      } catch { this.channel.nack(delivery, false, true); }
    }
  }
  async flush() {
    if (!this.ready || this.flushing) return;
    this.flushing = true;
    try {
      for (const item of await this.store.pending()) {
        await this.publish(item.envelope);
        await this.store.markSent(item.id);
      }
    } finally { this.flushing = false; }
  }
  async close() {
    this.closing = true;
    this.ready = false;
    if (this.consumer) await this.channel.cancel(this.consumer.consumerTag);
    await this.channel?.close(); await this.connection?.close();
  }
}
