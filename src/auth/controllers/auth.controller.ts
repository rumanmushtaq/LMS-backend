import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService } from '../services/auth.service';
import {
  SignupDto,
  LoginDto,
  AdminLoginDto,
  VerifyEmailDto,
  ResendVerificationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  RefreshTokenDto,
  Enable2FADto,
  Verify2FADto,
  Disable2FADto,
  CreateContactDto,
} from '../dto';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtRefreshGuard } from '../guards/jwt-refresh.guard';
import { Public, CurrentUser } from '../../common/decorators';
import { UserDocument } from '../../users/schemas/user.schema';
import { SessionContext } from '../services/auth.service';
import { RefreshContext } from '../strategies/jwt-refresh.strategy';
import { SessionDocument } from '../schemas/session.schema';

/** The request once JwtStrategy has attached the validated session. */
type AuthenticatedRequest = Request & { session?: SessionDocument };

/**
 * Captures who/where a session was opened from, for audit and for showing users
 * their active sessions. Never used to make an authorization decision — the
 * user-agent is client-controlled, and the IP identifies a network, not a
 * person. The IP does feed the credential-stuffing auto-blocker, which is why
 * it prefers clientIp: the value resolved once by IpSecurityMiddleware under
 * the proxy/Cloudflare trust rules, so blocking and detection agree on what
 * "this client's address" means.
 */
function sessionContextFrom(req: Request): SessionContext {
  return {
    userAgent: req.get('user-agent') ?? null,
    ipAddress:
      (req as Request & { clientIp?: string }).clientIp ?? req.ip ?? null,
  };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // =====================
  // PUBLIC ENDPOINTS
  // =====================

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Register a new student or tutor account' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login for students and tutors' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    return this.authService.login(loginDto, sessionContextFrom(req));
  }

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login for administrators' })
  @ApiResponse({ status: 200, description: 'Admin login successful' })
  @ApiResponse({ status: 401, description: 'Invalid admin credentials' })
  async adminLogin(@Body() loginDto: AdminLoginDto, @Req() req: Request) {
    return this.authService.adminLogin(loginDto, sessionContextFrom(req));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email address (API)' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email address via link from email' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmailGet(@Query('token') token: string, @Res() res: Response) {
    try {
      await this.authService.verifyEmail(token);
      res.setHeader('Content-Type', 'text/html');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Email Verified - Varona Academy</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
            .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 48px 40px; max-width: 440px; width: 100%; text-align: center; }
            .icon { width: 64px; height: 64px; border-radius: 50%; background: #e6f9f0; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
            .icon svg { width: 32px; height: 32px; color: #22c55e; }
            h1 { font-size: 24px; color: #1a1a2e; margin-bottom: 12px; }
            p { font-size: 15px; color: #64748b; line-height: 1.6; margin-bottom: 24px; }
            a.btn { display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 50px; font-weight: 600; font-size: 15px; transition: background 0.2s; }
            a.btn:hover { background: #4f46e5; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
            <h1>Email Verified!</h1>
            <p>Your email has been verified successfully. You can now log in to your account.</p>
            <a href="http://localhost:3000/login" class="btn">Go to Login</a>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Verification Failed - Varona Academy</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
            .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 48px 40px; max-width: 440px; width: 100%; text-align: center; }
            .icon { width: 64px; height: 64px; border-radius: 50%; background: #fee2e2; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
            .icon svg { width: 32px; height: 32px; color: #ef4444; }
            h1 { font-size: 24px; color: #1a1a2e; margin-bottom: 12px; }
            p { font-size: 15px; color: #64748b; line-height: 1.6; margin-bottom: 24px; }
            a.btn { display: inline-block; background: #1e293b; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 50px; font-weight: 600; font-size: 15px; transition: background 0.2s; }
            a.btn:hover { background: #0f172a; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></div>
            <h1>Verification Failed</h1>
            <p>The verification link is invalid or has expired. Please try signing up again or request a new verification email.</p>
            <a href="http://localhost:3000/signup" class="btn">Back to Sign Up</a>
          </div>
        </body>
        </html>
      `);
    }
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification link' })
  @ApiResponse({
    status: 200,
    description: 'Verification email sent if account exists',
  })
  async resendVerification(@Body() resendDto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(resendDto.email);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({
    status: 200,
    description: 'Reset email sent if account exists',
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Public()
  @Post('contact')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send contact form email' })
  @ApiResponse({ status: 200, description: 'Email sent successfully' })
  async contact(@Body() createContactDto: CreateContactDto) {
    return this.authService.sendContactEmail(createContactDto);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify 2FA code to complete login' })
  @ApiResponse({ status: 200, description: '2FA verification successful' })
  @ApiResponse({ status: 401, description: 'Invalid verification code' })
  async verify2FA(@Body() verify2FADto: Verify2FADto) {
    return this.authService.verify2FA(
      verify2FADto.sessionToken,
      verify2FADto.code,
    );
  }

  // =====================
  // TOKEN REFRESH
  // =====================

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshTokens(@CurrentUser() data: RefreshContext) {
    return this.authService.refreshTokens(
      data.user,
      data.refreshToken,
      data.sessionId,
    );
  }

  // =====================
  // PROTECTED ENDPOINTS
  // =====================

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current user' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@CurrentUser() user: UserDocument) {
    return this.authService.logout(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password for authenticated user' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async changePassword(
    @CurrentUser() user: UserDocument,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user, changePasswordDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getCurrentUser(@CurrentUser() user: UserDocument) {
    return user;
  }

  // =====================
  // 2FA MANAGEMENT
  // =====================

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA secret and QR code' })
  @ApiResponse({ status: 200, description: '2FA secret generated' })
  @ApiResponse({ status: 400, description: '2FA already enabled' })
  async generate2FASecret(@CurrentUser() user: UserDocument) {
    return this.authService.generate2FASecret(user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable 2FA with TOTP verification' })
  @ApiResponse({ status: 200, description: '2FA enabled successfully' })
  @ApiResponse({ status: 400, description: 'Invalid verification code' })
  async enable2FA(
    @CurrentUser() user: UserDocument,
    @Body() enable2FADto: Enable2FADto,
  ) {
    return this.authService.enable2FA(user, enable2FADto.totpCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable 2FA' })
  @ApiResponse({ status: 200, description: '2FA disabled successfully' })
  @ApiResponse({ status: 401, description: 'Invalid password or code' })
  async disable2FA(
    @CurrentUser() user: UserDocument,
    @Body() disable2FADto: Disable2FADto,
  ) {
    return this.authService.disable2FA(
      user,
      disable2FADto.password,
      disable2FADto.totpCode,
    );
  }
}
