# Local P2 review — 18 September 2026

Implemented against the existing static Fynd QR editor. The current branch is a local pilot and has not been deployed to the live site.

## Verified

- 98 QR tests passed, including every combination of twelve bodies, twelve eye frames and twelve eye balls for the standard scan fixture, all seven content types, logo/color combinations and dense text. More aggressive eye curvature was reduced after independent decoding failures.
- 2,636 generated raster fixtures passed ZXing-C++ 2.3.0 decoding, independently of the jsQR checks in the Node suite.
- 59 browser validation groups passed: browser image normalization, invalid uploads, PNG/SVG exports, all shape combinations, logos, colors and output dimensions.
- 18 backend integration tests passed against a real temporary MongoDB: Google claim/nonce/session rules, denied anonymous and cross-account operations, idempotency, revision conflicts, static storage, mutable destinations with immutable encoded links, GitHub resolver, pause/archive/reactivation, bot/HEAD handling, analytics write failure behavior, destination validation, pilot domain restrictions, test-account isolation, expired sessions, referrer minimization and trusted-proxy country handling.
- Browser journey: local test sign-in; dynamic creation; saved-code library; opening a scan link; changing the destination and reopening the same link; analytics reflecting two real redirect visits; pause/paused-page/reactivation; 7-day range; CSV export; static save and PNG download; account restoration after refresh; records persisting after a full backend/Mongo restart; sign-out returning to the pilot gate.
- Chrome at 390×844: pilot entry, saved-code list and analytics visually inspected; no horizontal document overflow. In-app desktop layouts also inspected. No application console errors observed in the creator preview.
- Frontend and backend TypeScript checks passed. Production artifact built and verified with the GitHub Pages `/fynd-qr/` base path. Production dependency audit reported zero known vulnerabilities at review time. Git whitespace check passed.

## UX and logo follow-up

- Header reduced to My QR Codes and an account popover, with hover/press/focus feedback. Homepage text covers static and dynamic QR codes, each with an explicit creation action and mode explanation.
- Saved codes use compact name/destination rows, type/status labels, saved/static/dynamic totals, search and filters. Large QR thumbnail cards were removed.
- Analytics has explicit 7/30/90-day controls with focus preserved after updating. Copy uses an accessible icon with success feedback; edit, pause/reactivate, archive, refresh and CSV actions share consistent icon styling. Reset style, remove logo and save controls no longer use underlined text.
- Private uploaded-logo library tested through the actual browser file chooser: automatic save, duplicate message, reuse, and persistence across sign-out and backend restart. Cross-account and anonymous access are rejected; malformed images and excessive dimensions are rejected server-side.
- Logo size 10–18% tested at each integer size across seven content types and twelve body styles, plus dense data. Short payloads with a logo use a minimum QR version after a small-logo decode failure was reproduced and corrected. Transparent outer padding is trimmed; background clearing follows complete QR modules.
- All 36 shape controls, five palettes, eye-color toggle, contrast rejection, logo presets, size keyboard limits, PNG/SVG download actions, static saving, dynamic creation/editing, copy, pause, archive cancellation/archive/reactivation, filters/search/empty results, CSV, account Escape/sign-out, and unsaved-editor confirmation exercised in-browser. The permanent scan link reached the changed destination and recorded the visit; same-document hash navigation also worked.
- Mobile review repeated at 390×844 for the home, compact library and analytics. Controls fit without horizontal document overflow; legacy secondary-button font and margin inheritance corrected. Reduced-motion CSS disables the gentle preview pulse. Physical vibration feedback is optional on supported touch devices and was not tested on hardware.
- Upgraded Sharp to 0.35.4 after its runtime audit flagged upstream image-library advisories ([libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [libheif advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)). Re-ran all 116 Node tests and 2,636 ZXing fixtures with the updated dependency; production audit now reports zero known vulnerabilities.

## Boundaries

Google sign-in verification logic is tested with controlled signed-in identity claims; an actual Google OAuth client and real company/non-company sign-in have not been configured or exercised. The local login is explicitly a test account. Production MongoDB, HTTPS hosting, real phone scans over a public deployment, Docker image execution, operational monitoring and a complete public-abuse moderation program remain deployment work.

The pilot login screen gates the creator interface. GitHub Pages still delivers public code and assets: a browser-side gate cannot stop someone copying or running the static generator themselves. Account data, mutations and dynamic creation are protected by backend verification. A genuinely private creator website needs access-controlled hosting.

Scan analytics count recorded redirect/resolver requests, not proven camera scans. Visitor estimates and bot detection are approximate; countries stay unknown without trusted hosting metadata. No malware reputation service is connected. Optional destination allowlisting is supported but no company domain list has been assumed.
