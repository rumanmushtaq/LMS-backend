import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ParseObjectIdPipe } from '@/common';
import { Public } from '@/common/decorators/public.decorator';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators';
import { UserDocument } from '@/users/schemas/user.schema';
import { InstructorsService } from './instructors.service';
import { GetInstructorsDto } from './dto';

@ApiTags('Instructors')
@Controller('instructors')
export class InstructorsController {
  constructor(private readonly instructorsService: InstructorsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get paginated list of instructors with filters',
    description:
      'Public endpoint. Returns active tutors with pagination, search, category/level/price filters and sort options.',
  })
  async getInstructors(@Query() query: GetInstructorsDto) {
    return this.instructorsService.getInstructors(query);
  }

  @Public()
  @Get('filter-options')
  @ApiOperation({
    summary: 'Get available filter options for the sidebar',
    description:
      'Returns distinct categories, levels, instructor names, and price range.',
  })
  async getFilterOptions() {
    return this.instructorsService.getFilterOptions();
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-students')
  @ApiOperation({
    summary: 'Get students enrolled in my courses',
  })
  async getMyStudents(
    @CurrentUser() user: UserDocument,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search: string,
  ) {
    return this.instructorsService.getMyStudents(
      user._id.toString(),
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 9,
      search,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-earnings')
  @ApiOperation({
    summary: 'Get earnings dashboard data for current tutor',
  })
  async getMyEarnings(
    @CurrentUser() user: UserDocument,
    @Query('chartYear') chartYear?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.instructorsService.getMyEarnings(
      user._id.toString(),
      chartYear ? parseInt(chartYear, 10) : undefined,
      startDate,
      endDate,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
    );
  }

  @Public()
  @Get(':slugOrId')
  @ApiParam({ name: 'slugOrId', description: 'Instructor (tutor) MongoDB ObjectId or unique slug' })
  @ApiOperation({
    summary: 'Get instructor detail by ID or Slug',
    description:
      'Returns full profile: bio, education, experience, certifications, social links and contact info.',
  })
  async getInstructorBySlugOrId(@Param('slugOrId') slugOrId: string) {
    return this.instructorsService.getInstructorBySlugOrId(slugOrId);
  }
}
