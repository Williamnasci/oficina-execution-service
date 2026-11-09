import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import Decimal from 'decimal.js';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { z } from 'zod';
import { fingerprint } from './infrastructure/contracts.mjs';
import { StockItem } from './modules/stock-items/domain/entities/stock-item.entity.js';
import { CreateStockItemUseCase } from './modules/stock-items/application/use-cases/create-stock-item.use-case.js';
import { GetStockItemUseCase } from './modules/stock-items/application/use-cases/get-stock-item.use-case.js';
import { ListStockItemsUseCase } from './modules/stock-items/application/use-cases/list-stock-items.use-case.js';
import { UpdateStockItemUseCase } from './modules/stock-items/application/use-cases/update-stock-item.use-case.js';
import { DeleteStockItemUseCase } from './modules/stock-items/application/use-cases/delete-stock-item.use-case.js';
import { CreateStockItemDto } from './modules/stock-items/application/dto/create-stock-item.dto.js';
import { UpdateStockItemDto } from './modules/stock-items/application/dto/update-stock-item.dto.js';

export const stockPlanSchema = z.array(z.object({ stockItemId: z.uuid(), quantity: z.number().int().positive().max(2147483647) }).strict()).max(100);
const orderSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,199}$/);
const revision = Symbol('stockRevision');
const initial = () => ({ items: {}, reservations: {} });
const own = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
const timestamp = () => new Date().toISOString();

export function stockPriceToCents(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid stock price');
  const cents = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).times(100).toNumber();
  if (cents > 9999999999) throw new Error('Stock price exceeds Decimal(10,2)');
  return cents;
}
function recordOf(item) {
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 2147483647) throw new Error('Invalid stock quantity');
  const unitPriceCents = stockPriceToCents(item.unitPrice);
  return { id: item.id, name: item.name, description: item.description, sku: item.sku, quantity: item.quantity, unitPrice: unitPriceCents / 100, unitPriceCents, isActive: item.isActive, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() };
}
function checkSku(state, next) {
  if (next.sku !== null && Object.values(state.items).some(item => item.id !== next.id && item.sku === next.sku)) throw new ConflictException('SKU already registered.');
}
function canonicalPlan(input) {
  const combined = new Map();
  for (const part of stockPlanSchema.parse(input)) combined.set(part.stockItemId, (combined.get(part.stockItemId) ?? 0) + part.quantity);
  return stockPlanSchema.parse([...combined].sort(([a], [b]) => a.localeCompare(b)).map(([stockItemId, quantity]) => ({ stockItemId, quantity })));
}

