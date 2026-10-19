import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, Copy, Users, Wifi } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ClassroomLeaderboard } from "../components/ClassroomLeaderboard";
import type { ClassroomStanding } from "../lib/classroomTypes";
import { PLAYER_TOKEN_KEY } from "../lib/playerApi";
import { usePlayerAuth } from "../lib/PlayerAuthContext";
import { WORD_CATEGORIES, type WordCategory } from "../words";
import { PROFILE_BACKGROUNDS, type ProfileBackgroundId } from "../lib/profileAssets";

type Player = {
  id: string;
  name: string;
  userId?: number;
  ready: boolean;
  isHost: boolean;
  connected?: boolean;
  displayName?: string;
};

type ClassroomMatchConfig = {
  wordSet: WordCategory;
  difficulty: "Easy" | "Normal" | "Hard";
  roundTime: 30 | 60 | 90;
  background: ProfileBackgroundId;
};

type RoomState = {
  roomCode: string;
  started: boolean;
  startAt?: number;
  maxPlayers: number;
  maxStudents?: number;
  studentCount?: number;
  players: Player[];
  matchConfig: ClassroomMatchConfig;
};

type Standing = ClassroomStanding;

type SocketMessage = RoomState & {
  type: string;
  message?: string;
  code?: string;
  playerId?: string;
  matchConfig?: ClassroomMatchConfig;
  wordSequence?: string[];
  startAt?: number;
  players?: Standing[];
};

const defaultHost = `${window.location.hostname}:3001`;
const LAN_ROOM_CODE_KEY = "type_tiles_lan_room_code";

