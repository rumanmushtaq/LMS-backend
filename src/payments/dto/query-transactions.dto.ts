import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { PaymentStatus } from '../schemas/payment.schema';
import { RevenueArea } from '../schemas/platform-settings.schema';

export class QueryTransactionsDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: RevenueArea })
  @IsOptional()
  @IsEnum(RevenueArea)
  area?: RevenueArea;

  @ApiPropertyOptional({ description: 'Provider id, e.g. stripe or pse' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Search buyer email/name or providerRef' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive lower bound on createdAt' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date, inclusive upper bound on createdAt' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

export class RefundTransactionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Partial refund amount in minor units; omit for a full refund',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;
}
