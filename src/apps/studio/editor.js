// Studio's editor state and every edit, on the application's graph: the
// document is an rrx-core store (persistent data, so an undo step is the
// previous root value and restoring it notifies only the paths that
// differ); the selection, tool, view, guides and marquee are signals. The
// canvas pointer gestures (select, marquee, move with snapping, resize,
// create, pan) and the keyboard shortcuts are plain functions of screen
// points and keys, so the DOM panels, the canvas and the tests drive the
// same code.

import { $signal, $read, $write, $store, $at, $put, $raw, $update, $batch, $untrack } from 'rrx-core';
import { seed, make, bounds, frame, union, pick, hits, handles, ends, resize, snap, overlaps, holds, standard } from './document.js';

/** @typedef {import('./document.js').Doc} Doc */
/** @typedef {import('./document.js').Shape} Shape */
/** @typedef {import('./document.js').Kind} Kind */
/** @typedef {import('./document.js').Box} Box */
/** @typedef {import('./document.js').Guide} Guide */
/** @typedef {import('./document.js').Handle} Handle */
/** @typedef {'select' | 'hand' | Kind} Tool */
/** @typedef {{ zoom: number, x: number, y: number }} Camera the screen point of document (0, 0) is (x, y); one unit is `zoom` pixels */

/** Zoom limits. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** How near, in screen pixels, a handle or an arrow must be to be grabbed, and a line to snap. */
const REACH = 6;
/** How far, in screen pixels, a press must travel to become a drag. */
const SLOP = 3;
/** Edits of one field within this many ms are one undo step. */
const COALESCE = 1000;
/** Undo steps kept. */
const DEPTH = 200;

/**
 * Undo and redo over a store: each step is the store's previous root value
 * (persistent data, so a step costs one reference).
 * @param {import('rrx-core').Graph} R @param {import('rrx-core').Box<Doc>} doc @param {() => number} now
 */
export function History(R, doc, now) {
  const past = $signal(R, /** @type {Doc[]} */ ([]));
  const future = $signal(R, /** @type {Doc[]} */ ([]));
  let key = '';
  let at = -Infinity;
  /** @type {Doc | null} */
  let held = null;
  /** @param {Doc} step */
  const push = step => {
    $write(past, [...$read(past).slice(1 - DEPTH), step]);
    $write(future, []);
  };
  return {
    past,
    future,
    /**
     * Marks the document before an edit. Edits under the same non-empty
     * key within a second are one step (typing in a field, nudging).
     * @param {string} [name]
     */
    mark(name = '') {
      const t = now();
      if (name !== '' && name === key && t - at < COALESCE) {
        at = t;
        return;
      }
      key = name;
      at = t;
      push($raw(doc));
    },
    /** A gesture starts: the document as it is now is its undo step, if it changes anything. */
    begin() {
      held = $raw(doc);
    },
    /** The gesture ends: one step, when the document changed. */
    end() {
      if (held !== null && held !== $raw(doc)) {
        push(held);
        key = '';
      }
      held = null;
    },
    /** @returns {boolean} whether there was a step to undo */
    undo() {
      const steps = $read(past);
      if (steps.length === 0) return false;
      $write(future, [...$read(future), $raw(doc)]);
      $write(past, steps.slice(0, -1));
      $put(doc, [], steps[steps.length - 1]);
      key = '';
      return true;
    },
    /** @returns {boolean} whether there was a step to redo */
    redo() {
      const steps = $read(future);
      if (steps.length === 0) return false;
      $write(past, [...$read(past), $raw(doc)]);
      $write(future, steps.slice(0, -1));
      $put(doc, [], steps[steps.length - 1]);
      key = '';
      return true;
    },
  };
}

/**
 * The editor: the document, what is selected and shown, and every edit.
 * @param {import('rrx-core').Graph} R
 * @param {{ now: () => number, width: number, height: number, initial?: Doc }} options the clock and the canvas size (`setSize` changes it)
 */
