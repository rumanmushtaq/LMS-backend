import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Create NestJS application
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 3000;
  const appName = configService.get<string>('app.name') || 'Varona Academy';
  const nodeEnv = configService.get<string>('app.nodeEnv') || 'development';
  const frontendUrl = configService.get<string>('app.frontendUrl');

  // =====================
  // SECURITY MIDDLEWARE
  // =====================

  // Helmet - Security headers
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production',
      crossOriginEmbedderPolicy: nodeEnv === 'production',
    }),
  );

  // CORS Configuration
  app.enableCors({
    origin: nodeEnv === 'production' ? frontendUrl : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    maxAge: 86400, // 24 hours
  });

  // =====================
  // GLOBAL PIPES
  // =====================

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      forbidNonWhitelisted: true, // Throw error for unknown properties
      transform: true, // Transform payloads to DTO instances
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: nodeEnv === 'production',
    }),
  );

  // =====================
  // API PREFIX
  // =====================

  app.setGlobalPrefix('api/v1', {
    exclude: ['health'],
  });

  // =====================
  // SWAGGER DOCUMENTATION
  // =====================

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(`${appName} API`)
      .setDescription(
        `
## ${appName} Backend API Documentation

### Overview
This API provides comprehensive backend services for the ${appName} tutoring platform, including:
- **Authentication**: JWT-based auth with refresh tokens, email verification, password reset, and 2FA
- **User Management**: Profile management for students and tutors
- **Admin Panel**: Full user management capabilities for administrators

### Authentication
Most endpoints require authentication via Bearer token. Include the JWT access token in the Authorization header:
\`\`\`
Authorization: Bearer <access_token>
\`\`\`

### Rate Limiting
API requests are rate-limited to prevent abuse. Default limits:
- 100 requests per minute per IP

### Roles
- **Student**: Basic access to learning features
- **Tutor**: Access to teaching and student management features  
- **Admin**: Full administrative access

### Error Responses
All errors follow a consistent format:
\`\`\`json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/v1/endpoint"
}
\`\`\`
        `,
      )
      .setVersion('1.0.0')
      .setContact(
        'Varona Academy Support',
        'https://varona-academy.com',
        'support@varona-academy.com',
      )
      .setLicense('MIT', 'https://opensource.org/licenses/MIT')
      .addServer(`http://localhost:${port}`, 'Development Server')
      .addServer('https://api.varona-academy.com', 'Production Server')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'Authorization',
          description: 'Enter your JWT access token',
          in: 'header',
        },
      )
      // .addTag('Authentication', 'User authentication and authorization endpoints')
      // .addTag('Users', 'User profile management endpoints')
      // .addTag('Admin', 'Administrative endpoints for user management')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: `${appName} API Documentation`,
      customfavIcon: 'https://nestjs.com/img/logo-small.svg',
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info { margin: 30px 0 }
        .swagger-ui .info .title { font-size: 2.5em }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        filter: true,
        showRequestDuration: true,
        syntaxHighlight: {
          theme: 'monokai',
        },
      },
    });

    logger.log(`📚 Swagger documentation available at http://localhost:${port}/api/docs`);
  }

  // =====================
  // HEALTH CHECK ENDPOINT
  // =====================

  app.getHttpAdapter().get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: nodeEnv,
    });
  });

  // =====================
  // START SERVER
  // =====================

  await app.listen(port);

  logger.log(`🚀 ${appName} API is running on http://localhost:${port}`);
  logger.log(`🔧 Environment: ${nodeEnv}`);
  logger.log(`📍 API Prefix: /api/v1`);
}

bootstrap();

