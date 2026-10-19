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
import { attachLanServer, compareClassroomResults } from "../src/lan.js";
import matchesRoutes from "../src/routes/matches.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClassroomLeaderboard } from "../../src/components/ClassroomLeaderboard.js";

class Peer {
  readonly messages: any[] = [];
  readonly counts = new Map<string, number>();
  private constructor(readonly socket: WebSocket) {
    socket.on("message", raw => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      this.counts.set(message.type, (this.counts.get(message.type) || 0) + 1);
    });
  }
  static async open(url: string) {
    const peer = new Peer(new WebSocket(url));
    await once(peer.socket, "open");
    return peer;
  }
  send(message: object) { this.socket.send(JSON.stringify(message)); }
  async wait(type: string, predicate: (message: any) => boolean = () => true) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const index = this.messages.findIndex(message => message.type === type && predicate(message));
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Missing ${type}`);
  }
}

test("classroom rank ordering: score, existing WPM/accuracy, stable join order", () => {
  const rows = [
    { score: 10, wpm: 40, accuracy: 99, joinOrder: 0 },
    { score: 20, wpm: 30, accuracy: 90, joinOrder: 1 },
    { score: 20, wpm: 40, accuracy: 90, joinOrder: 2 },
    { score: 20, wpm: 40, accuracy: 98, joinOrder: 4 },
    { score: 20, wpm: 40, accuracy: 98, joinOrder: 3 },
  ];
  assert.deepEqual(rows.sort(compareClassroomResults).map(row => row.joinOrder), [3, 4, 2, 1, 0]);
});

test("teacher leaderboard renders all 50 students with three highlighted ranks", () => {
  const players = Array.from({ length: 50 }, (_, index) => ({
    userId: index + 1, username: `student-${index + 1}`, displayName: `Student ${index + 1}`,
    rank: index + 1, score: 500 - index * 10, wpm: 40, accuracy: 99,
    lives: 3, completedWords: 1, finished: false, connected: true,
  }));
  const html = renderToStaticMarkup(createElement(ClassroomLeaderboard, { players }));
  assert.equal((html.match(/<tr\b/g) || []).length, 51); // header + 50 students
  assert.equal((html.match(/★/g) || []).length, 3);
  assert(html.includes("#50")); assert(html.includes("Student 50"));
});

test("50 concurrent classroom students plus teacher: capacity, reconnects, ranks and durable SQLite results", { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "typetiles-50-students-"));
  process.env.DATABASE_PROVIDER = "sqlite";
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  const db = await initializeDatabase();
  const identities: { id: number; token: string }[] = [];
  for (let index = 0; index < 54; index++) {
    const role = index === 0 || index === 52 ? "teacher" : index === 53 ? "admin" : "student";
    const id = (await db.run("INSERT INTO users(username,email,password_hash,display_name,role,email_verified) VALUES (?,?,?,?,?,1)",
      `capacity-${index}`, `capacity-${index}@example.test`, "test-only", `Student ${index}`, role)).lastID!;
    await db.run("INSERT INTO user_stats(user_id) VALUES (?)", id);
    identities.push({ id, token: generateToken({ userId: id, username: `capacity-${index}`, role }) });
  }
  const app = express(); app.use(express.json()); app.use("/api", matchesRoutes);
  const server = createServer(app); const lan = attachLanServer(server);
  const peers: Peer[] = [];
  let joined: number[] = [];
  let host!: Peer;
  let roomCode = "";
  let initialOrder: number[] = [];
  let rejected = 0;
  const active = new Map<number, Peer>();
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const open = async () => { const peer = await Peer.open(url); peers.push(peer); return peer; };
    host = await open();
    const students = await Promise.all(Array.from({ length: 51 }, () => open()));
    host.send({ type: "create_room", token: identities[0].token, wordSet: "General", difficulty: "Easy", roundTime: 90 });
    roomCode = (await host.wait("room_created")).roomCode;

    await t.test("0/50 then 49/50; concurrent last-slot race admits student 50 and rejects student 51", async () => {
      const empty = await host.wait("room_state"); assert.equal(empty.studentCount, 0);
      assert.equal(empty.maxStudents, 50); assert.equal(empty.maxPlayers, 51);
      joined = Array.from({ length: 49 }, (_, index) => index + 1);
      await Promise.all(joined.map(async index => {
        const peer = students[index - 1]; active.set(index, peer);
        peer.send({ type: "join_room", roomCode, token: identities[index].token });
        await peer.wait("room_joined");
      }));
      await host.wait("room_state", message => message.studentCount === 49);
      for (const index of [50, 51]) students[index - 1].send({ type: "join_room", roomCode, token: identities[index].token });
      const outcomes = await Promise.all([50, 51].map(async index => {
        const peer = students[index - 1];
        for (let attempt = 0; attempt < 1000; attempt++) {
          const message = peer.messages.find(message => message.type === "room_joined" || message.type === "error");
          if (message) return { index, message };
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("No last-slot response");
      }));
      const winner = outcomes.find(row => row.message.type === "room_joined")!;
      const loser = outcomes.find(row => row.message.code === "ROOM_FULL")!;
      assert(winner); assert(loser); rejected = loser.index;
      joined.push(winner.index); active.set(winner.index, students[winner.index - 1]);
      const full = await host.wait("room_state", message => message.studentCount === 50);
      assert.equal(full.players.length, 51);
      initialOrder = full.players.filter((player: any) => !player.isHost).map((player: any) => player.userId);
      assert.equal(new Set(initialOrder).size, 50);
      assert.match(loser.message.message, /50 students/);
    });

    await t.test("duplicate joins and reserved reconnects never consume extra slots; other roles cannot join", async () => {
      const index = joined[0]; const peer = active.get(index)!;
      peer.send({ type: "join_room", roomCode, token: identities[index].token });
      peer.send({ type: "join_room", roomCode, token: identities[index].token });
      await peer.wait("room_joined"); await peer.wait("room_joined");
      peer.socket.terminate();
      await host.wait("room_state", message => message.players.some((p: any) => p.userId === identities[index].id && p.connected === false));
      const outsider = students[rejected - 1];
      outsider.messages.length = 0;
      outsider.send({ type: "join_room", roomCode, token: identities[rejected].token });
      await outsider.wait("error", message => message.code === "ROOM_FULL");
      const replacement = await open(); active.set(index, replacement);
      replacement.send({ type: "join_room", roomCode, token: identities[index].token }); await replacement.wait("room_joined");
      await host.wait("room_state", message => message.studentCount === 50 && message.players.some((p: any) => p.userId === identities[index].id && p.connected));
      const competing = await Promise.all([open(), open()]);
      for (const candidate of competing) candidate.send({ type: "join_room", roomCode, token: identities[index].token });
      for (let attempt = 0; attempt < 1000; attempt++) {
        const latest = competing.find(candidate => candidate.socket.readyState === WebSocket.OPEN && candidate.messages.some(m => m.type === "room_joined"));
        if (latest && competing.filter(candidate => candidate.socket.readyState === WebSocket.OPEN).length === 1) { active.set(index, latest); break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert(competing.includes(active.get(index)!));
      for (const account of [52, 53]) {
        const forbidden = await open(); forbidden.send({ type: "join_room", roomCode, token: identities[account].token });
        await forbidden.wait("error", message => message.code === "ROLE_NOT_ALLOWED");
      }
      const invalid = await open(); invalid.send({ type: "join_room", roomCode, token: "invalid" });
      await invalid.wait("error", message => /Authentication/.test(message.message));
      const duplicateRows = await db.all("SELECT user_id FROM match_participants GROUP BY match_id,user_id HAVING COUNT(*) > 1");
      assert.equal(duplicateRows.length, 0);
      assert.equal((await db.get("SELECT COUNT(*) AS count FROM match_participants")).count, 51);
    });

    await t.test("teacher reconnects at capacity; only teacher can start; all 50 receive match start", async () => {
      active.get(joined[0])!.send({ type: "start_game" });
      await active.get(joined[0])!.wait("error", message => /Only the host/.test(message.message));
      await Promise.all(joined.map(async index => {
        const peer = active.get(index)!; peer.send({ type: "ready" });
        await peer.wait("room_state", message => message.players.some((p: any) => p.userId === identities[index].id && p.ready));
      }));
      host.socket.terminate(); host = await open();
      host.send({ type: "join_room", roomCode, token: identities[0].token }); await host.wait("room_joined");
      const state = await host.wait("room_state", message => message.studentCount === 50);
      assert.equal(state.players.length, 51);
      host.send({ type: "start_game" }); await host.wait("room_started");
      await Promise.all(joined.map(index => active.get(index)!.wait("room_started")));
      const initial = await host.wait("standings_update");
      assert.deepEqual(initial.players.map((p: any) => p.userId), initialOrder);
      assert.deepEqual(initial.players.map((p: any) => p.rank), Array.from({ length: 50 }, (_, i) => i + 1));
    });

    const metrics = (index: number) => {
      const order = initialOrder.indexOf(identities[index].id);
      return { score: order < 4 ? 100 : 10, wpm: order === 0 ? 50 : order < 4 ? 60 : 30,
        accuracy: order === 0 ? 90 : order === 1 ? 80 : order < 4 ? 95 : 90,
        completedWords: order < 4 ? 10 : 1, lives: 3 };
    };
    await t.test("batched server leaderboard, stable ties and personal rank updates; reconnect keeps performance", async () => {
      const peer = active.get(joined[0])!;
      const baseline = host.counts.get("standings_update") || 0;
      for (let score = 1; score <= 20; score++) peer.send({ type: "score_update", roomCode,
        score, wpm: 20, accuracy: 90, completedWords: 2, lives: 3, finished: false });
      await host.wait("standings_update", message => message.players.some((p: any) => p.userId === identities[joined[0]].id && p.score === 20));
      assert((host.counts.get("standings_update") || 0) - baseline < 10, "20 incoming updates must be coalesced");
      for (const index of joined) active.get(index)!.send({ type: "score_update", roomCode, ...metrics(index), finished: false });
      const update = await host.wait("standings_update", message => message.players.every((p: any) => p.score >= 10) && message.players.filter((p: any) => p.score === 100).length === 4);
      assert.deepEqual(update.players.slice(0, 4).map((p: any) => p.userId), [initialOrder[2], initialOrder[3], initialOrder[1], initialOrder[0]]);
      const studentIndex = joined.find(index => identities[index].id === initialOrder[2])!;
      const personal = await active.get(studentIndex)!.wait("rank_update", message => message.rank === 1 && message.score === 100);
      assert.equal(personal.totalStudents, 50);
      active.get(studentIndex)!.socket.terminate();
      const replacement = await open(); active.set(studentIndex, replacement);
      replacement.send({ type: "join_room", roomCode, token: identities[studentIndex].token }); await replacement.wait("room_joined");
      const restored = await replacement.wait("rank_update", message => message.score === 100);
      assert.equal(restored.rank, 1); assert.equal(restored.totalStudents, 50);
    });

    await t.test("all 50 final results persist once, with ranks and teacher/student permissions", async () => {
      for (const index of joined) active.get(index)!.send({ type: "score_update", roomCode, ...metrics(index), finished: true });
      const final = await host.wait("classroom_results"); assert.equal(final.players.length, 50);
      assert.equal((await active.get(joined[0])!.wait("classroom_results")).players.length, 50);
      const match = await db.get("SELECT * FROM matches"); assert.equal(match.status, "completed"); assert(match.ended_at);
      const saved = await db.all("SELECT * FROM match_participants WHERE user_id <> ? ORDER BY position", identities[0].id);
      assert.equal(saved.length, 50);
      assert.deepEqual(saved.map((p: any) => p.user_id), final.players.map((p: any) => p.userId));
      assert.deepEqual(saved.map((p: any) => p.position), Array.from({ length: 50 }, (_, i) => i + 1));
      assert(saved.every((p: any) => p.end_reason === "time"));
      const get = (path: string, account: number) => fetch(base + path, { headers: { authorization: `Bearer ${identities[account].token}` } });
      const detail = await get(`/teacher/matches/${match.id}`, 0); assert.equal(detail.status, 200);
      assert.equal((await detail.json()).participants.length, 50);
      assert.equal((await get(`/teacher/matches/${match.id}`, 52)).status, 404);
      assert.equal((await get(`/teacher/matches/${match.id}`, joined[0])).status, 403);
      assert.equal((await (await get("/users/history", joined[0])).json()).history.length, 1);
      const late = await open(); late.send({ type: "join_room", roomCode, token: identities[joined[0]].token }); await late.wait("room_joined");
      assert.equal((await late.wait("classroom_results")).players.length, 50);
      for (const peer of peers) peer.socket.terminate();
      await new Promise<void>(resolve => lan.close(() => resolve()));
      await closeDatabase(); const reopened = await initializeDatabase();
      assert.equal((await reopened.get("SELECT COUNT(*) AS count FROM match_participants WHERE position IS NOT NULL")).count, 50);
      assert.equal((await reopened.get("SELECT status FROM matches")).status, "completed");
      console.log("Verified: 50 simultaneous student WebSockets + teacher; 51st rejected; all 50 final results saved and retained after SQLite reopen.");
    });
  } finally {
    for (const peer of peers) peer.socket.terminate();
    for (const socket of lan.clients) socket.terminate();
    if (lan.clients.size) await new Promise<void>(resolve => lan.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeDatabase(); await rm(directory, { recursive: true, force: true });
  }
});

test("classroom capacity rejects invalid configuration", () => {
  for (const maxStudents of [0, 51, 1.5, NaN]) {
    assert.throws(() => attachLanServer(createServer(), { maxStudents }), /between 1 and 50/);
  }
});

test("configured capacity releases explicit pre-match leaves; deadline saves disconnected students", { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "typetiles-classroom-deadline-"));
  process.env.DATABASE_PROVIDER = "sqlite";
  process.env.DATABASE_PATH = join(directory, "test.db");
  process.env.JWT_SECRET = randomBytes(32).toString("hex");
  const db = await initializeDatabase();
  const tokens: string[] = [];
  for (let index = 0; index < 3; index++) {
    const role = index === 0 ? "teacher" : "student";
    const id = (await db.run("INSERT INTO users(username,email,password_hash,display_name,role,email_verified) VALUES (?,?,?,?,?,1)",
      `deadline-${index}`, `deadline-${index}@example.test`, "test-only", `Student ${index}`, role)).lastID!;
    tokens.push(generateToken({ userId: id, username: `deadline-${index}`, role }));
  }
  const server = createServer(); const lan = attachLanServer(server, { maxStudents: 1 });
  const peers: Peer[] = [];
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert(address && typeof address !== "string");
    for (let index = 0; index < 3; index++) peers.push(await Peer.open(`ws://127.0.0.1:${address.port}/ws`));
    const [host, first, second] = peers;
    host.send({ type: "create_room", token: tokens[0], wordSet: "General", difficulty: "Easy", roundTime: 30 });
    const roomCode = (await host.wait("room_created")).roomCode;
    await host.wait("room_state", message => message.studentCount === 0);
    first.send({ type: "join_room", roomCode, token: tokens[1] }); await first.wait("room_joined");
    second.send({ type: "join_room", roomCode, token: tokens[2] });
    await second.wait("error", message => message.code === "ROOM_FULL");
    first.send({ type: "leave_room" });
    await host.wait("room_state", message => message.studentCount === 0);
    second.send({ type: "join_room", roomCode, token: tokens[2] }); await second.wait("room_joined");
    second.send({ type: "ready" });
    await host.wait("room_state", message => message.players.some((p: any) => !p.isHost && p.ready));
    host.send({ type: "start_game" }); await host.wait("room_started");
    first.send({ type: "join_room", roomCode, token: tokens[1] });
    await first.wait("error", message => message.code === "ROOM_FULL");
    second.send({ type: "score_update", roomCode, score: 55, wpm: 35, accuracy: 95, completedWords: 5, lives: 2, finished: false });
    await host.wait("standings_update", message => message.players[0]?.score === 55);
    second.socket.terminate();
    await host.wait("room_state", message => message.players.some((p: any) => !p.isHost && !p.connected));
    // Real deadline: three-second countdown + thirty-second round + completion grace.
    for (let attempt = 0; attempt < 380; attempt++) {
      if (host.messages.some(message => message.type === "classroom_results")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const final = await host.wait("classroom_results");
    assert.equal(final.players.length, 1); assert.equal(final.players[0].score, 55);
    assert.equal(final.players[0].connected, false);
    assert.equal((await db.get("SELECT status FROM matches")).status, "completed");
    const saved = await db.all("SELECT score,position FROM match_participants WHERE position IS NOT NULL");
    assert.deepEqual(saved, [{ score: 55, position: 1 }]);
    assert.equal((await db.get("SELECT COUNT(*) AS count FROM match_participants")).count, 2);
  } finally {
    for (const peer of peers) peer.socket.terminate();
    await new Promise<void>(resolve => lan.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeDatabase(); await rm(directory, { recursive: true, force: true });
  }
});
