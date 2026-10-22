# Fynd QR

Create anonymous static QR codes, or sign in with any Google account to save designs, manage dynamic destinations, view scan analytics and reuse a private logo library. Seven static content types, twelve independently selectable body/frame/ball shapes, custom colors and logos, and PNG/SVG exports are preserved.

Production uses GitHub Pages for the frontend and a dedicated Supabase project for Google authentication, sessions, PostgreSQL and the `qr-api` Edge Function. There is no Google email-domain restriction and no separate Node hosting account is required. Static creation/downloads and public scan resolution do not require sign-in.

## Local development

Use Node.js 24 and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm dev:full
```

Open http://localhost:4300. With the public environment variables empty, this isolated development pilot uses a clearly marked local test account and local MongoDB. It does not connect to production. Its data persists in ignored `.local-data/mongo`. The original Node backend remains available for local development and migration support; the production Edge entrypoint never imports native `sharp`.

To develop against a selected Supabase environment, copy `.env.example` to ignored `.env.local` and set all three public values. Use `pnpm dev`, authorize its exact localhost URL in that Supabase project, and use an isolated test project rather than a shared production database.

## Verification

```sh
pnpm test
pnpm typecheck:server
pnpm build
pnpm check:dist
```

The suite covers QR rendering/decoding, legacy backend behavior, ordinary Google accounts, invalid/expired tokens, owner isolation, legacy ownership mapping, stable scan URLs, destination changes, analytics, pause/reactivation and bounded private logos. Run the actual Deno compatibility checks as well:

```sh
pnpm dlx deno@2.9.6 check --no-lock --config supabase/functions/qr-api/deno.json supabase/functions/qr-api/index.ts
pnpm dlx deno@2.9.6 test --no-lock --allow-env --allow-read --allow-write --allow-net=127.0.0.1 --config supabase/functions/qr-api/deno.json scripts/edge-runtime.test.ts
```

Deno tests complement Node tests; live Supabase and real Google OAuth must also be verified before declaring a production release complete. Browser image checks are at `/qa/browser.html` on the Vite development server. Native decoder checks use `qa/requirements.txt` and `qa/verify-native.py`. Physical phone/print scans remain necessary before distributing a final design.

## Production

See [DEPLOYMENT.md](DEPLOYMENT.md) for the selected Supabase project, personal Google OAuth configuration, restricted database role, migration checks and release commands. The included workflow deploys the Edge API and then GitHub Pages only after tests and live readiness checks pass.

Existing records retain their ids, legacy owners, slugs and scan URLs. Google-subject links preserve previous Google work; verified Gmail/Workspace email or an administrator approval protects manual-account migration. Previously printed scan addresses must keep resolving, including an older direct API origin if one was distributed. Do not switch projects without checking and migrating existing QR data first.

Fonts and logo presets are self-hosted. Notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
