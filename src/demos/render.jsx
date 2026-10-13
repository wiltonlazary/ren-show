// Rendering without an application root: each renderer's plain `render`
// puts one view on a target of its own (an element, a Skia canvas, a
// three.js scene), as a widget in a page that is not a ren application, or
// a tool, would. Such a view gets its own graph and the Id context only, so
// the ticket brings the locks it needs: a Locker over the page's lock
// manager. The same view rendered once into ren-html's Document becomes a
// static page, serialized with the markup around it.

import { $signal, $read, $write, $lookup, $owner, $cleanup } from 'rrx-core';
import { $active, Pending, Recover, Label, Action, Layout, View as Box, Locks, Locker } from 'ren-core';
import { render as dom, color } from 'ren-dom';
import { Renderer, render as skia, attach, decode } from 'ren-skia';
import { render as three } from 'ren-three';
import { Document, serialize } from 'ren-html';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block, Value } from '../kit.jsx';
import { loadThree, stage } from './three.jsx';
import { Look, look, tone } from '../themes.js';

/** The seat every ticket holds: one lock, wherever the ticket is rendered. */
const SEAT = 'seat-4-12';

/**
 * A concert ticket of portable primitives. Holding the seat takes the lock
 * of its root's Locks without waiting: a second ticket (another renderer
 * here, or another tab) finds it held. Releasing, or the view going,
 * gives it back.
 */
export function Ticket() {
  const R = $active();
  const locks = $lookup(Locks);
  const c = look().colors;
  const state = $signal(R, 'free');
  /** Gives the held lock back. @type {(() => void) | null} */
  let release = null;
  const owner = $owner(R);
  if (owner !== null) $cleanup(owner, () => release?.());
  const hold = () => {
    if (release !== null) {
      release();
      release = null;
      $write(state, 'free');
      return;
    }
    try {
      locks
        .request(SEAT, { ifAvailable: true }, lock => {
          if (lock === null) return void $write(state, 'held elsewhere');
          $write(state, 'held here');
          return new Promise(resolve => (release = () => resolve(undefined)));
        })
        .catch((/** @type {Error} */ error) => $write(state, error.message));
    } catch (error) {
      $write(state, /** @type {Error} */ (error).message);
    }
  };
  return (
    <Box style={{ width: 260, padding: 14, gap: 6, background: c.surface, radius: 12, border: 1, borderColor: c.rule }}>
      <Label text="Evening concert" style={{ fontSize: 16, fontWeight: 'bold' }} />
      <Label text="Hall B · row 4 · seat 12" style={{ color: c.muted, fontSize: 14 }} />
      <Layout layout="row" gap={8}>
        <Action text={() => ($read(state) === 'held here' ? 'Release' : 'Hold the seat')} onPress={hold} />
        <Label data-seat="" text={state} style={{ fontSize: 14, color: c.accent }} />
      </Layout>
    </Box>
  );
}

/**
 * The ticket's static page: rendered once by ren-dom into ren-html's
 * Document, inside a page built with the same DOM calls, then serialized.
 * Its colors are the theme's ARGB tokens as CSS (ren-dom's color).
 * @param {import('../themes.js').Theme} theme
 */
export function page(theme) {
  const doc = new Document();
  const html = doc.createElement('html');
  html.setAttribute('lang', 'en');
  const head = doc.createElement('head');
  const title = doc.createElement('title');
  title.appendChild(doc.createTextNode('Evening concert: your ticket'));
  const meta = doc.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', color(theme.ren.accent));
  const style = doc.createElement('style');
  style.appendChild(doc.createTextNode(`body { margin: 24px; background: ${color(theme.ren.canvas)}; color: ${color(theme.ren.ink)}; }`));
  for (const node of [title, meta, style]) head.appendChild(node);
  const body = doc.createElement('body');
  html.appendChild(head);
  html.appendChild(body);
  // A static page holds no locks: its Locker has no manager.
  const dispose = dom(() => (
    <Look value={theme}>
      <Locks value={new Locker('ticket', null)}>
        <Ticket />
      </Locks>
    </Look>
  ), body, { id: 'ticket' });
  const markup = `<!doctype html>\n${serialize(html)}`;
  dispose();
  return markup;
}

/**
 * ren-skia's renderer with a frame inspector, as a tool would add one: each
 * frame it draws, decoded, goes to `inspect`.
 */
class Inspected extends Renderer {
  /** @type {(commands: (string | number)[][]) => void} */
  inspect = () => {};

  /** @param {import('ren-skia').Frame} frame @param {any} damage */
  draw(frame, damage) {
    super.draw(frame, damage);
    this.inspect(decode(frame));
  }
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const kit = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  const loaded = loadThree(R, env);
  // One Locker for every ticket here, over the page's lock manager: their holds exclude each other, and other tabs'.
  const locker = new Locker('box-office', env.locks);
  const held = $signal(R, '-');
  const query = () => locker.query().then(state => $write(held, state.held.join(', ') || 'none'));
  const painted = $signal(R, '-');
  const markup = $signal(R, '(press Make the page)');
  /** The ticket as each renderer gets it: the theme and the locks provided around it. */
  const ticket = () => {
    const theme = look();
    return () => (
      <Look value={theme}>
        <Locks value={locker}>
          <Ticket />
        </Locks>
      </Look>
    );
  };
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;

