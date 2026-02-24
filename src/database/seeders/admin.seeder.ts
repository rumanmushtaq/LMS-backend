import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../../users/schemas/user.schema';

@Injectable()
export class AdminSeeder implements OnModuleInit {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultAdmin();
  }

  private async seedDefaultAdmin() {
    try {
      // Check if any admin exists
      const existingAdmin = await this.userModel
        .findOne({ role: UserRole.ADMIN })
        .exec();

      if (existingAdmin) {
        this.logger.log('Admin user already exists, skipping seed');
        return;
      }

      // Create default admin
      const defaultAdminEmail = 'admin@varona-academy.com';
      const defaultAdminPassword = 'Admin@123456';

      const saltRounds = this.configService.get<number>(
        'security.bcryptSaltRounds',
      );
      const hashedPassword = await bcrypt.hash(
        defaultAdminPassword,
        saltRounds || 12,
      );

      const admin = new this.userModel({
        email: defaultAdminEmail,
        firstName: 'Super',
        lastName: 'Admin',
        password: hashedPassword,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      });

      await admin.save();

      this.logger.warn('================================================');
      this.logger.warn('DEFAULT ADMIN CREATED');
      this.logger.warn(`Email: ${defaultAdminEmail}`);
      this.logger.warn(`Password: ${defaultAdminPassword}`);
      this.logger.warn('CHANGE THIS PASSWORD IMMEDIATELY IN PRODUCTION!');
      this.logger.warn('================================================');
    } catch (error) {
      this.logger.error('Failed to seed default admin:', error);
    }
  }
}

