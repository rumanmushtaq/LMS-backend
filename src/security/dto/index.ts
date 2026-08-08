import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum BlockDuration {
  ONE_HOUR = '1h',
  ONE_DAY = '24h',
  SEVEN_DAYS = '7d',
  PERMANENT = 'permanent',
}

export const BLOCK_DURATION_MS: Record<BlockDuration, number | null> = {
  [BlockDuration.ONE_HOUR]: 3600_000,
  [BlockDuration.ONE_DAY]: 24 * 3600_000,
  [BlockDuration.SEVEN_DAYS]: 7 * 24 * 3600_000,
  [BlockDuration.PERMANENT]: null,
};

export class BlockIpDto {
  @ApiProperty({ example: '203.0.113.7', description: 'IP address or CIDR range' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  ip: string;

  @ApiProperty({ example: 'Credential stuffing against student accounts' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiProperty({ enum: BlockDuration, default: BlockDuration.ONE_DAY })
  @IsEnum(BlockDuration)
  duration: BlockDuration;
}

export class UnblockIpDto {
  @ApiPropertyOptional({ example: 'False positive — school NAT' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AddWhitelistDto {
  @ApiProperty({ example: '198.51.100.4' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  ip: string;

  @ApiProperty({ example: 'Office network' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;
}

export class ListIpsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @ApiPropertyOptional({ description: 'Substring match on the IP' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ default: 24, description: 'Window in hours' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  hours: number = 24;

  @ApiPropertyOptional({ enum: ['lastSeen', 'requests', 'failedLogins'] })
  @IsOptional()
  @IsIn(['lastSeen', 'requests', 'failedLogins'])
  sort: 'lastSeen' | 'requests' | 'failedLogins' = 'lastSeen';
}

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({ description: 'Filter by key or incident (block) id' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;
}
