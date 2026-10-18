# Create the online Type Tiles tables

This prepares an empty Supabase PostgreSQL database. It does not migrate SQLite
records, replace the local database, switch to Supabase Auth, or connect the
current SQLite backend to PostgreSQL.

1. Open https://supabase.com/dashboard and select your Type Tiles online project.
   If it already exists, do not create a second project.
2. Select **SQL Editor** in the left sidebar, then **New query** (or **+**).
3. Name the query **Type Tiles - Initial Tables**.
4. Open `supabase/migrations/20261018000100_initial_type_tiles.sql` in VS Code.
   Select all of its contents and copy them.
5. Paste the complete file into the Supabase query editor. It needs no passwords,
   API keys, or placeholder replacements.
6. Confirm you selected the correct project and that the query role is `postgres`.
   With no partial text selection in the editor, click **Run**.
7. Inspect the final result. Expect the following 12 rows, each with
   `rowsecurity = true`:

   - `admin_logs`
   - `email_verification_codes`
   - `email_verification_rate_limits`
   - `feedback`
   - `match_participants`
   - `match_results`
   - `matches`
   - `password_reset_codes`
   - `password_reset_rate_limits`
   - `typetiles_schema_migrations`
   - `user_stats`
   - `users`

8. Open **Table Editor** and select schema **public**. Refresh if necessary.
   These new application tables are empty. Do not add test passwords manually or
   create records in **Authentication > Users**: this app retains its own auth.
9. Leave RLS enabled. There are deliberately no browser-access policies; access
   will go through the Node backend's database connection and authorization.
10. Configure the backend using the steps below and run `npm run db:check`.
    Keep Render undeployed until its real connection and manual app checks pass.

The migration is transactional and records its own version. Re-running an
already successful migration is a no-op. If conflicting application tables
already exist without its version record, it stops instead of changing them.
On any SQL error, stop and share the error text (without credentials); do not
delete tables or run a database reset to try to repair it.

## Validation performed locally

The complete script was executed against an isolated in-memory PostgreSQL engine
(PGlite). Checks passed for all 12 tables, identities, defaults, epoch-millisecond
timestamps, fractional WPM, foreign keys, uniqueness, cascade deletion,
idempotent re-run, denied direct access by `anon` and `authenticated`, and
transaction rollback when a conflicting table exists.

The user has reported that the tables were successfully created in Supabase.
PostgreSQL provider support is now implemented alongside the existing SQLite
provider. The hosted connection is not confirmed yet: its TLS chain requires a
trusted root certificate. No test accounts or match records have been written
to the hosted project by the assistant.

## Configure the backend locally

1. Keep the existing private `DATABASE_URL` in `server/.env` and set
   `DATABASE_PROVIDER=postgres`. Do not put the URI in the frontend.
2. Open Supabase **Database > Settings > SSL Configuration**, or use the
   project's Database Settings link. Download the database root certificate.
   https://supabase.com/docs/guides/platform/ssl-enforcement
3. Save it as `server/prod-ca-2021.crt` and add this setting to `server/.env`:

   ```dotenv
   DATABASE_SSL_CA_FILE=./prod-ca-2021.crt
   ```

4. Open a terminal in `server` and run `npm run db:check`. The check reads the
   migration record without creating accounts or changing tables. Certificate
   validation stays enabled; do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.
5. After the check succeeds, run `npm run dev`. Keep the frontend local with
   `CLIENT_URL=http://localhost:5173` in the backend environment. Verify the three
   independent auth secrets and the Resend sender are configured correctly.
6. Start the frontend from the repository root with `npm run dev`. The existing
   frontend defaults to the local backend on port 3001. Test registration,
   email verification, login, results and teacher/student multiplayer.

Offline mode remains available with `DATABASE_PROVIDER=sqlite`; `DATABASE_PATH`
is only used by that provider. SQLite verification-test mode always forces its
isolated SQLite provider regardless of the normal `.env`.

## Render preparation (not deployed by the assistant)

Use root directory `server`, build command `npm ci --include=dev && npm run build`,
start command `npm start`, and health check `/health`. Use a single instance:
active multiplayer rooms are held in memory and cannot span instances yet.

Add the certificate in Render as a secret file named `prod-ca-2021.crt` and set
`DATABASE_SSL_CA_FILE=/etc/secrets/prod-ca-2021.crt`. Configure the same private
database URI, provider, auth secrets, Resend credentials and frontend origin in
Render's Environment page. Let Render set `PORT`.

For localhost frontend -> Render API, set root `.env.local`:

```dotenv
VITE_API_URL=https://YOUR-BACKEND.onrender.com/api
```

Restart Vite after environment changes. The existing multiplayer pages still
construct `ws://` URLs: secure hosted `wss://` configuration must be implemented
before testing multiplayer against Render. Local LAN `ws://` remains supported.

## Implementation checks

- Backend TypeScript and the existing SQLite regression tests passed.
- Isolated PostgreSQL integration covers registration, verification, recovery,
  single-use codes, rollback, Solo sentence results, fractional WPM, history,
  leaderboards, admin access/search, teacher reports and real WebSocket results.
- PostgreSQL transactions use a dedicated pool client and an advisory lock to
  preserve serialized auth updates. PGlite tests validate SQL/API behavior;
  hosted multi-connection behavior and 50-user capacity still need testing.
- Startup only checks the migration marker; it never auto-creates or resets
  Supabase tables. `DATABASE_POOL_MAX` defaults to five connections per process.
- Existing dependency audit advisories remain in the dependency tree, including
  SQLite build dependencies. No forced major dependency upgrade was performed.

References:
- https://supabase.com/docs/guides/database/tables
- https://supabase.com/docs/guides/database/postgres/row-level-security
