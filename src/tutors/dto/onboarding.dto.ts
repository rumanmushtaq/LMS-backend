import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsObject,
  IsArray,
} from 'class-validator';

export class ContractOnboardingDto {
  @ApiProperty({ description: 'Is the teacher from US?' })
  @IsBoolean()
  isUSPerson: boolean;

  @ApiProperty({ description: 'URL of the uploaded signature image' })
  @IsString()
  @IsNotEmpty()
  contractSignatureUrl: string;
}

export class TaxFormOnboardingDto {
  @ApiProperty({ description: 'URL of the uploaded tax form' })
  @IsString()
  @IsNotEmpty()
  taxFormUrl: string;
}

export class KycOnboardingDto {
  @ApiProperty({ description: 'First name (if updated)' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ description: 'Last name (if updated)' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ description: 'KYC and Profile data' })
  @IsObject()
  kycData: {
    // Step 1: Personal
    country: string;
    timezone: string;
    nativeLanguage: string;
    spokenLanguages: string[];
    additionalLanguages?: string[];

    // Step 2: Technical
    category: string;
    experience: string;
    education: string;
    certifications?: string[];

    // Step 3: Media
    aboutMe: string;
    photoUrl: string;
    introVideoUrl: string;

    // Step 4: Pricing
    lessonTimezone: string;
    pricePerHour: number;
    availabilityDays: string[];

    // Step 5: Identity
    idType: string;
    idNumber: string;
    idFrontUrl: string;
    idBackUrl: string;
    selfieUrl: string;

    // Step 6: Payment Details (New)
    bankAccount?: {
      bankName: string;
      accountNumber: string;
      routingNumber: string;
      accountHolderName: string;
    };
  };

  @ApiProperty({
    description: 'List of all uploaded document URLs for quick access',
  })
  @IsArray()
  @IsString({ each: true })
  kycDocuments: string[];
}
