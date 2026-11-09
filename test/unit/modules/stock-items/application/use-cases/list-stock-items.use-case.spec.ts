import { jest } from '@jest/globals';
import { ListStockItemsUseCase } from '../../../../../../src/modules/stock-items/application/use-cases/list-stock-items.use-case.js';
import { StockItemRepository } from '../../../../../../src/modules/stock-items/domain/repositories/stock-item.repository.js';

describe('ListStockItemsUseCase', () => {
  let useCase: ListStockItemsUseCase;
  let repository: jest.Mocked<StockItemRepository>;

  beforeEach(() => {
    repository = {
      findAll: jest.fn(),
    } as any;
    useCase = new ListStockItemsUseCase(repository);
  });

  it('should list items', async () => {
    repository.findAll.mockResolvedValue([
      { id: '1', name: 'Item', quantity: 1 } as any,
    ]);
    const result = await useCase.execute();
    expect(result.length).toBe(1);
  });
});
