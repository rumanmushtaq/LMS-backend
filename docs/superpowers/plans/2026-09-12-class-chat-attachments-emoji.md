# Class Chat Attachments and Emoji Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tutor and their students send PDFs, documents and images — plus emoji — in the live class Q&A panel.

**Architecture:** Two-step upload matching every existing upload in this product: the file goes to `POST /api/v1/chat/upload` over REST, which validates it and hands it to ImageKit, and the returned URL is then sent as an `attachment` on the existing Socket.IO `sendMessage` event. All validation logic lives in one pure module so it can be unit-tested without standing up a gateway or a Nest testing module.

**Tech Stack:** NestJS 10 + Mongoose + Socket.IO (backend, Jest), Next 16 App Router + React + Tailwind v4 + shadcn/Radix (frontend, no test runner), ImageKit for storage, `emoji-picker-react` (already a dependency).

## Global Constraints

- **Scope is `LiveQnAPanel` and `useLiveClass` only.** Do not modify the DM widget (`components/chat/ChatWidget.tsx`), the `/chat` page (`views/chat/ChatPage.tsx`), or the `admin/` app.
- **One attachment per message.** Not an array, not a multi-select file input.
- **Accepted types:** PDF, doc, docx, ppt, pptx, xls, xlsx, png, jpg/jpeg, webp. Nothing else.
- **Size cap: 25MB** (`25 * 1024 * 1024` bytes) — enforced in the multer interceptor *and* re-checked in code.
- **Two repos, two branches.** Backend: `varona-academy-backend` on `feat/chat-attachments-emoji` (already created off `origin/main`). Frontend: `LMS-web` — create `feat/chat-attachments-emoji` off `main` before Task 5.
- **Backend commits are slow.** The husky pre-commit hook runs the full type-check and build; a commit can take several minutes. Run commits in the background rather than cancelling them.
- **Never trust the client's mimetype.** It is user-controlled. Always cross-check the file extension, and always re-validate an attachment that arrives over the socket.

---

### Task 1: Attachment validation module

The one piece of genuinely new logic. Built first and in isolation because every later task depends on it, and because it is pure — no database, no Nest, no sockets — so it tests cleanly.

**Files:**
- Create: `src/chat/attachment.validation.ts`
- Test: `src/chat/attachment.validation.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_ATTACHMENT_BYTES: number`
  - `ALLOWED_ATTACHMENT_TYPES: Record<string, string[]>`
  - `interface ChatAttachment { url: string; name: string; mimeType: string; size: number }`
  - `assertAllowedUpload(file: Express.Multer.File): void` — throws `BadRequestException` / `PayloadTooLargeException`
  - `sanitizeAttachment(raw: unknown, urlEndpoint: string | undefined): ChatAttachment | null`
  - `attachmentPreview(attachment: ChatAttachment): string`

- [ ] **Step 1: Write the failing test**

Create `src/chat/attachment.validation.spec.ts`:

