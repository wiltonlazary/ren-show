// The home page: what ren-core is, a live sample beside its source, the
// flagship applications and the features they are built from.

import { $signal, $read, $write, $memo } from 'rrx-core';
import { $active, For } from 'ren-core';
import { apps } from './apps/index.js';
import { demos } from './demos/index.js';
import { THEMES } from './themes.js';

/** The sample's source, as it runs beside it. */
const SAMPLE = `function Thermostat() {
  const R = $active();
  const celsius = $signal(R, 21);
  const fahrenheit = $memo(R, () => $read(celsius) * 1.8 + 32);
  const nudge = step => () => $write(celsius, $read(celsius) + step);
  return (
    <Layout layout="row" gap={8}>
      <Action text="−" onPress={nudge(-1)} />
      <Label text={() => \`\${$read(celsius)} °C · \${$read(fahrenheit).toFixed(1)} °F\`} />
      <Action text="+" onPress={nudge(1)} />
    </Layout>
  );
}`;

/** What ren-core is made of, each leading to the demos that show it. */
const PILLARS = [
  { title: 'Fine-grained reactivity', text: 'Signals, memos and effects on an integer-id graph: an update touches exactly what read it, never a tree.', to: 'signals' },
  { title: 'Async without tearing', text: 'Tasks, streams and optimistic actions; transitions hold the old view whole until the new one is ready.', to: 'transitions' },
  { title: 'One vocabulary, every surface', text: 'Portable primitives and style render the same on the DOM, a Skia canvas and inside a three.js scene.', to: 'together' },
  { title: 'Off the main thread', text: 'Run an application in a worker, lay out in another; the page only applies what they publish.', to: 'workers' },
  { title: 'Server rendering', text: 'The same components as HTML for pages or as plain data for APIs and native clients.', to: 'server' },
  { title: 'Compiled templates', text: 'An esbuild plugin turns JSX into cloned templates; the runtime path renders identically.', to: 'compiler' },
  { title: 'Resilient by design', text: 'Every failure reaches its boundary, work in flight aborts, and big teardowns drain in the background.', to: 'resilience' },
  { title: 'Scoped application roots', text: 'Nested roots with their own storage, locks, theme and renderer, talking by props and messages.', to: 'roots' },
];

/** The renderers and outputs, as badges. */
const SURFACES = ['DOM', 'Shadow DOM', 'Skia canvas', 'three.js', 'Web Worker', 'HTML', 'JSON'];

/** @param {{ go: (id: string) => void }} props */
export function Home(props) {
  const R = $active();
  const celsius = $signal(R, 21);
  const fahrenheit = $memo(R, () => $read(celsius) * 1.8 + 32);
  const open = (/** @type {string} */ id) => (/** @type {any} */ e) => {
    e?.preventDefault?.();
    props.go(id);
  };
  return (
    <article data-demo="home" class="home">
      <section class="intro">
        <div class="pitch">
          <p class="eyebrow">rrx-core · ren-core · every renderer</p>
          <h2>
            One reactive core.
            <br />
            <span class="lit">Every surface.</span>
          </h2>
          <p class="lede">
            ren-core renders one component model to the DOM, a Skia canvas, a three.js scene, a worker and the server, on a fine-grained
            reactive graph. Explore real applications built on it, then take each feature apart.
          </p>
          <p class="actions">
            <a class="cta" href={`#${apps[0]?.id ?? demos[0].id}`} onClick={open(apps[0]?.id ?? demos[0].id)}>
              Open the apps
            </a>
            <a class="cta ghost" href={`#${demos[0].id}`} onClick={open(demos[0].id)}>
              Tour the features
            </a>
          </p>
          <ul class="facts">
            <li>
              <b>{String(apps.length)}</b> applications
            </li>
            <li>
              <b>{String(demos.length)}</b> feature demos
            </li>
            <li>
              <b>{String(THEMES.length)}</b> themes
            </li>
            <li>
              <b>{String(SURFACES.length)}</b> surfaces
            </li>
          </ul>
        </div>
        <figure class="sample">
          <figcaption>
            <span class="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            thermostat.jsx
          </figcaption>
          <pre class="code">{SAMPLE}</pre>
          <div class="live">
            <small>live</small>
            <button type="button" onClick={() => $write(celsius, $read(celsius) - 1)}>
              −
            </button>
            <output>{() => `${$read(celsius)} °C · ${$read(fahrenheit).toFixed(1)} °F`}</output>
            <button type="button" onClick={() => $write(celsius, $read(celsius) + 1)}>
              +
            </button>
          </div>
        </figure>
      </section>

      <section class="gallery" aria-label="Applications">
        <header>
          <h3>Applications</h3>
          <p>Complete products, each built on the advanced features for real reasons.</p>
        </header>
        <div class="apps">
          <For each={apps}>
            {app => (
              <a class="app-card" href={`#${app().id}`} data-app={app().id} onClick={open(app().id)}>
                <span class="art" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span class="body">
                  <small>Application</small>
                  <b>{app().title}</b>
                  <span>{app().tagline}</span>
                  <em>{`${app().apis.length} APIs →`}</em>
                </span>
              </a>
            )}
          </For>
        </div>
      </section>

      <section class="pillars" aria-label="Features">
        <header>
          <h3>What it is made of</h3>
          <p>Every feature has a live demo with its source.</p>
        </header>
        <div class="grid">
          {PILLARS.map(p => (
            <a class="pillar" href={`#${p.to}`} onClick={open(p.to)}>
              <b>{p.title}</b>
              <span>{p.text}</span>
            </a>
          ))}
        </div>
        <p class="surfaces">
          {SURFACES.map(s => (
            <span>{s}</span>
          ))}
        </p>
      </section>
    </article>
  );
}
