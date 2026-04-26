import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TutorsController } from './tutors.controller';
import { TutorsService } from './tutors.service';
import { OnboardingController } from './controllers/onboarding.controller';
import { OnboardingService } from './services/onboarding.service';
import { TaxValidationService } from './services/tax-validation.service';
import { User, UserSchema } from '@/users/schemas/user.schema';
import { W9Form, W9FormSchema } from './schemas/w9-form.schema';
import { W8BENForm, W8BENFormSchema } from './schemas/w8ben-form.schema';
import { AdminModule } from '@/admin/admin.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: W9Form.name, schema: W9FormSchema },
      { name: W8BENForm.name, schema: W8BENFormSchema },
    ]),
    AdminModule,
  ],
  controllers: [TutorsController, OnboardingController],
  providers: [TutorsService, OnboardingService, TaxValidationService],
})
export class TutorsModule {}
