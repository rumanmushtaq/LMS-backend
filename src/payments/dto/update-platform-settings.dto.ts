import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
  Length,
} from 'class-validator';
import { RevenueArea } from '../schemas/platform-settings.schema';

/**
 * Nested classes are required, not inline object types: the global
 * ValidationPipe runs with `whitelist`, which strips the properties of any
 * nested shape it has no metadata for.
 */
export class AreaCommissionDto {
  @ApiPropertyOptional({ enum: RevenueArea })
  @IsEnum(RevenueArea)
  area: RevenueArea;

  @ApiPropertyOptional({ example: 15 })
  @IsNumber()
  @Min(0)
  @Max(100)
  percent: number;
}

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ description: 'Rate used when an area has none set' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultCommissionPercent?: number;

  @ApiPropertyOptional({ type: [AreaCommissionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AreaCommissionDto)
  commissions?: AreaCommissionDto[];

  @ApiPropertyOptional({ example: 'COP' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ example: ['stripe', 'pse'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledProviders?: string[];
}