```ts
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  MAX_ATTACHMENT_BYTES,
  assertAllowedUpload,
  sanitizeAttachment,
  attachmentPreview,
} from './attachment.validation';

const ENDPOINT = 'https://ik.imagekit.io/varona';

const file = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    originalname: 'worksheet.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    ...over,
  }) as Express.Multer.File;

const attachment = (over: any = {}) => ({
  url: `${ENDPOINT}/chat-attachments/1737000000-worksheet.pdf`,
  name: 'worksheet.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  ...over,
});

describe('assertAllowedUpload', () => {
  it('accepts a PDF within the size cap', () => {
    expect(() => assertAllowedUpload(file())).not.toThrow();
  });

  it('accepts a docx and a jpeg', () => {
    expect(() =>
      assertAllowedUpload(
        file({
          originalname: 'notes.docx',
          mimetype:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowedUpload(
        file({ originalname: 'photo.JPG', mimetype: 'image/jpeg' }),
      ),
    ).not.toThrow();
  });

  it('rejects a missing file', () => {
    expect(() => assertAllowedUpload(undefined as any)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a disallowed mime type', () => {
    expect(() =>
      assertAllowedUpload(
        file({ originalname: 'run.sh', mimetype: 'application/x-sh' }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects an executable wearing a PDF mimetype', () => {
    expect(() =>
      assertAllowedUpload(
        file({ originalname: 'payload.exe', mimetype: 'application/pdf' }),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a file over the size cap', () => {
    expect(() =>
      assertAllowedUpload(file({ size: MAX_ATTACHMENT_BYTES + 1 })),
    ).toThrow(PayloadTooLargeException);
  });
});

describe('sanitizeAttachment', () => {
  it('returns null for a message with no attachment', () => {
    expect(sanitizeAttachment(undefined, ENDPOINT)).toBeNull();
    expect(sanitizeAttachment(null, ENDPOINT)).toBeNull();
  });

  it('passes through a well-formed attachment', () => {
    expect(sanitizeAttachment(attachment(), ENDPOINT)).toEqual(attachment());
  });

  it('rejects a URL that did not come from our storage', () => {
    expect(() =>
      sanitizeAttachment(
        attachment({ url: 'https://evil.example.com/invoice.pdf' }),
        ENDPOINT,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a disallowed mime type', () => {
    expect(() =>
      sanitizeAttachment(
        attachment({ name: 'run.sh', mimeType: 'application/x-sh' }),
        ENDPOINT,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a malformed shape', () => {
    expect(() => sanitizeAttachment({ url: ENDPOINT }, ENDPOINT)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a size over the cap', () => {
    expect(() =>
      sanitizeAttachment(
        attachment({ size: MAX_ATTACHMENT_BYTES + 1 }),
        ENDPOINT,
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses to validate when the endpoint is not configured', () => {
    expect(() => sanitizeAttachment(attachment(), undefined)).toThrow(
      BadRequestException,
    );
  });
});

describe('attachmentPreview', () => {
  it('labels a caption-less attachment with its filename', () => {
    expect(attachmentPreview(attachment() as any)).toBe('📎 worksheet.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/chat/attachment.validation.spec.ts`
Expected: FAIL — `Cannot find module './attachment.validation'`

- [ ] **Step 3: Write the implementation**

Create `src/chat/attachment.validation.ts`:

```ts
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

/** 25MB. Generous for chat, far under the 100MB tutor-materials allows. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const MAX_NAME_LENGTH = 255;
const MAX_URL_LENGTH = 2048;

/**
 * Mime type -> the file extensions we accept for it.
 *
 * Both halves are checked. A browser's reported mimetype is user-controlled,
 * so on its own it would let `payload.exe` through by claiming to be a PDF.
 */
export const ALLOWED_ATTACHMENT_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    '.docx',
  ],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    '.pptx',
  ],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    '.xlsx',
  ],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

export interface ChatAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

function assertTypeAllowed(mimeType: string, name: string): void {
  const extensions = ALLOWED_ATTACHMENT_TYPES[mimeType];
  if (!extensions) {
    throw new BadRequestException(
      `That file type is not allowed. Accepted: PDF, Word, PowerPoint, Excel and images.`,
    );
  }
  if (!extensions.includes(extensionOf(name))) {
    throw new BadRequestException(
      `The file extension does not match its type (${mimeType}).`,
    );
  }
}

/** Gate for an incoming multipart upload. */
export function assertAllowedUpload(file: Express.Multer.File): void {
  if (!file) {
    throw new BadRequestException(
      'No file provided. Attach a file with the key "file".',
    );
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new PayloadTooLargeException(
      `File is too large. Maximum allowed size is 25MB. Received: ${(
        file.size /
        1024 /
        1024
      ).toFixed(2)}MB`,
    );
  }

  assertTypeAllowed(file.mimetype, file.originalname);
}

/**
 * Gate for an attachment arriving on a socket message.
 *
 * The client is sending back a URL we gave it, but nothing stops a modified
 * client sending a different one — without the origin check any message could
 * carry an arbitrary link rendered as a trustworthy-looking file card.
 */
export function sanitizeAttachment(
  raw: unknown,
  urlEndpoint: string | undefined,
): ChatAttachment | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw !== 'object') {
    throw new BadRequestException('Malformed attachment');
  }

  const { url, name, mimeType, size } = raw as Record<string, unknown>;

  if (
    typeof url !== 'string' ||
    typeof name !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    size <= 0
  ) {
    throw new BadRequestException('Malformed attachment');
  }

  if (name.length > MAX_NAME_LENGTH || url.length > MAX_URL_LENGTH) {
    throw new BadRequestException('Attachment name or URL is too long');
  }

  if (size > MAX_ATTACHMENT_BYTES) {
    throw new BadRequestException('Attachment is too large');
  }

  if (!urlEndpoint) {
    throw new BadRequestException('File storage is not configured');
  }

  if (!url.startsWith(urlEndpoint)) {
    throw new BadRequestException('Attachment URL is not from our storage');
  }

  assertTypeAllowed(mimeType, name);

  return { url, name, mimeType, size };
}

/** Notification/preview text for an attachment sent without a caption. */
export function attachmentPreview(attachment: ChatAttachment): string {
  return `📎 ${attachment.name}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/chat/attachment.validation.spec.ts`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit** (run in background; the hook is slow)

```bash
git add src/chat/attachment.validation.ts src/chat/attachment.validation.spec.ts
git commit -m "feat(chat): validate attachment uploads against a type allowlist

