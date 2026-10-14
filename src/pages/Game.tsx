import { GameMount } from "../components/GameMount";
import type { MatchConfig } from "../lib/mockData";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GamePerformance,
  GameResult,
} from "../scenes/GameScene";
import {
  PLAYER_TOKEN_KEY,
  submitPlayerMatchResult,
} from "../lib/playerApi";
import { usePlayerAuth } from "../lib/PlayerAuthContext";
import { getProfileBackground } from "../lib/profileAssets";

type ClassroomResult = {
  userId: number;
  username: string;
  displayName: string;
  score: number;
  wpm: number;
  accuracy: number;
  lives: number;
  completedWords: number;
  finished: boolean;
};

type Props = {
  mode?: "solo" | "multiplayer";
  roomCode?: string;
  hostAddress?: string;
  matchConfig: MatchConfig;
  matchId?: number;
  wordSequence?: string[];
  startAt?: number;
  backgroundId?: string;
};

export default function Game({
  mode = "solo",
  roomCode,
  hostAddress,
  matchConfig,
  matchId,
  wordSequence,
  startAt,
  backgroundId,
}: Props) {
  const { user } = usePlayerAuth();
  const navigate = useNavigate();

  const submissionStartedRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const joinedRoomRef = useRef(false);
  const latestPerformanceRef =
    useRef<GamePerformance | null>(null);

  const [multiplayerResult, setMultiplayerResult] =
    useState<GameResult | null>(null);

  const [classroomResults, setClassroomResults] =
    useState<ClassroomResult[] | null>(null);

  const currentUserRank = useMemo(() => {
    if (!classroomResults || user?.id === undefined) {
      return null;
    }

    const index = classroomResults.findIndex(
      (result) => result.userId === user.id
    );

    return index >= 0 ? index + 1 : null;
  }, [classroomResults, user?.id]);

  useEffect(() => {
    if (
      mode !== "multiplayer" ||
      !roomCode ||
      !hostAddress
    ) {
      return;
    }

    const cleanHost = hostAddress.replace(
      /^https?:\/\//,
      ""
    );

    const socket = new WebSocket(
      `ws://${cleanHost}/ws`
    );

    socketRef.current = socket;

    socket.onopen = () => {
      const token =
        localStorage.getItem(PLAYER_TOKEN_KEY);

      socket.send(
        JSON.stringify({
          type: "join_room",
          roomCode,
          token,
        })
      );
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as {
        type?: string;
        message?: string;
        players?: ClassroomResult[];
      };

      if (message.type === "room_joined") {
        joinedRoomRef.current = true;

        if (latestPerformanceRef.current) {
          socket.send(
            JSON.stringify({
              type: "score_update",
              roomCode,
              ...latestPerformanceRef.current,
            })
          );
        }
      }

      if (
        message.type === "room_cancelled" ||
        message.type === "room_closed"
      ) {
        navigate("/app/lobby", {
          replace: true,
          state: {
            message:
              message.message ||
              "The classroom is no longer available.",
          },
        });
      }

      if (message.type === "classroom_results") {
        setClassroomResults(message.players || []);
      }
    };

    return () => {
      socket.close();
      socketRef.current = null;
      joinedRoomRef.current = false;
    };
  }, [
    hostAddress,
    mode,
    navigate,
    roomCode,
  ]);

  const handlePerformance = (
    performance: GamePerformance
  ) => {
    latestPerformanceRef.current = performance;

    if (
      socketRef.current?.readyState !==
        WebSocket.OPEN ||
      !joinedRoomRef.current ||
      !roomCode
    ) {
      return;
    }

    socketRef.current.send(
      JSON.stringify({
        type: "score_update",
        roomCode,
        ...performance,
      })
    );
  };

  const handleGameOver = async (
    result: GameResult
  ) => {
    if (mode === "multiplayer") {
      /*
       * Keep this so React knows the local player
       * has finished.
       *
       * We DO NOT render another "Match Complete"
       * popup because Phaser already displays:
       *
       * GAME OVER
       * Waiting for other players...
       */
      setMultiplayerResult(result);
      return;
    }

    if (submissionStartedRef.current) {
      return;
    }

    submissionStartedRef.current = true;

    if (matchId === undefined) {
      navigate("/app/results", {
        state: {
          result,
          persistenceStatus: "error",
        },
      });

      return;
    }

    try {
      await submitPlayerMatchResult({
        matchId,
        score: result.score,
        wpm: result.wpm,
        accuracy: result.accuracy,
        errorRate: result.errorRate,
        completedWords: result.completedWords,
        endReason: result.endReason,
        remainingLives: result.remainingLives,
      });

      navigate("/app/results", {
        state: {
          result,
          persistenceStatus: "saved",
        },
      });
    } catch {
      navigate("/app/results", {
        state: {
          result,
          persistenceStatus: "error",
        },
      });
    }
  };

  const backToLobby = () => {
    if (
      socketRef.current?.readyState ===
      WebSocket.OPEN
    ) {
      socketRef.current.send(
        JSON.stringify({
          type: "leave_room",
          token:
            localStorage.getItem(
              PLAYER_TOKEN_KEY
            ),
        })
      );
    }

    socketRef.current?.close();

    navigate("/app/lobby", {
      replace: true,
    });
  };

  const restartMatch = () => {
    navigate("/app/pre-match", {
      replace: true,
      state: { matchConfig },
    });
  };

  const exitMatch = () => {
    navigate("/app", { replace: true });
  };

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      {/* GAME AREA */}
      {!classroomResults ? (
        <div className="flex min-h-0 min-w-0 flex-1 gap-4">
          <GameMount
            mode={mode}
            roomCode={roomCode}
            matchConfig={matchConfig}
            backgroundImage={getProfileBackground(backgroundId || user?.background).source}
            onRestart={mode === "solo" ? restartMatch : undefined}
            onExit={mode === "solo" ? exitMatch : undefined}
            wordSequence={wordSequence}
            startAt={startAt}
            onGameOver={handleGameOver}
            onPerformance={handlePerformance}
          />
        </div>
      ) : (
        /*
        * Once classroom_results arrives,
        * Phaser is removed from view.
         * This prevents:
         * Game Over + Match Complete +
         * Classroom Results
         * from stacking on top of each other.
         */
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <div className="w-full max-w-5xl rounded-2xl border border-emerald-400/40 bg-black/90 px-5 py-6 text-white shadow-xl sm:px-8">
            <div className="text-center">
              <div className="text-xs uppercase tracking-[0.3em] text-emerald-300">
                Classroom Results
              </div>

              <h2 className="mt-2 text-2xl font-semibold">
                Match Complete
              </h2>

              {currentUserRank !== null ? (
                <div className="mt-2 text-sm text-slate-300">
                  Your Rank:{" "}
                  <span className="font-semibold text-emerald-300">
                    #{currentUserRank}
                  </span>
                </div>
              ) : null}
            </div>

            {/* RESULTS TABLE */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-3">
                      Rank
                    </th>

                    <th className="px-3 py-3">
                      Player
                    </th>

                    <th className="px-3 py-3 text-center">
                      Score
                    </th>

                    <th className="px-3 py-3 text-center">
                      WPM
                    </th>

                    <th className="px-3 py-3 text-center">
                      Accuracy
                    </th>

                    <th className="px-3 py-3 text-center">
                      Completed Words
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {classroomResults.map(
                    (result, index) => {
                      const isCurrentUser =
                        result.userId === user?.id;

                      return (
                        <tr
                          key={result.userId}
                          className={`border-b border-white/5 last:border-0 ${
                            isCurrentUser
                              ? "bg-emerald-400/10 text-emerald-300"
                              : "text-white"
                          }`}
                        >
                          <td className="px-3 py-4 font-semibold">
                            #{index + 1}
                          </td>

                          <td className="px-3 py-4 font-medium">
                            {result.displayName ||
                              result.username}

                            {isCurrentUser ? (
                              <span className="ml-2 text-xs text-emerald-400">
                                You
                              </span>
                            ) : null}
                          </td>

                          <td className="px-3 py-4 text-center">
                            {result.score}
                          </td>

                          <td className="px-3 py-4 text-center">
                            {result.wpm.toFixed(
                              0
                            )}
                          </td>

                          <td className="px-3 py-4 text-center">
                            {result.accuracy.toFixed(
                              0
                            )}
                            %
                          </td>

                          <td className="px-3 py-4 text-center">
                            {
                              result.completedWords
                            }
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={backToLobby}
                className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-6 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20"
              >
                Back to Lobby
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        multiplayerResult intentionally has no React popup.

        Phaser already displays the local Game Over and
        "Waiting for other players..." state.

        Once classroomResults arrives, the Phaser view is
        replaced by the single Classroom Results screen.
      */}
      {mode === "multiplayer" &&
      multiplayerResult &&
      !classroomResults
        ? null
        : null}
    </section>
  );
}