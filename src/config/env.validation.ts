import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @IsOptional()
  PORT: number = 3000;

  @IsString()
  MONGODB_URI: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRATION: string = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRATION: string = '7d';

  /** Idle window in ms before a session expires. Default 15 minutes. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  SESSION_IDLE_TIMEOUT_MS: number = 900000;

  /** Absolute session ceiling in ms, regardless of activity. Default 7 days. */
  @IsNumber()
  @Min(1)
  @IsOptional()
  SESSION_ABSOLUTE_LIFETIME_MS: number = 604800000;

  /** How often `lastActivityAt` is actually persisted. Default 60 seconds. */
  @IsNumber()
  @Min(0)
  @IsOptional()
  SESSION_ACTIVITY_WRITE_INTERVAL_MS: number = 60000;

  @IsString()
  @IsOptional()
  SMTP_HOST: string = 'smtp.gmail.com';

  @IsNumber()
  @IsOptional()
  SMTP_PORT: number = 587;

  @IsString()
  @IsOptional()
  SMTP_SECURE: string = 'false';

  @IsString()
  SMTP_USER: string;

  @IsString()
  SMTP_PASS: string;

  @IsString()
  @IsOptional()
  SMTP_FROM_EMAIL: string = 'noreply@varona-academy.com';

  @IsString()
  @IsOptional()
  SMTP_FROM_NAME: string = 'Varona Academy';

  @IsNumber()
  @IsOptional()
  THROTTLE_TTL: number = 60;

  @IsNumber()
  @IsOptional()
  THROTTLE_LIMIT: number = 100;

  @IsNumber()
  @IsOptional()
  BCRYPT_SALT_ROUNDS: number = 12;

  @IsString()
  @IsOptional()
  IMAGEKIT_PUBLIC_KEY: string = 'public_fake_key';

  @IsString()
  @IsOptional()
  IMAGEKIT_PRIVATE_KEY: string = 'private_fake_key';

  @IsString()
  @IsOptional()
  IMAGEKIT_URL_ENDPOINT: string = 'https://ik.imagekit.io/fake_endpoint';

  @IsString()
  @IsOptional()
  STRIPE_SECRET_KEY: string;

  @IsString()
  @IsOptional()
  STRIPE_PUBLISHABLE_KEY: string;

  // Vimeo Live — optional so the app still boots without it; live-class
  // endpoints will fail clearly at call time if the token is missing.
  @IsString()
  @IsOptional()
  VIMEO_ACCESS_TOKEN: string;

  @IsString()
  @IsOptional()
  VIMEO_API_VERSION: string = '3.4';

  // Which provider NEW live classes broadcast on. Existing sessions keep the
  // provider they were provisioned with.
  @IsIn(['vimeo', 'youtube'])
  @IsOptional()
  LIVE_PROVIDER: string = 'vimeo';

  // YouTube Live — optional so the app still boots without it; live-class
  // endpoints fail clearly at call time if credentials are missing.
  @IsString()
  @IsOptional()
  YOUTUBE_CLIENT_ID: string;

  @IsString()
  @IsOptional()
  YOUTUBE_CLIENT_SECRET: string;

  @IsString()
  @IsOptional()
  YOUTUBE_REFRESH_TOKEN: string;

  // Live-only mode: delete the auto-archived VOD when a class ends ('true'
  // by default, per the no-replay requirement).
  @IsString()
  @IsOptional()
  YOUTUBE_DELETE_AFTER_END: string = 'true';

  // Browser->RTMP relay binary (defaults to 'ffmpeg' on PATH).
  @IsString()
  @IsOptional()
  FFMPEG_PATH: string = 'ffmpeg';

  // IP security — see securityConfig in configuration.ts for semantics.
  @IsString()
  @IsOptional()
  SECURITY_ENFORCE: string = 'false';

  @IsString()
  @IsOptional()
  SECURITY_TRUST_CLOUDFLARE: string = 'false';

  @IsNumber()
  @IsOptional()
  SECURITY_FAILED_LOGIN_THRESHOLD: number = 30;

  @IsNumber()
  @IsOptional()
  SECURITY_FAILED_LOGIN_WINDOW_MIN: number = 10;

  @IsNumber()
  @IsOptional()
  SECURITY_AUTOBLOCK_BASE_MINUTES: number = 15;

  @IsNumber()
  @IsOptional()
  SECURITY_ACTIVITY_RETENTION_DAYS: number = 90;
}

export function validateEnv(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
