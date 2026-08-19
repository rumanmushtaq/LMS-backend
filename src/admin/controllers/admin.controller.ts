import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiExcludeController,
} from '@nestjs/swagger';
import { AdminService, TutorRow } from '../services/admin.service';
import {
  CreateAdminDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
  AdminUpdateUserDto,
  UserQueryDto,
} from '../dto/admin-user.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, UserStatus } from '../../users/schemas/user.schema';
import { GetStudentsQueryDto } from '../../users/dto/get-students.dto';

@ApiExcludeController()
@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // =====================
  // DASHBOARD
  // =====================

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiResponse({ status: 200, description: 'Dashboard stats retrieved' })
  async getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // =====================
  // USER MANAGEMENT
  // =====================

  @Get('users')
  @ApiOperation({ summary: 'Get all users with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Users list retrieved' })
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  async getAllUsers(@Query() query: UserQueryDto) {
    return this.adminService.getAllUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Post('users/admin')
  @ApiOperation({ summary: 'Create a new admin user' })
  @ApiResponse({ status: 201, description: 'Admin created successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async createAdmin(@Body() createAdminDto: CreateAdminDto) {
    return this.adminService.createAdmin(createAdminDto);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user details' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserDto: AdminUpdateUserDto,
  ) {
    return this.adminService.updateUser(id, updateUserDto);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Update user status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async updateUserStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(id, updateStatusDto);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update user role' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async updateUserRole(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateUserRoleDto,
  ) {
    return this.adminService.updateUserRole(id, updateRoleDto);
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a user' })
  @ApiResponse({ status: 200, description: 'User suspended successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async suspendUser(@Param('id') id: string) {
    return this.adminService.suspendUser(id);
  }

  @Post('users/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a user' })
  @ApiResponse({ status: 200, description: 'User activated successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async activateUser(@Param('id') id: string) {
    return this.adminService.activateUser(id);
  }

  @Post('users/:id/verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually verify user email' })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async verifyUserEmail(@Param('id') id: string) {
    return this.adminService.verifyUserEmail(id);
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 400, description: 'Cannot delete admin users' })
  @ApiParam({ name: 'id', description: 'User ID' })
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  // =====================
  // STUDENT MANAGEMENT
  // =====================

  @Get('students')
  @ApiOperation({ summary: 'Get all students with pagination and filters' })
  @ApiResponse({ status: 200, description: 'Students list retrieved' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'emailVerified', required: false, type: Boolean })
  async getStudents(@Query() query: GetStudentsQueryDto) {
    return this.adminService.getStudents(query);
  }

  @Get('students/:id')
  @ApiOperation({ summary: 'Get student by ID' })
  @ApiResponse({ status: 200, description: 'Student retrieved' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiParam({ name: 'id', description: 'Student ID' })
  async getStudentById(@Param('id') id: string) {
    return this.adminService.getStudentById(id);
  }

  @Patch('students/:id')
  @ApiOperation({ summary: 'Update student details' })
  @ApiResponse({ status: 200, description: 'Student updated successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiParam({ name: 'id', description: 'Student ID' })
  async updateStudent(
    @Param('id') id: string,
    @Body() updateStudentDto: AdminUpdateUserDto,
  ) {
    return this.adminService.updateStudent(id, updateStudentDto);
  }

  @Patch('students/:id/status')
  @ApiOperation({ summary: 'Update student status' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiParam({ name: 'id', description: 'Student ID' })
  async updateStudentStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateStudentStatus(id, updateStatusDto);
  }

  @Post('students/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a student' })
  @ApiResponse({ status: 200, description: 'Student suspended successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiParam({ name: 'id', description: 'Student ID' })
  async suspendStudent(@Param('id') id: string) {
    return this.adminService.suspendStudent(id);
  }

  @Post('students/:id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a student' })
  @ApiResponse({ status: 200, description: 'Student activated successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiParam({ name: 'id', description: 'Student ID' })
  async activateStudent(@Param('id') id: string) {
    return this.adminService.activateStudent(id);
  }

  @Delete('students/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a student' })
  @ApiResponse({ status: 200, description: 'Student deleted successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiParam({ name: 'id', description: 'Student ID' })
  async deleteStudent(@Param('id') id: string) {
    return this.adminService.deleteStudent(id);
  }

  // =====================
  // TUTOR MANAGEMENT
  // =====================

  @Get('tutors')
  @ApiOperation({ summary: 'Get all teachers with pagination and filters' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', enum: UserStatus, required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortOrder', enum: ['asc', 'desc'], required: false })
  getTeachers(@Query() query: GetStudentsQueryDto): Promise<{
    data: TutorRow[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    return this.adminService.getTeachers(query);
  }

  @Get('tutors/:id')
  @ApiOperation({ summary: 'Get teacher details by ID' })
  @ApiParam({ name: 'id', description: 'Teacher ID' })
  getTeacherById(@Param('id') id: string): Promise<TutorRow> {
    return this.adminService.getTeacherById(id);
  }

  @Post('tutors/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a tutor application' })
  @ApiResponse({ status: 200, description: 'Tutor approved successfully' })
  @ApiResponse({ status: 404, description: 'Tutor not found' })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  async approveTeacher(@Param('id') id: string) {
    return this.adminService.approveTeacher(id);
  }

  @Post('tutors/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a tutor application' })
  @ApiResponse({ status: 200, description: 'Tutor rejected successfully' })
  @ApiResponse({ status: 404, description: 'Tutor not found' })
  @ApiParam({ name: 'id', description: 'Tutor ID' })
  async rejectTeacher(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.rejectTeacher(id, reason);
  }
}
