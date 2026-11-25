import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import { StartStreamDto } from './dto/start-stream.dto';
import { TeacherStreamsService } from './teacher-streams.service';

/**
 * Teacher "go live" streams. The broadcast itself runs through the same
 * ingest socket and `/live-hls` gate as live classes, with the stream id in
 * the class-id slot.
 */
@ApiTags('Teacher streams')
@ApiBearerAuth()
@Controller('teacher-streams')
export class TeacherStreamsController {
  constructor(private readonly streams: TeacherStreamsService) {}

  // Static routes first so they are never read as a stream id.

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Teachers live right now (for instructor cards)' })
  listLive() {
    return this.streams.listLive();
  }

  @Get('me')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: "The teacher's active stream, or null (Tutor)" })
  async getMine(@Req() req: any) {
    // Wrapped so "no stream" is a JSON body, not an empty 200.
    return { stream: await this.streams.getMine(req.user._id.toString()) };
  }

  @Get('admin')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Live and recent streams (Admin)' })
  listForAdmin(@Query('status') status?: string) {
    return this.streams.listForAdmin(status);
  }

  @Post()
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Open (or reopen) your stream (Tutor)' })
  start(@Req() req: any, @Body() dto: StartStreamDto) {
    return this.streams.startOrResume(req.user._id.toString(), dto.title);
  }

  @Post(':id/live')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Video is flowing: show the stream as live (Tutor)' })
  goLive(@Req() req: any, @Param('id') id: string) {
    return this.streams.goLive(id, req.user._id.toString());
  }

  @Post(':id/end')
  @Roles(UserRole.TUTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'End a stream (its teacher, or an admin)' })
  end(@Req() req: any, @Param('id') id: string) {
    return this.streams.end(id, {
      userId: req.user._id.toString(),
      role: req.user.role,
    });
  }

  // No @Roles here on purpose: the service refuses non-students with a clear
  // message, where the roles guard would only say "Forbidden resource".
  @Get(':id/watch')
  @ApiOperation({ summary: 'Join a stream as a viewer (Students only)' })
  watch(@Req() req: any, @Param('id') id: string) {
    return this.streams.getWatchInfo(id, {
      userId: req.user._id.toString(),
      role: req.user.role,
    });
  }
}
