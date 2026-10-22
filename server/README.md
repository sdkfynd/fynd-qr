# Backend implementations

Production uses Supabase Auth/PostgreSQL and the `supabase/functions/qr-api` entrypoint. Follow [the production guide](../DEPLOYMENT.md). This Node service remains available for isolated local development and migration support. Its manual-password sessions are not the production login mechanism.

# Fynd QR account and scan service

The frontend stays on GitHub Pages. Fastify/Node.js runs on an HTTPS application host, with Supabase PostgreSQL or MongoDB for accounts, saved codes, sessions and scan events. GitHub Pages does not run this server.

## Local review

Use Node 24 and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm dev:full
```

Open http://localhost:4300. This starts a real local MongoDB, the API on loopback port 4301 and Vite on loopback port 4300. The official MongoDB binary downloads on first run. Data persists under `.local-data/mongo`; the directory is ignored by Git. `DEV_WEB_PORT` and `PORT` can override the ports. A clearly labeled local test account works only on loopback. Configuration refuses this mode in production or on a public interface. It is separate from provisioned individual accounts and cannot be published.

Run `pnpm test`, `pnpm typecheck:server`, `pnpm build` and `pnpm check:dist`. Tests start a separate temporary MongoDB and do not touch local preview data.

## Production setup

1. Connect a production database with backups and least-privilege access. For Supabase, apply `migrations/001_fynd_qr.sql` followed by `002_password_accounts.sql` using the project SQL editor/admin connection. The migrations only change the dedicated `fynd_qr` schema, enable RLS and deny direct Supabase API roles. Separately provision login for `fynd_qr_app` and use its session-pooler URI as `DATABASE_URL`. The app verifies TLS and rejects privileged database roles; optionally provide `DATABASE_CA_FILE`. For MongoDB, use `MONGODB_URI` and a user limited to the QR database, with TLS and network restrictions. Set only one connection type.
2. Deploy the Dockerfile to an HTTPS Node/container host and configure `.env.server.example` through the host's secret manager. Set `PASSWORD_LOGIN=1`, `LOCAL_PREVIEW_AUTH=0`, a random stable `ANALYTICS_SECRET` of at least 32 characters, and the deployment's HTTPS origin as `SCAN_BASE_URL`. Apply both SQL migrations before starting this version on PostgreSQL, even when using Google only.
3. Provision individual accounts using the operator commands below. Verify each recipient's work identity and share credentials privately. There is no public signup or automatic email delivery. This describes the legacy local password pilot; production Google sign-in uses Supabase Auth.
4. Keep `SCAN_PAGE_URL=https://sdkfynd.github.io/fynd-qr/` to encode GitHub Pages links of the form `https://sdkfynd.github.io/fynd-qr/#r/<slug>`. Set `APP_ORIGINS=https://sdkfynd.github.io` and build with `VITE_API_URL` pointing to the API origin. Public scan resolution and static creation/downloads need no login; dynamic creation, saved codes and saved logos require an account.
5. Set the GitHub repository variable `QR_API_URL` to that API origin. The Pages workflow checks backend health, allowed origin, production-safe config, and either Google configuration or at least one enabled password account. Feature-branch pushes do not publish the site; the deployment workflow runs on main or an explicit manual dispatch.
6. Verify a real individual account, first-login password change, logout, login from another tab, rejected unapproved credentials, and a phone scan outside the developer's network. Change a destination and check the same printed code, analytics, pause and reactivation before rollout.

## Individual pilot accounts

Use Node 24 with the server environment configured. On your laptop, add `--local` while `pnpm dev:full` is running to target its isolated MongoDB instead of the cloud configuration:

```sh
pnpm accounts --local create person@example.com "Person Name"
pnpm accounts --local reset person@example.com
pnpm accounts --local disable person@example.com
pnpm accounts --local enable person@example.com
```

Omit `--local` to administer the configured production database. The command generates a random temporary password and saves it in a mode-0600 file under ignored `.local-data/invites/`; it prints only the file path. Passwords never go in command arguments, repository files or browser configuration. Deliver each file's credentials privately to its verified recipient and delete the delivery file afterwards. The first login requires a different 15–128-character passphrase. There is no shared published password, public signup, password-reset email service or administrator UI. For a forgotten password, the operator uses `reset`. Account names/emails are provisioned explicitly; a typed email suffix alone does not prove employment.

