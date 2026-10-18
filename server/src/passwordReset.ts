import { createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { databaseTransaction as transaction } from "./db.js";
import type { ApplicationDatabase as Database } from "./databaseTypes.js";
import { hashPassword } from "./auth.js";
import { sendPasswordResetEmail } from "./email.js";
import { sessionEvents } from "./sessionEvents.js";

export const RESET_EXPIRY_MS = 10 * 60_000;
export const RESET_COOLDOWN_MS = 60_000;
export const RESET_MAX_ATTEMPTS = 5;
export function validResetPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 6 && Buffer.byteLength(password, "utf8") <= 72;
}
export function resetSecret(): string {
  const secret = process.env.PASSWORD_RESET_SECRET?.trim();
  if (!secret || secret.length < 32 || /replace|change.this|your.*secret/i.test(secret) || secret === process.env.JWT_SECRET?.trim()) {
    throw new Error("Configure a separate strong PASSWORD_RESET_SECRET of at least 32 characters.");
  }
  return secret;
}

export function normalizeRecoveryEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  // No provider-specific dot/plus rewriting or changes to existing stored addresses.
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email) ? email : null;
}

function keyedHash(value: string): string {
  return createHmac("sha256", resetSecret()).update(value).digest("hex");
}

type User = { id: number; email: string; is_banned: number };
type CodeRow = { id: number; code_hash: string; expires_at: number; attempts: number; consumed_at: number | null };


async function findUser(db: Database, email: string): Promise<User | null> {
  const users = await db.all<User[]>("SELECT id, email, is_banned FROM users WHERE lower(trim(email)) = ? LIMIT 2", email);
  return users.length === 1 && !users[0].is_banned ? users[0] : null;
}

async function allowRate(db: Database, key: string, now: number, window: number, max: number, cooldown = 0): Promise<boolean> {
  const hash = keyedHash(`rate:${key}`);
  const row = await db.get<{ window_start: number; count: number; last_request: number }>("SELECT * FROM password_reset_rate_limits WHERE key = ?", hash);
  if (row && now - row.last_request < cooldown) return false;
  if (row && now - row.window_start < window && row.count >= max) return false;
  const start = row && now - row.window_start < window ? row.window_start : now;
  const count = start === row?.window_start ? row.count + 1 : 1;
  await db.run(`INSERT INTO password_reset_rate_limits (key, window_start, count, last_request) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=excluded.count, last_request=excluded.last_request`, hash, start, count, now);
  return true;
}

export class PasswordResetService {
  constructor(private readonly deliver = sendPasswordResetEmail, private readonly clock = Date.now) {}

  async forgot(email: string, ip: string): Promise<void> {
    resetSecret();
    const delivery = await transaction(async (db) => {
      const now = this.clock();
      await db.run("DELETE FROM password_reset_rate_limits WHERE last_request < ?", now - 24 * 60 * 60_000);
      if (!await allowRate(db, `forgot:ip:${ip}`, now, 15 * 60_000, 10)) return null;
      if (!await allowRate(db, `forgot:email:${email}`, now, 60 * 60_000, 3, RESET_COOLDOWN_MS)) return null;
      const user = await findUser(db, email);
      if (!user) return null;
      const last = await db.get<{ created_at: number }>("SELECT created_at FROM password_reset_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1", user.id);
      if (last && now - last.created_at < RESET_COOLDOWN_MS) return null;
      await db.run("UPDATE password_reset_codes SET consumed_at = ?, updated_at = ? WHERE user_id = ? AND consumed_at IS NULL", now, now, user.id);
      const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
      const nonce = randomBytes(16).toString("hex");
      // A random nonce binds each HMAC to one issuance even if a numeric code repeats.
      const hash = `${nonce}:${keyedHash(`otp:${user.id}:${nonce}:${code}`)}`;
      const result = await db.run("INSERT INTO password_reset_codes (user_id, code_hash, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", user.id, hash, now + RESET_EXPIRY_MS, now, now);
      return { id: result.lastID!, to: user.email.trim(), code };
    });
    if (!delivery) return;
    try {
      await this.deliver(delivery.to, delivery.code);
    } catch {
      // Revoke only this issuance; a delayed failure must not invalidate a newer request.
      await transaction(async (db) => {
        await db.run("UPDATE password_reset_codes SET consumed_at = ?, updated_at = ? WHERE id = ? AND consumed_at IS NULL", this.clock(), this.clock(), delivery.id);
      });
      console.warn("Password recovery email could not be sent.");
    }
  }

  private async validate(db: Database, email: string, code: unknown, ip: string, countRate = true): Promise<{ user: User; row: CodeRow } | null> {
    const now = this.clock();
    if (countRate && !await allowRate(db, `check:ip:${ip}`, now, 15 * 60_000, 30)) return null;
    if (countRate && !await allowRate(db, `check:email:${email}`, now, 15 * 60_000, 10)) return null;
    const user = await findUser(db, email);
    if (!user) return null;
    const row = await db.get<CodeRow>("SELECT * FROM password_reset_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1", user.id);
    if (!row || row.consumed_at !== null || row.expires_at <= now || row.attempts >= RESET_MAX_ATTEMPTS) return null;
    const [nonce, expected] = row.code_hash.split(":");
    const input = typeof code === "string" && /^\d{6}$/.test(code) ? code : "invalid";
    const actual = Buffer.from(keyedHash(`otp:${user.id}:${nonce}:${input}`), "hex");
    const stored = Buffer.from(expected || "", "hex");
    if (stored.length !== actual.length || !timingSafeEqual(stored, actual)) {
      await db.run("UPDATE password_reset_codes SET attempts = attempts + 1, updated_at = ?, consumed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE NULL END WHERE id = ?", now, RESET_MAX_ATTEMPTS, now, row.id);
      return null;
    }
    return { user, row };
  }

  verify(email: string, code: unknown, ip: string): Promise<boolean> {
    return transaction(async (db) => Boolean(await this.validate(db, email, code, ip)));
  }

  async reset(email: string, code: unknown, password: string, ip: string): Promise<boolean> {
    if (!validResetPassword(password)) return false;
    // Avoid running bcrypt for unauthenticated guesses, and revalidate after hashing.
    if (!await this.verify(email, code, ip)) return false;
    const hash = await hashPassword(password);
    const userId = await transaction(async (db) => {
      const valid = await this.validate(db, email, code, ip, false);
      if (!valid) return null;
      const now = this.clock();
      await db.run("UPDATE users SET password_hash = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", hash, valid.user.id);
      await db.run("UPDATE password_reset_codes SET consumed_at = ?, updated_at = ? WHERE user_id = ? AND consumed_at IS NULL", now, now, valid.user.id);
      return valid.user.id;
    });
    if (userId === null) return false;
    sessionEvents.emit("invalidate", userId);
    return true;
  }
}
