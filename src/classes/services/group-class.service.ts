import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  ClassSession,
  ClassSessionDocument,
  ClassStatus,
} from '../schemas/class.schema';

/** What a tutor supplies when opening a group class. */
export interface GroupClassDetails {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  maxStudents: number;
  price: number;
}

/** One person on a roster. Only `_id` is guaranteed — the user row may be gone. */
export interface RosterEntry {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

/** The offer an invite link shows to someone who has not paid yet. */
export interface GroupClassPreview {
  classId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  price: number;
  maxStudents: number;
  seatsLeft: number;
  open: boolean;
}

/**
 * Group classes: opened by a tutor, filled from an invite link by students who
 * have paid, and left permanently on request.
 *
 * Every membership change is ONE conditional update. Read-then-write would
 * let two students clear the same "is there a seat?" check and both take the
 * last one; expressing the precondition inside the query makes MongoDB the
 * arbiter, so the loser simply matches no document.
 *
 * A `null` result therefore means "the precondition did not hold" without
 * saying which one. Nothing has been written at that point, so the service
 * re-reads the class purely to raise an accurate error.
 */
@Injectable()
export class GroupClassService {
  constructor(
    @InjectModel(ClassSession.name)
    private readonly classSessionModel: Model<ClassSessionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * These reference paths are declared with the BSON `Types.ObjectId`
   * constructor rather than `SchemaTypes.ObjectId`, so Mongoose registers them
   * as Mixed and casts nothing: `{ tutorId: '<hex>' }` silently matches no
   * document. Ids therefore have to be converted before they reach a query —
   * the same thing ClassesService does when it writes them.
   */
  private static oid(id: string, label: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${label} id`);
    }
    return new Types.ObjectId(id);
  }

  private async load(classId: string): Promise<ClassSessionDocument> {
    const cls = await this.classSessionModel.findById(classId);
    if (!cls) throw new NotFoundException('Class not found');
    return cls;
  }

  private static holds(list: any[], userId: string): boolean {
    return (list ?? []).some((entry) => entry?.toString() === userId);
  }

  /**
   * Seat a paying student.
   *
   * Callable only once payment for this class is confirmed — it is what the
   * order flow calls on success, never a student-facing route.
   */
  async join(
    classId: string,
    studentId: string,
  ): Promise<ClassSessionDocument> {
    const student = GroupClassService.oid(studentId, 'student');
    const seated = await this.classSessionModel.findOneAndUpdate(
      {
        _id: GroupClassService.oid(classId, 'class'),
        visibility: 'group',
        status: ClassStatus.SCHEDULED,
        students: { $ne: student },
        leftStudents: { $ne: student },
        $expr: { $lt: [{ $size: '$students' }, '$maxStudents'] },
      },
      { $push: { students: student } },
      { new: true },
    );
    if (seated) return seated;

    // Nothing was written, so the class can be re-read to say why. Every
    // reason except a full class raises here; a full class is what is left.
    await this.loadJoinable(classId, studentId);
    throw new BadRequestException('This class is full');
  }

  /**
   * The class, if this student could take a seat in it — used by checkout to
   * avoid charging for a seat that could never be granted.
   *
   * Says nothing about availability: seats are counted separately, and only
   * `join` decides that authoritatively.
   */
  async loadJoinable(
    classId: string,
    studentId: string,
  ): Promise<ClassSessionDocument> {
    const cls = await this.load(classId);
    if (cls.visibility !== 'group' || cls.status !== ClassStatus.SCHEDULED) {
      throw new BadRequestException('This class is not open for joining');
    }
    if (GroupClassService.holds(cls.leftStudents, studentId)) {
      throw new BadRequestException(
        'You left this class and cannot join it again',
      );
    }
    if (GroupClassService.holds(cls.students, studentId)) {
      throw new BadRequestException('You are already enrolled in this class');
    }
    return cls;
  }

  /**
   * Leave for good. The seat is released for someone else in the same update
   * that bars this student from returning — the two must not be separable.
   */
  async leave(
    classId: string,
    studentId: string,
  ): Promise<ClassSessionDocument> {
    const student = GroupClassService.oid(studentId, 'student');
    const left = await this.classSessionModel.findOneAndUpdate(
      { _id: GroupClassService.oid(classId, 'class'), students: student },
      { $pull: { students: student }, $addToSet: { leftStudents: student } },
      { new: true },
    );
    if (left) return left;

    await this.load(classId);
    throw new BadRequestException('You are not enrolled in this class');
  }

  /** Same effect as leaving, initiated by the class's own tutor. */
  async removeByTutor(
    classId: string,
    tutorId: string,
    studentId: string,
  ): Promise<ClassSessionDocument> {
    const student = GroupClassService.oid(studentId, 'student');
    const removed = await this.classSessionModel.findOneAndUpdate(
      {
        _id: GroupClassService.oid(classId, 'class'),
        tutorId: GroupClassService.oid(tutorId, 'tutor'),
        students: student,
      },
      { $pull: { students: student }, $addToSet: { leftStudents: student } },
      { new: true },
    );
    if (removed) return removed;

    const cls = await this.load(classId);
    if (cls.tutorId?.toString() !== tutorId) {
      throw new ForbiddenException('You are not the tutor for this class');
    }
    throw new BadRequestException('That student is not enrolled in this class');
  }

  /**
   * Seats still open. Clamped at zero: a tutor may shrink `maxStudents` below
   * the current roster, and "-2 seats left" must never reach a student.
   */
  async seatsLeft(classId: string): Promise<number> {
    return GroupClassService.freeSeats(await this.load(classId));
  }

  private static freeSeats(cls: {
    maxStudents?: number;
    students?: unknown[];
  }): number {
    return Math.max(0, (cls.maxStudents ?? 0) - (cls.students?.length ?? 0));
  }

  /**
   * Who is in the class and who has gone — the tutor's management view.
   *
   * The departed list is shown, not hidden: the tutor needs to see that a
   * seat was freed by someone who can no longer come back.
   */
  async roster(
    classId: string,
    tutorId: string,
  ): Promise<{
    students: RosterEntry[];
    departed: RosterEntry[];
    seatsLeft: number;
  }> {
    const cls = await this.load(classId);
    if (cls.tutorId?.toString() !== tutorId) {
      throw new ForbiddenException('You are not the tutor for this class');
    }

    // Bare ids are useless to a tutor deciding whom to remove, and `populate`
    // cannot supply the names: these paths are registered as Mixed (see oid
    // above), which makes populate a silent no-op. So the users are read
    // directly — one query for both lists.
    const enrolled = cls.students ?? [];
    const departed = cls.leftStudents ?? [];
    const users = await this.userModel
      .find({ _id: { $in: [...enrolled, ...departed] } })
      .select('firstName lastName email')
      .lean();
    const byId = new Map(users.map((u: any) => [String(u._id), u]));
    const name = (id: any) => byId.get(String(id)) ?? id;

    return {
      students: enrolled.map(name),
      departed: departed.map(name),
      seatsLeft: GroupClassService.freeSeats(cls),
    };
  }

  /**
   * Create a class the tutor will fill from an invite link. Unlike a requested
   * one-to-one class there is nobody to approve, so it is SCHEDULED at once.
   */
  async createGroupClass(
    tutorId: string,
    details: GroupClassDetails,
  ): Promise<ClassSessionDocument> {
    return this.classSessionModel.create({
      ...details,
      tutorId: GroupClassService.oid(tutorId, 'tutor'),
      visibility: 'group',
      status: ClassStatus.SCHEDULED,
      students: [],
      leftStudents: [],
      // 32 hex chars of randomness: the link is the only thing standing
      // between a stranger and the class's price page, so it must not be
      // guessable from a class id or a counter.
      inviteToken: randomBytes(16).toString('hex'),
    });
  }

  /**
   * What the invite link shows before anyone has paid.
   *
   * Deliberately a hand-built projection rather than the class document:
   * whoever holds this link is not yet a student, so they must see the offer
   * and nothing else — no roster, and above all no broadcaster credentials.
   */
  async findByInviteToken(token: string): Promise<GroupClassPreview> {
    const cls = await this.classSessionModel
      .findOne({ inviteToken: token })
      .select(
        'title description startTime endTime price maxStudents status students',
      )
      .lean();
    if (!cls) throw new NotFoundException('Class invite not found');

    return {
      classId: String(cls._id),
      title: cls.title,
      description: cls.description,
      startTime: cls.startTime,
      endTime: cls.endTime,
      price: cls.price,
      maxStudents: cls.maxStudents,
      seatsLeft: GroupClassService.freeSeats(cls as any),
      open: cls.status === ClassStatus.SCHEDULED,
    };
  }
}
