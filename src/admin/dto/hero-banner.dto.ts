import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHeroBannerDto {
  @ApiProperty({
    description: 'Video URL of the hero banner',
  })
  @IsNotEmpty()
  @IsString()
  videoUrl: string;

  @ApiProperty({
    description: 'Active status of the hero banner',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHeroBannerDto extends PartialType(CreateHeroBannerDto) {}
