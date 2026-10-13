import type { StenoExercise } from "./stenoExercises";

export type GreggCropRectangle = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type GreggCropMapping = {
  readonly id: string;
  readonly exerciseNumber: StenoExercise["exerciseNumber"];
  readonly answer: string;
  readonly crop: GreggCropRectangle;
  readonly sequenceOrder: number;
  readonly verification: "pending" | "verified";
  // Keep reference-only punctuation records without making them typing targets.
  readonly playable?: boolean;
};

// No word/phrase outlines have been verified. Geometry alone does not verify an answer.
export const GREGG_CROP_MAPPINGS: readonly GreggCropMapping[] = Object.freeze([]);

/** Coordinates are integer pixels relative to the unmodified source PNG. */
export function isValidGreggCrop(crop: GreggCropRectangle, sourceWidth: number, sourceHeight: number): boolean {
  return [sourceWidth, sourceHeight, crop.x, crop.y, crop.width, crop.height].every(Number.isSafeInteger)
    && sourceWidth > 0 && sourceHeight > 0
    && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
    && crop.x <= sourceWidth - crop.width && crop.y <= sourceHeight - crop.height;
}
