import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators';
import { UserDocument } from '@/users/schemas/user.schema';
import { CertificatesService } from './certificates.service';

@ApiTags('Certificates')
@Controller('certificates')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get current student certificates' })
  @ApiResponse({
    status: 200,
    description: 'Certificates retrieved successfully',
  })
  async getMyCertificates(@CurrentUser() user: UserDocument) {
    return this.certificatesService.getMyCertificates(user._id.toString());
  }
}
