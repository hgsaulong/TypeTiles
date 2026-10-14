import type { GreggSubmode } from "./mockData";

// Full sentences need more time because players type spaces and punctuation too.
export const FULL_SENTENCE_SPEED_MULTIPLIER = 0.5;

export function canPreviewGreggCrops(): boolean {
  return import.meta.env.DEV
    && import.meta.env.VITE_DEV_GREGG_CATEGORY_CROPS !== "false"
    && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

export function resolveGreggSubmode(value: unknown): GreggSubmode {
  return value === "word-phrase" && canPreviewGreggCrops() ? "word-phrase" : "full-sentence";
}

export function greggSubmodeLabel(mode: GreggSubmode): string {
  return mode === "word-phrase" ? "Word / Phrase" : "Full Sentence";
}
