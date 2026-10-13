import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { initializeDatabase, getDatabase, closeDatabase } from "../src/db.js";
import { generateToken } from "../src/auth.js";
import matchesRoutes from "../src/routes/matches.js";
import { SENTENCE_BANK, getCategorySentences } from "../src/sentenceBank.js";

test("sentence practice: additive migration, API validation and durable history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "typetiles-sentences-"));
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  const legacy = await open({ filename: process.env.DATABASE_PATH, driver: sqlite3.Database });
  await legacy.exec(`CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, difficulty TEXT NOT NULL,
    round_time INTEGER DEFAULT 90, word_set TEXT NOT NULL, status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME
  ); INSERT INTO matches (mode, difficulty, word_set) VALUES ('Solo Practice', 'Normal', 'General')`);
  await legacy.close();
  const app = express();
  app.use(express.json());
  app.use("/api", matchesRoutes);
  const server = createServer(app);
  try {
    const db = await initializeDatabase();
    assert.equal((await db.get("SELECT practice_format FROM matches WHERE id = 1")).practice_format, "word-phrase");
    await db.run("INSERT INTO users (username,email,password_hash,display_name,role,email_verified) VALUES ('sentence-student','sentence@example.com','test-only','Sentence Student','student',1)");
    const user = await db.get("SELECT id FROM users WHERE username = 'sentence-student'");
    await db.run("INSERT INTO user_stats (user_id) VALUES (?)", user.id);
    const token = generateToken({ userId: user.id, username: "sentence-student", role: "student" });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const create = (body: object) => fetch(`${base}/matches`, { method: "POST", headers, body: JSON.stringify(body) });
    const defaults = { mode: "Solo Practice", difficulty: "Normal", roundTime: 90, wordSet: "General" };
    assert.equal((await create({ ...defaults, practiceFormat: "invalid" })).status, 400);
    assert.equal((await create({ ...defaults, wordSet: "Stenography", practiceFormat: "full-sentence" })).status, 400);
    assert.equal((await create({ ...defaults, mode: "LAN Match", practiceFormat: "full-sentence" })).status, 400);
    const oldClient = await create(defaults);
    assert.equal(oldClient.status, 201);
    assert.equal((await oldClient.json()).practiceFormat, "word-phrase");
    for (const [category, sentences] of Object.entries(SENTENCE_BANK)) {
      assert.equal(sentences.length, 10);
      assert.equal(new Set(sentences).size, 10);
      assert.deepEqual(getCategorySentences(category.toUpperCase()), sentences);
      const response = await create({ ...defaults, wordSet: category, practiceFormat: "full-sentence" });
      assert.equal(response.status, 201);
      const match = await response.json();
      assert.equal(match.practiceFormat, "full-sentence");
      const submitted = await fetch(`${base}/matches/${match.matchId}/submit`, {
        method: "POST", headers, body: JSON.stringify({ score: 10, wpm: 45, accuracy: 98 }),
      });
      assert.equal(submitted.status, 200);
    }
    await closeDatabase();
    await initializeDatabase();
    const response = await fetch(`${base}/users/history`, { headers });
    assert.equal(response.status, 200);
    const { history } = await response.json();
    assert.equal(history.length, 6);
    assert(history.every((row: { practice_format: string }) => row.practice_format === "full-sentence"));
    assert.equal((await getDatabase().get("SELECT games_played FROM user_stats WHERE user_id = ?", user.id)).games_played, 6);
    assert.equal((await getDatabase().get("SELECT practice_format FROM matches WHERE id = 1")).practice_format, "word-phrase");
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
    await rm(directory, { recursive: true, force: true });
  }
});
