export {
  DIFFICULTY_WORD_LENGTHS,
  GREGG_PROMPTS,
  WORD_BANK,
  WORD_CATEGORIES,
  getDifficultyKey,
  getWordCategory,
  getWordsForDifficulty,
} from "../server/src/wordBank";
export type { GreggPrompt, WordCategory } from "../server/src/wordBank";
export { SENTENCE_BANK, getSentencesForCategory } from "../server/src/sentenceBank";

import { GREGG_PROMPTS, WORD_BANK } from "../server/src/wordBank";

export const WORDS: string[] = Object.values(WORD_BANK).flat();

export function getGreggPrompt(answer: string) {
  return GREGG_PROMPTS.find((prompt) => prompt.answer === answer);
}
