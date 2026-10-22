# GitHub Pages + Supabase production deployment

The frontend remains at **https://sdkfynd.github.io/fynd-qr/** in **sdkfynd/fynd-qr**. Supabase hosts Auth, PostgreSQL and the `qr-api` Edge Function. Use a dedicated free QR project when available. Do not enable billing, create paid compute, or change a shared application's project-wide Auth settings for this release.

## Google and Supabase Auth

Use the user's own Google Cloud project with an **External** OAuth audience, a **Web application** OAuth client, and only `openid`, `email` and `profile` scopes. Do not restrict it to a hosted domain or the Fynd Google Cloud organization. Set its authorized redirect URI to:

```
https://PROJECT_REF.supabase.co/auth/v1/callback
```

Store the Google client ID and secret in the selected Supabase project's Google provider. Never place the Google client secret in GitHub Pages or a VITE_ variable. Enable Google, allow signups, set Site URL to `https://sdkfynd.github.io/fynd-qr/`, and allow that exact redirect URL. Add exact localhost redirects only for deliberate development testing. The browser uses Supabase PKCE; Supabase manages access/refresh sessions. A personal Google account must complete the real flow after deployment. Google first-use terms and any new app permissions need the required human consent.

## QR-only database migration

Inventory existing `fynd_qr` data before selecting a different project. The historical project ref is `vqrymevnnxsvitzxezho`; its recorded deployment status is historical, not proof that it is empty or the correct new target. Inspect only QR schema data. If any saved QR codes/logos/accounts exist, preserve their rows, owner ids, slugs, payloads, scan URLs, events and manual-account credentials in a private migration. Keep previously distributed direct API origins serving their old routes.

Apply, in order, `server/migrations/001_fynd_qr.sql`, `002_password_accounts.sql` and `003_supabase_auth.sql`. All changes are confined to the QR schema/role; existing `public` tables remain untouched. QR tables remain inaccessible to Supabase anon/authenticated/service-role APIs. Do not add `fynd_qr` to exposed Data API schemas.

Provision login only for the existing restricted `fynd_qr_app` role, with an app-only password stored privately. Do not reset any shared database administrator password or an already active runtime role password without a cutover plan. Use its **transaction pooler on port 6543**, with username `fynd_qr_app.PROJECT_REF`. Edge runs unnamed queries with a one-connection pool, releases connections and verifies TLS. Supply the selected project's database CA if needed; do not disable certificate verification.

Legacy Google subjects map directly to the new verified Supabase user. A provisioned manual owner can link automatically only when Google is authoritative for the current email (Gmail, or a matching provider-supplied Workspace `custom_claims.hd`). Other third-party Google addresses can sign in, but matching historical manual work needs an administrator ownership check. After verifying that claim, an administrator can insert the approved `(owner_id, auth_user_id)` into `fynd_qr.owner_claim_approvals`. The runtime can read approvals but cannot create them. Conflicting mappings fail closed; disabled linked manual accounts remain disabled after an email change.

## Edge Function configuration

Set private secrets using the selected project's dashboard or `supabase secrets set --env-file /PRIVATE/PATH/.env.edge --project-ref PROJECT_REF`. See `.env.edge.example`:

- `QR_DATABASE_URL`: restricted role transaction-pooler URI, with no SSL override query parameters.
- `QR_ANALYTICS_SECRET`: random stable secret, at least 32 characters.
- `QR_DATABASE_CA`: optional CA PEM for verified database TLS.
- `QR_SCAN_PAGE_URL=https://sdkfynd.github.io/fynd-qr/`
- `QR_APP_ORIGINS=https://sdkfynd.github.io`

The runtime supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`. A custom public key can be supplied as `QR_PUBLISHABLE_KEY` if necessary. No service-role key or database administrator credential is used by the Edge function. The runtime refuses a privileged SQL role.

`supabase/config.toml` deliberately sets `verify_jwt=false` because scans are public. **Every management operation verifies the bearer JWT with the selected Supabase Auth server and then enforces ownership explicitly in SQL.** No decoded-but-unverified JWT, editable metadata, query owner id or browser-provided email can grant access. Public resolution returns only the destination and has bounded shared rate limits. PNG work is limited to one non-interlaced 8-bit RGB/RGBA header, 240x240 pixels and bounded IDAT inflation, with no native image library.

## Repository variables and deployment credential

Configure these public repository variables:

```
SUPABASE_PROJECT_REF=PROJECT_REF
QR_SUPABASE_URL=https://PROJECT_REF.supabase.co
QR_SUPABASE_PUBLISHABLE_KEY=PUBLIC_PUBLISHABLE_OR_LEGACY_ANON_KEY
QR_API_URL=https://PROJECT_REF.supabase.co/functions/v1/qr-api
```

Set `QR_LEGACY_PROJECT_REF` to the prior project when auditing a project change. Audit legacy ids/owners/addresses before switching data sources. The optional `--audit-legacy`/`--migrate` management-API modes compare them, but require an additional Database-scoped token that is intentionally not granted to the normal deployment workflow.

Add the project-scoped deployment credential as the **GitHub Actions secret** `SUPABASE_ACCESS_TOKEN`: Project Settings Read, Auth Config Read, Edge Functions Read-write. Initial secret upload also needs Edge Function Secrets Read-write. Database permissions are unnecessary because migrations use the private operator database connection. Set a short expiry for the initial deployment credential and renew deliberately for later releases. It must never appear in source, CLI arguments, logs or a public variable. Google client secrets belong only in Supabase Auth; database/analytics secrets belong only in Edge secrets and private operator storage.

The application rejects a secret/service-role key before building a static artifact. The API and Auth URLs must use the same Supabase project.

## Release and verification

After local tests and review, with the selected project and private deployment token configured:

```sh
SUPABASE_PROJECT_REF=PROJECT_REF QR_PRIVATE_CREDENTIAL_FILE=/PRIVATE/PATH/project.json QR_DATABASE_CA_FILE=/PRIVATE/PATH/prod-ca-2021.crt node scripts/provision-supabase.mjs --upload
node scripts/deploy-supabase.mjs --deploy --require-auth
node scripts/check-api.mjs
QR_BASE_PATH=/fynd-qr/ pnpm build
QR_BASE_PATH=/fynd-qr/ pnpm check:dist
```

Use `VITE_API_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the public repository configuration for the frontend build. Apply pending QR migrations through the private operator connection first. The workflow runs the tests, checks Deno compatibility, deploys `qr-api` using Supabase's Docker-free API bundling, checks live database/Auth/API readiness, and only then deploys `dist/` to GitHub Pages. No unrelated Supabase function is pruned.

Verify on the actual public origin: anonymous static PNG/SVG creation; ordinary personal Google login; refresh and logout; two-account isolation; saved static/dynamic codes; unchanged printed URL after destination edits; anonymous scans and analytics; pause/reactivation; bounded private logo upload/reuse. Confirm Google has External production access rather than only a testing-user allowlist. Never report deployment complete from local tests alone.

Detailed scan events expire after 90 days through periodic Edge cleanup; all-time non-bot counters remain. Country is Unknown unless trustworthy infrastructure support is added. Visitor and bot metrics are approximate and are not billing-grade. Free-tier availability, cold starts and provider limits can affect public links; monitor the real endpoints.
