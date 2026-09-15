# Fynd QR

A static QR generator with seven content types: website, text, Wi-Fi, email, phone, SMS, and contact cards. Customize colors, independently select from eight body shapes, eight eye frames, and eight eye balls, add a Fynd or Impetus preset or a custom logo, then download PNG or SVG.

Content and uploads stay in browser memory. The app has no backend, analytics, account system, cookies, or remote font/image requests. QR content cannot change after download.

## Development

Use Node.js 24 and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm check:dist
pnpm preview
```

The development and preview servers use http://127.0.0.1:4173/; run one at a time. The preview command serves the built `dist/` directory. The production site consists only of that directory.

## Deployment

The included GitHub Actions workflow builds, checks, and deploys `dist/` to GitHub Pages on pushes to `main`, or when run manually. See [DEPLOYMENT.md](DEPLOYMENT.md) for repository setup and custom-domain mapping.

## Verification

There are 80 automated Node tests covering payload validation, styling, logos, export dimensions, independent shape changes, and 623 raster fixtures decoded with jsQR. The fixture set includes all 512 shape combinations, mixed styles across all seven content types, and dense payloads. A separate native ZXing-C++ check decoded the same 623 fixtures successfully.

For browser image checks, open `/qa/browser.html` on the Vite development server and select Run checks. This page is excluded from the production build.

For native decoder checks, install `qa/requirements.txt` in a Python virtual environment, set `QR_SCAN_DIR` to an absolute path to a new empty directory when running `pnpm test`, then run `python qa/verify-native.py` with that directory as its argument.

PNG and SVG saves have been verified in Chrome. The native custom-file chooser still needs a manual check; the image-processing code and preset selection are tested. Physical phone/print scans, device haptics, and cross-browser assistive-technology checks remain unverified. Scan representative downloads before printing.

## Assets and dependencies

Fonts and logo presets are self-hosted. Original brand and font owners retain their rights. Dependency and font notices are included in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
