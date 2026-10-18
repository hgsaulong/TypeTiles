import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { databaseTransaction as transaction } from "./db.js";
import type { ApplicationDatabase as Database } from "./databaseTypes.js";
import { hashPassword } from "./auth.js";
import { normalizeRecoveryEmail, validResetPassword } from "./passwordReset.js";
import { sendEmailVerificationCode } from "./email.js";

export const VERIFICATION_EXPIRY_MS = 600_000;
export const VERIFICATION_COOLDOWN_MS = 60_000;
export const VERIFICATION_MAX_ATTEMPTS = 5;
export function verificationSecret(): string {
  const secret = process.env.EMAIL_VERIFICATION_SECRET?.trim();
  if (!secret || secret.length < 32 || /replace|change.this|your.*secret/i.test(secret)
    || secret === process.env.JWT_SECRET?.trim() || secret === process.env.PASSWORD_RESET_SECRET?.trim()) {
    throw new Error("Configure a strong independent EMAIL_VERIFICATION_SECRET of at least 32 characters.");
  }
  return secret;
}

export class RegistrationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export type RegistrationInput = { username: string; email: string; password: string; displayName: string };
export function validateRegistration(body: unknown): RegistrationInput {
  if (!body || typeof body !== "object") throw new RegistrationError(400, "Missing required fields");
  const { username, email, password, displayName } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof displayName !== "string" || !username.trim() || !displayName.trim()) {
    throw new RegistrationError(400, "Username and display name are required");
  }
  const normalized = normalizeRecoveryEmail(email);
  if (!normalized) throw new RegistrationError(400, "Enter a valid email address");
  const [local, domain] = normalized.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")
    || domain.split(".").some((label) => label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    throw new RegistrationError(400, "Enter a valid email address");
  }
  if (!validResetPassword(password)) throw new RegistrationError(400, "Password must be at least 6 characters and at most 72 UTF-8 bytes");
  // Preserve existing username/display-name values; validate without silently renaming accounts.
  return { username, email: normalized, password, displayName };
}

function hmac(value: string): string {
  return createHmac("sha256", verificationSecret()).update(value).digest("hex");
}


type User = { id: number; email: string; email_verified: number; is_banned: number };
type Delivery = { id: number; to: string; code: string };
async function eligibleUser(db: Database, email: string): Promise<User | null> {
  const users = await db.all<User[]>("SELECT id,email,email_verified,is_banned FROM users WHERE lower(trim(email))=? LIMIT 2", email);
  return users.length === 1 && !users[0].is_banned && users[0].email_verified === 0 ? users[0] : null;
}

async function allowRate(db: Database, key: string, now: number, window: number, maximum: number, cooldown = 0): Promise<boolean> {
  const hash = hmac(`email-verification:rate:${key}`);
  const row = await db.get<{ window_start: number; count: number; last_request: number }>("SELECT * FROM email_verification_rate_limits WHERE key=?", hash);
  if (row && (now - row.last_request < cooldown || (now - row.window_start < window && row.count >= maximum))) return false;
  const start = row && now - row.window_start < window ? row.window_start : now;
  const count = start === row?.window_start ? row.count + 1 : 1;
  await db.run(`INSERT INTO email_verification_rate_limits(key,window_start,count,last_request) VALUES(?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=excluded.count,last_request=excluded.last_request`, hash, start, count, now);
  return true;
}

export class EmailVerificationService {
  constructor(private readonly deliver = sendEmailVerificationCode, private readonly clock = Date.now) {}

  private async issue(db: Database, user: { id: number; email: string }, now: number): Promise<Delivery> {
    await db.run("UPDATE email_verification_codes SET consumed_at=?,updated_at=? WHERE user_id=? AND consumed_at IS NULL", now, now, user.id);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const nonce = randomBytes(16).toString("hex");
    const hash = `${nonce}:${hmac(`email-verification:otp:${user.id}:${nonce}:${code}`)}`;
    const result = await db.run("INSERT INTO email_verification_codes(user_id,code_hash,expires_at,created_at,updated_at) VALUES(?,?,?,?,?)", user.id, hash, now + VERIFICATION_EXPIRY_MS, now, now);
    return { id: result.lastID!, to: user.email.trim(), code };
  }

