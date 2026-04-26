import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHeroBannerDto {
  @ApiProperty({
    description: 'Subtitle of the hero banner',
    default: 'The Leader in Online Learning',
  })
  @IsNotEmpty()
  @IsString()
  subtitle: string;

  @ApiProperty({
    description: 'Title of the hero banner',
    default: 'Engaging & Accessible Online Courses For All',
  })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Description of the hero banner',
    default:
      'Our specialized online courses are designed to bring the classroom experience to you, no matter where you are.',
  })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Image URL of the hero banner',
    default: '/images/hero-banner.jpg',
  })
  @IsNotEmpty()
  @IsString()
  imageUrl: string;

  @ApiProperty({
    description: 'Trusted text below the description',
    default: 'Trusted by over 15K Users worldwide since 2022',
  })
  @IsNotEmpty()
  @IsString()
  trustedText: string;

  @ApiProperty({
    description: 'Student count shown in the banner',
    default: '1000+',
  })
  @IsNotEmpty()
  @IsString()
  studentCount: string;

  @ApiProperty({
    description: 'Rating shown in the banner',
    default: '4.8',
  })
  @IsNotEmpty()
  @IsString()
  rating: string;
}

export class UpdateHeroBannerDto extends PartialType(CreateHeroBannerDto) {}
