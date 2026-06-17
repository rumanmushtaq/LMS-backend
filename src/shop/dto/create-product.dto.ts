import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({
    description: 'Product title',
    example: 'Classic Blue T-Shirt',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'HTML description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Price in USD', example: 22.99 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  price: number;

  @ApiPropertyOptional({
    description: 'Available sizes',
    example: ['S', 'M', 'L', 'XL'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sizes?: string[];

  @ApiPropertyOptional({
    description: 'Array of ImageKit image URLs',
    example: ['https://ik.imagekit.io/...'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @ApiPropertyOptional({
    description: 'Whether product is active',
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
