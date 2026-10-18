import "dotenv/config";
import { initializeDatabase, closeDatabase } from "../src/db.js";

try {
  if (process.env.DATABASE_PROVIDER?.trim().toLowerCase() !== "postgres") {
    throw new Error("Set DATABASE_PROVIDER=postgres in server/.env for this online connection check.");
  }
  const db = await initializeDatabase();
  const row = await db.get("SELECT version FROM public.typetiles_schema_migrations WHERE version = ?", "20261018000100");
  if (!row) throw new Error("The Type Tiles initial migration is missing.");
  console.log("PostgreSQL connection and Type Tiles migration confirmed. No records were changed.");
} catch (error) {
  // Do not dump connection objects, URLs or user-supplied credentials.
  const code = (error as { code?: string }).code;
  const known: Record<string, string> = {
    ENOENT: "Certificate file not found. Set DATABASE_SSL_CA_FILE to the certificate's actual filename, relative to the server folder.",
    ERR_OSSL_PEM_NO_START_LINE: "The certificate file is not a valid PEM certificate. Download the database root certificate again.",
    CERT_HAS_EXPIRED: "The database TLS certificate has expired. Check the certificate and system clock.",
    ENOTFOUND: "Database host could not be resolved. Check the connection URI.",
    ECONNREFUSED: "Database host refused the connection.",
    ETIMEDOUT: "Database connection timed out.",
    "28P01": "Database login failed. Check the username and URL-encoded database password.",
    "3D000": "The database name in DATABASE_URL does not exist.",
    SELF_SIGNED_CERT_IN_CHAIN: "TLS verification failed. Download the Supabase root certificate and set DATABASE_SSL_CA_FILE.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "TLS verification failed. Set DATABASE_SSL_CA_FILE to the approved root certificate.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS verification failed. Set DATABASE_SSL_CA_FILE to the approved root certificate.",
  };
  const message = error instanceof Error ? error.message : "";
  const fallback = /timeout|timed out/i.test(message)
    ? "Database connection timed out before a usable session was established. Check the Supabase project status, Session pooler endpoint, and network/VPN access."
    : message.startsWith("Apply the Type Tiles initial migration")
      ? "Database connection succeeded, but the Type Tiles migration could not be confirmed. Check the selected Supabase project and migration."
      : "Database check failed. Verify DATABASE_PROVIDER, DATABASE_URL, TLS certificate, and the initial migration.";
  console.error(code && known[code] ? known[code] : fallback);
  process.exitCode = 1;
} finally { await closeDatabase(); }
