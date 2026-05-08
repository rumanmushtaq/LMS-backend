import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export enum UserRole {
  STUDENT = 'student',
  TUTOR = 'tutor',
  ADMIN = 'admin',
}

export enum UserStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
}

export enum OnboardingStep {
  SIGNED_UP = 'signed_up',
  CONTRACT_ACCEPTED = 'contract_accepted',
  TAX_SELECTED = 'tax_selected',
  TAX_SUBMITTED = 'tax_submitted',
  KYC_COMPLETED = 'kyc_completed',
  COMPLETED = 'completed',
}

export enum TaxFormType {
  W8BEN = 'W8BEN',
  W9 = 'W9',
}

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: true,
  toJSON: {
    transform: (_doc: unknown, ret: Record<string, unknown>) => {
      delete ret.password;
      delete ret.refreshTokenHash;
      delete ret.emailVerificationToken;
      delete ret.emailVerificationTokenExpires;
      delete ret.passwordResetToken;
      delete ret.passwordResetTokenExpires;
      delete ret.twoFactorSecret;
      delete ret.isDeleted;
      delete ret.deletedAt;
      delete ret.__v;
      return ret;
    },
  },
})
export class User extends Document {
  @ApiProperty({ description: 'User email address' })
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @ApiProperty({ description: 'User first name' })
  @Prop({ required: true, trim: true })
  firstName: string;

  @ApiProperty({ description: 'User last name' })
  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ required: true })
  password: string;

  @ApiProperty({ description: 'User role', enum: UserRole })
  @Prop({ required: true, enum: UserRole, default: UserRole.STUDENT })
  role: UserRole;

  @ApiProperty({ description: 'User account status', enum: UserStatus })
  @Prop({ required: true, enum: UserStatus, default: UserStatus.PENDING })
  status: UserStatus;

  @ApiProperty({ description: 'Whether email is verified' })
  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ type: String, default: null })
  emailVerificationToken: string | null;

  @Prop({ type: Date, default: null })
  emailVerificationTokenExpires: Date | null;

  @Prop({ type: String, default: null })
  passwordResetToken: string | null;

  @Prop({ type: Date, default: null })
  passwordResetTokenExpires: Date | null;

  @ApiProperty({ description: 'Whether 2FA is enabled' })
  @Prop({ default: false })
  twoFactorEnabled: boolean;

  @Prop({ type: String, default: null })
  twoFactorSecret: string | null;

  @Prop({ type: String, default: null })
  refreshTokenHash: string | null;

  // =====================
  // ONBOARDING FIELDS
  // =====================

  @ApiProperty({ description: 'Current onboarding step', enum: OnboardingStep })
  @Prop({
    type: String,
    enum: OnboardingStep,
    default: OnboardingStep.SIGNED_UP,
  })
  onboardingStep: OnboardingStep;

  @ApiProperty({ description: 'Timestamp when contract was accepted' })
  @Prop({ type: Date, default: null })
  contractAcceptedAt: Date | null;

  @ApiProperty({ description: 'Whether the tutor is a US person' })
  @Prop({ type: Boolean, default: null })
  isUSPerson: boolean | null;

  @ApiProperty({ description: 'Tax form type', enum: TaxFormType })
  @Prop({ type: String, enum: TaxFormType, default: null })
  taxFormType: TaxFormType | null;

  @ApiProperty({ description: 'URL of the uploaded tax form' })
  @Prop({ type: String, default: null })
  taxFormUrl: string | null;

  @ApiProperty({ description: 'URL of the signed contract' })
  @Prop({ type: String, default: null })
  contractSignatureUrl: string | null;

  @ApiProperty({ description: 'List of KYC document URLs' })
  @Prop({ type: [String], default: [] })
  kycDocuments: string[];

  @ApiProperty({ description: 'KYC and profile data' })
  @Prop({ type: Object, default: {} })
  kycData: Record<string, any>;

  @ApiProperty({ description: 'Last login timestamp' })
  @Prop({ type: Date, default: null })
  lastLogin: Date | null;

  @ApiProperty({ description: 'Whether the user is soft-deleted' })
  @Prop({ default: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Timestamp when the user was soft-deleted' })
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @ApiProperty({ description: 'Account creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Account last update timestamp' })
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes for better query performance
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ status: 1 });
UserSchema.index({ isDeleted: 1 });
UserSchema.index({ emailVerified: 1 });
UserSchema.index({ createdAt: -1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: User) {
  return `${this.firstName} ${this.lastName}`;
});
