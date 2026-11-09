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

export class UpdateStockItemDto {
  @ApiProperty({ example: 'Pastilha de freio premium', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'Jogo premium', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ example: 'PF-002', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sku?: string | null;

  @ApiProperty({ example: 15, minimum: 0, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity?: number;

  @ApiProperty({ example: 220.0, minimum: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  unitPrice?: number;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
