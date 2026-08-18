import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({
    example: 'abc123def456...',
    description: 'Email verification token',
  })
  @IsString()
  @IsNotEmpty({ message: 'Verification token is required' })
  token: string;
}

export class ResendVerificationDto {
  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email address to resend verification to',
  })
  @IsString()
  @IsNotEmpty({ message: 'Email is required' })
  email: string;
}
