import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ImageKit, { toFile } from '@imagekit/nodejs';

@Injectable()
export class UploadService {
  private imagekit: ImageKit;

  constructor(private configService: ConfigService) {
    this.imagekit = new ImageKit({
      privateKey: this.configService.get<string>('imagekit.privateKey'),
    });
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string = 'hero-banners',
  ): Promise<string> {
    const fileName = `${Date.now()}-${file.originalname}`;
    const uploadResponse = await this.imagekit.files.upload({
      file: await toFile(file.buffer, fileName),
      fileName: fileName,
      folder: folder,
      publicKey: this.configService.get<string>('imagekit.publicKey')!,
    });

    return uploadResponse.url!;
  }

  /**
   * Uploads a generic file (PDF, ZIP, etc.) to ImageKit.
   * Supports files up to 100MB — enforce size limits in the interceptor.
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'tutor-materials',
  ): Promise<{ url: string; fileId: string; name: string; size: number }> {
    const fileName = `${Date.now()}-${file.originalname}`;
    const uploadResponse = await this.imagekit.files.upload({
      file: await toFile(file.buffer, fileName),
      fileName: fileName,
      folder: folder,
      publicKey: this.configService.get<string>('imagekit.publicKey')!,
    });

    return {
      url: uploadResponse.url!,
      fileId: uploadResponse.fileId!,
      name: uploadResponse.name!,
      size: file.size,
    };
  }
}