export function Editor(R, options) {
  let { width, height } = options;
  const doc = $store(R, options.initial ?? seed());
  const history = History(R, doc, options.now);
  const selection = $signal(R, /** @type {string[]} */ ([]));
  const tool = $signal(R, /** @type {Tool} */ ('select'));
  const camera = $signal(R, /** @type {Camera} */ ({ zoom: 1, x: 0, y: 0 }));
  const guides = $signal(R, /** @type {Guide[]} */ ([]));
  const marquee = $signal(R, /** @type {Box | null} */ (null));
  const hover = $signal(R, /** @type {string | null} */ (null));
  /** The pointer's document point, for the status bar. */
  const cursor = $signal(R, /** @type {{ x: number, y: number } | null} */ (null));
  let made = 0;
  /** A fresh id for a kind. @param {Kind} kind */
  const fresh = kind => {
    const shapes = $raw(doc).shapes;
    let id;
    do id = `${kind}-${++made}`;
    while (id in shapes);
    return id;
  };

  const shape = (/** @type {string} */ id) => /** @type {Shape} */ ($raw(doc).shapes[id]);
  /** The selected ids that still exist, in paint order. */
  const selected = () => {
    const d = $raw(doc);
    const chosen = new Set($read(selection));
    return d.order.filter(id => chosen.has(id));
  };
  /** @param {string[]} ids */
  const select = ids => {
    const d = $raw(doc);
    $write(selection, ids.filter(id => id in d.shapes));
  };

  /** Screen to document. @param {number} sx @param {number} sy */
  const toDoc = (sx, sy) => {
    const c = $read(camera);
    return { x: (sx - c.x) / c.zoom, y: (sy - c.y) / c.zoom };
  };

  // ---- Edits: each marks one undo step (or joins the running one).

  /** Merges fields into shapes. @param {string[]} ids @param {Partial<Shape>} fields @param {string} [key] */
  const change = (ids, fields, key) => {
    if (ids.length === 0) return;
    history.mark(key);
    $batch(R, () => {
      for (const id of ids) $update(doc, ['shapes', id], fields);
    });
  };
  /** Changes each shape by a function of it. @param {string[]} ids @param {(s: Shape) => Partial<Shape>} fn @param {string} [key] */
  const each = (ids, fn, key) => {
    if (ids.length === 0) return;
    history.mark(key);
    $batch(R, () => {
      for (const id of ids) $update(doc, ['shapes', id], fn(shape(id)));
    });
  };
  /** Adds a shape on top. @param {Shape} s */
  const insert = s => {
    $put(doc, ['shapes', s.id], s);
    $put(doc, ['order'], (/** @type {string[]} */ order) => [...order, s.id]);
  };
  /** @param {Kind} kind @param {Partial<Shape>} [fields] @returns {string} the new id */
  const add = (kind, fields = {}) => {
    history.mark();
    const id = fresh(kind);
    const count = $raw(doc).order.filter(i => shape(i).kind === kind).length + 1;
    $batch(R, () => insert(make(id, kind, { name: `${make(id, kind).name} ${count}`, ...fields })));
    $write(selection, [id]);
    return id;
  };
  /** @param {string[]} ids */
  const remove = ids => {
    if (ids.length === 0) return;
    history.mark();
    const gone = new Set(ids);
    $batch(R, () => {
      $put(doc, [], (/** @type {Doc} */ d) => ({ order: d.order.filter(id => !gone.has(id)), shapes: Object.fromEntries(Object.entries(d.shapes).filter(([id]) => !gone.has(id))) }));
      $write(selection, $read(selection).filter(id => !gone.has(id)));
    });
  };
  /** Copies shapes above the originals, offset, and selects the copies. @param {string[]} ids */
  const duplicate = ids => {
    if (ids.length === 0) return [];
    history.mark();
    /** @type {string[]} */
    const copies = [];
    $batch(R, () => {
      for (const id of ids) {
        const s = shape(id);
        const copy = { ...s, id: fresh(s.kind), name: `${s.name} copy`, x: s.x + 16, y: s.y + 16, locked: false };
        insert(copy);
        copies.push(copy.id);
      }
      $write(selection, copies);
    });
    return copies;
  };
  /**
   * Moves a shape in the paint order: one step forward or backward, to the
   * front or back, or to an index.
   * @param {string} id @param {'forward' | 'backward' | 'front' | 'back' | number} where
   */
  const arrange = (id, where) => {
    const order = $raw(doc).order;
    const from = order.indexOf(id);
    if (from < 0) return;
    const last = order.length - 1;
    const to = where === 'forward' ? Math.min(last, from + 1) : where === 'backward' ? Math.max(0, from - 1) : where === 'front' ? last : where === 'back' ? 0 : Math.max(0, Math.min(last, where));
    if (to === from) return;
    history.mark();
    const next = order.filter(i => i !== id);
    next.splice(to, 0, id);
    $put(doc, ['order'], next);
  };
  /** Aligns the selected shapes to their shared box. @param {'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'} edge */
  const align = edge => {
    const ids = selected();
    const box = union(ids.map(id => bounds(shape(id))));
    if (box === null || ids.length < 2) return;
    each(ids, s => {
      const b = bounds(s);
      const dx = edge === 'left' ? box.x - b.x : edge === 'center' ? box.x + box.w / 2 - (b.x + b.w / 2) : edge === 'right' ? box.x + box.w - (b.x + b.w) : 0;
      const dy = edge === 'top' ? box.y - b.y : edge === 'middle' ? box.y + box.h / 2 - (b.y + b.h / 2) : edge === 'bottom' ? box.y + box.h - (b.y + b.h) : 0;
      return { x: s.x + dx, y: s.y + dy };
    });
  };
  /** Moves the selection by a document offset (arrow keys). @param {number} dx @param {number} dy */
  const nudge = (dx, dy) =>
    each(
      selected().filter(id => !shape(id).locked),
      s => ({ x: s.x + dx, y: s.y + dy }),
      'nudge',
    );

  // ---- The view.

  /** Zooms by a factor about a screen point (the canvas centre by default). @param {number} factor @param {number} [sx] @param {number} [sy] */
  const zoomBy = (factor, sx = width / 2, sy = height / 2) => {
    const c = $read(camera);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * factor));
    const k = zoom / c.zoom;
    $write(camera, { zoom, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k });
  };
  /** Fits the shown shapes (or the selection) in the canvas, with a margin. @param {boolean} [only] the selection */
  const fit = only => {
    const d = $raw(doc);
    const ids = only ? selected() : d.order.filter(id => !d.shapes[id].hidden);
    const box = union(ids.map(id => bounds(shape(id))));
    if (box === null) return $write(camera, { zoom: 1, x: 0, y: 0 });
    const margin = 40;
    const zoom = Math.max(MIN_ZOOM, Math.min(2, (width - margin * 2) / Math.max(1, box.w), (height - margin * 2) / Math.max(1, box.h)));
    $write(camera, { zoom, x: width / 2 - (box.x + box.w / 2) * zoom, y: height / 2 - (box.y + box.h / 2) * zoom });
  };
  /** The canvas took a new size: the view keeps its centre. @param {number} w @param {number} h */
  const setSize = (w, h) => {
    if (w === width && h === height) return;
    const c = $untrack(R, () => $read(camera));
    $write(camera, { zoom: c.zoom, x: c.x + (w - width) / 2, y: c.y + (h - height) / 2 });
    width = w;
    height = h;
  };
  /** @param {number} dx @param {number} dy screen pixels */
  const pan = (dx, dy) => {
    const c = $read(camera);
    $write(camera, { zoom: c.zoom, x: c.x + dx, y: c.y + dy });
  };

  // ---- Pointer gestures on the canvas, in screen pixels.

  /**
   * The gesture under way: what it does and where it started.
   * @type {{ mode: 'none' | 'pan' | 'move' | 'resize' | 'create' | 'marquee', moved: boolean, sx: number, sy: number, start: { x: number, y: number }, camera: Camera, shapes: Shape[], box: Box | null, handle: Handle | null, id: string | null, base: string[] }}
   */
  let drag = { mode: 'none', moved: false, sx: 0, sy: 0, start: { x: 0, y: 0 }, camera: $read(camera), shapes: [], box: null, handle: null, id: null, base: [] };
  let space = false;

  /** The handle of the one selected shape under a screen point. @param {number} sx @param {number} sy @returns {Handle | null} */
  const grab = (sx, sy) => {
    const ids = selected();
    if (ids.length !== 1) return null;
    const s = shape(ids[0]);
    if (s.locked) return null;
    const c = $read(camera);
    for (const [name, x, y] of s.kind === 'arrow' ? ends(s) : handles(frame(s)))
      if (Math.abs(x * c.zoom + c.x - sx) <= REACH && Math.abs(y * c.zoom + c.y - sy) <= REACH) return name;
    return null;
  };
  /** The other shapes' boxes, to snap to. @param {Set<string>} moving */
  const targets = moving => {
    const d = $raw(doc);
    return d.order.filter(id => !moving.has(id) && !d.shapes[id].hidden).map(id => bounds(d.shapes[id]));
  };

  /**
   * A pointer went down on the canvas.
   * @param {number} sx @param {number} sy @param {{ shift?: boolean, button?: number, handle?: Handle }} [keys] `handle`: pressed on that handle of the one selected shape
   */
  const down = (sx, sy, keys = {}) => {
    const p = toDoc(sx, sy);
    const t = $read(tool);
    const base = { moved: false, sx, sy, start: p, camera: $read(camera), shapes: [], box: null, handle: null, id: null, base: [] };
    if (t === 'hand' || space || keys.button === 1) {
      drag = { ...base, mode: 'pan' };
      return;
    }
    if (t !== 'select') {
      history.begin();
      const kind = /** @type {Kind} */ (t);
      const id = fresh(kind);
      const count = $raw(doc).order.filter(i => shape(i).kind === kind).length + 1;
      $batch(R, () => {
        insert(make(id, kind, { name: `${make(id, kind).name} ${count}`, x: p.x, y: p.y, w: kind === 'arrow' ? 0 : 1, h: kind === 'arrow' ? 0 : 1 }));
        $write(selection, [id]);
      });
      drag = { ...base, mode: 'create', id };
      return;
    }
    const handle = keys.handle !== undefined && selected().length === 1 && !shape(selected()[0]).locked ? keys.handle : grab(sx, sy);
    if (handle !== null) {
      history.begin();
      const s = shape(selected()[0]);
      drag = { ...base, mode: 'resize', handle, id: s.id, shapes: [s], box: frame(s) };
      return;
    }
    const zoom = $read(camera).zoom;
    const hit = pick($raw(doc), p.x, p.y, REACH / zoom);
    if (hit === null) {
      drag = { ...base, mode: 'marquee', base: keys.shift ? selected() : [] };
      if (!keys.shift) $write(selection, []);
      return;
    }
    const current = selected();
    if (keys.shift) select(current.includes(hit) ? current.filter(id => id !== hit) : [...current, hit]);
    else if (!current.includes(hit)) $write(selection, [hit]);
    // What moves: the selection, and whatever a selected frame holds.
    const d = $raw(doc);
    const moving = new Set(selected().filter(id => !shape(id).locked));
    for (const id of [...moving]) {
      const s = shape(id);
      if (s.kind !== 'frame') continue;
      const box = bounds(s);
      for (const other of d.order.slice(d.order.indexOf(id) + 1)) if (!d.shapes[other].locked && holds(box, bounds(d.shapes[other]))) moving.add(other);
    }
    history.begin();
    const shapes = d.order.filter(id => moving.has(id)).map(shape);
    drag = { ...base, mode: 'move', shapes, box: union(shapes.map(bounds)) };
  };

  /** The pointer moved over the canvas (dragging or not). @param {number} sx @param {number} sy */
  const move = (sx, sy) => {
    const p = toDoc(sx, sy);
    $write(cursor, { x: Math.round(p.x), y: Math.round(p.y) });
    const zoom = $read(camera).zoom;
    const threshold = REACH / zoom;
    // A press that has not travelled is a click: nothing moves (or snaps) yet.
    if (drag.mode !== 'none' && !drag.moved) {
      if (Math.hypot(sx - drag.sx, sy - drag.sy) < SLOP) return;
      drag.moved = true;
    }
    switch (drag.mode) {
      case 'none':
        $write(hover, $read(tool) === 'select' ? pick($raw(doc), p.x, p.y, threshold) : null);
        return;
      case 'pan':
        $write(camera, { zoom: drag.camera.zoom, x: drag.camera.x + sx - drag.sx, y: drag.camera.y + sy - drag.sy });
        return;
      case 'move': {
        const box = /** @type {Box} */ (drag.box);
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        const snapped = snap({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, targets(new Set(drag.shapes.map(s => s.id))), threshold);
        dx += snapped.dx;
        dy += snapped.dy;
        $batch(R, () => {
          for (const s of drag.shapes) $update(doc, ['shapes', s.id], { x: s.x + dx, y: s.y + dy });
          $write(guides, snapped.guides);
          $write(hover, null);
        });
        return;
      }
      case 'resize': {
        const s = drag.shapes[0];
        const others = targets(new Set([s.id]));
        if (s.kind === 'arrow') {
          const end = snap({ x: p.x, y: p.y, w: 0, h: 0 }, others, threshold, { x: [0], y: [0] });
          const x = p.x + end.dx;
          const y = p.y + end.dy;
          const fields = drag.handle === 'start' ? { x, y, w: s.x + s.w - x, h: s.y + s.h - y } : { w: x - s.x, h: y - s.y };
          $batch(R, () => {
            $update(doc, ['shapes', s.id], fields);
            $write(guides, end.guides);
          });
          return;
        }
        const handle = /** @type {Handle} */ (drag.handle);
        // The dragged edges snap; the opposite ones stay.
        const probe = { x: p.x, y: p.y, w: 0, h: 0 };
        const edge = snap(probe, others, threshold, { x: handle.includes('e') || handle.includes('w') ? [0] : [], y: handle.includes('n') || handle.includes('s') ? [0] : [] });
        const box = resize(/** @type {Box} */ (drag.box), handle, p.x + edge.dx, p.y + edge.dy);
        $batch(R, () => {
          // A turned shape keeps its turn: its own (unturned) box follows the handle.
          $update(doc, ['shapes', s.id], box);
          $write(guides, edge.guides);
        });
        return;
      }
      case 'create': {
        const id = /** @type {string} */ (drag.id);
        const s = shape(id);
        const fields = s.kind === 'arrow' ? { w: p.x - drag.start.x, h: p.y - drag.start.y } : resize({ x: drag.start.x, y: drag.start.y, w: 0, h: 0 }, 'se', p.x, p.y);
        $update(doc, ['shapes', id], fields);
        return;
      }
      case 'marquee': {
        const box = { x: Math.min(p.x, drag.start.x), y: Math.min(p.y, drag.start.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
        const d = $raw(doc);
        // Shapes it touches; a frame only when it holds the frame whole, so a marquee inside a frame picks its contents.
        const inside = d.order.filter(id => {
          const s = d.shapes[id];
          return !s.hidden && !s.locked && (s.kind === 'frame' ? holds(box, bounds(s)) : overlaps(box, bounds(s)));
        });
        $batch(R, () => {
          $write(marquee, box);
          $write(selection, [...new Set([...drag.base, ...inside])]);
        });
        return;
      }
    }
  };

  /** The pointer came up: the gesture ends as one undo step. */
  const up = () => {
    const was = drag;
    drag = { ...drag, mode: 'none' };
    $batch(R, () => {
      if (was.mode === 'create' && was.id !== null) {
        const s = shape(was.id);
        // A click, not a drag: the kind's standard size, from the point.
        const tiny = s.kind === 'arrow' ? Math.hypot(s.w, s.h) < 4 : s.w < 4 && s.h < 4;
        if (tiny) $update(doc, ['shapes', was.id], s.kind === 'arrow' ? { w: standard('arrow').w, h: 0 } : standard(s.kind));
        $write(tool, 'select');
      }
      $write(guides, []);
      $write(marquee, null);
      history.end();
    });
  };
  /** The pointer left the canvas. */
  const leave = () => {
    $write(hover, null);
    $write(cursor, null);
  };

  /**
   * A wheel over the canvas: with Ctrl or Cmd (a pinch) it zooms about the
   * pointer, otherwise it pans.
   * @param {number} sx @param {number} sy @param {number} dx @param {number} dy @param {boolean} zoom
   */
  const wheel = (sx, sy, dx, dy, zoom) => {
    if (zoom) zoomBy(Math.exp(-dy * 0.002), sx, sy);
    else pan(-dx, -dy);
  };

  /**
   * A key pressed while the canvas (or the studio outside its fields) has
   * focus. Returns whether it was a shortcut.
   * @param {{ key: string, shift?: boolean, mod?: boolean, alt?: boolean }} k
   * @returns {boolean}
   */
  const key = k => {
    const name = k.key;
    const lower = name.length === 1 ? name.toLowerCase() : name;
    if (k.mod) {
      if (lower === 'z') return k.shift ? history.redo() || true : history.undo() || true;
      if (lower === 'y') return history.redo() || true;
      if (lower === 'd') return duplicate(selected()), true;
      if (lower === 'a') {
        const d = $raw(doc);
        return $write(selection, d.order.filter(id => !d.shapes[id].hidden && !d.shapes[id].locked)), true;
      }
      if (lower === '=' || lower === '+') return zoomBy(1.25), true;
      if (lower === '-') return zoomBy(0.8), true;
      if (lower === '0') return $write(camera, { zoom: 1, x: $read(camera).x, y: $read(camera).y }), true;
      if (lower === '1') return fit(), true;
      if (lower === ']') return selected().forEach(id => arrange(id, k.shift ? 'front' : 'forward')), true;
      if (lower === '[') return selected().forEach(id => arrange(id, k.shift ? 'back' : 'backward')), true;
      return false;
    }
    if (name === 'Delete' || name === 'Backspace') return remove(selected().filter(id => !shape(id).locked)), true;
    if (name === 'Escape') return $batch(R, () => ($write(selection, []), $write(tool, 'select'))), true;
    const step = k.shift ? 10 : 1;
    if (name === 'ArrowLeft') return nudge(-step, 0), true;
    if (name === 'ArrowRight') return nudge(step, 0), true;
    if (name === 'ArrowUp') return nudge(0, -step), true;
    if (name === 'ArrowDown') return nudge(0, step), true;
    if (name === ' ') return (space = true), true;
    /** @type {Record<string, Tool>} */
    const tools = { v: 'select', h: 'hand', f: 'frame', r: 'rect', o: 'ellipse', t: 'text', a: 'arrow' };
    if (lower in tools && !k.alt) return $write(tool, tools[lower]), true;
    return false;
  };
  /** A key came up (the space bar ends panning). @param {string} name */
  const release = name => {
    if (name === ' ') space = false;
  };

  return {
    doc,
    history,
    selection,
    tool,
    camera,
    guides,
    marquee,
    hover,
    cursor,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    setSize,
    shape,
    selected,
    select,
    toDoc,
    change,
    add,
    remove,
    duplicate,
    arrange,
    align,
    nudge,
    zoomBy,
    fit,
    pan,
    down,
    move,
    up,
    leave,
    wheel,
    key,
    release,
    /** Whether a shape is under a screen point (for tests and the cursor). @param {string} id @param {number} sx @param {number} sy */
    over: (id, sx, sy) => {
      const p = toDoc(sx, sy);
      return hits(shape(id), p.x, p.y, 0);
    },
    /** Reads the document at a path, tracked. @param {(string | number)[]} path */
    at: path => $at(doc, path),
  };
}

/** @typedef {ReturnType<typeof Editor>} Studio */

