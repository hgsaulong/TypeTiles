import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { WebSocket } from "ws";
import { initializeDatabase, closeDatabase } from "../src/db.js";
import { generateToken, hashPassword, verifyToken } from "../src/auth.js";
import { EmailVerificationService, verificationSecret, validateRegistration } from "../src/emailVerification.js";
import { PasswordResetService } from "../src/passwordReset.js";
import { createAuthRouter } from "../src/routes/auth.js";
import { createPasswordResetRouter } from "../src/routes/passwordReset.js";
import { attachLanServer } from "../src/lan.js";

test("email verification integration: isolated SQLite and mocked delivery", { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "type-tiles-verification-"));
  process.env.DATABASE_PROVIDER = "sqlite";
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  process.env.PASSWORD_RESET_SECRET = randomBytes(32).toString("hex");
  process.env.EMAIL_VERIFICATION_SECRET = randomBytes(32).toString("hex");
  const legacyDb = await open({ filename: process.env.DATABASE_PATH, driver: sqlite3.Database });
  await legacyDb.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, display_name TEXT NOT NULL, avatar TEXT, tier TEXT DEFAULT 'Volt',
    role TEXT DEFAULT 'player', is_banned INTEGER DEFAULT 0, session_version INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  for (const role of ["student", "teacher", "admin", "player"]) {
    await legacyDb.run("INSERT INTO users(username,email,password_hash,display_name,role,session_version) VALUES(?,?,?,?,?,3)", `legacy-${role}`, `legacy-${role}@example.com`, await hashPassword("old-password"), role, role);
  }
  const legacyBefore = await legacyDb.all("SELECT * FROM users ORDER BY id");
  await legacyDb.close();
  let db = await initializeDatabase();
  for (const user of legacyBefore) await db.run("INSERT INTO user_stats(user_id,games_played,total_score) VALUES(?,7,123)", user.id);
  let now = Date.now();
  const mail: Array<{ to: string; code: string }> = [];
  const resetMail: Array<{ to: string; code: string }> = [];
  const service = new EmailVerificationService(async (to, code) => { mail.push({ to, code }); return { id: "mock" }; }, () => now);
  const recovery = new PasswordResetService(async (to, code) => { resetMail.push({ to, code }); return { id: "mock" }; }, () => now);
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createPasswordResetRouter(recovery), createAuthRouter(service));
  const server = createServer(app);
  const lan = attachLanServer(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const me = async (token: string) => (await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status;
  const register = async (name: string) => service.register({ username: name, email: `${name}@example.com`, password: "new-password", displayName: name }, name);
  const codeFor = (name: string) => mail.filter((item) => item.to === `${name}@example.com`).at(-1)!.code;
  const userFor = (name: string) => db.get("SELECT * FROM users WHERE username=?", name);
  try {
    await t.test("first migration preserves every existing role, hash, ID and version; legacy login works", async () => {
      for (const before of legacyBefore) {
        const after = await userFor(before.username);
        for (const key of Object.keys(before)) assert.equal(after[key], before[key]);
        assert.equal(after.email_verified, 1);
        assert.equal(after.email_verified_at, null);
        const result = await post("/login", { username: before.username, password: "old-password" });
        assert.equal(result.status, 200);
        assert.equal(verifyToken(result.body.token)?.sessionVersion, 3);
        assert.equal(await me(result.body.token), 200);
      }
    });

    await t.test("runtime validation and independent secret requirements", () => {
      for (const body of [null, {}, { username: [], email: "a@example.com", password: "abcdef", displayName: "a" }, { username: "a", email: "bad", password: "abcdef", displayName: "a" }, { username: "a", email: "a@example.com", password: "a".repeat(73), displayName: "a" }]) assert.throws(() => validateRegistration(body));
      const saved = process.env.EMAIL_VERIFICATION_SECRET;
      for (const secret of ["", "short", process.env.PASSWORD_RESET_SECRET!, process.env.JWT_SECRET!]) {
        process.env.EMAIL_VERIFICATION_SECRET = secret;
        assert.throws(verificationSecret);
      }
      process.env.EMAIL_VERIFICATION_SECRET = saved;
      assert.doesNotThrow(verificationSecret);
      for (const email of ["a..b@example.com", ".a@example.com", "a.@example.com", "a@-example.com", "a@example-.com"]) {
        assert.throws(() => validateRegistration({ username: "invalid", email, password: "abcdef", displayName: "Invalid" }));
      }
    });

    await t.test("registration is pending, normalized, atomic, token-free and cannot assign public roles", async () => {
      const result = await post("/register", { username: "pending", email: " Pending@Example.COM ", password: "new-password", displayName: "Pending", role: "admin" });
      assert.equal(result.status, 201);
      assert.deepEqual(Object.keys(result.body).sort(), ["message", "verificationRequired"]);
      const user = await userFor("pending");
      assert.equal(user.email, "pending@example.com");
      assert.equal(user.email_verified, 0);
      assert.equal(user.role, "player");
      assert.equal(user.session_version, 0);
      assert.ok(await db.get("SELECT id FROM user_stats WHERE user_id=?", user.id));
      const row = await db.get("SELECT * FROM email_verification_codes WHERE user_id=?", user.id);
      assert.match(row.code_hash, /^[a-f0-9]{32}:[a-f0-9]{64}$/);
      assert.equal(row.expires_at - row.created_at, 600_000);
      assert.match(codeFor("pending"), /^\d{6}$/);
      assert.equal((await post("/login", { username: "pending", password: "incorrect" })).status, 401);
      const denied = await post("/login", { username: "pending", password: "new-password" });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.code, "EMAIL_VERIFICATION_REQUIRED");
      assert.equal(await me(generateToken({ userId: user.id, username: "pending", role: "student" })), 401);
      const count = mail.length;
      assert.equal((await post("/register", { username: "other", email: " PENDING@example.com ", password: "another-password", displayName: "Other" })).status, 409);
      assert.equal(mail.length, count);
      assert.equal((await userFor("pending")).password_hash, user.password_hash);
      await db.run("CREATE TRIGGER fail_test_stats BEFORE INSERT ON user_stats BEGIN SELECT RAISE(ABORT,'test rollback'); END");
      await assert.rejects(register("rollback"));
      assert.equal(await userFor("rollback"), undefined);
      // Test-only cleanup of a trigger created solely in this temporary fixture.
      await db.exec("DROP TRIGGER fail_test_stats");
    });

    await t.test("repeat migration never verifies new accounts and legacy email collisions are rejected", async () => {
      await closeDatabase();
      db = await initializeDatabase();
      assert.equal((await userFor("pending")).email_verified, 0);
      assert.equal((await userFor("legacy-admin")).email_verified, 1);
      await db.run("UPDATE users SET email=' Legacy-Student@Example.COM ' WHERE username='legacy-student'");
      await assert.rejects(service.register({ username: "collision", email: "legacy-student@example.com", password: "abcdef", displayName: "Collision" }, "collision"), (error: any) => error.status === 409);
    });

    await t.test("Teacher promotion cannot bypass HTTP, login or LAN gates; verification preserves records", async () => {
      await db.run("UPDATE users SET role='teacher' WHERE username='pending'");
      const before = await userFor("pending");
      const stats = await db.get("SELECT * FROM user_stats WHERE user_id=?", before.id);
      const token = generateToken({ userId: before.id, username: "pending", role: "teacher" });
      assert.equal(await me(token), 401);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await once(socket, "open");
      const denied = once(socket, "message");
      socket.send(JSON.stringify({ type: "create_room", token }));
      assert.equal(JSON.parse(String((await denied)[0])).type, "error");
      socket.close();
      await once(socket, "close");
      const result = await post("/verify-email", { email: " PENDING@example.com ", code: codeFor("pending") });
      assert.equal(result.status, 200);
      assert.deepEqual(Object.keys(result.body), ["message"]);
      const after = await userFor("pending");
      assert.equal(after.email_verified, 1);
      assert.equal(after.email_verified_at, now);
      for (const key of Object.keys(before).filter((key) => !["email_verified", "email_verified_at"].includes(key))) assert.equal(after[key], before[key]);
      assert.deepEqual(await db.get("SELECT * FROM user_stats WHERE user_id=?", before.id), stats);
      assert.equal(await me(token), 200);
      assert.equal((await post("/login", { username: "pending", password: "new-password" })).status, 200);
      assert.equal((await post("/verify-email", { email: "pending@example.com", code: codeFor("pending") })).status, 400);
      const verified = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await once(verified, "open");
      const created = once(verified, "message");
      verified.send(JSON.stringify({ type: "create_room", token, wordSet: "General", difficulty: "Normal", roundTime: 90 }));
      assert.equal(JSON.parse(String((await created)[0])).type, "room_created");
      verified.close();
      await once(verified, "close");
    });

    await t.test("wrong, numeric, expired, consumed and exhausted codes fail; leading zeroes work", async () => {
      for (const name of ["wrong", "expired", "used", "leading"]) await register(name);
      const wrong = codeFor("wrong") === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i++) assert.equal(await service.verify("wrong@example.com", i === 0 ? Number(codeFor("wrong")) : wrong, `guess-${i}`), false);
      assert.equal(await service.verify("wrong@example.com", codeFor("wrong"), "fresh-guess"), false);
      assert.equal((await db.get("SELECT attempts FROM email_verification_codes WHERE user_id=(SELECT id FROM users WHERE username='wrong')")).attempts, 5);
      await db.run("UPDATE email_verification_codes SET consumed_at=? WHERE user_id=(SELECT id FROM users WHERE username='used')", now);
      assert.equal(await service.verify("used@example.com", codeFor("used"), "used"), false);
      const leading = await userFor("leading");
      const nonce = randomBytes(16).toString("hex");
      const digest = createHmac("sha256", process.env.EMAIL_VERIFICATION_SECRET!).update(`email-verification:otp:${leading.id}:${nonce}:012345`).digest("hex");
      await db.run("UPDATE email_verification_codes SET code_hash=? WHERE user_id=?", `${nonce}:${digest}`, leading.id);
      assert.equal(await service.verify("leading@example.com", "012345", "leading"), true);
      now += 600_000;
      assert.equal(await service.verify("expired@example.com", codeFor("expired"), "expired"), false);
    });

    await t.test("cooldown, replacement, email/IP quotas and generic public resend", async () => {
      await register("resend");
      const user = await userFor("resend");
      const original = await db.get("SELECT id FROM email_verification_codes WHERE user_id=?", user.id);
      const count = mail.length;
      await service.resend("resend@example.com", "new-ip");
      assert.equal(mail.length, count);
      now += 60_001;
      await service.resend("resend@example.com", "new-ip");
      assert.equal(mail.length, count + 1);
      assert.notEqual((await db.get("SELECT consumed_at FROM email_verification_codes WHERE id=?", original.id)).consumed_at, null);
      now += 60_001;
      await service.resend("resend@example.com", "new-ip");
      now += 60_001;
      await service.resend("resend@example.com", "new-ip");
      assert.equal(mail.length, count + 2);
      for (let i = 0; i < 10; i++) await service.resend(`absent${i}@example.com`, "limited-ip");
      await register("ip-limited");
      now += 60_001;
      const before = mail.length;
      await service.resend("ip-limited@example.com", "limited-ip");
      assert.equal(mail.length, before);
      const missing = await post("/resend-verification-code", { email: "absent@example.com" });
      assert.deepEqual(await post("/resend-verification-code", { email: "pending@example.com" }), missing);
      assert.deepEqual(await post("/resend-verification-code", { email: [] }), missing);
      // Let bounded background jobs finish before later DB teardown.
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (let i = 0; i < 30; i++) assert.equal(await service.verify(`absent-check${i}@example.com`, "012345", "verify-limited-ip"), false);
      assert.equal(await service.verify("ip-limited@example.com", codeFor("ip-limited"), "verify-limited-ip"), false);
      await db.run("UPDATE users SET is_banned=1 WHERE username='ip-limited'");
      assert.equal(await service.verify("ip-limited@example.com", codeFor("ip-limited"), "new-check-ip"), false);
      await service.resend("ip-limited@example.com", "unlimited-ip");
      assert.equal(mail.length, before);
    });

    await t.test("delivery failure leaves pending account and supports later resend", async () => {
      const failing = new EmailVerificationService(async () => { throw new Error("sensitive details"); }, () => now);
      await assert.doesNotReject(failing.register({ username: "failure", email: "failure@example.com", password: "abcdef", displayName: "Failure" }, "failure"));
      assert.equal((await userFor("failure")).email_verified, 0);
      assert.notEqual((await db.get("SELECT consumed_at FROM email_verification_codes WHERE user_id=(SELECT id FROM users WHERE username='failure')")).consumed_at, null);
      now += 60_001;
      await service.resend("failure@example.com", "failure");
      assert.equal(await service.verify("failure@example.com", codeFor("failure"), "failure"), true);
    });

    await t.test("Forgot Password codes/quotas are isolated and reset never verifies email", async () => {
      await register("isolation");
      const before = await userFor("isolation");
      const resetRates = await db.all("SELECT * FROM password_reset_rate_limits");
      assert.equal(await service.verify("isolation@example.com", "bad", "isolation"), false);
      assert.deepEqual(await db.all("SELECT * FROM password_reset_rate_limits"), resetRates);
      await recovery.forgot("isolation@example.com", "isolation");
      const resetCode = resetMail.at(-1)!.code;
      const verificationRates = await db.all("SELECT * FROM email_verification_rate_limits");
      assert.equal(await recovery.reset("isolation@example.com", resetCode, "changed-password", "isolation"), true);
      assert.deepEqual(await db.all("SELECT * FROM email_verification_rate_limits"), verificationRates);
      const after = await userFor("isolation");
      assert.equal(after.email_verified, 0);
      assert.equal(after.session_version, before.session_version + 1);
      const resetRow = await db.get("SELECT code_hash FROM password_reset_codes WHERE user_id=?", before.id);
      await db.run("UPDATE email_verification_codes SET code_hash=? WHERE user_id=?", resetRow.code_hash, before.id);
      assert.equal(await service.verify("isolation@example.com", resetCode, "isolation"), false);
      assert.equal((await post("/login", { username: "isolation", password: "changed-password" })).body.code, "EMAIL_VERIFICATION_REQUIRED");
    });

    await t.test("concurrent verify succeeds once; persistent attempt quota and registration flood limit", async () => {
      await register("concurrent");
      const outcomes = await Promise.all([service.verify("concurrent@example.com", codeFor("concurrent"), "concurrent"), service.verify("concurrent@example.com", codeFor("concurrent"), "concurrent")]);
      assert.equal(outcomes.filter(Boolean).length, 1);
      for (let i = 0; i < 10; i++) await service.verify("quota-missing@example.com", "bad", `email-quota-${i}`);
      const key = createHmac("sha256", process.env.EMAIL_VERIFICATION_SECRET!).update("email-verification:rate:verify:email:quota-missing@example.com").digest("hex");
      await service.verify("quota-missing@example.com", "bad", "email-quota-extra");
      assert.equal((await db.get("SELECT count FROM email_verification_rate_limits WHERE key=?", key)).count, 10);
      await closeDatabase();
      db = await initializeDatabase();
      assert.equal((await db.get("SELECT count FROM email_verification_rate_limits WHERE key=?", key)).count, 10);
      for (let i = 0; i < 10; i++) {
        await assert.rejects(service.register({ username: "legacy-admin", email: "legacy-admin@example.com", password: "abcdef", displayName: "Duplicate" }, "register-flood"), (error: any) => error.status === 409);
      }
      await assert.rejects(service.register({ username: "flooded", email: "flooded@example.com", password: "abcdef", displayName: "Flooded" }, "register-flood"), (error: any) => error.status === 429);
    });
  } finally {
    for (const socket of lan.clients) socket.terminate();
    await new Promise<void>((resolve) => lan.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("type-tiles-verification-"));
    await rm(target, { recursive: true, force: true });
  }
});
