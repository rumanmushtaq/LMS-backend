import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  User,
  UserDocument,
  OnboardingStep,
  TaxFormType,
} from '@/users/schemas/user.schema';
import {
  ContractOnboardingDto,
  TaxFormOnboardingDto,
  KycOnboardingDto,
} from '../dto/onboarding.dto';
import { EmailService } from '@/email/services/email.service';
import { generateSecureToken, hashToken } from '@/common/utils/crypto.util';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailService: EmailService,
  ) {}

  async submitContract(user: UserDocument, dto: ContractOnboardingDto) {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      {
        contractSignatureUrl: dto.contractSignatureUrl,
        isUSPerson: dto.isUSPerson,
        taxFormType: dto.isUSPerson ? TaxFormType.W9 : TaxFormType.W8BEN,
        contractAcceptedAt: new Date(),
        onboardingStep: OnboardingStep.CONTRACT_ACCEPTED,
      },
      { new: true },
    );
    return updatedUser;
  }

  async submitTaxForm(user: UserDocument, dto: TaxFormOnboardingDto) {
    if (
      user.onboardingStep !== OnboardingStep.CONTRACT_ACCEPTED &&
      user.onboardingStep !== OnboardingStep.TAX_SELECTED
    ) {
      throw new BadRequestException('Please complete the contract step first.');
    }

    const updateData: any = {
      taxFormUrl: dto.taxFormUrl,
      onboardingStep: OnboardingStep.TAX_SUBMITTED,
    };

    if (dto.isUSPerson !== undefined) {
      updateData.isUSPerson = dto.isUSPerson;
      updateData.taxFormType = dto.isUSPerson
        ? TaxFormType.W9
        : TaxFormType.W8BEN;
    }

    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      updateData,
      { new: true },
    );
    return updatedUser;
  }

  async submitKyc(user: UserDocument, dto: KycOnboardingDto) {
    if (user.onboardingStep !== OnboardingStep.TAX_SUBMITTED) {
      throw new BadRequestException('Please complete the tax form step first.');
    }

    // Generate email verification token
    const verificationToken = generateSecureToken(32);
    const hashedVerificationToken = hashToken(verificationToken);

    // Calculate expiration (24 hours)
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    const updatedUser = await this.userModel.findByIdAndUpdate(
      user._id,
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        kycData: dto.kycData,
        kycDocuments: dto.kycDocuments,
        onboardingStep: OnboardingStep.KYC_COMPLETED,
        emailVerificationToken: hashedVerificationToken,
        emailVerificationTokenExpires: verificationExpires,
      },
      { new: true },
    );

    // Send verification email asynchronously
    this.emailService
      .sendVerificationEmail(user.email, user.firstName, verificationToken)
      .catch((err) => {
        console.error(
          `Failed to send verification email to ${user.email} after KYC`,
          err,
        );
      });

    return updatedUser;
  }
}
