import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Product, ProductSchema } from './schemas/product.schema';
import { ShopOrder, ShopOrderSchema } from './schemas/shop-order.schema';
import { ProductsService } from './products.service';
import { ShopService } from './shop.service';
import { ShopController } from './shop.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    ConfigModule,
    PaymentsModule,
    // Images are streamed straight to ImageKit from the request buffer, so keep
    // the upload in memory. Disk storage (`dest`) leaves `file.buffer`
    // undefined, which made `toFile(file.buffer, …)` in ProductsService throw
    // "Unexpected data type: undefined" and 500 on every product image upload.
    // Product images are small and capped at 4 per request (FilesInterceptor),
    // so memory storage carries no meaningful cost.
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per image
    }),
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: ShopOrder.name, schema: ShopOrderSchema },
    ]),
  ],
  controllers: [ShopController],
  providers: [ProductsService, ShopService],
  exports: [ProductsService, ShopService],
})
export class ShopModule {}
