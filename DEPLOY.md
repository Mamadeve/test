# Deploy on Cloudflare Pages (static upload)

The app is a fully static SPA (Vite build) — no server, no functions needed.
Two ways to put it on the internet; both give you a public `*.pages.dev` link
anyone can open.

## Option A — Dashboard upload (no CLI, recommended)

1. Build locally: `npm install && npm run build` (produces `dist/`).
2. Open <https://dash.cloudflare.com> → **Workers & Pages** → **Create**.
3. Choose the **Pages** tab → **Upload assets**.
4. Project name: e.g. `supply-sim` (lowercase; becomes `supply-sim.pages.dev`).
5. Drag the **`dist/` folder** (or a zip of its contents: `index.html` + `assets/`)
   into the upload area → **Deploy site**.
6. Done — share `https://supply-sim.pages.dev`.

Re-deploy: same page → **Create deployment** → upload the new `dist/` again.

A ready-made archive of the current build: `persian-marketplace-pages.zip`
(next to the repo root).

## Option B — Wrangler CLI (from your own machine)

```bash
npm install
npm run build
npx wrangler login          # opens the browser; do this on YOUR computer
npx wrangler pages deploy dist --project-name supply-sim
```

Then optionally: project → **Custom domain** to attach your own domain.

## Notes

- No `24-headers`/SPA fallback config is required: the app uses a single page
  (all views are in-page tabs), so static hosting is enough.
- The build is deterministic from the same seed — every deploy behaves the same.
- Do **not** commit `dist/` to git (already gitignored); upload it as an artifact.
