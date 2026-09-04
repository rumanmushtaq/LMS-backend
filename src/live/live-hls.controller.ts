import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { LiveHlsService } from './live-hls.service';

/**
 * Serves self-hosted live streams.
 *
 * `GET live-hls/:classId/token` (authenticated) hands an enrolled viewer a
 * short-lived playback token; the player then loads
 * `live-hls/:classId/:token/index.m3u8`, and because the token is a PATH
 * segment, every relative segment URL inside the playlist resolves under the
 * same token with no player configuration at all (works for hls.js and for
 * Safari's native HLS alike).
 */
@ApiTags('live')
@Controller('live-hls')
export class LiveHlsController {
  constructor(private readonly liveHls: LiveHlsService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get(':classId/token')
  @ApiOperation({ summary: 'Mint a playback token for a self-hosted stream' })
  async token(@Req() req: any, @Param('classId') classId: string) {
    const token = await this.liveHls.mintPlaybackToken(
      classId,
      req.user._id.toString(),
      req.user.role,
    );
    return { token };
  }

  // Auth for this route IS the playback token in the path — the global JWT
  // guard must not demand a bearer header from a <video> element.
  @Public()
  @Get(':classId/:token/:file')
  @ApiOperation({ summary: 'Serve a live HLS playlist/segment (token-gated)' })
  async serve(
    @Param('classId') classId: string,
    @Param('token') token: string,
    @Param('file') file: string,
    @Res() res: Response,
  ) {
    await this.liveHls.assertPlayable(token, classId);
    const filePath = this.liveHls.filePathFor(classId, file);
    if (!fs.existsSync(filePath)) {
      // Not an error state for the player: the class just isn't live (yet).
      throw new NotFoundException('The stream is not live');
    }
    res.setHeader(
      'Content-Type',
      file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    );
    // Helmet defaults to CORP same-origin, which blocks the <video> element's
    // no-cors requests from the frontend origin (ERR_BLOCKED_BY_RESPONSE).
    // Stream files are already gated by the playback token.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // The playlist mutates every ~2s; caching it stalls the stream.
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(filePath).pipe(res);
  }
}
