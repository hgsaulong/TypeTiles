import type { GreggSubmode } from "../lib/mockData";
import { canPreviewGreggCrops, greggSubmodeLabel } from "../lib/greggGameplay";

export function GreggModeSelector({ value, onChange }: { value: GreggSubmode; onChange: (mode: GreggSubmode) => void }) {
  return <div className="mt-4">
    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Stenography Mode</div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {(["word-phrase", "full-sentence"] as const).map((mode) => (
        <button key={mode} type="button" disabled={mode === "word-phrase" && !canPreviewGreggCrops()}
          aria-pressed={value === mode} onClick={() => onChange(mode)}
          className={`rounded-xl border px-4 py-3 text-white disabled:cursor-not-allowed disabled:opacity-50 ${value === mode ? "border-emerald-400/60 bg-emerald-400/15" : "border-white/10 bg-white/[0.03]"}`}>
          {greggSubmodeLabel(mode)}
        </button>
      ))}
    </div>
    <p className="mt-2 text-xs text-slate-400">Full Sentence falls slower for longer answers. Word / Phrase is a local development preview pending verification.</p>
  </div>;
}
