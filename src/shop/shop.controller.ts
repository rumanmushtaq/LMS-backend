import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser } from '@/common/decorators';
import { UserDocument, UserRole } from '@/users/schemas/user.schema';
import { ProductsService } from './products.service';
import { ShopService } from './shop.service';
import { CreateProductDto, GetProductsDto, CheckoutDto } from './dto';
import { ParseObjectIdPipe } from '@/common';

@ApiTags('Shop')
@Controller('shop')
export class ShopController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly shopService: ShopService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // PRODUCT ENDPOINTS (public reads, admin writes)
  // ═══════════════════════════════════════════════════════════

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Get paginated list of active products' })
  @ApiResponse({ status: 200, description: 'Products list' })
  async getProducts(@Query() query: GetProductsDto) {
    return this.productsService.getProducts(query, true);
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiParam({ name: 'id', description: 'Product MongoDB ObjectId' })
  async getProductById(@Param('id', ParseObjectIdPipe) id: string) {
    return this.productsService.getProductById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Post('products')
  @ApiOperation({ summary: '[Admin] Create a new product' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('images', 4))
  async createProduct(
    @Body() dto: CreateProductDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.productsService.createProduct(dto, files ?? []);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Patch('products/:id')
  @ApiOperation({ summary: '[Admin] Update a product' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', description: 'Product MongoDB ObjectId' })
  @UseInterceptors(FilesInterceptor('images', 4))
  async updateProduct(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: Partial<CreateProductDto>,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.productsService.updateProduct(id, dto, files ?? []);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete('products/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Soft-delete a product (sets isActive=false)',
  })
  @ApiParam({ name: 'id', description: 'Product MongoDB ObjectId' })
  async deleteProduct(@Param('id', ParseObjectIdPipe) id: string) {
    return this.productsService.deleteProduct(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Patch('products/:id/status')
  @ApiOperation({ summary: '[Admin] Toggle product active status' })
  @ApiParam({ name: 'id', description: 'Product MongoDB ObjectId' })
  async toggleProductStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.productsService.toggleProductStatus(id, isActive);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete('products/:id/hard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Permanently delete a product' })
  @ApiParam({ name: 'id', description: 'Product MongoDB ObjectId' })
  async permanentDeleteProduct(@Param('id', ParseObjectIdPipe) id: string) {
    return this.productsService.permanentDeleteProduct(id);
  }

  // Admin: get all products (including inactive)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin/products')
  @ApiOperation({ summary: '[Admin] Get all products including inactive' })
  async getAllProductsAdmin(@Query() query: GetProductsDto) {
    return this.productsService.getProducts(query, false);
  }

  // ═══════════════════════════════════════════════════════════
  // CHECKOUT ENDPOINTS (authenticated users)
  // ═══════════════════════════════════════════════════════════

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('checkout')
  @ApiOperation({
    summary: 'Price the cart, create the order, and start a payment',
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns the payment instruction the client uses to complete payment. ' +
      'The order is NOT paid until the provider webhook confirms it.',
  })
  async checkout(@CurrentUser() user: UserDocument, @Body() dto: CheckoutDto) {
    return this.shopService.checkout(user._id.toString(), dto, user.email);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-orders')
  @ApiOperation({ summary: 'Get authenticated user purchase history' })
  async getMyOrders(@CurrentUser() user: UserDocument) {
    return this.shopService.getMyOrders(user._id.toString());
  }

  // Admin: all orders
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('admin/orders')
  @ApiOperation({ summary: '[Admin] Get all shop orders' })
  async getAllOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.shopService.getAllOrders(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
