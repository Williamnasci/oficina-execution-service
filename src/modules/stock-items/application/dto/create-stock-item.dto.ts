import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';

export class CreateStockItemDto {
  @ApiProperty({ example: 'Pastilha de freio' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'Jogo de pastilhas dianteiras',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ example: 'PF-001', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sku?: string | null;

  @ApiProperty({ example: 10, minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity?: number;

  @ApiProperty({ example: 200.0, minimum: 0 })
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  unitPrice: number;

  @ApiProperty({ example: true, default: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
