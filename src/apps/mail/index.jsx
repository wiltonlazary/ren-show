// Mail on the page: one mail client of portable primitives (mail.jsx),
// switched live between five renderers: the DOM (ren-dom), a Skia canvas
// (ren-skia), a three.js overlay and a three.js panel tilted in a scene you
// can orbit (ren-three), and Skia with the whole client in a worker. The
// parity panel runs one script of the client's own commands on each and
// compares the text each one shows with the DOM's, and times it. The page
// is ren-dom; only it knows the renderers.

import { $signal, $read, $write, $batch, $lookup, $watch, $cleanup, $owner, $untrack, $memo, $equals } from 'rrx-core';
import { $active, $media, $viewport, Root, Runtime, Props, Pending, Recover, Show, For, Label } from 'ren-core';
import { $dom } from 'ren-dom';
import { $skia } from 'ren-skia';
import { Assets } from '../../assets.js';
import { Async } from '../../async.js';
import { look, tone } from '../../themes.js';
import { stage } from '../../demos/three.jsx';
import { measure } from '../../kit.jsx';
import { Mail, WIDTH, HEIGHT, NARROW } from './mail.jsx';
import { SCRIPT, domText, canvasText, differ } from './parity.js';

/** @typedef {'dom' | 'skia' | 'three' | 'panel' | 'worker'} Target */

/** The renderers, in the switcher's order. @type {{ id: Target, name: string, note: string }[]} */
export const TARGETS = [
  { id: 'dom', name: 'DOM', note: 'ren-dom: elements and CSS, laid out by the browser' },
  { id: 'skia', name: 'Skia', note: 'ren-skia: one CanvasKit canvas, laid out by Taffy' },
  { id: 'three', name: 'three.js overlay', note: 'ren-three: primitives over the WebGL canvas, pixel for pixel' },
  { id: 'panel', name: 'three.js panel', note: 'ren-three: the client as a textured plane in the scene; drag around it to orbit, wheel to zoom' },
  { id: 'worker', name: 'Skia + worker', note: 'ren-skia on this thread; the client, its graph and 3,000 messages in a Worker' },
];

/** The root id of each renderer's client. */
const ROOTS = /** @type {Record<Target, string>} */ ({ dom: 'mail-dom', skia: 'mail-skia', three: 'mail-three', panel: 'mail-panel', worker: 'mail-worker' });

/** The panel's field of view, and the camera distance at which it fills the canvas. */
const FOV = 50;

/**
 * One renderer's parity result.
 * @typedef {object} Result
 * @property {Target} id
 * @property {'waiting' | 'running' | 'pass' | 'fail' | 'skipped'} status
 * @property {number} matched steps whose text equals the DOM's
 * @property {number} ms the script's time, from each command to its text shown
 * @property {number} worst the slowest step, in ms
 * @property {string} note the first difference, or why it was skipped
 */

/**
 * The live root: what the parity script and the selection readout read.
 * @typedef {{ target: Target, gen: number, renderer: any, ready: boolean, ack: number, applied: number }} Live
 */

