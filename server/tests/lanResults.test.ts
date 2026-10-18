import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import { WebSocket } from "ws";
import { initializeDatabase, closeDatabase } from "../src/db.js";
import { generateToken } from "../src/auth.js";
import { attachLanServer } from "../src/lan.js";
import matchesRoutes from "../src/routes/matches.js";

test("LAN results combine with sentence history and teacher ownership", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "typetiles-lan-results-"));
  process.env.DATABASE_PROVIDER = "sqlite";
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  const db = await initializeDatabase();
  const identities: { id: number; token: string }[] = [];
  for (const [index, role] of ["teacher", "student", "student", "teacher"].entries()) {
    const result = await db.run("INSERT INTO users (username,email,password_hash,display_name,role,email_verified) VALUES (?,?,?,?,?,1)",
      [`user-${index}`, `user-${index}@example.com`, "test-only", `User ${index}`, role]);
    const id = result.lastID!;
    await db.run("INSERT INTO user_stats (user_id) VALUES (?)", id);
    identities.push({ id, token: generateToken({ userId: id, username: `user-${index}`, role }) });
  }
  const app = express(); app.use(express.json()); app.use("/api", matchesRoutes);
  const server = createServer(app); const lan = attachLanServer(server);
  const sockets: WebSocket[] = [];
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const inboxes: any[][] = [];
    const waitFor = async (index: number, type: string, predicate: (m: any) => boolean = () => true) => {
      for (let attempt = 0; attempt < 500; attempt++) {
        const at = inboxes[index].findIndex((m) => m.type === type && predicate(m));
        if (at >= 0) return inboxes[index].splice(at, 1)[0];
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Missing ${type} on socket ${index}`);
    };
    for (let i = 0; i < 3; i++) {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      inboxes.push([]); socket.on("message", (raw) => inboxes[i].push(JSON.parse(raw.toString())));
      sockets.push(socket); await once(socket, "open");
    }
    const send = (i: number, body: object) => sockets[i].send(JSON.stringify(body));
    send(0, { type: "create_room", token: identities[0].token, wordSet: "Legal", difficulty: "Easy", roundTime: 30 });
    const { roomCode } = await waitFor(0, "room_created");
    for (let i = 1; i < 3; i++) {
      send(i, { type: "join_room", roomCode, token: identities[i].token }); await waitFor(i, "room_joined");
      send(i, { type: "ready" }); await waitFor(0, "room_state", (m) => m.players.some((p: any) => p.userId === identities[i].id && p.ready));
    }
    send(0, { type: "start_game" }); await waitFor(0, "room_started");
    send(1, { type: "score_update", roomCode, score: 10, wpm: 30, accuracy: 90, completedWords: 1, lives: 0, finished: true });
    await waitFor(0, "standings_update", (m) => m.players.some((p: any) => p.userId === identities[1].id && p.finished));
    send(2, { type: "score_update", roomCode, score: 0, wpm: 0, accuracy: 0, completedWords: 0, lives: 3, finished: true });
    const results = await waitFor(0, "classroom_results"); assert.equal(results.players.length, 2);
    const match = await db.get("SELECT * FROM matches WHERE mode = 'LAN Match'");
    assert.equal(match.status, "completed"); assert(match.ended_at); assert.equal(match.word_set, "legal");
    const first = await db.get("SELECT * FROM match_participants WHERE match_id = ? AND user_id = ?", match.id, identities[1].id);
    assert.equal(first.error_rate, 10); assert.equal(first.end_reason, "health"); assert.equal(first.position, 1);
    const request = (path: string, i: number) => fetch(base + path, { headers: { authorization: `Bearer ${identities[i].token}` } });
    assert.equal((await (await request("/users/history", 2)).json()).history.length, 1);
    assert.equal((await (await request("/teacher/matches", 0)).json()).sessions.length, 1);
    assert.equal((await request(`/teacher/matches/${match.id}`, 3)).status, 404);
    assert.equal((await request(`/teacher/matches/${match.id}`, 1)).status, 403);
    const detail = await (await request(`/teacher/matches/${match.id}`, 0)).json();
    assert.equal(detail.participants.length, 2); assert(detail.participants.every((p: any) => p.participant_status === "Finished"));
    assert.equal((await db.get("SELECT games_played FROM user_stats WHERE user_id = ?", identities[1].id)).games_played, 0);
    await closeDatabase(); const reopened = await initializeDatabase();
    assert.equal((await reopened.get("SELECT status FROM matches WHERE id = ?", match.id)).status, "completed");
    assert.equal((await (await request("/users/history", 1)).json()).history[0].score, 10);
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const socket of lan.clients) socket.terminate();
    await new Promise<void>((resolve) => lan.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase(); await rm(directory, { recursive: true, force: true });
  }
});
