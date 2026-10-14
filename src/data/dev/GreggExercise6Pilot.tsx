import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { PENDING_GREGG_PILOT_MAPPINGS } from "./greggPilotMappings";
import { STENO_EXERCISES } from "../stenoExercises";

function coverageWarning(exerciseNumber: number): string {
  const tokens = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];
  const counts = (words: string[]) => words.reduce<Record<string, number>>((result, word) => {
    result[word] = (result[word] ?? 0) + 1; return result;
  }, {});
  const reference = counts(tokens(STENO_EXERCISES.find((item) => item.exerciseNumber === exerciseNumber)!.sentence));
  const mapped = counts(tokens(PENDING_GREGG_PILOT_MAPPINGS.filter((item) => item.exerciseNumber === exerciseNumber).map((item) => item.answer).join(" ")));
  const missing = Object.keys(reference).filter((word) => (mapped[word] ?? 0) < reference[word]);
  const extra = Object.keys(mapped).filter((word) => mapped[word] > (reference[word] ?? 0));
  return missing.length || extra.length
    ? `Review required. Missing: ${missing.join(", ") || "none"}. Extra/duplicate: ${extra.join(", ") || "none"}.`
    : "Word coverage matches ignoring case and punctuation; shorthand associations remain pending verification.";
}

export default function GreggExercise6Pilot() {
  const navigate = useNavigate();
  const [difficulty, setDifficulty] = useState("Normal");
  const [roundTime, setRoundTime] = useState(60);
  const [selection, setSelection] = useState("all");
  const exercises = selection === "all" ? [6, 7, 8, 9, 10] : [Number(selection)];
  return <section className="h-full overflow-y-auto rounded-xl border border-blue-400 bg-slate-950 p-6 text-white">
    <h1 className="text-2xl font-semibold">Development Exercises 6–10 Crop Pilot</h1>
    <p className="my-4">These manually mapped crops are pending verification. This development pilot saves results through the existing global statistics pipeline.</p>
    <p className="my-4 text-amber-200">Review required: Exercise 7 duplicates “you” and omits “are”. Exercise 8 retains the unconfirmed spelling “Releived”. Answers remain unchanged and pending.</p>
    <label className="flex items-center gap-2">Exercise selection<select className="bg-slate-800 p-2" value={selection} onChange={(event) => setSelection(event.target.value)}><option value="all">All Exercises (6 → 7 → 8 → 9 → 10)</option>{[6, 7, 8, 9, 10].map((number) => <option key={number} value={number}>Exercise {number} only</option>)}</select></label>
    {exercises.map((number) => <div key={number} className="my-4"><h2 className="font-semibold">Exercise {number}</h2><p className="text-amber-200">{coverageWarning(number)}</p><ol className="list-inside list-decimal">{PENDING_GREGG_PILOT_MAPPINGS.filter((item) => item.exerciseNumber === number).sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((item) => <li key={item.id}>Order {item.sequenceOrder}: {item.answer} — {item.verification}</li>)}</ol></div>)}
    <label className="mr-4 inline-flex gap-2">Difficulty<select className="bg-slate-800 p-2" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>{["Easy", "Normal", "Hard"].map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="inline-flex gap-2">Round<select className="bg-slate-800 p-2" value={roundTime} onChange={(e) => setRoundTime(Number(e.target.value))}>{[30, 60, 90].map((item) => <option key={item} value={item}>{item}s</option>)}</select></label>
    <button className="mt-6 block rounded bg-blue-700 px-5 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300" onClick={() => navigate("/app/pre-match", { state: { matchConfig: { mode: "Solo Practice", wordSet: selection === "all" ? "Gregg Exercises 6-10 Crop Pilot" : `Gregg Exercise ${selection} Crop Pilot`, difficulty, roundTime, opponents: [] } } })}>Start selected pending pilot</button>
  </section>;
}
