import { DomainException } from '../../../../shared/domain/errors/domain.exception.js';

export type StockItemProps = {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  quantity?: number;
  unitPrice: number;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export class StockItem {
  public readonly id: string;
  public name: string;
  public description: string | null;
  public sku: string | null;
  public quantity: number;
  public unitPrice: number;
  public isActive: boolean;
  public readonly createdAt: Date;
  public updatedAt: Date;

  constructor(props: StockItemProps) {
    if (!props.name?.trim()) {
      throw new DomainException('Stock item name is required.');
    }

    if (props.unitPrice < 0) {
      throw new DomainException('Unit price cannot be negative.');
    }

    if ((props.quantity ?? 0) < 0) {
      throw new DomainException('Quantity cannot be negative.');
    }

    this.id = props.id;
    this.name = props.name.trim();
    this.description = props.description ?? null;
    this.sku = props.sku ?? null;
    this.quantity = props.quantity ?? 0;
    this.unitPrice = props.unitPrice;
    this.isActive = props.isActive ?? true;
    this.createdAt = props.createdAt ?? new Date();
    this.updatedAt = props.updatedAt ?? new Date();
  }

  public update(data: {
    name?: string;
    description?: string | null;
    sku?: string | null;
    quantity?: number;
    unitPrice?: number;
    isActive?: boolean;
  }): void {
    if (data.name !== undefined) {
      if (!data.name.trim()) {
        throw new DomainException('Stock item name is required.');
      }
      this.name = data.name.trim();
    }

    if (data.description !== undefined) {
      this.description = data.description;
    }

    if (data.sku !== undefined) {
      this.sku = data.sku;
    }

    if (data.quantity !== undefined) {
      if (data.quantity < 0) {
        throw new DomainException('Quantity cannot be negative.');
      }
      this.quantity = data.quantity;
    }

    if (data.unitPrice !== undefined) {
      if (data.unitPrice < 0) {
        throw new DomainException('Unit price cannot be negative.');
      }
      this.unitPrice = data.unitPrice;
    }

    if (data.isActive !== undefined) {
      this.isActive = data.isActive;
    }

    this.updatedAt = new Date();
  }
}
