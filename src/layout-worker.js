// The layout worker: ren-canv's engine (Taffy) serving the pages whose
// `layout` is `remoteLayout(worker)` (the Portable style demo's Skia card).
import { serveLayout, loadLayout } from 'ren-canv/worker';

serveLayout(/** @type {any} */ (self));
// The engine's WebAssembly is beside the page, a level above the bundles.
loadLayout(new URL('../taffy.wasm', import.meta.url));
