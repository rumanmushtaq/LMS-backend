import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MinLength,
  MaxLength,
  IsEnum,
  IsBoolean,
  IsDateString,
  Matches,
  ValidateIf,
} from 'class-validator';

export enum FederalTaxClassification {
  INDIVIDUAL = 'individual',
  LLC = 'llc',
  CORPORATION = 'corporation',
  S_CORPORATION = 's_corporation',
  PARTNERSHIP = 'partnership',
  TRUST_ESTATE = 'trust_estate',
  OTHER = 'other',
}

export enum TinType {
  SSN = 'SSN',
  EIN = 'EIN',
}

export class CreateW9FormDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full legal name as shown on tax return',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @ApiPropertyOptional({
    example: 'Doe Solutions LLC',
    description: 'Business name (if different from full name)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  businessName?: string;

  @ApiProperty({
    enum: FederalTaxClassification,
    example: FederalTaxClassification.INDIVIDUAL,
    description: 'Federal tax classification',
  })
  @IsEnum(FederalTaxClassification)
  federalTaxClassification: FederalTaxClassification;

  @ApiPropertyOptional({
    example: 'Exempt payee code 1',
    description: 'Exemption codes (if any)',
  })
  @IsOptional()
  @IsString()
  exemptions?: string;

  @ApiProperty({
    example: '123 Main Street',
    description: 'Street address',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  address: string;

  @ApiProperty({
    example: 'New York',
    description: 'City name',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiProperty({
    example: 'NY',
    description: 'State abbreviation',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  state: string;

  @ApiProperty({
    example: '10001',
    description: 'ZIP or postal code',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  zipCode: string;

  @ApiProperty({
    example: 'US',
    description: 'Country (usually US)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @ApiProperty({
    enum: TinType,
    example: TinType.SSN,
    description: 'Tax Identification Number type',
  })
  @IsEnum(TinType)
  tinType: TinType;

  @ApiProperty({
    example: '123-45-6789',
    description: 'SSN or EIN number',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9-]+$/, {
    message: 'TIN must contain only numbers and hyphens',
  })
  tinNumber: string;

  @ApiProperty({
    example: true,
    description: 'Certification agreement confirmation',
  })
  @IsBoolean()
  certification: boolean;

  @ApiProperty({
    example: 'John Doe',
    description: 'Typed name as signature',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    example: '2026-02-27',
    description: 'Date when the form was signed',
  })
  @IsDateString()
  signedAt: string;
}

export class CreateW8BENFormDto {
  @ApiProperty({
    example: 'Juan Carlos',
    description: 'Full legal name of the individual',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({
    example: 'Spain',
    description: 'Country of citizenship',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  countryOfCitizenship: string;

  @ApiProperty({
    example: '123 Foreign Street, Madrid, Spain',
    description: 'Permanent residence address (outside the US)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  permanentResidenceAddress: string;

  @ApiPropertyOptional({
    example: 'PO Box 456, Madrid, Spain',
    description: 'Mailing address (if different from permanent address)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(250)
  mailingAddress?: string;

  @ApiProperty({
    example: 'FTIN-123456789',
    description: 'Foreign Tax Identifying Number (FTIN)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  foreignTaxIdentifyingNumber: string;

  @ApiPropertyOptional({
    example: '123-45-6789',
    description: 'U.S. Tax Identification Number (if available)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9-]+$/, {
    message: 'US TIN must contain only numbers and hyphens',
  })
  usTin?: string;

  @ApiProperty({
    example: '1990-05-15',
    description: 'Date of birth (YYYY-MM-DD)',
  })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({
    example: true,
    description: 'Indicates if treaty benefits are being claimed',
  })
  @IsBoolean()
  treatyClaim: boolean;

  // ===== Treaty Claim Conditional Fields =====

  @ApiPropertyOptional({
    example: 'Spain',
    description: 'Treaty country (required if claiming treaty benefits)',
  })
  @ValidateIf((o) => o.treatyClaim === true)
  @IsString()
  @IsNotEmpty()
  treatyCountry?: string;

  @ApiPropertyOptional({
    example: 'Article 12',
    description: 'Treaty article number (required if claiming treaty benefits)',
  })
  @ValidateIf((o) => o.treatyClaim === true)
  @IsString()
  @IsNotEmpty()
  treatyArticle?: string;

  @ApiPropertyOptional({
    example: '10%',
    description: 'Withholding rate under treaty (required if claiming)',
  })
  @ValidateIf((o) => o.treatyClaim === true)
  @IsString()
  @IsNotEmpty()
  withholdingRate?: string;

  @ApiProperty({
    example: true,
    description: 'Certification agreement confirmation',
  })
  @IsBoolean()
  certification: boolean;

  @ApiProperty({
    example: 'Juan Carlos',
    description: 'Typed name as signature',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    example: '2026-02-27',
    description: 'Date when the form was signed',
  })
  @IsDateString()
  signedAt: string;
}

export class UpdateW9FormDto extends PartialType(CreateW9FormDto) {}
export class UpdateW8BENFormDto extends PartialType(CreateW8BENFormDto) {}
