export type ClassroomStanding = {
  userId: number;
  username: string;
  displayName: string;
  score: number;
  wpm: number;
  accuracy: number;
  lives: number;
  completedWords: number;
  finished: boolean;
  rank?: number;
  connected?: boolean;
};

export type ClassroomRankUpdate = ClassroomStanding & {
  totalStudents: number;
  maxStudents: number;
};
