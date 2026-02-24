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


  @ApiProperty({ description: 'Last login timestamp' })
  @Prop({ type: Date, default: null })
  lastLogin: Date | null;

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
UserSchema.index({ emailVerified: 1 });
UserSchema.index({ createdAt: -1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: User) {
  return `${this.firstName} ${this.lastName}`;
});

