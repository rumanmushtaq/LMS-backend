import { Global, Module } from '@nestjs/common';
import { AdminSeeder } from './seeders/admin.seeder';
import { DatabaseProvider } from './database.provider';

@Global()
@Module({
  imports: [...DatabaseProvider],
  exports: [...DatabaseProvider],
  providers: [AdminSeeder],
})
export class DatabaseModule {}
