import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassesModule } from '../classes/classes.module';
import { LiveHlsController } from './live-hls.controller';
import { LiveHlsService } from './live-hls.service';

@Module({
  imports: [AuthModule, ClassesModule],
  controllers: [LiveHlsController],
  providers: [LiveHlsService],
})
export class LiveHlsModule {}
