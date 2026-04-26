import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '../../users/schemas/user.schema';
import { EmailService } from '../../email/services/email.service';
import {
  CreateAdminDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
  AdminUpdateUserDto,
  UserQueryDto,
} from '../dto/admin-user.dto';
import { GetStudentsQueryDto } from '../../users/dto/get-students.dto';

export interface PaginatedUsers {
  users: UserDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DashboardStats {
  totalUsers: number;
  totalStudents: number;
  totalTutors: number;
  totalAdmins: number;
  activeUsers: number;
  pendingUsers: number;
  suspendedUsers: number;
  recentSignups: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly bcryptSaltRounds: number;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.bcryptSaltRounds = this.configService.get<number>(
      'security.bcryptSaltRounds',
    )!;
  }

  // =====================
  // DASHBOARD & STATS
  // =====================

  async getDashboardStats(): Promise<DashboardStats> {
    const [
      totalUsers,
      totalStudents,
      totalTutors,
      totalAdmins,
      activeUsers,
      pendingUsers,
      suspendedUsers,
      recentSignups,
    ] = await Promise.all([
      this.userModel.countDocuments(),
      this.userModel.countDocuments({ role: UserRole.STUDENT }),
      this.userModel.countDocuments({ role: UserRole.TUTOR }),
      this.userModel.countDocuments({ role: UserRole.ADMIN }),
      this.userModel.countDocuments({ status: UserStatus.ACTIVE }),
      this.userModel.countDocuments({ status: UserStatus.PENDING }),
      this.userModel.countDocuments({ status: UserStatus.SUSPENDED }),
      this.userModel.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    return {
      totalUsers,
      totalStudents,
      totalTutors,
      totalAdmins,
      activeUsers,
      pendingUsers,
      suspendedUsers,
      recentSignups,
    };
  }

  // =====================
  // USER MANAGEMENT
  // =====================

  async getAllUsers(query: UserQueryDto): Promise<PaginatedUsers> {
    const {
      role,
      status,
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const filter: FilterQuery<User> = {};

    if (role) filter.role = role;
    if (status) filter.status = status;

    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sortOptions: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createAdmin(createAdminDto: CreateAdminDto): Promise<UserDocument> {
    const { email, firstName, lastName, password } = createAdminDto;

    // Check if user already exists
    const existingUser = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, this.bcryptSaltRounds);

    // Create admin user (already verified and active)
    const admin = new this.userModel({
      email: email.toLowerCase(),
      firstName,
      lastName,
      password: hashedPassword,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    });

    await admin.save();

    this.logger.log(`New admin created: ${email}`);

    return admin;
  }

  async updateUser(
    userId: string,
    updateUserDto: AdminUpdateUserDto,
  ): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    const { firstName, lastName, role, status, emailVerified } = updateUserDto;

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (role !== undefined) user.role = role;
    if (status !== undefined) user.status = status;
    if (emailVerified !== undefined) user.emailVerified = emailVerified;

    await user.save();

    this.logger.log(`User updated by admin: ${user.email}`);

    return user;
  }

  async updateUserStatus(
    userId: string,
    updateStatusDto: UpdateUserStatusDto,
  ): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    user.status = updateStatusDto.status;

    // Invalidate refresh token if suspending
    if (updateStatusDto.status === UserStatus.SUSPENDED) {
      user.refreshTokenHash = null;
    }

    await user.save();

    this.logger.log(
      `User status updated: ${user.email} -> ${updateStatusDto.status}`,
    );

    return user;
  }

  async updateUserRole(
    userId: string,
    updateRoleDto: UpdateUserRoleDto,
  ): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    user.role = updateRoleDto.role;
    await user.save();

    this.logger.log(
      `User role updated: ${user.email} -> ${updateRoleDto.role}`,
    );

    return user;
  }

