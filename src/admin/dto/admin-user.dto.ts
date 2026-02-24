import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole, UserStatus } from '../../users/schemas/user.schema';

export class CreateAdminDto {
  @ApiProperty({
    example: 'admin@varona-academy.com',
    description: 'Admin email address',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email: string;

  @ApiProperty({
    example: 'Admin',
    description: 'Admin first name',
  })
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  @MaxLength(50, { message: 'First name must be at most 50 characters' })
  firstName: string;

  @ApiProperty({
    example: 'User',
    description: 'Admin last name',
  })
  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MinLength(2, { message: 'Last name must be at least 2 characters' })
  @MaxLength(50, { message: 'Last name must be at most 50 characters' })
  lastName: string;

  @ApiProperty({
    example: 'SecureAdminP@ss123',
    description: 'Admin password',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
    },
  )
  password: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({
    example: 'active',
    description: 'New user status',
    enum: UserStatus,
  })
  @IsEnum(UserStatus, { message: 'Invalid status value' })
  status: UserStatus;
}

export class UpdateUserRoleDto {
  @ApiProperty({
    example: 'tutor',
    description: 'New user role',
    enum: UserRole,
  })
  @IsEnum(UserRole, { message: 'Invalid role value' })
  role: UserRole;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional({
    example: 'John',
    description: 'User first name',
  })
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'First name must be at least 2 characters' })
  @MaxLength(50, { message: 'First name must be at most 50 characters' })
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Doe',
    description: 'User last name',
  })
  @IsString()
  @IsOptional()
  @MinLength(2, { message: 'Last name must be at least 2 characters' })
  @MaxLength(50, { message: 'Last name must be at most 50 characters' })
  lastName?: string;

  @ApiPropertyOptional({
    example: 'student',
    description: 'User role',
    enum: UserRole,
  })
  @IsEnum(UserRole, { message: 'Invalid role value' })
  @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional({
    example: 'active',
    description: 'User status',
    enum: UserStatus,
  })
  @IsEnum(UserStatus, { message: 'Invalid status value' })
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({
    example: true,
    description: 'Email verification status',
  })
  @IsOptional()
  emailVerified?: boolean;
}

export class UserQueryDto {
  @ApiPropertyOptional({
    example: 'student',
    description: 'Filter by role',
    enum: UserRole,
  })
  @IsEnum(UserRole, { message: 'Invalid role value' })
  @IsOptional()
  role?: UserRole;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Filter by status',
    enum: UserStatus,
  })
  @IsEnum(UserStatus, { message: 'Invalid status value' })
  @IsOptional()
  status?: UserStatus;

  @ApiPropertyOptional({
    example: 'john',
    description: 'Search by name or email',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Page number',
  })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Items per page',
  })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    example: 'createdAt',
    description: 'Sort field',
  })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({
    example: 'desc',
    description: 'Sort order',
  })
  @IsString()
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}

