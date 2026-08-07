import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsDateString, IsMongoId, IsEnum } from 'class-validator';
import { ClassStatus } from '../schemas/class.schema';

export class CreateClassDto {
  @ApiProperty({ description: 'Title of the class session' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'Detailed description of the class session' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Optional reference to a parent Course' })
  @IsOptional()
  @IsMongoId()
  courseId?: string;

  @ApiPropertyOptional({ description: 'Meeting link (e.g. Zoom, Google Meet)' })
  @IsOptional()
  @IsString()
  meetingLink?: string;

  @ApiProperty({ description: 'Start time of the class' })
  @IsNotEmpty()
  @IsDateString()
  startTime: string;

  @ApiProperty({ description: 'End time of the class' })
  @IsNotEmpty()
  @IsDateString()
  endTime: string;

  @ApiPropertyOptional({ description: 'Status of the class', enum: ClassStatus })
  @IsOptional()
  @IsEnum(ClassStatus)
  status?: ClassStatus;
}

/** Used when a STUDENT requests a class from a specific tutor */
export class RequestClassDto {
  @ApiProperty({ description: 'The tutor/instructor ID to request a class from' })
  @IsNotEmpty()
  @IsMongoId()
  tutorId: string;

  @ApiProperty({ description: 'Title of the requested class' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty({ description: 'What the student wants to learn / discussion topic' })
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'Proposed start time' })
  @IsNotEmpty()
  @IsDateString()
  startTime: string;

  @ApiProperty({ description: 'Proposed end time' })
  @IsNotEmpty()
  @IsDateString()
  endTime: string;
}

/** Used by a tutor when approving a class request */
export class ApproveClassDto {
  @ApiPropertyOptional({ description: 'Meeting link to share with the student (Zoom, Google Meet, etc.)' })
  @IsOptional()
  @IsString()
  meetingLink?: string;
}

/** Used by a tutor when declining a class request */
export class DeclineClassDto {
  @ApiPropertyOptional({ description: 'Reason for declining the class request' })
  @IsOptional()
  @IsString()
  declineReason?: string;
}
