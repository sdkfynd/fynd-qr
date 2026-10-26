# Deployment checkpoint — 21 September 2026

The user requested individual password sign-in and a feature-branch push for testing. Publishing is still deferred. No new frontend release was published.

## Completed

- Reused the existing **Bin Count (Mumbai)** Supabase project. No additional project was created.
- Applied the additive `server/migrations/001_fynd_qr.sql` schema through Supabase SQL Editor. Five QR tables exist under `fynd_qr`; the five existing `public` bin-count tables were not modified.
- Verified row-level security is enabled on all QR tables. Supabase `anon` and `authenticated` roles have no SELECT permission on them. The restricted `fynd_qr_app` role can read the QR tables and cannot read the existing bin tables.
- Added a PostgreSQL storage implementation behind a common repository interface; retained MongoDB support and the existing local Mongo preview.
- Backend tests: **25 passed** (18 MongoDB integration tests plus 7 PostgreSQL/PGlite test groups). Server TypeScript check passed. Evidence: `../../work/supabase-backend-tests.log`.
- PostgreSQL tests cover migration repeatability and isolation, sessions and single-use login challenges, account ownership, concurrent creation/editing, dynamic link lifecycle, atomic scan counters, analytics ranges, expiry cleanup, logo privacy/deduplication, and TLS configuration.

## Individual sign-in update

- Added provisioned email/password accounts, anonymous static generation, administrator create/reset/disable commands and optional later Google linking.
- The latest validation is recorded in [PASSWORD_PILOT_QA.md](PASSWORD_PILOT_QA.md): 98 QR tests and 39 backend tests passed, along with type/build/artifact checks and a clean production dependency audit.

## Supabase connection is NOT finished

- The `fynd_qr_app` database role currently has **NOLOGIN**. Its login password has not been provisioned remotely.
- An ignored `.env.server` file was created with owner-only permissions. It contains a newly generated app-only connection credential and analytics secret, but that connection is **not active or tested**. Never print or commit it.
- A temporary local setup helper prepared a SCRAM password verifier, but its SQL was never copied to or run in Supabase. The helper is stopped. To resume, safely reuse the private staged password, derive a new SCRAM verifier if needed, and enable only the dedicated QR role after verifying it still has NOLOGIN. Do not reset the shared project's administrator password.
- Confirmed IPv4 session pooler: `aws-0-ap-south-1.pooler.supabase.com:5432`; database `postgres`; app username `fynd_qr_app.vqrymevnnxsvitzxezho`. The project reference is `vqrymevnnxsvitzxezho`.
- Complete a verified-TLS connection and an isolated real Supabase smoke test. PGlite tests do not establish production networking, credentials, or pooler compatibility.
- Supabase organization shows a quota/grace-period warning. Review its impact before rollout; no billing changes were made.

## Remaining before full launch

1. Finish the Supabase connection and real database checks above.
2. Apply the new `002_password_accounts.sql` migration (not yet applied remotely), enable `PASSWORD_LOGIN=1`, provision approved individual accounts and test their first-login password change. Google OAuth is optional and can follow later.
3. Obtain an HTTPS Node/container hosting account or deployment target, with permission to set server secrets. GitHub Pages only hosts the frontend.
4. Review quota/billing impact, destination restrictions and the operational setup with the hosting owner. Server configuration and documentation now cover both database options and the password pilot.
5. Set production secrets/origins and the GitHub `QR_API_URL` variable, run final build/artifact/security checks, then deploy and verify individual sign-in, phone scans, destination updates, analytics, pause/reactivation and logout.

Keep existing dynamic scan addresses stable during later hosting or database migrations. Moving Supabase data into MongoDB requires explicit data migration and cutover testing; it is not a connection-string-only switch.

## Local state on pause

The local full-stack preview can run with `pnpm dev:full`. Preview data persists under ignored `.local-data/mongo`. The database setup helper remains stopped. Local test accounts and credentials are separate from production; no production password account has been provisioned.
