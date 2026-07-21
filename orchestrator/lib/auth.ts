import crypto from "crypto";
import fs from "fs";
import path from "path";

// Deliberately dependency-free auth (Node crypto only): adding npm packages
// to the orchestrator means a slower Docker build and a bigger surface, and
// login-only seeded users don't need more than scrypt + an HMAC-signed
// cookie. No registration by design — users are seeded in the database.

const SESSION_COOKIE = "anastasis_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Secret persists on the .data PVC so sessions survive pod restarts —
// an env-var-less fallback that never ships a hardcoded secret.
function sessionSecret(): string {
  const secretPath = path.join(process.cwd(), ".data", "session-secret");
  if (!fs.existsSync(secretPath)) {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return fs.readFileSync(secretPath, "utf8").trim();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createSessionCookie(userId: string): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expires}`;
  const token = `${payload}.${sign(payload)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/** Returns the user id a session token encodes, or null if invalid/expired. */
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  const payload = `${userId}.${expires}`;
  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }
  if (Number(expires) < Date.now()) return null;
  return userId;
}

/** Returns the logged-in user's id, or null. Accepts a Cookie header value. */
export function userIdFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return verifySessionToken(match?.[1]);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
