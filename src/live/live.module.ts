import { Module } from '@nestjs/common';
import { VimeoModule } from '../vimeo/vimeo.module';
import { YouTubeModule } from '../youtube/youtube.module';
import { LiveStreamingService } from './live-streaming.service';

@Module({
  imports: [VimeoModule, YouTubeModule],
  providers: [LiveStreamingService],
  exports: [LiveStreamingService],
})
export class LiveModule {}