  /** ren-dom: the ticket in an element of this page. */
  const OnDom = () => {
    const owner = $owner($active());
    const view = ticket();
    const start = (/** @type {any} */ el) => {
      const dispose = dom(view, el, { id: 'ticket-dom' });
      if (owner !== null) $cleanup(owner, dispose);
    };
    return <div class="pane" data-target="dom" ref={start} />;
  };

  /** ren-skia: the ticket on a canvas of this page, its input routed by attach, each painted frame decoded. */
  const OnSkia = (/** @type {{ loaded: any }} */ props) => {
    const owner = $owner($active());
    const { kit: canvaskit, font, mono } = props.loaded;
    const theme = look();
    const view = ticket();
    const start = (/** @type {any} */ el) => {
      const doc = el.ownerDocument;
      const canvas = doc.createElement('canvas');
      canvas.style.width = '290px';
      canvas.style.height = '130px';
      el.appendChild(canvas);
      // Headless (no 2D canvas, as in the tests) the renderer draws offscreen.
      const draws = doc.createElement('canvas').getContext?.('2d') != null;
      const renderer = new Inspected(canvaskit, { font, mono, width: 290, height: 130, scale: env.scale(), theme: theme.ren, canvas: draws ? canvas : undefined });
      renderer.inspect = commands => $write(painted, `${commands.length} commands, ${commands.filter(c => c[0] === 'text').length} texts`);
      const dispose = skia(view, renderer, { id: 'ticket-skia' });
      const stop = draws ? attach(renderer, canvas) : () => {};
      if (owner !== null)
        $cleanup(owner, () => {
          stop();
          dispose();
          renderer.close();
        });
    };
    return <div class="pane canvas" data-target="skia" ref={start} />;
  };

  /** ren-three: the ticket in the overlay of a three.js scene drawn on a canvas of this page. */
  const OnThree = (/** @type {{ loaded: any }} */ props) => {
    const owner = $owner($active());
    const got = props.loaded;
    const theme = look();
    const view = ticket();
    const start = (/** @type {any} */ el) => {
      const canvas = el.ownerDocument.createElement('canvas');
      el.appendChild(canvas);
      // The page's own WebGL renderer on its canvas (the tests give a drawer stub).
      const drawer = got.renderer ?? new got.THREE.WebGLRenderer({ canvas, antialias: true });
      const renderer = stage(got, { renderer: drawer, width: 290, height: 200, background: theme.colors.surface, theme: theme.ren, camera: { position: [0, 0, 5] } });
      const dispose = three(
        () => (
          <>
            <ambientLight intensity={0.8} />
            <directionalLight position={[3, 4, 5]} intensity={1.6} />
            <mesh position={[1.2, -0.9, 0]} rotation={[0.5, 0.6, 0]}>
              <torusGeometry params={[0.5, 0.18, 24, 64]} />
              <meshStandardMaterial color={theme.colors.series[1]} roughness={0.4} />
            </mesh>
            {view()}
          </>
        ),
        renderer,
        { id: 'ticket-three' },
      );
      if (owner !== null)
        $cleanup(owner, () => {
          dispose();
          renderer.close();
          drawer.forceContextLoss?.();
        });
    };
    return <div class="pane canvas" data-target="three" ref={start} />;
  };

  return (
    <div class="demo">
      <Block title="One ticket, three renderers, no root" note="Each renderer's render(view, target) puts the ticket on a target of this page: an element (ren-dom), a canvas (ren-skia, its input routed by attach) and a three.js scene on a canvas with its own WebGL renderer (ren-three). Such a view has its own graph and the Id context only, so the ticket is given its locks: one Locker over the page's lock manager. Hold the seat on one; the others find it held, as another tab would.">
        <div class="together">
          <OnDom />
          <Recover fallback={failed('Skia')}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>{() => <OnSkia loaded={$read(kit)} />}</Pending>
          </Recover>
          <Recover fallback={failed('three.js')}>
            <Pending fallback={<p class="quiet">Loading three.js…</p>}>{() => <OnThree loaded={$read(loaded)} />}</Pending>
          </Recover>
        </div>
        <Layout layout="row" gap={8}>
          <Action text="Which locks are held?" onPress={query} />
        </Layout>
        <p class="values">
          <Value label="locks held (Locker query)" value={held} />
          <Value label="Skia's last frame (decoded)" value={painted} />
        </p>
      </Block>
      <Block title="A static page of the ticket" note="ren-html's Document is a small DOM: ren-dom's render writes the ticket into it, the page around it is built with the same DOM calls, and serialize writes the markup. The theme's ARGB tokens become CSS colors with ren-dom's color.">
        <Layout layout="row" gap={8}>
          <Action text="Make the page" onPress={() => $write(markup, page(look()))} />
        </Layout>
        <pre class="code" data-page="">{markup}</pre>
      </Block>
    </div>
  );
}

export default {
  id: 'render',
  group: 'ren-core',
  title: 'Rendering without a root',
  apis: ['render (ren-dom)', 'render (ren-skia)', 'render (ren-three)', 'attach', 'decode', 'Locker', 'Locks', 'Document (ren-html)', 'serialize', 'color'],
  summary: 'An application root brings storage, locks, nested roots and workers. A view placed on its own target, a widget in another page or a tool, renders with its renderer’s plain render and provides what it needs itself. Rendered once into ren-html’s Document, it becomes a static page.',
  View,
};
