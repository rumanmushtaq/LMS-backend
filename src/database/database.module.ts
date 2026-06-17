import { Global, Module } from '@nestjs/common';
import { AdminSeeder } from './seeders/admin.seeder';
import { TutorSeeder } from './seeders/tutor.seeder';
import { DatabaseProvider } from './database.provider';

@Global()
@Module({
  imports: [...DatabaseProvider],
  exports: [...DatabaseProvider],
  providers: [AdminSeeder, TutorSeeder],
})
export class DatabaseModule {}
