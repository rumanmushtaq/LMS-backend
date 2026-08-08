import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsUrl,
  Matches,
  IsDateString,
  IsArray,
  IsNumber,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The nested shapes below have to be real classes, not inline object types.
 *
 * The global ValidationPipe runs with `whitelist` and `enableImplicitConversion`.
 * A property typed as an inline `{ ... }[]` carries no per-property metadata, so
 * every element was whitelisted down to nothing — `education` and `experience`
 * returned 200 and then stored `[[], []]`. Declaring the elements makes the
 * pipe keep (and validate) their fields.
 */
export class EducationEntryDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  degree?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  institution?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  period?: string;
}

export class ExperienceEntryDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  role?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  company?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  period?: string;
}

export class AvailabilitySlotDto {
  @IsString()
  @IsOptional()
  @MaxLength(20)
  day?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  startTime?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  endTime?: string;
}

export class BankAccountDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  bankName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  accountNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  routingNumber?: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  accountHolderName?: string;
}

export class SocialLinksDto {
  @IsString()
  @IsOptional()
  @MaxLength(300)
  facebook?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  instagram?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  twitter?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  youtube?: string;

  @IsString()
  @IsOptional()
  @MaxLength(300)
  linkedin?: string;
}

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
    example: '+1 (212) 555-1234',
    description: 'User phone number',
  })
  @IsString()
  @IsOptional()
  // Strict E.164 rejected everything a person actually types — spaces, dashes,
  // parentheses, a leading zero — and rejected '' so the number could never be
  // cleared. Accept the punctuation people use and normalise on save instead.
  @Matches(/^$|^[+(]?\d[\d\s().-]{4,19}$/, {
    message:
      'Please provide a valid phone number (digits, spaces, dashes and brackets are allowed)',
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
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount?: BankAccountDto;

  @ApiPropertyOptional({
    description: 'Education history',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        degree: { type: 'string' },
        institution: { type: 'string' },
        period: { type: 'string' },
      },
    },
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationEntryDto)
  education?: EducationEntryDto[];

  @ApiPropertyOptional({
    description: 'Work experience',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        company: { type: 'string' },
        period: { type: 'string' },
      },
    },
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExperienceEntryDto)
  experience?: ExperienceEntryDto[];

  // ───────────────────────────────────────────────────────────────────────
  // Tutor profile fields
  //
  // The profile page renders all of these, but none were declared here — and
  // because the global ValidationPipe runs with `forbidNonWhitelisted`, sending
  // any of them failed the whole request with "property X should not exist".
  // That is why edits appeared to do nothing.
  // ───────────────────────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: 'Senior Mathematics Tutor' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ example: '12 Example Street, New York' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ example: 'United States' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  country?: string;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ example: 'Mathematics' })
  @IsString()
  @IsOptional()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({
    example: 'Expert',
    description: 'Teaching experience level. Distinct from the experience array.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  level?: string;

  @ApiPropertyOptional({ example: ['Algebra', 'Calculus'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specialties?: string[];

  @ApiPropertyOptional({ example: ['English', 'Spanish'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  spokenLanguages?: string[];

  @ApiPropertyOptional({ example: 'English' })
  @IsString()
  @IsOptional()
  @MaxLength(60)
  nativeLanguage?: string;

  @ApiPropertyOptional({ example: ['CELTA', 'PGCE'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  certifications?: string[];

  @ApiPropertyOptional({ example: 45, description: 'Hourly rate in USD' })
  @IsNumber()
  @Min(0)
  @Max(10000)
  @IsOptional()
  pricePerHour?: number;

  @ApiPropertyOptional({
    description: 'Weekly availability slots',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        day: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
      },
    },
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability?: AvailabilitySlotDto[];

  @ApiPropertyOptional({
    description: 'Social profile links',
    type: 'object',
    properties: {
      facebook: { type: 'string' },
      instagram: { type: 'string' },
      twitter: { type: 'string' },
      youtube: { type: 'string' },
      linkedin: { type: 'string' },
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  social?: SocialLinksDto;
}
