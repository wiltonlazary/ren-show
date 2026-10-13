// Studio's DOM panels (ren-dom, on the application's graph, reading the same
// store the canvas draws): the toolbar, the layers list (a keyed For with
// rename, drag to reorder, hide and lock), the inspector (Edits for the
// geometry and text, the theme's series as fill swatches, arrange and
// align) and the export (the design as HTML through ren-html's $html and
// as data through ren-json's $json).

import { $signal, $read, $write, $raw, $memo, $equals, $lookup, $watch, $cleanup, $owner, $after } from 'rrx-core';
import { $active, For, Show, Pending, Recover, Edit, Runtime } from 'ren-core';
import { $html } from 'ren-html';
import { $json } from 'ren-json';
import { Assets } from '../../assets.js';
import { Async } from '../../async.js';
import { Look, look } from '../../themes.js';
import { TOKENS, cssPaint, bounds, shown, turns } from './document.js';
import { Design } from './artboard.jsx';

/** @typedef {import('./editor.js').Studio} Studio */
/** @typedef {import('./editor.js').Tool} Tool */
/** @typedef {import('./document.js').Shape} Shape */

/** The tools, their labels and shortcuts. @type {[Tool, string, string][]} */
export const TOOLS = [
  ['select', 'Select', 'V'],
  ['hand', 'Hand', 'H'],
  ['frame', 'Frame', 'F'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'O'],
  ['text', 'Text', 'T'],
  ['arrow', 'Arrow', 'A'],
];

