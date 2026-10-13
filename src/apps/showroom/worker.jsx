// Showroom's worker entry (bundled on its own as showroom-worker.js): the
// scene application runs here, with its store, its animations and its
// interface; three.js, the scene objects and the renderer stay on the page.
// `construct` sends each element's constructor params with it.

import { serve } from 'ren-core/worker';
import { CONSTRUCT } from 'ren-three';
import { Showroom } from './scene.jsx';

serve(() => <Showroom />, { id: 'showroom-worker', construct: CONSTRUCT });
