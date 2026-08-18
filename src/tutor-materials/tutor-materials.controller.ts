import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { TutorMaterialsService } from './tutor-materials.service';
import { CreateTutorMaterialDto } from './dto/create-tutor-material.dto';
import { UpdateTutorMaterialDto } from './dto/update-tutor-material.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { UploadService } from '../admin/services/upload.service';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

@ApiTags('Tutor Materials')
@Controller('tutor-materials')
export class TutorMaterialsController {
  constructor(
    private readonly tutorMaterialsService: TutorMaterialsService,
    private readonly uploadService: UploadService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all active materials (publicly accessible)' })
  findAll(@Query() query: any) {
    return this.tutorMaterialsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific material by ID' })
  findOne(@Param('id') id: string) {
    return this.tutorMaterialsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new material (Tutor only)' })
  create(@Req() req: any, @Body() dto: CreateTutorMaterialDto) {
    return this.tutorMaterialsService.create(req.user._id.toString(), dto);
  }

  /**
   * Upload a material file (PDF, ZIP, etc.) to ImageKit.
   * Max allowed size: 100MB.
   */
  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload a material file to ImageKit (Tutor only, max 100MB)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File to upload (PDF, ZIP, etc.)',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  async uploadMaterialFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'No file provided. Please attach a file with the key "file".',
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException(
        `File is too large. Maximum allowed size is 100MB. Received: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
      );
    }

    const result = await this.uploadService.uploadFile(file, 'tutor-materials');
    return {
      url: result.url,
      fileId: result.fileId,
      name: result.name,
      size: result.size,
      sizeInMB: (result.size / 1024 / 1024).toFixed(2),
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an existing material (Tutor only)' })
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateTutorMaterialDto,
  ) {
    return this.tutorMaterialsService.update(id, req.user._id.toString(), dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.TUTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a material (Tutor only)' })
  remove(@Req() req: any, @Param('id') id: string) {
    return this.tutorMaterialsService.remove(id, req.user._id.toString());
  }

  @Post(':id/purchase')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Purchase a material (Student only) - Mock flow' })
  purchaseMaterial(@Req() req: any, @Param('id') materialId: string) {
    return this.tutorMaterialsService.purchaseMaterial(
      req.user._id.toString(),
      materialId,
    );
  }

  @Get('student/purchases')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.STUDENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get materials purchased by the student' })
  getPurchasedMaterials(@Req() req: any) {
    return this.tutorMaterialsService.getPurchasedMaterials(
      req.user._id.toString(),
    );
  }
}
