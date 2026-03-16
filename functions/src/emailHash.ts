import { createHash } from 'crypto';

/**
 * Returns a short deterministic hash of an email address,
 * used as part of the share doc ID for pending (pre-signup) shares.
 */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}
