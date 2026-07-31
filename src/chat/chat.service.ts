import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  async findOrCreateConversation(participants: string[]): Promise<ConversationDocument> {
    const participantIds = participants.map(p => new Types.ObjectId(p));
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

  async getConversationById(conversationId: string): Promise<ConversationDocument | null> {
    return this.conversationModel.findById(new Types.ObjectId(conversationId)).exec();
  }

  /** Create a fresh (possibly group) conversation — used for class Q&A rooms. */
  async createConversation(participants: string[]): Promise<ConversationDocument> {
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

  async saveMessage(conversationId: string, senderId: string, content: string): Promise<MessageDocument> {
    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      content,
    });
    return message;
  }

  async getConversations(userId: string, skip = 0, limit = 50): Promise<any[]> {
    const conversations = await this.conversationModel
      .find({ participants: new Types.ObjectId(userId) })
      .populate('participants', 'firstName lastName email role')
      .exec();
    
    // For each conversation, we can optionally get the last message.
    const result = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await this.messageModel
          .findOne({ conversationId: conv._id })
          .sort({ createdAt: -1 })
          .exec();
        return {
          ...conv.toObject(),
          lastMessage,
        };
      })
    );
    
    // Sort by last message date
    const sortedResult = result.sort((a: any, b: any) => {
      const aDate = a.lastMessage?.createdAt || a.createdAt;
      const bDate = b.lastMessage?.createdAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });

    return sortedResult.slice(skip, skip + limit);
  }

  async getMessages(conversationId: string, skip = 0, limit = 50): Promise<MessageDocument[]> {
    return this.messageModel
      .find({ conversationId: new Types.ObjectId(conversationId) })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async blockConversation(conversationId: string, userId: string): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    conversation.isBlocked = true;
    conversation.blockedBy = new Types.ObjectId(userId);
    return conversation.save();
  }

  async unblockConversation(conversationId: string, userId: string): Promise<ConversationDocument> {
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
    await this.messageModel.deleteMany({ conversationId: new Types.ObjectId(conversationId) });
    await this.conversationModel.findByIdAndDelete(conversationId);
  }

  async flagMessage(messageId: string, reason: string): Promise<MessageDocument> {
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
