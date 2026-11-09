import { jest } from '@jest/globals';
import { UpdateStockItemUseCase } from '../../../../../../src/modules/stock-items/application/use-cases/update-stock-item.use-case.js';
import { StockItemRepository } from '../../../../../../src/modules/stock-items/domain/repositories/stock-item.repository.js';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('UpdateStockItemUseCase', () => {
  let useCase: UpdateStockItemUseCase;
  let repository: jest.Mocked<StockItemRepository>;
  let entity: any;

  beforeEach(() => {
    entity = { update: jest.fn() };
    repository = {
      findById: jest.fn().mockResolvedValue(entity),
      findBySku: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    } as any;
    useCase = new UpdateStockItemUseCase(repository);
  });

  it('should update item', async () => {
    await useCase.execute('1', { name: 'A' });
    expect(entity.update).toHaveBeenCalledWith({ name: 'A' });
    expect(repository.update).toHaveBeenCalledWith(entity);
  });

  it('should throw if item not found', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(useCase.execute('1', { name: 'A' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
