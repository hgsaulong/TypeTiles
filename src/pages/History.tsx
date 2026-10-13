import { useEffect, useState } from "react";
import { practiceFormatLabel } from "../../server/src/sentenceBank";
import { getPlayerHistory, getPlayerRank, type MatchHistoryRow, type PlayerStats } from "../lib/playerApi";

export default function History() {
  const [history, setHistory] = useState<MatchHistoryRow[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getPlayerHistory(), getPlayerRank()])
      .then(([historyResponse, rankResponse]) => {
        setHistory(historyResponse.history);
        setStats(rankResponse.stats);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Unable to load history"))
      .finally(() => setLoading(false));
  }, []);

  const trendHeights = history.slice(0, 7).map((row) => Math.min(100, Math.max(15, row.wpm)));

  return (
    <section className="space-y-4">
      <div className="hud-panel rounded-[2rem] p-6">
        <h1 className="text-4xl font-semibold text-white">Score History</h1>
        <p className="mt-2 text-slate-400">Your completed matches, recent trends, and personal bests.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="hud-panel rounded-[2rem] p-6">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.3em] text-slate-400">
              <tr>
                <th className="pb-3">Date</th>
                <th className="pb-3">Mode</th>
                <th className="pb-3">Format</th>
                <th className="pb-3">WPM</th>
                <th className="pb-3">Accuracy</th>
                <th className="pb-3">Score</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t border-white/8 text-white">
                  <td className="py-3">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td>{row.mode}</td>
                  <td>{practiceFormatLabel(row.practice_format)}</td>
                  <td>{row.wpm}</td>
                  <td>{row.accuracy}%</td>
                  <td>{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="py-6 text-sm text-slate-400">Loading history...</div> : null}
          {!loading && !error && history.length === 0 ? <div className="py-6 text-sm text-slate-400">No completed matches yet.</div> : null}
          {error ? <div className="py-6 text-sm text-amber-300">{error}</div> : null}
        </div>

        <div className="space-y-4">
          <div className="hud-panel rounded-[2rem] p-6">
            <h2 className="text-lg font-semibold text-white">Recent WPM Trend</h2>
            <div className="mt-4 flex h-56 items-end gap-2">
              {trendHeights.map((height, index) => (
                <div key={index} className="flex-1 rounded-t-2xl bg-gradient-to-t from-emerald-500/60 to-cyan-400/80" style={{ height: `${height}%` }} />
              ))}
              {!loading && trendHeights.length === 0 ? <div className="w-full self-center text-center text-sm text-slate-400">No match data yet.</div> : null}
            </div>
          </div>
          <div className="hud-panel rounded-[2rem] p-6">
            <h2 className="text-lg font-semibold text-white">Personal Bests</h2>
            <div className="mt-4 space-y-3 text-white">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">Best WPM: {stats ? stats.best_wpm : "..."}</div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">Average Accuracy: {stats ? `${stats.avg_accuracy.toFixed(1)}%` : "..."}</div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">Top Combo: {stats ? stats.top_combo : "..."}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
