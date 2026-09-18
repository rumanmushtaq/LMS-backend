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

export interface GrowthAnalytics {
  /** Short month labels for the x-axis, oldest → newest. */
  categories: string[];
  /** Cumulative teacher totals at each month-end, aligned to `categories`. */
  teachers: number[];
  /** Cumulative student totals at each month-end, aligned to `categories`. */
  students: number[];
  /** New teachers registered in the most recent month (for the card trend). */
  teacherDelta: number;
  /** New students registered in the most recent month (for the card trend). */
  studentDelta: number;
}

/**
 * A tutor as the admin screens consume it: the sanitised user document plus
 * the subject fields derived from `kycData`.
 *
 * Declared explicitly because spreading `toJSON()` produces a type TypeScript
 * cannot name across module boundaries.
 */
export interface TutorRow extends Record<string, any> {
  /** Comma-joined subjects for the table cell; null when none are set. */
  subject: string | null;
  subjects: string[];
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
      this.userModel.countDocuments({ isDeleted: { $ne: true } }),
      this.userModel.countDocuments({
        role: UserRole.STUDENT,
        isDeleted: { $ne: true },
      }),
      this.userModel.countDocuments({
        role: UserRole.TUTOR,
        isDeleted: { $ne: true },
      }),
      this.userModel.countDocuments({
        role: UserRole.ADMIN,
        isDeleted: { $ne: true },
      }),
      this.userModel.countDocuments({
        status: UserStatus.ACTIVE,
        isDeleted: { $ne: true },
      }),
      this.userModel.countDocuments({
        status: UserStatus.PENDING,
        isDeleted: { $ne: true },
      }),
      this.userModel.countDocuments({
        status: UserStatus.SUSPENDED,
        isDeleted: { $ne: true },
      }),
      this.userModel.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        isDeleted: { $ne: true },
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

  /**
   * Cumulative teacher vs student totals at the end of each of the last
   * `months` months. The dashboard chart wants a growth curve, so we take the
   * count of everyone who already existed before the window (the baseline) and
   * add each month's new signups on top — every point is the running total as
   * of that month, not that month's isolated intake.
   */
  async getGrowthAnalytics(months = 12): Promise<GrowthAnalytics> {
    // Build the month buckets, oldest → newest, ending with the current month.
    const now = new Date();
    const windowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );

    const buckets: { key: string; label: string }[] = [];
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    for (let i = 0; i < months; i++) {
      const d = new Date(
        Date.UTC(
          windowStart.getUTCFullYear(),
          windowStart.getUTCMonth() + i,
          1,
        ),
      );
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth();
      // Mark January (and the very first bucket) with a 2-digit year so a
      // window that crosses a year boundary stays readable on the axis.
      const label =
        m === 0 || i === 0
          ? `${monthNames[m]} '${String(y).slice(2)}`
          : monthNames[m];
      buckets.push({ key: `${y}-${String(m + 1).padStart(2, '0')}`, label });
    }

