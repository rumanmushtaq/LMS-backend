import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class PurchaseMaterialDto {
  @ApiProperty({ description: 'Payment provider id, e.g. "stripe" or "pse"' })
  @IsNotEmpty()
  @IsString()
  paymentMethod: string;
}