A reported mimetype is user-controlled, so the extension is checked
against it rather than trusted on its own, and an attachment arriving
over the socket is re-validated against our own storage origin."
```

---

### Task 2: Persist the attachment on a message

**Files:**
- Modify: `src/chat/schemas/message.schema.ts`
- Modify: `src/chat/chat.service.ts:198-209` (`saveMessage`)
- Test: `src/chat/chat.service.spec.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `ChatAttachment` from Task 1.
- Produces: `saveMessage(conversationId: string, senderId: string, content: string, attachment?: ChatAttachment | null): Promise<MessageDocument>`

- [ ] **Step 1: Write the failing test**

Append to `src/chat/chat.service.spec.ts`:

```ts
describe('saveMessage with an attachment', () => {
  const attachment = {
    url: 'https://ik.imagekit.io/varona/chat-attachments/1-worksheet.pdf',
    name: 'worksheet.pdf',
    mimeType: 'application/pdf',
    size: 2048,
  };

  it('stores the attachment alongside the text', async () => {
    const { service, messageModel } = build();
    messageModel.create = jest.fn().mockResolvedValue({ _id: MSG });

    await service.saveMessage('conv-1', A, 'here you go', attachment);

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'here you go', attachment }),
    );
  });

  it('stores an attachment sent with no caption', async () => {
    const { service, messageModel } = build();
    messageModel.create = jest.fn().mockResolvedValue({ _id: MSG });

    await service.saveMessage('conv-1', A, '', attachment);

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '', attachment }),
    );
  });

  it('stores null when there is no attachment', async () => {
    const { service, messageModel } = build();
    messageModel.create = jest.fn().mockResolvedValue({ _id: MSG });

    await service.saveMessage('conv-1', A, 'plain text');

    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'plain text', attachment: null }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/chat/chat.service.spec.ts -t "attachment"`
Expected: FAIL — `attachment` is not passed to `create`.

- [ ] **Step 3: Add the schema field**

In `src/chat/schemas/message.schema.ts`, add above the `Message` class:

```ts
@Schema({ _id: false })
export class MessageAttachment {
  @ApiProperty({ description: 'Public storage URL of the file' })
  @Prop({ type: String, required: true })
  url: string;

  @ApiProperty({ description: 'Original filename, as the sender saw it' })
  @Prop({ type: String, required: true })
  name: string;

  @ApiProperty({ description: 'MIME type, from our allowlist' })
  @Prop({ type: String, required: true })
  mimeType: string;

  @ApiProperty({ description: 'Size in bytes' })
  @Prop({ type: Number, required: true })
  size: number;
}

export const MessageAttachmentSchema =
  SchemaFactory.createForClass(MessageAttachment);
```

Then change `content` and add `attachment` inside `Message`:

```ts
  @ApiProperty({ description: 'The content of the message' })
  // Not required: a message carrying only a file has no caption to store.
  @Prop({ type: String, default: '' })
  content: string;

  @ApiProperty({ description: 'A file sent with this message, if any' })
  @Prop({ type: MessageAttachmentSchema, default: null })
  attachment: MessageAttachment | null;
```

