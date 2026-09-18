import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model, Types } from 'mongoose';
import { ChatService } from './chat.service';
import {
  Conversation,
  ConversationDocument,
  ConversationSchema,
} from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';

/**
 * A class Q&A room and a private DM are the same shape — on a one-to-one
 * platform both hold exactly the tutor and the student. Whether the chat list
 * can tell them apart is a claim about what MongoDB returns, so these run
 * against a real database rather than a stubbed model.
 */

jest.setTimeout(60_000);

let mongod: MongoMemoryServer;
let conversationModel: Model<ConversationDocument>;
let messageModel: Model<any>;
let service: ChatService;

const TUTOR = new Types.ObjectId().toString();
const STUDENT = new Types.ObjectId().toString();

/** Class ids are ObjectIds in production, so the fixtures use real ones. */
const newClassId = () => new Types.ObjectId().toString();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  conversationModel = mongoose.model(
    Conversation.name,
    ConversationSchema as any,
  ) as unknown as Model<ConversationDocument>;
  messageModel = mongoose.model(Message.name, MessageSchema as any);
  mongoose.model(
    'User',
    new mongoose.Schema({ firstName: String, lastName: String, email: String, role: String }),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await conversationModel.deleteMany({});
  await messageModel.deleteMany({});
  service = new ChatService(conversationModel, messageModel as any);
});

const idsOf = (rows: any[]): string[] => rows.map((r) => String(r._id));

describe('the chat list', () => {
  it('shows a direct conversation between two people', async () => {
    const dm = await service.findOrCreateConversation([TUTOR, STUDENT]);

    const listed = await service.getConversations(TUTOR);

    expect(idsOf(listed)).toEqual([String(dm._id)]);
  });

  /**
   * The bug this exists to prevent: every class the tutor set up added another
   * two-person room, and the list rendered each one as a separate chat with
   * the same student.
   */
  it('hides the Q&A room that belongs to a class', async () => {
    const dm = await service.findOrCreateConversation([TUTOR, STUDENT]);
    await service.createClassConversation([TUTOR, STUDENT], newClassId());
    await service.createClassConversation([TUTOR, STUDENT], newClassId());

    const listed = await service.getConversations(TUTOR);

    expect(idsOf(listed)).toEqual([String(dm._id)]);
  });

  /**
   * Conversations created before this distinction existed carry no `type`.
   * They are private chats and must keep showing, or the fix would empty
   * everyone's inbox.
   */
  it('still shows conversations that predate the class/DM distinction', async () => {
    const legacy = await conversationModel.collection.insertOne({
      participants: [new Types.ObjectId(TUTOR), new Types.ObjectId(STUDENT)],
      isBlocked: false,
      blockedBy: null,
    } as any);

    const listed = await service.getConversations(TUTOR);

    expect(idsOf(listed)).toEqual([String(legacy.insertedId)]);
  });
});

describe('opening a direct conversation', () => {
  it('reuses the existing direct conversation', async () => {
    const first = await service.findOrCreateConversation([TUTOR, STUDENT]);
    const again = await service.findOrCreateConversation([STUDENT, TUTOR]);

    expect(String(again._id)).toBe(String(first._id));
  });

  /**
   * A class room has the same two participants, so a dedup that only matched
   * on participants could drop the pair into their class Q&A thread instead
   * of their private chat.
   */
  it('never hands back a class room as the direct conversation', async () => {
    const room = await service.createClassConversation(
      [TUTOR, STUDENT],
      newClassId(),
    );

    const dm = await service.findOrCreateConversation([TUTOR, STUDENT]);

    expect(String(dm._id)).not.toBe(String(room._id));
    expect((dm as any).type).toBe('dm');
  });
});

describe('a class Q&A room', () => {
  it('records the class it belongs to', async () => {
    const classId = newClassId();
    const room = await service.createClassConversation([TUTOR, STUDENT], classId);

    const stored: any = await conversationModel.findById(room._id).lean();
    expect(stored.type).toBe('class');
    expect(String(stored.classId)).toBe(classId);
  });
});
