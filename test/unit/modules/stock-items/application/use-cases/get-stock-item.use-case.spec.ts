import { jest } from '@jest/globals';
import { GetStockItemUseCase } from '../../../../../../src/modules/stock-items/application/use-cases/get-stock-item.use-case.js';
import { StockItemRepository } from '../../../../../../src/modules/stock-items/domain/repositories/stock-item.repository.js';
import { NotFoundException } from '@nestjs/common';

describe('GetStockItemUseCase', () => {
  let useCase: GetStockItemUseCase;
  let repository: jest.Mocked<StockItemRepository>;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
    } as any;
    useCase = new GetStockItemUseCase(repository);
  });

  it('should return item', async () => {
    repository.findById.mockResolvedValue({
      id: '1',
      name: 'Item',
      quantity: 1,
    } as any);
    const result = await useCase.execute('1');
    expect(result.id).toBe('1');
  });

  it('should throw if not found', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(useCase.execute('1')).rejects.toThrow(NotFoundException);
  });
});
