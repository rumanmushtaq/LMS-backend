import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import {
  User,
  UserDocument,
  UserRole,
  UserSchema,
  UserStatus,
} from '../users/schemas/user.schema';
import { InstructorsService } from './instructors.service';

/**
 * Tutors' intro videos (uploaded at onboarding, or copied from the old site by
 * migration/media.ts) live in kycData.introVideoUrl; the public profile must
 * hand them to the teacher page.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let userModel: Model<UserDocument>;
let instructors: InstructorsService;

const noCourses = {
  find: () => ({ lean: () => ({ exec: async () => [] }) }),
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  userModel = mongoose.model(
    User.name,
    UserSchema as any,
  ) as unknown as Model<UserDocument>;
  instructors = new InstructorsService(userModel as any, {} as any, noCourses as any);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const tutor = (kycData: Record<string, any>) =>
  userModel.create({
    email: `${new Types.ObjectId().toString()}@example.test`,
    firstName: 'Ana',
    lastName: 'Tutor',
    password: 'x',
    role: UserRole.TUTOR,
    status: UserStatus.ACTIVE,
    kycData,
  });

describe('Instructor profile intro video', () => {
  it('returns the tutor intro video', async () => {
    const url = 'https://ik.imagekit.io/x/legacy/tutor-videos/intro.mp4';
    const t = await tutor({ introVideoUrl: url });
    const profile = await instructors.getInstructorById(String(t._id));
    expect(profile.introVideoUrl).toBe(url);
  });

  it('returns null when the tutor has no video', async () => {
    const t = await tutor({ aboutMe: 'Hi' });
    const profile = await instructors.getInstructorById(String(t._id));
    expect(profile.introVideoUrl).toBeNull();
  });
});
