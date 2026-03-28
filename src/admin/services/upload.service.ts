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
}
