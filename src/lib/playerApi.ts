const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  `http://${window.location.hostname}:3001/api`;
export const PLAYER_TOKEN_KEY = "player_token";

export type PlayerUser = {
  id: number;
  username: string;
  email: string;
  displayName: string;
  avatar?: string;
  background?: string;
  tier: string;
  role: "student" | "teacher" | "admin";
};

export type PlayerStats = {
  games_played: number;
  wins: number;
  losses: number;
  total_score: number;
  best_wpm: number;
  avg_accuracy: number;
  top_combo: number;
};

export type MatchHistoryRow = {
  id: number;
  mode: string;
  difficulty: string;
  round_time: number;
  word_set: string;
  status: string;
  created_at: string;
  score: number;
  wpm: number;
  accuracy: number;
  error_rate: number;
  completed_words: number;
  end_reason: "time" | "health" | null;
  remaining_lives: number;
  position: number | null;
};

export type TeacherSession = {
  id: number;
  mode: string;
  difficulty: string;
  round_time: number;
  word_set: string;
  status: string;
  created_at: string;
  participant_count: number;
};

export type TeacherParticipant = {
  user_id: number;
  display_name: string;
  username: string;
  avatar?: string;
  score: number;
  wpm: number;
  accuracy: number;
  error_rate: number;
  completed_words: number;
  end_reason: "time" | "health" | null;
  remaining_lives: number;
  position: number | null;
  participant_status: string;
};

export type TeacherMatchDetails = {
  match: TeacherSession;
  participants: TeacherParticipant[];
};

export type LeaderboardRow = {
  id: number;
  username: string;
  display_name: string;
  tier: string;
  total_score: number;
  games_played: number;
  best_wpm: number;
  avg_accuracy: number;
  top_combo?: number;
  rank?: number;
};

export type CreateMatchInput = {
  mode: string;
  difficulty: string;
  roundTime: number;
  wordSet: string;
};

export type CreateMatchResponse = CreateMatchInput & {
  matchId: number;
  status: string;
};

export type SubmitMatchResultInput = {
  matchId: number;
  score: number;
  wpm: number;
  accuracy: number;
  errorRate: number;
  completedWords: number;
  endReason: "time" | "health";
  remainingLives: number;
}

type AuthResponse = {
  token: string;
  user: PlayerUser;
};

export type RegistrationResponse = { message: string; verificationRequired: true };

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type MeResponse = {
  user: PlayerUser;
  stats?: PlayerStats;
};

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(typeof data.error === "string" ? data.error : "Request failed", response.status, typeof data.code === "string" ? data.code : undefined);
  }

  return data;
}

export function registerPlayer(input: {
  username: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<RegistrationResponse> {
  return request<RegistrationResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function loginPlayer(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function requestPasswordReset(email: string, signal?: AbortSignal): Promise<{ message: string }> {
  return request("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }), signal });
}

export function resendEmailVerificationCode(email: string, signal?: AbortSignal): Promise<{ message: string }> {
  return request("/auth/resend-verification-code", { method: "POST", body: JSON.stringify({ email }), signal });
}

export function verifyEmail(email: string, code: string, signal?: AbortSignal): Promise<{ message: string }> {
  return request("/auth/verify-email", { method: "POST", body: JSON.stringify({ email, code }), signal });
}

export function verifyResetCode(email: string, code: string, signal?: AbortSignal): Promise<{ valid: boolean }> {
  return request("/auth/verify-reset-code", { method: "POST", body: JSON.stringify({ email, code }), signal });
}

export function resetPlayerPassword(email: string, code: string, newPassword: string, signal?: AbortSignal): Promise<{ message: string }> {
  return request("/auth/reset-password", { method: "POST", body: JSON.stringify({ email, code, newPassword }), signal });
}

export function getCurrentPlayer(token: string): Promise<MeResponse> {
  return request<MeResponse>("/auth/me", {}, token);
}

export function updatePlayerProfile(input: { displayName?: string; avatar?: string; background?: string }): Promise<{ user: PlayerUser }> {
  return authenticatedRequest<{ user: PlayerUser }>("/auth/me/profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function submitFeedback(message: string): Promise<{ message: string }> {
  return authenticatedRequest<{ message: string }>("/feedback", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function createPlayerMatch(input: CreateMatchInput): Promise<CreateMatchResponse> {
  return authenticatedRequest<CreateMatchResponse>("/matches", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitPlayerMatchResult(input: SubmitMatchResultInput): Promise<unknown> {
  return authenticatedRequest<unknown>(`/matches/${input.matchId}/submit`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getPlayerHistory(): Promise<{ history: MatchHistoryRow[] }> {
  return authenticatedRequest<{ history: MatchHistoryRow[] }>("/users/history");
}

export function getPlayerRank(): Promise<{ rank: number; stats: PlayerStats }> {
  return authenticatedRequest<{ rank: number; stats: PlayerStats }>("/users/me/rank");
}

export function getTeacherSessions(): Promise<{ sessions: TeacherSession[] }> {
  return authenticatedRequest<{ sessions: TeacherSession[] }>("/teacher/matches");
}

export function getTeacherMatchDetails(matchId: number): Promise<TeacherMatchDetails> {
  return authenticatedRequest<TeacherMatchDetails>(`/teacher/matches/${matchId}`);
}

export function getLeaderboard(tier?: string): Promise<{ leaderboard: LeaderboardRow[]; tier?: string }> {
  const path = tier ? `/leaderboard/tier/${encodeURIComponent(tier)}` : "/leaderboard";
  return request<{ leaderboard: LeaderboardRow[]; tier?: string }>(path);
}

export async function authenticatedRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(PLAYER_TOKEN_KEY);
  if (!token) {
    throw new Error("Authentication required");
  }

  return request<T>(path, options, token);
}
