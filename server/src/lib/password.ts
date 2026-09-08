import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/**
 * Password hashing with Node's built-in scrypt (no native deps — works on any
 * stock Node install, which matters since this deploys bare-metal, no Docker).
 * Stored format: scrypt$N$r$p$<salt b64>$<hash b64>
 */
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64!, 'base64');
    const expected = Buffer.from(hashB64!, 'base64');
    const actual = scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Opaque refresh token → sha256 hex (only the hash is stored server-side). */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
