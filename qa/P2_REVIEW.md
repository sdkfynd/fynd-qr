# Local P2 review — 18 September 2026

Implemented against the existing static Fynd QR editor. The current branch is a local pilot and has not been deployed to the live site.

## Verified

- 88 QR tests passed, including every combination of twelve bodies, twelve eye frames and twelve eye balls for the standard scan fixture, all seven content types, logo/color combinations and dense text. More aggressive eye curvature was reduced after independent decoding failures.
- 1,871 generated raster fixtures passed ZXing-C++ 2.3.0 decoding, independently of the jsQR checks in the Node suite.
- 59 browser validation groups passed: browser image normalization, invalid uploads, PNG/SVG exports, all shape combinations, logos, colors and output dimensions.
- 16 backend integration tests passed against a real temporary MongoDB: Google claim/nonce/session rules, denied anonymous and cross-account operations, idempotency, revision conflicts, static storage, mutable destinations with immutable encoded links, GitHub resolver, pause/archive/reactivation, bot/HEAD handling, analytics write failure behavior, destination validation, pilot domain restrictions, test-account isolation, expired sessions, referrer minimization and trusted-proxy country handling.
- Browser journey: local test sign-in; dynamic creation; saved-code library; opening a scan link; changing the destination and reopening the same link; analytics reflecting two real redirect visits; pause/paused-page/reactivation; 7-day range; CSV export; static save and PNG download; account restoration after refresh; records persisting after a full backend/Mongo restart; sign-out returning to the pilot gate.
- Chrome at 390×844: pilot entry, saved-code list and analytics visually inspected; no horizontal document overflow. In-app desktop layouts also inspected. No application console errors observed in the creator preview.
- Frontend and backend TypeScript checks passed. Production artifact built and verified with the GitHub Pages `/fynd-qr/` base path. Production dependency audit reported zero known vulnerabilities at review time. Git whitespace check passed.

## Boundaries

Google sign-in verification logic is tested with controlled signed-in identity claims; an actual Google OAuth client and real company/non-company sign-in have not been configured or exercised. The local login is explicitly a test account. Production MongoDB, HTTPS hosting, real phone scans over a public deployment, Docker image execution, operational monitoring and a complete public-abuse moderation program remain deployment work.

The pilot login screen gates the creator interface. GitHub Pages still delivers public code and assets: a browser-side gate cannot stop someone copying or running the static generator themselves. Account data, mutations and dynamic creation are protected by backend verification. A genuinely private creator website needs access-controlled hosting.

Scan analytics count recorded redirect/resolver requests, not proven camera scans. Visitor estimates and bot detection are approximate; countries stay unknown without trusted hosting metadata. No malware reputation service is connected. Optional destination allowlisting is supported but no company domain list has been assumed.
