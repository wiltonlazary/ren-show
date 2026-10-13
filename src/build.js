// What the build knows: how this bundle's JSX was compiled and the source
// text of each module. scripts/build.mjs replaces this module's contents in
// every bundle; unbundled (tests, tsc) it holds these defaults.

/** @type {'compiled' | 'runtime'} */
export const mode = 'runtime';

/** @type {Record<string, string>} */
export const sources = {};
