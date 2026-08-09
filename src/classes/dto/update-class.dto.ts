import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateClassDto } from './create-class.dto';

export class UpdateClassDto extends PartialType(CreateClassDto) {}

export class CancelClassDto {
  @ApiPropertyOptional({ example: 'Tutor unavailable — family emergency' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
