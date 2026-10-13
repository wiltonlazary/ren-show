// Mail's worker entry (bundled on its own as mail-worker.js): the whole
// mail client, its 3,000 messages and its graph run here; the page keeps
// only the Skia renderer, which lays out, paints and routes input. No DOM
// and no renderer is imported.

import { serve } from 'ren-core/worker';
import { Mail } from './mail.jsx';

serve(() => <Mail />, { id: 'mail-worker' });
