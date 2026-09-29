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
