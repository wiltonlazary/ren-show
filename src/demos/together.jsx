// Every renderer package on one page: ren-show root (ren-dom) holds a
// shadow root (ren-dom), a Skia root (ren-skia) and a three.js root
// (ren-three), each with its own graph and renderer. One counter in the
// parent reaches all three as props; each sends "+1" back as a message. The
// same Counter component, made of portable primitives, renders on the DOM
// and on the canvas; the three.js root draws the counter as a bar.

import { $signal, $read, $write, $lookup } from 'rrx-core';
import { $active, Root, Pending, Recover, Label, Action, Layout, View as Box, Props, Send, Runtime, Id } from 'ren-core';
import { $shadow } from 'ren-dom';
import { $skia } from 'ren-skia';
import { Assets } from '../assets.js';
import { Async } from '../async.js';
import { Block, Value } from '../kit.jsx';
import { loadThree, stage } from './three.jsx';
import { Look, look, tone } from '../themes.js';

/** A counter of portable primitives: the same component on the DOM and on Skia. */
export function Counter() {
  const send = $lookup(Send);
  return (
    <Box gap={6} pad={8}>
      <Label text={() => `${$lookup(Id)} (${$lookup(Runtime).renderer}): ${$lookup(Props) ?? 0}`} />
      <Action text="+1" onPress={() => send({ bump: 1 })} />
    </Box>
  );
}

/** The counter as a bar in a three.js scene: click it to send +1. */
export function Bar() {
  const send = $lookup(Send);
  const level = () => Math.max(0.1, ($lookup(Props) ?? 0) * 0.25);
  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[2, 3, 4]} intensity={1.5} />
      <mesh name="bar" position-y={() => level() / 2 - 1} scale-y={level} rotation-y={0.6} onClick={() => send({ bump: 1 })}>
        <boxGeometry params={[0.9, 1, 0.9]} />
        <meshStandardMaterial color={() => look().colors.series[1]} />
      </mesh>
    </>
  );
}

function View() {
  const R = $active();
  const env = $lookup(Assets);
  const count = $signal(R, 1);
  const bumps = $signal(R, /** @type {Record<string, number>} */ ({}));
  const skia = Async(R, () => env.skia, async load => {
    if (load === null) throw new Error('this environment has no CanvasKit');
    return load();
  });
  const three = loadThree(R, env);
  /** Receives "+1" from a nested root, and counts who sent it. @param {string} from */
  const received = from => (/** @type {any} */ data) => {
    if (data.bump === undefined) return;
    $write(count, $read(count) + data.bump);
    $write(bumps, { ...$read(bumps), [from]: ($read(bumps)[from] ?? 0) + 1 });
  };
  const failed = (/** @type {string} */ what) => (/** @type {Error} */ error) => <Label text={`${what} is unavailable: ${error.message}`} color={tone('danger')} />;
  return (
    <div class="demo">
      <Block title="Three renderer packages, one page" note="Each box is a nested root with its own graph and renderer. The counter lives in this DOM root and reaches them as props; their +1 comes back as a message. Counter is one component, rendered by ren-dom and by ren-skia.">
        <Layout layout="row" gap={8}>
          <Action text="Count +1" onPress={() => $write(count, $read(count) + 1)} />
          <Action text="Reset" onPress={() => $write(count, 0)} />
        </Layout>
        <p class="values">
          <Value label="count" value={count} />
          <Value label="+1 from" value={() => Object.entries($read(bumps)).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} />
        </p>
        <div class="together">
          {/* A renderer's theme is fixed: each root is made again with a new theme. */}
          {() => (
            <Root id="together-shadow" renderer={$shadow({ theme: look().ren })} props={() => $read(count)} onMessage={received('shadow')}>
              {() => <Counter />}
            </Root>
          )}
          <Recover fallback={failed('Skia')}>
            <Pending fallback={<p class="quiet">Loading CanvasKit…</p>}>
              {() => {
                const { kit, font, mono } = /** @type {any} */ ($read(skia));
                return (
                  <Root id="together-skia" renderer={$skia(kit, { font, mono, width: 240, height: 120, scale: env.scale(), theme: look().ren })} props={() => $read(count)} onMessage={received('skia')}>
                    {() => <Counter />}
                  </Root>
                );
              }}
            </Pending>
          </Recover>
          <Recover fallback={failed('three.js')}>
            <Pending fallback={<p class="quiet">Loading three.js…</p>}>
              {() => (
                <Root id="together-three" renderer={stage(/** @type {any} */ ($read(three)), { width: 240, height: 160, background: look().colors.surface, camera: { position: [0, 0, 4] } })} props={() => $read(count)} provide={[[Look, look()]]} onMessage={received('three')}>
                  {() => <Bar />}
                </Root>
              )}
            </Pending>
          </Recover>
        </div>
      </Block>
    </div>
  );
}

export default {
  id: 'together',
  group: 'ren-core',
  title: 'Renderers together',
  apis: ['ren-dom', 'ren-skia', 'ren-three', 'Root', 'Props', 'Send', 'Runtime'],
  summary: 'ren is renderer-neutral; each renderer is a package of its own (ren-dom, ren-skia, ren-three), and a page imports only the ones it uses. Here all three live together: nested roots, one per renderer, share a counter through props and messages.',
  View,
};