- [ ] **Step 4: Widen `saveMessage`**

In `src/chat/chat.service.ts`, replace the existing `saveMessage`:

```ts
  async saveMessage(
    conversationId: string,
    senderId: string,
    content: string,
    attachment: ChatAttachment | null = null,
  ): Promise<MessageDocument> {
    const message = await this.messageModel.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      content,
      attachment,
    });
    return message;
  }
```

Add the import at the top of the file:

```ts
import { ChatAttachment } from './attachment.validation';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/chat`
Expected: PASS — the new attachment suites plus all pre-existing chat suites.

- [ ] **Step 6: Commit**

```bash
git add src/chat/schemas/message.schema.ts src/chat/chat.service.ts src/chat/chat.service.spec.ts
git commit -m "feat(chat): carry a file attachment on a message

content stops being required, because a message that is only a file has
no caption to store and Mongoose rejected it before it ever reached the
gateway."
```

---

### Task 3: `POST /api/v1/chat/upload`

**Files:**
- Modify: `src/chat/chat.controller.ts`
- Modify: `src/chat/chat.module.ts`
- Test: `src/chat/chat.upload.spec.ts` (create)

**Interfaces:**
- Consumes: `assertAllowedUpload`, `MAX_ATTACHMENT_BYTES` (Task 1); `UploadService.uploadFile(file, folder)` from `src/admin/services/upload.service.ts`, already exported by `AdminModule`.
- Produces: `POST /api/v1/chat/upload` — multipart body `file` + `conversationId`; responds `{ url, name, mimeType, size }`.

- [ ] **Step 1: Write the failing test**

Create `src/chat/chat.upload.spec.ts`:

```ts
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
  const chatService: any = { assertParticipant: jest.fn().mockResolvedValue({}) };
  const uploadService: any = { uploadFile: jest.fn().mockResolvedValue(UPLOADED) };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/chat/chat.upload.spec.ts`
Expected: FAIL — `controller.uploadAttachment is not a function`.

- [ ] **Step 3: Add the endpoint**

In `src/chat/chat.controller.ts`, extend the imports:

```ts
import {
  Controller, Get, Post, Delete, Body, Param, UseGuards, Req, Query,
  HttpCode, HttpStatus, BadRequestException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { UploadService } from '../admin/services/upload.service';
import { assertAllowedUpload, MAX_ATTACHMENT_BYTES } from './attachment.validation';
```

Widen the constructor:

```ts
  constructor(
    private readonly chatService: ChatService,
    private readonly uploadService: UploadService,
  ) {}
```

Add the endpoint (place it after the conversations routes):

```ts
  /**
   * Upload a chat attachment.
   *
   * Scoped to a conversation on purpose: without `conversationId` and the
   * participant check, any logged-in user could use this as free file hosting.
   */
  @Post('upload')
  @ApiOperation({ summary: 'Upload a file to send in a conversation (max 25MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        conversationId: { type: 'string' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  async uploadAttachment(
    @Req() req: Request & { user: any },
    @UploadedFile() file: Express.Multer.File,
    @Body('conversationId') conversationId: string,
  ) {
    if (!conversationId) {
      throw new BadRequestException('conversationId is required');
    }

    await this.chatService.assertParticipant(
      conversationId,
      this.userIdOf(req),
    );
    assertAllowedUpload(file);

    const stored = await this.uploadService.uploadFile(
      file,
      'chat-attachments',
    );

    return {
      url: stored.url,
      // The sender's filename, not the timestamped one storage generated.
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }
```

- [ ] **Step 4: Wire the module**

In `src/chat/chat.module.ts`, add the import and list it (`AdminModule` already exports `UploadService`):

```ts
import { AdminModule } from '../admin/admin.module';
```

and add `AdminModule` to the `imports` array.

- [ ] **Step 5: Run tests and type-check**

Run: `npx jest src/chat && npx tsc --noEmit`
Expected: PASS, no type errors.

If `AdminModule` and `ChatModule` turn out to import each other, break the cycle with `forwardRef(() => AdminModule)` rather than duplicating `UploadService`.

- [ ] **Step 6: Commit**

