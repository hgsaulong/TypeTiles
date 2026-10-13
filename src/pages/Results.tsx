import { ChevronLeft, ChevronRight, UserCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { GameResult } from "../scenes/GameScene";
import { greggSubmodeLabel } from "../lib/greggGameplay";
import {
  getPlayerHistory,
  getPlayerRank,
  getTeacherMatchDetails,
  getTeacherSessions,
  type MatchHistoryRow,
  type PlayerStats,
  type TeacherMatchDetails,
  type TeacherSession,
} from "../lib/playerApi";
import { usePlayerAuth } from "../lib/PlayerAuthContext";

type ResultState = {
  result?: GameResult;
  persistenceStatus?: "saved" | "error";
};

type HistoryTab = "solo" | "multiplayer";

function formatCategory(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "General";
}

function formatDate(value: string) {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

function Metric({ label, value, compact = false }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <div className={compact ? "min-w-[54px] border-l border-white/10 pl-3 text-center first:border-l-0" : "flex items-center justify-between border-b border-white/10 py-2 text-sm last:border-b-0"}>
      <span className={compact ? "block text-[9px] text-slate-400" : "text-slate-300"}>{label}</span>
      <span className={compact ? "mt-1 block text-xs font-semibold text-white" : "font-semibold text-lime-400"}>{value}</span>
    </div>
  );
}

export default function Results() {
  const { user } = usePlayerAuth();
  const isTeacher = user?.role === "teacher";
  const location = useLocation();
  const state = location.state as ResultState | null;
  const result = state?.result;
  const [history, setHistory] = useState<MatchHistoryRow[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<HistoryTab>("solo");
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [teacherSessions, setTeacherSessions] = useState<TeacherSession[]>([]);
  const [teacherDetails, setTeacherDetails] = useState<TeacherMatchDetails | null>(null);
  const [teacherDetailsLoading, setTeacherDetailsLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      getPlayerHistory(),
      getPlayerRank(),
      isTeacher ? getTeacherSessions() : Promise.resolve({ sessions: [] as TeacherSession[] }),
    ])
      .then(([historyResponse, rankResponse, teacherSessionsResponse]) => {
        setHistory(historyResponse.history);
        setTeacherSessions(teacherSessionsResponse.sessions);
        setStats(rankResponse.stats);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load results"))
      .finally(() => setLoading(false));
  }, [isTeacher]);

  const soloHistory = useMemo(
    () => history.filter((match) => {
      const mode = match.mode.toLowerCase();
      return mode.includes("solo") || mode.includes("practice");
    }),
    [history],
  );
  const multiplayerHistory = useMemo(
    () => history.filter((match) => {
      const mode = match.mode.toLowerCase();
      return !mode.includes("solo") && !mode.includes("practice");
    }),
    [history],
  );
  const visibleHistory = activeTab === "solo" ? soloHistory : multiplayerHistory;
  const selectedMatch = visibleHistory.find((match) => match.id === selectedMatchId) ?? null;

  const toggleMatch = (matchId: number) => {
    setSelectedMatchId((current) => (current === matchId ? null : matchId));
  };

  const openTeacherSession = (matchId: number) => {
    setSelectedMatchId(matchId);
    setTeacherDetailsLoading(true);
    setError("");
    getTeacherMatchDetails(matchId)
      .then(setTeacherDetails)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load session details"))
      .finally(() => setTeacherDetailsLoading(false));
  };

  if (isTeacher && activeTab === "multiplayer" && teacherDetails) {
    return (
      <section className="flex h-full min-h-0 flex-col overflow-hidden pb-2 pt-3">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 px-1">
          <article className="rounded-[1.2rem] border border-[#2967a1] bg-[#11183d]/95 p-3 shadow-[0_16px_35px_rgba(4,8,25,0.35)]">
            <button type="button" onClick={() => { setTeacherDetails(null); setSelectedMatchId(null); }} className="mb-3 inline-flex items-center gap-1 text-sm text-white hover:text-cyan-300">
              <ChevronLeft className="h-4 w-4" /> Back to Multiplayer Sessions
            </button>
            <div className="grid gap-2 rounded-lg border border-[#2967a1] bg-[#1d2655] p-3 text-xs sm:grid-cols-5">
              <div><span className="block text-slate-400">Session</span><strong className="text-white">{formatCategory(teacherDetails.match.word_set)}</strong><span className="block text-sky-300">{teacherDetails.match.difficulty} Mode</span></div>
              <div><span className="block text-slate-400">Room ID</span><strong className="text-white">#{teacherDetails.match.id}</strong></div>
              <div><span className="block text-slate-400">Date and Time</span><strong className="text-white">{formatDate(teacherDetails.match.created_at).date}</strong><span className="block text-slate-300">{formatDate(teacherDetails.match.created_at).time}</span></div>
              <div><span className="block text-slate-400">Participants</span><strong className="text-white">{teacherDetails.participants.length}</strong></div>
              <div><span className="block text-slate-400">Status</span><strong className="text-emerald-300">{teacherDetails.match.status === "completed" ? "Complete" : "In progress"}</strong></div>
            </div>
          </article>

          <article className="min-h-0 flex-1 rounded-[1.2rem] border border-[#2967a1] bg-[#11183d]/95 p-3 shadow-[0_16px_35px_rgba(4,8,25,0.35)]">
            <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-sky-300">Participants</div>
            {teacherDetails.participants.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">No students participated in this session.</div> : (
              <div className="scrollbar-hidden min-h-0 overflow-y-auto">
                <div className="hidden grid-cols-[0.5fr_2fr_1.5fr_1fr_1fr_1fr_1fr] gap-2 rounded-t-md bg-[#1d2655] px-3 py-2 text-[10px] text-slate-300 sm:grid">
                  <span>Rank</span><span>Student</span><span>Username</span><span>Score</span><span>WPM</span><span>Accuracy</span><span>Status</span>
                </div>
                {teacherDetails.participants.map((participant) => (
                  <div key={participant.user_id} className="grid gap-2 border-b border-[#2967a1]/60 bg-[#11183d] px-3 py-3 text-xs sm:grid-cols-[0.5fr_2fr_1.5fr_1fr_1fr_1fr_1fr] sm:items-center">
                    <span className="font-semibold text-white">{participant.position ?? "—"}</span>
                    <span className="flex items-center gap-2 text-white"><UserCircle className="h-7 w-7 text-slate-300" />{participant.display_name}</span>
                    <span className="text-slate-300">{participant.username}</span>
                    <span className="text-white">{participant.score.toLocaleString()}</span>
                    <span className="text-white">{participant.wpm.toFixed(1)}</span>
                    <span className="text-white">{participant.accuracy.toFixed(1)}%</span>
                    <span className="rounded-md bg-emerald-500 px-2 py-1 text-center font-semibold text-slate-950">{participant.participant_status}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden pb-2 pt-3">
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 px-1">
        <article className="flex-none rounded-[1.2rem] border border-[#2967a1] bg-[#11183d]/95 p-3 shadow-[0_16px_35px_rgba(4,8,25,0.35)]">
          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-sky-300">Performance Overview</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Games Played", stats?.games_played],
              ["Best WPM", stats ? stats.best_wpm.toFixed(1) : undefined],
              ["Average Accuracy", stats ? `${stats.avg_accuracy.toFixed(1)}%` : undefined],
              ["Total Score", stats?.total_score],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[0.7rem] border border-[#2967a1] bg-[#1d2655] px-3 py-2 text-center">
                <div className="text-[9px] uppercase text-slate-400">{label}</div>
                <div className="mt-1 text-lg font-semibold text-white">{value ?? (loading ? "..." : "0")}</div>
              </div>
            ))}
          </div>
        </article>

        {result ? (
          <article className="rounded-[1.2rem] border border-emerald-400/40 bg-[#11183d]/95 p-4 text-white">
            <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">Match Result</div>
            <h1 className="mt-1 text-2xl font-semibold">Session Complete</h1>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                ["Score", String(result.score)],
                ["WPM", result.wpm.toFixed(1)],
                ["Accuracy", `${result.accuracy.toFixed(1)}%`],
                ["Error Rate", `${result.errorRate.toFixed(1)}%`],
                ["Completed Words", String(result.completedWords)],
                ["End Reason", result.endReason === "health" ? "Health depleted" : "Time expired"],
                ["Difficulty", result.difficulty],
                ["Category", result.wordSet],
                ...(result.greggSubmode ? [["Falling Text", greggSubmodeLabel(result.greggSubmode)]] : []),
                ["Round Time", `${result.roundTime}s`],
                ["Remaining Lives", String(result.remainingLives)],
              ].map(([label, value]) => <Metric key={String(label)} label={String(label)} value={value} />)}
            </div>
            {state?.persistenceStatus === "saved" ? <div className="mt-3 text-sm text-emerald-300">Match saved.</div> : null}
            {state?.persistenceStatus === "error" ? <div className="mt-3 text-sm text-amber-300">Match result could not be saved.</div> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/app/play" className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-slate-950">Play Again</Link>
              <Link to="/app" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white">Dashboard</Link>
            </div>
          </article>
        ) : null}

        <article className="rounded-[1.2rem] border border-[#2967a1] bg-[#11183d]/95 p-3 shadow-[0_16px_35px_rgba(4,8,25,0.35)]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-sky-300">Match History</div>
          <div className="mt-2 flex gap-4 border-b border-white/10 text-[10px] uppercase tracking-[0.15em]">
            {(["solo", "multiplayer"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  setSelectedMatchId(null);
                }}
                className={`border-b-2 px-1 pb-2 ${activeTab === tab ? "border-cyan-300 text-white" : "border-transparent text-slate-500"}`}
              >
                {tab === "solo" ? "Solo Mode" : "Multiplayer"}
              </button>
            ))}
          </div>

          {loading ? <div className="py-8 text-sm text-slate-400">Loading history...</div> : null}
          {error ? <div className="py-8 text-sm text-amber-300">{error}</div> : null}
          {isTeacher && activeTab === "multiplayer" ? (
            teacherDetailsLoading ? <div className="py-8 text-sm text-slate-400">Loading session details...</div> :
              !loading && !error && teacherSessions.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">None</div> : (
                <div className="scrollbar-hidden mt-3 min-h-0 space-y-2 overflow-y-auto">
                  {teacherSessions.map((session) => {
                    const date = formatDate(session.created_at);
                    return (
                      <button key={session.id} type="button" onClick={() => openTeacherSession(session.id)} className="grid w-full grid-cols-[1.5fr_1fr_1.4fr_1fr_1fr_auto] items-center gap-2 rounded-md border border-[#2967a1] bg-[#1d2655] px-3 py-2 text-left text-xs transition hover:border-cyan-300">
                        <span><strong className="block text-white">{formatCategory(session.word_set)}</strong><span className="text-[10px] text-sky-300">{session.difficulty} Mode</span></span>
                        <span className="text-slate-300">#{session.id}</span>
                        <span className="text-slate-300">{date.date}<span className="block text-[10px]">{date.time}</span></span>
                        <span className="text-white">{session.participant_count}</span>
                        <span className="rounded-md bg-emerald-500 px-2 py-1 text-center font-semibold text-slate-950">{session.status === "completed" ? "Complete" : "In progress"}</span>
                        <ChevronRight className="h-4 w-4 text-white" />
                      </button>
                    );
                  })}
                </div>
              )
          ) : null}

          {(!isTeacher || activeTab === "solo") && !loading && !error && visibleHistory.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">None</div> : null}

          {(!isTeacher || activeTab === "solo") && !loading && !error && visibleHistory.length > 0 ? (
            <div className={`mt-3 grid min-h-0 flex-1 gap-2 ${selectedMatch ? "lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.72fr)]" : ""}`}>
              <div className="scrollbar-hidden min-h-0 space-y-2 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
                {visibleHistory.map((match) => {
                  const date = formatDate(match.created_at);
                  const selected = match.id === selectedMatchId;
                  return (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => toggleMatch(match.id)}
                      className={`w-full rounded-[0.35rem] border px-3 py-2 text-left transition ${selected ? "border-cyan-300 bg-[#1d2b63]" : "border-[#2967a1] bg-[#1d2655] hover:border-cyan-300"}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-emerald-400">{formatCategory(match.word_set)}</div>
                          <div className="text-[9px] text-slate-300">{date.date}</div>
                          <div className="text-[9px] text-slate-400">{date.time}</div>
                        </div>
                        <div className="hidden items-center gap-3 sm:flex">
                          <Metric compact label="WPM" value={match.wpm.toFixed(1)} />
                          <Metric compact label="Accuracy" value={`${match.accuracy.toFixed(1)}%`} />
                          <Metric compact label="Score" value={match.score} />
                          {activeTab === "multiplayer" ? (
                            <Metric compact label="Place" value={match.position ? `${match.position}${match.position === 1 ? "st" : match.position === 2 ? "nd" : match.position === 3 ? "rd" : "th"}` : "—"} />
                          ) : (
                            <>
                              <Metric compact label="Duration" value={`${match.round_time}s`} />
                              <Metric compact label="Difficulty" value={match.difficulty} />
                            </>
                          )}
                        </div>
                        <ChevronRight className={`h-4 w-4 shrink-0 text-white transition-transform ${selected ? "rotate-180" : ""}`} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 sm:hidden">
                        <Metric compact label="WPM" value={match.wpm.toFixed(1)} />
                        <Metric compact label="Accuracy" value={`${match.accuracy.toFixed(1)}%`} />
                        <Metric compact label="Score" value={match.score} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedMatch ? (
                <aside className="rounded-[0.8rem] border border-[#2967a1] bg-[#1d2655] p-3">
                  <button type="button" onClick={() => setSelectedMatchId(null)} className="mb-2 inline-flex items-center gap-1 text-xs text-white hover:text-cyan-300">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <div className="mb-2 text-xs font-semibold text-emerald-400">{formatCategory(selectedMatch.word_set)}</div>
                  {[
                    ["WPM", selectedMatch.wpm.toFixed(1)],
                    ["Accuracy", `${selectedMatch.accuracy.toFixed(1)}%`],
                    ["Score", selectedMatch.score],
                    ["Duration", `${selectedMatch.round_time}s`],
                    ["Difficulty", selectedMatch.difficulty],
                                    ...(activeTab === "multiplayer" ? [["Place", selectedMatch.position ? `${selectedMatch.position}${selectedMatch.position === 1 ? "st" : selectedMatch.position === 2 ? "nd" : selectedMatch.position === 3 ? "rd" : "th"}` : "—"]] : []),
                                    ["Error Rate", `${selectedMatch.error_rate.toFixed(1)}%`],
                                    ["Completed Words", selectedMatch.completed_words],
                                                    ["End Reason", selectedMatch.end_reason === "health" ? "Health depleted" : selectedMatch.end_reason === "time" ? "Time expired" : "—"],
                                    ["Remaining Lives", selectedMatch.remaining_lives],
                  ].map(([label, value]) => <Metric key={String(label)} label={String(label)} value={value} />)}
                </aside>
              ) : null}
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
