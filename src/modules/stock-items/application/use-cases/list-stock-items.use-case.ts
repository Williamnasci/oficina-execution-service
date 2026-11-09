import { Inject, Injectable } from '@nestjs/common';
import { StockItemRepository } from '../../domain/repositories/stock-item.repository.js';
import { StockItemResponseDto } from '../dto/stock-item-response.dto.js';

@Injectable()
export class ListStockItemsUseCase {
  constructor(
    @Inject(StockItemRepository)
    private readonly stockItemRepository: StockItemRepository,
  ) {}

  async execute(): Promise<StockItemResponseDto[]> {
    const items = await this.stockItemRepository.findAll();

    return items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }
}
