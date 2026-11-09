import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockItemRepository } from '../../domain/repositories/stock-item.repository.js';
import { StockItemResponseDto } from '../dto/stock-item-response.dto.js';

@Injectable()
export class GetStockItemUseCase {
  constructor(
    @Inject(StockItemRepository)
    private readonly stockItemRepository: StockItemRepository,
  ) {}

  async execute(id: string): Promise<StockItemResponseDto> {
    const stockItem = await this.stockItemRepository.findById(id);

    if (!stockItem) {
      throw new NotFoundException('Stock item not found.');
    }

    return {
      id: stockItem.id,
      name: stockItem.name,
      description: stockItem.description,
      sku: stockItem.sku,
      quantity: stockItem.quantity,
      unitPrice: stockItem.unitPrice,
      isActive: stockItem.isActive,
      createdAt: stockItem.createdAt,
      updatedAt: stockItem.updatedAt,
    };
  }
}
