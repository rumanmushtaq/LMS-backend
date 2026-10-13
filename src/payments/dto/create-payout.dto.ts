import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class CreatePayoutDto {
  @ApiPropertyOptional({
    description:
      'Specific payment ids to settle, or omit / "all_owed" to settle everything currently owed',
  })
  @IsOptional()
  paymentIds?: string[] | 'all_owed';

  @ApiProperty({ description: 'How it was paid, e.g. "bank" or "cash"' })
  @IsNotEmpty()
  @IsString()
  method: string;

  @ApiPropertyOptional({ description: 'Free-text note' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'External reference, e.g. a bank txn id' })
  @IsOptional()
  @IsString()
  reference?: string;
}