```bash
git add src/chat/chat.controller.ts src/chat/chat.module.ts src/chat/chat.upload.spec.ts
git commit -m "feat(chat): add a conversation-scoped attachment upload endpoint

Requiring conversationId and running the participant check keeps this
from becoming general-purpose file hosting for anyone with a login."
```

---

### Task 4: Accept attachments over the socket

**Files:**
- Modify: `src/chat/chat.gateway.ts:250-258` (`handleSendMessage`) and `:260-365` (`deliverMessage`)
- Test: covered by Task 1's `sanitizeAttachment` suite plus the manual check below

**Interfaces:**
- Consumes: `sanitizeAttachment`, `attachmentPreview`, `ChatAttachment` (Task 1); `saveMessage(..., attachment)` (Task 2).
- Produces: `sendMessage` socket payload `{ conversationId: string; content?: string; attachment?: ChatAttachment | null }`.

- [ ] **Step 1: Add the import**

In `src/chat/chat.gateway.ts`:

```ts
import {
  sanitizeAttachment,
  attachmentPreview,
  ChatAttachment,
} from './attachment.validation';
```

- [ ] **Step 2: Widen both payload types**

```ts
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      conversationId: string;
      content?: string;
      attachment?: unknown;
    },
  ) {
    return this.enqueue(payload.conversationId, () =>
      this.deliverMessage(client.data.userId, payload),
    );
  }

  private async deliverMessage(
    senderId: string,
    payload: {
      conversationId: string;
      content?: string;
      attachment?: unknown;
    },
  ) {
```

- [ ] **Step 3: Replace the empty-content guard**

In `deliverMessage`, the existing block reads:

```ts
    if (!content) {
      throw new WsException('Message cannot be empty');
    }
```

Replace it with an attachment-aware version, placed directly after `content` is trimmed:

```ts
    // A file on its own is a message. Only reject when there is neither.
    let attachment: ChatAttachment | null;
    try {
      attachment = sanitizeAttachment(
        payload.attachment,
        this.configService.get<string>('imagekit.urlEndpoint'),
      );
    } catch (error: any) {
      throw new WsException(error?.message ?? 'Invalid attachment');
    }

    if (!content && !attachment) {
      throw new WsException('Message cannot be empty');
    }
```

- [ ] **Step 4: Pass it through to the save and the notification**

Change the `saveMessage` call:

```ts
    const message = await this.chatService.saveMessage(
      conversationId,
      senderId,
      content,
      attachment,
    );
```

And in the notification loop, change `content: message.content` to:

```ts
        content: content || attachmentPreview(attachment!),
```

- [ ] **Step 5: Verify**

Run: `npx jest src/chat && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/chat/chat.gateway.ts
git commit -m "feat(chat): let a message carry a file instead of text

A file on its own is a message, so the empty-content guard now rejects
only when there is neither text nor attachment, and a caption-less file
gets a filename preview rather than an empty notification."
```

---

### Task 5: Frontend upload service and attachment helpers

From here on the work is in the **`LMS-web`** repo, which has **no test runner** — verification is `npx tsc --noEmit` plus the manual pass in Task 8.

**Files:**
- Create: `LMS-web/lib/chat/attachment.ts`
- Modify: `LMS-web/utils/apiConfig.ts:51-59`
- Modify: `LMS-web/services/chat.ts`

**Interfaces:**
- Consumes: `POST /api/v1/chat/upload` (Task 3).
- Produces:
  - `interface ChatAttachment { url: string; name: string; mimeType: string; size: number }`
  - `ACCEPTED_ATTACHMENT_EXTENSIONS: string`, `MAX_ATTACHMENT_BYTES: number`
  - `isImageAttachment(a: ChatAttachment): boolean`, `formatFileSize(bytes: number): string`
  - `chatService.uploadAttachment(file: File, conversationId: string, onProgress?: (percent: number) => void): Promise<ChatAttachment>`

- [ ] **Step 1: Create the branch**

```bash
cd ../LMS-web && git checkout -b feat/chat-attachments-emoji main
```

- [ ] **Step 2: Add the shared types and helpers**

Create `LMS-web/lib/chat/attachment.ts`:

