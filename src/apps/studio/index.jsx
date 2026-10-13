// Studio: a design tool where one document store is drawn and edited by
// several ren-core renderers at once. The canvas is a Skia root (ren-skia)
// drawing the design in portable primitives, fed the document as props and
// sending its HUD presses back; the layers and inspector are ren-dom panels on the same store; a three.js
// root (ren-three) extrudes the design into a slowly swaying model; and the
// design exports to HTML (ren-html) and data (ren-json). The canvas lays
// out on this thread or in a layout worker. A new theme restyles the
// canvas and the preview in place (each renderer's setTheme, and the
// palette through their props), keeping their state.

import { $signal, $read, $write, $lookup, $untrack, $watch } from 'rrx-core';
import { $active, Root, Pending, Recover, Label } from 'ren-core';
import { $skia } from 'ren-skia';
import { Assets } from '../../assets.js';
import { Async } from '../../async.js';
import { look, tone } from '../../themes.js';
import { loadThree, stage } from '../../demos/three.jsx';
import { Editor } from './editor.js';
import { measure, follow } from '../../kit.jsx';
import { shown } from './document.js';
import { Canvas } from './artboard.jsx';
import { Preview } from './preview.jsx';
import { Toolbar, Layers, Inspector, Exporter } from './panels.jsx';

/** The canvas, in CSS pixels, at most: a narrower page makes it narrower. */
export const WIDTH = 620;
export const HEIGHT = 460;
/** The 3D preview, at most (its shape kept). */
const PREVIEW = { width: 420, height: 300 };

/** @typedef {import('./editor.js').Studio} Studio */

/**
 * The application. `probe` receives each renderer as it is made (tests
 * read the canvas's pixels through it); `initial` replaces the starter design.
 * @param {{ probe?: (which: 'skia' | 'three', renderer: any, studio: Studio) => void, initial?: import('./document.js').Doc }} props
 */