export default function Lobby() {
  const { user } = usePlayerAuth();
  const navigate = useNavigate();

  const socketRef = useRef<WebSocket | null>(null);
  const pendingMessageRef = useRef<object | null>(null);
  const pendingAfterReconnectRef = useRef<object | null>(null);
  const activeMatchRef = useRef(false);

  const [hostAddress, setHostAddress] = useState(defaultHost);

  const [playerName, setPlayerName] = useState(
    user?.displayName || user?.username || "Player"
  );

  const [roomCode, setRoomCode] = useState(
    () => localStorage.getItem(LAN_ROOM_CODE_KEY) || ""
  );

  const [room, setRoom] = useState<RoomState | null>(null);
  const [wordSequence, setWordSequence] = useState<string[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [classroomResults, setClassroomResults] = useState<Standing[] | null>(null);
  const [matchInProgress, setMatchInProgress] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");

  const [status, setStatus] = useState<
    "idle" | "connecting" | "connected"
  >("idle");

  const connect = () => {
    socketRef.current?.close();

    setError("");
    setStatus("connecting");

    const cleanHost = hostAddress.replace(/^https?:\/\//, "");
    const socket = new WebSocket(`ws://${cleanHost}/ws`);

    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("connected");

      // Clear stale "Connecting to classroom host..." messages.
      setError("");

      if (pendingMessageRef.current) {
        const token = localStorage.getItem(PLAYER_TOKEN_KEY);

        socket.send(
          JSON.stringify(
            token
              ? {
                  ...pendingMessageRef.current,
                  token,
                }
              : pendingMessageRef.current
          )
        );

        pendingMessageRef.current = null;
      }
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as SocketMessage;

      if (message.type === "room_state") {
        setRoom(message);

        setRoomCode(message.roomCode);
        localStorage.setItem(LAN_ROOM_CODE_KEY, message.roomCode);
      }

      if (message.type === "room_started") {
        setRoom((currentRoom) =>
          currentRoom && message.matchConfig
            ? {
                ...currentRoom,
                started: true,
                startAt: message.startAt,
                matchConfig: message.matchConfig,
              }
            : currentRoom
        );

        setWordSequence(message.wordSequence || []);
      }

      if (message.type === "standings_update") {
        setStandings(message.players || []);
      }

      if (message.type === "classroom_results") {
        setClassroomResults(message.players || []);
      }

      if (
        message.type === "room_created" ||
        message.type === "room_joined"
      ) {
        setRoomCode(message.roomCode);
        localStorage.setItem(LAN_ROOM_CODE_KEY, message.roomCode);

        if (
          message.type === "room_joined" &&
          pendingAfterReconnectRef.current
        ) {
          const token = localStorage.getItem(PLAYER_TOKEN_KEY);

          socket.send(
            JSON.stringify(
              token
                ? {
                    ...pendingAfterReconnectRef.current,
                    token,
                  }
                : pendingAfterReconnectRef.current
            )
          );

          pendingAfterReconnectRef.current = null;
        }
      }

      if (message.type === "room_closed") {
        setRoom(null);
        setWordSequence([]);
        setStandings([]);
        setMatchInProgress(false);
        setRoomCode("");

        localStorage.removeItem(LAN_ROOM_CODE_KEY);

        setError(
          message.message || "The classroom is no longer available."
        );
      }

      if (message.type === "room_cancelled") {
        setRoom(null);
        setWordSequence([]);
        setStandings([]);
        setMatchInProgress(false);
        setRoomCode("");

        localStorage.removeItem(LAN_ROOM_CODE_KEY);

        setError(message.message || "The classroom was cancelled.");

        socket.close();

        navigate("/app/lobby", {
          replace: true,
          state: {
            message:
              message.message || "The classroom was cancelled.",
          },
        });
      }

      if (message.type === "error") {
        const text =
          message.code === "ROOM_FULL"
            ? message.message || "This classroom is full. Ask the teacher for another room."
            : message.message || "Unable to connect to the room.";

        if (text.includes("Room not found")) {
          setRoom(null);
          setWordSequence([]);
          setStandings([]);
          setMatchInProgress(false);
          setRoomCode("");

          localStorage.removeItem(LAN_ROOM_CODE_KEY);

          setError(
            "That classroom is no longer available. Enter a new room code."
          );
        } else {
          setError(text);
        }
      }
    };

    socket.onerror = () => {
      setStatus("idle");

      setError(
        "Unable to reach the host. Check the host IP and port."
      );
    };

    socket.onclose = () => {
      setStatus("idle");
    };
  };

  useEffect(
    () => () => {
      if (!activeMatchRef.current) {
        socketRef.current?.close();
      }
    },
    []
  );

  /*
   * Synchronized match launch
   *
   * Teacher:
   *   stays in Lobby and monitors students.
   *
   * Student:
   *   enters Phaser through /app/game.
   */
  useEffect(() => {
    if (!room?.started || !room.startAt) return;

    if (wordSequence.length === 0) {
      setError(
        "This match is already active and cannot currently be resumed after refresh."
      );

      return;
    }

    let launched = false;

    const launch = () => {
      if (launched || !room.startAt) return;

      const remaining = Math.max(
        0,
        room.startAt - Date.now()
      );

      setCountdown(Math.ceil(remaining / 1000));

      if (remaining > 0) return;

      launched = true;
      activeMatchRef.current = true;

      if (user?.role === "teacher") {
        setMatchInProgress(true);
        return;
      }

      navigate("/app/game", {
        state: {
          mode: "multiplayer",
          roomCode: room.roomCode,
          hostAddress,
          matchConfig: room.matchConfig,
          wordSequence,
          startAt: room.startAt,
          background: room.matchConfig.background,
        },
      });
    };

    launch();

    const timer = window.setInterval(launch, 50);

    return () => window.clearInterval(timer);
  }, [
    navigate,
    room?.roomCode,
    room?.startAt,
    room?.started,
    room?.matchConfig,
    user?.role,
    wordSequence,
  ]);

  /*
   * Restore saved room connection.
   */
  useEffect(() => {
    const savedRoomCode =
      localStorage.getItem(LAN_ROOM_CODE_KEY);

    if (!savedRoomCode) return;

    pendingMessageRef.current = {
      type: "join_room",
      roomCode: savedRoomCode,
      playerName,
    };

    connect();

    return () => socketRef.current?.close();
  }, [navigate, user?.id]);

  const send = (message: object) => {
    if (
      socketRef.current?.readyState !== WebSocket.OPEN
    ) {
      if (room) {
        pendingMessageRef.current = {
          type: "join_room",
          roomCode: room.roomCode,
          playerName,
        };

        pendingAfterReconnectRef.current = message;
      } else {
        pendingMessageRef.current = message;
      }

      connect();

      setError("Connecting to the classroom host...");

      return;
    }

    const token = localStorage.getItem(PLAYER_TOKEN_KEY);

    socketRef.current.send(
      JSON.stringify(
        token
          ? {
              ...message,
              token,
            }
          : message
      )
    );
  };

  const createRoom = () => {
    if (user?.role !== "teacher") {
      setError(
        "Only teacher accounts can create classroom rooms."
      );

      return;
    }

    send({
      type: "create_room",
      playerName,
      mode: "LAN Match",
      difficulty: "Normal",
      wordSet: "General",
      roundTime: 90,
      background: "blues",
    });
  };

  const currentPlayer =
    room?.players.find(
      (player) => player.userId === user?.id
    ) ??
    room?.players.find(
      (player) => player.name === playerName
    );

  const updateMatchConfig = (
    config: Partial<ClassroomMatchConfig>
  ) => {
    if (!room || !currentPlayer?.isHost) return;

    send({
      type: "update_match_config",

      wordSet:
        config.wordSet || room.matchConfig.wordSet,

      difficulty:
        config.difficulty ||
        room.matchConfig.difficulty,

      roundTime:
        config.roundTime ||
        room.matchConfig.roundTime,
      background:
        config.background ||
        room.matchConfig.background,
    });
  };

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();

    if (!roomCode.trim()) {
      setError("Enter a room code first.");
      return;
    }

    send({
      type: "join_room",
      roomCode,
      playerName,
    });
  };

  const clearLocalRoom = () => {
    setRoom(null);
    setRoomCode("");
    setStandings([]);
    setClassroomResults(null);
    setMatchInProgress(false);

    localStorage.removeItem(LAN_ROOM_CODE_KEY);
  };

  const exitClassroom = () => {
    if (
      socketRef.current?.readyState === WebSocket.OPEN
    ) {
      socketRef.current.send(
        JSON.stringify({
          type: "leave_room",
          token: localStorage.getItem(
            PLAYER_TOKEN_KEY
          ),
        })
      );
    } else {
      socketRef.current?.close();
    }

    clearLocalRoom();

    navigate("/app/lobby", {
      replace: true,
    });
  };

  const cancelClassroom = () => {
    if (
      !window.confirm(
        "Cancel this classroom? All students will be disconnected from this session."
      )
    ) {
      return;
    }

    if (
      socketRef.current?.readyState === WebSocket.OPEN
    ) {
      socketRef.current.send(
        JSON.stringify({
          type: "cancel_room",
          token: localStorage.getItem(
            PLAYER_TOKEN_KEY
          ),
        })
      );

      return;
    }

    setError(
      "The classroom connection is closed. Reconnect before cancelling."
    );
  };

  /*
   * Teacher is considered actively monitoring once
   * synchronized countdown has completed.
   */
  const teacherMatchInProgress =
    user?.role === "teacher" &&
    room?.started === true &&
    countdown === 0;

  /*
   * Connected Players status:
   *
   * PRE-MATCH
   * Teacher -> Host
   * Student -> Waiting / Ready
   *
   * ACTIVE MATCH
   * Teacher -> Monitoring
   * Student -> Playing / Finished
   */
  const getPlayerStatus = (player: Player) => {
    if (player.connected === false) return "Disconnected (slot reserved)";
    if (!room?.started) {
      if (player.isHost) {
        return "Host";
      }

      return player.ready
        ? "Ready"
        : "Waiting";
    }

    if (player.isHost) {
      return "Monitoring";
    }

    const standing =
      player.userId !== undefined
        ? standings.find(
            (item) =>
              item.userId === player.userId
          )
        : undefined;

    if (standing?.finished) {
      return "Finished";
    }

    return "Playing";
  };

  /*
   * Bottom status text.
   */
  const connectionLabel =
    status === "connected"
      ? room?.started && countdown === 0
        ? "Game Started"
        : `Connected to ${hostAddress}`
      : "Not connected to a host";

  const playerColors = useMemo(
    () => [
      "bg-sky-500",
      "bg-lime-400",
      "bg-fuchsia-500",
      "bg-amber-400",
      "bg-cyan-400",
      "bg-rose-400",
      "bg-indigo-400",
      "bg-emerald-400",
    ],
    []
  );

  return (
    <section className="h-full overflow-y-auto pb-6">
      {!room ? (
        <>
          <article className="rounded-[9px] bg-[#11163d] px-6 py-10 shadow-[0_22px_46px_rgba(4,8,25,0.25)] sm:px-14">
            <div className="mx-auto grid max-w-[920px] items-center gap-8 md:grid-cols-[210px_1fr]">
              <div className="flex justify-center text-[#a5a8bb]">
                <Users className="h-[110px] w-[190px] stroke-[1.3]" />
              </div>

              <div>
                <h1 className="text-[1.55rem] font-semibold text-white sm:text-[1.85rem]">
                  {user?.role === "teacher"
                    ? "Create Classroom"
                    : "Join Classroom"}
                </h1>

                <p className="mt-1 text-[1rem] text-white/70">
                  {user?.role === "teacher"
                    ? "Open a room for students on your local network"
                    : "Enter the teacher's room code to join"}
                </p>

                {user?.role !== "teacher" ? (
                  <form
                    className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_230px]"
                    onSubmit={joinRoom}
                  >
                    <input
                      value={roomCode}
                      onChange={(event) =>
                        setRoomCode(
                          event.target.value.toUpperCase()
                        )
                      }
                      className="h-[50px] rounded-[8px] border-0 bg-[#d7d7df] px-4 text-lg font-semibold tracking-[0.2em] text-[#161a3b] outline-none ring-sky-400 focus:ring-2"
                      placeholder="ROOM CODE"
                      aria-label="Room code"
                    />

                    <button
                      type="submit"
                      className="inline-flex h-[50px] items-center justify-center gap-5 rounded-[8px] bg-[#2948aa] text-lg font-semibold text-white transition hover:bg-[#3558c5]"
                    >
                      Join Classroom
                      <ArrowRight className="h-7 w-7" />
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </article>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <article className="min-h-[136px] rounded-[9px] bg-[#1c2451] px-8 py-7">
              <h2 className="text-[1.3rem] font-semibold text-[#00ed8a]">
                LAN Connected
              </h2>

              <p className="mt-2 max-w-[320px] text-[0.95rem] leading-5 text-white/75">
                You are connected to the school network.
                <br />
                You can join a session.
              </p>
            </article>

            <article className="min-h-[136px] rounded-[9px] bg-[#1c2451] px-8 py-7">
              <h2 className="text-[1.3rem] font-semibold text-[#6f9fff]">
                How to join
              </h2>

              <ol className="mt-2 list-decimal pl-5 text-[0.95rem] leading-5 text-white/75">
                <li>Ask for the room code</li>
                <li>Enter the code above</li>
                <li>Wait for the game to begin</li>
              </ol>
            </article>
          </div>

          <article className="mt-6 rounded-[9px] bg-[#11163d] p-6 sm:p-8">
            <div className="grid gap-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="text-sm text-white/70">
                Your player name

                <input
                  value={playerName}
                  onChange={(event) =>
                    setPlayerName(
                      event.target.value
                    )
                  }
                  className="mt-2 h-11 w-full rounded-[7px] border border-white/10 bg-[#d7d7df] px-3 font-semibold text-[#161a3b] outline-none"
                />
              </label>

              <label className="text-sm text-white/70">
                Host address

                <input
                  value={hostAddress}
                  onChange={(event) =>
                    setHostAddress(
                      event.target.value
                    )
                  }
                  className="mt-2 h-11 w-full rounded-[7px] border border-white/10 bg-[#d7d7df] px-3 font-semibold text-[#161a3b] outline-none"
                />
              </label>

              <button
                type="button"
                onClick={connect}
                className="h-11 rounded-[7px] border border-[#3150b3] px-5 font-semibold text-white hover:bg-white/10"
              >
                {status === "connecting"
                  ? "Connecting..."
                  : "Connect"}
              </button>
            </div>

            {user?.role === "teacher" ? (
              <button
                type="button"
                onClick={createRoom}
                className="mt-5 inline-flex rounded-[7px] bg-[#00b878] px-5 py-3 font-semibold text-[#071c2a] transition hover:bg-[#21d395]"
              >
                Create Classroom
              </button>
            ) : (
              <div className="mt-5 text-sm text-white/60">
                Teacher accounts can host
                classroom rooms.
              </div>
            )}
          </article>
        </>
      ) : (
        <article className="rounded-[9px] bg-[#11163d] p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]">
            {/* LEFT SIDE */}
            <div className="flex min-h-[380px] flex-col justify-between">
              <div>
                <div className="text-sm text-white/70">
                  You have joined the session.
                </div>

                <h1 className="mt-1 text-[1.55rem] font-semibold text-white sm:text-[1.85rem]">
                  {teacherMatchInProgress ||
                  matchInProgress
                    ? "Match In Progress"
                    : room.started
                      ? "Game Starting"
                      : "Waiting Room"}
                </h1>
              </div>

              {/* MATCH SETTINGS */}
              <div className="rounded-[8px] border border-[#2c6db2] bg-[#1c2451] p-4 text-white">
                <div className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Match Settings
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-4">
                  <label className="text-xs text-white/70">
                    Category

                    <select
                      value={
                        room.matchConfig.wordSet
                      }
                      disabled={
                        !currentPlayer?.isHost ||
                        room.started
                      }
                      onChange={(event) =>
                        updateMatchConfig({
                          wordSet:
                            event.target
                              .value as WordCategory,
                        })
                      }
                      className="mt-1 w-full rounded bg-[#d7d7df] px-2 py-2 text-sm text-[#161a3b] disabled:opacity-70"
                    >
                      {WORD_CATEGORIES.map(
                        (category) => (
                          <option
                            key={category}
                            value={category}
                          >
                            {category
                              .charAt(0)
                              .toUpperCase() +
                              category.slice(1)}
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  <label className="text-xs text-white/70">
                    Difficulty

                    <select
                      value={
                        room.matchConfig
                          .difficulty
                      }
                      disabled={
                        !currentPlayer?.isHost ||
                        room.started
                      }
                      onChange={(event) =>
                        updateMatchConfig({
                          difficulty:
                            event.target
                              .value as ClassroomMatchConfig["difficulty"],
                        })
                      }
                      className="mt-1 w-full rounded bg-[#d7d7df] px-2 py-2 text-sm text-[#161a3b] disabled:opacity-70"
                    >
                      {[
                        "Easy",
                        "Normal",
                        "Hard",
                      ].map((difficulty) => (
                        <option
                          key={difficulty}
                          value={difficulty}
                        >
                          {difficulty}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs text-white/70">
                    Round Time

                    <select
                      value={
                        room.matchConfig
                          .roundTime
                      }
                      disabled={
                        !currentPlayer?.isHost ||
                        room.started
                      }
                      onChange={(event) =>
                        updateMatchConfig({
                          roundTime: Number(
                            event.target.value
                          ) as ClassroomMatchConfig["roundTime"],
                        })
                      }
                      className="mt-1 w-full rounded bg-[#d7d7df] px-2 py-2 text-sm text-[#161a3b] disabled:opacity-70"
                    >
                      {[30, 60, 90].map(
                        (time) => (
                          <option
                            key={time}
                            value={time}
                          >
                            {time} seconds
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  <label className="text-xs text-white/70">
                    Background
                    <select
                      value={room.matchConfig.background}
                      disabled={!currentPlayer?.isHost || room.started}
                      onChange={(event) => updateMatchConfig({ background: event.target.value as ProfileBackgroundId })}
                      className="mt-1 w-full rounded bg-[#d7d7df] px-2 py-2 text-sm text-[#161a3b] disabled:opacity-70"
                    >
                      {Object.entries(PROFILE_BACKGROUNDS).map(([id, background]) => (
                        <option key={id} value={id}>{background.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {!currentPlayer?.isHost &&
                !room.started ? (
                  <div className="mt-2 text-xs text-white/60">
                    Match settings are
                    controlled by the teacher.
                  </div>
                ) : null}
              </div>

              {/* MATCH STATE */}
              <div>
                <h2 className="text-[1.45rem] font-semibold text-[#6f9fff]">
                  {teacherMatchInProgress ||
                  matchInProgress
                    ? "Match In Progress"
                    : room.started
                      ? countdown > 0
                        ? String(countdown)
                        : "Waiting for synchronized match..."
                      : "Waiting for the teacher"}
                </h2>

                <p className="mt-2 text-white/75">
                  {teacherMatchInProgress ||
                  matchInProgress
                    ? "Monitoring student performance."
                    : room.started
                      ? "The classroom is preparing the synchronized match."
                      : "The game will start when the teacher starts the session."}
                </p>
              </div>

             {/* BUTTONS */}
<div className="flex flex-wrap gap-3">
  {/* STUDENT READY ONLY */}
  {user?.role === "student" &&
  !currentPlayer?.isHost &&
  !room.started ? (
    <button
      type="button"
      onClick={() => send({ type: "ready" })}
      className="inline-flex items-center gap-2 rounded-[7px] bg-[#2948aa] px-5 py-3 font-semibold text-white"
    >
      <Check className="h-5 w-5" />
      {currentPlayer?.ready ? "Ready" : "Mark Ready"}
    </button>
  ) : null}

  {/* TEACHER/HOST START ONLY */}
  {user?.role === "teacher" &&
  currentPlayer?.isHost &&
  !room.started ? (
    <button
      type="button"
      onClick={() => send({ type: "start_game" })}
      className="rounded-[7px] border border-[#00d77c] px-5 py-3 font-semibold text-[#00ed8a]"
    >
      Start Game
    </button>
  ) : null}

  {/* TEACHER/HOST CANCEL */}
  {user?.role === "teacher" && currentPlayer?.isHost ? (
    <button
      type="button"
      onClick={cancelClassroom}
      className="rounded-[7px] border border-red-400/60 px-5 py-3 font-semibold text-red-200"
    >
      Cancel Classroom
    </button>
  ) : (
    <button
      type="button"
      onClick={exitClassroom}
      className="rounded-[7px] border border-white/20 px-5 py-3 font-semibold text-white"
    >
      Exit Classroom
    </button>
  )}
</div>

              {/* Rankings are ordered by the server; no client-side sorting. */}
              {classroomResults ? (
                <ClassroomLeaderboard players={classroomResults} final />
              ) : teacherMatchInProgress || matchInProgress ? (
                <ClassroomLeaderboard players={standings} />
              ) : null}
            </div>

            {/* RIGHT SIDE */}
            <div>
              <div className="flex items-center gap-2 text-sm text-white">
                <span className="h-3 w-3 rounded-full bg-[#11c77a]" />
                Room Lobby
              </div>

              <div className="mt-1 text-xs text-white/80">
                Room Code:{" "}
                <span className="font-bold tracking-[0.18em]">
                  {room.roomCode}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard?.writeText(
                      room.roomCode
                    )
                  }
                  className="ml-2 text-[#6f9fff]"
                  aria-label="Copy room code"
                >
                  <Copy className="inline h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 overflow-hidden rounded-[8px] border border-[#2c6db2] bg-[#1c2451]">
                <div className="border-b border-[#2c6db2] px-7 py-3">
                  <div className="font-semibold text-white">
                    Classroom Participants
                  </div>

                  <div className="text-xs text-white/75">
                    {room.studentCount ?? room.players.filter(player => !player.isHost).length}/
                    {room.maxStudents ?? room.maxPlayers - 1} students (teacher separate)
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto" tabIndex={0} role="region" aria-label="Classroom participants">
                {room.players.map(
                  (player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center gap-3 border-b border-[#2c6db2] px-7 py-2 last:border-0"
                    >
                      <div
                        className={`grid h-11 w-11 place-items-center rounded-full ${
                          playerColors[
                            index %
                              playerColors.length
                          ]
                        }`}
                      >
                        <Users className="h-7 w-7 text-white" />
                      </div>

                      <div>
                        <div className="text-sm font-semibold text-white">
                          {player.displayName || player.name}

                          {player.isHost
                            ? " (HOST)"
                            : ""}
                        </div>

                        <div className="text-xs text-[#00ed8a]">
                          {getPlayerStatus(
                            player
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}
                </div>
              </div>
            </div>
          </div>
        </article>
      )}

      {/* CONNECTION / MATCH STATUS */}
      <div className="mt-4 flex items-center gap-2 text-sm text-white/60">
        <Wifi
          className={`h-4 w-4 ${
            status === "connected"
              ? "text-[#00ed8a]"
              : "text-white/40"
          }`}
        />

        {connectionLabel}

        {error ? (
          <span className="text-red-300">
            • {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}