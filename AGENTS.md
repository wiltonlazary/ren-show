# ren-show

Standing rules for agents working in this checkout.

Read the workspace layer first: `../../../AGENTS.md` and `../../../.ai/config/`
(javascript.md, design.md, benchmarks.md, concepts.md, resources.md,
stability.md, git.md).
Then read [README.md](README.md) for the demos, layout and commands, and
[TODO.md](TODO.md) for open work.

## What this is

ren-show is a private application, never published. It demonstrates every
public feature of rrx-core and ren-core (the renderers' included), and it is
their broadest consumer test. It
depends on eight sibling checkouts through `file:` links
(`../../../<package>/wtree/_repo_`): rrx-core, ren-core, ren-dom, ren-canv,
ren-skia, ren-three, ren-html and ren-json (README, Commands).

## Rules

- Every public rrx-core and ren-core feature (the renderers' included) has a demo, and
  every demo has a test in `test/`. When rrx-core, ren-core or a renderer adds or
  renames something, update the demo, its `apis` list and the README table
  in the same change.
- Beside the demos, flagship applications (`src/apps/<id>/`) use the
  advanced features for real reasons, each with its own test and browser
  check: rich, modern examples, not toy ones.
- Every theme's palette is drawn in `src/themes.js` with readable
  contrast. Colors reach applications only through the theme's custom
  properties and `look()`.
- Demos use only the public entries (`rrx-core`, `rrx-core/store`, `ren-core`,
  `ren-core/worker`, `ren-core/remote`, `ren-core/esbuild`, `ren-dom`, `ren-canv`,
  `ren-canv/worker`, `ren-skia`, `ren-three`, `ren-html`, `ren-json`), never `rrx-core/core`,
  `ren-core/host` or files inside the packages.
- A defect ren-show finds is fixed in its owner (rrx-core, ren-core or a renderer), with that
  project's test, and never worked around here. Until it lands, record it in
  TODO.md.
- Demos read the environment from `Assets` (`src/assets.js`), never from
  globals, so tests can supply a clock, CanvasKit and a worker port.
- Build output goes to `artifact/dist` (the ignored link to
  `../../build/_repo__0.1.0`); scratch goes to `artifact/tmp/<task>/`.
- `npm test` is the gate (tsc, both JSX passes, the build). Run
  `npm run browser` (headless Chrome, under the machine-wide lock) before
  claiming that a change works in a browser.
