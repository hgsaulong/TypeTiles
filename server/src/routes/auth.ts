import { Router, Request, Response } from "express";
import { getDatabase } from "../db.js";
import { verifyPassword, generateToken, normalizeRole } from "../auth.js";
import { authMiddleware } from "../middleware.js";
import { createPasswordResetRouter } from "./passwordReset.js";
import { EmailVerificationService, RegistrationError } from "../emailVerification.js";
import { createEmailVerificationRouter } from "./emailVerification.js";

export function createAuthRouter(verification = new EmailVerificationService()) {
const router = Router();
router.use(createPasswordResetRouter());
router.use(createEmailVerificationRouter(verification));

interface RegisterBody {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

interface LoginBody {
  username: string;
  password: string;
}

interface ProfileUpdateBody {
  displayName?: string;
  avatar?: string;
  background?: string;
}

const AVATAR_IDS = new Set(["hani", "helen", "jacq", "kyla", "liscano"]);
const CUSTOM_AVATAR_PATTERN = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+=*$/i;
const BACKGROUND_IDS = new Set(["blues", "volts", "office", "city"]);

// Register: pending account only; verification never creates a session.
router.post("/register", async (req: Request<{}, {}, RegisterBody>, res: Response) => {
  res.set("Cache-Control", "no-store");
  try {
    await verification.register(req.body, req.ip || "unknown");
    return res.status(201).json({ message: "Account created. Verify your email before logging in.", verificationRequired: true });
  } catch (error) {
    if (error instanceof RegistrationError) return res.status(error.status).json({ error: error.message });
    console.warn("Registration could not be completed.");
    return res.status(503).json({ error: "Registration is temporarily unavailable." });
  }
});

// Login
router.post("/login", async (req: Request<{}, {}, LoginBody>, res: Response) => {
  try {
    const { username, password } = req.body ?? {};

    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ error: "Missing username or password" });
    }

    const db = getDatabase();

    const user = await db.get(
      `SELECT id, username, email, password_hash, display_name, avatar, background, tier, role, is_banned, session_version, email_verified FROM users WHERE username = ?`,
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: "This account has been banned" });
    }

    const passwordValid = await verifyPassword(password, user.password_hash);

    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (user.email_verified !== 1) {
      return res.status(403).json({ error: "Verify your email before logging in.", code: "EMAIL_VERIFICATION_REQUIRED" });
    }

    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: normalizeRole(user.role),
      sessionVersion: user.session_version,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatar: user.avatar,
        background: user.background,
        tier: user.tier,
        role: normalizeRole(user.role),
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const user = await db.get(
      `SELECT id, username, email, display_name, avatar, background, tier, role FROM users WHERE id = ?`,
      [req.user!.userId]
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const stats = await db.get(`SELECT * FROM user_stats WHERE user_id = ?`, [user.id]);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatar: user.avatar,
        background: user.background,
        tier: user.tier,
        role: normalizeRole(user.role),
      },
      stats,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/me/profile", authMiddleware, async (req: Request<{}, {}, ProfileUpdateBody>, res: Response) => {
  try {
    const displayName = req.body.displayName?.trim();
    const avatar = req.body.avatar;
    const background = req.body.background;
    if (displayName !== undefined && !displayName) {
      return res.status(400).json({ error: "Display name is required" });
    }

    if (avatar !== undefined && (!AVATAR_IDS.has(avatar) && (!CUSTOM_AVATAR_PATTERN.test(avatar) || avatar.length > 2_000_000))) {
      return res.status(400).json({ error: "Invalid avatar" });
    }

    if (background !== undefined && !BACKGROUND_IDS.has(background)) {
      return res.status(400).json({ error: "Invalid background" });
    }

    if (displayName === undefined && avatar === undefined && background === undefined) {
      return res.status(400).json({ error: "No profile changes supplied" });
    }

    const db = getDatabase();
    const updates: string[] = [];
    const values: (string | number)[] = [];
    if (displayName !== undefined) {
      updates.push("display_name = ?");
      values.push(displayName);
    }
    if (avatar !== undefined) {
      updates.push("avatar = ?");
      values.push(avatar);
    }
    if (background !== undefined) {
      updates.push("background = ?");
      values.push(background);
    }
    updates.push("updated_at = CURRENT_TIMESTAMP");
    values.push(req.user!.userId);
    await db.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values);

    const user = await db.get(
      "SELECT id, username, email, display_name, avatar, background, tier, role FROM users WHERE id = ?",
      [req.user!.userId],
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatar: user.avatar,
        background: user.background,
        tier: user.tier,
        role: normalizeRole(user.role),
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

return router;
}

export default createAuthRouter();
