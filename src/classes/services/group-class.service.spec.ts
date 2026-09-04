import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import {
  ClassSession,
  ClassSessionDocument,
  ClassSessionSchema,
  ClassStatus,
} from '../schemas/class.schema';
import { GroupClassService } from './group-class.service';

/**
 * Seat accounting is the whole point of this service, and it is exactly the
 * part a fake model cannot prove: "two students must not take the last seat"
 * is a claim about MongoDB's atomicity, not about our TypeScript. So these
 * run against a real (in-memory) MongoDB with the real schema.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let model: Model<ClassSessionDocument>;
let userModel: Model<any>;
let service: GroupClassService;

const TUTOR = new Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // `ClassSession` extends Document, so the generated schema's generics do not
  // line up with Model<ClassSessionDocument>. The runtime shape is right; only
  // the compile-time bridge needs the cast.
  model = mongoose.model(
    ClassSession.name,
    ClassSessionSchema as any,
  ) as unknown as Model<ClassSessionDocument>;
  // The roster populates student names, so `User` must be a real model here —
  // populate against an unregistered ref throws.
  userModel = mongoose.model(
    'User',
    new mongoose.Schema({ firstName: String, lastName: String, email: String }),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await model.deleteMany({});
  await userModel.deleteMany({});
  service = new GroupClassService(model, userModel as any);
});

/** A group class with `seats` seats, open for joining. */
async function makeGroupClass(seats: number): Promise<string> {
  const doc = await model.create({
    tutorId: new Types.ObjectId(TUTOR),
    title: 'Algebra crash course',
    description: 'Group session',
    startTime: new Date(Date.now() + 3_600_000),
    endTime: new Date(Date.now() + 7_200_000),
    status: ClassStatus.SCHEDULED,
    visibility: 'group',
    maxStudents: seats,
    price: 500,
    students: [],
  });
  return doc._id.toString();
}

const newStudent = () => new Types.ObjectId().toString();

/** A real user row, so the roster has a name to show for them. */
async function makeStudentNamed(firstName: string): Promise<string> {
  const doc = await userModel.create({
    firstName,
    lastName: 'Learner',
    email: `${firstName.toLowerCase()}@example.com`,
  });
  return doc._id.toString();
}

const studentIdsOf = (cls: any): string[] =>
  cls.students.map((s: any) => s.toString());

