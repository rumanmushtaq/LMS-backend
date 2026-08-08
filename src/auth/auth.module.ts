import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { SessionService } from './services/session.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { Session, SessionSchema } from './schemas/session.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [
    // Sessions are an auth concern, so the model is registered here rather than
    // in the global database provider.
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.accessSecret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.accessExpiration'),
        },
      }),
      inject: [ConfigService],
    }),
    // Failed logins feed the credential-stuffing auto-blocker; successful
    // ones associate the account with its IP for the security dashboard.
    SecurityModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, JwtStrategy, JwtRefreshStrategy],
  // SessionService is exported so the globally-registered activity interceptor
  // in AppModule can slide the idle window on every authenticated request.
  exports: [AuthService, SessionService, JwtModule],
})
export class AuthModule {}
