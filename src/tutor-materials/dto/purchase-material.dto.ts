import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class PurchaseMaterialDto {
  @ApiProperty({
    description: 'Payment method id from GET /payments/methods',
    example: 'stripe',
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 40)
  paymentMethod: string;
}
