// The worker entry: serves the Remote application for the worker-runtime
// demo's root. The main thread starts it with `new Worker(url, { type: 'module' })`.

import { serve } from 'ren-core/worker';
import { Remote } from './remote.jsx';

serve(() => <Remote />, { id: 'worker-app' });
