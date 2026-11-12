import { BadRequestException } from '@nestjs/common';

/**
 * Reads the optional `Idempotency-Key` header of a checkout request.
 *
 * The client sends one key per checkout attempt and repeats it on retries, so
 * a double-clicked "Pay" is answered with the first payment instead of a new
 * one. Absent or blank means "no key": the request behaves as it always did.
 */
export function idempotencyKeyFrom(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim();
  if (!key) return undefined;
  if (key.length > 255 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key must be 1–255 printable characters',
    );
  }
  return key;
}
