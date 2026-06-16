import { Injectable, NotFoundException } from '@nestjs/common';
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

  async saveMessage(conversationId: string, senderId: string, content: string): Promise<MessageDocument> {
    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      content,
    });
    return message;
  }

  async getConversations(userId: string): Promise<any[]> {
    const objectId = new Types.ObjectId(userId);
    const conversations = await this.conversationModel
      .find({ participants: objectId })
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
    return result.sort((a: any, b: any) => {
      const aDate = a.lastMessage?.createdAt || a.createdAt;
      const bDate = b.lastMessage?.createdAt || b.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
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

  async flagMessage(messageId: string, reason: string): Promise<MessageDocument> {
    const message = await this.messageModel.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    message.isFlagged = true;
    message.flagReason = reason;
    return message.save();
  }
}
