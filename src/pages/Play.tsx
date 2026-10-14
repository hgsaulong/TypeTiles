import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { mockMatchConfig, type GreggSubmode } from "../lib/mockData";
import { resolveGreggSubmode } from "../lib/greggGameplay";
import { GreggModeSelector } from "../components/GreggModeSelector";
import { PracticeFormatSelector } from "../components/PracticeFormatSelector";

const categories = ["Corporate", "Communication", "Records", "Accounting", "Technology", "General", "Stenography", "Medical", "Legal"] as const;
const difficulties = ["Easy", "Normal", "Hard"] as const;
const roundTimes = [30, 60, 90] as const;

type Difficulty = (typeof difficulties)[number];

export default function Play() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<(typeof categories)[number]>("General");
  const [difficulty, setDifficulty] = useState<Difficulty>("Normal");
  const [roundTime, setRoundTime] = useState<number>(90);
  const [greggSubmode, setGreggSubmode] = useState<GreggSubmode>("full-sentence");
  const [practiceFormat, setPracticeFormat] = useState<GreggSubmode>("word-phrase");

  const startPractice = () => {
    navigate("/app/pre-match", {
      state: {
        matchConfig: {
          ...mockMatchConfig,
          mode: "Solo Practice",
          wordSet: category,
          difficulty,
          roundTime,
          opponents: [],
          ...(category === "Stenography" ? { greggSubmode: resolveGreggSubmode(greggSubmode) } : { practiceFormat }),
        },
      },
    });
  };

  return (
    <section className="hud-panel rounded-[2rem] p-6">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">Solo Practice</div>
          <h1 className="mt-2 text-4xl font-semibold text-white">Start Practice</h1>
          <p className="mt-2 max-w-2xl text-slate-400">Choose a category, difficulty, and round time for your typing session.</p>
        </div>
        <Link to="/app/lobby" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">Multiplayer Lobby</Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Category</div>
          <div className="mt-3 grid gap-2">
            {categories.map((item) => (
              <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded-xl border px-4 py-3 text-left text-white ${category === item ? "border-emerald-400/60 bg-emerald-400/15" : "border-white/10 bg-white/[0.03]"}`}>
                {item}
              </button>
            ))}
          </div>
          {category === "Stenography" ? (
            <GreggModeSelector value={greggSubmode} onChange={setGreggSubmode} />
          ) : <PracticeFormatSelector value={practiceFormat} onChange={setPracticeFormat} />}
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Difficulty</div>
          <div className="mt-3 space-y-2">
            {difficulties.map((item) => (
              <button key={item} type="button" onClick={() => setDifficulty(item)} className={`block w-full rounded-xl border px-4 py-3 text-left text-white ${difficulty === item ? "border-emerald-400/60 bg-emerald-400/15" : "border-white/10 bg-white/[0.03]"}`}>
                <span className="font-semibold">{item}</span>
                <span className="mt-1 block text-xs text-slate-400">{item === "Easy" ? "Shorter words / slower falling speed" : item === "Normal" ? "Medium words / standard speed" : "Longer words / faster falling speed"}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Round Time</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {roundTimes.map((time) => (
              <button key={time} type="button" onClick={() => setRoundTime(time)} className={`rounded-xl border px-3 py-3 text-white ${roundTime === time ? "border-emerald-400/60 bg-emerald-400/15" : "border-white/10 bg-white/[0.03]"}`}>
                {time}s
              </button>
            ))}
          </div>
          <button type="button" onClick={startPractice} className="mt-6 w-full rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300">Start Practice</button>
        </div>
      </div>
    </section>
  );
}
