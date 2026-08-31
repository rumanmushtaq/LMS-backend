import { Module } from '@nestjs/common';
import { YouTubeService } from './youtube.service';

@Module({
  providers: [YouTubeService],
  exports: [YouTubeService],
})
export class YouTubeModule {}
