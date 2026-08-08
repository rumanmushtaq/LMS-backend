import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecurityAdminController } from './controllers/security-admin.controller';
import { IpSecurityMiddleware } from './middleware/ip-security.middleware';
import { BlockedIp, BlockedIpSchema } from './schemas/blocked-ip.schema';
import { IpActivity, IpActivitySchema } from './schemas/ip-activity.schema';
import { IpWhitelist, IpWhitelistSchema } from './schemas/ip-whitelist.schema';
import {
  SecurityAudit,
  SecurityAuditSchema,
} from './schemas/security-audit.schema';
import { AutoBlockService } from './services/auto-block.service';
import { IpActivityService } from './services/ip-activity.service';
import { IpBlockService } from './services/ip-block.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlockedIp.name, schema: BlockedIpSchema },
      { name: IpActivity.name, schema: IpActivitySchema },
      { name: IpWhitelist.name, schema: IpWhitelistSchema },
      { name: SecurityAudit.name, schema: SecurityAuditSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [SecurityAdminController],
  providers: [
    IpBlockService,
    IpActivityService,
    AutoBlockService,
    IpSecurityMiddleware,
  ],
  exports: [IpBlockService, IpActivityService, AutoBlockService],
})
export class SecurityModule {}
