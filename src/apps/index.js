// The flagship applications: real products built on ren-core's advanced
// features, each in src/apps/<id>/ with its own stylesheet (style.css,
// scoped under .app-<id>), test (test/apps-<id>.test.jsx), browser check
// (scripts/checks/<id>.js) and, when it runs in a worker, its worker entry
// (worker.jsx, built as <id>-worker.js).

/**
 * @typedef {object} Application
 * @property {string} id its section's id, also its URL hash
 * @property {string} title
 * @property {string} tagline one line
 * @property {string[]} apis the ren-core operations and components it uses
 * @property {string} summary
 * @property {(props: any) => any} View the application (optional props are for tests)
 */

import issues from './issues/index.jsx';
import pulse from './pulse/index.jsx';
import studio from './studio/index.jsx';
import mail from './mail/index.jsx';
import showroom from './showroom/index.jsx';
import terminal from './terminal/index.jsx';

/** @type {Application[]} */
export const apps = [mail, showroom, terminal, issues, studio, pulse];
