import * as React from "react";
import type { ClassroomStanding } from "../lib/classroomTypes";

const StandingRow = React.memo(function StandingRow({ player, rank }: { player: ClassroomStanding; rank: number }) {
  return (
    <tr className={`border-b border-white/10 ${rank <= 3 ? "bg-amber-300/10 text-amber-100" : "text-white"}`}>
      <td className="px-3 py-2 font-semibold">#{rank}{rank <= 3 ? " ★" : ""}</td>
      <td className="max-w-48 truncate px-3 py-2" title={player.displayName || player.username}>
        {player.displayName || player.username}
      </td>
      <td className="px-3 py-2 tabular-nums">{player.score}</td>
      <td className="px-3 py-2 tabular-nums">{player.wpm.toFixed(0)}</td>
      <td className="px-3 py-2 tabular-nums">{player.accuracy.toFixed(0)}%</td>
      <td className="px-3 py-2">{player.completedWords}</td>
      <td className="px-3 py-2">{player.finished ? "Finished" : player.connected === false ? "Disconnected" : "Playing"}</td>
    </tr>
  );
}, (before, after) => before.rank === after.rank &&
  before.player.userId === after.player.userId && before.player.displayName === after.player.displayName &&
  before.player.username === after.player.username && before.player.score === after.player.score &&
  before.player.wpm === after.player.wpm && before.player.accuracy === after.player.accuracy &&
  before.player.completedWords === after.player.completedWords && before.player.finished === after.player.finished &&
  before.player.connected === after.player.connected);

export function ClassroomLeaderboard({ players, final = false }: { players: ClassroomStanding[]; final?: boolean }) {
  return (
    <div className="mt-4 min-w-0 rounded-2xl border border-white/10 bg-black/70 p-3 text-xs text-white">
      <h2 className="mb-2 uppercase tracking-[0.2em] text-emerald-300">
        {final ? "Final Rankings" : "Live Leaderboard"} · {players.length} students
      </h2>
      <div className="max-h-[55vh] overflow-auto" tabIndex={0} role="region" aria-label={final ? "Final student rankings" : "Live student rankings"}>
        <table className="w-full min-w-[520px] text-left">
          <thead className="sticky top-0 bg-slate-950 text-slate-300">
            <tr>{["Rank", "Student", "Score", "WPM", "Accuracy", "Words", "Status"].map(label =>
              <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr>
          </thead>
          <tbody>{players.map((player, index) =>
            <StandingRow key={player.userId} player={player} rank={player.rank ?? index + 1} />)}</tbody>
        </table>
        {players.length === 0 ? <p className="py-3 text-white/60">Waiting for student performance…</p> : null}
      </div>
    </div>
  );
}