/** An icon, drawn with the current color. @param {string} name */
export function icon(name) {
  const svg = (/** @type {any} */ body) => (
    <svg class="icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      {body}
    </svg>
  );
  switch (name) {
    case 'select':
      return svg(<path d="M5 3.5l10 5.2-4.4 1.3-1.9 4.5z" fill="currentColor" />);
    case 'hand':
      return svg(<path d="M7 10V5.5a1.2 1.2 0 0 1 2.4 0V9m0-4.8a1.2 1.2 0 0 1 2.4 0V9m0-3.2a1.2 1.2 0 0 1 2.4 0V11a5 5 0 0 1-5 5h-.6a4 4 0 0 1-3.3-1.8L3.6 11a1.2 1.2 0 0 1 2-1.3L7 11.5" />);
    case 'frame':
      return svg(<path d="M6 2.5v15M14 2.5v15M2.5 6h15M2.5 14h15" />);
    case 'rect':
      return svg(<rect x="3.5" y="5" width="13" height="10" rx="2" />);
    case 'ellipse':
      return svg(<circle cx="10" cy="10" r="6.5" />);
    case 'text':
      return svg(<path d="M4.5 5V3.8h11V5M10 3.8v12.4M7.5 16.2h5" />);
    case 'arrow':
      return svg(<path d="M4 16L16 4m0 0h-6m6 0v6" />);
    case 'undo':
      return svg(<path d="M7.5 5L4 8.5 7.5 12M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9" />);
    case 'redo':
      return svg(<path d="M12.5 5L16 8.5 12.5 12M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11" />);
    case 'eye':
      return svg(<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5zm7.5 2.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z" />);
    case 'hidden':
      return svg(<path d="M3 3l14 14M8 5.3A7.7 7.7 0 0 1 10 5c4.7 0 7.5 5 7.5 5a13 13 0 0 1-2.2 2.7M12.4 14.6A7 7 0 0 1 10 15c-4.7 0-7.5-5-7.5-5a13 13 0 0 1 3.1-3.4" />);
    case 'lock':
      return svg(<path d="M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 5 0V9" />);
    case 'unlock':
      return svg(<path d="M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 4.8-1" />);
    default:
      return svg(<circle cx="10" cy="10" r="2" />);
  }
}

/**
 * The toolbar: tools, undo and redo, zoom, and where the canvas lays out.
 * @param {{ studio: Studio, where: import('rrx-core').Writable<'thread' | 'worker'>, worker: boolean }} props
 */
export function Toolbar(props) {
  const { studio, where } = props;
  const zoom = () => `${Math.round($read(studio.camera).zoom * 100)}%`;
  return (
    <header class="bar">
      <div class="file">
        <span class="logo" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          <strong>Studio</strong>
          <small>Dashboard mockup</small>
        </span>
      </div>
      <div class="tools" role="toolbar" aria-label="Tools">
        {TOOLS.map(([tool, label, key]) => (
          <button
            type="button"
            class={() => ($read(studio.tool) === tool ? 'tool on' : 'tool')}
            data-tool={tool}
            title={`${label} (${key})`}
            aria-label={label}
            aria-pressed={() => String($read(studio.tool) === tool)}
            onClick={() => $write(studio.tool, tool)}
          >
            {icon(tool)}
          </button>
        ))}
      </div>
      <div class="group" role="group" aria-label="History">
        <button type="button" class="tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={() => $read(studio.history.past).length === 0} onClick={() => studio.history.undo()}>
          {icon('undo')}
        </button>
        <button type="button" class="tool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={() => $read(studio.history.future).length === 0} onClick={() => studio.history.redo()}>
          {icon('redo')}
        </button>
      </div>
      <div class="group zoom" role="group" aria-label="Zoom">
        <button type="button" class="tool" aria-label="Zoom out" onClick={() => studio.zoomBy(0.8)}>
          −
        </button>
        <span class="level" aria-live="polite">
          {zoom}
        </span>
        <button type="button" class="tool" aria-label="Zoom in" onClick={() => studio.zoomBy(1.25)}>
          +
        </button>
        <button type="button" class="text" onClick={() => studio.fit()}>
          Fit
        </button>
      </div>
      {props.worker ? (
        <div class="segmented" role="radiogroup" aria-label="Canvas layout">
          {/** @type {['thread' | 'worker', string][]} */ ([
            ['thread', 'This thread'],
            ['worker', 'Layout worker'],
          ]).map(([place, label]) => (
            <button type="button" role="radio" aria-checked={() => String($read(where) === place)} class={() => ($read(where) === place ? 'on' : '')} onClick={() => $write(where, place)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

/**
 * The layers list, topmost first: select (Shift adds), double-click to
 * rename, drag to reorder, hide and lock.
 * @param {{ studio: Studio }} props
 */
export function Layers(props) {
  const { studio } = props;
  const R = $active();
  const renaming = $signal(R, /** @type {string | null} */ (null));
  const chosen = $memo(R, () => new Set($read(studio.selection)));
  /** The row being dragged. @type {string | null} */
  let dragged = null;
  const top = () => [.../** @type {string[]} */ (studio.at(['order']))].reverse();
  return (
    <section class="panel layers" aria-label="Layers">
      <h3>
        Layers <span class="count">{() => String(studio.at(['order']).length)}</span>
      </h3>
      <ol role="listbox" aria-multiselectable="true">
        <For each={top}>
          {row => {
            const id = row();
            const get = () => /** @type {Shape | null} */ (studio.at(['shapes', id]));
            const field = (/** @type {keyof Shape} */ name) => () => get()?.[name];
            let draft = $raw(studio.doc).shapes[id].name;
            const commit = () => {
              if ($read(renaming) !== id) return;
              $write(renaming, null);
              const name = draft.trim();
              if (name !== '' && name !== get()?.name) studio.change([id], { name });
            };
            return (
              <li
                role="option"
                data-id={id}
                draggable="true"
                aria-selected={() => String($read(chosen).has(id))}
                class={() => ['layer', $read(chosen).has(id) ? 'on' : '', field('hidden')() ? 'off' : '', $read(studio.hover) === id ? 'hot' : ''].join(' ').trim()}
                onClick={(/** @type {MouseEvent} */ e) => {
                  const current = $read(studio.selection);
                  studio.select(e.shiftKey ? (current.includes(id) ? current.filter(i => i !== id) : [...current, id]) : [id]);
                }}
                onDblClick={() => {
                  draft = get()?.name ?? '';
                  $write(renaming, id);
                }}
                onPointerEnter={() => $write(studio.hover, id)}
                onPointerLeave={() => $write(studio.hover, null)}
                onDragStart={(/** @type {DragEvent} */ e) => {
                  dragged = id;
                  e.dataTransfer?.setData('text/plain', id);
                }}
                onDragOver={(/** @type {DragEvent} */ e) => e.preventDefault()}
                onDrop={(/** @type {DragEvent} */ e) => {
                  e.preventDefault();
                  const from = dragged ?? e.dataTransfer?.getData('text/plain') ?? null;
                  dragged = null;
                  // Dropped on a row: the dragged layer takes that row's place.
                  if (from !== null && from !== id) studio.arrange(from, $raw(studio.doc).order.indexOf(id));
                }}
              >
                <span class="kind">{icon(get()?.kind ?? 'rect')}</span>
                <Show when={() => $read(renaming) === id} fallback={<span class="name">{field('name')}</span>}>
                  <Edit
                    label="Layer name"
                    value={draft}
                    style={{ width: 120, height: 24 }}
                    ref={(/** @type {any} */ el) => $after(R, () => (el.focus?.(), el.select?.()))}
                    onChange={e => (draft = e.value)}
                    onSubmit={commit}
                    onBlur={commit}
                    onKey={e => {
                      if (e.key === 'Escape') $write(renaming, null);
                    }}
                  />
                </Show>
                <button
                  type="button"
                  class="mini"
                  aria-label={() => (field('hidden')() ? 'Show' : 'Hide')}
                  title={() => (field('hidden')() ? 'Show' : 'Hide')}
                  onClick={(/** @type {MouseEvent} */ e) => {
                    e.stopPropagation();
                    studio.change([id], { hidden: !get()?.hidden });
                  }}
                >
                  {() => icon(field('hidden')() ? 'hidden' : 'eye')}
                </button>
                <button
                  type="button"
                  class={() => (field('locked')() ? 'mini pinned' : 'mini')}
                  aria-label={() => (field('locked')() ? 'Unlock' : 'Lock')}
                  title={() => (field('locked')() ? 'Unlock' : 'Lock')}
                  onClick={(/** @type {MouseEvent} */ e) => {
                    e.stopPropagation();
                    studio.change([id], { locked: !get()?.locked });
                  }}
                >
                  {() => icon(field('locked')() ? 'lock' : 'unlock')}
                </button>
              </li>
            );
          }}
        </For>
      </ol>
    </section>
  );
}

/** A number for a field: whole, or one decimal. @param {number} n */
const shortly = n => String(Math.round(n * 10) / 10);

/**
 * A numeric field bound to a shape's value: typing a number writes it
 * (one undo step per field while typing); anything else waits.
 * @param {{ label: string, get: () => number, set: (n: number) => void }} props
 */
function Number_(props) {
  return (
    <label class="num">
      <span>{props.label}</span>
      <Edit
        label={props.label}
        value={() => shortly(props.get())}
        style={{ width: 64, height: 28 }}
        onChange={e => {
          const n = Number(e.value);
          if (e.value.trim() !== '' && Number.isFinite(n)) props.set(n);
        }}
        onKey={e => {
          if (e.key === 'ArrowUp') props.set(props.get() + 1);
          else if (e.key === 'ArrowDown') props.set(props.get() - 1);
        }}
      />
    </label>
  );
}

/**
 * Paint swatches: the theme's series, then its neutrals.
 * @param {{ label: string, get: () => string | undefined, set: (token: string) => void }} props
 */
function Swatches(props) {
  return (
    <div class="swatches" role="radiogroup" aria-label={props.label}>
      {TOKENS.map(token => (
        <button
          type="button"
          role="radio"
          class={() => (props.get() === token ? 'swatch on' : 'swatch')}
          data-token={token}
          aria-label={`${props.label} ${token}`}
          aria-checked={() => String(props.get() === token)}
          title={token}
          style={{ '--paint': cssPaint(token) }}
          onClick={() => props.set(token)}
        />
      ))}
    </div>
  );
}

/**
 * The inspector: the selected shape's geometry, paint, text and layer;
 * alignment for several; the document and shortcuts for none.
 * @param {{ studio: Studio }} props
 */
export function Inspector(props) {
  const { studio } = props;
  const R = $active();
  // The selected ids that exist, in paint order; the same ids keep the view.
  const ids = $equals(
    $memo(R, () => {
      const d = /** @type {import('./document.js').Doc} */ (studio.at([]));
      const chosen = new Set($read(studio.selection));
      return d.order.filter(id => chosen.has(id));
    }),
    (/** @type {string[]} */ a, /** @type {string[]} */ b) => a.length === b.length && a.every((id, i) => id === b[i]),
  );
  return (
    <aside class="panel inspector" aria-label="Inspector">
      {() => {
        const list = /** @type {string[]} */ ($read(ids));
        if (list.length === 0) return <Overview studio={studio} />;
        if (list.length > 1) return <Several studio={studio} ids={list} />;
        return <One studio={studio} id={list[0]} />;
      }}
    </aside>
  );
}

/** Nothing selected: the document and the shortcuts. @param {{ studio: Studio }} props */
function Overview(props) {
  const { studio } = props;
  const count = (/** @type {string} */ kind) => () => String(studio.at(['order']).filter((/** @type {string} */ id) => studio.at(['shapes', id, 'kind']) === kind).length);
  return (
    <>
      <h3>Design</h3>
      <dl class="facts">
        <dt>Shapes</dt>
        <dd>{() => String(studio.at(['order']).length)}</dd>
        <dt>Frames</dt>
        <dd>{count('frame')}</dd>
        <dt>Text layers</dt>
        <dd>{count('text')}</dd>
        <dt>Undo steps</dt>
        <dd>{() => String($read(studio.history.past).length)}</dd>
      </dl>
      <h3>Shortcuts</h3>
      <ul class="keys">
        {[
          ['V H F R O T A', 'tools'],
          ['Drag · Shift', 'marquee · add'],
          ['Ctrl Z · Ctrl ⇧ Z', 'undo · redo'],
          ['Ctrl D · Delete', 'duplicate · delete'],
          ['Arrows · ⇧', 'nudge 1 · 10'],
          ['Space + drag · wheel', 'pan'],
          ['Ctrl + wheel', 'zoom at the pointer'],
          ['Ctrl ] · Ctrl [', 'forward · backward'],
        ].map(([keys, what]) => (
          <li>
            <kbd>{keys}</kbd>
            <span>{what}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Several selected: alignment, paint for all, delete. @param {{ studio: Studio, ids: string[] }} props */
function Several(props) {
  const { studio, ids } = props;
  const first = () => /** @type {Shape | null} */ (studio.at(['shapes', ids[0]]));
  return (
    <>
      <h3>{`${ids.length} layers`}</h3>
      <div class="align" role="group" aria-label="Align">
        {/** @type {['left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', string][]} */ ([
          ['left', 'Left'],
          ['center', 'Centre'],
          ['right', 'Right'],
          ['top', 'Top'],
          ['middle', 'Middle'],
          ['bottom', 'Bottom'],
        ]).map(([edge, label]) => (
          <button type="button" class="text" onClick={() => studio.align(edge)}>
            {`Align ${label.toLowerCase()}`}
          </button>
        ))}
      </div>
      <h4>Fill</h4>
      <Swatches label="Fill" get={() => first()?.fill} set={token => studio.change(ids, { fill: token })} />
      <h4>Stroke</h4>
      <Swatches label="Stroke" get={() => first()?.stroke} set={token => studio.change(ids, { stroke: token, line: Math.max(1, first()?.line ?? 1) })} />
      <div class="actions">
        <button type="button" class="text" onClick={() => studio.duplicate(ids)}>
          Duplicate
        </button>
        <button type="button" class="text danger" onClick={() => studio.remove(ids)}>
          Delete
        </button>
      </div>
    </>
  );
}

/** One selected: every property of the shape. @param {{ studio: Studio, id: string }} props */
function One(props) {
  const { studio, id } = props;
  let last = /** @type {Shape} */ ($raw(studio.doc).shapes[id]);
  const get = () => (last = /** @type {Shape | null} */ (studio.at(['shapes', id])) ?? last);
  const kind = last.kind;
  /** A numeric field of the shape. @param {string} label @param {'x' | 'y' | 'w' | 'h' | 'rotation' | 'radius' | 'line' | 'size'} name */
  const number = (label, name) => <Number_ label={label} get={() => get()[name]} set={n => studio.change([id], { [name]: name === 'w' || name === 'h' ? (kind === 'arrow' ? n : Math.max(1, n)) : name === 'size' ? Math.max(4, n) : n }, `${id}:${name}`)} />;
  return (
    <>
      <div class="title">
        <span class="kind">{icon(kind)}</span>
        <Edit label="Name" value={() => get().name} style={{ grow: 1, height: 28 }} onChange={e => e.value.trim() !== '' && studio.change([id], { name: e.value }, `${id}:name`)} />
      </div>
      <h4>{kind === 'arrow' ? 'Start and run' : 'Position and size'}</h4>
      <div class="grid">
        {number('X', 'x')}
        {number('Y', 'y')}
        {number(kind === 'arrow' ? 'DX' : 'W', 'w')}
        {number(kind === 'arrow' ? 'DY' : 'H', 'h')}
        {turns(last) ? number('°', 'rotation') : null}
        {kind === 'rect' || kind === 'frame' ? number('R', 'radius') : null}
      </div>
      {kind === 'text' ? (
        <>
          <h4>Text</h4>
          <Edit label="Text" lines={3} value={() => get().text} style={{ width: 216 }} onChange={e => studio.change([id], { text: e.value }, `${id}:text`)} />
          <div class="grid">{number('Size', 'size')}</div>
        </>
      ) : null}
      {kind === 'arrow' ? null : (
        <>
          <h4>{kind === 'text' ? 'Color' : 'Fill'}</h4>
          <Swatches label={kind === 'text' ? 'Color' : 'Fill'} get={() => get().fill} set={token => studio.change([id], { fill: token })} />
        </>
      )}
      {kind === 'text' ? null : (
        <>
          <h4>Stroke</h4>
          <Swatches label="Stroke" get={() => get().stroke} set={token => studio.change([id], { stroke: token, line: token === 'none' ? get().line : Math.max(1, get().line) })} />
          <div class="grid">{number('Width', 'line')}</div>
        </>
      )}
      <h4>Layer</h4>
      <div class="actions">
        <button type="button" class="text" aria-pressed={() => String(get().hidden)} onClick={() => studio.change([id], { hidden: !get().hidden })}>
          {() => (get().hidden ? 'Show' : 'Hide')}
        </button>
        <button type="button" class="text" aria-pressed={() => String(get().locked)} onClick={() => studio.change([id], { locked: !get().locked })}>
          {() => (get().locked ? 'Unlock' : 'Lock')}
        </button>
      </div>
      <div class="actions">
        {/** @type {['front' | 'forward' | 'backward' | 'back', string][]} */ ([
          ['front', 'To front'],
          ['forward', 'Forward'],
          ['backward', 'Backward'],
          ['back', 'To back'],
        ]).map(([where, label]) => (
          <button type="button" class="text" onClick={() => studio.arrange(id, where)}>
            {label}
          </button>
        ))}
      </div>
      <div class="actions">
        <button type="button" class="text" onClick={() => studio.duplicate([id])}>
          Duplicate
        </button>
        <button type="button" class="text danger" onClick={() => studio.remove([id])}>
          Delete
        </button>
      </div>
      <p class="hint">{() => {
        const b = bounds(get());
        return `Covers ${Math.round(b.w)} × ${Math.round(b.h)} at ${Math.round(b.x)}, ${Math.round(b.y)}`;
      }}</p>
    </>
  );
}

/**
 * The export: the design as HTML (ren-html) or as data (ren-json), made
 * again a moment after the document or the theme changes, with a copy.
 * @param {{ studio: Studio }} props
 */
export function Exporter(props) {
  const { studio } = props;
  const R = $active();
  const env = $lookup(Assets);
  const format = $signal(R, /** @type {'html' | 'json'} */ ('html'));
  const copied = $signal(R, '');
  // The export follows the document a moment later, once edits pause (a
  // drag writes every frame), as an update of its own: an edit never
  // waits for the export, whose pending render holds only this panel.
  const snapshot = $signal(R, shown($raw(studio.doc)));
  /** @type {(() => void) | null} */
  let cancel = null;
  $watch(R, () => studio.at([]), (/** @type {import('./document.js').Doc} */ doc) => {
    cancel?.();
    // timer: feature, the export's debounce
    cancel = env.later(Math.round(150 * env.pace), () => $write(snapshot, shown(doc)));
  });
  $cleanup(/** @type {any} */ ($owner(R)), () => cancel?.());
  const output = Async(
    R,
    () => ({ format: $read(format), doc: $read(snapshot), theme: look() }),
    async input => {
      const options = { id: 'studio-export', props: input.doc, provide: /** @type {any} */ ([[Look, input.theme]]) };
      // The HTML carries the current theme's tokens, as the page shows them.
      if (input.format === 'html') return await $html(() => <Design />, { ...options, theme: input.theme.ren });
      return JSON.stringify(await $json(() => <Design />, options), null, 2);
    },
  );
  const copy = async () => {
    const text = /** @type {string} */ ($read(output));
    const view = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument?.defaultView;
    try {
      await view.navigator.clipboard.writeText(text);
      $write(copied, `Copied ${text.length.toLocaleString('en')} characters`);
    } catch {
      $write(copied, 'The clipboard is unavailable here: select the code instead');
    }
  };
  return (
    <section class="panel export" aria-label="Export">
      <header>
        <h3>Export</h3>
        <div class="segmented" role="tablist" aria-label="Format">
          {/** @type {['html' | 'json', string][]} */ ([
            ['html', 'HTML · ren-html'],
            ['json', 'Data · ren-json'],
          ]).map(([f, label]) => (
            <button type="button" role="tab" aria-selected={() => String($read(format) === f)} class={() => ($read(format) === f ? 'on' : '')} onClick={() => $write(format, f)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" class="text" onClick={copy}>
          Copy
        </button>
      </header>
      <Recover fallback={(/** @type {Error} */ error) => <p class="quiet">{`The export failed: ${error.message}`}</p>}>
        <Pending fallback={<p class="quiet">Rendering the export…</p>}>
          <p class="meta">
            {() => {
              const text = /** @type {string} */ ($read(output));
              const f = $read(format);
              const count = f === 'html' ? (text.match(/<[a-z]/g) ?? []).length : (text.match(/"role":/g) ?? []).length;
              return `${(text.length / 1024).toFixed(1)} kB · ${count} ${f === 'html' ? 'elements' : 'nodes'}${$read(copied) === '' ? '' : ` · ${$read(copied)}`}`;
            }}
          </p>
          <pre class="code" data-format={format}>{() => /** @type {string} */ ($read(output))}</pre>
        </Pending>
      </Recover>
    </section>
  );
}
