import { randomBytes } from "crypto";
import { IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { getDatabase } from "./db.js";
import { normalizeRole, verifyToken, type AppRole } from "./auth.js";
import { getDifficultyKey, getWordsForDifficulty, getWordCategory, WORD_BANK, type WordCategory } from "./wordBank.js";
import { sessionEvents } from "./sessionEvents.js";

const MAX_PLAYERS = 8;
const COUNTDOWN_DELAY_MS = 3000;
const SUPPORTED_ROUND_TIMES = [30, 60, 90] as const;
const BACKGROUNDS = new Set(["blues", "volts", "office", "city"]);

type ClassroomMatchConfig = {
  wordSet: WordCategory;
  difficulty: "Easy" | "Normal" | "Hard";
  roundTime: (typeof SUPPORTED_ROUND_TIMES)[number];
  background: string;
};

type ClientMessage = {
  type: "create_room" | "join_room" | "leave_room" | "cancel_room" | "update_match_config" | "ready" | "start_game" | "score_update";
  roomCode?: string;
  playerName?: string;
  token?: string;
  score?: number;
  wpm?: number;
  accuracy?: number;
  lives?: number;
  completedWords?: number;
  finished?: boolean;
  mode?: string;
  difficulty?: string;
  wordSet?: string;
  roundTime?: number;
  background?: string;
};

type Player = {
  id: string;
  name: string;
  displayName?: string;
  userId?: number;
  role?: AppRole;
  ready: boolean;
  isHost: boolean;
  socket: WebSocket;
  token?: string;
  pendingToken?: string;
  performance?: PlayerPerformance;
};

type PlayerPerformance = {
  score: number;
  wpm: number;
  accuracy: number;
  lives: number;
  completedWords: number;
  finished: boolean;
};

type Room = {
  code: string;
  dbMatchId?: number;
  mode: string;
  difficulty: string;
  wordSet: string;
  roundTime: number;
  started: boolean;
  ownerUserId: number;
  matchConfig: ClassroomMatchConfig;
  wordSequence?: string[];
  startAt?: number;
  classroomResultsSent: boolean;
  players: Map<string, Player>;
};

const rooms = new Map<string, Room>();

function send(socket: WebSocket, message: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function roomState(room: Room) {
  return {
    type: "room_state",
    roomCode: room.code,
    mode: room.mode,
    difficulty: room.difficulty,
    wordSet: room.wordSet,
    roundTime: room.roundTime,
    matchConfig: room.matchConfig,
    startAt: room.startAt,
    started: room.started,
    maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].map(({ id, name, userId, ready, isHost }) => ({ id, name, userId, ready, isHost })),
  };
}

function broadcast(room: Room) {
  const state = roomState(room);
  for (const player of room.players.values()) send(player.socket, state);
}

function broadcastStandings(room: Room) {
  const players = getStudentResults(room);

  for (const player of room.players.values()) {
    send(player.socket, { type: "standings_update", players });
  }
}

function getStudentResults(room: Room) {
  return [...room.players.values()]
    .filter((player) => player.role === "student" && player.userId !== undefined)
    .map((player) => ({
      userId: player.userId,
      username: player.name,
      displayName: player.displayName || player.name,
      score: player.performance?.score || 0,
      wpm: player.performance?.wpm || 0,
      accuracy: player.performance?.accuracy || 0,
      lives: player.performance?.lives ?? 3,
      completedWords: player.performance?.completedWords || 0,
      finished: player.performance?.finished || false,
    }))
    .sort((left, right) => right.score - left.score || right.wpm - left.wpm || right.accuracy - left.accuracy);
}

async function persistClassroomResults(
  room: Room,
  results: ReturnType<typeof getStudentResults>,
) {
  if (!room.dbMatchId) return;

  const db = getDatabase();
  for (const [index, result] of results.entries()) {
    if (result.userId === undefined) continue;

    await db.run(
      `UPDATE match_participants
       SET score = ?, wpm = ?, accuracy = ?, completed_words = ?, end_reason = ?, remaining_lives = ?, position = ?, error_rate = ?
       WHERE match_id = ? AND user_id = ?`,
      [
        result.score,
        result.wpm,
        result.accuracy,
        result.completedWords,
        result.finished ? (result.lives === 0 ? "health" : "time") : null,
        result.lives,
        index + 1,
        result.completedWords === 0 && result.accuracy === 0 ? 0 : 100 - result.accuracy,
        room.dbMatchId,
        result.userId,
      ],
    );
  }

  await db.run(
    "UPDATE matches SET status = 'completed', ended_at = CURRENT_TIMESTAMP WHERE id = ?",
    [room.dbMatchId],
  );
}

async function getResultsForFinalization(
  room: Room,
  liveResults: ReturnType<typeof getStudentResults>,
) {
  if (!room.dbMatchId) return liveResults;

  const savedParticipants = await getDatabase().all(
    `SELECT mp.user_id, mp.score, mp.wpm, mp.accuracy, mp.completed_words, mp.remaining_lives,
            mp.end_reason, u.username, u.display_name
     FROM match_participants mp JOIN users u ON u.id = mp.user_id
     WHERE mp.match_id = ? AND mp.user_id <> ? AND u.role IN ('student', 'player')`,
    [room.dbMatchId, room.ownerUserId],
  );
  const liveByUserId = new Map(liveResults.map((result) => [result.userId, result]));

  return savedParticipants
    .map((participant) => {
      const liveResult = liveByUserId.get(participant.user_id as number);
      return liveResult || {
        userId: participant.user_id as number,
        username: participant.username,
        displayName: participant.display_name || participant.username,
        score: Number(participant.score) || 0,
        wpm: Number(participant.wpm) || 0,
        accuracy: Number(participant.accuracy) || 0,
        lives: Number.isInteger(participant.remaining_lives) ? participant.remaining_lives : 3,
        completedWords: Number(participant.completed_words) || 0,
        finished: participant.end_reason !== null,
      };
    })
    .sort((left, right) => right.score - left.score || right.wpm - left.wpm || right.accuracy - left.accuracy);
}

function makeRoomCode() {
  let code = "";
  do {
    code = randomBytes(2).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

async function createDatabaseMatch(message: ClientMessage) {
  const db = getDatabase();
  const result = await db.run(
    `INSERT INTO matches (mode, difficulty, round_time, word_set, background, status) VALUES (?, ?, ?, ?, ?, ?)`,
    [message.mode || "LAN Match", message.difficulty || "Normal", message.roundTime || 90, message.wordSet || "General", message.background || "blues", "active"],
  );
  return result.lastID;
}

async function persistRoomConfig(room: Room) {
  if (!room.dbMatchId) return;

  await getDatabase().run(
    `UPDATE matches
     SET mode = ?, word_set = ?, difficulty = ?, round_time = ?, background = ?
     WHERE id = ?`,
    [
      room.mode,
      room.wordSet,
      room.difficulty,
      room.roundTime,
      room.matchConfig.background,
      room.dbMatchId,
    ],
  );
}

async function authenticatePlayer(token: string | undefined) {
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;

  const user = await getDatabase().get(
    "SELECT id, username, display_name, role, is_banned, session_version, email_verified FROM users WHERE id = ?",
    [payload.userId],
  );
  if (!user || user.is_banned || user.email_verified !== 1 || (payload.sessionVersion ?? 0) !== user.session_version) return null;

  return {
    userId: user.id as number,
    username: user.username as string,
    displayName: user.display_name as string,
    role: normalizeRole(user.role),
  };
}

function leaveRoom(player: Player) {
  for (const room of rooms.values()) {
    if (!room.players.delete(player.id)) continue;

    if (room.players.size === 0) {
      rooms.delete(room.code);
    } else if (player.isHost) {
      broadcast(room);
    } else {
      broadcast(room);
    }
    return;
  }
}

export function attachLanServer(server: import("http").Server) {
  const webSocketServer = new WebSocketServer({ server, path: "/ws" });
  const connections = new Set<Player>();
  const invalidate = (userId: number) => {
    for (const player of connections) {
      const payload = player.token ? verifyToken(player.token) : null;
      const pending = player.pendingToken ? verifyToken(player.pendingToken) : null;
      if (player.userId !== userId && payload?.userId !== userId && pending?.userId !== userId) continue;
      leaveRoom(player);
      player.socket.close(4001, "Session expired. Please log in again.");
    }
  };
  sessionEvents.on("invalidate", invalidate);
  // Also detects resets from another backend process; every message is revalidated below.
  const sweep = setInterval(() => {
    for (const player of connections) {
      if (!player.token) continue;
      void authenticatePlayer(player.token).then((identity) => {
        if (!identity) {
          leaveRoom(player);
          player.socket.close(4001, "Session expired. Please log in again.");
        }
      }).catch(() => player.socket.close(4001, "Session unavailable."));
    }
  }, 5000);
  sweep.unref();
  webSocketServer.on("close", () => {
    clearInterval(sweep);
    sessionEvents.off("invalidate", invalidate);
  });

  webSocketServer.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const player: Player = {
      id: randomBytes(8).toString("hex"),
      name: "Player",
      ready: false,
      isHost: false,
      socket,
    };
    connections.add(player);

    socket.on("message", async (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(socket, { type: "error", message: "Message must be valid JSON" });
        return;
      }

      try {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (player.token && !await authenticatePlayer(player.token)) {
          leaveRoom(player);
          socket.close(4001, "Session expired. Please log in again.");
          return;
        }
        if (socket.readyState !== WebSocket.OPEN) return;
        if (message.type === "create_room" || message.type === "join_room") player.pendingToken = message.token;
        if (message.type === "create_room") {
          if (player.isHost || [...rooms.values()].some((room) => room.players.has(player.id))) {
            send(socket, { type: "error", message: "You are already in a room" });
            return;
          }
          const identity = await authenticatePlayer(message.token);
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!identity) {
            send(socket, { type: "error", message: "Authentication is required to create a room." });
            return;
          }
          if (identity.role !== "teacher") {
            send(socket, { type: "error", message: "Only teachers can create classroom rooms." });
            return;
          }

          const matchConfig = normalizeMatchConfig({
            wordSet: message.wordSet || "General",
            difficulty: message.difficulty || "Normal",
            roundTime: message.roundTime || 90,
            background: message.background || "blues",
          });
          if (!matchConfig) {
            send(socket, { type: "error", message: "Invalid classroom match configuration." });
            return;
          }

          player.name = identity.username;
          player.token = message.token;
          player.displayName = identity.displayName;
          player.isHost = true;
          player.userId = identity.userId;
          player.role = identity.role;
          const room: Room = {
            code: makeRoomCode(),
            dbMatchId: await createDatabaseMatch({
              ...message,
              wordSet: matchConfig.wordSet,
              difficulty: matchConfig.difficulty,
              roundTime: matchConfig.roundTime,
              background: matchConfig.background,
            }),
            mode: message.mode || "LAN Match",
            difficulty: matchConfig.difficulty,
            wordSet: matchConfig.wordSet,
            roundTime: matchConfig.roundTime,
            started: false,
            ownerUserId: identity.userId,
            matchConfig,
            classroomResultsSent: false,
            players: new Map([[player.id, player]]),
          };
          if (!await authenticatePlayer(player.token) || socket.readyState !== WebSocket.OPEN) return;
          rooms.set(room.code, room);
          await getDatabase().run(
            "INSERT INTO match_participants (match_id, user_id) VALUES (?, ?)",
            [room.dbMatchId, identity.userId],
          );
          send(socket, { type: "room_created", roomCode: room.code, playerId: player.id });
          broadcast(room);
          return;
        }

        if (message.type === "join_room") {
          const room = message.roomCode ? rooms.get(message.roomCode.trim().toUpperCase()) : undefined;
          if (!room) {
            send(socket, { type: "error", message: "Room not found. Check the room code." });
            return;
          }
          const identity = await authenticatePlayer(message.token);
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!identity) {
            send(socket, { type: "error", message: "Authentication is required to join a room." });
            return;
          }

          const reconnectingHost = identity.userId === room.ownerUserId;
          if (room.players.size >= MAX_PLAYERS && !reconnectingHost) {
            send(socket, { type: "error", message: "This room is full (8 players maximum)." });
            return;
          }

          let previousReady = false;
          for (const [playerId, existingPlayer] of room.players) {
            if (existingPlayer.userId !== identity.userId) continue;
            previousReady = existingPlayer.ready;
            room.players.delete(playerId);
            break;
          }

          player.name = identity.username;
          player.token = message.token;
          player.displayName = identity.displayName;
          player.userId = identity.userId;
          player.role = identity.role;
          player.isHost = reconnectingHost;
          player.ready = previousReady;
          room.players.set(player.id, player);
          if (room.dbMatchId && player.userId) {
            const participant = await getDatabase().get(
              "SELECT id FROM match_participants WHERE match_id = ? AND user_id = ?",
              [room.dbMatchId, player.userId],
            );
            if (!participant) {
              await getDatabase().run(
                "INSERT INTO match_participants (match_id, user_id) VALUES (?, ?)",
                [room.dbMatchId, player.userId],
              );
            }
          }
          send(socket, { type: "room_joined", roomCode: room.code, playerId: player.id });
          broadcast(room);
          return;
        }

        const room = [...rooms.values()].find((candidate) => candidate.players.has(player.id));
        if (!room) {
          send(socket, { type: "error", message: "Join or create a room first." });
          return;
        }

        if (message.type === "update_match_config") {
          const identity = await authenticatePlayer(message.token);
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!identity || identity.role !== "teacher" || identity.userId !== room.ownerUserId || player.userId !== room.ownerUserId) {
            send(socket, { type: "error", message: "Only the teacher who owns this classroom can update match settings." });
            return;
          }
          if (room.started) {
            send(socket, { type: "error", message: "Match settings cannot change after the classroom starts." });
            return;
          }

          const matchConfig = normalizeMatchConfig(message);
          if (!matchConfig) {
            send(socket, { type: "error", message: "Invalid category, difficulty, or round time." });
            return;
          }

          room.matchConfig = matchConfig;
          room.wordSet = matchConfig.wordSet;
          room.difficulty = matchConfig.difficulty;
          room.roundTime = matchConfig.roundTime;
          room.matchConfig.background = matchConfig.background;
          room.wordSequence = undefined;
          await persistRoomConfig(room);
          broadcast(room);
        } else if (message.type === "cancel_room") {
          const identity = await authenticatePlayer(message.token);
          if (socket.readyState !== WebSocket.OPEN) return;
          if (!identity || identity.role !== "teacher" || identity.userId !== room.ownerUserId || player.userId !== room.ownerUserId) {
            send(socket, { type: "error", message: "Only the teacher who owns this classroom can cancel it." });
            return;
          }

          for (const participant of room.players.values()) {
            send(participant.socket, { type: "room_cancelled", roomCode: room.code, message: "The teacher cancelled this classroom." });
          }
          rooms.delete(room.code);
          for (const participant of room.players.values()) participant.socket.close();
        } else if (message.type === "leave_room") {
          if (player.isHost && room.started && room.dbMatchId) {
            const results = await getResultsForFinalization(room, getStudentResults(room));
            if (results.some((result) => result.score !== 0 || result.wpm !== 0 || result.accuracy !== 0 || result.finished)) {
              await persistClassroomResults(room, results);
            }
          }
          leaveRoom(player);
        } else if (message.type === "ready") {
          player.ready = true;
          broadcast(room);
        } else if (message.type === "start_game") {
          if (!player.isHost || player.userId !== room.ownerUserId) {
            send(socket, { type: "error", message: "Only the host can start the game." });
            return;
          }
          const participantsReady = [...room.players.values()].every((participant) => participant.isHost || participant.ready);
          if (!participantsReady) {
            send(socket, { type: "error", message: "All students must be ready before the teacher starts the session." });
            return;
          }
          if (!room.matchConfig) {
            send(socket, { type: "error", message: "A valid classroom match configuration is required." });
            return;
          }
          room.started = true;
          await persistRoomConfig(room);
          room.startAt = Date.now() + COUNTDOWN_DELAY_MS;
          room.wordSequence = createWordSequence(room.matchConfig);
          for (const participant of room.players.values()) {
            send(participant.socket, {
              type: "room_started",
              roomCode: room.code,
              matchConfig: room.matchConfig,
              wordSequence: room.wordSequence,
              startAt: room.startAt,
            });
          }
          broadcast(room);
        } else if (message.type === "score_update") {
          if (player.role !== "student" || !player.userId || !room.started) return;
          if (message.roomCode && message.roomCode !== room.code) {
            send(socket, { type: "error", message: "Performance room does not match the active room." });
            return;
          }

          const score = message.score;
          const wpm = message.wpm;
          const accuracy = message.accuracy;
          const lives = message.lives;
          const completedWords = message.completedWords;
          const finished = message.finished;
          if (typeof score !== "number" || typeof wpm !== "number" || typeof accuracy !== "number" || typeof lives !== "number" || typeof completedWords !== "number" || typeof finished !== "boolean" || !Number.isFinite(score) || !Number.isFinite(wpm) || !Number.isFinite(accuracy) || !Number.isFinite(lives) || !Number.isFinite(completedWords) || !Number.isInteger(lives) || !Number.isInteger(completedWords) || wpm < 0 || accuracy < 0 || accuracy > 100 || lives < 0 || lives > 3 || completedWords < 0) {
            send(socket, { type: "error", message: "Invalid performance update." });
            return;
          }

          player.performance = { score, wpm, accuracy, lives, completedWords, finished };
          if (room.dbMatchId && player.userId) {
            await getDatabase().run(
              `UPDATE match_participants
               SET score = ?, wpm = ?, accuracy = ?, completed_words = ?, remaining_lives = ?, end_reason = ?, error_rate = ?
               WHERE match_id = ? AND user_id = ?`,
              [
                score,
                wpm,
                accuracy,
                completedWords,
                lives,
                finished ? (lives === 0 ? "health" : "time") : null,
                completedWords === 0 && accuracy === 0 ? 0 : 100 - accuracy,
                room.dbMatchId,
                player.userId,
              ],
            );
          }
          broadcastStandings(room);

          const students = [...room.players.values()].filter(
            (participant) => participant.role === "student" && participant.userId !== undefined,
          );
          if (
            !room.classroomResultsSent &&
            students.length > 0 &&
            students.every((student) => student.performance?.finished === true)
          ) {
            room.classroomResultsSent = true;
            const players = await getResultsForFinalization(room, getStudentResults(room));
            await persistClassroomResults(room, players);
            for (const participant of room.players.values()) {
              send(participant.socket, { type: "classroom_results", roomCode: room.code, players });
            }
          }
        }
      } catch (error) {
        console.error("LAN message error:", error);
        send(socket, { type: "error", message: "The host could not process that request." });
      } finally {
        player.pendingToken = undefined;
      }
    });

    socket.on("close", () => {
      connections.delete(player);
      leaveRoom(player);
    });
  });

  return webSocketServer;
}

