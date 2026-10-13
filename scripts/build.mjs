// Builds ren-show into the build directory (artifact/dist, or ./dist
// without the artifact link):
//
//   compiled/  main.js, worker.js, three-worker.js, layout.js (the layout worker), stack-worker.js
//              (a layout worker with ren-show's own engine) and
//              <app>-worker.js for each src/apps/<app>/worker.jsx, JSX compiled by ren-core/esbuild (templates)
//   runtime/   the same entries with the automatic JSX runtime
//   index.html, app.css, font.ttf and mono.ttf (from ren-skia), badge.png, canvaskit/,
//   taffy.wasm (the layout engine of the Skia and three.js primitives) and
//   harfbuzz.wasm (the shaper of the text they measure)
//
// Each bundle carries its mode and the source text of every module (the demos
// show their own source), plus the compiler demo's sample and its output.
//
//   node scripts/build.mjs [--quiet]

import { build } from 'esbuild';
import { ren, compile } from 'ren-core/esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SAMPLE } from '../src/sample.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = existsSync(join(root, 'artifact')) ? join(root, 'artifact', 'dist') : join(root, 'dist');
const quiet = process.argv.includes('--quiet');

/** Every file under a directory, relative to it. @param {string} dir @returns {string[]} */
const files = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path).map(f => join(name, f)) : [name];
  });

const sources = Object.fromEntries(files(src).filter(f => /\.(jsx?|css)$/.test(f)).map(f => [f.split('\\').join('/'), readFileSync(join(src, f), 'utf8')]));
sources['compiler:input'] = SAMPLE;
sources['compiler:output'] = await compile(SAMPLE, { loader: 'jsx', filename: 'sample.jsx' });

/**
 * Replaces src/build.js with this bundle's facts.
 * @param {'compiled' | 'runtime'} mode
 */
const facts = mode => ({
  name: 'ren-show-facts',
  /** @param {any} b */
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]build\.js$/ }, () => ({
      contents: `export const mode = ${JSON.stringify(mode)};\nexport const sources = ${JSON.stringify(sources)};\n`,
      loader: 'js',
    }));
  },
});

/** The applications (src/apps/<id>/): each may bring a worker entry and a stylesheet. */
const apps = existsSync(join(src, 'apps')) ? readdirSync(join(src, 'apps')).filter(name => statSync(join(src, 'apps', name)).isDirectory()).sort() : [];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
/** @type {Record<string, number>} */
const sizes = {};
for (const mode of /** @type {const} */ (['compiled', 'runtime'])) {
  const outdir = join(dist, mode);
  const common = {
    outdir,
    bundle: true,
    format: /** @type {const} */ ('esm'),
    target: 'es2022',
    minify: true,
    sourcemap: /** @type {const} */ ('linked'),
    metafile: true,
    logLevel: /** @type {const} */ ('warning'),
    jsx: /** @type {const} */ ('automatic'),
    jsxImportSource: 'ren-core',
    plugins: mode === 'compiled' ? [facts(mode), ren()] : [facts(mode)],
  };
  // The page: three.js loads on demand (the three.js demos), as its own chunk.
  const page = await build({ ...common, entryPoints: { main: join(src, 'main.jsx') }, splitting: true });
  // Each worker on its own, never sharing a chunk with the page: a worker
  // holds only the application and ren-core's component layer (no renderer, no
  // DOM, no three.js).
  // An application may run parts in a worker of its own: src/apps/<id>/worker.jsx is <id>-worker.js.
  const own = Object.fromEntries(apps.filter(id => existsSync(join(src, 'apps', id, 'worker.jsx'))).map(id => [`${id}-worker`, join(src, 'apps', id, 'worker.jsx')]));
  const workers = await build({ ...common, entryPoints: { worker: join(src, 'worker.jsx'), 'three-worker': join(src, 'three-worker.jsx'), layout: join(src, 'layout-worker.js'), 'stack-worker': join(src, 'stack-worker.js'), ...own } });
  for (const result of [page, workers]) for (const [file, meta] of Object.entries(result.metafile?.outputs ?? {})) if (file.endsWith('.js')) sizes[relative(dist, file)] = meta.bytes;
}

const require = createRequire(import.meta.url);
const canvaskit = dirname(require.resolve('canvaskit-wasm/bin/canvaskit.js'));
mkdirSync(join(dist, 'canvaskit'), { recursive: true });
for (const file of ['canvaskit.js', 'canvaskit.wasm']) copyFileSync(join(canvaskit, file), join(dist, 'canvaskit', file));
// The font ships with ren-skia (with its license).
copyFileSync(require.resolve('ren-skia/font.ttf'), join(dist, 'font.ttf'));
copyFileSync(require.resolve('ren-skia/mono.ttf'), join(dist, 'mono.ttf'));
// ren-canv's WebAssembly, beside the page: Taffy's (loadLayout('./taffy.wasm'))
// and HarfBuzz's (loadShaper('./harfbuzz.wasm')). Their packages export only
// for import: look for each up from ren-canv, as node does.
const canv = dirname(createRequire(require.resolve('ren-skia')).resolve('ren-canv'));
/** A file of a package ren-canv depends on. @param {string} name @param {string} file */
const ofCanv = (name, file) => {
  let from = canv;
  while (!existsSync(join(from, 'node_modules', name))) {
    if (dirname(from) === from) throw new Error(`${name} was not found in any node_modules above ren-canv; install ren-canv`);
    from = dirname(from);
  }
  return join(from, 'node_modules', name, file);
};
copyFileSync(ofCanv('taffy-layout', 'pkg/taffy_wasm_bg.wasm'), join(dist, 'taffy.wasm'));
copyFileSync(ofCanv('harfbuzzjs', 'dist/harfbuzz.wasm'), join(dist, 'harfbuzz.wasm'));
copyFileSync(join(root, 'assets', 'badge.png'), join(dist, 'badge.png'));
// The page's stylesheet, then each application's (src/apps/<id>/style.css), whose rules it scopes itself.
writeFileSync(join(dist, 'app.css'), [join(src, 'app.css'), ...apps.map(id => join(src, 'apps', id, 'style.css')).filter(f => existsSync(f))].map(f => readFileSync(f, 'utf8')).join('\n'));
writeFileSync(
  join(dist, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ren-show</title>
<link rel="stylesheet" href="./app.css">
</head>
<body>
<div id="app"></div>
<script type="module">
// ?runtime loads the automatic-runtime bundle; the default is compiled templates.
const mode = new URLSearchParams(location.search).has('runtime') ? 'runtime' : 'compiled';
import(\`./\${mode}/main.js\`);
</script>
</body>
</html>
`,
);

if (!quiet) {
  for (const [file, bytes] of Object.entries(sizes)) console.log(`${file.padEnd(22)} ${(bytes / 1024).toFixed(1).padStart(7)} KiB`);
  console.log(`built ${dist}`);
}