  private async send(delivery: Delivery): Promise<void> {
    try { await this.deliver(delivery.to, delivery.code); }
    catch {
      // A late failure must not revoke a newer issuance. Keep the account pending.
      await transaction(async (db) => {
        const now = this.clock();
        await db.run("UPDATE email_verification_codes SET consumed_at=?,updated_at=? WHERE id=? AND consumed_at IS NULL", now, now, delivery.id);
      });
      console.warn("Email verification delivery could not be completed.");
    }
  }

  async register(body: unknown, ip: string): Promise<void> {
    verificationSecret();
    const input = validateRegistration(body);
    const allowed = await transaction(async (db) => allowRate(db, `register:ip:${ip}`, this.clock(), 900_000, 10));
    if (!allowed) throw new RegistrationError(429, "Too many registration requests. Please try again later.");
    const passwordHash = await hashPassword(input.password);
    const delivery = await transaction(async (db) => {
      const existing = await db.get("SELECT id FROM users WHERE username=? OR lower(trim(email))=?", input.username, input.email);
      if (existing) throw new RegistrationError(409, "Username or email already taken");
      const now = this.clock();
      if (!await allowRate(db, `send:ip:${ip}`, now, 900_000, 10)
        || !await allowRate(db, `send:email:${input.email}`, now, 3_600_000, 3, VERIFICATION_COOLDOWN_MS)) {
        throw new RegistrationError(429, "Too many verification requests. Please try again later.");
      }
      const result = await db.run("INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES(?,?,?,?,0)", input.username, input.email, passwordHash, input.displayName);
      if (typeof result.lastID !== "number") throw new Error("Registration failed");
      await db.run("INSERT INTO user_stats(user_id) VALUES(?)", result.lastID);
      return this.issue(db, { id: result.lastID, email: input.email }, now);
    });
    // User/stats/code are committed first. Delivery cannot roll back the account.
    try { await this.send(delivery); }
    catch { console.warn("Email verification delivery could not be processed."); }
  }

  async resend(email: string, ip: string): Promise<void> {
    verificationSecret();
    const delivery = await transaction(async (db) => {
      const now = this.clock();
      await db.run("DELETE FROM email_verification_rate_limits WHERE last_request < ?", now - 86_400_000);
      if (!await allowRate(db, `send:ip:${ip}`, now, 900_000, 10)) return null;
      if (!await allowRate(db, `send:email:${email}`, now, 3_600_000, 3, VERIFICATION_COOLDOWN_MS)) return null;
      const user = await eligibleUser(db, email);
      if (!user) return null;
      const last = await db.get<{ created_at: number }>("SELECT created_at FROM email_verification_codes WHERE user_id=? ORDER BY id DESC LIMIT 1", user.id);
      if (last && now - last.created_at < VERIFICATION_COOLDOWN_MS) return null;
      return this.issue(db, user, now);
    });
    if (delivery) await this.send(delivery);
  }

  verify(email: string, code: unknown, ip: string): Promise<boolean> {
    verificationSecret();
    return transaction(async (db) => {
      const now = this.clock();
      if (!await allowRate(db, `verify:ip:${ip}`, now, 900_000, 30)
        || !await allowRate(db, `verify:email:${email}`, now, 900_000, 10)) return false;
      const user = await eligibleUser(db, email);
      if (!user) return false;
      const row = await db.get<{ id: number; code_hash: string; expires_at: number; attempts: number; consumed_at: number | null }>("SELECT * FROM email_verification_codes WHERE user_id=? ORDER BY id DESC LIMIT 1", user.id);
      if (!row || row.consumed_at !== null || row.expires_at <= now || row.attempts >= VERIFICATION_MAX_ATTEMPTS) return false;
      const [nonce, storedHash] = row.code_hash.split(":");
      const value = typeof code === "string" && /^\d{6}$/.test(code) ? code : "invalid";
      const actual = Buffer.from(hmac(`email-verification:otp:${user.id}:${nonce}:${value}`), "hex");
      const expected = Buffer.from(storedHash || "", "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        await db.run("UPDATE email_verification_codes SET attempts=attempts+1,updated_at=?,consumed_at=CASE WHEN attempts+1>=? THEN ? ELSE NULL END WHERE id=?", now, VERIFICATION_MAX_ATTEMPTS, now, row.id);
        return false;
      }
      await db.run("UPDATE users SET email_verified=1,email_verified_at=? WHERE id=?", now, user.id);
      await db.run("UPDATE email_verification_codes SET consumed_at=?,updated_at=? WHERE user_id=? AND consumed_at IS NULL", now, now, user.id);
      return true;
    });
  }
}