/** @param {number} ms */
const ms = ms => `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;

/**
 * The application. `probe` receives each renderer as it is made (tests
 * drive the canvases through it); `start` is the first renderer.
 * @param {{ probe?: (target: Target, renderer: any) => void, start?: Target }} props
 */
function View(props) {
  const R = $active();
  const env = $lookup(Assets);
  const element = /** @type {any} */ ($lookup(Runtime).element);
  const doc = element?.ownerDocument ?? null;
  // The client's size: as wide as the page allows, 960 to 1100 pixels; on a
  // phone (the viewport's media query) the page's width, one pane at a time
  // (mail.jsx, NARROW). The width is the application's, as measured, less
  // the stage's frame; before the first measure, the page's content box
  // (where nothing lays the page out, the full size, or on a phone the
  // viewport's width less its gutters).
  const view = $viewport();
  const phone = $media(`(max-width: ${NARROW - 1}px)`);
  const page = doc?.querySelector?.('main.page') ?? null;
  const style = page === null ? null : doc.defaultView?.getComputedStyle?.(page);
  const content = page === null ? 0 : page.clientWidth - (parseFloat(style?.paddingLeft) || 0) - (parseFloat(style?.paddingRight) || 0);
  const box = measure(R, Math.max(0, content));
  const size = $equals(
    $memo(R, () => {
      const room = box.width() - 2;
      if (!$read(phone)) return /** @type {[number, number]} */ ([room > 0 ? Math.max(960, Math.min(WIDTH, room)) : WIDTH, HEIGHT]);
      return /** @type {[number, number]} */ ([Math.max(300, Math.min(NARROW - 1, room > 0 ? room : $read(view.width) - 26)), HEIGHT]);
    }),
    (a, b) => a[0] === b[0] && a[1] === b[1],
  );

  const target = $signal(R, /** @type {Target} */ (props.start ?? 'dom'));
  const gen = $signal(R, 0);
  const still = $signal(R, false);
  const command = $signal(R, /** @type {import('./mail.jsx').Command | null} */ (null));
  const face = $signal(R, false);
  const selection = $signal(R, '');
  const running = $signal(R, false);
  const results = $signal(R, /** @type {Result[]} */ ([]));

  // CanvasKit and three.js load once a renderer needs them.
  const wants = $signal(R, { skia: props.start === 'skia' || props.start === 'worker', three: props.start === 'three' || props.start === 'panel' });
  const skia = Async(R, () => ($read(wants).skia ? (env.skia ?? 'none') : null), async load => {
    if (load === null) return null;
    if (load === 'none') throw new Error('this environment has no CanvasKit');
    return load();
  });
  const three = Async(R, () => ($read(wants).three ? (env.three ?? 'none') : null), async load => {
    if (load === null) return null;
    if (load === 'none') throw new Error('this environment has no three.js');
    return load();
  });

  /** @type {Live} */
  let live = { target: $read(target), gen: 0, renderer: null, ready: false, ack: 0, applied: 0 };
  /** The stage element, where the DOM client's host is. @type {any} */
  let stageEl = null;
  let seqs = 0;

  /** The client's props: the theme's colors, its size and the script's command. */
  const settings = () => ({ colors: look().colors, width: $read(size)[0], height: $read(size)[1], still: $read(still), command: $read(command), face: $read(face) });

  /** Shows a renderer (a fresh root when `fresh`). @param {Target} t @param {boolean} [fresh] */
  const show = (t, fresh = false) =>
    $batch(R, () => {
      if (t === 'skia' || t === 'worker') $write(wants, { ...$read(wants), skia: true });
      if (t === 'three' || t === 'panel') $write(wants, { ...$read(wants), three: true });
      $write(selection, '');
      if (fresh || t !== $read(target)) $write(gen, $read(gen) + 1);
      $write(target, t);
    });

  /** The text the live renderer shows. */
  const visible = () => {
    const r = live.renderer;
    switch (live.target) {
      case 'dom':
        return domText(stageEl?.querySelector?.(`[data-ren-root="${ROOTS.dom}"]`));
      case 'three':
        return canvasText(r?.overlay);
      case 'panel':
        return canvasText(r === null ? null : [...r.surfaces].find((/** @type {any} */ s) => s.panel));
      default:
        return canvasText(r);
    }
  };

  /** The text selected in the live renderer: the page's selection on the DOM, the canvas's own elsewhere. */
  const selected = () => {
    const r = live.renderer;
    if (live.target === 'dom') return String(doc?.defaultView?.getSelection?.()?.toString() ?? '');
    if (r === null) return '';
    if (live.target === 'skia' || live.target === 'worker') return r.copied();
    for (const s of r.surfaces) if (s.copied()) return s.copied();
    return '';
  };
  // Read on the stage's pointerup, click and keyup: the renderers' own
  // handlers (on the canvas or the page's selection, below the stage) have
  // set it by then. The click reads it again once a press inside a page
  // selection has collapsed it, after the pointerup.
  const readSelection = () => $write(selection, selected().replace(/\s+/g, ' ').trim());

  /**
   * A root for a renderer, made again when the renderer or the parity run
   * changes. A new theme restyles it in place (below): the renderer's
   * setTheme, and the colors the client reads from its props.
   * @param {Target} t
   */
  const mount = t => {
    const g = $read(gen);
    const [width, height] = $read(size);
    const theme = $untrack(R, look);
    /** @type {Live} */
    const mine = { target: t, gen: g, renderer: null, ready: false, ack: 0, applied: 0 };
    live = mine;
    const onMessage = (/** @type {any} */ data) => {
      if (data?.ready === true) mine.ready = true;
      if (typeof data?.ack === 'number') mine.ack = Math.max(mine.ack, data.ack);
    };
    const made = (/** @type {any} */ renderer) => {
      mine.renderer = renderer;
      props.probe?.(t, renderer);
      return renderer;
    };
    const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
    if (t === 'dom')
      return (
        <Root id={ROOTS.dom} renderer={made($dom(doc, { theme: theme.ren, styles: true, ...env.fonts }))} props={settings} onMessage={onMessage}>
          {() => <Mail />}
        </Root>
      );
    if (t === 'skia' || t === 'worker')
      return (
        <Recover fallback={failed('Skia')}>
          <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
            {() => {
              const loaded = /** @type {any} */ ($read(skia));
              if (loaded === null) return null;
              const renderer = made($skia(loaded.kit, { font: loaded.font, mono: loaded.mono, width, height, scale: env.scale(), theme: theme.ren }));
              if (t === 'skia')
                return (
                  <Root id={ROOTS.skia} renderer={renderer} props={settings} onMessage={onMessage}>
                    {() => <Mail />}
                  </Root>
                );
              if (env.worker === null) return <Label text="The worker runtime is unavailable here: this environment has no worker." color={tone('danger')} />;
              return <Root id={ROOTS.worker} runtime="worker" worker={/** @type {any} */ (env.worker)} renderer={renderer} props={settings} onMessage={onMessage} connect={{ applied: () => void mine.applied++ }} />;
            }}
          </Pending>
        </Recover>
      );
    return (
      <Recover fallback={failed('three.js')}>
        <Pending fallback={<p class="quiet">Loading three.js…</p>}>
          {() => {
            const loaded = /** @type {any} */ ($read(three));
            if (loaded === null) return null;
            if (t === 'three') {
              const renderer = made(stage(loaded, { width, height, scale: env.scale(), background: theme.colors.canvas, theme: theme.ren }));
              return (
                <Root id={ROOTS.three} renderer={renderer} props={settings} onMessage={onMessage}>
                  {() => <Mail />}
                </Root>
              );
            }
            // The camera's distance at which the panel, facing it, fills the canvas pixel for pixel.
            const distance = (height * 0.01) / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
            const renderer = made(stage(loaded, { width, height, scale: env.scale(), background: theme.colors.canvas, theme: theme.ren, camera: { fov: FOV, position: [0, 0, distance] } }));
            return (
              <Root id={ROOTS.panel} renderer={renderer} props={settings} onMessage={onMessage}>
                {() => <Orbit distance={distance} width={width} height={height} />}
              </Root>
            );
          }}
        </Pending>
      </Recover>
    );
  };

  // A new theme, in place: the live renderer takes its tokens (and a scene
  // its background), the client its colors through the props; nothing is
  // made again, so the open message, the selection and a draft stay.
  $watch(
    R,
    () => look(),
    theme => {
      const r = live.renderer;
      if (r === null) return;
      r.setTheme(theme.ren);
      r.scene?.background?.set?.(theme.colors.canvas);
    },
  );

  /**
   * Polls until `check` holds, every `every` ms, or fails after `limit` ms.
   * @param {() => boolean} check @param {number} [limit] @param {number} [every]
   */
  const until = (check, limit = 15000, every = 4) =>
    new Promise((resolve, reject) => {
      const end = env.now() + limit;
      const poll = () => {
        let ok = false;
        try {
          ok = check();
        } catch {
          ok = false;
        }
        if (ok) resolve(true);
        else if (env.now() > end) reject(new Error(`timed out after ${limit} ms`));
        // timer: poll, re-checks `check`, which has no event, until the deadline above fails it
        else env.later(every, poll);
      };
      poll();
    });

  /**
   * Runs the script on the live renderer: each step's command, then the
   * text once it holds still (for the worker, once no message applied
   * meanwhile). Returns each step's text and time.
   */
  const script = async () => {
    const mine = live;
    /** @type {{ text: string, ms: number }[]} */
    const out = [];
    for (const step of SCRIPT) {
      const seq = ++seqs;
      const start = env.now();
      $batch(R, () => $write(command, { seq, op: step.op, arg: step.arg }));
      await until(() => mine.ack >= seq);
      env.settle();
      let text = visible();
      let shown = env.now();
      // Still: the same text (and nothing applied) over three intervals:
      // the first read matches the baseline and counts none. Nothing reports
      // the text final (a search applies in the low lane after the ack; a
      // worker's answer overtakes its frames), so this polls, and fails once
      // the deadline passes.
      let calm = -1;
      let applied = mine.applied;
      await until(
        () => {
          const again = visible();
          if (again === text && mine.applied === applied) return ++calm >= 3;
          text = again;
          shown = env.now();
          applied = mine.applied;
          calm = 0;
          return false;
        },
        15000,
        mine.target === 'worker' ? 20 : 4,
      );
      out.push({ text, ms: shown - start });
    }
    return out;
  };

  /** The parity run: every renderer in turn, compared with the DOM. */
  const parity = async () => {
    if ($read(running)) return;
    const back = $read(target);
    const order = TARGETS.map(t => t.id);
    $batch(R, () => {
      $write(running, true);
      $write(results, order.map(id => ({ id, status: 'waiting', matched: 0, ms: 0, worst: 0, note: '' })));
    });
    /** @param {Target} id @param {Partial<Result>} change */
    const update = (id, change) => $write(results, $read(results).map(r => (r.id === id ? { ...r, ...change } : r)));
    /** @type {string[] | null} */
    let reference = null;
    try {
      for (const id of order) {
        if ((id === 'worker' && env.worker === null) || ((id === 'skia' || id === 'worker') && env.skia === null) || ((id === 'three' || id === 'panel') && env.three === null)) {
          update(id, { status: 'skipped', note: 'not available in this environment' });
          continue;
        }
        update(id, { status: 'running' });
        $batch(R, () => {
          $write(command, null);
          $write(still, true);
          $write(face, true);
        });
        show(id, true);
        const g = $read(gen);
        try {
          await until(() => live.gen === g && live.ready && visible() !== '', 30000);
          const steps = await script();
          const texts = steps.map(s => s.text);
          const total = steps.reduce((sum, s) => sum + s.ms, 0);
          const worst = steps.reduce((m, s) => Math.max(m, s.ms), 0);
          if (reference === null) reference = texts;
          const ref = reference;
          const wrong = texts.findIndex((t, i) => t !== ref[i]);
          const matched = texts.filter((t, i) => t === ref[i]).length;
          update(id, { status: wrong < 0 ? 'pass' : 'fail', matched, ms: total, worst, note: wrong < 0 ? '' : `${SCRIPT[wrong].name}: ${differ(ref[wrong], texts[wrong])}` });
        } catch (error) {
          update(id, { status: 'fail', note: String(/** @type {any} */ (error)?.message ?? error) });
        }
      }
    } finally {
      $batch(R, () => {
        $write(command, null);
        $write(still, false);
        $write(face, false);
        $write(running, false);
      });
      show(back, true);
    }
  };

  const status = () => {
    const list = $read(results);
    if (list.length === 0) return 'Not run yet';
    if ($read(running)) return `Running ${SCRIPT.length} steps on each renderer…`;
    const passed = list.filter(r => r.status === 'pass').length;
    const run = list.filter(r => r.status !== 'skipped').length;
    return `${passed} of ${run} renderers show the DOM's text after every step`;
  };

  const note = () => TARGETS.find(x => x.id === $read(target))?.note ?? '';
  const stop = $owner(R);
  if (stop !== null) $cleanup(stop, () => (live = { ...live, renderer: null }));
  return (
    <div class="app-mail" ref={box.ref} data-layout={() => ($read(size)[0] < NARROW ? 'narrow' : 'wide')}>
      <div class="mail-toolbar">
        <div class="seg" role="group" aria-label="Renderer">
          <For each={TARGETS}>
            {t => (
              <button
                type="button"
                data-target={t().id}
                aria-pressed={() => String($read(target) === t().id)}
                disabled={() => $read(running) || (t().id === 'worker' && env.worker === null)}
                onClick={() => show(t().id)}
              >
                {t().name}
              </button>
            )}
          </For>
        </div>
        <Show when={() => $read(target) === 'panel'}>
          <button type="button" class="quiet-button" aria-pressed={() => String($read(face))} disabled={running} onClick={() => $write(face, !$read(face))}>
            {() => ($read(face) ? 'Tilt the panel' : 'Face the camera')}
          </button>
        </Show>
        <span class="grow" />
        <button type="button" class="primary" disabled={running} onClick={() => void parity()}>
          {() => ($read(running) ? 'Running the parity script…' : 'Run the parity script')}
        </button>
      </div>
      <p class="mail-note">{note}</p>
      <div class="mail-scroller">
        <div class="mail-stage" ref={(/** @type {any} */ el) => (stageEl = el)} style={() => ({ width: `${$read(size)[0]}px`, height: `${$read(size)[1]}px` })} onPointerUp={readSelection} onClick={readSelection} onKeyUp={readSelection}>
          {() => mount($read(target))}
        </div>
      </div>
      <p class="mail-selection" data-selection={selection}>
        <small>Selected text</small>
        <span>{() => $read(selection) || 'nothing selected: drag, or double or triple press, over the reading pane'}</span>
      </p>
      <section class="mail-parity" aria-label="Parity">
        <header>
          <h3>Parity</h3>
          <span class="summary">{status}</span>
        </header>
        <p class="explain">
          {`The same ${SCRIPT.length} steps (keys, search, open, compose, send, scroll) run on every renderer through the client's own commands. After each step the text the renderer shows (the DOM's Labels, Actions and fields; the text commands ren-canv painted) is compared with the DOM's, and the time from the command to that text is measured.`}
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Renderer</th>
                <th>Result</th>
                <th>Steps equal</th>
                <th>Script time</th>
                <th>Slowest step</th>
                <th>First difference</th>
              </tr>
            </thead>
            <tbody>
              <For each={() => ($read(results).length === 0 ? TARGETS.map(t => ({ id: t.id, status: 'waiting', matched: 0, ms: 0, worst: 0, note: '' })) : $read(results))}>
                {r => (
                  <tr data-parity={() => r().id} class={() => r().status}>
                    <td>{() => TARGETS.find(t => t.id === r().id)?.name ?? r().id}</td>
                    <td class="verdict">{() => r().status}</td>
                    <td>{() => (r().status === 'pass' || r().status === 'fail' ? `${r().matched} / ${SCRIPT.length}` : '–')}</td>
                    <td>{() => (r().ms > 0 ? ms(r().ms) : '–')}</td>
                    <td>{() => (r().worst > 0 ? ms(r().worst) : '–')}</td>
                    <td class="diff">{() => r().note}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/**
 * The panel's scene: the client in a group, tilted, over a backdrop you drag
 * to orbit and wheel to zoom; facing the camera it fills the canvas.
 * @param {{ distance: number, width: number, height: number }} props
 */
function Orbit(props) {
  const R = $active();
  /** The theme's colors, from the props: they follow a new theme. */
  const colors = () => /** @type {any} */ ($lookup(Props))?.colors ?? look().colors;
  const TILT = { yaw: -0.42, pitch: 0.16, zoom: 1.32 };
  const yaw = $signal(R, TILT.yaw);
  const pitch = $signal(R, TILT.pitch);
  const zoom = $signal(R, TILT.zoom);
  $watch(
    R,
    () => /** @type {any} */ ($lookup(Props))?.face === true,
    facing =>
      $batch(R, () => {
        $write(yaw, facing ? 0 : TILT.yaw);
        $write(pitch, facing ? 0 : TILT.pitch);
        $write(zoom, facing ? 1 : TILT.zoom);
      }),
  );
  /** @type {{ x: number, y: number, yaw: number, pitch: number } | null} */
  let drag = null;
  const w = props.width * 0.01;
  const h = props.height * 0.01;
  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 8]} intensity={1.4} />
      <mesh
        name="backdrop"
        onPointerDown={(/** @type {any} */ e) => (drag = { x: e.x, y: e.y, yaw: $read(yaw), pitch: $read(pitch) })}
        onPointerMove={(/** @type {any} */ e) => {
          if (drag === null) return;
          $write(yaw, Math.max(-1.2, Math.min(1.2, drag.yaw + (e.x - drag.x) * 0.006)));
          $write(pitch, Math.max(-0.8, Math.min(0.8, drag.pitch + (e.y - drag.y) * 0.006)));
        }}
        onPointerUp={() => (drag = null)}
        onPointerCancel={() => (drag = null)}
        onWheel={(/** @type {any} */ e) => $write(zoom, Math.max(0.8, Math.min(2.5, $read(zoom) * (1 + (e.native?.deltaY ?? 0) * 0.001))))}
      >
        <sphereGeometry params={[40, 32, 16]} />
        <meshBasicMaterial color={() => colors().canvas} side={1} />
      </mesh>
      <group rotation={() => [$read(pitch), $read(yaw), 0]} position={() => [0, 0, props.distance * (1 - $read(zoom))]}>
        <mesh position={[0, 0, -0.08]}>
          <boxGeometry params={[w + 0.24, h + 0.24, 0.12]} />
          <meshStandardMaterial color={() => colors().raised} roughness={0.6} />
        </mesh>
        <Mail />
      </group>
    </>
  );
}

