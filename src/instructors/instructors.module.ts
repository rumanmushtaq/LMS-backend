import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '@/users/schemas/user.schema';
import { OrdersModule } from '@/orders/orders.module';
import { CoursesModule } from '@/courses/courses.module';
import { InstructorsController } from './instructors.controller';
import { InstructorsService } from './instructors.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    OrdersModule,
    CoursesModule,
  ],
  controllers: [InstructorsController],
  providers: [InstructorsService],
})
export class InstructorsModule {}
