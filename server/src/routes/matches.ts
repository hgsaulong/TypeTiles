import { Router, Request, Response } from "express";
import { getDatabase } from "../db.js";
import { authMiddleware } from "../middleware.js";
import { getCategorySentences, type PracticeFormat } from "../sentenceBank.js";

const router = Router();

interface CreateMatchBody {
  mode: string;
  difficulty: string;
  roundTime: number;
  wordSet: string;
  opponents?: number[];
  practiceFormat?: PracticeFormat;
}

interface SubmitScoreBody {
  matchId: number;
  score: number;
  wpm: number;
  accuracy: number;
}

// Create match
router.post("/matches", authMiddleware, async (req: Request<{}, {}, CreateMatchBody>, res: Response) => {
  try {
    const { mode, difficulty, roundTime, wordSet } = req.body;
    const practiceFormat = req.body.practiceFormat ?? "word-phrase";

    if (!mode || !difficulty || !wordSet) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (practiceFormat !== "word-phrase" && practiceFormat !== "full-sentence") {
      return res.status(400).json({ error: "Invalid practice format" });
    }
    if (practiceFormat === "full-sentence" && (mode !== "Solo Practice" || getCategorySentences(wordSet).length === 0)) {
      return res.status(400).json({ error: "Sentence practice requires a supported Solo category" });
    }

    const db = getDatabase();

    const result = await db.run(
      `INSERT INTO matches (mode, difficulty, round_time, word_set, status, practice_format) VALUES (?, ?, ?, ?, ?, ?)`,
      [mode, difficulty, roundTime || 90, wordSet, "active", practiceFormat]
    );

    const matchId = result.lastID;

    // Add creator as participant
    await db.run(
      `INSERT INTO match_participants (match_id, user_id) VALUES (?, ?)`,
      [matchId, req.user!.userId]
    );

    res.status(201).json({
      matchId,
      mode,
      difficulty,
      roundTime: roundTime || 90,
      wordSet,
      status: "active",
      practiceFormat,
    });
  } catch (error) {
    console.error("Create match error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Join match
router.post("/matches/:matchId/join", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const db = getDatabase();

    const match = await db.get(`SELECT * FROM matches WHERE id = ? AND status = 'active'`, [matchId]);

    if (!match) {
      return res.status(404).json({ error: "Match not found or already finished" });
    }

    // Check if user already joined
    const existing = await db.get(
      `SELECT id FROM match_participants WHERE match_id = ? AND user_id = ?`,
      [matchId, req.user!.userId]
    );

    if (existing) {
      return res.status(409).json({ error: "Already joined this match" });
    }

    await db.run(
      `INSERT INTO match_participants (match_id, user_id) VALUES (?, ?)`,
      [matchId, req.user!.userId]
    );

    res.json({ message: "Joined match successfully" });
  } catch (error) {
    console.error("Join match error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Submit match score
router.post("/matches/:matchId/submit", authMiddleware, async (req: Request<{ matchId: string }, {}, SubmitScoreBody>, res: Response) => {
  try {
    const { matchId } = req.params;
    const { score, wpm, accuracy } = req.body;

    if (
      !Number.isInteger(Number(matchId)) ||
      !Number.isFinite(score) ||
      !Number.isFinite(wpm) ||
      !Number.isFinite(accuracy) ||
      wpm < 0 ||
      accuracy < 0 ||
      accuracy > 100
    ) {
      return res.status(400).json({ error: "Invalid score, wpm, or accuracy" });
    }

    const db = getDatabase();
    const match = await db.get("SELECT id FROM matches WHERE id = ?", [matchId]);
    const participant = await db.get(
      "SELECT id FROM match_participants WHERE match_id = ? AND user_id = ?",
      [matchId, req.user!.userId],
    );

    if (!match || !participant) {
      return res.status(404).json({ error: "Match participation not found" });
    }

    // Update participant score
    await db.run(
      `UPDATE match_participants SET score = ?, wpm = ?, accuracy = ? WHERE match_id = ? AND user_id = ?`,
      [score, wpm, accuracy, matchId, req.user!.userId]
    );

    // Update user stats
    const currentStats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, [req.user!.userId]);

    const newTotalScore = (currentStats.total_score || 0) + score;
    const newBestWpm = Math.max(currentStats.best_wpm || 0, wpm);
    const newTopCombo = Math.max(currentStats.top_combo || 0, 0); // You'd calculate this from game logic
    const completedGames = (currentStats.games_played || 0) + 1;
    const newAverageAccuracy = ((currentStats.avg_accuracy || 0) * (currentStats.games_played || 0) + accuracy) / completedGames;

    await db.run(
      `UPDATE user_stats SET 
        games_played = ?,
        total_score = ?, 
        best_wpm = ?, 
        top_combo = ?,
        avg_accuracy = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?`,
      [completedGames, newTotalScore, newBestWpm, newTopCombo, newAverageAccuracy, req.user!.userId]
    );

    res.json({
      message: "Score submitted successfully",
      updatedStats: {
        totalScore: newTotalScore,
        bestWpm: newBestWpm,
        avgAccuracy: newAverageAccuracy,
      },
    });
  } catch (error) {
    console.error("Submit score error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get match details
router.get("/matches/:matchId", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const db = getDatabase();

    const match = await db.get(`SELECT * FROM matches WHERE id = ?`, [matchId]);

    if (!match) {
      return res.status(404).json({ error: "Match not found" });
    }

    const participants = await db.all(
      `SELECT mp.*, u.username, u.display_name, u.tier 
       FROM match_participants mp
       JOIN users u ON mp.user_id = u.id
       WHERE mp.match_id = ?
       ORDER BY mp.score DESC`,
      [matchId]
    );

    res.json({
      ...match,
      participants,
    });
  } catch (error) {
    console.error("Get match error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user's match history
router.get("/users/history", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const history = await db.all(
      `SELECT m.*, mp.score, mp.wpm, mp.accuracy, mp.position
       FROM matches m
       JOIN match_participants mp ON m.id = mp.match_id
       WHERE mp.user_id = ?
         AND m.mode <> 'LAN Match'
         AND (mp.score <> 0 OR mp.wpm <> 0 OR mp.accuracy <> 0)
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [req.user!.userId]
    );

    res.json({ history });
  } catch (error) {
    console.error("Get history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
