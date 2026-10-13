// A renderer of your own, on ren-canv: Blueprint subclasses ren-canv's
// Document, measures its text with the font file's own advances (Sfnt),
// and replays each painted frame on a plain 2D canvas as a blueprint:
// outlines where the other renderers fill, read from the frame's decoded
// commands (decode). ren-canv's render puts a view on it, attach routes the
// canvas's pointer and keys to it, and its layout runs in a worker whose
// engine is ren-show's own (stack.js, set there with useLayout).

import { $signal, $read, $write, $lookup, $untrack, $owner, $cleanup } from 'rrx-core';
import { $active, Pending, Recover, Label, Action, Edit, Layout, View as Box, For } from 'ren-core';
import { Document, Sfnt, render, attach, decode, remoteLayout } from 'ren-canv';
import { color } from 'ren-dom';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block, Value, measure, follow } from '../kit.jsx';
import { look, tone } from '../themes.js';

/** The canvas's height; its width follows its block, up to WIDTH. */
const WIDTH = 420;
const HEIGHT = 300;

/**
 * The blueprint's inks, as CSS colors.
 * @typedef {{ ground: string, line: string, wash: string, ink: string }} Inks
 */

/**
 * Draws decoded commands on a 2D context as a blueprint: every fill is an
 * outline over a light wash, borders and figures are strokes, text is
 * text, clips and transforms are kept.
 * @param {CanvasRenderingContext2D} ctx @param {(string | number)[][]} list @param {number} scale @param {Inks} inks @param {string} family
 */
