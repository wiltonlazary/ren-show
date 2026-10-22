// The family's repositories on GitHub, grouped as the home page's menu
// lists them.

/** Where the repositories live. */
export const GITHUB = 'https://github.com/wiltonlazary';

/**
 * @typedef {{ name: string, what: string }} Repo a repository: its name (the end of its URL) and what it holds
 * @typedef {{ title: string, repos: Repo[] }} RepoGroup
 */

/** @type {RepoGroup[]} */
export const REPOS = [
  { title: 'Workspace', repos: [{ name: 'rui', what: 'the family and its rules' }] },
  {
    title: 'Libraries',
    repos: [
      { name: 'rrx-core', what: 'reactive core' },
      { name: 'ren-core', what: 'components and JSX' },
      { name: 'ren-dom', what: 'DOM renderer' },
      { name: 'ren-canv', what: 'drawn renderers’ engine' },
      { name: 'ren-skia', what: 'Skia renderer' },
      { name: 'ren-three', what: 'three.js renderer' },
      { name: 'ren-html', what: 'HTML render' },
      { name: 'ren-json', what: 'data render' },
      { name: 'rui-core', what: 'components' },
    ],
  },
  {
    title: 'Applications',
    repos: [
      { name: 'ren-show', what: 'feature tour' },
      { name: 'rui-show', what: 'component showcase' },
    ],
  },
  { title: 'Tooling', repos: [{ name: 'ren-bench', what: 'benchmarks' }] },
];

/** A repository's page. @param {string} name */
export const repoUrl = name => `${GITHUB}/${name}`;
