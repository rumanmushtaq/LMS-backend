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
