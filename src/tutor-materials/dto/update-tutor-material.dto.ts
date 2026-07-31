import { PartialType } from '@nestjs/swagger';
import { CreateTutorMaterialDto } from './create-tutor-material.dto';

export class UpdateTutorMaterialDto extends PartialType(CreateTutorMaterialDto) {}
