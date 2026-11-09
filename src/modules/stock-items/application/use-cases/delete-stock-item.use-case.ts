import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { StockItemRepository } from '../../domain/repositories/stock-item.repository.js';

@Injectable()
export class DeleteStockItemUseCase {
  constructor(
    @Inject(StockItemRepository)
    private readonly stockItemRepository: StockItemRepository,
  ) {}

  async execute(id: string): Promise<void> {
    const stockItem = await this.stockItemRepository.findById(id);

    if (!stockItem) {
      throw new NotFoundException('Stock item not found.');
    }

    stockItem.update({
      isActive: false,
    });

    await this.stockItemRepository.update(stockItem);
  }
}
