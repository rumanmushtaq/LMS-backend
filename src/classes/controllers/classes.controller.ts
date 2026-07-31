import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ClassesService } from '../services/classes.service';
import { CreateClassDto, RequestClassDto, ApproveClassDto, DeclineClassDto } from '../dto/create-class.dto';
import { UpdateClassDto } from '../dto/update-class.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../users/schemas/user.schema';

@ApiTags('Classes')
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  // ─── Tutor / Admin: direct class creation ────────────────────────────────────
  @Post()
  @Roles(UserRole.TUTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new class directly (Tutor/Admin)' })
  create(@Req() req: any, @Body() createClassDto: CreateClassDto) {
    return this.classesService.create(req.user._id.toString(), createClassDto);
  }

  // ─── Student: request a class from a tutor ───────────────────────────────────
  @Post('request')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Student requests a class from a specific tutor' })
  requestClass(@Req() req: any, @Body() dto: RequestClassDto) {
    return this.classesService.requestClass(req.user._id.toString(), dto);
  }

  // ─── Tutor: get all pending requests for them ────────────────────────────────
  @Get('requests')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Get all pending class requests for this tutor' })
  getRequests(@Req() req: any) {
    return this.classesService.getRequestsForTutor(req.user._id.toString());
  }

  // ─── Tutor: approve a pending request ────────────────────────────────────────
  @Patch(':id/approve')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Tutor approves a class request and optionally sets a meeting link' })
  approveClass(@Req() req: any, @Param('id') id: string, @Body() dto: ApproveClassDto) {
    return this.classesService.approveClass(id, req.user._id.toString(), dto);
  }

  // ─── Tutor: decline a pending request ────────────────────────────────────────
  @Patch(':id/decline')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Tutor declines a class request with optional reason' })
  declineClass(@Req() req: any, @Param('id') id: string, @Body() dto: DeclineClassDto) {
    return this.classesService.declineClass(id, req.user._id.toString(), dto);
  }

  // ─── Everyone: list classes (role-filtered) ───────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Get classes based on role' })
  findAll(@Req() req: any, @Query() query: any) {
    const filter: any = { ...query };

    if (req.user.role === UserRole.STUDENT) {
      // Students see classes they were enrolled in OR that they requested
      filter['$or'] = [
        { students: req.user._id },
        { requestedBy: req.user._id },
      ];
    } else if (req.user.role === UserRole.TUTOR) {
      filter.tutorId = req.user._id;
    }
    // Admins see all classes

    return this.classesService.findAll(filter);
  }

  // ─── Admin: get all classes without filter ────────────────────────────────────
  @Get('all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all classes (Admin only)' })
  findAllAdmin(@Query() query: any) {
    return this.classesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific class by ID' })
  findOne(@Param('id') id: string) {
    return this.classesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.TUTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a class (Tutor/Admin)' })
  update(@Req() req: any, @Param('id') id: string, @Body() updateClassDto: UpdateClassDto) {
    const isAdmin = req.user.role === UserRole.ADMIN;
    return this.classesService.update(id, updateClassDto, req.user._id.toString(), isAdmin);
  }

  @Delete(':id')
  @Roles(UserRole.TUTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete/Cancel a class (Tutor/Admin)' })
  remove(@Req() req: any, @Param('id') id: string) {
    const isAdmin = req.user.role === UserRole.ADMIN;
    return this.classesService.remove(id, req.user._id.toString(), isAdmin);
  }

  @Post(':id/enroll')
  @Roles(UserRole.STUDENT)
  @ApiOperation({ summary: 'Enroll a student in a class' })
  enroll(@Req() req: any, @Param('id') id: string) {
    return this.classesService.enrollStudent(id, req.user._id.toString());
  }

  // ─── Live class: Vimeo broadcast + Q&A chat ──────────────────────────────────

  @Post(':id/live/setup')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Provision the Vimeo live event + Q&A room (Tutor)' })
  setupLive(@Req() req: any, @Param('id') id: string) {
    return this.classesService.setupLive(id, req.user._id.toString());
  }

  @Get(':id/live/broadcast')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Get RTMP ingest credentials for OBS (Tutor only)' })
  getBroadcastInfo(@Req() req: any, @Param('id') id: string) {
    return this.classesService.getBroadcastInfo(id, req.user._id.toString());
  }

  @Post(':id/live/start')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'Mark the broadcast as live and notify students (Tutor)' })
  startLive(@Req() req: any, @Param('id') id: string) {
    return this.classesService.startLive(id, req.user._id.toString());
  }

  @Post(':id/live/end')
  @Roles(UserRole.TUTOR)
  @ApiOperation({ summary: 'End the broadcast and complete the class (Tutor)' })
  endLive(@Req() req: any, @Param('id') id: string) {
    return this.classesService.endLive(id, req.user._id.toString());
  }

  @Get(':id/live/watch')
  @ApiOperation({ summary: 'Get the embed URL + Q&A room to watch a live class' })
  watchLive(@Req() req: any, @Param('id') id: string) {
    return this.classesService.getWatchInfo(id, req.user._id.toString(), req.user.role);
  }
}
