import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { DashboardService } from './dashboard.service';
import { DashboardSummary } from './dashboard.types';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Role-appropriate dashboard summary for the signed-in user',
    description:
      'Branches on the caller role. Every figure is read from a collection ' +
      'this platform actually writes — there are no placeholder numbers in ' +
      'the response.',
  })
  @ApiResponse({
    status: 200,
    description: 'Student or tutor summary, discriminated by `role`.',
  })
  @ApiForbiddenResponse({
    description: 'Caller is an admin — the admin dashboard lives elsewhere.',
  })
  async summary(@CurrentUser() user: UserDocument): Promise<DashboardSummary> {
    return this.dashboardService.getSummary(user);
  }
}
