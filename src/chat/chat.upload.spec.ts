import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatController } from './chat.controller';

const USER = '5aaaaaaaaaaaaaaaaaaaaaa1';
const CONV = 'conv-1';
const UPLOADED = {
  url: 'https://ik.imagekit.io/varona/chat-attachments/1-worksheet.pdf',
  fileId: 'f1',
  name: '1-worksheet.pdf',
  size: 2048,
};

function build() {
  const chatService: any = {
    assertParticipant: jest.fn().mockResolvedValue({}),
  };
  const uploadService: any = {
    uploadFile: jest.fn().mockResolvedValue(UPLOADED),
  };
  const controller = new ChatController(chatService, uploadService);
  return { controller, chatService, uploadService };
}

const req = { user: { _id: USER } } as any;

const file = (over: any = {}) =>
  ({
    originalname: 'worksheet.pdf',
    mimetype: 'application/pdf',
    size: 2048,
    buffer: Buffer.from('x'),
    ...over,
  }) as Express.Multer.File;

describe('POST /chat/upload', () => {
  it('uploads an allowed file and returns the original filename', async () => {
    const { controller, uploadService } = build();

    const result = await controller.uploadAttachment(req, file(), CONV);

    expect(uploadService.uploadFile).toHaveBeenCalledWith(
      expect.anything(),
      'chat-attachments',
    );
    expect(result).toEqual({
      url: UPLOADED.url,
      name: 'worksheet.pdf',
      mimeType: 'application/pdf',
      size: 2048,
    });
  });

  it('refuses to upload into a conversation the user is not in', async () => {
    const { controller, chatService, uploadService } = build();
    chatService.assertParticipant.mockRejectedValue(new ForbiddenException());

    await expect(
      controller.uploadAttachment(req, file(), CONV),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(uploadService.uploadFile).not.toHaveBeenCalled();
  });

  it('requires a conversationId, so it cannot be used as open file hosting', async () => {
    const { controller, uploadService } = build();

    await expect(
      controller.uploadAttachment(req, file(), undefined as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a disallowed file type before storing it', async () => {
    const { controller, uploadService } = build();

    await expect(
      controller.uploadAttachment(
        req,
        file({ originalname: 'run.sh', mimetype: 'application/x-sh' }),
        CONV,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadService.uploadFile).not.toHaveBeenCalled();
  });
});
