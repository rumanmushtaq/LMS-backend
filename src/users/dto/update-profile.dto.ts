import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsUrl,
  Matches,
  IsDateString,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'John',
    description: 'User first name',
  })
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  @MaxLength(50, { message: 'First name must be at most 50 characters' })
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Doe',
    description: 'User last name',
  })
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'Last name must be at least 2 characters' })
  @MaxLength(50, { message: 'Last name must be at most 50 characters' })
  lastName?: string;

  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'User phone number',
  })
  @IsString()
  @IsOptional()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Please provide a valid phone number',
  })
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: 'Profile picture URL',
  })
  @IsUrl({}, { message: 'Please provide a valid URL' })
  @IsOptional()
  profilePicture?: string;

  @ApiPropertyOptional({
    example: 'Experienced math tutor with 5 years of teaching experience.',
    description: 'User bio',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Bio must be at most 500 characters' })
  bio?: string;

  @ApiPropertyOptional({
    example: 'Male',
    description: 'User gender',
  })
  @IsString()
  @IsOptional()
  gender?: string;

  @ApiPropertyOptional({
    example: '2000-01-16T00:00:00Z',
    description: 'User Date of Birth',
  })
  @IsDateString()
  @IsOptional()
  dob?: string;

  @ApiPropertyOptional({
    description: 'Teacher bank account details',
    type: 'object',
    properties: {
      bankName: { type: 'string' },
      accountNumber: { type: 'string' },
      routingNumber: { type: 'string' },
      accountHolderName: { type: 'string' },
    },
  })
  @IsOptional()
  bankAccount?: {
    bankName: string;
    accountNumber: string;
    routingNumber: string;
    accountHolderName: string;
  };
}
