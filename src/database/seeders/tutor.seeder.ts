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
export class TutorSeeder implements OnModuleInit {
  private readonly logger = new Logger(TutorSeeder.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultTutors();
  }

  private async seedDefaultTutors() {
    try {
      // Check if any tutor exists
      const existingTutor = await this.userModel
        .findOne({ role: UserRole.TUTOR })
        .exec();

      if (existingTutor) {
        this.logger.log('Tutor users already exist, skipping seed');
        return;
      }

      const saltRounds =
        this.configService.get<number>('security.bcryptSaltRounds') || 12;
      const hashedPassword = await bcrypt.hash('Tutor@123', saltRounds);

      const tutorsData = [
        {
          email: 'jane.doe@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          password: hashedPassword,
          role: UserRole.TUTOR,
          status: UserStatus.ACTIVE,
          emailVerified: true,
          kycData: {
            title: 'Expert UI/UX Designer',
            bio: 'Passionate about building beautiful and functional user interfaces. Over 10 years of experience in the industry.',
            categories: ['UI/UX Design'],
            level: 'Expert',
            rating: 4.9,
            reviewCount: 156,
            hourlyRate: 75,
            avatar: '/images/avatar-1.jpg',
          },
        },
        {
          email: 'john.smith@example.com',
          firstName: 'John',
          lastName: 'Smith',
          password: hashedPassword,
          role: UserRole.TUTOR,
          status: UserStatus.ACTIVE,
          emailVerified: true,
          kycData: {
            title: 'Senior Web Developer',
            bio: 'Master of React, Node.js and the modern web stack. Helping students build high-performance applications.',
            categories: ['Development', 'Framework'],
            level: 'Advanced',
            rating: 5.0,
            reviewCount: 210,
            hourlyRate: 90,
            avatar: '/images/avatar-2.jpg',
          },
        },
        {
          email: 'sarah.jones@example.com',
          firstName: 'Sarah',
          lastName: 'Jones',
          password: hashedPassword,
          role: UserRole.TUTOR,
          status: UserStatus.ACTIVE,
          emailVerified: true,
          kycData: {
            title: 'Graphic Design Mentor',
            bio: 'Creative mind with a focus on branding and visual identity. I love sharing my knowledge of typography and color theory.',
            categories: ['Graphic Design', 'General'],
            level: 'Professional',
            rating: 4.8,
            reviewCount: 98,
            hourlyRate: 60,
            avatar: '/images/avatar-3.jpg',
          },
        },
      ];

      for (const data of tutorsData) {
        const tutor = new this.userModel(data);
        await tutor.save();
      }

      this.logger.log(`Successfully seeded ${tutorsData.length} tutors.`);
    } catch (error) {
      this.logger.error('Failed to seed default tutors:', error);
    }
  }
}
