import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class Enable2FADto {
  @ApiProperty({
    example: '123456',
    description: 'TOTP code from authenticator app to verify 2FA setup',
  })
  @IsString()
  @IsNotEmpty({ message: 'TOTP code is required' })
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  totpCode: string;
}

export class Verify2FADto {
  @ApiProperty({
    example: 'temp_session_token_here',
    description: 'Temporary session token received after initial login',
  })
  @IsString()
  @IsNotEmpty({ message: 'Session token is required' })
  sessionToken: string;

  @ApiProperty({
    example: '123456',
    description: 'TOTP code from authenticator app or OTP from email',
  })
  @IsString()
  @IsNotEmpty({ message: 'Verification code is required' })
  @Length(6, 6, { message: 'Verification code must be 6 digits' })
  code: string;
}

export class Disable2FADto {
  @ApiProperty({
    example: 'SecureP@ss123',
    description: 'Current password to confirm 2FA disable',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;

  @ApiProperty({
    example: '123456',
    description: 'TOTP code to verify ownership',
  })
  @IsString()
  @IsNotEmpty({ message: 'TOTP code is required' })
  @Length(6, 6, { message: 'TOTP code must be 6 digits' })
  totpCode: string;
}
