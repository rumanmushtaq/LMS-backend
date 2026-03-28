import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';
import { HeroBanner, HeroBannerSchema } from './schemas/hero-banner.schema';
import { HeroBannerService } from './services/hero-banner.service';
import { HeroBannerController } from './controllers/hero-banner.controller';
import { UploadService } from './services/upload.service';
import { UploadController } from './controllers/upload.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HeroBanner.name, schema: HeroBannerSchema },
    ]),
  ],
  controllers: [AdminController, HeroBannerController, UploadController],
  providers: [AdminService, HeroBannerService, UploadService],
  exports: [AdminService, HeroBannerService, UploadService],
})
export class AdminModule {}
