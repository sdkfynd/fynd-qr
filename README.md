# Fynd QR

A QR creator using the existing Fynd design system, with a local P2 pilot for Google work sign-in, saved codes, dynamic destinations and scan analytics. Static content types and exports are preserved. There are twelve body, eye-frame and eye-ball choices.

## Try the local pilot

```sh
pnpm install --frozen-lockfile
pnpm dev:full
```

Open http://localhost:4300 and choose the clearly marked **local test account**. The local MongoDB persists your codes between runs. This account is development-only and cannot be enabled in production. A real Google OAuth client and hosted Node/MongoDB backend are still required for rollout.

The pilot creator UI requires Fynd work sign-in; public scan links do not. GitHub Pages assets are public even when a login screen is shown. Static QR files keep their original encoded content. Dynamic QR files encode a permanent scan link whose saved destination can be changed in My QR Codes.

The backend verifies `gofynd.com` Google Workspace identity, enforces ownership and keeps credentials out of the static bundle. Google sign-in, hosting setup, analytics definitions and remaining operational limits are documented in [the backend guide](server/README.md).

```sh
pnpm test
pnpm typecheck:server
pnpm build
pnpm check:dist
```

For a GitHub Pages build, set `QR_BASE_PATH=/fynd-qr/`, `VITE_API_URL` to the deployed API origin, and `VITE_CREATOR_ACCESS=work`. On GitHub Actions use the `QR_API_URL` repository variable. The deploy workflow checks API readiness before publishing the account-enabled frontend. Configure the backend scan page as `https://sdkfynd.github.io/fynd-qr/` to use that GitHub address in dynamic codes. Preserve this address when moving to company hosting so printed codes continue to resolve.

## Static QR quality

Content is encoded in the browser with high error correction and a quiet zone. Colors are checked for contrast, structural QR cells are preserved, and dense content selects a larger PNG export. Generated SVGs embed normalized PNG logos and do not load external images. Validate a phone scan and a physical print at its final size before distributing codes. No software scan test guarantees all printers, cameras or materials.

To generate raster scan fixtures and verify with a second independent decoder:

```sh
QR_SCAN_DIR=/absolute/empty/directory pnpm exec tsx --test src/qr.test.ts
python qa/verify-native.py /absolute/empty/directory
```

Python dependencies are in `qa/requirements.txt`. Browser image/export checks are available at `/qa/browser.html` during local development only; QA files are excluded from production output. Font and logo provenance is recorded in the existing asset notes, and runtime dependency notices are bundled with the site.
