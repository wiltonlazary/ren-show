// The Stack layout worker: ren-canv's layout service with ren-show's own
// engine (stack.js) set by `useLayout`, serving the pages whose `layout`
// is `remoteLayout(worker)` (the "A renderer of your own" demo's).
import { serveLayout, useLayout } from 'ren-canv/worker';
import { Stack } from './stack.js';

useLayout(Stack);
serveLayout(/** @type {any} */ (self));