function View(props) {
  const R = $active();
  const env = $lookup(Assets);
  const studio = Editor(R, { now: env.now, width: WIDTH, height: HEIGHT, initial: props.initial });
  studio.fit();
  // The canvas and the preview are as wide as their column (less borders and padding), up to their own
  // size; the stage is the canvas and its border.
  const middle = measure(R, WIDTH + 2);
  const lower = measure(R, PREVIEW.width + 22);
  const size = () => /** @type {[number, number]} */ ([Math.min(WIDTH, middle.width() - 2), HEIGHT]);
  const shown3d = () => {
    const width = Math.min(PREVIEW.width, lower.width() - 22);
    return /** @type {[number, number]} */ ([width, Math.round((width * PREVIEW.height) / PREVIEW.width)]);
  };
  // A new width keeps the view's centre; the first measured one fits the design again.
  let measured = false;
  $watch(R, size, ([width, height]) => {
    if (width === studio.width && height === studio.height) return;
    studio.setSize(width, height);
    if (!measured) studio.fit();
    measured = true;
  });
  const where = $signal(R, /** @type {'thread' | 'worker'} */ ('thread'));
  const orbit = $signal(R, true);
  const skia = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  // The layout worker loads only once it is chosen.
  const engine = Async(R, () => ($read(where) === 'worker' ? env.engine : null), async load => (load === null ? null : load()));
  const three = loadThree(R, env);
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  /** The canvas root's props: everything it draws, read here, where the store lives. */
  const canvas = () => ({
    doc: studio.at([]),
    camera: $read(studio.camera),
    selection: $read(studio.selection),
    guides: $read(studio.guides),
    marquee: $read(studio.marquee),
    hover: $read(studio.hover),
    tool: $read(studio.tool),
    theme: look(),
    width: size()[0],
    height: size()[1],
  });
  /** The canvas's messages: its board's gestures, and its HUD's presses. @param {any} data */
  const message = data => {
    if (data.gesture === 'down') {
      if (data.button === 0 || data.button === 1) studio.down(data.x, data.y, { shift: data.shift, button: data.button, handle: data.handle });
    } else if (data.gesture === 'move') studio.move(data.x, data.y);
    else if (data.gesture === 'up') studio.up();
    else if (data.gesture === 'leave') studio.leave();
    else if (data.gesture === 'wheel') studio.wheel(data.x, data.y, data.dx, data.dy, data.zoom);
    else if (data.zoom === 'in') studio.zoomBy(1.25);
    else if (data.zoom === 'out') studio.zoomBy(0.8);
    else if (data.zoom === 'fit') studio.fit();
    else if (data.zoom === 'reset') studio.zoomBy(1 / $read(studio.camera).zoom);
  };
  // The renderers in use: a new theme restyles them in place.
  /** @type {{ skia: any, three: any }} */
  const live = { skia: null, three: null };
  $watch(R, () => look(), theme => {
    live.skia?.setTheme(theme.ren);
    live.three?.setTheme(theme.ren);
  });
  // The studio is focusable, so after a press on its panels the shortcuts still reach it.
  return (
    <div
      class="app-studio"
      tabIndex={-1}
      onKeyDown={(/** @type {KeyboardEvent} */ e) => {
        const target = /** @type {any} */ (e.target);
        // Fields keep their own keys (and the canvas's text entry, while one of its Edits has focus).
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '') || target?.isContentEditable) return;
        if (studio.key({ key: e.key, shift: e.shiftKey, mod: e.ctrlKey || e.metaKey, alt: e.altKey })) e.preventDefault();
      }}
      onKeyUp={(/** @type {KeyboardEvent} */ e) => studio.release(e.key)}
    >
      <Toolbar studio={studio} where={where} worker={env.engine !== null} />
      <div class="work">
        <Layers studio={studio} />
        <div class="middle" ref={middle.ref}>
          {/* data-camera is the view, for tools outside: document point (x, y) is at (x · zoom + left, y · zoom + top) on the canvas. */}
          <div
            class="stage"
            data-tool={() => $read(studio.tool)}
            data-drag={() => ($read(studio.marquee) !== null ? 'marquee' : '')}
            data-camera={() => {
              const c = $read(studio.camera);
              return `${c.zoom} ${c.x} ${c.y}`;
            }}
            style={() => ({ width: `${size()[0] + 2}px`, height: `${size()[1] + 2}px` })}
            onDblClick={(/** @type {MouseEvent} */ e) => {
              // A double click on a text layer edits its text, in the inspector.
              const [id] = studio.selected();
              if (id !== undefined && studio.shape(id).kind === 'text') /** @type {any} */ (e.currentTarget)?.closest('.app-studio')?.querySelector('.inspector textarea')?.focus();
            }}
          >
            <Recover fallback={failed('The canvas')}>
              <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
                {() => {
                  const { kit, font, mono } = /** @type {any} */ ($read(skia));
                  const engaged = /** @type {any} */ ($read(engine));
                  // Where layout runs is fixed per renderer: a move to the worker makes a new canvas root. A theme is not: it is set in place.
                  const S = $active();
                  const [width, height] = $untrack(S, size);
                  const renderer = (live.skia = follow(S, $skia(kit, { font, mono, width, height, scale: env.scale(), theme: $untrack(R, look).ren, layout: engaged?.layout ?? undefined }), size));
                  props.probe?.('skia', renderer, studio);
                  return (
                    <Root id="studio-canvas" renderer={renderer} props={canvas} onMessage={message}>
                      {() => <Canvas />}
                    </Root>
                  );
                }}
              </Pending>
            </Recover>
          </div>
          <p class="status" aria-live="polite">
            <span>{() => { const p = $read(studio.cursor); return p === null ? 'x –, y –' : `x ${p.x}, y ${p.y}`; }}</span>
            <span>{() => `${Math.round($read(studio.camera).zoom * 100)}%`}</span>
            <span>{() => { const n = $read(studio.selection).length; return n === 0 ? 'nothing selected' : n === 1 ? `${studio.at(['shapes', $read(studio.selection)[0], 'name']) ?? ''} selected` : `${n} selected`; }}</span>
            <span class="where">{() => `ren-skia · layout ${$read(where) === 'worker' ? 'in a worker' : 'on this thread'}`}</span>
          </p>
        </div>
        <Inspector studio={studio} />
      </div>
      <div class="lower" ref={lower.ref}>
        <section class="panel preview" aria-label="3D preview">
          <header>
            <h3>3D preview</h3>
            <span class="note">ren-three · the same document, extruded</span>
            <button type="button" class="text" aria-pressed={() => String($read(orbit))} onClick={() => $write(orbit, !$read(orbit))}>
              {() => ($read(orbit) ? 'Pause' : 'Orbit')}
            </button>
          </header>
          <div class="scene" style={() => ({ width: `${shown3d()[0]}px`, height: `${shown3d()[1]}px` })}>
            <Recover fallback={failed('three.js')}>
              <Pending fallback={<p class="quiet">Loading three.js…</p>}>
                {() => {
                  const S = $active();
                  const [width, height] = $untrack(S, shown3d);
                  const renderer = (live.three = follow(S, stage(/** @type {any} */ ($read(three)), { width, height, theme: $untrack(R, look).ren, camera: { position: [0, 0, 7.2], fov: 45 } }), shown3d));
                  props.probe?.('three', renderer, studio);
                  return (
                    <Root id="studio-preview" renderer={renderer} props={() => ({ doc: shown(studio.at([])), orbit: $read(orbit), theme: look() })}>
                      {() => <Preview />}
                    </Root>
                  );
                }}
              </Pending>
            </Recover>
          </div>
        </section>
        <Exporter studio={studio} />
      </div>
    </div>
  );
}

export default {
  id: 'studio',
  title: 'Studio',
  tagline: 'One document, drawn and edited by Skia, the DOM and three.js at once',
  apis: ['$skia', '$three', 'setTheme', 'onPointerDown', 'onPointerLeave', 'onPointerCancel', 'touchAction', 'setPointerCapture', 'cursor', '$animate', '$html', '$json', '$dom', 'Root', 'Props', 'Send', 'remoteLayout', '$store', '$at', '$put', '$update', '$raw', '$mirror', '$batch', '$memo', '$equals', '$task', 'For', 'For by position', 'Show', 'Pending', 'Recover', 'View', 'Label', 'Shape', 'Action', 'Edit', 'style', 'display: grid'],
  summary:
    'A small design tool. The canvas is a CanvasKit root drawing the design in portable primitives on a one-cell grid, with selection, handles, snapping guides and a zoom HUD; the layers and inspector are DOM panels on the same rrx-core store; a three.js root extrudes the design into a live model; and the design exports to HTML and data. Move, resize, create, marquee, nudge, duplicate, rename, reorder, undo and redo: every renderer follows at once. Its layout runs on this thread or in a layout worker.',
  View,
};
