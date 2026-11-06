# Step 00: Monorepo restructure

Status: done
Depends on: –
Read first: [ADR-0001](../adr/0001-monorepo.md)

## Context

The repository root is currently the Vite app (`index.html`, `src/`, `package.json`, `dist/`,
`_legacy_pulse/`), and it is **not a git repository yet**. Every later step assumes the monorepo
layout and a working smoke test.

## Goal

Make the repo a git monorepo with the web app in `web/`, and add a headless smoke test that
later steps use to check for regressions.

## Tasks

1. `git init` with a `main` branch. Add a root `.gitignore` covering `node_modules/`, `dist/`,
   `.DS_Store`, `__pycache__/`, `.venv/`, `.pytest_cache/`, `.ruff_cache/`, `*.egg-info/`,
   `web/test-results/` and `web/snapshots/`.
2. Move the web app into `web/` with `git mv` after an initial commit, or plain `mv` before it:
   `index.html`, `src/`, `package.json`, `package-lock.json`, `_legacy_pulse/`, `README.md`
   (it becomes `web/README.md`). Delete `dist/` (it's a build artefact) and `.DS_Store`.
3. Rename the npm package to `mars-web`. Add a dev-server proxy to `web/vite.config.js`:
   `/prom` → `http://localhost:9090` with `/prom` stripped. Nothing uses it yet. It's there for
   step 07.
4. Add a smoke test with Playwright (`@playwright/test` as a devDependency):
   - `web/scripts/smoke.mjs`, run with `npm run smoke`: build, start `vite preview`, open each
     page `?page=1` … `?page=5` in Chromium with WebGL enabled
     (`--use-angle=swiftshader --enable-unsafe-swiftshader` if needed), wait 4 s, then:
     - fail on any `console.error` or page error
     - check that every module header from the README tables (01–27) is in the DOM
     - save `web/snapshots/page-N.png` so a person can compare them visually
   - It must exit non-zero on failure.
5. Root `README.md`: a short system overview (the probe → Prometheus → MARS diagram from
   `docs/README.md`), the layout, how to run the web app (`cd web && npm i && npm run dev`),
   and pointers to `docs/`. Leave the Docker instructions as a placeholder for step 03.
6. Make the initial commit(s).

## Acceptance criteria

- [x] `git status` is clean, and `git log` shows the restructure.
- [x] Nothing app-related remains at the root except `README.md`, `.gitignore` and `docs/`.
- [x] `cd web && npm ci && npm run build` succeeds.
- [x] `npm run smoke` passes and writes 5 screenshots that show the device rendering (not black
      screens).
- [x] `web/README.md` links still resolve (fix `src/...` links if they break).

## Verification

```bash
cd web && npm ci && npm run build && npm run smoke
ls snapshots/
```

## Out of scope

Any change to app behaviour. The Python and deploy folders are created in later steps.

## Handoff

**Built**

- Git repo on `main`, root [.gitignore](../../.gitignore) as specified.
- Web app moved to [web/](../../web/) (`index.html`, `src/`, `package.json`, `package-lock.json`,
  `_legacy_pulse/`, `README.md`). `dist/`, `.DS_Store` and the old root `node_modules/` deleted.
- npm package renamed `mars-pulse` → `mars-web`.
- [web/vite.config.js](../../web/vite.config.js) (new; there was no config before): dev-server proxy
  `/prom` → `http://localhost:9090` with the prefix stripped. Build output is byte-identical to
  the pre-move build (`index-DQWjlzZP.js` before and after).
- [web/scripts/smoke.mjs](../../web/scripts/smoke.mjs), `npm run smoke`: `vite build`, `vite preview`
  on 127.0.0.1:4179, Chromium (SwiftShader flags) at 1920×1080, pages `?page=1`…`5`, 4 s settle,
  fails on `console.error` / `pageerror` / missing module numbers, writes
  `web/snapshots/page-N.png`, exits 1 on any failure.
- Root [README.md](../../README.md) (overview, diagram, layout, run instructions, Docker placeholder);
  [web/README.md](../../web/README.md) gained `npm run smoke` and a pointer to the root README.

**Deviations**

- *Module headers per page, not all 27 on every page.* `App.jsx` mounts only the active page,
  so the smoke test checks each page for its own module numbers (p1 01–07, p2 08–13,
  p3 14–17, p4 18–22, p5 23–27). Together that covers 01–27. It matches on the
  `.mod-head .num` text, not the names, so renaming a module doesn't break the smoke test.
- Added `--ignore-gpu-blocklist` next to the SwiftShader flags (harmless, helps on CI hosts).
- `SMOKE_SKIP_BUILD=1` env var skips the build step (useful when iterating on the script).
- `@playwright/test` 1.65.0 is the only new dependency (named in the step). Its Chromium
  must be installed once per machine: `npx playwright install chromium`.

**Verification**

```
$ cd web && npm ci && npm run build && npm run smoke
added … packages … found 0 vulnerabilities
dist/assets/index-DQWjlzZP.js   260.34 kB │ gzip: 94.04 kB
✓ built in 364ms
✓ page 1  modules 01–07  → snapshots/page-1.png
✓ page 2  modules 08–13  → snapshots/page-2.png
✓ page 3  modules 14–17  → snapshots/page-3.png
✓ page 4  modules 18–22  → snapshots/page-4.png
✓ page 5  modules 23–27  → snapshots/page-5.png
smoke: ok          (exit 0)
$ ls snapshots/
page-1.png page-2.png page-3.png page-4.png page-5.png
```

- Negative check: a copy of the script that expects a nonexistent module `99` on page 5
  printed `✗ page 5 / missing module headers: 99` and exited 1.
- All five screenshots were opened and inspected: the housing and every screen render
  (tape ridgeline, meter, orbit solids, radar, world map, waterfall, week dial, …), no black
  screens.
- `web/README.md` links (`src/config.js`, `src/data/{almanac,polling,signal}.js`,
  `src/gl/vector.js`, `src/instruments/space.js`) all resolve relative to `web/`.
- Root after the move: `.git .gitignore README.md docs web`.

**Not verified / needs a person**

- The `/prom` proxy has nothing to talk to yet. It is config only; step 07 exercises it.
- Screenshots are visual-only; nobody diffs pixels. The simulator is time-seeded, so the
  images differ run to run.

**Notes for later steps**

- `npm run smoke` is the regression baseline. Run it from `web/`. The first run on a new
  machine needs `npx playwright install chromium`.
- When the page/registry work (steps 05–06) changes how modules are rendered, keep a
  `.mod-head .num` element per module or update the `PAGES` table in `smoke.mjs`.
- The app still remembers the last page in `localStorage`. The smoke test uses a fresh browser
  context per page so `?page=` always wins.
- There is no root `package.json` (ADR-0001: no JS workspace tooling). All npm commands run in
  `web/`.
