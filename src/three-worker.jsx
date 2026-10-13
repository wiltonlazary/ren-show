// The worker entry of the three.js demo's scene: only the application and
// its components run here; three.js stays on the main thread. `construct`
// sends the three.js constructor params with the elements.

import { serve } from 'ren-core/worker';
import { CONSTRUCT } from 'ren-three';
import { Scene } from './scene.jsx';

serve(() => <Scene />, { id: 'three-worker', construct: CONSTRUCT });