  async suspendUser(userId: string): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Cannot suspend admin users through this endpoint',
      );
    }

    user.status = UserStatus.SUSPENDED;
    user.refreshTokenHash = null; // Invalidate sessions
    await user.save();

    this.logger.log(`User suspended: ${user.email}`);

    return user;
  }

  async activateUser(userId: string): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    user.status = UserStatus.ACTIVE;
    await user.save();

    this.logger.log(`User activated: ${user.email}`);

    return user;
  }

  async deleteUser(userId: string): Promise<{ message: string }> {
    const user = await this.getUserById(userId);

    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Cannot delete admin users through this endpoint',
      );
    }

    await this.userModel.findByIdAndDelete(userId).exec();

    this.logger.log(`User deleted by admin: ${user.email}`);

    return { message: 'User deleted successfully' };
  }

  async verifyUserEmail(userId: string): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationTokenExpires = null;

    if (user.status === UserStatus.PENDING) {
      user.status = UserStatus.ACTIVE;
    }

    await user.save();

    this.logger.log(`Email verified by admin for user: ${user.email}`);

    return user;
  }

  async resetUserPassword(
    userId: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const user = await this.getUserById(userId);

    const hashedPassword = await bcrypt.hash(
      newPassword,
      this.bcryptSaltRounds,
    );
    user.password = hashedPassword;
    user.refreshTokenHash = null; // Invalidate all sessions

    await user.save();

    this.logger.log(`Password reset by admin for user: ${user.email}`);

    return { message: 'Password reset successfully' };
  }

  // =====================
  // STUDENT MANAGEMENT
  // =====================

  async getStudents(query: GetStudentsQueryDto) {
    const {
      search,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      emailVerified,
    } = query;

    // Build filter object
    const filters: FilterQuery<User> = { role: UserRole.STUDENT };

    // Search filter (name or email)
    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Status filter
    if (status) {
      filters.status = status;
    }

    // Email verified filter
    if (emailVerified !== undefined) {
      filters.emailVerified = emailVerified;
    }

    // Date range filter
    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) {
        filters.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filters.createdAt.$lte = end;
      }
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Sorting
    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const [students, total] = await Promise.all([
      this.userModel
        .find(filters)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filters),
    ]);

    return {
      data: students,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStudentById(studentId: string): Promise<UserDocument> {
    const student = await this.userModel
      .findOne({ _id: studentId, role: UserRole.STUDENT })
      .exec();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return student;
  }

  async updateStudent(
    studentId: string,
    updateStudentDto: AdminUpdateUserDto,
  ): Promise<UserDocument> {
    const student = await this.getStudentById(studentId);

    const { firstName, lastName, role, status, emailVerified } =
      updateStudentDto;

    // Prevent changing role to non-student
    if (role !== undefined && role !== UserRole.STUDENT) {
      throw new BadRequestException(
        'Cannot change student role to non-student role',
      );
    }

    if (firstName !== undefined) student.firstName = firstName;
    if (lastName !== undefined) student.lastName = lastName;
    if (status !== undefined) student.status = status;
    if (emailVerified !== undefined) student.emailVerified = emailVerified;

    await student.save();

    this.logger.log(`Student updated by admin: ${student.email}`);

    return student;
  }

  async updateStudentStatus(
    studentId: string,
    updateStatusDto: UpdateUserStatusDto,
  ): Promise<UserDocument> {
    const student = await this.getStudentById(studentId);

    student.status = updateStatusDto.status;

    // Invalidate refresh token if suspending
    if (updateStatusDto.status === UserStatus.SUSPENDED) {
      student.refreshTokenHash = null;
    }

    await student.save();

    this.logger.log(
      `Student status updated: ${student.email} -> ${updateStatusDto.status}`,
    );

    return student;
  }

  async suspendStudent(studentId: string): Promise<UserDocument> {
    const student = await this.getStudentById(studentId);

    student.status = UserStatus.SUSPENDED;
    student.refreshTokenHash = null; // Invalidate sessions
    await student.save();

    this.logger.log(`Student suspended: ${student.email}`);

    return student;
  }

  async activateStudent(studentId: string): Promise<UserDocument> {
    const student = await this.getStudentById(studentId);

    student.status = UserStatus.ACTIVE;
    await student.save();

    this.logger.log(`Student activated: ${student.email}`);

    return student;
  }

  async deleteStudent(studentId: string): Promise<{ message: string }> {
    const student = await this.getStudentById(studentId);

    await this.userModel.findByIdAndDelete(studentId).exec();

    this.logger.log(`Student deleted by admin: ${student.email}`);

    return { message: 'Student deleted successfully' };
  }

  // =====================
  // TUTOR MANAGEMENT
  // =====================

  async getTeachers(query: GetStudentsQueryDto) {
    const {
      search,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      emailVerified,
    } = query;

    // Build filter object
    const filters: FilterQuery<User> = { role: UserRole.TUTOR };

    // Search filter (name or email)
    if (search) {
      filters.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    // Status filter
    if (status) {
      filters.status = status;
    }

    // Email verified filter
    if (emailVerified !== undefined) {
      filters.emailVerified = emailVerified;
    }

    // Date range filter
    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) {
        filters.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filters.createdAt.$lte = end;
      }
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Sorting
    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const [tutors, total] = await Promise.all([
      this.userModel
        .find(filters)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.userModel.countDocuments(filters),
    ]);

    return {
      data: tutors,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTeacherById(tutorId: string): Promise<UserDocument> {
    const tutor = await this.userModel
      .findOne({ _id: tutorId, role: UserRole.TUTOR })
      .exec();

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    return tutor;
  }

  async approveTeacher(tutorId: string): Promise<UserDocument> {
    const tutor = await this.userModel
      .findOne({ _id: tutorId, role: UserRole.TUTOR })
      .exec();

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    tutor.status = UserStatus.ACTIVE;
    await tutor.save();

    // Send verification email
    await this.emailService.sendTeacherVerifiedEmail(
      tutor.email,
      tutor.firstName,
    );

    this.logger.log(`Tutor verified by admin: ${tutor.email}`);

    return tutor;
  }

  async rejectTeacher(tutorId: string, reason?: string): Promise<UserDocument> {
    const tutor = await this.userModel
      .findOne({ _id: tutorId, role: UserRole.TUTOR })
      .exec();

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    tutor.status = UserStatus.SUSPENDED;
    // We could store the reason in a separate field or log it
    await tutor.save();

    this.logger.log(
      `Tutor rejected by admin: ${tutor.email}. Reason: ${reason || 'No reason provided'}`,
    );

    return tutor;
  }
}
