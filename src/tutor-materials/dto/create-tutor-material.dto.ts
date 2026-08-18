import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  Min,
  IsUrl,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class CreateTutorMaterialDto {
  @ApiProperty({ description: 'Title of the material (book, notes, PDF)' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'Detailed description of the material' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Price in USD cents' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ description: 'URL to the actual file (PDF, etc.)' })
  @IsNotEmpty()
  @IsString()
  fileUrl: string;

  @ApiPropertyOptional({ description: 'URL to the cover image' })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiPropertyOptional({
    description: 'Whether the material is active/visible',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
