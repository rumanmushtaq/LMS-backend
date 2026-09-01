import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';

// Configuration
import {
  appConfig,
  databaseConfig,
  jwtConfig,
  sessionConfig,
  emailConfig,
  throttleConfig,
  securityConfig,
  imagekitConfig,
  stripeConfig,
  pseConfig,
  vimeoConfig,
  validateEnv,
  liveConfig,
  ingestConfig,
  youtubeConfig,
} from './config';

// Modules
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { EmailModule } from './email/email.module';

// Common
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { SessionActivityInterceptor } from './auth/interceptors/session-activity.interceptor';
import { RolesGuard } from './common/guards/roles.guard';
import { TutorsModule } from './tutors/tutors.module';
import { InstructorsModule } from './instructors/instructors.module';
import { CertificatesModule } from './certificates/certificates.module';
import { CoursesModule } from './courses/courses.module';
import { OrdersModule } from './orders/orders.module';
import { ShopModule } from './shop/shop.module';
import { CategoriesModule } from './categories/categories.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TutorMaterialsModule } from './tutor-materials/tutor-materials.module';
import { ClassesModule } from './classes/classes.module';
import { IngestModule } from './ingest/ingest.module';
import { PaymentsModule } from './payments/payments.module';
import { SecurityModule } from './security/security.module';
import { IpSecurityMiddleware } from './security/middleware/ip-security.middleware';

@Module({
  imports: [
    // Configuration module
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        databaseConfig,
        jwtConfig,
        sessionConfig,
        emailConfig,
        throttleConfig,
        securityConfig,
        imagekitConfig,
        stripeConfig,
        pseConfig,
        vimeoConfig,
        liveConfig,
        ingestConfig,
        youtubeConfig,
      ],
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
    ]),

    // Scheduled jobs (e.g. the missed-class sweep in ClassesService)
    ScheduleModule.forRoot(),

    // Database
    DatabaseModule,

    // Email
    EmailModule,

    // Feature modules
    AuthModule,
    UsersModule,
    AdminModule,
    TutorsModule,
    InstructorsModule,
    CertificatesModule,
    CoursesModule,
    OrdersModule,
    ShopModule,
    CategoriesModule,
    ChatModule,
    NotificationsModule,
    TutorMaterialsModule,
    ClassesModule,
    IngestModule,
    PaymentsModule,
    SecurityModule,
  ],
  providers: [
    // Global JWT Auth Guard
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global Roles Guard
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Global Rate Limiting Guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global Exception Filter
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // Slides the session idle window on meaningful authenticated activity.
    // Registered globally so no route can forget to extend the session, and
    // runs after the auth guard so the session is already validated.
    {
      provide: APP_INTERCEPTOR,
      useClass: SessionActivityInterceptor,
    },
    // Global Logging Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global Transform Interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route, before guards: a blocked IP must cost nothing downstream.
    consumer.apply(IpSecurityMiddleware).forRoutes('*');
  }
}
