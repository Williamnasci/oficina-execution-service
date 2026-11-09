import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockItemRepository } from '../../domain/repositories/stock-item.repository.js';
import { UpdateStockItemDto } from '../dto/update-stock-item.dto.js';

@Injectable()
export class UpdateStockItemUseCase {
  constructor(
    @Inject(StockItemRepository)
    private readonly stockItemRepository: StockItemRepository,
  ) {}

  async execute(id: string, input: UpdateStockItemDto): Promise<void> {
    const stockItem = await this.stockItemRepository.findById(id);

    if (!stockItem) {
      throw new NotFoundException('Stock item not found.');
    }

    stockItem.update({
      name: input.name,
      description: input.description,
      sku: input.sku,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      isActive: input.isActive,
    });

    await this.stockItemRepository.update(stockItem);
  }
}
