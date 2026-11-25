import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import {
  User,
  UserDocument,
  UserRole,
  UserSchema,
  UserStatus,
} from '../users/schemas/user.schema';
import { AdminService } from '../admin/services/admin.service';
import { InstructorsService } from './instructors.service';

/**
 * The home page "Trending Instructors" section shows exactly the tutors an
 * admin picked. These run the admin toggle and the public list against a real
 * (in-memory) MongoDB, so the filter, the ordering and the exclusions are the
 * database's, not a mock's.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let userModel: Model<UserDocument>;
let admin: AdminService;
let instructors: InstructorsService;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  userModel = mongoose.model(
    User.name,
    UserSchema as any,
  ) as unknown as Model<UserDocument>;
  admin = new AdminService(userModel as any, { get: () => 10 } as any, {} as any);
  instructors = new InstructorsService(userModel as any, {} as any, {} as any);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await userModel.deleteMany({});
});

const user = (over: Record<string, any>) =>
  userModel.create({
    email: `${new Types.ObjectId().toString()}@example.test`,
    firstName: 'T',
    lastName: 'Tutor',
    password: 'x',
    role: UserRole.TUTOR,
    status: UserStatus.ACTIVE,
    kycData: { photoUrl: 'https://ik.imagekit.io/x/p.jpg', category: 'Music' },
    ...over,
  });

const trendingIds = async () =>
  (await instructors.getInstructors({ trending: true, limit: 8 } as any)).data.map(
    (t) => t._id,
  );

describe('Trending instructors', () => {
  it('shows only tutors an admin marked, the latest pick first', async () => {
    const first = await user({ firstName: 'First' });
    const second = await user({ firstName: 'Second' });
    await user({ firstName: 'NotPicked' });

    await admin.setTeacherTrending(String(first._id), true);
    await new Promise((r) => setTimeout(r, 5));
    await admin.setTeacherTrending(String(second._id), true);

    expect(await trendingIds()).toEqual([String(second._id), String(first._id)]);
    const card = (await instructors.getInstructors({ trending: true } as any)).data[0];
    expect(card.isTrending).toBe(true);
    expect(card.photoUrl).toBe('https://ik.imagekit.io/x/p.jpg');
  });

  it('removes a tutor from the section when unmarked', async () => {
    const t = await user({});
    await admin.setTeacherTrending(String(t._id), true);
    const row = await admin.setTeacherTrending(String(t._id), false);

    expect(row.isTrending).toBe(false);
    expect(await trendingIds()).toEqual([]);
  });

  it('never shows suspended or deleted tutors even if marked', async () => {
    const suspended = await user({});
    const deleted = await user({});
    await admin.setTeacherTrending(String(suspended._id), true);
    await admin.setTeacherTrending(String(deleted._id), true);
    await userModel.updateOne({ _id: suspended._id }, { status: UserStatus.SUSPENDED });
    await userModel.updateOne({ _id: deleted._id }, { isDeleted: true });

    expect(await trendingIds()).toEqual([]);
  });

  it('only tutors can be marked trending', async () => {
    const student = await user({ role: UserRole.STUDENT });
    await expect(
      admin.setTeacherTrending(String(student._id), true),
    ).rejects.toThrow('Tutor not found');
    await expect(admin.setTeacherTrending('not-an-id', true)).rejects.toThrow(
      'Tutor not found',
    );
  });

  it('leaves the normal tutor list unchanged when trending is not asked for', async () => {
    await user({});
    const marked = await user({});
    await admin.setTeacherTrending(String(marked._id), true);

    expect(
      (await instructors.getInstructors({ limit: 9 } as any)).data,
    ).toHaveLength(2);
  });
});
