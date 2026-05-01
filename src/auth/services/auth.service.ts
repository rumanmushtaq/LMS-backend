import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../../users/schemas/user.schema';
import { EmailService } from '../../email/services/email.service';
import {
  generateSecureToken,
  hashToken,
  verifyToken,
  generateOTP,
} from '../../common/utils/crypto.util';
import {
  SignupDto,
  LoginDto,
  AdminLoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  CreateContactDto,
} from '../dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse {
  user: UserDocument;
  tokens?: TokenPair;
  requires2FA?: boolean;
  sessionToken?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly bcryptSaltRounds: number;
  private readonly twoFactorSessions: Map<
    string,
    { userId: string; otp?: string; expiresAt: Date }
  > = new Map();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.bcryptSaltRounds = this.configService.get<number>(
      'security.bcryptSaltRounds',
    )!;
  }

  // =====================
  // SIGNUP & VERIFICATION
  // =====================

  async signup(signupDto: SignupDto): Promise<any> {
    const { email, firstName, lastName, password, role } = signupDto;

    // Check if user already exists
    const existingUser = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Prevent admin signup through public endpoint
    if ((role as UserRole) === UserRole.ADMIN) {
      throw new BadRequestException('Invalid role');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, this.bcryptSaltRounds);

    // Generate email verification token (even if not sending it immediately for tutors)
    const verificationToken = generateSecureToken(32);
    const hashedVerificationToken = hashToken(verificationToken);

    // Calculate expiration (24 hours)
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    // Create user
    const user = new this.userModel({
      email: email.toLowerCase(),
      firstName,
      lastName,
      password: hashedPassword,
      role,
      status: UserStatus.PENDING,
      emailVerified: false,
      emailVerificationToken: hashedVerificationToken,
      emailVerificationTokenExpires: verificationExpires,
    });

    await user.save();

    this.logger.log(`New user registered: ${email} (${role})`);

    // For tutors, we don't send the email yet and we log them in immediately
    if (role === UserRole.TUTOR) {
      this.logger.log(
        `Tutor detected, generating tokens and returning immediate response for ${email}`,
      );
      const tokens = await this.generateTokens(user);
      user.refreshTokenHash = hashToken(tokens.refreshToken);
      await user.save();

      const response = {
        message: 'Registration successful. Proceed to onboarding.',
        user,
        tokens,
      };
      this.logger.log(
        `Returning tutor signup response: ${JSON.stringify({ ...response, user: user.email, tokens: 'HIDDEN' })}`,
      );
      return response;
    }

    this.logger.log(
      `Student detected, sending verification email for ${email}`,
    );
    // For others (students), send verification email asynchronously
    this.emailService
      .sendVerificationEmail(email, firstName, verificationToken)
      .catch((err) =>
        this.logger.error(`Failed to send verification email to ${email}`, err),
      );

    return {
      message:
        'Registration successful. Please check your email to verify your account.',
    };
  }

  async verifyEmail(token: string): Promise<{
    message: string;
    tokens?: TokenPair | null;
    user?: UserDocument;
  }> {
    const hashedToken = hashToken(token);

    const user = await this.userModel
      .findOne({
        emailVerificationToken: hashedToken,
        emailVerificationTokenExpires: { $gt: new Date() },
      })
      .exec();

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // Update user
    user.emailVerified = true;

    // For students, activate immediately. Tutors stay pending until admin verify.
    if (user.role === UserRole.STUDENT) {
      user.status = UserStatus.ACTIVE;
      await this.emailService.sendWelcomeEmail(user.email, user.firstName);
    }

    user.emailVerificationToken = null;
    user.emailVerificationTokenExpires = null;

    // Generate tokens for immediate onboarding if tutor
    let tokens = null;
    if (user.role === UserRole.TUTOR) {
      tokens = await this.generateTokens(user);
      user.refreshTokenHash = hashToken(tokens.refreshToken);
    }

    await user.save();

    this.logger.log(`Email verified for user: ${user.email}`);

    return {
      message:
        user.role === UserRole.TUTOR
          ? 'Email verified. Please complete the onboarding steps.'
          : 'Email verified successfully. You can now log in.',
      tokens,
      user: user.role === UserRole.TUTOR ? user : undefined,
    };
  }

  async resendVerificationEmail(email: string): Promise<{ message: string }> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();

    if (!user) {
      // Return generic message to prevent email enumeration
      return {
        message: 'If the email exists, a verification link has been sent.',
      };
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    // Generate new verification token
    const verificationToken = generateSecureToken(32);
    const hashedVerificationToken = hashToken(verificationToken);

    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    user.emailVerificationToken = hashedVerificationToken;
    user.emailVerificationTokenExpires = verificationExpires;
    await user.save();

    // Send verification email asynchronously
    this.emailService
      .sendVerificationEmail(user.email, user.firstName, verificationToken)
      .catch((err) =>
        this.logger.error(
          `Failed to resend verification email to ${user.email}`,
          err,
        ),
      );

    return {
      message: 'If the email exists, a verification link has been sent.',
    };
  }

  // =====================
  // LOGIN
  // =====================

  async login(loginDto: LoginDto): Promise<LoginResponse> {
    const { email, password } = loginDto;

    const user = await this.userModel
      .findOne({
        email: email.toLowerCase(),
        role: { $in: [UserRole.STUDENT, UserRole.TUTOR] },
      })
      .exec();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check email verification
    if (!user.emailVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in',
      );
    }

    // Check teacher verification status
    if (user.role === UserRole.TUTOR && user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('You are not login until verified');
    }

    // Check account status
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Your account has been suspended');
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      return this.initiate2FALogin(user);
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Update refresh token hash and last login
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    user.lastLogin = new Date();
    await user.save();

    this.logger.log(`User logged in: ${user.email}`);

    return { user, tokens };
  }

  async adminLogin(loginDto: AdminLoginDto): Promise<LoginResponse> {
    const { email, password } = loginDto;

    const user = await this.userModel
      .findOne({
        email: email.toLowerCase(),
        role: UserRole.ADMIN,
      })
      .exec();

    if (!user) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid admin credentials');
    }

    // Check account status
    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Admin account has been suspended');
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      return this.initiate2FALogin(user);
    }

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Update refresh token hash and last login
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    user.lastLogin = new Date();
    await user.save();

    this.logger.log(`Admin logged in: ${user.email}`);

    return { user, tokens };
  }

  // =====================
  // TOKEN MANAGEMENT
  // =====================

  private async generateTokens(user: UserDocument): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiration'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiration'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  async refreshTokens(
    user: UserDocument,
    oldRefreshToken: string,
  ): Promise<TokenPair> {
    // Verify the old refresh token matches
    if (!user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const isValid = verifyToken(oldRefreshToken, user.refreshTokenHash);
    if (!isValid) {
      // Potential token theft - invalidate all sessions
      user.refreshTokenHash = null;
      await user.save();
      throw new UnauthorizedException(
        'Invalid refresh token - session invalidated',
      );
    }

    // Generate new token pair (rotation)
    const tokens = await this.generateTokens(user);

    // Update refresh token hash
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    await user.save();

    this.logger.log(`Tokens refreshed for user: ${user.email}`);

    return tokens;
  }

  async logout(user: UserDocument): Promise<{ message: string }> {
    user.refreshTokenHash = null;
    await user.save();

    this.logger.log(`User logged out: ${user.email}`);

    return { message: 'Logged out successfully' };
  }

  // =====================
  // PASSWORD MANAGEMENT
  // =====================

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;

    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();

    // Always return success to prevent email enumeration
    const successMessage =
      'If the email exists, a password reset link has been sent.';

    if (!user) {
      return { message: successMessage };
    }

    // Generate reset token
    const resetToken = generateSecureToken(32);
    const hashedResetToken = hashToken(resetToken);

    // Calculate expiration (1 hour)
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1);

    user.passwordResetToken = hashedResetToken;
    user.passwordResetTokenExpires = resetExpires;
    await user.save();

    // Send reset email asynchronously
    this.emailService
      .sendPasswordResetEmail(user.email, user.firstName, resetToken)
      .catch((err) =>
        this.logger.error(
          `Failed to send password reset email to ${user.email}`,
          err,
        ),
      );

    this.logger.log(`Password reset requested for: ${user.email}`);

    return { message: successMessage };
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const { token, newPassword } = resetPasswordDto;
    const hashedToken = hashToken(token);

    const user = await this.userModel
      .findOne({
        passwordResetToken: hashedToken,
        passwordResetTokenExpires: { $gt: new Date() },
      })
      .exec();

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(
      newPassword,
      this.bcryptSaltRounds,
    );

    // Update user
    user.password = hashedPassword;
    user.passwordResetToken = null;
    user.passwordResetTokenExpires = null;
    user.refreshTokenHash = null; // Invalidate all sessions
    await user.save();

    this.logger.log(`Password reset completed for: ${user.email}`);

    return {
      message:
        'Password reset successfully. Please log in with your new password.',
    };
  }

  async changePassword(
    user: UserDocument,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const { currentPassword, newPassword } = changePasswordDto;

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(
      newPassword,
      this.bcryptSaltRounds,
    );

    user.password = hashedPassword;
    user.refreshTokenHash = null; // Invalidate all sessions for security
    await user.save();

    this.logger.log(`Password changed for: ${user.email}`);

    return { message: 'Password changed successfully. Please log in again.' };
  }

  // =====================
  // TWO-FACTOR AUTHENTICATION
  // =====================

  async generate2FASecret(
    user: UserDocument,
  ): Promise<{ secret: string; qrCodeUrl: string }> {
    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    const appName = this.configService.get<string>('security.twoFaAppName')!;
    const secret = authenticator.generateSecret();

    const otpAuthUrl = authenticator.keyuri(user.email, appName, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpAuthUrl);

    // Store secret temporarily (will be saved permanently when verified)
    user.twoFactorSecret = secret;
    await user.save();

    return { secret, qrCodeUrl };
  }

  async enable2FA(
    user: UserDocument,
    totpCode: string,
  ): Promise<{ message: string }> {
    if (user.twoFactorEnabled) {
      throw new BadRequestException('2FA is already enabled');
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException('Please generate 2FA secret first');
    }

    // Verify TOTP code
    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.twoFactorSecret,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    user.twoFactorEnabled = true;
    await user.save();

    this.logger.log(`2FA enabled for: ${user.email}`);

    return { message: '2FA enabled successfully' };
  }

  async disable2FA(
    user: UserDocument,
    password: string,
    totpCode: string,
  ): Promise<{ message: string }> {
    if (!user.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid password');
    }

    // Verify TOTP code
    const isValid = authenticator.verify({
      token: totpCode,
      secret: user.twoFactorSecret!,
    });

    if (!isValid) {
      throw new BadRequestException('Invalid verification code');
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    await user.save();

    this.logger.log(`2FA disabled for: ${user.email}`);

    return { message: '2FA disabled successfully' };
  }

  private async initiate2FALogin(user: UserDocument): Promise<LoginResponse> {
    // Generate temporary session token
    const sessionToken = generateSecureToken(32);

    // For email-based OTP (alternative to authenticator)
    const otp = generateOTP();

    // Store session with 5-minute expiration
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    this.twoFactorSessions.set(sessionToken, {
      userId: user._id.toString(),
      otp,
      expiresAt,
    });

    // Send OTP via email if user prefers email 2FA
    // This is optional - user can also use authenticator app
    await this.emailService.sendTwoFactorOTPEmail(
      user.email,
      user.firstName,
      otp,
    );

    return {
      user,
      requires2FA: true,
      sessionToken,
    };
  }

  async verify2FA(sessionToken: string, code: string): Promise<LoginResponse> {
    const session = this.twoFactorSessions.get(sessionToken);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (new Date() > session.expiresAt) {
      this.twoFactorSessions.delete(sessionToken);
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.userModel.findById(session.userId).exec();

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Verify code - check both TOTP and email OTP
    let isValid = false;

    // Check authenticator TOTP
    if (user.twoFactorSecret) {
      isValid = authenticator.verify({
        token: code,
        secret: user.twoFactorSecret,
      });
    }

    // Check email OTP as fallback
    if (!isValid && session.otp === code) {
      isValid = true;
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid verification code');
    }

    // Clean up session
    this.twoFactorSessions.delete(sessionToken);

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Update refresh token hash and last login
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    user.lastLogin = new Date();
    await user.save();

    this.logger.log(`2FA verified for user: ${user.email}`);

    return { user, tokens };
  }

  // =====================
  // UTILITY METHODS
  // =====================

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserDocument | null> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async getUserById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).exec();
  }

  async sendContactEmail(createContactDto: CreateContactDto): Promise<boolean> {
    const { firstName, lastName, email, subject, message } = createContactDto;

    return this.emailService.sendEmail({
      to: 'rumanm.dev@gmail.com',
      subject: `New Contact Form Submission: ${subject || 'No Subject'}`,
      text: `
        Name: ${firstName} ${lastName}
        Email: ${email}
        Subject: ${subject || 'N/A'}
        Message: ${message}
      `,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #FF4667;">New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject || 'N/A'}</p>
          <p><strong>Message:</strong></p>
          <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin-top: 10px;">
            ${message.replace(/\n/g, '<br/>')}
          </div>
        </div>
      `,
    });
  }
}
