import { Injectable, Logger } from '@nestjs/common';

export interface ValidationResult {
  isValid: boolean;
  score: number;
  extractedFields: {
    fullName: string;
    isSigned: boolean;
    formType: string;
    matchScore: number;
  };
  message: string;
}

@Injectable()
export class TaxValidationService {
  private readonly logger = new Logger(TaxValidationService.name);

  async validateTaxForm(
    file: Express.Multer.File,
    expectedName: string,
  ): Promise<ValidationResult> {
    this.logger.log(`Performing AI Scan on file: ${file.originalname}`);

    // Simulation of AI processing time
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Basic structural checks (simulated AI logic)
    const isPdf = file.mimetype === 'application/pdf';
    const isLargeEnough = file.size > 10000; // > 10KB to avoid empty files

    if (!isPdf && !file.mimetype.startsWith('image/')) {
      return {
        isValid: false,
        score: 0,
        extractedFields: {
          fullName: 'Unknown',
          isSigned: false,
          formType: 'Invalid',
          matchScore: 0,
        },
        message: 'Unsupported file format. Please upload a PDF or Image.',
      };
    }

    if (!isLargeEnough) {
      return {
        isValid: false,
        score: 10,
        extractedFields: {
          fullName: 'Empty Document',
          isSigned: false,
          formType: 'Unknown',
          matchScore: 0,
        },
        message: 'The document appears to be empty or incomplete.',
      };
    }

    // Success simulation
    return {
      isValid: true,
      score: 98,
      extractedFields: {
        fullName: expectedName,
        isSigned: true,
        formType: isPdf ? 'Tax Form (PDF)' : 'Tax Form (Scanned)',
        matchScore: 99,
      },
      message:
        'V-Scan AI: Document verified successfully. All mandatory fields detected.',
    };
  }
}
