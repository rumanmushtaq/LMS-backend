import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  async findOrCreateConversation(
    participants: string[],
  ): Promise<ConversationDocument> {
    const participantIds = participants.map((p) => new Types.ObjectId(p));
    let conversation = await this.conversationModel.findOne({
      participants: { $all: participantIds, $size: participantIds.length },
    });

    if (!conversation) {
      conversation = await this.conversationModel.create({
        participants: participantIds,
      });
    }

    return conversation;
  }

  async getConversationById(
    conversationId: string,
  ): Promise<ConversationDocument | null> {
    if (!Types.ObjectId.isValid(conversationId)) return null;
    return this.conversationModel
      .findById(new Types.ObjectId(conversationId))
      .exec();
  }

  /**
   * Loads a conversation and proves the caller is in it.
   *
   * Every entry point that takes a conversation id from the client must go
   * through here — knowing an id is not permission to read, write or delete
   * the thread it belongs to.
   */
  /**
   * Every conversation in the system, for the admin moderation view.
   *
   * The admin screen used to call the participant-scoped list endpoint, so
   * "All Chats" only ever showed conversations the admin was personally in.
   */
  async getAllConversationsForModeration(skip = 0, limit = 50): Promise<any[]> {
    const conversations = await this.conversationModel
      .find()
      .populate('participants', 'firstName lastName email role')
      .lean()
      .exec();

    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c._id);
    const lastMessages = await this.messageModel.aggregate([
      { $match: { conversationId: { $in: conversationIds } } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: '$conversationId', lastMessage: { $first: '$$ROOT' } } },
    ]);
    const lastByConversation = new Map<string, any>(
      lastMessages.map((r) => [r._id.toString(), r.lastMessage]),
    );

    return conversations
      .map((conv) => ({
        ...conv,
        lastMessage: lastByConversation.get(conv._id.toString()) ?? null,
      }))
      .sort((a: any, b: any) => {
        const aDate = a.lastMessage?.createdAt || a.createdAt;
        const bDate = b.lastMessage?.createdAt || b.createdAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      })
      .slice(skip, skip + limit);
  }

  async assertParticipant(
    conversationId: string,
    userId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.getConversationById(conversationId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === userId?.toString(),
    );
    if (!isParticipant) {
      // Same shape as "not found" would be safer against id probing, but a
      // distinct 403 is far easier to debug and the ids are not guessable.
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    return conversation;
  }

  /**
   * Display name for a participant, used to label the chat a notification
   * opens. Falls back to an empty string rather than throwing — a missing
   * name must never stop a message being delivered.
   */
  async getParticipantName(
    conversationId: string,
    userId: string,
  ): Promise<string> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .populate<{
        participants: Array<{
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
        }>;
      }>('participants', 'firstName lastName')
      .lean()
      .exec();

    const participant = conversation?.participants?.find(
      (p) => p?._id?.toString() === userId?.toString(),
    );
    if (!participant) return '';

    return [participant.firstName, participant.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  /** Proves the caller may act on a message, via the conversation it belongs to. */
  async assertMessageParticipant(
    messageId: string,
    userId: string,
  ): Promise<MessageDocument> {
    if (!Types.ObjectId.isValid(messageId)) {
      throw new NotFoundException('Message not found');
    }
    const message = await this.messageModel.findById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.assertParticipant(message.conversationId.toString(), userId);
    return message;
  }

  /** Create a fresh (possibly group) conversation — used for class Q&A rooms. */
  async createConversation(
    participants: string[],
  ): Promise<ConversationDocument> {
    return this.conversationModel.create({
      participants: participants.map((p) => new Types.ObjectId(p)),
    });
  }

  /** Add a user to a conversation if not already a participant (idempotent). */
  async addParticipant(conversationId: string, userId: string): Promise<void> {
    await this.conversationModel.updateOne(
      { _id: new Types.ObjectId(conversationId) },
      { $addToSet: { participants: new Types.ObjectId(userId) } },
    );
  }

  async saveMessage(
    conversationId: string,
    senderId: string,
    content: string,
  ): Promise<MessageDocument> {
    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      content,
    });
    return message;
  }

  async getConversations(userId: string, skip = 0, limit = 50): Promise<any[]> {
    const viewerId = new Types.ObjectId(userId);

    const conversations = await this.conversationModel
      .find({ participants: viewerId })
      .populate('participants', 'firstName lastName email role')
      .lean()
      .exec();

    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c._id);

    // Last message and unread tally for every conversation in two aggregations
    // rather than a query per conversation.
    const [lastMessages, unreadCounts] = await Promise.all([
      this.messageModel.aggregate([
        { $match: { conversationId: { $in: conversationIds } } },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $group: { _id: '$conversationId', lastMessage: { $first: '$$ROOT' } },
        },
      ]),
      this.messageModel.aggregate([
        {
          $match: {
            conversationId: { $in: conversationIds },
            // Your own messages are never "unread" to you.
            senderId: { $ne: viewerId },
            isRead: false,
          },
        },
        { $group: { _id: '$conversationId', count: { $sum: 1 } } },
      ]),
    ]);

    const lastByConversation = new Map<string, any>(
      lastMessages.map((r) => [r._id.toString(), r.lastMessage]),
    );
    const unreadByConversation = new Map<string, number>(
      unreadCounts.map((r) => [r._id.toString(), r.count]),
    );

    const result = conversations.map((conv) => {
      const key = conv._id.toString();
      return {
        ...conv,
        lastMessage: lastByConversation.get(key) ?? null,
        unreadCount: unreadByConversation.get(key) ?? 0,
      };
    });

    // Most recently active first.
    result.sort((a: any, b: any) => {
      const aDate = a.lastMessage?.createdAt || a.createdAt;
      const bDate = b.lastMessage?.createdAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    return result.slice(skip, skip + limit);
  }

  /**
   * Marks everything the *other* participants sent as read.
   *
   * Nothing set `isRead` before this existed, so the unread badges and the
   * delivered/read ticks in the UI had no data behind them.
   */
  async markConversationRead(
    conversationId: string,
    userId: string,
  ): Promise<{ conversationId: string; updated: number }> {
    const result = await this.messageModel.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        senderId: { $ne: new Types.ObjectId(userId) },
        isRead: false,
      },
      { $set: { isRead: true } },
    );

    return { conversationId, updated: result.modifiedCount };
  }

  async getMessages(
    conversationId: string,
    skip = 0,
    limit = 50,
  ): Promise<MessageDocument[]> {
    // A chat must open on its most RECENT messages, so fetch newest-first
    // (skip walks backwards through history for older-message pagination),
    // then return the page oldest→newest for top-to-bottom rendering.
    //
    // The previous ascending sort returned the OLDEST `limit` messages, so a
    // conversation with more than `limit` messages opened on its beginning and
    // never showed the latest message the list preview promised.
    const messages = await this.messageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      // _id breaks ties: two messages saved in the same millisecond would
      // otherwise come back in an arbitrary order.
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    return messages.reverse();
  }

  async blockConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    conversation.isBlocked = true;
    conversation.blockedBy = new Types.ObjectId(userId);
    return conversation.save();
  }

  async unblockConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.blockedBy?.toString() !== userId.toString()) {
      throw new ForbiddenException('You did not block this conversation');
    }

    conversation.isBlocked = false;
    conversation.blockedBy = null;
    return conversation.save();
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.messageModel.deleteMany({
      conversationId: new Types.ObjectId(conversationId),
    });
    await this.conversationModel.findByIdAndDelete(conversationId);
  }

  async flagMessage(
    messageId: string,
    reason: string,
  ): Promise<MessageDocument> {
    const message = await this.messageModel.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    message.isFlagged = true;
    message.flagReason = reason;
    return message.save();
  }

  // --- Admin Methods ---

  async getFlaggedMessages(skip = 0, limit = 50): Promise<any[]> {
    return this.messageModel
      .find({ isFlagged: true })
      .populate('senderId', 'firstName lastName email role')
      .populate('conversationId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async resolveFlagMessage(messageId: string): Promise<MessageDocument> {
    const message = await this.messageModel.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    message.isFlagged = false;
    message.flagReason = null;
    return message.save();
  }
}
