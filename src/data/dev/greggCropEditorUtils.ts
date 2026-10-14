import { isValidGreggCrop, type GreggCropMapping, type GreggCropRectangle } from "../greggCropMappings";

export type ImageSize = { width: number; height: number };
export type PixelPoint = { x: number; y: number };

export function sourcePoint(clientX: number, clientY: number,
  bounds: { left: number; top: number; width: number; height: number }, source: ImageSize): PixelPoint | null {
  if (![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height, source.width, source.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || source.width <= 0 || source.height <= 0) return null;
  return {
    x: Math.round(Math.max(0, Math.min(source.width, (clientX - bounds.left) * source.width / bounds.width))),
    y: Math.round(Math.max(0, Math.min(source.height, (clientY - bounds.top) * source.height / bounds.height))),
  };
}

export function rectangleBetween(a: PixelPoint, b: PixelPoint): GreggCropRectangle {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function exportPendingMappings(mappings: readonly GreggCropMapping[], sizes: Readonly<Record<number, ImageSize>>): string {
  const ids = new Set<string>();
  const positions = new Set<string>();
  const pending = [...mappings].sort((a, b) => a.exerciseNumber - b.exerciseNumber || a.sequenceOrder - b.sequenceOrder)
    .map((mapping) => {
      const size = sizes[mapping.exerciseNumber];
      const position = `${mapping.exerciseNumber}:${mapping.sequenceOrder}`;
      if (!size || !isValidGreggCrop(mapping.crop, size.width, size.height) || !mapping.answer.trim()
        || !mapping.id || ids.has(mapping.id) || positions.has(position)
        || !Number.isSafeInteger(mapping.sequenceOrder) || mapping.sequenceOrder < 1) throw new Error("Check crop bounds, answers, and unique sequence orders before exporting.");
      ids.add(mapping.id);
      positions.add(position);
      return { ...mapping, answer: mapping.answer.trim(), verification: "pending" as const };
    });
  return JSON.stringify(pending, null, 2);
}
