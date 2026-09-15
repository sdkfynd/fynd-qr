# Deploy Fynd QR

## Current status

P1 is the static QR generator hosted on GitHub Pages from [sdkfynd/fynd-qr](https://github.com/sdkfynd/fynd-qr). Sign-in, saved QR history, dynamic redirects, and scan analytics are outside this release. The source package, production artifact checks, and Pages workflow are prepared. A custom domain can be connected after deployment.

## GitHub Pages setup

1. Use the public `sdkfynd/fynd-qr` repository. Upload the contents of this folder at the repository root on `main`, including `.github/workflows/deploy-pages.yml` and the lockfile. Do not upload the ZIP itself or generated `node_modules/` and `dist/` directories.
2. In the repository's Settings → Pages, select **GitHub Actions** as the build and deployment source.
3. Run **Deploy Fynd QR to GitHub Pages** from Actions, or push to `main` after Pages is configured. If an earlier push ran before configuration and failed, rerun it.
4. Wait for the build and deploy jobs to succeed. Open the deployment URL reported by the workflow. Verify the header, fonts, both logo presets, a generated QR, and PNG/SVG downloads at that actual public URL.

GitHub Pages supports public repositories on GitHub Free. A private repository requires an eligible plan; repository privacy generally does not make the Pages site private. Confirm the intended repository visibility before creating it. See [GitHub's Pages setup documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

The workflow installs pinned pnpm, installs the frozen lockfile, runs the test suite, reads Pages configuration, builds and checks the static artifact, and deploys only `dist/`. It uses the repository's built-in GitHub token; no personal access token or app secret is required by the app or workflow. It still requires permission to create/configure the target repository.

The workflow derives the base path from Pages metadata. A project site uses `/repository-name/`; a domain-root deployment uses `/`. Header, preset, font, script, and stylesheet paths support both. The local preview defaults to `/`.

## Add the domain later

When a domain is supplied, set it under Settings → Pages → Custom domain, configure its DNS as specified by GitHub, complete GitHub's DNS verification, and enable HTTPS when available. Rerun the deployment workflow after the custom domain is saved so the app is rebuilt for the domain root. Verify both the custom-domain URL and HTTPS. Do not add guessed DNS records or a placeholder CNAME.

See [GitHub's custom-domain documentation](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) and [Vite's static deployment guide](https://vite.dev/guide/static-deploy.html).

## Validation before publishing — 15 September 2026

- Production TypeScript/build and artifact checks passed at `/` and `/fynd-qr-preview/`.
- 80 Node tests passed; all 623 scan fixtures passed both jsQR and native ZXing-C++ 2.3.0.
- Production dependency audit reported zero vulnerabilities at the time of the check.
- Chrome project-path smoke check confirmed all visible image assets load, both logo presets select and render, exports are enabled, and there are no browser warnings or errors.
- The public artifact contains 15 site files, including license notices. Internal reference URLs and local review records are excluded. The source package is curated separately from local review materials.

Verify the Actions deployment and the actual live URL for each release; local checks alone do not verify hosting configuration. Earlier app QA limitations are recorded in README.md.
