import { Pool, types, type PoolConfig } from "pg";
import fs from "fs";
import type { ApplicationDatabase, DatabasePool, DatabaseQueryResult } from "./databaseTypes.js";

const ID_TABLES = new Set([
  "users", "email_verification_codes", "password_reset_codes", "user_stats",
  "matches", "match_participants", "match_results", "admin_logs", "feedback",
]);

// Routes use positional ? parameters for both providers. Leave quoted values,
// identifiers, comments and dollar-quoted strings untouched.
export function postgresQuery(sql: string): string {
  let result = "";
  let parameter = 0;
  let quote = "";
  let dollar = "";
  let commentDepth = 0;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i], next = sql[i + 1];
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        result += dollar; i += dollar.length - 1; dollar = "";
      } else result += char;
    } else if (commentDepth) {
      result += char;
      if (char === "/" && next === "*") { result += next; i++; commentDepth++; }
      else if (char === "*" && next === "/") { result += next; i++; commentDepth--; }
    } else if (quote) {
      result += char;
      if (char === quote) {
        if (next === quote) { result += next; i++; }
        else quote = "";
      }
    } else if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      if (end < 0) { result += sql.slice(i); break; }
      result += sql.slice(i, end + 1); i = end;
    } else if (char === "/" && next === "*") {
      result += "/*"; i++; commentDepth = 1;
    } else if (char === "'" || char === '"') {
      quote = char; result += char;
    } else if (char === "$" && /^(\$\$|\$[A-Za-z_][A-Za-z_0-9]*\$)/.test(sql.slice(i))) {
      dollar = /^(\$\$|\$[A-Za-z_][A-Za-z_0-9]*\$)/.exec(sql.slice(i))![0];
      result += dollar; i += dollar.length - 1;
    } else result += char === "?" ? `$${++parameter}` : char;
  }
  return result;
}

function parameters(params: any[]): any[] {
  return params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
}

export class PostgresDatabase implements ApplicationDatabase {
  constructor(private readonly execute: (sql: string, values?: any[]) => Promise<DatabaseQueryResult>,
    private readonly dispose: () => Promise<void> = async () => {}) {}

  async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    return (await this.execute(postgresQuery(sql), parameters(params))).rows[0] as T | undefined;
  }

  async all<T = any[]>(sql: string, ...params: any[]): Promise<T> {
    return (await this.execute(postgresQuery(sql), parameters(params))).rows as T;
  }

  async run(sql: string, ...params: any[]): Promise<{ lastID?: number; changes?: number }> {
    let query = postgresQuery(sql).trim().replace(/;$/, "");
    const table = /^INSERT\s+INTO\s+(?:public\.)?([a-z_]+)/i.exec(query)?.[1]?.toLowerCase();
    // Rate-limit upserts have a text key, not an identity column.
    if (table && ID_TABLES.has(table) && !/\bRETURNING\b/i.test(query)) query += " RETURNING id";
    const result = await this.execute(query, parameters(params));
    return { changes: result.rowCount ?? 0, lastID: result.rows[0]?.id };
  }

  async exec(sql: string): Promise<void> { await this.execute(sql); }
  async close(): Promise<void> { await this.dispose(); }
}

export function postgresConfig(env = process.env): PoolConfig {
  let url: URL;
  try { url = new URL(env.DATABASE_URL?.trim() || ""); }
  catch { throw new Error("Set DATABASE_URL to a PostgreSQL connection URI (not a psql command)."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username
    || /\[YOUR-|YOUR_PASSWORD|YOUR-PASSWORD/.test(url.toString())) {
    throw new Error("DATABASE_URL must be a complete PostgreSQL connection URI without placeholders.");
  }
  const poolSize = Number(env.DATABASE_POOL_MAX || 5);
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 20) {
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 20.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Own the SSL options in one place; URI sslmode can otherwise replace them.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    if (url.searchParams.has(key)) {
      if (key !== "sslmode" || !["require", "verify-ca", "verify-full"].includes(url.searchParams.get(key)!)) {
        throw new Error("Configure TLS with DATABASE_SSL_CA_FILE; use sslmode=require or verify-full only.");
      }
      url.searchParams.delete(key);
    }
  }
  const ssl = local ? false : {
    rejectUnauthorized: true,
    ...(env.DATABASE_SSL_CA_FILE ? { ca: fs.readFileSync(env.DATABASE_SSL_CA_FILE, "utf8") } : {}),
  };
  return {
    connectionString: url.toString(), ssl, max: poolSize,
    connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
    statement_timeout: 20_000,
    // Preserve numeric counts/ranks/epoch values expected by the existing API.
    // Scope parsers to this pool, without changing pg's global type registry.
    types: { getTypeParser(oid: number, format?: "text" | "binary") {
      if (format !== "binary" && oid === 20) return (value: string) => {
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error("Database integer exceeds the supported safe range.");
        return number;
      };
      if (format !== "binary" && oid === 1184) return (value: string) => new Date(value).toISOString();
      return types.getTypeParser(oid, format);
    } },
  };
}

export function createPostgresPool(): DatabasePool {
  const pool = new Pool(postgresConfig());
  pool.on("error", () => console.error("An idle PostgreSQL connection failed; the pool will replace it."));
  return pool;
}

export async function postgresTransaction<T>(pool: DatabasePool,
  work: (db: ApplicationDatabase) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      // Preserve SQLite BEGIN IMMEDIATE's serialized auth read/modify/write
      // behavior, including quotas and single-use codes, across server instances.
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("SELECT pg_advisory_xact_lock(548911, 2)");
      const result = await work(new PostgresDatabase((sql, values) => client.query(sql, values)));
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  } finally { client.release(); }
}
