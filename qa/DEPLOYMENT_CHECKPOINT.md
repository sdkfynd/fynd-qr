# Paused deployment checkpoint — 18 September 2026

The user explicitly paused work. Resume only when requested. No new frontend release was published.

## Completed

- Reused the existing **Bin Count (Mumbai)** Supabase project. No additional project was created.
- Applied the additive `server/migrations/001_fynd_qr.sql` schema through Supabase SQL Editor. Five QR tables exist under `fynd_qr`; the five existing `public` bin-count tables were not modified.
- Verified row-level security is enabled on all QR tables. Supabase `anon` and `authenticated` roles have no SELECT permission on them. The restricted `fynd_qr_app` role can read the QR tables and cannot read the existing bin tables.
- Added a PostgreSQL storage implementation behind a common repository interface; retained MongoDB support and the existing local Mongo preview.
- Backend tests: **25 passed** (18 MongoDB integration tests plus 7 PostgreSQL/PGlite test groups). Server TypeScript check passed. Evidence: `../../work/supabase-backend-tests.log`.
- PostgreSQL tests cover migration repeatability and isolation, sessions and single-use login challenges, account ownership, concurrent creation/editing, dynamic link lifecycle, atomic scan counters, analytics ranges, expiry cleanup, logo privacy/deduplication, and TLS configuration.

## Supabase connection is NOT finished

- The `fynd_qr_app` database role currently has **NOLOGIN**. Its login password has not been provisioned remotely.
- An ignored `.env.server` file was created with owner-only permissions. It contains a newly generated app-only connection credential and analytics secret, but that connection is **not active or tested**. Never print or commit it.
- A temporary local setup helper prepared a SCRAM password verifier, but its SQL was never copied to or run in Supabase. The helper is stopped. To resume, safely reuse the private staged password, derive a new SCRAM verifier if needed, and enable only the dedicated QR role after verifying it still has NOLOGIN. Do not reset the shared project's administrator password.
- Confirmed IPv4 session pooler: `aws-0-ap-south-1.pooler.supabase.com:5432`; database `postgres`; app username `fynd_qr_app.vqrymevnnxsvitzxezho`. The project reference is `vqrymevnnxsvitzxezho`.
- Complete a verified-TLS connection and an isolated real Supabase smoke test. PGlite tests do not establish production networking, credentials, or pooler compatibility.
- Supabase organization shows a quota/grace-period warning. Review its impact before rollout; no billing changes were made.

## Remaining before full launch

1. Finish the Supabase connection and real database checks above.
2. Obtain access to a Google Cloud project or a Google OAuth **Web application client ID**. Authorize `https://sdkfynd.github.io` and required localhost origins. Configure consent/audience appropriately. The current Google Identity Services ID-token flow does not need a client secret in the browser or a Supabase Auth provider. Verify actual allowed gofynd.com login and denied non-company login.
3. Obtain an HTTPS Node/container hosting account or deployment target, with permission to set server secrets. GitHub Pages only hosts the frontend.
4. Update `.env.server.example`, server documentation, deployment checklist and storage/retention notes to describe PostgreSQL. They still describe the previous Mongo-only production setup. Do not publish with unfinished docs/configuration.
5. Set production secrets/origins and the GitHub `QR_API_URL` variable, run final build/artifact/security checks, then deploy and verify Google sign-in, phone scans, destination updates, analytics, pause/reactivation and logout.

Keep existing dynamic scan addresses stable during later hosting or database migrations. Moving Supabase data into MongoDB requires explicit data migration and cutover testing; it is not a connection-string-only switch.

## Local state on pause

The local full-stack preview and temporary database setup helper were stopped. Preview data persists under ignored `.local-data/mongo`. Restart with `pnpm dev:full` when review resumes. This local test account remains separate from real Google sign-in.