```ts
export interface ChatAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Must stay in step with ALLOWED_ATTACHMENT_TYPES on the backend. */
export const ACCEPTED_ATTACHMENT_EXTENSIONS =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg,.webp";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function isImageAttachment(attachment: ChatAttachment): boolean {
  return attachment.mimeType.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

- [ ] **Step 3: Add the endpoint**

In `LMS-web/utils/apiConfig.ts`, add to the `Chat` block:

```ts
    UPLOAD: "/api/v1/chat/upload",
```

- [ ] **Step 4: Add the upload call**

In `LMS-web/services/chat.ts`, import the type and add the method to `ChatService`:

```ts
import type { ChatAttachment } from "@/lib/chat/attachment";
```

```ts
  /**
   * Uploads a file for a conversation and returns the stored attachment.
   *
   * The axios client strips Content-Type for FormData so the multipart
   * boundary is set correctly — do not set it here.
   */
  async uploadAttachment(
    file: File,
    conversationId: string,
    onProgress?: (percent: number) => void,
  ): Promise<ChatAttachment> {
    const form = new FormData();
    form.append("file", file);
    form.append("conversationId", conversationId);

    const { data } = await HTTP_CLIENT.post(apiEndpoints.Chat.UPLOAD, form, {
      onUploadProgress: (event) => {
        if (!onProgress || !event.total) return;
        onProgress(Math.round((event.loaded * 100) / event.total));
      },
    });

    return data;
  }
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/attachment.ts utils/apiConfig.ts services/chat.ts
git commit -m "feat(chat): add the attachment upload call and shared file helpers"
```

---

### Task 6: Send attachments from the live class hook

**Files:**
- Modify: `LMS-web/hooks/useLiveClass.ts:7-14` (`LiveMessage`) and `:107-114` (`sendMessage`)

**Interfaces:**
- Consumes: `ChatAttachment` (Task 5); the `sendMessage` socket contract (Task 4).
- Produces: `sendMessage(content: string, attachment?: ChatAttachment | null): void`; `LiveMessage.attachment?: ChatAttachment | null`.

No optimistic-send changes are needed here. This hook dedupes on `_id` through `seenIds` and renders only what the server echoes back — unlike the DM surfaces, whose `mergeMessage` matches placeholders by content equality and would have broken on a caption-less file.

- [ ] **Step 1: Extend the message type**

In `LMS-web/hooks/useLiveClass.ts`:

```ts
import type { ChatAttachment } from "@/lib/chat/attachment";

export interface LiveMessage {
  _id: string;
  conversationId: string;
  senderId: any;
  content: string;
  attachment?: ChatAttachment | null;
  createdAt?: string;
  pending?: boolean;
}
```

- [ ] **Step 2: Widen `sendMessage`**

```ts
  const sendMessage = useCallback(
    (content: string, attachment?: ChatAttachment | null) => {
      const text = content.trim();
      if (!text && !attachment) return;
      if (!conversationId || !socketRef.current?.connected) return;
      socketRef.current.emit("sendMessage", {
        conversationId,
        content: text,
        attachment: attachment ?? null,
      });
    },
    [conversationId],
  );
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. `LiveQnAPanel` still calls `onSend(draft)` with one argument, which stays valid.

- [ ] **Step 4: Commit**

```bash
git add hooks/useLiveClass.ts
git commit -m "feat(chat): let the live class hook send a file with a message"
```

---

### Task 7: Render attachments, and add the composer controls

The user-visible task. Split from the plumbing because a reviewer could accept the transport and still reject the UI.

**Files:**
- Create: `LMS-web/components/chat/MessageAttachment.tsx`
- Modify: `LMS-web/components/live/LiveQnAPanel.tsx`

**Interfaces:**
- Consumes: `ChatAttachment`, `isImageAttachment`, `formatFileSize`, `ACCEPTED_ATTACHMENT_EXTENSIONS`, `MAX_ATTACHMENT_BYTES` (Task 5); `chatService.uploadAttachment` (Task 5); `sendMessage(content, attachment)` (Task 6); `insertAtCaret`, `shouldSendOnKeyDown` from `LMS-web/lib/chat/composer.ts`.
- Produces: `<MessageAttachment attachment={...} mine={boolean} />`; `LiveQnAPanelProps.onSend: (content: string, attachment?: ChatAttachment | null) => void` and a new `conversationId: string | null` prop.