    // Per-role: baseline (everyone before the window) + new signups per month.
    const perRole = async (role: UserRole) => {
      const [baseline, monthly] = await Promise.all([
        this.userModel.countDocuments({
          role,
          isDeleted: { $ne: true },
          createdAt: { $lt: windowStart },
        }),
        this.userModel.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              role,
              isDeleted: { $ne: true },
              createdAt: { $gte: windowStart },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m', date: '$createdAt' },
              },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const byMonth = new Map(monthly.map((r) => [r._id, r.count]));
      let running = baseline;
      const cumulative = buckets.map((b) => {
        running += byMonth.get(b.key) ?? 0;
        return running;
      });
      const delta = byMonth.get(buckets[buckets.length - 1].key) ?? 0;
      return { cumulative, delta };
    };

    const [teacherSeries, studentSeries] = await Promise.all([
      perRole(UserRole.TUTOR),
      perRole(UserRole.STUDENT),
    ]);

    return {
      categories: buckets.map((b) => b.label),
      teachers: teacherSeries.cumulative,
      students: studentSeries.cumulative,
      teacherDelta: teacherSeries.delta,
      studentDelta: studentSeries.delta,
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

    const filter: FilterQuery<User> = { isDeleted: { $ne: true } };

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

    if (!user || user.isDeleted) {
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
    const { status } = updateStatusDto;
    this.logger.log(`updateUserStatus: ID ${userId}, Target Status: ${status}`);

    const user = await this.getUserById(userId);

    // Set status
    user.status = status as UserStatus;

    // Invalidate refresh token if suspending
    if (status === 'suspended') {
      user.refreshTokenHash = null;
    }

    await user.save();

    this.logger.log(
      `updateUserStatus: DB Save Success. ${user.email} is now ${user.status} (Role: ${user.role})`,
    );

    // Send email notification based on new status
    // Using string literals for robustness in case of enum mismatch issues
    if (status === 'active') {
      this.logger.log(
        `updateUserStatus: Sending activation email to ${user.email}`,
      );
      await this.emailService.sendAccountActivatedEmail(
        user.email,
        user.firstName,
      );
    } else if (status === 'suspended') {
      this.logger.log(
        `updateUserStatus: Sending suspension email to ${user.email}`,
      );
      await this.emailService.sendAccountSuspendedEmail(
        user.email,
        user.firstName,
      );
    }

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

    // Revoke email-verified flag for tutors on suspension
    if (user.role === UserRole.TUTOR) {
      user.emailVerified = false;
    }

    await user.save();

    // Send email notification
    await this.emailService.sendAccountSuspendedEmail(
      user.email,
      user.firstName,
    );

    this.logger.log(`User suspended: ${user.email}`);

    return user;
  }

  async activateUser(userId: string): Promise<UserDocument> {
    const user = await this.getUserById(userId);

    user.status = UserStatus.ACTIVE;
    await user.save();

    // Send email notification
    await this.emailService.sendAccountActivatedEmail(
      user.email,
      user.firstName,
    );

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

    // Send email notification before deletion
    await this.emailService.sendAccountDeletedEmail(user.email, user.firstName);

    // Perform soft delete
    user.isDeleted = true;
    user.deletedAt = new Date();
    await user.save();

    this.logger.log(`User soft-deleted by admin: ${user.email}`);

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
    const filters: FilterQuery<User> = {
      role: UserRole.STUDENT,
      isDeleted: { $ne: true },
    };

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
      .findOne({
        _id: studentId,
        role: UserRole.STUDENT,
        isDeleted: { $ne: true },
      })
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

    // Send email notification
    await this.emailService.sendAccountSuspendedEmail(
      student.email,
      student.firstName,
    );

    this.logger.log(`Student suspended: ${student.email}`);

    return student;
  }

  async activateStudent(studentId: string): Promise<UserDocument> {
    const student = await this.getStudentById(studentId);

    student.status = UserStatus.ACTIVE;
    await student.save();

    // Send email notification
    await this.emailService.sendAccountActivatedEmail(
      student.email,
      student.firstName,
    );

    this.logger.log(`Student activated: ${student.email}`);

    return student;
  }

  async deleteStudent(studentId: string): Promise<{ message: string }> {
    const student = await this.getStudentById(studentId);

    // Send email notification before deletion
    await this.emailService.sendAccountDeletedEmail(
      student.email,
      student.firstName,
    );

    await this.userModel.findByIdAndDelete(studentId).exec();

    this.logger.log(`Student deleted by admin: ${student.email}`);

    return { message: 'Student deleted successfully' };
  }

  // =====================
  // TUTOR MANAGEMENT
  // =====================

  /**
   * A tutor's subjects, for display in the admin teachers table.
   *
   * Subject data is spread across four keys in the schemaless `kycData` blob
   * because different flows wrote different ones: onboarding KYC writes
   * `subjects`, the profile editor writes `specialties` and `category`, and
   * some records carry `categories`. The public instructors listing already
   * merges the same set, so this keeps admin consistent with it.
   */
  private deriveSubjects(kycData: Record<string, any> | undefined): string[] {
    const kc = kycData ?? {};

    const candidates = [
      ...(Array.isArray(kc.subjects) ? kc.subjects : []),
      ...(Array.isArray(kc.categories) ? kc.categories : []),
      ...(Array.isArray(kc.specialties) ? kc.specialties : []),
      kc.category,
    ];

    // Trim, drop blanks, de-duplicate case-insensitively but keep the first
    // spelling the tutor actually used.
    const seen = new Set<string>();
    const subjects: string[] = [];

    for (const raw of candidates) {
      if (typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;

      const key = value.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      subjects.push(value);
    }

    return subjects;
  }

  /**
   * Adds the derived subject fields to a tutor row.
   *
   * `toJSON()` rather than `.lean()` deliberately: the User schema's toJSON
   * transform strips password, refresh token hash, 2FA secret and the
   * verification tokens. A lean query skips that transform and would put all
   * of them on the wire.
   */
  private withSubjects(tutor: UserDocument): TutorRow {
    const subjects = this.deriveSubjects(tutor.kycData);

    return {
      ...tutor.toJSON(),
      /** Display string for the admin table. */
      subject: subjects.join(', ') || null,
      /** Full list, for filtering and detail views. */
      subjects,
    };
  }

  async getTeachers(query: GetStudentsQueryDto): Promise<{
    data: TutorRow[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }> {
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
    const filters: FilterQuery<User> = {
      role: UserRole.TUTOR,
      isDeleted: { $ne: true },
    };

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
      data: tutors.map((tutor) => this.withSubjects(tutor)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTeacherById(tutorId: string): Promise<TutorRow> {
    const tutor = await this.userModel
      .findOne({ _id: tutorId, role: UserRole.TUTOR, isDeleted: { $ne: true } })
      .exec();

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    // Same shape as the list, so the detail page reads the same fields.
    return this.withSubjects(tutor);
  }

  async approveTeacher(tutorId: string): Promise<UserDocument> {
    const tutor = await this.userModel
      .findOne({ _id: tutorId, role: UserRole.TUTOR, isDeleted: { $ne: true } })
      .exec();

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    tutor.status = UserStatus.ACTIVE;
    tutor.emailVerified = true;
    await tutor.save();

    // Send verification email
    await this.emailService.sendTeacherVerifiedEmail(
      tutor.email,
      tutor.firstName,
    );

    this.logger.log(
      `Tutor approved & emailVerified set to true: ${tutor.email}`,
    );

    return tutor;
  }

  async rejectTeacher(tutorId: string, reason?: string): Promise<UserDocument> {
    const tutor = await this.userModel
      .findOne({ _id: tutorId, role: UserRole.TUTOR, isDeleted: { $ne: true } })
      .exec();

    if (!tutor) {
      throw new NotFoundException('Tutor not found');
    }

    tutor.status = UserStatus.SUSPENDED;
    tutor.emailVerified = false;
    tutor.refreshTokenHash = null; // Invalidate any active sessions
    await tutor.save();

    this.logger.log(
      `Tutor rejected & emailVerified set to false: ${tutor.email}. Reason: ${reason || 'No reason provided'}`,
    );

    return tutor;
  }
}
