import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
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
    MulterModule.register({ dest: '/tmp/uploads' }),
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
