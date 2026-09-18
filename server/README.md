# Fynd QR account and scan service

The frontend stays on GitHub Pages. Fastify/Node.js runs on an HTTPS application host, with MongoDB for accounts, saved codes, sessions and scan events. GitHub Pages does not run this server.

## Local review

Use Node 24 and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm dev:full
```

Open http://localhost:4300. This starts a real local MongoDB, the API on loopback port 4301 and Vite on loopback port 4300. The official MongoDB binary downloads on first run. Data persists under `.local-data/mongo`; the directory is ignored by Git. `DEV_WEB_PORT` and `PORT` can override the ports. A clearly labeled local test account works only on loopback. Configuration refuses this mode in production or on a public interface. It is not a substitute for testing real Google sign-in.

Run `pnpm test`, `pnpm typecheck:server`, `pnpm build` and `pnpm check:dist`. Tests start a separate temporary MongoDB and do not touch local preview data.

## Production setup

1. Create an OAuth web client in a company-approved Google project. Authorize `https://sdkfynd.github.io` and the chosen localhost origin for development. Use a Google consent configuration permitted by the company; creating OAuth credentials does not require hosting the app in GCP. The browser obtains a Google ID token with a one-time server nonce. The backend verifies its signature, audience, issuer and expiry with Google's library, then requires both a verified email and the exact Google Workspace `hd` claim `gofynd.com`.
2. Provision a MongoDB deployment with authentication, TLS, backups, and network access limited to the API host. Use a database user limited to the `fynd_qr` database. Store its connection URI in the host's secret manager, not the repository or frontend.
3. Deploy the Dockerfile to a Node/container host. Set the values in `.env.server.example`. `ANALYTICS_SECRET` must be random and at least 32 characters. Disable local test auth. Supply the deployment's HTTPS origin as `SCAN_BASE_URL`.
4. Keep `SCAN_PAGE_URL=https://sdkfynd.github.io/fynd-qr/` to encode GitHub Pages links of the form `https://sdkfynd.github.io/fynd-qr/#r/<slug>`. Set `APP_ORIGINS=https://sdkfynd.github.io` and build the frontend with `VITE_API_URL` set to the API origin. Public scan resolution needs no creator login.
5. Configure the GitHub repository variable `QR_API_URL` with that API origin, then run the Pages workflow. It verifies the health/config endpoint before deploying. The initial creator UI requires work sign-in. This is an application gate: the HTML, JavaScript and logos on GitHub Pages remain public. Use an access-controlled host if the site itself must be private.
6. Test actual Google sign-in with a permitted work account and a denied non-company account; create and scan a test QR from a phone outside the developer's network. Update the destination and confirm the same printed QR reaches it. Test pause, reactivation and logout before rollout.

For direct server redirects, leave `SCAN_PAGE_URL` empty. Newly created codes then encode `SCAN_BASE_URL/r/<slug>` and use an HTTP 302 redirect without JavaScript. Existing records retain their original scan URL when the destination is edited. Keep every previously distributed scan address working after moving repositories or hosts. Changing configuration does not rewrite printed codes. The GitHub scan page requires JavaScript and an available API; link previews that do not execute JavaScript will not follow it or be counted.

## Access and data handling

- Every saved-code read, edit and analytics request is authenticated and scoped to the creator. Other users receive a not-found response. Session tokens are random, hashed in MongoDB, expire after twelve hours, and are revoked on sign-out. The frontend keeps its token in tab session storage. Google tokens are not stored. Refreshing the same tab restores a valid session; a later visit may require Google sign-in again. Saved codes remain in MongoDB.
- Creation uses idempotency keys; revision checks prevent overwriting concurrent edits. There is a nominal 500-code account cap and request rate limiting. In a multi-instance deployment add a shared rate-limit store and an edge request limit; the current in-memory limiter is per process. The account cap is not transactional under concurrent distinct create requests.
- Destinations accept public HTTP(S) URLs without embedded credentials or local IP literals. The service never fetches destination content. This validation is not phishing or malware detection. Optional `ALLOWED_DESTINATION_DOMAINS` restricts new and edited dynamic destinations to exact hostnames for a pilot; a trusted destination can still have open redirects or become compromised.
- Owners can pause or archive dynamic codes. Operators can suspend a code directly in MongoDB by setting status to `paused` or `archived`; a dedicated abuse/moderation workflow remains a production expansion. Owner status controls are not an administrator-enforced suspension. There is no claim of malware screening in this release.
- Stored scan events contain a code-specific HMAC of IP plus user agent, coarse browser/device labels, referring hostname, and a trusted country code when available. Raw IP and user agent values are not stored in these events. Mongo TTL expires events after 90 days (cleanup can lag). All-time non-bot counts remain. Hosting/infrastructure logs may have separate retention.
- A “scan” means a recorded GET redirect or resolver request, not a proven camera scan. Repeat requests count; HEAD requests do not. Recognized bots/previews are reported separately. Estimated visitors are not verified people. Hash inputs, shared networks, NAT, user-agent changes and bots affect accuracy. Empty/missing country and referrer values stay Unknown rather than being inferred.
- Daily charts and 7/30/90-day ranges use UTC. Analytics writes are best effort and cannot make a redirect fail; event and all-time counter updates are separate Mongo operations, so partial failures can produce discrepancies. Monitor write failures. Do not treat these metrics as billing-grade accounting.
- Country headers are accepted only with configured proxy trust and a forwarded client chain. The deployment must block direct access around the trusted proxy and have the proxy overwrite the country header. Without this setup, leave both proxy options unset. Never trust arbitrary forwarded IPs from the internet.

## Launch dependencies still required

A real Google OAuth client, a production MongoDB connection, an HTTPS backend host, a decision on approved destinations, infrastructure monitoring/backups, and end-to-end Google/phone verification. URL reputation scanning, formal acceptable-use/legal review and a user-facing abuse-reporting process have not been provisioned. Local test data is not production data. No cloud project or paid deployment is created by the local scripts.
