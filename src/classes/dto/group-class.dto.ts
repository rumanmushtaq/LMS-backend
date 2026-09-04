import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
} from 'class-validator';

export class CreateGroupClassDto {
  @ApiProperty({ description: 'Title of the group class' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'What the class covers' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'Start time (ISO 8601)' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ description: 'End time (ISO 8601)' })
  @IsDateString()
  endTime: string;

  // At least one seat: a group class nobody can join is a configuration
  // mistake, not a valid state.
  @ApiProperty({ description: 'How many students may join', minimum: 1 })
  @IsInt()
  @Min(1)
  maxStudents: number;

  @ApiProperty({ description: 'Price of one seat', minimum: 0 })
  @IsNumber()
  @Min(0)
  price: number;
}

export class PurchaseSeatDto {
  @ApiProperty({ description: 'Payment provider id, e.g. "stripe" or "pse"' })
  @IsNotEmpty()
  @IsString()
  paymentMethod: string;
}
