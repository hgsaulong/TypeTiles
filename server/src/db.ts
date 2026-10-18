import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import type { ApplicationDatabase, DatabasePool } from "./databaseTypes.js";
import { createPostgresPool, PostgresDatabase, postgresTransaction } from "./postgresDatabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: ApplicationDatabase | null = null;
let postgresPool: DatabasePool | null = null;

export async function initializeDatabase(options: { postgresPool?: DatabasePool } = {}): Promise<ApplicationDatabase> {
  if (db) return db;

  const provider = options.postgresPool ? "postgres" : (process.env.DATABASE_PROVIDER || "sqlite").trim().toLowerCase();
  if (provider !== "sqlite" && provider !== "postgres") throw new Error("DATABASE_PROVIDER must be sqlite or postgres.");
  if (provider === "postgres") {
    const pool = options.postgresPool || createPostgresPool();
    try {
      const database = new PostgresDatabase((sql, values) => pool.query(sql, values), () => pool.end());
      await database.get("SELECT 1 AS connected");
      let version;
      try {
        version = await database.get("SELECT version FROM public.typetiles_schema_migrations WHERE version = ?", "20261018000100");
      } catch { throw new Error("Apply the Type Tiles initial migration in Supabase before starting the backend."); }
      if (!version) throw new Error("Apply the Type Tiles initial migration in Supabase before starting the backend.");
      postgresPool = pool;
      db = database;
      return database;
    } catch (error) { await pool.end(); throw error; }
  }

  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "typetiles.db");

  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const database = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await database.exec("PRAGMA foreign_keys = ON");
  await database.exec("PRAGMA busy_timeout = 5000");
  await database.exec("PRAGMA journal_mode = WAL");

  // Create tables
  await createTables(database);

  db = database;
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
  const participantColumns = await db.all<{ name: string }[]>("PRAGMA table_info(match_participants)");
  const participantMigrations = [
    ["completed_words", "INTEGER DEFAULT 0"],
    ["error_rate", "REAL DEFAULT 0.0"],
    ["end_reason", "TEXT"],
    ["remaining_lives", "INTEGER DEFAULT 0"],
  ] as const;
  for (const [name, definition] of participantMigrations) {
    if (!participantColumns.some((column) => column.name === name)) {
      await db.exec(`ALTER TABLE match_participants ADD COLUMN ${name} ${definition}`);
    }
    const matchColumns = await db.all<{ name: string }[]>("PRAGMA table_info(matches)");
    if (!matchColumns.some((column) => column.name === "background")) {
      await db.exec("ALTER TABLE matches ADD COLUMN background TEXT DEFAULT 'blues'");
    }
  }

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

export function getDatabase(): ApplicationDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return db;
}

export async function closeDatabase() {
  if (db) {
    await db.close();
    db = null;
    postgresPool = null;
  }
}

// A dedicated connection/client owns every authentication transaction.
export async function databaseTransaction<T>(work: (database: ApplicationDatabase) => Promise<T>): Promise<T> {
  const database = getDatabase();
  if (postgresPool) return postgresTransaction(postgresPool, work);
  const file = await database.get<{ file: string }>("SELECT file FROM pragma_database_list WHERE name = 'main'");
  if (!file?.file) throw new Error("Authentication requires a file-backed SQLite database.");
  const connection = await open({ filename: file.file, driver: sqlite3.Database });
  try {
    await connection.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
    try {
      const result = await work(connection);
      await connection.exec("COMMIT");
      return result;
    } catch (error) { await connection.exec("ROLLBACK"); throw error; }
  } finally { await connection.close(); }
}
