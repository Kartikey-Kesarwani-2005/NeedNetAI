/**
 * Password hashing (SERVER ONLY).
 *
 * scrypt with a per-user random salt. The plaintext password never leaves the
 * request handler, is never logged, and is never persisted. Verification uses
 * a constant-time comparison.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export interface PasswordHash {
  hash: string;
  salt: string;
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, stored: PasswordHash): boolean {
  if (typeof password !== "string" || password.length === 0) return false;
  try {
    const candidate = scryptSync(password, stored.salt, KEY_LENGTH);
    const expected = Buffer.from(stored.hash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
