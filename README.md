# ren-show

Live at <https://wiltonlazary.github.io/ren-show/>.

A live tour of the features of [rrx-core](https://github.com/wiltonlazary/rrx-core) (the reactive
core), [ren-core](https://github.com/wiltonlazary/ren-core) (the renderer-neutral components) and
its renderers [ren-dom](https://github.com/wiltonlazary/ren-dom),
[ren-skia](https://github.com/wiltonlazary/ren-skia) and
[ren-three](https://github.com/wiltonlazary/ren-three) (the drawn two on
[ren-canv](https://github.com/wiltonlazary/ren-canv)'s engine), with
[ren-html](https://github.com/wiltonlazary/ren-html) and
[ren-json](https://github.com/wiltonlazary/ren-json) for server renders, all on one page.
Every public export of them has a live demo. It is one ren-core
application, rendered by ren-dom: a sidebar of demos and, for each one, a working
example, the APIs it covers and its own source. Everything is JavaScript.

The package `ren-show` is private and never published. It depends on the
sibling checkouts through `file:` links (`rrx-core`, `ren-core`, `ren-dom`,
`ren-canv`, `ren-skia`, `ren-three`, `ren-html`, `ren-json`), so it always runs
against their current `main`.
three.js (0.186.1) loads on first use as a chunk of its own, so the pages
that do not show a three.js scene never download it.

## Applications

Complete products built on the advanced features for real reasons, each in
`src/apps/<id>/` with its own stylesheet, test (`test/apps-<id>.test.jsx`)
and browser check (`scripts/checks/<id>.js`). The home page opens with them.

| Application | Shows |
| --- | --- |
| Mail | one mail client of portable primitives switched live between five renderers (the DOM, a Skia canvas, a three.js overlay, a three.js panel in an orbitable scene, and Skia with the client in a worker); a parity panel runs one script of the client's own commands on each and compares what each shows with the DOM, timed; on a phone one pane at a time (list, message, compose; the mailboxes from a menu), the same on every renderer |
| Showroom | a product configurator living in one three.js root: geometry, studio lights and shadows, orbit camera, animated flights and an exploded view in JSX, with the interface as portable primitives in the overlay and in 3D panels (an Edit, selectable text); on this thread or in a worker; on a tablet the page's width with the bar in two rows, on a phone a stacked overlay |
| Terminal | a market desk (watchlist, 50,000-candle chart, order book, tape) drawn by ren-skia at 20 to 60 Hz; the same component on ren-dom beside it, with each renderer's frame cost measured on the same frames; on a phone one column: the chart (its readout on two rows) over a switch of the watchlist, the order book and the tape |
| Issues | 2,000 issues in one `$store`; grouped list and board as `$mirror`s (an edit re-renders one row); optimistic board moves (`$overlay`, `$act`) that roll back when the fake server refuses; comments as `$optimistic` drafts; search in the low lane (`$defer`, `$task`, `$pending`) holding the old results; the open issue's activity as a task that aborts on switch (`Pending`, `Recover`, `$rerun`); undo and redo (`$scan`); `$select`ed rows; a command palette and toasts in `Portal`s; preferences in the root's `Storage`; syncs through `$reuse`; Insights as a code-split chunk (`import()` in a task); background disposal of large groups |
| Pulse | a seeded telemetry model at 20 to 60 Hz; the whole dashboard runs in a worker root (`Root runtime="worker"`, `serve`) or on the main thread to compare, with the connection's measured apply times, records and low-lane share, and the page's frame times; ticks published in the low lane; charts drawn with `Shape`; a 10,000-line log tail in a `Scroll`; alert rules sent as `Props`, alerts back through `Send` |
| Studio | one design document edited on a Skia canvas, in DOM panels and in a live three.js preview, exported to HTML and data |

## Demos

| Demo | Shows |
| --- | --- |
| Signals and memos | `$signal`, `$read`, `$write`, `$memo`, `$scan`, `$derive`, `$equals`, `$watch`, `$render`, `$effect`, `$untrack` |
| Scheduling | `$flush`, `$batch`, `$batching`, `$auto`, `$defer`, `$deferred`, `$after`, `$settled`, `$commit`: scripted runs on a fresh graph |
| Scopes and ownership | `$scope`, `$enter`, `$stop`, `$cleanup`, `$release`, `$cleanups`, `$alive`, `$owner`, `$unowned`, `$discard`, `$mount`, `$mounts`, `$stats`, and on a lab graph `$root`, `$dispose`, `$closed`, `$cancel`, `$whenUnwatched`, `$retire`, `$sweep`, `$sweeper` |
| Contexts | `$context` as a provider, `$provide`, `$lookup`, `$update`, `$entries`, `$current`, `$with` |
| Failures | `$catch`, `$throw`, `$deliver`, `$outcome`, `Recover` |
| Tasks and optimism | `$task`, `$stream`, `$load`, `$outcome`, `$lastReady`, `$pending`, `$rerun`, `$behind`, `$whenDone`, `$optimistic`, `$act`, `Pending` (on a steppable clock) |
| Async JavaScript | Promises, `async`/`await`, `AbortSignal`, `Promise.all`/`race`, retries, async generators as tasks and streams (`src/async.js`), awaiting `$settled` |
| Stores | `$store`, `$at`, `$put`, `$raw`, `$update`, `$reuse`, `$mirror`, `$overlay`, and rrx-core/store's `deepEqual` (a polled document's equality: an equal poll notifies nobody) and `preserve` (a changed poll keeps every unchanged section's object) |
| Lists and selection | `For` (by key or by position), `$keyed`, `$rows`, `$positions`, `$select`, `$merge`, `$split` |
| Introspection | `$kind`, `$sources`, `$observers`, `$identity`, `$observer`, `$invalidate`, `$touch`, `$writable` |
| Control flow | `Show`, `Choose`, `When`, `Render`, `Portal`, and `Lazy`: a Steps component that reads its Step children before any runs and runs only the chosen one |
| Async in the graph | an async memo (a promise as its value) and no tearing (the city waits for its forecast; `$pending` and `$lastReady` show the change in flight), stale content kept live while a new tab loads, `Pending again`, `Sequence` (in turn, at once, as ready), `Times`, `For by`, running a report again quietly with `$rerun` or announced with `$changing` first (`$pending` and `$behind` tell the two apart), and the development diagnostics (`$development`) |
| Portable primitives | `View`, `Layout`, `Scroll`, `Label`, `Edit`, `Action`, `Image`, `Shape` (the `Gallery` component), and an Edit's `runs`: a Code field highlighted while it is edited, its value plain (the browser check aligns its mirror with the field, row by row and scrolled) |
| Portable style | one Card of primitives styled once (box model, paint, text, hover and press states) on ren-dom, ren-skia and ren-three side by side; text selection on the canvases; an Arabic line shaped on the canvases (`loadShaper`), measured as wide as the DOM's; the Gallery of every primitive on three.js alone |
| Events | delegation, `currentTarget`, `stopPropagation`, one flush per handler, `prevent`, refs, direct events; `touchAction` and `onPointerCancel` on the DOM, Skia and three.js (a pad that keeps its drag, one whose vertical swipe scrolls the page and cancels the press) |
| Around a component | one notes board on ren-dom, ren-skia and ren-three, each in its own root: `$keys` (N adds a note, / goes to the composer, wherever the key is pressed in the root), `$focus` (the composer's field), `$moves` and `$scrolls` (a marker that says whether the pinned note is above, in or below the list's view), `$resizes` (the pin's size as it grows), `$surface` (the hint names the renderer) |
| Resilience | failures from a body, binding, effect, `$watch` apply, cleanup and handler reaching their boundary; widgets removed with work in flight; a background-disposal lab (5,000 to 100,000 components in a nested root, background or at once, with the `swept` drain report: slices, longest slice, sweeping time, time to freed, late frames) |
| Application roots | nested `Root` with `$shadow` and `$dom`, themes, `Storage`, `Locks`, `Props`, `Send`, `$name`, `Id`, `Runtime`, `Memory`, `provide`, `$roots` |
| Skia renderer | the same `Gallery` on a CanvasKit canvas (ren-skia), loaded through a `$task` |
| three.js renderer | a scene in JSX (ren-three, `src/scene.jsx`): three.js elements, reactive properties, a `For` of meshes, a panel of primitives in the scene, `$animate`, raycast hover and clicks, DOM controls as props and picks as messages; its application runs on the page or in a worker (`src/three-worker.jsx`), three.js staying on the page |
| Renderers together | one counter shared by a shadow root (ren-dom), a Skia root (ren-skia) and a three.js root (ren-three), the same `Counter` component on the DOM and the canvas |
| Worker runtime | a nested `Root` with `runtime="worker"` serving `src/remote.jsx`: props, messages, storage, a low-lane burst, and the shared mailbox where the page is cross-origin isolated |
| Template compiler | the `ren-core/esbuild` output for a sample, and which bundle is running |
| Server renders | a card loading its items, live (ren-dom), as HTML (ren-html's `$html`) and as data (ren-json's `$json`: what it means, an item list and its button, marked with roles and microdata), each after its items loaded, and a live `$tree` root whose `changed(nodes)` follows the view, its first push sent once `$settle` says its tasks are done; no hydration |
| Rendering without a root | one ticket put on targets of the page by ren-dom's, ren-skia's and ren-three's `render` (Skia's input routed by `attach`, its frames read with `decode`; three.js on the page's own WebGL renderer), holding its seat through one `Locker` over the page's Web Locks; the same ticket rendered once into ren-html's `Document` inside a page built with it, written by `serialize`, its colors from ren-dom's `color` |
| A renderer of your own | Blueprint, a ren-canv `Document` subclass measuring with `Sfnt` and drawing each frame's `decode`d commands as outlines on a 2D canvas; ren-canv's `render` and `attach`; its layout in a worker running ren-show's own engine (`src/stack.js`, set with `useLayout`) |
| Keyed table | a keyed table of generated rows: make, add, mark, trade, pick, remove and empty, each timed in the page; rows loaded from async data; removals of 1,000 rows or more freed in the background with their drain report |

## Themes

Every theme is a palette drawn in OKLCH with its own hues and
checked for contrast (text 7:1 on every surface, secondary text and the
accent 4.5:1): Tonal, Paper, Daylight, Sand, Meadow and lired (light), and
Tonal Dark, Midnight, Tide, Nocturne, Abyss, Hearth and Neon (dark). They
switch on the fly from the theme menu in the top bar or the command palette
(Ctrl or Cmd+K). The choice is kept in `localStorage`; the first visit
follows the system's light or dark setting (Tonal or Tonal Dark), and
`?theme=<id>` opens the page in a given theme. `src/themes.js` is the one
source of color: the shell turns the chosen theme into the page's custom
properties and ren-dom's `--ren-*` tokens (set on the shell, nearer than the
root host), and provides it as the `Look` context. The demos and
applications read it where they draw: Skia and three.js roots are made again
with it (a renderer's theme is fixed), and the three.js scene gets its
colors through its props, so it follows in a worker too.

## Fonts

The canvases draw ren-skia's DejaVu Sans (`font.ttf`) and DejaVu Sans Mono
(`mono.ttf`, for families naming monospace), unkerned. The `ren-show` root,
Mail's and Terminal's DOM roots are given the same files (ren-dom's `font`
and `mono`), so the DOM sets text as Skia and three.js draw it and their
boxes match side by side; nested DOM roots inherit the face. The layout
engine measures a Taffy-laid DOM in that face too. The canvases shape the
text that needs it (Arabic joined, marks on their bases) with ren-canv's
HarfBuzz: the page loads `harfbuzz.wasm`, which the build copies beside it,
with `loadShaper` before a canvas renders, alongside Taffy's `taffy.wasm`
(`loadLayout`). The workers run applications or layout only and measure no
text, so none loads the shaper.

## Layout

| Path | What |
| --- | --- |
| `src/main.jsx` | the browser entry: the `ren-show` root and its environment |
| `src/app.jsx` | the shell: the top bar (command palette, theme menu), the sidebar of every section (on a narrow screen a drawer, opened from the top bar's menu button), the current section with its source, previous and next |
| `src/home.jsx` | the home page: a live sample beside its source, the applications, the features they are built from |
| `src/apps/` | the flagship applications (`index.js` registers them), each in a folder with its own stylesheet, test, browser check and optional worker entry |
| `src/themes.js` | the themes: every color on the page, as CSS custom properties, ren tokens and the `Look` context |
| `src/demos/` | one module per demo (`export default { id, group, title, apis, summary, View }`), listed in `index.js` |
| `src/assets.js` | `Assets`, the environment as an rrx-core context: clock, pace, CanvasKit loader, font files, lock manager, worker factory, sources, `settle` |
| `src/kit.jsx` | the journal, `lab` (a script on a fresh graph) and small view pieces |
| `src/async.js` | `Async` (async function → `$task`), `Each` (async iterable → `$stream`), abortable `latency` (a simulated request, on the environment's clock) |
| `src/remote.jsx`, `src/worker.jsx` | the worker demo's application and its Worker entry |
| `src/layout-worker.js` | the layout worker: ren-canv's engine (Taffy) serving the pages laid out with `remoteLayout(worker)` (the Portable style demo's Skia card) |
| `src/stack.js`, `src/stack-worker.js` | Stack, a layout engine of ren-show's own (flex rows and columns, no wrapping, no grid) for ren-canv's `useLayout`, and the layout worker that serves it (the renderer-of-your-own demo) |
| `src/sample.js` | the sample the compiler demo shows, compiled by the build with ren-core/esbuild |
| `src/build.js` | the bundle's mode and sources: defaults here, replaced by the build |
| `scripts/` | `build.mjs`, `serve.mjs`, `browser.mjs` (headless Chrome check) |
| `test/` | node:test suites on happy-dom (`test/page.jsx` opens each demo); the JSX loaders are ren-core's (`ren-core/loader`, `ren-core/compiled`) |
| `assets/` | the badge image (the fonts come from ren-skia) |

## Commands

Install rrx-core, ren-core, ren-canv, ren-dom, ren-skia, ren-three, ren-html and ren-json
first (their `prepare` generates the declarations `tsc` reads), then:

```sh
npm install
npm test                  # tsc, the suites twice (runtime JSX and ren-core/esbuild templates), the build
npm run build             # artifact/dist: compiled/ and runtime/ bundles, page, CanvasKit
npm run serve             # http://127.0.0.1:5173/ (add ?runtime for the automatic-runtime bundle); sends COOP/COEP, so the page is cross-origin isolated
npm run browser           # headless Chrome, both bundles, every demo (takes the machine-wide Chrome lock)
```

Run node commands under the workspace caps ([`../../../.ai/config/resources.md`](https://github.com/wiltonlazary/rui/blob/main/.ai/config/resources.md)). CanvasKit needs
`--disable-wasm-trap-handler` under `ulimit -v`.

## Tests

- Each demo opens in an application root on a happy-dom document (`test/page.jsx`). The tests
  drive it through its buttons and fields and check what rrx-core and ren-core promise.
- `npm test` runs the suites twice: with the automatic JSX runtime (`ren-core/loader`) and
  compiled by ren-core/esbuild (`ren-core/compiled`).
- The tasks demo runs on a manual clock (`clock()`), and so does the resilience demo's abort
  test. The async demo runs on real timers at a twentieth of its browser pace, and the tests await
  what it shows. No test sleeps: each awaits an event, the flushes of what a manual clock released (`flushed()`),
  the worker's messages crossing, or re-checks the page with a bound (`test/timers.test.js`
  guards it; [../../../.ai/config/design.md](https://github.com/wiltonlazary/rui/blob/main/.ai/config/design.md)).
- `test/canvas.test.jsx` sets ren-show's Stack engine with `useLayout` for its whole process, as
  the layout worker does in the browser, and serves it over a `MessageChannel`; no other suite
  shares that process.
- The Skia demo renders with headless CanvasKit, the three.js demos with real three.js scenes and
  a drawer stub (node has no WebGL). The worker demo serves `src/remote.jsx` over a
  `MessageChannel`, with the real `serve` on the other end.
- `scripts/browser.mjs` covers what happy-dom cannot: real CanvasKit painting, three.js on WebGL
  (SwiftShader) with a raycast click, direct and with the scene's application in a real Worker,
  a real Worker, layout, and timings. Its phone pass (touch, a mobile viewport; `--phone` runs it
  alone) opens and closes the sections drawer at 390 pixels wide; there it checks Mail (no
  sideways scroll, list, message and back on the DOM and Skia, the parity script) and Terminal
  (the chart over the watchlist, both whole, the readout inside the chart, the book and the tape switched in), a real touch swipe on the events demo's pads on every renderer ('none' keeps the drag, 'pan-y' scrolls the page and cancels the press); it checks every page at 360: no horizontal
  overflow, and every canvas shown at the size it draws; and Showroom at 800 wide, a tablet (its
  overlay's parts and side panels inside the canvas, none over another).
- Each worker is bundled on its own (`scripts/build.mjs`), never sharing a chunk with the page:
  it holds the application and ren-core's component layer only, no DOM and no renderer.
