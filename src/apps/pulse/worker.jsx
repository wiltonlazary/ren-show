// Pulse's worker entry (bundled on its own as pulse-worker.js): the whole
// dashboard application runs here, with its graph, its telemetry engine and
// its components; the page only applies what it publishes. No DOM and no
// renderer is imported.

import { serve } from 'ren-core/worker';
import { Pulse } from './dashboard.jsx';

serve(() => <Pulse />, { id: 'pulse-worker' });
