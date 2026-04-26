import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UserDocument, UserRole } from '@/users/schemas/user.schema';
import { OnboardingService } from '../services/onboarding.service';
import { UploadService } from '@/admin/services/upload.service';
import { TaxValidationService } from '../services/tax-validation.service';
import {
  ContractOnboardingDto,
  TaxFormOnboardingDto,
  KycOnboardingDto,
} from '../dto/onboarding.dto';

@ApiTags('Tutor Onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.TUTOR)
@Controller('tutors/onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly uploadService: UploadService,
    private readonly taxValidationService: TaxValidationService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a document to ImageKit' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('folder') folder: string = 'tutors-onboarding',
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const url = await this.uploadService.uploadImage(file, folder);
    return { url };
  }

  @Post('validate-tax')
  @ApiOperation({ summary: 'Validate tax form using simulated AI' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async validateTaxForm(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserDocument,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.taxValidationService.validateTaxForm(
      file,
      `${user.firstName} ${user.lastName}`,
    );
  }

  @Post('contract')
  @ApiOperation({ summary: 'Submit signed contract and residency status' })
  async submitContract(
    @CurrentUser() user: UserDocument,
    @Body() dto: ContractOnboardingDto,
  ) {
    return this.onboardingService.submitContract(user, dto);
  }

  @Post('tax-form')
  @ApiOperation({ summary: 'Submit uploaded tax form URL' })
  async submitTaxForm(
    @CurrentUser() user: UserDocument,
    @Body() dto: TaxFormOnboardingDto,
  ) {
    return this.onboardingService.submitTaxForm(user, dto);
  }

  @Post('kyc')
  @ApiOperation({ summary: 'Submit KYC data and document URLs' })
  async submitKyc(
    @CurrentUser() user: UserDocument,
    @Body() dto: KycOnboardingDto,
  ) {
    return this.onboardingService.submitKyc(user, dto);
  }
}
