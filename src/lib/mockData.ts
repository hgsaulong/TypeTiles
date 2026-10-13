import type { PracticeFormat } from "../../server/src/sentenceBank";
export type GreggSubmode = PracticeFormat;

export type MatchConfig = {
  mode: string;
  difficulty: string;
  roundTime: number;
  wordSet: string;
  opponents: string[];
  greggSubmode?: GreggSubmode;
  practiceFormat?: PracticeFormat;
};

export type PlayerProfile = {
  displayName: string;
  rank: string;
  avatar: string;
  tier: string;
};

export const playerProfile: PlayerProfile = {
  displayName: "Operator Vela",
  rank: "Secure Operator IV",
  avatar: "VX",
  tier: "Volt",
};

export const playerStats = [
  { label: "Games", value: "124" },
  { label: "Best WPM", value: "148" },
  { label: "Avg Accuracy", value: "97.4%" },
  { label: "Top Combo", value: "38" },
  { label: "Tier", value: "Volt I" },
];

export const telemetryFeed = [
  { label: "Last Match", value: "+72 RP vs Nova-7" },
  { label: "Latency", value: "18 ms" },
  { label: "Streak", value: "6 wins" },
  { label: "Daily Challenge", value: "95% accuracy on hard set" },
];

export const matchHistory = [
  { date: "2026-07-27", mode: "Solo", wpm: 134, accuracy: 98.2, result: "Win" },
  { date: "2026-07-26", mode: "Duel", wpm: 122, accuracy: 95.9, result: "Win" },
  { date: "2026-07-25", mode: "Survival", wpm: 118, accuracy: 93.1, result: "Loss" },
  { date: "2026-07-24", mode: "Ranked", wpm: 141, accuracy: 97.8, result: "Win" },
  { date: "2026-07-23", mode: "Ranked", wpm: 126, accuracy: 96.4, result: "Win" },
];

export const mockOpponents = [
  { name: "Nova-7", status: "Ready", tier: "Volt II" },
  { name: "Cipher", status: "Waiting", tier: "Volt IV" },
  { name: "Orbit", status: "Disconnected", tier: "Unknown" },
];

export const mockRooms = [
  { code: "XR9Q", players: 3, mode: "Ranked", difficulty: "Hard" },
  { code: "A4LM", players: 2, mode: "Casual", difficulty: "Normal" },
];

export const mockWordPools = {
  easy: ["sync", "node", "trace", "ping", "grid"],
  hard: ["cryptic", "vector", "protocol", "stability", "autonomous"],
};

export const mockMatchConfig: MatchConfig = {
  mode: "Solo Practice",
  difficulty: "Normal",
  roundTime: 90,
  wordSet: "General",
  opponents: [],
};
