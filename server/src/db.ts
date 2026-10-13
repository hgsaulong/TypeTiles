import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database | null = null;

export async function initializeDatabase(): Promise<Database> {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "typetiles.db");

  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA foreign_keys = ON");
  await db.exec("PRAGMA busy_timeout = 5000");
  await db.exec("PRAGMA journal_mode = WAL");

  // Create tables
  await createTables(db);

  return db;
}

async function createTables(db: Database) {
  // Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar TEXT,
      tier TEXT DEFAULT 'Volt',
      role TEXT DEFAULT 'player',
      is_banned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const userColumns = await db.all<{ name: string }[]>("PRAGMA table_info(users)");
  if (!userColumns.some((column) => column.name === "background")) {
    await db.exec("ALTER TABLE users ADD COLUMN background TEXT");
  }
  if (!userColumns.some((column) => column.name === "session_version")) {
    await db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }
  // Recheck under a write lock: only the first successful migration accepts legacy rows.
  await db.exec("BEGIN IMMEDIATE");
  try {
    const columns = await db.all<{ name: string }[]>("PRAGMA table_info(users)");
    const firstMigration = !columns.some((column) => column.name === "email_verified");
    if (firstMigration) await db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    if (!columns.some((column) => column.name === "email_verified_at")) {
      await db.exec("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
    }
    if (firstMigration) await db.exec("UPDATE users SET email_verified = 1, email_verified_at = NULL");
    await db.exec(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS email_verification_user_created ON email_verification_codes(user_id, created_at);
      CREATE TABLE IF NOT EXISTS email_verification_rate_limits (
        key TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        last_request INTEGER NOT NULL
      );
    `);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS password_reset_user_created ON password_reset_codes(user_id, created_at);
    CREATE TABLE IF NOT EXISTS password_reset_rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      last_request INTEGER NOT NULL
    );
  `);

  // User stats table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      games_played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      total_score INTEGER DEFAULT 0,
      best_wpm INTEGER DEFAULT 0,
      avg_accuracy REAL DEFAULT 0.0,
      top_combo INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Matches table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      round_time INTEGER DEFAULT 90,
      word_set TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    )
  `);

  // Additive migration: existing matches and LAN defaults retain word gameplay.
  const matchColumns = await db.all<{ name: string }[]>("PRAGMA table_info(matches)");
  if (!matchColumns.some((column) => column.name === "practice_format")) {
    await db.exec("ALTER TABLE matches ADD COLUMN practice_format TEXT NOT NULL DEFAULT 'word-phrase'");
  }

  // Match participants table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS match_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      score INTEGER DEFAULT 0,
      wpm INTEGER DEFAULT 0,
      accuracy REAL DEFAULT 0.0,
      position INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Match results/history table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS match_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      result TEXT NOT NULL,
      rank_change INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Admin logs table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  console.log("✓ Database tables initialized");
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return db;
}

export async function closeDatabase() {
  if (db) {
    await db.close();
    db = null;
  }
}
