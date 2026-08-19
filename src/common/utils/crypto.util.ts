import * as crypto from 'crypto';

/**
 * Generate a secure random token
 * @param length - Number of bytes (token will be twice this length in hex)
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash a token using SHA-256 for secure storage
 * @param token - The plaintext token to hash
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify a token against its hash
 * @param token - The plaintext token
 * @param hashedToken - The hashed token to compare against
 */
export function verifyToken(token: string, hashedToken: string): boolean {
  const tokenHash = hashToken(token);
  return crypto.timingSafeEqual(
    Buffer.from(tokenHash, 'hex'),
    Buffer.from(hashedToken, 'hex'),
  );
}

/**
 * Generate a 6-digit OTP
 */
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
