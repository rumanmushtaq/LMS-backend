import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Men', description: 'Category title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Category image file',
  })
  @IsOptional()
  image?: any;

  @ApiProperty({ example: true, description: 'Is category active' })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @ApiProperty({
    example: 'Men',
    description: 'Category title',
    required: false,
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'Category image file',
    required: false,
  })
  @IsOptional()
  image?: any;

  @ApiProperty({
    example: true,
    description: 'Is category active',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
