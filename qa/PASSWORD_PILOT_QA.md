# Individual account pilot — 21 September 2026

## Scope

Static creation and PNG/SVG downloads are available without sign-in. Dynamic creation, My QR Codes, analytics and saved logos require an individual team account. Operators provision approved gofynd.com users; there is no public registration. Google sign-in remains optional for a later rollout.

## Verified

- 98 QR rendering/decoding tests passed, including existing shapes, colors and bounded logo sizes.
- 39 backend tests passed against isolated MongoDB and PostgreSQL/PGlite instances. The new coverage checks temporary-password restrictions, salted hashes, password changes, reset/session revocation, disabled accounts, persistent account lockouts, per-IP throttling, owner isolation, verified Google linking, trusted origins and migration readiness.
- Server TypeScript, frontend build and the `/fynd-qr/` Pages artifact checks passed.
- Production dependency audit reported zero vulnerabilities at the time of testing.
- Operator CLI created and reset a synthetic local account. Temporary credentials are generated into owner-only, Git-ignored files.
- Browser: anonymous static editor, PNG/SVG download feedback, dynamic sign-in gate, generic wrong-password error, first-login password setup screen, cancelled setup retaining static content, normal individual sign-in, dynamic creation, library ownership, anonymous scan redirection, analytics increment, CSV export feedback, pause/unavailable page, reactivation, account password form and sign-out back to static mode.
- Password-change submission and session replacement were verified through backend integration tests and local HTTP calls. The browser password-change form was inspected without changing any real user's credentials.
- Password form at 390 × 844: dialog width 352 px, page width 390 px, no horizontal overflow. Default viewport restored after testing.
- Local test account reset to a fresh temporary password after QA. Production accounts were not created.

## Before publishing

This is a development-branch change. Do not merge/deploy merely because the source was pushed. Complete the Supabase connection, apply migration 002, deploy an HTTPS Node API, provision the actual approved users, and verify the full flow from the public origin and a phone. Google OAuth is not a prerequisite for the individual password pilot. Production hosting, live database connectivity, physical scans and real-user first-login testing are not claimed by these local checks.