/** All stock balances and reservation fences commit in a single Mongo CAS document. */
export class StockRepository {
  constructor(store, { aggregateId = 'stock:warehouse' } = {}) { Object.assign(this, { store, aggregateId }); }
  restore(data) {
    const item = new StockItem({ ...data, createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt) });
    Object.defineProperty(item, revision, { value: data.revision });
    return item;
  }
  async create(item) {
    const next = recordOf(item);
    await this.store.transact(this.aggregateId, randomUUID(), fingerprint(next), async data => {
      const state = structuredClone(data ?? initial());
      if (own(state.items, next.id)) throw new ConflictException('Stock item ID already registered.');
      checkSku(state, next); state.items[next.id] = { ...next, reserved: 0, revision: 0 };
      return { data: state };
    });
  }
  async findById(id) { const item = own((await this.store.get(this.aggregateId))?.items ?? {}, id); return item ? this.restore(item) : null; }
  async findBySku(sku) { const item = Object.values((await this.store.get(this.aggregateId))?.items ?? {}).find(value => value.sku === sku); return item ? this.restore(item) : null; }
  async findAll(onlyActive = false) { return Object.values((await this.store.get(this.aggregateId))?.items ?? {}).filter(item => !onlyActive || item.isActive).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(item => this.restore(item)); }
  async update(item) {
    const next = recordOf(item), expected = item[revision];
    await this.store.transact(this.aggregateId, randomUUID(), fingerprint(next), async data => {
      const state = structuredClone(data ?? initial()), current = own(state.items, item.id);
      if (!current) throw new NotFoundException('Stock item not found.');
      if (current.revision !== expected) throw new ConflictException('Stock item changed; reload before updating.');
      if (next.quantity < current.reserved) throw new ConflictException('Quantity cannot be lower than reserved stock.');
      checkSku(state, next);
      state.items[item.id] = { ...next, reserved: current.reserved, revision: current.revision + 1 };
      return { data: state };
    });
  }
  async importLegacy(items, { commit = false } = {}) {
    const records = items.map(item => recordOf(new StockItem({ ...item, createdAt: new Date(item.createdAt), updatedAt: new Date(item.updatedAt) })));
    const digest = fingerprint(records);
    const merge = data => {
      const state = structuredClone(data ?? initial());
      for (const record of records) {
        const current = own(state.items, record.id);
        if (current) {
          const { reserved: held, revision: version, ...persisted } = current;
          if (held || !isDeepStrictEqual(record, persisted)) throw new ConflictException('Legacy stock conflicts with target: ' + record.id);
          if (!Number.isInteger(version)) throw new ConflictException('Invalid stock revision');
        } else {
          checkSku(state, record);
          state.items[record.id] = { ...record, reserved: 0, revision: 0 };
        }
      }
      return state;
    };
    if (!commit) merge(await this.store.get(this.aggregateId));
    else await this.store.transact(this.aggregateId, randomUUID(), digest, async data => ({ data: merge(data) }));
    return { validated: records.length, committed: commit };
  }
  async availability(id) {
    const item = own((await this.store.get(this.aggregateId))?.items ?? {}, id);
    if (!item) throw new NotFoundException('Stock item not found.');
    return { id, quantity: item.quantity, reserved: item.reserved, available: item.quantity - item.reserved, isActive: item.isActive };
  }
  async reservation(orderId) { return own((await this.store.get(this.aggregateId))?.reservations ?? {}, orderId) ?? null; }
  async reserve(orderId, input) {
    orderSchema.parse(orderId);
    const plan = canonicalPlan(input), hash = fingerprint(plan);
    const result = await this.store.transact(this.aggregateId, `reserve:${orderId}`, hash, async data => {
      const state = structuredClone(data ?? initial()), previous = own(state.reservations, orderId);
      if (previous?.state === 'RELEASED') throw new ConflictException('Stock reservation was cancelled.');
      if (previous) {
        if (previous.hash !== hash) throw new ConflictException('Reservation plan changed.');
        return { data: state };
      }
      const lines = plan.map(part => {
        const item = own(state.items, part.stockItemId);
        if (!item?.isActive) throw new ConflictException('Stock item is missing or inactive.');
        if (item.quantity - item.reserved < part.quantity) throw new ConflictException('Insufficient available stock.');
        item.reserved += part.quantity; item.revision++; item.updatedAt = timestamp();
        return { ...part, description: item.name.slice(0, 200), unitPriceCents: item.unitPriceCents };
      });
      state.reservations[orderId] = { state: 'RESERVED', hash, lines, updatedAt: timestamp() };
      return { data: state };
    });
    const reservation = own(result.data.reservations, orderId);
    if (reservation.state === 'RELEASED') throw new ConflictException('Stock reservation was cancelled.');
    return reservation;
  }
  async consume(orderId) {
    orderSchema.parse(orderId);
    const result = await this.store.transact(this.aggregateId, `consume:${orderId}`, orderId, async data => {
      const state = structuredClone(data ?? initial()), reservation = own(state.reservations, orderId);
      if (!reservation || reservation.state === 'RELEASED') throw new ConflictException('Active reservation is required.');
      if (reservation.state === 'CONSUMED') return { data: state };
      for (const part of reservation.lines) {
        const item = state.items[part.stockItemId];
        item.quantity -= part.quantity; item.reserved -= part.quantity; item.revision++; item.updatedAt = timestamp();
      }
      reservation.state = 'CONSUMED'; reservation.updatedAt = timestamp();
      return { data: state };
    });
    return own(result.data.reservations, orderId);
  }
  async release(orderId) {
    orderSchema.parse(orderId);
    const result = await this.store.transact(this.aggregateId, `release:${orderId}`, orderId, async data => {
      const state = structuredClone(data ?? initial()), previous = own(state.reservations, orderId);
      if (previous?.state === 'CONSUMED') throw new ConflictException('Consumed stock requires manual intervention.');
      if (previous?.state === 'RESERVED') {
        for (const part of previous.lines) {
          const item = state.items[part.stockItemId];
          item.reserved -= part.quantity; item.revision++; item.updatedAt = timestamp();
        }
      }
      state.reservations[orderId] = { ...previous, state: 'RELEASED', lines: previous?.lines ?? [], updatedAt: timestamp() };
      return { data: state };
    });
    return own(result.data.reservations, orderId);
  }
}

function dto(Type, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid request'), { status: 400 });
  const parsed = plainToInstance(Type, body);
  if (validateSync(parsed, { whitelist: true, forbidNonWhitelisted: true }).length) throw Object.assign(new Error('Invalid request'), { status: 400 });
  return parsed;
}
export function stockRoutes(repository) {
  const create = new CreateStockItemUseCase(repository), get = new GetStockItemUseCase(repository), list = new ListStockItemsUseCase(repository), update = new UpdateStockItemUseCase(repository), remove = new DeleteStockItemUseCase(repository);
  return [
    { method: 'post', path: '/stock-items', roles: ['admin'], status: 201, handle: req => create.execute(dto(CreateStockItemDto, req.body)) },
    { method: 'get', path: '/stock-items', roles: ['admin'], handle: () => list.execute() },
    { method: 'get', path: '/stock-items/:id/availability', roles: ['admin', 'operator'], handle: req => repository.availability(req.params.id) },
    { method: 'get', path: '/stock-items/:id', roles: ['admin'], handle: req => get.execute(req.params.id) },
    { method: 'patch', path: '/stock-items/:id', roles: ['admin'], status: 204, handle: req => update.execute(req.params.id, dto(UpdateStockItemDto, req.body)) },
    { method: 'delete', path: '/stock-items/:id', roles: ['admin'], status: 204, handle: req => remove.execute(req.params.id) },
  ];
}
