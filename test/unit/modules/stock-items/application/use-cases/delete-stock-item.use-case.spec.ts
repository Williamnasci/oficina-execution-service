import { jest } from '@jest/globals';
import { DeleteStockItemUseCase } from '../../../../../../src/modules/stock-items/application/use-cases/delete-stock-item.use-case.js';
import { StockItemRepository } from '../../../../../../src/modules/stock-items/domain/repositories/stock-item.repository.js';
import { NotFoundException } from '@nestjs/common';

describe('DeleteStockItemUseCase', () => {
  let useCase: DeleteStockItemUseCase;
  let repository: jest.Mocked<StockItemRepository>;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAll: jest.fn(),
      findById: jest.fn(),
      findBySku: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;
    useCase = new DeleteStockItemUseCase(repository);
  });

  it('should delete stock item', async () => {
    repository.findById.mockResolvedValue({
      id: '1',
      isActive: true,
      update: jest.fn(),
    } as any);
    await useCase.execute('1');
    expect(repository.update).toHaveBeenCalled();
  });

  it('should throw if not found', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(useCase.execute('1')).rejects.toThrow(NotFoundException);
  });
});