describe('joining a group class', () => {
  it('puts the student on the roster', async () => {
    const classId = await makeGroupClass(3);
    const student = newStudent();

    const updated = await service.join(classId, student);

    expect(studentIdsOf(updated)).toEqual([student]);
  });

  it('refuses a student who is already enrolled', async () => {
    const classId = await makeGroupClass(3);
    const student = newStudent();
    await service.join(classId, student);

    await expect(service.join(classId, student)).rejects.toThrow(
      /already enrolled/i,
    );
  });

  it('refuses to seat more students than the class has seats', async () => {
    const classId = await makeGroupClass(2);
    await service.join(classId, newStudent());
    await service.join(classId, newStudent());

    await expect(service.join(classId, newStudent())).rejects.toThrow(
      /full/i,
    );
  });

  it('gives the last seat to exactly one of two simultaneous joiners', async () => {
    const classId = await makeGroupClass(1);
    const [a, b] = [newStudent(), newStudent()];

    const results = await Promise.allSettled([
      service.join(classId, a),
      service.join(classId, b),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const cls = await model.findById(classId).lean();
    expect(cls!.students).toHaveLength(1);
  });

  it('refuses to join a cancelled class', async () => {
    const classId = await makeGroupClass(3);
    await model.updateOne(
      { _id: classId },
      { status: ClassStatus.CANCELLED },
    );

    await expect(service.join(classId, newStudent())).rejects.toThrow(
      /not open/i,
    );
  });

  it('refuses to join a private one-to-one class', async () => {
    const classId = await makeGroupClass(3);
    await model.updateOne({ _id: classId }, { visibility: 'private' });

    await expect(service.join(classId, newStudent())).rejects.toThrow(
      /not open/i,
    );
  });
});

describe('leaving a group class', () => {
  it('takes the student off the roster', async () => {
    const classId = await makeGroupClass(3);
    const student = newStudent();
    await service.join(classId, student);

    const updated = await service.leave(classId, student);

    expect(studentIdsOf(updated)).toEqual([]);
  });

  it('frees the seat for someone else', async () => {
    const classId = await makeGroupClass(1);
    const leaver = newStudent();
    await service.join(classId, leaver);
    await service.leave(classId, leaver);

    const newcomer = newStudent();
    const updated = await service.join(classId, newcomer);

    expect(studentIdsOf(updated)).toEqual([newcomer]);
  });

  it('blocks the leaver from ever rejoining, even with a free seat', async () => {
    const classId = await makeGroupClass(5);
    const leaver = newStudent();
    await service.join(classId, leaver);
    await service.leave(classId, leaver);

    await expect(service.join(classId, leaver)).rejects.toThrow(
      /left this class/i,
    );
  });

  it('refuses to leave a class the student is not in', async () => {
    const classId = await makeGroupClass(3);

    await expect(service.leave(classId, newStudent())).rejects.toThrow(
      /not enrolled/i,
    );
  });
});

describe('a tutor removing a student', () => {
  it('takes the student off the roster permanently', async () => {
    const classId = await makeGroupClass(3);
    const student = newStudent();
    await service.join(classId, student);

    await service.removeByTutor(classId, TUTOR, student);

    await expect(service.join(classId, student)).rejects.toThrow(
      /left this class/i,
    );
  });

  it('refuses when the requester is not this class’s tutor', async () => {
    const classId = await makeGroupClass(3);
    const student = newStudent();
    await service.join(classId, student);

    await expect(
      service.removeByTutor(classId, newStudent(), student),
    ).rejects.toThrow(/not the tutor/i);

    const cls = await model.findById(classId).lean();
    expect(cls!.students).toHaveLength(1);
  });
});

describe('seat reporting', () => {
  it('counts the seats still available', async () => {
    const classId = await makeGroupClass(3);
    await service.join(classId, newStudent());

    await expect(service.seatsLeft(classId)).resolves.toBe(2);
  });

  it('never reports a negative number of seats', async () => {
    const classId = await makeGroupClass(1);
    await service.join(classId, newStudent());
    // A tutor shrinking the class below its current roster must not produce
    // "-2 seats left" in the UI.
    await model.updateOne({ _id: classId }, { maxStudents: 0 });

    await expect(service.seatsLeft(classId)).resolves.toBe(0);
  });
});

describe('creating a group class', () => {
  const details = {
    title: 'Trigonometry intensive',
    description: 'Four-week group course',
    startTime: new Date(Date.now() + 86_400_000),
    endTime: new Date(Date.now() + 90_000_000),
    maxStudents: 20,
    price: 750,
  };

  it('opens the class for joining with an empty roster', async () => {
    const created = await service.createGroupClass(TUTOR, details);

    expect(created.visibility).toBe('group');
    expect(created.status).toBe(ClassStatus.SCHEDULED);
    expect(created.students).toHaveLength(0);
    expect(created.maxStudents).toBe(20);
    expect(created.price).toBe(750);
  });

  it('gives every class a different invite token', async () => {
    const a = await service.createGroupClass(TUTOR, details);
    const b = await service.createGroupClass(TUTOR, details);

    expect(a.inviteToken).toBeTruthy();
    expect(a.inviteToken).not.toEqual(b.inviteToken);
  });
});

describe('the invite link', () => {
  it('shows a student what they would be paying for', async () => {
    const created = await service.createGroupClass(TUTOR, {
      title: 'Trigonometry intensive',
      description: 'Four-week group course',
      startTime: new Date(Date.now() + 86_400_000),
      endTime: new Date(Date.now() + 90_000_000),
      maxStudents: 4,
      price: 750,
    });
    await service.join(created._id.toString(), newStudent());

    const preview = await service.findByInviteToken(created.inviteToken!);

    expect(preview).toMatchObject({
      title: 'Trigonometry intensive',
      price: 750,
      seatsLeft: 3,
    });
  });

  it('never exposes the broadcaster secrets through the invite link', async () => {
    const created = await service.createGroupClass(TUTOR, {
      title: 'x',
      description: 'y',
      startTime: new Date(Date.now() + 86_400_000),
      endTime: new Date(Date.now() + 90_000_000),
      maxStudents: 4,
      price: 10,
    });
    await model.updateOne(
      { _id: created._id },
      {
        'liveSession.streamKey': 'super-secret',
        'liveSession.rtmpUrl': 'rtmp://ingest',
      },
    );

    const preview: any = await service.findByInviteToken(created.inviteToken!);

    expect(JSON.stringify(preview)).not.toContain('super-secret');
    expect(JSON.stringify(preview)).not.toContain('rtmp://ingest');
  });

  it('rejects an unknown token', async () => {
    await expect(service.findByInviteToken('nope')).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('the tutor’s roster view', () => {
  it('separates who is in the class from who has left', async () => {
    const classId = await makeGroupClass(5);
    const staying = newStudent();
    const leaving = newStudent();
    await service.join(classId, staying);
    await service.join(classId, leaving);
    await service.leave(classId, leaving);

    const roster = await service.roster(classId, TUTOR);

    expect(roster.students.map((s: any) => String(s._id ?? s))).toEqual([
      staying,
    ]);
    expect(roster.departed.map((s: any) => String(s._id ?? s))).toEqual([
      leaving,
    ]);
    expect(roster.seatsLeft).toBe(4);
  });

  /**
   * A roster of bare ids is useless to a tutor deciding whom to remove, so it
   * carries the names the UI shows.
   */
  it('names the students rather than listing raw ids', async () => {
    const classId = await makeGroupClass(5);
    const staying = await makeStudentNamed('Ada');
    const leaving = await makeStudentNamed('Grace');
    await service.join(classId, staying);
    await service.join(classId, leaving);
    await service.leave(classId, leaving);

    const roster = await service.roster(classId, TUTOR);

    expect((roster.students[0] as any).firstName).toBe('Ada');
    expect((roster.departed[0] as any).firstName).toBe('Grace');
  });

  it('refuses to show the roster to anyone but the class\u2019s tutor', async () => {
    const classId = await makeGroupClass(5);

    await expect(service.roster(classId, newStudent())).rejects.toThrow(
      /not the tutor/i,
    );
  });
});

describe('checking whether a student may join', () => {
  it('returns the class when the seat is theirs to buy', async () => {
    const classId = await makeGroupClass(3);

    const cls = await service.loadJoinable(classId, newStudent());

    expect(cls._id.toString()).toBe(classId);
  });

  it('rejects a student who already left', async () => {
    const classId = await makeGroupClass(3);
    const leaver = newStudent();
    await service.join(classId, leaver);
    await service.leave(classId, leaver);

    await expect(service.loadJoinable(classId, leaver)).rejects.toThrow(
      /left this class/i,
    );
  });

  it('rejects a student who is already enrolled', async () => {
    const classId = await makeGroupClass(3);
    const student = newStudent();
    await service.join(classId, student);

    await expect(service.loadJoinable(classId, student)).rejects.toThrow(
      /already enrolled/i,
    );
  });

  it('rejects a class that is not open', async () => {
    const classId = await makeGroupClass(3);
    await model.updateOne({ _id: classId }, { status: ClassStatus.CANCELLED });

    await expect(
      service.loadJoinable(classId, newStudent()),
    ).rejects.toThrow(/not open/i);
  });
});
