import { useEffect, useRef, useState, type PointerEvent } from "react";
import { STENO_EXERCISES } from "../stenoExercises";
import { isValidGreggCrop, type GreggCropMapping, type GreggCropRectangle } from "../greggCropMappings";
import { exportPendingMappings, rectangleBetween, sourcePoint, type ImageSize, type PixelPoint } from "./greggCropEditorUtils";

const field = "rounded border border-blue-400/60 bg-slate-900 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300";
const button = `${field} hover:bg-blue-900 disabled:opacity-50`;

export default function GreggCropEditor() {
  const [exerciseNumber, setExerciseNumber] = useState<(typeof STENO_EXERCISES)[number]["exerciseNumber"]>(6);
  const exercise = STENO_EXERCISES.find((item) => item.exerciseNumber === exerciseNumber)!;
  const [sizes, setSizes] = useState<Record<number, ImageSize>>({});
  const [crop, setCrop] = useState<GreggCropRectangle | null>(null);
  const [answer, setAnswer] = useState("");
  const [order, setOrder] = useState(1);
  const [mappings, setMappings] = useState<GreggCropMapping[]>([]);
  const [message, setMessage] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ start: PixelPoint; pointerId: number } | null>(null);
  const size = sizes[exerciseNumber];
  const valid = !!crop && !!size && isValidGreggCrop(crop, size.width, size.height);

  useEffect(() => {
    const canvas = previewRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !crop || !valid || !image.complete) return;
    canvas.width = crop.width;
    canvas.height = crop.height;
    canvas.getContext("2d")?.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  }, [crop, valid, exerciseNumber, size]);

  function point(event: PointerEvent<HTMLImageElement>) {
    const image = event.currentTarget;
    return sourcePoint(event.clientX, event.clientY, image.getBoundingClientRect(), { width: image.naturalWidth, height: image.naturalHeight });
  }

  function updateDrag(event: PointerEvent<HTMLImageElement>) {
    const end = point(event);
    if (drag.current?.pointerId === event.pointerId && end) setCrop(rectangleBetween(drag.current.start, end));
  }

  function exportData(download: boolean) {
    try {
      const json = exportPendingMappings(mappings, sizes);
      if (download) {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = "gregg-crop-mappings-pending.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("Downloaded pending mappings.");
      } else {
        const code = `export const GREGG_CROP_MAPPINGS = ${json} as const satisfies readonly GreggCropMapping[];`;
        void navigator.clipboard.writeText(code).then(() => setMessage("Copied TypeScript data. Import GreggCropMapping when reviewing it."))
          .catch(() => setMessage("Clipboard unavailable. Use Download JSON instead."));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export failed."); }
  }

  return (
    <main className="h-screen overflow-y-auto bg-slate-950 p-4 text-slate-100 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <h1 className="text-2xl font-semibold">Developer Gregg Crop Editor</h1>
        <p>Connected Gregg outlines may represent multiple words. Do not arbitrarily split them. Every export is PENDING instructor verification.</p>
        <p className="text-sm text-slate-300">Selections remain in this page's memory only. Add a region before switching exercises; export before refreshing or leaving.</p>
        <label className="flex flex-wrap items-center gap-3">Exercise
          <select className={field} value={exerciseNumber} onChange={(event) => {
            const number = Number(event.target.value) as typeof exerciseNumber;
            setExerciseNumber(number); setCrop(null); setAnswer(""); drag.current = null;
            setOrder(Math.max(0, ...mappings.filter((item) => item.exerciseNumber === number).map((item) => item.sequenceOrder)) + 1);
          }}>
            {STENO_EXERCISES.map((item) => <option key={item.id} value={item.exerciseNumber}>Exercise {item.exerciseNumber}</option>)}
          </select>
        </label>
        <p>{exercise.sentence}</p>
        <div className="relative w-full">
          <img key={exercise.id} ref={imageRef} src={exercise.imagePath} alt={`Full Gregg shorthand exercise ${exerciseNumber}; drag to select a source region, or enter pixel coordinates below.`}
            draggable={false} className="block h-auto w-full touch-none select-none" onLoad={(event) => {
              const image = event.currentTarget;
              setSizes((current) => ({ ...current, [exerciseNumber]: { width: image.naturalWidth, height: image.naturalHeight } }));
            }} onError={() => setMessage("Unable to load this exercise image.")}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              const start = point(event); if (!start) return;
              event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { start, pointerId: event.pointerId }; setCrop(rectangleBetween(start, start));
            }} onPointerMove={updateDrag} onPointerUp={(event) => {
              updateDrag(event); drag.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
          {valid && crop && size && <div className="pointer-events-none absolute border-2 border-red-500 bg-red-500/15" style={{
            left: `${crop.x / size.width * 100}%`, top: `${crop.y / size.height * 100}%`,
            width: `${crop.width / size.width * 100}%`, height: `${crop.height / size.height * 100}%`,
          }} />}
        </div>
        {size && <p className="text-sm">Original image: {size.width} × {size.height} pixels.</p>}
        <form className="space-y-4 rounded border border-blue-500/60 p-4" onSubmit={(event) => {
          event.preventDefault();
          if (!valid || !crop || !answer.trim() || !Number.isSafeInteger(order) || order < 1) { setMessage("Enter a valid crop, answer, and positive integer order."); return; }
          if (mappings.some((item) => item.exerciseNumber === exerciseNumber && item.sequenceOrder === order)) { setMessage("This exercise already has that sequence order. Choose another order or remove the previous region."); return; }
          setMappings((current) => [...current, { id: `steno-${exerciseNumber}-crop-${crypto.randomUUID()}`, exerciseNumber, answer: answer.trim(), crop: { ...crop }, sequenceOrder: order, verification: "pending" }]);
          setOrder(order + 1); setAnswer(""); setCrop(null); setMessage("Added pending region.");
        }}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["x", "y", "width", "height"] as const).map((key) => <label key={key} className="flex flex-col gap-1">{key} (source pixels)
              <input className={field} type="number" min={key === "x" || key === "y" ? 0 : 1} step="1" required value={crop && Number.isFinite(crop[key]) ? crop[key] : ""}
                onChange={(event) => setCrop({ ...(crop ?? { x: 0, y: 0, width: 0, height: 0 }), [key]: event.target.value === "" ? NaN : Number(event.target.value) })} />
            </label>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">English word or connected phrase<input className={field} required value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>
            <label className="flex flex-col gap-1">Sequence order within exercise<input className={field} type="number" min="1" step="1" required value={Number.isFinite(order) ? order : ""} onChange={(event) => setOrder(Number(event.target.value))} /></label>
          </div>
          <p className="text-sm">{valid ? "Rectangle is inside the source image. This does not verify its transcription." : "Select or enter a nonempty rectangle inside the source image."}</p>
          {valid && <figure><canvas ref={previewRef} className="h-auto max-w-full bg-white" style={{ width: Math.min(350, crop!.width) }} aria-label="Preview of selected shorthand crop" /><figcaption className="mt-2">Selected source region</figcaption></figure>}
          <button className={button} type="submit">Add pending region</button>
        </form>
        <h2 className="text-xl">Saved regions — Exercise {exerciseNumber}</h2>
        <ul className="space-y-2">{mappings.filter((item) => item.exerciseNumber === exerciseNumber).sort((a, b) => a.sequenceOrder - b.sequenceOrder).map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-600 p-3">
          <span>{item.sequenceOrder}. {item.answer} — ({item.crop.x}, {item.crop.y}, {item.crop.width}, {item.crop.height}) — pending</span>
          <button className={button} onClick={() => setMappings((current) => current.filter((entry) => entry.id !== item.id))}>Remove region</button>
        </li>)}</ul>
        <div className="flex flex-wrap gap-3"><button className={button} disabled={!mappings.length} onClick={() => exportData(false)}>Copy TypeScript ({mappings.length} regions)</button><button className={button} disabled={!mappings.length} onClick={() => exportData(true)}>Download JSON</button></div>
        <p role="status" className="text-sky-200">{message}</p>
      </div>
    </main>
  );
}