`conversationId` is nullable because both views derive it from data that loads
asynchronously (`info?.conversationId` in the tutor view, `info?.live.conversationId`
in the student view) and the panel renders before it arrives. Uploading is disabled
until it does.

- [ ] **Step 1: Build the renderer**

Create `LMS-web/components/chat/MessageAttachment.tsx`:

```tsx
"use client";

import React from "react";
import { FileText, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ChatAttachment,
  formatFileSize,
  isImageAttachment,
} from "@/lib/chat/attachment";

/**
 * A file inside a message bubble: a thumbnail for images, a file card for
 * everything else. Kept standalone so the DM surfaces can adopt it later.
 */
export default function MessageAttachment({
  attachment,
  mine = false,
}: {
  attachment: ChatAttachment;
  mine?: boolean;
}) {
  if (isImageAttachment(attachment)) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-xl"
      >
        {/* Not next/image: the host is user content on a CDN, and the
            intrinsic size is unknown until it loads. */}
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-h-60 w-auto max-w-full object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2 transition",
        mine
          ? "border-primary-foreground/25 hover:bg-primary-foreground/10"
          : "border-border hover:bg-background",
      )}
    >
      <FileText className="w-5 h-5 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {attachment.name}
        </span>
        <span className="block text-[11px] opacity-70">
          {formatFileSize(attachment.size)}
        </span>
      </span>
      <Download className="w-4 h-4 shrink-0 opacity-70" />
    </a>
  );
}
```

- [ ] **Step 2: Widen the panel's props**

In `LMS-web/components/live/LiveQnAPanel.tsx`, replace the imports and interface:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Send, MessageCircleQuestion, Circle, Smile, Paperclip, X, Loader2 } from "lucide-react";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { insertAtCaret, shouldSendOnKeyDown } from "@/lib/chat/composer";
import {
  type ChatAttachment,
  ACCEPTED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  formatFileSize,
} from "@/lib/chat/attachment";
import MessageAttachment from "@/components/chat/MessageAttachment";
import chatService from "@/services/chat";
import { toast } from "sonner";
import type { LiveMessage } from "@/hooks/useLiveClass";

interface LiveQnAPanelProps {
  messages: LiveMessage[];
  currentUserId?: string;
  conversationId: string | null;
  isConnected: boolean;
  typingUser: string | null;
  onSend: (content: string, attachment?: ChatAttachment | null) => void;
  onTyping: () => void;
  onStopTyping: () => void;
  title?: string;
}
```

- [ ] **Step 3: Add composer state and handlers**

Inside the component, after the existing `draft` state, add:

```tsx
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
```

Replace `handleSubmit` and add the rest:

```tsx
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() && !attachment) return;
    onSend(draft, attachment);
    setDraft("");
    setAttachment(null);
    onStopTyping();
  };

  const handleEmojiSelect = (emoji: EmojiClickData) => {
    const el = inputRef.current;
    const { value, caret } = insertAtCaret(
      draft,
      emoji.emoji,
      el?.selectionStart ?? null,
      el?.selectionEnd ?? null,
    );
    setDraft(value);
    // Without returning focus, the next Enter lands nowhere and sends nothing.
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !conversationId) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error(`"${file.name}" is larger than 25MB.`);
      return;
    }

    setUploadPercent(0);
    try {
      const uploaded = await chatService.uploadAttachment(
        file,
        conversationId,
        setUploadPercent,
      );
      setAttachment(uploaded);
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ?? "That file could not be uploaded.",
      );
    } finally {
      setUploadPercent(null);
    }
  };
```

- [ ] **Step 4: Render the attachment in the bubble**

Replace the bubble body (`{msg.content}`) with:

```tsx
                <div
                  className={cn(
                    "px-3 py-2 rounded-2xl text-sm break-words space-y-2",
                    mine
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm",
                    msg.pending && "opacity-60",
                  )}
                >
                  {msg.attachment && (
                    <MessageAttachment attachment={msg.attachment} mine={mine} />
                  )}
                  {msg.content && <p>{msg.content}</p>}
                </div>
