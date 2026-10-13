import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { mockMatchConfig } from "../lib/mockData";
import { createPlayerMatch } from "../lib/playerApi";
import { isGreggStenographyCategory } from "../data/greggPrompts";
import { greggSubmodeLabel, resolveGreggSubmode } from "../lib/greggGameplay";
import { practiceFormatLabel } from "../../server/src/sentenceBank";

export default function PreMatch() {
  const navigate = useNavigate();
  const location = useLocation();

  const matchConfig =
    (
      location.state as {
        matchConfig?: typeof mockMatchConfig;
      } | null
    )?.matchConfig ?? mockMatchConfig;

  const [countdown, setCountdown] = useState(3);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const matchCreationRef = useRef<ReturnType<typeof createPlayerMatch> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    if (!matchCreationRef.current) {
      matchCreationRef.current = createPlayerMatch({
        mode: matchConfig.mode,
        difficulty: matchConfig.difficulty,
        roundTime: matchConfig.roundTime,
        wordSet: matchConfig.wordSet,
        practiceFormat: matchConfig.practiceFormat,
      });
    }

    matchCreationRef.current
      .then(({ matchId: createdMatchId }) => {
        if (cancelled) return;
        setMatchId(createdMatchId);

        timer = window.setInterval(() => {
          setCountdown((value) => {
            if (value <= 1) {
              window.clearInterval(timer);
              navigate("/app/game", {
                state: { matchConfig, matchId: createdMatchId },
              });
              return 0;
            }

            return value - 1;
          });
        }, 1000);

      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Unable to create match");
        }
      });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [matchConfig, navigate]);

  return (
    <section className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
      <div className="hud-panel w-full max-w-[640px] rounded-[2rem] p-6 text-center">
      <div className="text-xs uppercase tracking-[0.35em] text-emerald-300">
        Pre-Match
      </div>

      <h1 className="mt-2 text-4xl font-semibold text-white">
        {error ? "Unable to start match" : matchId ? `Deploying in ${countdown}` : "Creating match..."}
      </h1>

      {error ? <p className="mt-3 text-red-300">{error}</p> : null}

      <div className="mt-6 grid gap-4">
        <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 text-left text-slate-300">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Practice Session
          </div>

          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white">
            Category: {matchConfig.wordSet}
            {isGreggStenographyCategory(matchConfig.wordSet) ? (
              <div className="mt-2">Stenography Mode: {greggSubmodeLabel(resolveGreggSubmode(matchConfig.greggSubmode))}</div>
            ) : <div className="mt-2">Practice Format: {practiceFormatLabel(matchConfig.practiceFormat)}</div>}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.15),transparent_42%),linear-gradient(180deg,rgba(2,6,23,0.85),rgba(15,23,42,0.95))] p-5 text-left">
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-300">
            Rules Summary
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-white">
              <div className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Mode
              </div>
              <div className="mt-2 text-lg">
                {matchConfig.mode}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-white">
              <div className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Difficulty
              </div>
              <div className="mt-2 text-lg">
                {matchConfig.difficulty}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-white">
              <div className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Round Time
              </div>
              <div className="mt-2 text-lg">
                {matchConfig.roundTime}s
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-slate-300">
            Map preview locked. Route state carries the selected match
            configuration to the game scene.
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
