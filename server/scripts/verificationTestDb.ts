import { config } from "dotenv";
import { existsSync, realpathSync, statSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { initializeDatabase, closeDatabase } from "../src/db.js";

const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const dataDirectory = path.join(serverDirectory, "data");
const testPath = path.join(dataDirectory, "typetiles-verification-test.db");
const normalPath = path.join(dataDirectory, "typetiles.db");
const initializing = process.argv.length === 3 && process.argv[2] === "--init";

function confirmPath() {
  if (process.env.DATABASE_PATH !== testPath) throw new Error("Test database configuration could not be confirmed.");
  const expected = path.join(realpathSync(dataDirectory), "typetiles-verification-test.db");
  if (!existsSync(testPath) || realpathSync(testPath) !== expected || !statSync(testPath).isFile() || statSync(testPath).nlink !== 1) {
    throw new Error("Test database must be a regular isolated file, not a link.");
  }
  if (existsSync(normalPath) && realpathSync(normalPath) === realpathSync(testPath)) throw new Error("Refusing the normal database path.");
}

async function checkPort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => reject(new Error(error.code === "EADDRINUSE"
      ? "Backend port is occupied. Stop the existing backend before starting verification-test mode."
      : "Backend port availability could not be confirmed.")));
    probe.listen(port, "0.0.0.0", () => probe.close(() => resolve()));
  });
}

async function main() {
  if (process.argv.length > (initializing ? 3 : 2)) throw new Error("Only --init is supported; database path overrides are not accepted.");
  if (!existsSync(dataDirectory)) throw new Error("Expected backend data directory is missing.");
  process.chdir(serverDirectory);
  config({ path: path.join(serverDirectory, ".env") });
  // Never inherit the online provider from the regular .env in this SQLite tool.
  process.env.DATABASE_PROVIDER = "sqlite";
  // Absolute Windows-safe path, configured in this process only. dotenv cannot replace it.
  process.env.DATABASE_PATH = testPath;

  if (initializing) {
    // Exclusive creation: never truncate, reset, or migrate a pre-existing file during setup.
    const descriptor = openSync(testPath, "wx");
    closeSync(descriptor);
  } else {
    if (!existsSync(testPath)) throw new Error("Initialize the isolated file first with npm run db:verification-test:init.");
    const port = Number(process.env.PORT || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Configure a valid backend PORT.");
    await checkPort(port);
  }
  confirmPath();
  const db = await initializeDatabase();
  const actual = await db.get<{ file: string }>("SELECT file FROM pragma_database_list WHERE name='main'");
  if (!actual?.file || realpathSync(actual.file) !== realpathSync(testPath)) throw new Error("SQLite opened an unexpected database. Refusing to start.");
  console.log(`Verification-test database confirmed: ${testPath}`);
  if (initializing) {
    const tables = await db.all<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    for (const { name } of tables) {
      const row = await db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM "${name.replace(/"/g, '""')}"`);
      if (row?.count !== 0) throw new Error("New test database is not empty. No reset will be attempted.");
      console.log(`${name}: 0 rows`);
    }
    await closeDatabase();
    console.log("Isolated initialization complete. No accounts registered or emails sent.");
    return;
  }
  confirmPath();
  // Existing backend startup reuses the connection already checked above.
  await import("../src/index.js");
}

main().catch(async (error: unknown) => {
  await closeDatabase().catch(() => {});
  const safeMessages = [
    "Backend port is occupied. Stop the existing backend before starting verification-test mode.",
    "Backend port availability could not be confirmed.",
    "Test database configuration could not be confirmed.",
    "Test database must be a regular isolated file, not a link.",
    "Refusing the normal database path.",
    "Initialize the isolated file first with npm run db:verification-test:init.",
    "Configure a valid backend PORT.",
    "SQLite opened an unexpected database. Refusing to start.",
  ];
  if (error instanceof Error && safeMessages.includes(error.message)) console.error(error.message);
  console.error("Verification-test setup/start refused. Check that the isolated file exists, is not linked, and the backend port is free. Initialization refuses any existing file; it never resets it.");
  process.exitCode = 1;
});