export default {
  id: 'mail',
  title: 'Mail',
  tagline: 'One mail client of portable primitives, live on the DOM, Skia, three.js and a worker',
  apis: [
    'View', 'Scroll', 'Label', 'Edit', 'Action', 'Shape', 'style', 'display: grid', 'hover', 'press', 'focus',
    'onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel', 'touchAction', 'onWheel', '$media', '$viewport', 'setPointerCapture', 'onKey', 'onSubmit', 'onFocus', 'onBlur', 'ref.focus()', 'cursor', 'prevent', 'setTheme',
    '$dom', '$skia', '$three', 'Root runtime="worker"', 'serve', 'connect', 'Props', 'Send',
    'For', 'Show', '$defer', '$memo', '$batch', '$watch', 'text selection', 'commands()',
  ],
  summary:
    'A three-pane mail client with 3,000 seeded messages, written once with the portable primitives and switched live between the DOM, a Skia canvas, a three.js overlay, a three.js panel you can orbit, and Skia with the client in a worker. A windowed list keyed by slot, scrolled by the wheel and a thumb that captures the pointer; keyboard triage from one onKey on the client\u2019s root (j, k, Enter, e, s, u, r, c, z; / and c focus their fields through refs); search in the low lane that keeps the old results until the new ones are ready; optimistic star and archive with undo; compose and send; selectable text everywhere; a new theme restyles the live client in place (setTheme). The parity panel runs one script on every renderer and compares the text each shows with the DOM’s, with timings.',
  View,
};