```

- [ ] **Step 5: Replace the composer**

Replace the whole `<form>` block:

```tsx
      <form onSubmit={handleSubmit} className="border-t border-border p-3 space-y-2">
        {(attachment || uploadPercent !== null) && (
          <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
            {uploadPercent !== null ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="flex-1 truncate">Uploading… {uploadPercent}%</span>
              </>
            ) : (
              <>
                <Paperclip className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate font-medium">{attachment!.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatFileSize(attachment!.size)}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="shrink-0 rounded-md p-0.5 hover:bg-background"
                  aria-label="Remove attachment"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_ATTACHMENT_EXTENSIONS}
            onChange={handleFilePick}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadPercent !== null || !conversationId}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted disabled:opacity-40"
            aria-label="Attach a file"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-muted"
                aria-label="Add an emoji"
              >
                <Smile className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            {/* The panel is only 360px wide, so the picker is width-matched
                and anchored rather than left to overflow the column. */}
            <PopoverContent align="start" side="top" className="w-auto border-none p-0 shadow-none">
              <EmojiPicker
                onEmojiClick={handleEmojiSelect}
                lazyLoadEmojis
                width={300}
                height={360}
                theme={Theme.AUTO}
              />
            </PopoverContent>
          </Popover>

          <input
            ref={inputRef}
            value={draft}
            onChange={handleChange}
            onKeyDown={(e) => {
              if (shouldSendOnKeyDown(e)) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask a question…"
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !attachment) || uploadPercent !== null}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
            aria-label="Send question"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
```

- [ ] **Step 6: Pass the new prop from both views**

Each view already computes this for `useLiveClass`, by a different path.

`LMS-web/views/live/TutorLiveClassView.tsx:468` — add to `<LiveQnAPanel …>`:

```tsx
            conversationId={info?.conversationId ?? null}
```

`LMS-web/views/live/StudentLiveClassView.tsx:159` — add to `<LiveQnAPanel …>`:

```tsx
            conversationId={info?.live.conversationId ?? null}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: no type errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add components/chat/MessageAttachment.tsx components/live/LiveQnAPanel.tsx views/live/TutorLiveClassView.tsx views/live/StudentLiveClassView.tsx
git commit -m "feat(chat): send files and emoji from the live class panel

The panel was the only chat surface without an emoji picker, and a class
had no way to pass round the worksheet it was built on."
```

---

### Task 8: Manual end-to-end verification

There is no frontend test runner, so this is the only thing that proves the feature works. Do not skip it or report the feature complete without it.

**Files:** none.

- [ ] **Step 1: Start both services**

Backend on `:8000` (`npm run start:dev` in `varona-academy-backend`), frontend on `:3000` (`npm run dev` in `LMS-web`). Confirm `IMAGEKIT_URL_ENDPOINT` is set in the backend `.env` — `sanitizeAttachment` rejects every attachment without it.

- [ ] **Step 2: Open a class as both roles**

Use the probe tutor and student accounts from the existing live E2E harness. Tutor starts a class; student joins the watch page.

- [ ] **Step 3: Walk the cases**

- [ ] Tutor sends a PDF with a caption; student sees the file card and can download it.
- [ ] Student sends a PNG with no caption; tutor sees an inline thumbnail, and it opens full size in a new tab.
- [ ] Emoji: click the Smile button, place the caret mid-sentence, insert — it lands at the caret, not at the end, and the input keeps focus so Enter sends immediately.
- [ ] A `.exe` (or any disallowed type) is refused with a toast and never appears in the thread.
- [ ] A file over 25MB is refused client-side with a toast.
- [ ] Send is disabled while an upload is in flight, and the chip shows progress.
- [ ] The attachment survives a page reload (it is loaded from history, not just the live socket echo).

- [ ] **Step 4: Report**

State plainly which cases passed and which did not. If anything failed, fix it and re-run the affected case before claiming completion.

---

## Known gaps

- The admin moderation view (`admin/components/chat/chat-main-area.tsx:255`) renders raw `{msg.content}`, so an attachment-only message shows as an empty bubble there. It is a separate app on a separate branch; it needs `MessageAttachment` in a follow-up.
- Attachments are public ImageKit URLs, consistent with every other upload in the product. Access-controlled downloads are a product-wide decision, not one to make here.
