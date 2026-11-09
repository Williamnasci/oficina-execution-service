import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateStockItemDto } from '../dto/create-stock-item.dto.js';
import { StockItem } from '../../domain/entities/stock-item.entity.js';
import { StockItemRepository } from '../../domain/repositories/stock-item.repository.js';

@Injectable()
export class CreateStockItemUseCase {
  constructor(
    @Inject(StockItemRepository)
    private readonly stockItemRepository: StockItemRepository,
  ) {}

  async execute(input: CreateStockItemDto): Promise<{ id: string }> {
    const stockItem = new StockItem({
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      sku: input.sku ?? null,
      quantity: input.quantity ?? 0,
      unitPrice: input.unitPrice,
      isActive: input.isActive ?? true,
    });

    await this.stockItemRepository.create(stockItem);

    return { id: stockItem.id };
  }
}
