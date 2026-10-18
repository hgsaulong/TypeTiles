import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { initializeDatabase, closeDatabase } from "../src/db.js";
import { generateToken, hashPassword, jwtSecret, normalizeRole, verifyPassword, verifyToken } from "../src/auth.js";
import { PasswordResetService, normalizeRecoveryEmail, resetSecret } from "../src/passwordReset.js";
import { createPasswordResetRouter } from "../src/routes/passwordReset.js";
import authRoutes from "../src/routes/auth.js";
import { attachLanServer } from "../src/lan.js";

test("password recovery integration (isolated SQLite; mocked delivery)", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "type-tiles-auth-"));
  process.env.DATABASE_PROVIDER = "sqlite";
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  process.env.PASSWORD_RESET_SECRET = randomBytes(32).toString("hex");
  const legacyDb = await open({ filename: process.env.DATABASE_PATH, driver: sqlite3.Database });
  await legacyDb.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, display_name TEXT NOT NULL, avatar TEXT, tier TEXT DEFAULT 'Volt',
    role TEXT DEFAULT 'player', is_banned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ); INSERT INTO users(username,email,password_hash,display_name) VALUES('sentinel','sentinel@example.com','preserved-hash','Sentinel');`);
  await legacyDb.close();
  let db = await initializeDatabase();
  let now = Date.now();
  const mail: Array<{ to: string; code: string }> = [];
  const service = new PasswordResetService(async (to, code) => { mail.push({ to, code }); return { id: "mock" }; }, () => now);
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createPasswordResetRouter(service), authRoutes);
  const server = createServer(app);
  const lan = attachLanServer(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api/auth`;
  const request = async (path: string, body: object) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const me = async (token: string) => (await fetch(`${base}/me`, { headers: { Authorization: `Bearer ${token}` } })).status;
  const seed = async (name: string, role = "player", email = `${name}@example.com`) => {
    // Fixtures represent existing verified users; new-registration behavior is tested separately.
    const result = await db.run("INSERT INTO users(username,email,password_hash,display_name,role,email_verified) VALUES(?,?,?,?,?,1)", name, email, await hashPassword("old-password"), name, role);
    await db.run("INSERT INTO user_stats(user_id,games_played,total_score) VALUES(?,7,123)", result.lastID);
    return result.lastID!;
  };
  const code = () => mail[mail.length - 1].code;
  try {
    await t.test("additive initialization preserves legacy users and is idempotent across restart", async () => {
      const sentinel = await db.get("SELECT * FROM users WHERE username='sentinel'");
      assert.equal(sentinel.password_hash, "preserved-hash");
      assert.equal(sentinel.role, "player");
      assert.equal(sentinel.session_version, 0);
      await closeDatabase();
      db = await initializeDatabase();
      assert.deepEqual(await db.get("SELECT * FROM users WHERE username='sentinel'"), sentinel);
    });
    await t.test("secret requirements and careful email normalization", () => {
      assert.equal(normalizeRecoveryEmail("  User+tag@Example.COM "), "user+tag@example.com");
      assert.equal(normalizeRecoveryEmail({}), null);
      const saved = process.env.PASSWORD_RESET_SECRET;
      delete process.env.PASSWORD_RESET_SECRET;
      assert.throws(resetSecret);
      process.env.PASSWORD_RESET_SECRET = saved;
      const savedJwt = process.env.JWT_SECRET;
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      assert.throws(jwtSecret);
      process.env.JWT_SECRET = "your_super_secret_key_change_this";
      assert.throws(jwtSecret);
      process.env.JWT_SECRET = savedJwt;
      assert.doesNotThrow(jwtSecret);
      process.env.NODE_ENV = "test";
    });

    await t.test("correct code, HMAC storage, verify without consuming, malformed guesses, cooldown and replacement", async () => {
      const id = await seed("correct");
      await service.forgot("correct@example.com", "correct-ip");
      const original = code();
      assert.match(original, /^\d{6}$/);
      const row = await db.get("SELECT * FROM password_reset_codes WHERE user_id=?", id);
      assert.match(row.code_hash, /^[a-f0-9]{32}:[a-f0-9]{64}$/);
      assert.equal(row.expires_at - row.created_at, 600_000);
      assert.equal(await service.verify("correct@example.com", original, "correct-ip"), true);
      assert.equal((await db.get("SELECT consumed_at FROM password_reset_codes WHERE id=?", row.id)).consumed_at, null);
      assert.equal(await service.verify("correct@example.com", "bad", "correct-ip"), false);
      const count = mail.length;
      await service.forgot("correct@example.com", "different-ip");
      assert.equal(mail.length, count);
      now += 60_001;
      await service.forgot("correct@example.com", "different-ip");
      assert.equal(mail.length, count + 1);
      assert.notEqual((await db.get("SELECT consumed_at FROM password_reset_codes WHERE id=?", row.id)).consumed_at, null);
    });

    await t.test("expired, consumed and five incorrect attempts reject", async () => {
      for (const name of ["expired", "used", "attempts"]) await seed(name);
      await service.forgot("expired@example.com", "expired-ip");
      const expired = code();
      now += 600_000;
      assert.equal(await service.verify("expired@example.com", expired, "expired-ip"), false);
      await service.forgot("used@example.com", "used-ip");
      const used = code();
      await db.run("UPDATE password_reset_codes SET consumed_at=? WHERE user_id=(SELECT id FROM users WHERE username='used')", now);
      assert.equal(await service.verify("used@example.com", used, "used-ip"), false);
      await service.forgot("attempts@example.com", "attempts-ip");
      const correct = code();
      const wrong = correct === "000000" ? "000001" : "000000";
      for (let i = 0; i < 5; i++) assert.equal(await service.verify("attempts@example.com", wrong, `guess-${i}`), false);
      assert.equal(await service.verify("attempts@example.com", correct, "fresh-ip"), false);
      assert.equal((await db.get("SELECT attempts FROM password_reset_codes WHERE user_id=(SELECT id FROM users WHERE username='attempts')")).attempts, 5);
    });

    await t.test("nonexistent, ambiguous and banned accounts do not send; persistent IP/email quotas", async () => {
      const count = mail.length;
      await service.forgot("missing@example.com", "missing-ip");
      assert.equal(await service.verify("missing@example.com", "123456", "missing-ip"), false);
      await seed("ambiguous1", "player", "Ambiguous@example.com");
      await seed("ambiguous2", "player", "ambiguous@example.com");
      await service.forgot("ambiguous@example.com", "ambiguous-ip");
      const banned = await seed("banned");
      await db.run("UPDATE users SET is_banned=1 WHERE id=?", banned);
      await service.forgot("banned@example.com", "banned-ip");
      assert.equal(mail.length, count);
      await seed("quota");
      for (let i = 0; i < 4; i++) { await service.forgot("quota@example.com", `quota-${i}`); now += 60_001; }
      assert.equal(mail.length, count + 3);
      for (let i = 0; i < 10; i++) await service.forgot(`missing${i}@example.com`, "limited-ip");
      await seed("ipquota");
      await service.forgot("ipquota@example.com", "limited-ip");
      assert.equal(mail.length, count + 3);
      now += 3_600_001;
      await new PasswordResetService(async (to, value) => { mail.push({ to, code: value }); return { id: "mock" }; }, () => now).forgot("quota@example.com", "quota-new");
      assert.equal(mail.length, count + 4);
      const validCode = code();
      for (let i = 0; i < 10; i++) assert.equal(await service.verify("quota@example.com", validCode, `check-${i}`), true);
      assert.equal(await service.verify("quota@example.com", validCode, "check-new"), false);
    });

    await t.test("provider failure revokes issuance without propagating sensitive errors", async () => {
      const id = await seed("failure");
      const failing = new PasswordResetService(async () => { throw new Error("sensitive provider details"); }, () => now);
      await assert.doesNotReject(failing.forgot("failure@example.com", "failure-ip"));
      assert.notEqual((await db.get("SELECT consumed_at FROM password_reset_codes WHERE user_id=?", id)).consumed_at, null);
    });

    await t.test("reset preserves records and roles; old/legacy JWT rejection; fresh login for all roles", async () => {
      for (const role of ["player", "teacher", "admin"]) {
        const name = `reset-${role}`;
        const id = await seed(name, role);
        await db.run("INSERT INTO matches(mode,difficulty,word_set) VALUES('Solo','Normal','General')");
        const match = await db.get("SELECT max(id) AS id FROM matches");
        await db.run("INSERT INTO match_participants(match_id,user_id,score) VALUES(?,?,42)", match.id, id);
        await db.run("INSERT INTO match_results(match_id,user_id,result) VALUES(?,?,'win')", match.id, id);
        const before = await db.get("SELECT * FROM users WHERE id=?", id);
        const stats = await db.get("SELECT * FROM user_stats WHERE user_id=?", id);
        const old = generateToken({ userId: id, username: name, role: normalizeRole(role) });
        const legacy = jwt.sign({ userId: id, username: name, role }, jwtSecret());
        assert.equal(await me(old), 200);
        assert.equal(await me(legacy), 200);
        await service.forgot(`${name}@example.com`, name);
        const value = code();
        const outcomes = await Promise.all([service.reset(`${name}@example.com`, value, "new-password", name), service.reset(`${name}@example.com`, value, "new-password", name)]);
        assert.equal(outcomes.filter(Boolean).length, 1);
        assert.equal(await service.verify(`${name}@example.com`, value, name), false);
        const after = await db.get("SELECT * FROM users WHERE id=?", id);
        assert.equal(after.session_version, 1);
        assert.equal(await verifyPassword("new-password", after.password_hash), true);
        assert.equal(await verifyPassword("old-password", after.password_hash), false);
        for (const field of ["id", "username", "role", "email", "display_name", "tier", "created_at", "is_banned"]) assert.equal(after[field], before[field]);
        assert.deepEqual(await db.get("SELECT * FROM user_stats WHERE user_id=?", id), stats);
        assert.equal((await db.get("SELECT score FROM match_participants WHERE user_id=?", id)).score, 42);
        assert.equal((await db.get("SELECT result FROM match_results WHERE user_id=?", id)).result, "win");
        assert.equal(await me(old), 401);
        assert.equal(await me(legacy), 401);
        const login = await request("/login", { username: name, password: "new-password" });
        assert.equal(login.status, 200);
        assert.equal(login.body.user.role, normalizeRole(role));
        assert.equal(verifyToken(login.body.token)?.sessionVersion, 1);
        assert.equal(await me(login.body.token), 200);
      }
    });

    await t.test("public endpoint contracts and password bounds", async () => {
      const id = await seed("http");
      const missing = await request("/forgot-password", { email: "absent@example.com" });
      const existing = await request("/forgot-password", { email: "http@example.com" });
      assert.deepEqual(existing, missing);
      assert.deepEqual(await request("/forgot-password", { email: [] }), missing);
      // Await the explicitly asynchronous worker without sending real email.
      for (let i = 0; i < 100 && !mail.some((item) => item.to === "http@example.com"); i++) await new Promise((resolve) => setTimeout(resolve, 10));
      const value = mail.find((item) => item.to === "http@example.com")!.code;
      assert.equal((await request("/verify-reset-code", { email: " HTTP@example.com ", code: value })).status, 200);
      assert.equal((await request("/reset-password", { email: "http@example.com", code: value, newPassword: "short" })).status, 400);
      assert.equal((await request("/reset-password", { email: "http@example.com", code: value, newPassword: "a".repeat(73) })).status, 400);
      const reset = await request("/reset-password", { email: "http@example.com", code: value, newPassword: "http-new-password" });
      assert.equal(reset.status, 200);
      assert.deepEqual(Object.keys(reset.body), ["message"]);
      assert.equal((await request("/verify-reset-code", { email: "http@example.com", code: value })).status, 400);
      assert.equal((await db.get("SELECT session_version FROM users WHERE id=?", id)).session_version, 1);
    });

    await t.test("existing LAN socket is evicted and old JWT cannot reconnect", async () => {
      const id = await seed("socket", "teacher");
      const token = generateToken({ userId: id, username: "socket", role: "teacher" });
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      await once(socket, "open");
      const created = once(socket, "message");
      socket.send(JSON.stringify({ type: "create_room", token, wordSet: "General", difficulty: "Normal", roundTime: 90 }));
      assert.equal(JSON.parse(String((await created)[0])).type, "room_created");
      await service.forgot("socket@example.com", "socket-ip");
      const closed = once(socket, "close");
      assert.equal(await service.reset("socket@example.com", code(), "socket-new-password", "socket-ip"), true);
      assert.equal((await closed)[0], 4001);
      const reconnect = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      await once(reconnect, "open");
      const denied = once(reconnect, "message");
      reconnect.send(JSON.stringify({ type: "create_room", token }));
      assert.equal(JSON.parse(String((await denied)[0])).type, "error");
      const end = once(reconnect, "close");
      reconnect.close();
      await end;
    });

    await t.test("LAN actions recheck persisted version without an in-process reset event", async () => {
      const id = await seed("external-socket", "teacher");
      const token = generateToken({ userId: id, username: "external-socket", role: "teacher" });
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      await once(socket, "open");
      const created = once(socket, "message");
      socket.send(JSON.stringify({ type: "create_room", token, wordSet: "General", difficulty: "Normal", roundTime: 90 }));
      assert.equal(JSON.parse(String((await created)[0])).type, "room_created");
      await db.run("UPDATE users SET session_version=session_version+1 WHERE id=?", id);
      const closed = once(socket, "close");
      socket.send(JSON.stringify({ type: "start_game" }));
      assert.equal((await closed)[0], 4001);
    });
  } finally {
    for (const client of lan.clients) client.terminate();
    await new Promise<void>((resolve) => lan.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("type-tiles-auth-"));
    await rm(target, { recursive: true, force: true });
  }
});
