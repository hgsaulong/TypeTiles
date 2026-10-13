import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { GameResult } from "../scenes/GameScene";
import { greggSubmodeLabel } from "../lib/greggGameplay";
import { getPlayerHistory, getPlayerRank, type MatchHistoryRow, type PlayerStats } from "../lib/playerApi";

type ResultState = {
  result?: GameResult;
  persistenceStatus?: "saved" | "error";
};

export default function Results() {
  const location = useLocation();
  const state = location.state as ResultState | null;
  const result = state?.result;
  const [history, setHistory] = useState<MatchHistoryRow[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(5);

  const visibleHistory = history.slice(0, visibleCount);

  useEffect(() => {
    Promise.all([getPlayerHistory(), getPlayerRank()])
      .then(([historyResponse, rankResponse]) => {
        setHistory(historyResponse.history);
        setStats(rankResponse.stats);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load results"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-4">
      <div className="hud-panel rounded-[2rem] p-6">
        <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">Student Statistics</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Games Played", stats?.games_played],
            ["Best WPM", stats ? stats.best_wpm.toFixed(1) : undefined],
            ["Average Accuracy", stats ? `${stats.avg_accuracy.toFixed(1)}%` : undefined],
            ["Total Score", stats?.total_score],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
              <div className="mt-2 text-2xl font-semibold">{value ?? (loading ? "..." : "0")}</div>
            </div>
          ))}
        </div>
      </div>

      {result ? <article className="hud-panel rounded-[2rem] p-5">
        <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">Match Result</div>
        <h1 className="mt-2 text-4xl font-semibold text-white">Session Complete</h1>
        <div className="mt-4 space-y-2">
          {[
            ["Score", String(result.score)],
            ["WPM", result.wpm.toFixed(1)],
            ["Accuracy", `${result.accuracy.toFixed(1)}%`],
            ["Error Rate", `${result.errorRate.toFixed(1)}%`],
            ["Completed Words", String(result.completedWords)],
            ["End Reason", result.endReason === "health" ? "Health depleted" : "Time expired"],
            ["Difficulty", result.difficulty],
            ["Category", result.wordSet],
            ...(result.greggSubmode ? [["Stenography Mode", greggSubmodeLabel(result.greggSubmode)]] : []),
            ["Round Time", `${result.roundTime}s`],
            ["Remaining Lives", String(result.remainingLives)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white">
              <span className="text-slate-400">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
        {state?.persistenceStatus === "saved" ? <div className="mt-4 text-sm text-emerald-300">Match saved.</div> : null}
        {state?.persistenceStatus === "error" ? <div className="mt-4 text-sm text-amber-300">Match result could not be saved.</div> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/app/play" className="rounded-full bg-emerald-400 px-4 py-3 font-semibold text-slate-950">Play Again</Link>
          <Link to="/app" className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-white">Dashboard</Link>
        </div>
      </article> : null}

      <article className="hud-panel rounded-[2rem] p-5">
        <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">Match History</div>
        {loading ? <div className="mt-5 text-sm text-slate-400">Loading history...</div> : null}
        {error ? <div className="mt-5 text-sm text-amber-300">{error}</div> : null}
        {!loading && !error && history.length === 0 ? <div className="mt-5 text-sm text-slate-400">No completed matches yet.</div> : null}
        {!loading && !error && history.length > 0 ? (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-slate-400">
                <tr>
                  <th className="pb-3">Date</th>
                  <th className="pb-3">Mode</th>
                  <th className="pb-3">Difficulty</th>
                  <th className="pb-3">Category</th>
                  <th className="pb-3">Round</th>
                  <th className="pb-3">Score</th>
                  <th className="pb-3">WPM</th>
                  <th className="pb-3">Accuracy</th>
                  <th className="pb-3">Position</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((match) => (
                  <tr key={match.id} className="border-t border-white/10 text-white">
                    <td className="py-3">{new Date(match.created_at).toLocaleString()}</td>
                    <td>{match.mode}</td>
                    <td>{match.difficulty}</td>
                    <td>{match.word_set}</td>
                    <td>{match.round_time}s</td>
                    <td>{match.score}</td>
                    <td>{match.wpm.toFixed(1)}</td>
                    <td>{match.accuracy.toFixed(1)}%</td>
                    <td>{match.position ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleCount < history.length ? (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + 5)}
                className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Load More
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    </section>
  );
}
