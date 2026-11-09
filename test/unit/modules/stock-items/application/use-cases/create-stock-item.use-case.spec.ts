import { jest } from '@jest/globals';
import { CreateStockItemUseCase } from '../../../../../../src/modules/stock-items/application/use-cases/create-stock-item.use-case.js';
import { StockItemRepository } from '../../../../../../src/modules/stock-items/domain/repositories/stock-item.repository.js';

describe('CreateStockItemUseCase', () => {
  let useCase: CreateStockItemUseCase;
  let repository: jest.Mocked<StockItemRepository>;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySku: jest.fn(),
      findAll: jest.fn(),
      update: jest.fn(),
    };

    useCase = new CreateStockItemUseCase(repository);
  });

  it('should create a stock item and return its id', async () => {
    const result = await useCase.execute({
      name: 'Filtro de óleo',
      description: 'Filtro do motor',
      sku: 'FO-001',
      quantity: 10,
      unitPrice: 35.5,
      isActive: true,
    });

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBeDefined();
  });
});
