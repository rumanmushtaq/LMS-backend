import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, SortOrder } from 'mongoose';
import {
  User,
  UserDocument,
  UserRole,
  UserStatus,
} from '@/users/schemas/user.schema';
import { Order, OrderDocument } from '@/orders/schemas/order.schema';
import { GetInstructorsDto, InstructorSortBy } from './dto';

export interface EducationItem {
  degree: string;
  institution: string;
  period: string;
}

export interface ExperienceItem {
  role: string;
  company: string;
  period: string;
}

export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  youtube?: string;
  linkedin?: string;
}

export interface InstructorProfileData {
  _id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  avatar: string | null;
  title: string | null;
  bio: string | null;
  specialties: string[];
  categories: string[];
  level: string | null;
  rating: number;
  reviewCount: number;
  lessonCount: number;
  totalDurationMinutes: number;
  studentCount: number;
  hourlyRate: number | null;
  createdAt: Date;
}

export interface InstructorDetailData extends InstructorProfileData {
  aboutMe: string | null;
  education: EducationItem[];
  experience: ExperienceItem[];
  certifications: string[];
  social: SocialLinks;
  phone: string | null;
  address: string | null;
}

@Injectable()
export class InstructorsService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  async getInstructors(dto: GetInstructorsDto): Promise<{
    data: InstructorProfileData[];
    totalCount: number;
    totalPages: number;
    currentPage: number;
  }> {
    const {
      page = 1,
      limit = 9,
      search,
      category,
      level,
      instructorIds,
      priceMin,
      priceMax,
      sortBy = InstructorSortBy.NEWLY_PUBLISHED,
    } = dto;

    // Base filter: only active tutors
    const filter: FilterQuery<UserDocument> = {
      role: UserRole.TUTOR,
      status: UserStatus.ACTIVE,
    };

    // Search by name
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { 'kycData.title': { $regex: search, $options: 'i' } },
      ];
    }

    // Filter by category (stored in kycData.categories array)
    if (category) {
      filter['kycData.categories'] = { $in: [category] };
    }

    // Filter by level
    if (level) {
      filter['kycData.level'] = level;
    }

    // Filter by specific instructor IDs
    if (instructorIds && instructorIds.length > 0) {
      filter._id = { $in: instructorIds };
    }

    // Filter by hourly rate range
    if (priceMin !== undefined || priceMax !== undefined) {
      filter['kycData.hourlyRate'] = {};
      if (priceMin !== undefined) {
        filter['kycData.hourlyRate'].$gte = priceMin;
      }
      if (priceMax !== undefined) {
        filter['kycData.hourlyRate'].$lte = priceMax;
      }
    }

    // Build sort
    let sortOption: Record<string, SortOrder> = { createdAt: -1 };
    switch (sortBy) {
      case InstructorSortBy.RATING:
        sortOption = { 'kycData.rating': -1 };
        break;
      case InstructorSortBy.STUDENTS:
        sortOption = { 'kycData.studentCount': -1 };
        break;
      case InstructorSortBy.NAME_ASC:
        sortOption = { firstName: 1 };
        break;
      case InstructorSortBy.NAME_DESC:
        sortOption = { firstName: -1 };
        break;
      default:
        sortOption = { createdAt: -1 };
    }

    const skip = (page - 1) * limit;
    const [users, totalCount] = await Promise.all([
      this.userModel
        .find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .select('firstName lastName email kycData createdAt')
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    const data: InstructorProfileData[] = users.map((u) => {
      const kc = (u.kycData as Record<string, any>) || {};
      return {
        _id: String(u._id),
        firstName: u.firstName,
        lastName: u.lastName,
        fullName: `${u.firstName} ${u.lastName}`,
        email: u.email,
        avatar: kc.avatar || null,
        title: kc.title || null,
        bio: kc.bio || null,
        specialties: kc.specialties || [],
        categories: kc.categories || [],
        level: kc.level || null,
        rating: kc.rating ?? 0,
        reviewCount: kc.reviewCount ?? 0,
        lessonCount: kc.lessonCount ?? 0,
        totalDurationMinutes: kc.totalDurationMinutes ?? 0,
        studentCount: kc.studentCount ?? 0,
        hourlyRate: kc.hourlyRate ?? null,
        createdAt: u.createdAt,
      };
    });

    return {
      data,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    };
  }

  /**
   * Returns aggregated filter options for the sidebar:
   * - distinct categories
   * - distinct levels
   * - list of instructors (id + name) for "Instructors" filter
   * - min/max hourly rate
   */
  async getFilterOptions(): Promise<{
    categories: { name: string; count: number }[];
    levels: { name: string; count: number }[];
    instructors: { _id: string; fullName: string; count: number }[];
    priceRange: { min: number; max: number };
  }> {
    const baseFilter: FilterQuery<UserDocument> = {
      role: UserRole.TUTOR,
      status: UserStatus.ACTIVE,
    };

    const [users, priceAgg] = await Promise.all([
      this.userModel
        .find(baseFilter)
        .select('firstName lastName kycData')
        .lean()
        .exec(),
      this.userModel
        .aggregate([
          {
            $match: {
              ...baseFilter,
              'kycData.hourlyRate': { $exists: true, $ne: null },
            },
          },
          {
            $group: {
              _id: null,
              min: { $min: '$kycData.hourlyRate' },
              max: { $max: '$kycData.hourlyRate' },
            },
          },
        ])
        .exec(),
    ]);

    const categoryMap = new Map<string, number>();
    const levelMap = new Map<string, number>();
    const instructorList: { _id: string; fullName: string; count: number }[] =
      [];

    for (const u of users) {
      const kc = (u.kycData as Record<string, any>) || {};
      const cats: string[] = kc.categories || [];
      cats.forEach((c) => categoryMap.set(c, (categoryMap.get(c) ?? 0) + 1));
      if (kc.level) {
        levelMap.set(kc.level, (levelMap.get(kc.level) ?? 0) + 1);
      }
      instructorList.push({
        _id: String(u._id),
        fullName: `${u.firstName} ${u.lastName}`,
        count: kc.lessonCount ?? 0,
      });
    }

    return {
      categories: Array.from(categoryMap.entries()).map(([name, count]) => ({
        name,
        count,
      })),
      levels: Array.from(levelMap.entries()).map(([name, count]) => ({
        name,
        count,
      })),
      instructors: instructorList,
      priceRange: {
        min: priceAgg[0]?.min ?? 0,
        max: priceAgg[0]?.max ?? 100000,
      },
    };
  }

  async getInstructorById(id: string): Promise<InstructorDetailData> {
    const user = await this.userModel
      .findOne({
        _id: id,
        role: UserRole.TUTOR,
        status: UserStatus.ACTIVE,
      })
      .select('firstName lastName email kycData createdAt')
      .lean()
      .exec();

    if (!user) {
      throw new NotFoundException(`Instructor with id "${id}" not found.`);
    }

    const kc = (user.kycData as Record<string, any>) || {};

    return {
      _id: String(user._id),
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
      email: user.email,
      avatar: kc.avatar || null,
      title: kc.title || null,
      bio: kc.bio || null,
      aboutMe: kc.aboutMe || kc.bio || null,
      specialties: kc.specialties || [],
      categories: kc.categories || [],
      level: kc.level || null,
      rating: kc.rating ?? 0,
      reviewCount: kc.reviewCount ?? 0,
      lessonCount: kc.lessonCount ?? 0,
      totalDurationMinutes: kc.totalDurationMinutes ?? 0,
      studentCount: kc.studentCount ?? 0,
      hourlyRate: kc.hourlyRate ?? null,
      createdAt: user.createdAt,
      education: kc.education || [],
      experience: kc.experience || [],
      certifications: kc.certifications || [],
      social: {
        facebook: kc.social?.facebook || undefined,
        instagram: kc.social?.instagram || undefined,
        twitter: kc.social?.twitter || undefined,
        youtube: kc.social?.youtube || undefined,
        linkedin: kc.social?.linkedin || undefined,
      },
      phone: kc.phone || null,
      address: kc.address || null,
    };
  }

  async getMyStudents(instructorId: string, page = 1, limit = 9, search = '') {
    const filter: any = { instructorId };

    // First, find all orders for this instructor to get unique student IDs
    const orders = await this.orderModel
      .find(filter)
      .select('studentId')
      .lean()
      .exec();
    const studentIds = [...new Set(orders.map((o) => o.studentId.toString()))];

    const studentFilter: FilterQuery<UserDocument> = {
      _id: { $in: studentIds },
    };
    if (search) {
      studentFilter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const [users, totalCount] = await Promise.all([
      this.userModel
        .find(studentFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('firstName lastName kycData createdAt')
        .lean()
        .exec(),
      this.userModel.countDocuments(studentFilter).exec(),
    ]);

    // For each student, get how many courses they bought from this instructor
    const enrichedUsers = await Promise.all(
      users.map(async (u) => {
        const courseCount = await this.orderModel.countDocuments({
          instructorId,
          studentId: u._id,
        });

        const kc = (u.kycData as any) || {};
        return {
          _id: String(u._id),
          fullName: `${u.firstName} ${u.lastName}`,
          avatar: kc.avatar || null,
          location: kc.address || null, // Mapping address to location
          joinDate: u.createdAt,
          courseCount,
        };
      }),
    );

    return {
      data: enrichedUsers,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
    };
  }

  async getMyEarnings(
    instructorId: string,
    chartYear?: number,
    startDate?: string,
    endDate?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    const yearForChart = chartYear || currentYear;

    const allOrders = await this.orderModel
      .find({ instructorId })
      .lean()
      .exec();

    let totalRevenue = 0;
    let studentsThisMonth = new Set<string>();

    // Earnings by month (0-11)
    const earningsByMonth = new Array(12).fill(0);

    allOrders.forEach((order) => {
      totalRevenue += order.amountPaid;

      const orderDate = new Date(order.orderDate);
      if (orderDate.getFullYear() === yearForChart) {
        earningsByMonth[orderDate.getMonth()] += order.amountPaid;
      }
      if (
        orderDate.getFullYear() === currentYear &&
        orderDate.getMonth() === currentMonth
      ) {
        studentsThisMonth.add(order.studentId.toString());
      }
    });

    const query: FilterQuery<OrderDocument> = { instructorId };
    if (startDate || endDate) {
      query.orderDate = {};
      if (startDate) {
        query.orderDate.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDay = new Date(endDate);
        endDay.setHours(23, 59, 59, 999);
        query.orderDate.$lte = endDay;
      }
    }

    const skip = (page - 1) * limit;

    const [pagedOrders, totalOrdersCount] = await Promise.all([
      this.orderModel
        .find(query)
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit)
        .populate('courseId', 'title')
        .lean()
        .exec(),
      this.orderModel.countDocuments(query).exec(),
    ]);

    const recentOrders = pagedOrders.map((o: any) => ({
      orderId: String(o._id).slice(-6).toUpperCase(), // Fake short ID
      date: o.orderDate,
      courseName: o.courseId?.title || 'Unknown Course',
      amount: o.amountPaid,
    }));

    const averageRating = 4.8;

    return {
      totalRevenue,
      averageRating,
      studentsThisMonth: studentsThisMonth.size,
      earningsByMonth,
      recentOrders,
      pagination: {
        total: totalOrdersCount,
        page,
        limit,
        totalPages: Math.ceil(totalOrdersCount / limit),
      },
    };
  }
}