export function blueprint(ctx, list, scale, inks, family) {
  const n = (/** @type {string | number} */ v) => /** @type {number} */ (v);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = inks.ground;
  ctx.fillRect(0, 0, ctx.canvas.width / scale, ctx.canvas.height / scale);
  ctx.lineWidth = 1;
  ctx.strokeStyle = inks.line;
  /** A box outlined over the wash, its corners rounded by `r`. @param {number} x @param {number} y @param {number} right @param {number} bottom @param {number} r */
  const outline = (x, y, right, bottom, r) => {
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, Math.max(0, right - x - 1), Math.max(0, bottom - y - 1), Math.max(0, r));
    ctx.fillStyle = inks.wash;
    ctx.fill();
    ctx.stroke();
  };
  for (const c of list) {
    switch (c[0]) {
      case 'text':
        ctx.font = `${n(c[6]) & 2 ? 'italic ' : ''}${n(c[6]) & 1 ? 'bold ' : ''}${n(c[4])}px ${family}`;
        ctx.fillStyle = inks.ink;
        ctx.fillText(String(c[1]), n(c[2]), n(c[3]));
        break;
      case 'rect':
      case 'gradient':
        outline(n(c[1]), n(c[2]), n(c[3]), n(c[4]), 0);
        break;
      case 'round':
      case 'border':
        outline(n(c[1]), n(c[2]), n(c[3]), n(c[4]), n(c[6]));
        break;
      case 'rround':
      case 'rborder':
      case 'edges':
        outline(n(c[1]), n(c[2]), n(c[3]), n(c[4]), n(c[c[0] === 'edges' ? 5 : c[0] === 'rround' ? 6 : 7]));
        break;
      case 'line':
        ctx.beginPath();
        ctx.moveTo(n(c[1]), n(c[2]));
        ctx.lineTo(n(c[3]), n(c[4]));
        ctx.stroke();
        break;
      case 'oval':
        ctx.beginPath();
        ctx.ellipse((n(c[1]) + n(c[3])) / 2, (n(c[2]) + n(c[4])) / 2, (n(c[3]) - n(c[1])) / 2, (n(c[4]) - n(c[2])) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'path': {
        ctx.beginPath();
        for (let i = 5; i + 1 < c.length; i += 2) (i === 5 ? ctx.moveTo : ctx.lineTo).call(ctx, n(c[i]), n(c[i + 1]));
        if (c[3]) ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'image':
      case 'picture': {
        const [x, y, right, bottom] = [n(c[2]), n(c[3]), n(c[4]), n(c[5])];
        outline(x, y, right, bottom, 0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(right, bottom);
        ctx.moveTo(right, y);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        break;
      }
      case 'clip':
      case 'rclip':
        ctx.beginPath();
        ctx.rect(n(c[1]), n(c[2]), n(c[3]) - n(c[1]), n(c[4]) - n(c[2]));
        ctx.clip();
        break;
      case 'save':
        ctx.save();
        break;
      case 'layer':
        ctx.save();
        ctx.globalAlpha *= n(c[1]);
        break;
      case 'restore':
        ctx.restore();
        break;
      case 'transform':
        ctx.transform(n(c[1]), n(c[2]), n(c[3]), n(c[4]), n(c[5]), n(c[6]));
        break;
      case 'dash':
        ctx.setLineDash(c.slice(3).map(n));
        break;
      default:
        // Shadows and shades: a blueprint draws none.
        break;
    }
  }
}

/**
 * The Blueprint renderer: a ren-canv Document drawn on a 2D canvas. Where
 * the canvas has no 2D context (the tests), it still paints and keeps each
 * frame's commands.
 */
export class Blueprint extends Document {
  /**
   * @param {ArrayBuffer | Uint8Array} font the typeface's bytes, measured by Sfnt
   * @param {{ canvas: any, inks: Inks, family: string } & import('ren-canv').Options} options
   */
  constructor(font, options) {
    super(new Sfnt(font), options);
    this.canvas = options.canvas;
    /** @type {CanvasRenderingContext2D | null} */
    this.ctx = typeof this.canvas?.getContext === 'function' ? this.canvas.getContext('2d') : null;
    this.inks = options.inks;
    this.family = options.family;
    /** The last frame's commands, and the count of frames drawn. @type {(string | number)[][]} */
    this.decoded = [];
    this.painted = 0;
    /** Told after each frame. */
    this.drawn = () => {};
    this.sized();
  }

  get kind() {
    return 'blueprint';
  }

  get drawing() {
    return true;
  }

  sized() {
    super.sized();
    const canvas = this.canvas;
    if (canvas == null) return;
    canvas.width = Math.round(this.width * this.scale);
    canvas.height = Math.round(this.height * this.scale);
    canvas.style.width = `${this.width}px`;
    canvas.style.height = `${this.height}px`;
  }

  /** @param {import('ren-canv').Frame} frame */
  draw(frame) {
    // The whole page, each frame: a blueprint is cheap to draw.
    this.decoded = decode(frame);
    this.painted++;
    if (this.ctx !== null) blueprint(this.ctx, this.decoded, this.scale, this.inks, this.family);
    this.drawn();
  }
}

/** A work order: what the Blueprint renders, portable primitives only. */
export function Order() {
  const R = $active();
  const lines = $signal(R, ['Cut the panels', 'Sand the edges']);
  const draft = $signal(R, '');
  const add = () => {
    const text = $read(draft).trim() || `Step ${$read(lines).length + 1}`;
    $write(lines, [...$read(lines), text]);
    $write(draft, '');
  };
  return (
    <Box gap={8} pad={14}>
      <Label text="Work order 14" size={18} style={{ fontWeight: 'bold' }} />
      <For each={lines}>
        {(line, i) => (
          <Layout layout="row" gap={8}>
            <Label text={() => `${i() + 1}.`} width={22} />
            <Label text={line} style={{ grow: 1 }} />
          </Layout>
        )}
      </For>
      <Layout layout="row" gap={8}>
        <Edit label="Next step" value={draft} onChange={e => $write(draft, e.value)} onSubmit={add} width={180} />
        <Action text="Add a step" onPress={add} />
      </Layout>
      <Label text={() => `${$read(lines).length} steps`} color={tone('muted')} />
    </Box>
  );
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const faces = Async(R, () => env.typefaces, async load => {
    if (load === null) throw new Error('this environment has no font files');
    if (env.worker === null) throw new Error('this environment has no workers');
    return load();
  });
  const frames = $signal(R, 0);
  const commands = $signal(R, /** @type {(string | number)[][]} */ ([]));
  const box = measure(R, WIDTH);
  const size = () => /** @type {[number, number]} */ ([Math.min(WIDTH, box.width()), HEIGHT]);
  /** @type {any} */
  let canvas = null;
  return (
    <div class="demo">
      <Block title="Blueprint, a renderer in a page of code" note="Blueprint subclasses ren-canv's Document: the engine keeps the scene, lays it out, paints it into a command buffer and routes input; Blueprint only draws each frame, here as outlines on a 2D canvas. ren-canv's render puts the work order on it, attach routes the canvas's pointer and keys, and Sfnt measures the text with the font file's advances. Click the field, type a step, press Add a step.">
        <div ref={box.ref}>
          <canvas class="blueprint" ref={(/** @type {any} */ el) => (canvas = el)} />
          <Recover fallback={(/** @type {Error} */ error) => <Label text={`Blueprint is unavailable: ${error.message}`} color={tone('danger')} />}>
            <Pending fallback={<p class="quiet">Loading the font…</p>}>
              {() => {
                const { font } = /** @type {any} */ ($read(faces));
                const theme = look();
                const S = $active();
                const [width, height] = $untrack(S, size);
                // The layout worker: ren-canv's service with ren-show's own engine (stack-worker.js).
                const worker = /** @type {any} */ (env.worker)('stack-worker');
                const view = canvas.ownerDocument.defaultView;
                const family = view?.getComputedStyle?.(canvas).fontFamily || 'sans-serif';
                const inks = { ground: color(theme.ren.paper), line: color(theme.ren.accent), wash: color(((theme.ren.accent ?? 0) & 0xffffff) | 0x14000000), ink: color(theme.ren.ink) };
                const page = follow(S, new Blueprint(font, { canvas, inks, family, width, height, scale: env.scale(), theme: theme.ren, layout: remoteLayout(worker) }), size);
                page.drawn = () => {
                  $write(frames, page.painted);
                  $write(commands, page.decoded);
                };
                const dispose = render(() => <Order />, page, { id: 'blueprint' });
                const stop = attach(page, canvas);
                const owner = $owner(S);
                if (owner !== null)
                  $cleanup(owner, () => {
                    stop();
                    dispose();
                    page.close();
                    worker.terminate?.();
                  });
                return null;
              }}
            </Pending>
          </Recover>
        </div>
        <p class="values">
          <Value label="frames drawn" value={frames} />
          <Value label="commands in the last frame" value={() => $read(commands).length} />
          <Value label="texts" value={() => $read(commands).filter(c => c[0] === 'text').length} />
        </p>
      </Block>
      <Block title="The last frame, decoded" note="decode turns a frame's command buffer into readable commands: the name, then its operands (a text's string first, colors as #aarrggbb). Blueprint draws from this list.">
        <pre class="code commands" data-commands="">{() => $read(commands).map(c => JSON.stringify(c)).join('\n')}</pre>
      </Block>
      <Block title="A layout engine of your own" note="The boxes come from a layout worker that runs ren-show's Stack engine (src/stack.js: flex rows and columns, no wrapping, no grid), set there with useLayout in place of Taffy. The page's other canvases keep Taffy: an engine is set per thread, and this one lives in its own worker.">
        <pre class="code">{"// stack-worker.js\nimport { serveLayout, useLayout } from 'ren-canv/worker';\nimport { Stack } from './stack.js';\n\nuseLayout(Stack);\nserveLayout(self);"}</pre>
      </Block>
    </div>
  );
}

export default {
  id: 'canvas',
  group: 'ren-core',
  title: 'A renderer of your own',
  apis: ['Document', 'Sfnt', 'render', 'attach', 'decode', 'useLayout', 'remoteLayout', 'serveLayout', 'color'],
  summary: 'ren-canv is the engine of the drawn renderers, and a new renderer is a subclass of its Document that draws each frame. Blueprint draws the work order as outlines on a 2D canvas, with its layout in a worker running an engine of ren-show’s own.',
  View,
};
