import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { PaymentsService } from './services/payments.service';
import { PlatformSettingsService } from './services/platform-settings.service';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';

/** Raw body is needed for signature verification — see main.ts. */
type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly settings: PlatformSettingsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('methods')
  @ApiOperation({ summary: 'Payment methods available to this buyer' })
  async methods() {
    return this.payments.availableMethods();
  }

  /**
   * Provider webhooks.
   *
   * Public because providers cannot authenticate as a user — authenticity comes
   * from the signature, which the provider adapter verifies. This is the only
   * path allowed to mark a payment paid; nothing the browser sends can.
   */
  @Public()
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider webhook receiver (signature-verified)' })
  async webhook(
    @Param('provider') provider: string,
    @Req() req: RawBodyRequest,
  ) {
    try {
      // 200 on success so the provider stops retrying.
      const settled = await this.payments.handleWebhook(
        provider,
        req.rawBody ?? JSON.stringify(req.body),
        req.headers as Record<string, any>,
      );

      return { received: true, settled: Boolean(settled) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Webhook rejected';

      // Missing secrets are an operator problem, not a bad request. 503 says
      // "retry later", which is what we want — the events are not lost while
      // the configuration is fixed. A bare 500 saying "Internal server error"
      // gives whoever is on call nothing to go on.
      if (message.includes('not configured')) {
        this.logger.error(`Webhook for "${provider}" rejected: ${message}`);
        throw new ServiceUnavailableException(
          `Payment provider "${provider}" is not configured to receive webhooks`,
        );
      }

      // Anything else is a failed signature check: someone posted to this
      // endpoint without being the provider. Do not retry, do not process.
      this.logger.warn(`Rejected unverified "${provider}" webhook: ${message}`);
      throw new BadRequestException('Webhook signature verification failed');
    }
  }

  // ─── Admin: commission settings ─────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Get('settings')
  @ApiOperation({ summary: '[Admin] Current commission and provider settings' })
  async getSettings() {
    return this.settings.get();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Patch('settings')
  @ApiOperation({
    summary: '[Admin] Update commission rates and enabled methods',
  })
  async updateSettings(
    @Req() req: Request & { user: any },
    @Body() dto: UpdatePlatformSettingsDto,
  ) {
    const adminId = req?.user?._id || req?.user?.userId;
    return this.settings.update(dto, adminId);
  }

  // ─── Seller balance ─────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-balance')
  @ApiOperation({ summary: 'What the platform owes the signed-in seller' })
  async myBalance(@Req() req: Request & { user: any }) {
    const userId = req?.user?._id || req?.user?.userId;
    return this.payments.sellerBalance(String(userId));
  }
}
