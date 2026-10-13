import { practiceFormatLabel, type PracticeFormat } from "../../server/src/sentenceBank";

export function PracticeFormatSelector({ value, onChange }: { value: PracticeFormat; onChange: (format: PracticeFormat) => void }) {
  return <div className="mt-4">
    <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Practice Format</div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {(["word-phrase", "full-sentence"] as const).map((format) => <button key={format} type="button"
        aria-pressed={value === format} onClick={() => onChange(format)}
        className={`rounded-xl border px-4 py-3 text-white ${value === format ? "border-emerald-400/60 bg-emerald-400/15" : "border-white/10 bg-white/[0.03]"}`}>
        {practiceFormatLabel(format)}
      </button>)}
    </div>
    <p className="mt-2 text-xs text-slate-400">Full Sentence falls slower. Type the complete sentence, including spaces and punctuation.</p>
  </div>;
}
