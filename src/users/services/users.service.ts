import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { GetStudentsQueryDto } from '../dto/get-students.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findById(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async deleteAccount(user: UserDocument): Promise<{ message: string }> {
    await this.userModel.findByIdAndDelete(user._id).exec();

    this.logger.log(`Account deleted: ${user.email}`);

    return { message: 'Account deleted successfully' };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.firstName) user.firstName = dto.firstName;
    if (dto.lastName) user.lastName = dto.lastName;

    // Additional profile fields go into kycData
    const newKycData = { ...(user.kycData || {}) };
    let kycUpdated = false;

    if (dto.phone !== undefined) {
      newKycData.phone = dto.phone;
      kycUpdated = true;
    }
    if (dto.profilePicture !== undefined) {
      newKycData.avatar = dto.profilePicture;
      kycUpdated = true;
    }
    if (dto.bio !== undefined) {
      newKycData.bio = dto.bio;
      newKycData.aboutMe = dto.bio;
      kycUpdated = true;
    }
    if (dto.gender !== undefined) {
      newKycData.gender = dto.gender;
      kycUpdated = true;
    }
    if (dto.dob !== undefined) {
      newKycData.dob = dto.dob;
      kycUpdated = true;
    }
    if (dto.bankAccount !== undefined) {
      newKycData.bankAccount = dto.bankAccount;
      kycUpdated = true;
    }

    if (kycUpdated) {
      // mongoose doesn't handle nested object updates perfectly unless we use Object.assign or markModified
      user.kycData = newKycData;
      user.markModified('kycData');
    }

    await user.save();
    return user;
  }

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
    const filters: FilterQuery<User> = { role: 'student' as any };

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
        filters.createdAt.$lte = new Date(endDate);
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
      .findOne({ _id: studentId, role: 'student' })
      .exec();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return student;
  }

  async updateStudentStatus(
    studentId: string,
    status: string,
  ): Promise<UserDocument> {
    const student = await this.userModel
      .findOneAndUpdate(
        { _id: studentId, role: 'student' },
        { status },
        { new: true },
      )
      .exec();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    this.logger.log(`Student status updated: ${student.email} -> ${status}`);
    return student;
  }

  async updateStudent(
    studentId: string,
    updateData: Partial<User>,
  ): Promise<UserDocument> {
    const student = await this.userModel
      .findOneAndUpdate({ _id: studentId, role: 'student' }, updateData, {
        new: true,
      })
      .exec();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    this.logger.log(`Student updated: ${student.email}`);
    return student;
  }

  async suspendStudent(studentId: string): Promise<UserDocument> {
    return this.updateStudentStatus(studentId, 'suspended');
  }

  async activateStudent(studentId: string): Promise<UserDocument> {
    return this.updateStudentStatus(studentId, 'active');
  }

  async deleteStudent(studentId: string): Promise<{ message: string }> {
    const student = await this.userModel
      .findOneAndDelete({ _id: studentId, role: 'student' })
      .exec();

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    this.logger.log(`Student deleted: ${student.email}`);
    return { message: 'Student deleted successfully' };
  }
}
