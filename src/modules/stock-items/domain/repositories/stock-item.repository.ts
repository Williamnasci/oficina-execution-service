import { StockItem } from '../entities/stock-item.entity.js';

export abstract class StockItemRepository {
  abstract create(stockItem: StockItem): Promise<void>;
  abstract findById(id: string): Promise<StockItem | null>;
  abstract findBySku(sku: string): Promise<StockItem | null>;
  abstract findAll(onlyActive?: boolean): Promise<StockItem[]>;
  abstract update(stockItem: StockItem): Promise<void>;
}