function normalizeMatchConfig(input: { wordSet?: string; difficulty?: string; roundTime?: number; background?: string }): ClassroomMatchConfig | null {
  const difficultyKey = input.difficulty ? getDifficultyKey(input.difficulty) : null;
  const wordSet = input.wordSet ? getWordCategory(input.wordSet) : null;
  const roundTime = input.roundTime;
  if (!difficultyKey || !wordSet || !SUPPORTED_ROUND_TIMES.includes(roundTime as (typeof SUPPORTED_ROUND_TIMES)[number]) || !BACKGROUNDS.has(input.background || "blues")) return null;

  return {
    wordSet,
    difficulty: difficultyKey === "easy" ? "Easy" : difficultyKey === "normal" ? "Normal" : "Hard",
    roundTime: roundTime as (typeof SUPPORTED_ROUND_TIMES)[number],
    background: input.background || "blues",
  };
}

function createWordSequence(config: ClassroomMatchConfig): string[] {
  const difficulty = getDifficultyKey(config.difficulty);
  if (!difficulty) return [];
  const preferredWords = [...new Set(getWordsForDifficulty(config.wordSet, difficulty))];
  const preferredWordSet = new Set(preferredWords);
  const remainingCategoryWords = [...new Set(WORD_BANK[config.wordSet])].filter((word) => !preferredWordSet.has(word));
  const shuffle = (words: string[]) => {
    const shuffled = [...words];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  };
  return [...shuffle(preferredWords), ...shuffle(remainingCategoryWords)];
}
