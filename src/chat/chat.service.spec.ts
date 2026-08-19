import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

const A = '5aaaaaaaaaaaaaaaaaaaaaa1';
const B = '5bbbbbbbbbbbbbbbbbbbbbb2';
const OUTSIDER = '5cccccccccccccccccccccc3';
const MSG = '5dddddddddddddddddddddd4';

function build() {
  const conversationModel: any = { findById: jest.fn() };
  const messageModel: any = { findById: jest.fn() };
  const service = new ChatService(conversationModel, messageModel);
  return { service, conversationModel, messageModel };
}

const convo = (over: any = {}) => ({
  _id: 'conv-1',
  participants: [A, B],
  isBlocked: false,
  blockedBy: null,
  save: jest.fn().mockResolvedValue(true),
  ...over,
});

describe('assertParticipant (the core chat authorization gate)', () => {
  it('returns the conversation for a real participant', async () => {
    const { service } = build();
    jest
      .spyOn(service, 'getConversationById')
      .mockResolvedValue(convo() as any);
    await expect(service.assertParticipant('conv-1', A)).resolves.toBeDefined();
  });

  it('refuses a non-participant (403)', async () => {
    const { service } = build();
    jest
      .spyOn(service, 'getConversationById')
      .mockResolvedValue(convo() as any);
    await expect(
      service.assertParticipant('conv-1', OUTSIDER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s for a missing conversation', async () => {
    const { service } = build();
    jest.spyOn(service, 'getConversationById').mockResolvedValue(null as any);
    await expect(service.assertParticipant('conv-1', A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('assertMessageParticipant', () => {
  it('404s on an invalid message id (no DB hit)', async () => {
    const { service, messageModel } = build();
    await expect(
      service.assertMessageParticipant('not-an-id', A),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messageModel.findById).not.toHaveBeenCalled();
  });

  it('404s when the message is missing', async () => {
    const { service, messageModel } = build();
    messageModel.findById.mockResolvedValue(null);
    await expect(
      service.assertMessageParticipant(MSG, A),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delegates to assertParticipant on the owning conversation', async () => {
    const { service, messageModel } = build();
    messageModel.findById.mockResolvedValue({ conversationId: 'conv-1' });
    const spy = jest
      .spyOn(service, 'assertParticipant')
      .mockResolvedValue(convo() as any);
    await service.assertMessageParticipant(MSG, A);
    expect(spy).toHaveBeenCalledWith('conv-1', A);
  });
});

describe('block / unblock (only the blocker can unblock)', () => {
  it('blockConversation flags it and records who blocked', async () => {
    const { service, conversationModel } = build();
    const c = convo();
    conversationModel.findById.mockResolvedValue(c);
    await service.blockConversation('conv-1', A);
    expect(c.isBlocked).toBe(true);
    expect(c.blockedBy).toBeDefined();
    expect(c.save).toHaveBeenCalled();
  });

  it('the other participant cannot unblock what they did not block (403)', async () => {
    const { service, conversationModel } = build();
    conversationModel.findById.mockResolvedValue(
      convo({ isBlocked: true, blockedBy: { toString: () => A } }),
    );
    await expect(
      service.unblockConversation('conv-1', B),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the blocker can unblock', async () => {
    const { service, conversationModel } = build();
    const c = convo({ isBlocked: true, blockedBy: { toString: () => A } });
    conversationModel.findById.mockResolvedValue(c);
    await service.unblockConversation('conv-1', A);
    expect(c.isBlocked).toBe(false);
    expect(c.blockedBy).toBeNull();
  });

  it('404s when blocking a missing conversation', async () => {
    const { service, conversationModel } = build();
    conversationModel.findById.mockResolvedValue(null);
    await expect(service.blockConversation('conv-1', A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('flagMessage (moderation)', () => {
  it('flags a message with a reason', async () => {
    const { service, messageModel } = build();
    const m = {
      isFlagged: false,
      flagReason: null,
      save: jest.fn().mockResolvedValue(true),
    };
    messageModel.findById.mockResolvedValue(m);
    await service.flagMessage(MSG, 'spam');
    expect(m.isFlagged).toBe(true);
    expect(m.flagReason).toBe('spam');
  });

  it('404s when flagging a missing message', async () => {
    const { service, messageModel } = build();
    messageModel.findById.mockResolvedValue(null);
    await expect(service.flagMessage(MSG, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
