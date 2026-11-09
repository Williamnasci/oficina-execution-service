import { StockItem } from '../../../../../../src/modules/stock-items/domain/entities/stock-item.entity.js';
import { DomainException } from '../../../../../../src/shared/domain/errors/domain.exception.js';

describe('StockItem Entity', () => {
  it('should create a valid stock item', () => {
    const item = new StockItem({
      id: '1',
      name: 'Oil',
      unitPrice: 10,
      quantity: 5,
    });
    expect(item.name).toBe('Oil');
    expect(item.quantity).toBe(5);
    expect(item.unitPrice).toBe(10);
    expect(item.isActive).toBe(true);
  });

  it('should throw error if name is empty', () => {
    expect(() => new StockItem({ id: '1', name: '  ', unitPrice: 10 })).toThrow(
      DomainException,
    );
  });

  it('should throw error if unitPrice is negative', () => {
    expect(
      () => new StockItem({ id: '1', name: 'Oil', unitPrice: -5 }),
    ).toThrow(DomainException);
  });

  it('should throw error if quantity is negative', () => {
    expect(
      () =>
        new StockItem({ id: '1', name: 'Oil', unitPrice: 10, quantity: -1 }),
    ).toThrow(DomainException);
  });

  it('should update stock item', () => {
    const item = new StockItem({ id: '1', name: 'Oil', unitPrice: 10 });
    item.update({
      name: 'Synthetic Oil',
      description: 'Better oil',
      sku: 'OL-123',
      quantity: 20,
      unitPrice: 15,
      isActive: false,
    });

    expect(item.name).toBe('Synthetic Oil');
    expect(item.description).toBe('Better oil');
    expect(item.sku).toBe('OL-123');
    expect(item.quantity).toBe(20);
    expect(item.unitPrice).toBe(15);
    expect(item.isActive).toBe(false);
  });

  it('should throw error when updating name to empty', () => {
    const item = new StockItem({ id: '1', name: 'Oil', unitPrice: 10 });
    expect(() => item.update({ name: '  ' })).toThrow(DomainException);
  });

  it('should throw error when updating quantity to negative', () => {
    const item = new StockItem({ id: '1', name: 'Oil', unitPrice: 10 });
    expect(() => item.update({ quantity: -1 })).toThrow(DomainException);
  });

  it('should throw error when updating unitPrice to negative', () => {
    const item = new StockItem({ id: '1', name: 'Oil', unitPrice: 10 });
    expect(() => item.update({ unitPrice: -10 })).toThrow(DomainException);
  });
});
