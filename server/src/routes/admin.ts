import { Router, Request, Response } from "express";
import { getDatabase } from "../db.js";
import { authMiddleware, adminMiddleware } from "../middleware.js";

const router = Router();

// Apply both auth and admin middleware
router.use(authMiddleware, adminMiddleware);

// Ban user
router.post("/users/:userId/ban", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const db = getDatabase();

    await db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [userId]);

    await db.run(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)`,
      [req.user!.userId, "ban_user", userId, reason || "No reason provided"]
    );

    res.json({ message: "User banned successfully" });
  } catch (error) {
    console.error("Ban user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Unban user
router.post("/users/:userId/unban", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const db = getDatabase();

    await db.run(`UPDATE users SET is_banned = 0 WHERE id = ?`, [userId]);

    await db.run(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)`,
      [req.user!.userId, "unban_user", userId, ""]
    );

    res.json({ message: "User unbanned successfully" });
  } catch (error) {
    console.error("Unban user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all users (paginated)
router.get("/users", async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    const db = getDatabase();

    let query = `SELECT id, username, display_name, email, tier, role, is_banned, created_at FROM users`;
    let params: any[] = [];

    if (search) {
      query += ` WHERE lower(username) LIKE lower(?) OR lower(display_name) LIKE lower(?) OR lower(email) LIKE lower(?)`;
      const searchTerm = `%${search}%`;
      params = [searchTerm, searchTerm, searchTerm];
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const users = await db.all(query, params);
    const countResult = await db.get(`SELECT COUNT(*) as count FROM users`);

    res.json({
      users,
      total: countResult?.count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get dashboard stats
router.get("/dashboard/stats", async (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const totalUsers = await db.get(`SELECT COUNT(*) as count FROM users`);
    const totalMatches = await db.get(`SELECT COUNT(*) as count FROM matches`);
    const activePlayers = await db.get(
      `SELECT COUNT(DISTINCT user_id) as count FROM match_participants 
       WHERE match_id IN (SELECT id FROM matches WHERE status = 'active')`
    );
    const bannedUsers = await db.get(`SELECT COUNT(*) as count FROM users WHERE is_banned = 1`);

    const topPlayers = await db.all(
      `SELECT u.username, u.display_name, us.total_score, us.best_wpm, us.avg_accuracy
       FROM users u
       JOIN user_stats us ON u.id = us.user_id
       WHERE u.is_banned = 0
       ORDER BY us.total_score DESC
       LIMIT 10`
    );

    res.json({
      totalUsers: totalUsers?.count || 0,
      totalMatches: totalMatches?.count || 0,
      activePlayers: activePlayers?.count || 0,
      bannedUsers: bannedUsers?.count || 0,
      topPlayers,
    });
  } catch (error) {
    console.error("Get dashboard stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get admin logs
router.get("/logs", async (req: Request, res: Response) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const db = getDatabase();

    const logs = await db.all(
      `SELECT al.*, admin.username as admin_username, target.username as target_username
       FROM admin_logs al
       LEFT JOIN users admin ON al.admin_id = admin.id
       LEFT JOIN users target ON al.target_user_id = target.id
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({ logs });
  } catch (error) {
    console.error("Get logs error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update user tier
router.put("/users/:userId/tier", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { tier } = req.body;

    const validTiers = ["Volt", "Cipher", "Nova"];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: "Invalid tier" });
    }

    const db = getDatabase();

    await db.run(`UPDATE users SET tier = ? WHERE id = ?`, [tier, userId]);

    await db.run(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)`,
      [req.user!.userId, "update_tier", userId, `Updated to ${tier}`]
    );

    res.json({ message: "User tier updated successfully", tier });
  } catch (error) {
    console.error("Update tier error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Provision or revoke a teacher role. Public registration cannot assign this role.
router.put("/users/:userId/role", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (role !== "student" && role !== "teacher") {
      return res.status(400).json({ error: "Role must be student or teacher" });
    }

    const db = getDatabase();
    const user = await db.get("SELECT id FROM users WHERE id = ?", [userId]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await db.run("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [role, userId]);
    await db.run(
      "INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)",
      [req.user!.userId, "update_role", userId, `Updated to ${role}`],
    );

    res.json({ message: "User role updated successfully", role });
  } catch (error) {
    console.error("Update user role error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Reset user stats
router.post("/users/:userId/reset-stats", async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const db = getDatabase();

    await db.run(
      `UPDATE user_stats SET 
        games_played = 0, 
        wins = 0, 
        losses = 0, 
        total_score = 0, 
        best_wpm = 0, 
        avg_accuracy = 0.0, 
        top_combo = 0 
      WHERE user_id = ?`,
      [userId]
    );

    await db.run(
      `INSERT INTO admin_logs (admin_id, action, target_user_id, details) VALUES (?, ?, ?, ?)`,
      [req.user!.userId, "reset_stats", userId, ""]
    );

    res.json({ message: "User stats reset successfully" });
  } catch (error) {
    console.error("Reset stats error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