Passwords use unique random salts and Node scrypt (N=32768, r=8, p=3); only hashes go into the database. IP throttles and a database-backed 15-minute account lock after five failed attempts limit guessing. Hashing has a four-request concurrency ceiling. Login errors do not disclose whether an account exists. Password changes require the current password, rotate the account version and invalidate prior sessions; reset and disable also invalidate sessions without deleting QR records. A locked account can be recovered through an operator reset. Password accounts do not include MFA or a breached-password screening service in this pilot. See [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

## Adding Google later

Create a Google OAuth web client and authorize `https://sdkfynd.github.io` plus chosen localhost origins; set `GOOGLE_CLIENT_ID` on the backend. The browser receives a Google ID token with a one-time server nonce. The backend verifies signature, audience, issuer, expiry and verified email, without an email-domain restriction. A verified Google identity matching a provisioned account uses that account's existing QR ownership; disabled accounts remain blocked. Google can prove identity without a temporary password change. Creating a new password account after someone already used a separate Google-only identity requires explicit ownership reconciliation; provision the pilot accounts before enabling Google. Test the real consent and company policy flow before enabling it for users.

For direct server redirects, leave `SCAN_PAGE_URL` empty. Newly created codes then encode `SCAN_BASE_URL/r/<slug>` and use an HTTP 302 redirect without JavaScript. Existing records retain their original scan URL when the destination is edited. Keep every previously distributed scan address working after moving repositories or hosts. Changing configuration does not rewrite printed codes. The GitHub scan page requires JavaScript and an available API; link previews that do not execute JavaScript will not follow it or be counted.

## Access and data handling

- Every saved-code read, edit and analytics request is authenticated and scoped to the creator. Other users receive a not-found response. Session tokens are random, hashed in the database, expire after twelve hours, and are revoked on sign-out. The frontend keeps its token in tab session storage. Google tokens are not stored. Refreshing the same tab restores a valid session; a later visit may require sign-in again. Saved codes remain in the database.
- Creation uses idempotency keys; revision checks prevent overwriting concurrent edits. There is a nominal 500-code account cap and request rate limiting. In a multi-instance deployment add a shared rate-limit store and an edge request limit; the current in-memory limiter is per process. The account cap is not transactional under concurrent distinct create requests.
- Destinations accept public HTTP(S) URLs without embedded credentials or local IP literals. The service never fetches destination content. This validation is not phishing or malware detection. Optional `ALLOWED_DESTINATION_DOMAINS` restricts new and edited dynamic destinations to exact hostnames for a pilot; a trusted destination can still have open redirects or become compromised.
- Owners can pause or archive dynamic codes. Operators can suspend a code directly in the database by setting status to `paused` or `archived`; a dedicated abuse/moderation workflow remains a production expansion. Owner status controls are not an administrator-enforced suspension. There is no claim of malware screening in this release.
- Stored scan events contain a code-specific HMAC of IP plus user agent, coarse browser/device labels, referring hostname, and a trusted country code when available. Raw IP and user agent values are not stored in these events. Mongo TTL or the PostgreSQL hourly cleanup expires detailed events after 90 days (cleanup can lag). All-time non-bot counts remain. Hosting/infrastructure logs may have separate retention.
- A “scan” means a recorded GET redirect or resolver request, not a proven camera scan. Repeat requests count; HEAD requests do not. Recognized bots/previews are reported separately. Estimated visitors are not verified people. Hash inputs, shared networks, NAT, user-agent changes and bots affect accuracy. Empty/missing country and referrer values stay Unknown rather than being inferred.
- Daily charts and 7/30/90-day ranges use UTC. Analytics writes are best effort and cannot make a redirect fail; PostgreSQL inserts the event and updates the counter atomically; Mongo uses separate operations, so partial failures can produce discrepancies. Monitor write failures. Do not treat these metrics as billing-grade accounting.
- Country headers are accepted only with configured proxy trust and a forwarded client chain. The deployment must block direct access around the trusted proxy and have the proxy overwrite the country header. Without this setup, leave both proxy options unset. Never trust arbitrary forwarded IPs from the internet.

## Private logo library

Signed-in custom uploads automatically save to the owner’s `logos` collection. The browser normalizes PNG/JPG/WebP to a 240px PNG and trims transparent outer padding. The backend checks and decodes the PNG with bounded pixel input, re-encodes it without metadata, and produces a 96px list thumbnail. Full images are retrieved through an authenticated owner-scoped endpoint. Identical canonical images are deduplicated per owner, including concurrent duplicate requests. Built-in presets do not create library entries.

The library has a nominal 100-logo cap and a 20-upload/minute route limit; the count check is not transactional for different simultaneous uploads. If library saving fails, the current QR still uses the uploaded image and the UI offers retry. Logo size is validated at 10–18% of module width, with high QR error correction and whole-module background clearing. Short payloads use at least QR version 4 when a logo is present. Physical scan verification is still necessary for the final design and print.

## Launch dependencies still required

A tested production database connection, provisioned individual accounts, an HTTPS backend host, a decision on approved destinations, infrastructure monitoring/backups, and end-to-end sign-in and phone verification. Google OAuth can follow later. URL reputation scanning, formal acceptable-use/legal review and a user-facing abuse-reporting process have not been provisioned. Local test data is not production data. No cloud project or paid deployment is created by the local scripts.
