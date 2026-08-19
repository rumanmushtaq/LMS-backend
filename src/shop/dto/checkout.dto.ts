import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Nested classes, not inline object types: the global ValidationPipe runs with
 * `whitelist`, which strips the properties of any nested shape it has no
 * metadata for.
 */
export class CheckoutItemDto {
  @ApiProperty({ description: 'Product to buy' })
  @IsMongoId()
  productId: string;

  @ApiProperty({ example: 'M' })
  @IsString()
  @Length(1, 20)
  size: string;

  /**
   * The checkout body used to be an untyped inline interface, so the pipe
   * never looked at it. A negative quantity subtracted from the order total,
   * which let a crafted cart drive the amount charged down to almost nothing.
   */
  @ApiProperty({ example: 1, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;
}

export class ShippingAddressDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  line1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 200)
  line2?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 100)
  city: string;

  @ApiProperty()
  @IsString()
  @Length(1, 100)
  state: string;

  @ApiProperty()
  @IsString()
  @Length(1, 20)
  zip: string;

  @ApiProperty({ example: 'CO' })
  @IsString()
  @Length(2, 60)
  country: string;
}

export class CheckoutDto {
  @ApiProperty({ type: [CheckoutItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @ApiProperty({
    description: 'Payment method id from GET /payments/methods',
    example: 'stripe',
  })
  @IsString()
  @Length(1, 40)
  paymentMethod: string;

  @ApiPropertyOptional({ type: ShippingAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shipping?: ShippingAddressDto;
}
