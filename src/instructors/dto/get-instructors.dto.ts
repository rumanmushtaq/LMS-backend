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
} from 'class-validator';

export enum InstructorSortBy {
  NEWLY_PUBLISHED = 'newlyPublished',
  RATING = 'rating',
  STUDENTS = 'students',
  NAME_ASC = 'nameAsc',
  NAME_DESC = 'nameDesc',
}

export enum InstructorLevel {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  EXPERT = 'expert',
}

export class GetInstructorsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 9;

  @ApiPropertyOptional({ description: 'Search by name or title' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by category',
    example: 'Backend',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Filter by level',
    enum: InstructorLevel,
  })
  @IsOptional()
  @IsEnum(InstructorLevel)
  level?: InstructorLevel;

  @ApiPropertyOptional({
    description: 'Filter by specific instructor IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  instructorIds?: string[];

  @ApiPropertyOptional({
    description: 'Minimum price filter',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @ApiPropertyOptional({
    description: 'Maximum price filter',
    example: 1000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMax?: number;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: InstructorSortBy,
    default: InstructorSortBy.NEWLY_PUBLISHED,
  })
  @IsOptional()
  @IsEnum(InstructorSortBy)
  sortBy?: InstructorSortBy = InstructorSortBy.NEWLY_PUBLISHED;
}
