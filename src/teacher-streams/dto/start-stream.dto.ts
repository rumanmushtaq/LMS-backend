import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartStreamDto {
  @ApiPropertyOptional({ example: 'Algebra Q&A — ask me anything' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
