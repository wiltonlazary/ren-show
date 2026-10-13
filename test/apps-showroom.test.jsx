// Showroom (src/apps/showroom): a configurator living in one three.js root.
// In node the scene graph is real three.js and a stub stands in for WebGL;
// frames are stepped by hand (`schedule: false`), so every animation is
// checked at known times. The interface is ren-core primitives in the scene: the
// overlay's and the panels' paint is read as ren-canv commands, and input
// goes through the renderer's `input`, as the canvas's own events do.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { $signal, $write, $read } from 'rrx-core';
import { $active, Root } from 'ren-core';
import { serve } from 'ren-core/worker';
import { $three, CONSTRUCT, loadLayout } from 'ren-three';
import { open, after } from './page.jsx';
import showroom from '../src/apps/showroom/index.jsx';
import { Showroom, SPOTS, LENS, LOW, FLOOR } from '../src/apps/showroom/scene.jsx';
import { places } from '../src/apps/showroom/product.jsx';
import { FINISHES, SIZES, DEFAULTS, ENGRAVING, price, weight, summary, etched } from '../src/apps/showroom/materials.js';
import { HOME, TARGET, screen, basis, approach, nearest, placed, rgb, hex } from '../src/apps/showroom/orbit.js';
import { WIDTH, HEIGHT, COMPACT, EDGE, BAR, TABLET, compactHeight, controls, canvasFor, regions, widen } from '../src/apps/showroom/layout.js';
import { THEMES, Look } from '../src/themes.js';

// Each WebAssembly memory reserves its whole range up front; at most 1 GB
// each, Taffy's fits the machine's address cap.
setFlagsFromString('--wasm-max-mem-pages=16384');
await loadLayout();

const font = readFileSync(fileURLToPath(import.meta.resolve('ren-skia/font.ttf')));

/**
 * Re-checks `check` until it holds or `ms` pass; returns whether it held.
 * The page runs workers, WebAssembly and frames that report no single event.
 * @param {() => boolean} check
 */
const until = async (check, ms = 3000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (check()) return true;
  return check();
};

/** three.js in node: the scene graph is real, a stub stands in for WebGL and counts frames. */
const threeStub = () => {
  const drawer = { frames: 0, render: () => void drawer.frames++, setSize: () => {}, dispose: () => {} };
  return { drawer, load: async () => ({ THREE, renderer: drawer, font }) };
};

/** The texts a surface paints. @param {any} surface @returns {string[]} */
const texts = surface => surface.commands().filter((/** @type {any[]} */ c) => c[0] === 'text').map((/** @type {any[]} */ c) => c[1]);

/**
 * Opens Showroom with frames driven by hand, and waits for its root.
 * Returns the page, the renderer and ways to drive it.
 * @param {{ worker?: any, themed?: boolean, rotate?: boolean }} [options]
 */
async function room(options = {}) {
  const { load, drawer } = threeStub();
  /** @type {any[]} */
  const made = [];
  const View = showroom.View;
  /** @type {any} */
  let theme = null;
  const view = () => <View probe={r => made.push(r)} options={{ schedule: false }} rotate={options.rotate ?? false} />;
  const Themed = () => {
    theme = $signal($active(), THEMES[0]);
    return <Look value={theme}>{view()}</Look>;
  };
  const page = open(options.themed ? Themed : view, { three: load, worker: options.worker ?? null });
  assert.ok(await until(() => made.length > 0 && page.all('[data-ren-root="showroom-scene"] canvas').length === 1), 'the scene root renders');
  const three = () => made.at(-1);
  let time = 0;
  /** Steps `n` frames of 16 ms, then lets the surfaces paint. */
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) three().frame((time += 16));
    three().present();
  };
  step();
  /** A press and release at a canvas point, as the canvas's events send them. @param {number[]} at */
  const press = at => {
    const [x, y] = at;
    three().input('pointerdown', x, y, { button: 0, buttons: 1, detail: 1 });
    three().input('pointerup', x, y, { button: 0, buttons: 0 });
    three().input('click', x, y, { button: 0, detail: 1 });
    three().present();
  };
  /** A drag in steps. @param {number[]} from @param {number[]} to */
  const drag = (from, to, steps = 5) => {
    three().input('pointerdown', from[0], from[1], { button: 0, buttons: 1, detail: 1 });
    for (let i = 1; i <= steps; i++) three().input('pointermove', from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, { buttons: 1 });
    three().input('pointerup', to[0], to[1], { button: 0, buttons: 0 });
    three().present();
  };
  const at = controls();
  const object = (/** @type {string} */ name) => three().scene.getObjectByName(name);
  const panels = () => /** @type {any[]} */ ([...three().surfaces].filter(s => s.panel));
  /** The panel whose paint includes `text`. @param {string} text */
  const panel = text => panels().find(s => texts(s).some(t => t.includes(text)));
  /** The panel in the group of this name. @param {string} name */
  const holder = name => panels().find(s => s.mesh.parent?.name === name);
  const spots = () => JSON.parse(page.host.querySelector('.app-showroom').getAttribute('data-spots'));
  const strip = (/** @type {string} */ cls) => page.host.querySelector(`.app-showroom .strip .${cls}`).textContent;
  return { page, made, three, step, press, drag, at, object, panels, panel, holder, spots, strip, drawer, setTheme: (/** @type {any} */ t) => $write(theme, t) };
}

describe('showroom catalogue and camera math', () => {
  it('prices, weighs and sums up a configuration', () => {
    assert.equal(price(DEFAULTS), 429);
    assert.equal(weight(DEFAULTS), 352);
    const loaded = { ...DEFAULTS, cushion: 'saddle', band: 'steel', size: 'l', engraving: 'ADA' };
    assert.equal(price(loaded), 429 + 50 + 79);
    assert.equal(weight(loaded), 352 + 14 + 27 + 6);
    assert.equal(summary(loaded), 'Slate · Saddle leather · Stainless steel · size L · “ADA”');
    assert.equal(etched('a\nb'.padEnd(40, 'x')).length, ENGRAVING, 'one line, at most 16 characters');
    assert.ok(FINISHES.every(f => /^#[0-9a-f]{6}$/.test(f.shell.color)), 'finishes are named sRGB colors');
  });

  it('approaches frame-rate independently, takes the short way round and mixes colors', () => {
    // Two 8 ms steps land where one 16 ms step does.
    const one = approach(0, 1, 0.016, 5);
    const two = approach(approach(0, 1, 0.008, 5), 1, 0.008, 5);
    assert.ok(Math.abs(one - two) < 1e-12);
    assert.ok(Math.abs(nearest(6, 0.2) - (0.2 + 2 * Math.PI)) < 1e-12, 'from 6 rad, 0.2 is 2π on');
    assert.deepEqual(rgb('#9db7cf'), [0x9d, 0xb7, 0xcf]);
    assert.equal(hex([0x9d, 0xb7, 0xcf]), '#9db7cf');
    assert.deepEqual(placed([1, 2, 3], 0, [1, 0, 0]), [2, 2, 3]);
  });
});

describe('showroom', () => {
  it('builds the product, the studio and the camera rig as three.js objects, with the interface in the overlay and panels', async () => {
    const s = await room();
    try {
      const scene = s.three().scene;
      // The product: lathed cups, tori, cylinders; physically based materials.
      for (const name of ['headphones', 'band', 'strap', 'right cup', 'left cup', 'right cushion', 'left cushion', 'crown']) assert.ok(s.object(name), name);
      const shell = s.object('right cup').getObjectByName('shell');
      assert.ok(shell.geometry.isBufferGeometry && shell.geometry.type === 'LatheGeometry');
      assert.ok(shell.material.isMeshPhysicalMaterial && shell.castShadow);
      assert.equal(s.object('band').geometry.type, 'TorusGeometry');
      // The studio: a key light casting a soft shadow onto the plinth and floor.
      const key = s.object('key');
      assert.ok(key.isDirectionalLight && key.castShadow);
      assert.deepEqual([key.shadow.mapSize.x, key.shadow.mapSize.y], [1024, 1024], 'a dashed path sets the shadow map');
      assert.ok(s.object('plinth').receiveShadow && s.object('floor').receiveShadow);
      // The camera: a main camera in a rig, which the raycast uses too.
      const camera = s.three().camera;
      assert.ok(camera.isPerspectiveCamera && camera.fov === 38);
      assert.equal(camera.parent.parent.name, 'rig');
      assert.ok(Math.abs(camera.aspect - WIDTH / HEIGHT) < 1e-9);
      // The orbit math agrees with three.js: the camera where basis() puts it, points where screen() says.
      s.step(200);
      scene.updateMatrixWorld();
      const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      const want = basis(HOME).eye;
      assert.ok(eye.distanceTo(new THREE.Vector3(...want)) < 1e-6, `eye ${eye.toArray()} vs ${want}`);
      for (const point of [[0, 0, 0], [1, -0.5, 0.3], TARGET]) {
        const p = new THREE.Vector3(...point).project(camera);
        const [x, y] = /** @type {number[]} */ (screen(point, HOME, WIDTH, HEIGHT));
        assert.ok(Math.abs(x - ((p.x + 1) / 2) * WIDTH) < 1e-6 && Math.abs(y - ((1 - p.y) / 2) * HEIGHT) < 1e-6);
      }
      // The overlay: the product, its price and the configurator, drawn over the scene.
      const overlay = s.three().overlay;
      assert.ok(overlay.mesh.visible);
      const words = texts(overlay);
      for (const t of ['Halo Over-Ear', '$429 · 352 g · 30 h battery', 'Finish · Slate', 'Cushions · Soft knit', 'Headband · Woven strap', 'Add to bag']) assert.ok(words.includes(t), `${t} in ${words.join(' | ')}`);
      // The panels: the spec card beside the product, the engraving card in front; each a plane in its group.
      const spec = s.holder('spec');
      assert.ok(spec && spec.mesh.parent.name === 'spec', 'the spec card is a panel in the scene');
      assert.ok(texts(spec).includes('30 hours'));
      const engrave = s.holder('engrave');
      assert.equal(engrave.mesh.parent.name, 'engrave');
      assert.equal(engrave.height, 114, 'the engraving card is the fixed size the page publishes from');
      // Each side card stands on the floor, its lower edge above it: none sinks into it.
      s.three().present();
      for (const card of [spec, engrave]) {
        const at = new THREE.Vector3();
        card.mesh.getWorldPosition(at);
        assert.ok(at.y - (card.height * 0.01) / 2 > FLOOR, `${card.mesh.parent.name}'s lower edge ${(at.y - (card.height * 0.01) / 2).toFixed(2)} above the floor ${FLOOR}`);
      }
      // The page's strip hears the configuration.
      assert.equal(s.strip('config'), `${summary(DEFAULTS)} · $429`);
      assert.ok(s.drawer.frames > 0, 'frames were drawn');
    } finally {
      s.page.dispose();
    }
  });

  it('configures through the overlay: finishes crossfade, cushions swap material, the steel band replaces the strap, the size rebuilds the band in place', async () => {
    const s = await room();
    try {
      const shell = s.object('right cup').getObjectByName('shell');
      const material = shell.material;
      const glacier = /** @type {any} */ (FINISHES.find(f => f.id === 'glacier')).shell.color;
      // A press on the Glacier swatch, where the page says it shows.
      s.press(s.at['finish:glacier']);
      assert.ok(texts(s.three().overlay).includes('Finish · Glacier'));
      assert.ok(s.strip('config').startsWith('Glacier'), 'the page hears it');
      assert.ok(texts(s.holder('spec')).includes('Glacier'), 'the spec card follows');
      // The aluminium crossfades: part of the way after a frame, there after a second.
      const start = material.color.getHexString();
      s.step(2);
      const mid = material.color.getHexString();
      assert.notEqual(mid, start);
      assert.notEqual(mid, glacier.slice(1));
      s.step(90);
      assert.equal(material.color.getHexString(), new THREE.Color(glacier).getHexString());
      assert.equal(shell.material, material, 'the same material, its color moved');
      // Cushions: knit to leather is a different material.
      const pad = s.object('left cushion').getObjectByName('pad');
      assert.equal(pad.material.name, 'knit');
      const knit = pad.material;
      s.press(s.at['cushion:saddle']);
      assert.equal(pad.material.name, 'leather');
      assert.notEqual(pad.material, knit);
      assert.ok(pad.material.clearcoat > 0);
      s.step(120);
      assert.equal(pad.material.color.getHexString(), new THREE.Color('#8a5a3b').getHexString());
      s.press(s.at['cushion:black']);
      s.step(120);
      assert.equal(pad.material.color.getHexString(), new THREE.Color('#1e1c1b').getHexString(), 'leather to leather crossfades');
      assert.equal(s.object('left cushion').getObjectByName('fabric').material.name, 'knit', 'the fabric inside stays knit');
      // The steel band: the strap leaves the scene, the band turns steel.
      assert.ok(s.object('strap'));
      s.press(s.at['band:steel']);
      assert.equal(s.object('strap'), undefined);
      assert.equal(s.object('band').material.name, 'steel');
      assert.ok(texts(s.three().overlay).includes('$558 · 393 g · 30 h battery'));
      // The size: new params rebuild the band's torus in place (same geometry object), and the cups move out.
      const band = s.object('band');
      const geometry = band.geometry;
      s.press(s.at['size:l']);
      assert.equal(band.geometry, geometry, 'rebuilt in place');
      assert.equal(geometry.parameters.radius, 1.1);
      assert.ok(Math.abs(s.object('right cup').position.x - places(1.1, 0).cup) < 1e-9);
      s.press(s.at['size:s']);
      assert.equal(geometry.parameters.radius, 0.98);
      assert.equal(s.object('band').material.name, 'steel', 'the material stays');
      s.press(s.at['band:strap']);
      assert.ok(s.object('strap'));
      assert.equal(s.object('strap').geometry.parameters.radius, 0.98 - 0.085, 'a new strap at the current size');
    } finally {
      s.page.dispose();
    }
  });

  it('explodes and assembles with $animate, and adds to the bag', async () => {
    const s = await room();
    try {
      const cup = s.object('right cup');
      const radius = SIZES[1].radius;
      assert.ok(Math.abs(cup.position.x - places(radius, 0).cup) < 1e-9);
      s.press(s.at.explode);
      assert.ok(texts(s.three().overlay).includes('Assemble'));
      s.step(3);
      const moving = cup.position.x;
      assert.ok(moving > places(radius, 0).cup && moving < places(radius, 1).cup, 'on its way');
      s.step(120);
      assert.ok(Math.abs(cup.position.x - places(radius, 1).cup) < 1e-9, 'apart');
      assert.ok(s.object('band').position.y > 0.6, 'the band lifts');
      assert.ok(s.object('left cushion').position.x > -places(radius, 1).cup, 'the cushions stand off the cups');
      // The hotspots travel with their parts.
      assert.ok(Math.abs(s.object('spot crown').position.x - SPOTS[0].at(radius, 1)[0]) < 1e-9);
      s.press(s.at.explode);
      s.step(150);
      assert.ok(Math.abs(cup.position.x - places(radius, 0).cup) < 1e-9, 'together again');
      // Add to bag: the overlay's button, the count, and the page.
      s.press(s.at.bag);
      s.press(s.at.bag);
      assert.ok(texts(s.three().overlay).includes('In your bag: 2'));
      assert.ok(texts(s.three().overlay).includes('Add another'));
      assert.equal(s.strip('bag'), 'bag 2');
    } finally {
      s.page.dispose();
    }
  });

  it('orbits with a drag, zooms with the wheel and the overlay, and turns on the turntable', async () => {
    const s = await room();
    try {
      s.step(200);
      const rig = s.object('rig');
      const yaw = rig.rotation.y;
      const pitch = rig.children[0].rotation.x;
      assert.ok(Math.abs(yaw - HOME.yaw) < 1e-4);
      // A drag across empty space (the backdrop takes it) turns the camera, damped.
      const still = () => s.page.host.querySelector('.app-showroom').getAttribute('data-still');
      assert.equal(still(), 'true', 'settled, the page hears it');
      s.drag([560, 260], [460, 300]);
      s.step(1);
      assert.equal(still(), 'false', 'moving');
      assert.ok(rig.rotation.y > yaw && rig.rotation.y < yaw + 100 * 0.008, 'following');
      s.step(200);
      assert.ok(Math.abs(rig.rotation.y - (yaw + 100 * 0.008)) < 1e-3, `yaw ${rig.rotation.y}`);
      // A drag the browser takes back (a touch it scrolls with) ends there: later moves turn nothing.
      const turned = rig.rotation.y;
      s.three().input('pointerdown', 560, 260, { button: 0, buttons: 1, detail: 1 });
      s.three().input('pointermove', 540, 260, { buttons: 1 });
      s.three().input('pointercancel', 540, 260, { buttons: 0 });
      s.three().input('pointermove', 400, 260, { buttons: 1 });
      s.step(200);
      assert.ok(Math.abs(rig.rotation.y - (turned + 20 * 0.008)) < 1e-3, `the cancelled drag turned only until the cancel: ${rig.rotation.y - turned}`);
      // The side cards keep beside the product on screen, never in front of it: the spec card right, the engraving card left.
      const spec = s.holder('spec');
      const engrave = s.holder('engrave');
      assert.ok(s.three().project(spec, 0, spec.height / 2)[0] > WIDTH * 0.62, 'the spec card on the right');
      assert.ok(s.three().project(engrave, engrave.width, engrave.height / 2)[0] < WIDTH * 0.38, 'the engraving card on the left');
      // Dragged down 40 pixels: the camera rises (the pitch group turns the other way).
      assert.ok(Math.abs(rig.children[0].rotation.x - (pitch - 40 * 0.008)) < 1e-3, 'the drag down raised the camera');
      // The wheel zooms (deltaY on the native event), within the limits.
      const camera = s.three().camera;
      const far = camera.position.z;
      s.three().input('wheel', 500, 300, { deltaY: -400 });
      s.step(200);
      assert.ok(camera.position.z < far, `closer: ${camera.position.z} < ${far}`);
      s.press(s.at['zoom-out']);
      s.press(s.at['zoom-out']);
      s.step(200);
      const out = camera.position.z;
      assert.ok(out > far * 0.6);
      s.press(s.at.reset);
      s.step(300);
      assert.ok(Math.abs(camera.position.z - HOME.distance) < 1e-3 && Math.abs(rig.rotation.y - HOME.yaw) < 2e-3, 'home again');
      // The controls show the pointer cursor on the canvas; the scene keeps the page's.
      const canvas = s.page.all('[data-ren-root="showroom-scene"] canvas')[0];
      s.three().input('pointermove', ...s.at.bag, { buttons: 0 });
      assert.equal(canvas.style.cursor, 'pointer');
      s.three().input('pointermove', 560, 260, { buttons: 0 });
      assert.equal(canvas.style.cursor, '');
      // The turntable turns the camera until paused.
      s.press(s.at.rotate);
      assert.ok(texts(s.three().overlay).includes('Pause turntable'));
      const before = rig.rotation.y;
      s.step(60);
      assert.ok(rig.rotation.y > before + 0.1, 'it turns');
      s.press(s.at.rotate);
      s.step(200);
      const paused = rig.rotation.y;
      s.step(30);
      assert.ok(Math.abs(rig.rotation.y - paused) < 1e-6, 'paused');
    } finally {
      s.page.dispose();
    }
  });

  it('opens a hotspot with a raycast click: the camera flies there and a detail card faces it; its Close is pressed through the raycast', async () => {
    const s = await room();
    try {
      s.step(60);
      const crown = /** @type {number[]} */ (s.spots().crown);
      assert.ok(Array.isArray(crown), 'the page knows where the crown shows');
      // Hover: the dot grows and the overlay's hint names it.
      s.three().input('pointermove', crown[0], crown[1], { buttons: 0 });
      s.three().present();
      assert.equal(s.object('dot crown').scale.x, 1.6);
      assert.ok(texts(s.three().overlay).includes('Press to open: Digital crown'));
      s.three().input('pointermove', 20, 330, { buttons: 0 });
      assert.equal(s.object('dot crown').scale.x, 1);
      // A click on the dot opens its card, and the camera flies to the crown's view.
      s.press(crown);
      const card = s.panel('Digital crown');
      assert.ok(card, 'the detail card is a panel');
      assert.equal(card.mesh.parent.parent.name, 'detail');
      assert.equal(s.page.host.querySelector('.app-showroom').getAttribute('data-open'), 'crown', 'the page hears it');
      s.step(300);
      const rig = s.object('rig');
      assert.ok(Math.abs(rig.rotation.y - SPOTS[0].view.yaw) < 1e-3, 'flown to the crown');
      // The card faces the camera: its world direction is the camera's back axis.
      s.three().scene.updateMatrixWorld();
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(card.mesh.matrixWorld);
      const back = new THREE.Vector3(...basis(SPOTS[0].view).back);
      assert.ok(normal.dot(back) > 0.999, `facing ${normal.dot(back)}`);
      // Close, pressed where it shows on the canvas (bottom right of the card).
      const [cx, cy] = s.three().project(card, card.width - 14 - 20, card.height - 14 - 15);
      s.press([cx, cy]);
      assert.equal(s.panel('Digital crown'), undefined, 'closed');
      assert.equal(s.page.host.querySelector('.app-showroom').getAttribute('data-open'), '');
      // Seen from the crown's side, the left cushion's dot is behind the product: hidden, and the page has no place for it.
      s.step(60);
      assert.equal(s.spots().cushion, null);
      assert.equal(s.object('dot cushion'), undefined, 'it takes no clicks');
      assert.ok(s.object('dot shell'));
      // Back home, the cushion's dot shows again; its card reads the configuration, and a click on empty space closes it.
      s.press(s.at.reset);
      s.step(300);
      assert.ok(Array.isArray(s.spots().cushion) && s.object('dot cushion'));
      s.press(/** @type {number[]} */ (s.spots().cushion));
      assert.ok(s.panel('Ear cushions · Soft knit'), 'the card reads the configuration');
      s.press([520, 330]);
      assert.equal(s.panel('Ear cushions'), undefined);
    } finally {
      s.page.dispose();
    }
  });

  it('engraves through an Edit in a 3D panel: focused by the raycast, typed through the native entry, etched on the cup', async () => {
    const s = await room();
    try {
      s.step(60);
      const field = /** @type {number[]} */ (s.spots().engrave);
      const engrave = s.holder('engrave');
      // The page's projection of the field agrees with ren-three's.
      const [px, py] = s.three().project(engrave, engrave.width / 2, 14 + 18 + 8 + 18);
      assert.ok(Math.abs(px - field[0]) <= 1 && Math.abs(py - field[1]) <= 1, `${field} vs ${[px, py]}`);
      s.three().input('pointerdown', field[0], field[1], { button: 0, buttons: 1, detail: 1 });
      s.three().input('pointerup', field[0], field[1], { button: 0, buttons: 0 });
      assert.equal(s.three().active, engrave, 'keys go to the panel');
      assert.equal(engrave.focused?.kind, 4, 'the Edit has focus');
      // Typed as the platform types: into the native entry over the field.
      const entry = /** @type {any} */ (s.page.document.activeElement);
      assert.ok(entry?.matches('textarea[data-ren-entry]'), `a native text entry holds the focus, not ${entry?.tagName}`);
      entry.value = 'For Ada, with love and more';
      entry.selectionStart = entry.selectionEnd = entry.value.length;
      entry.dispatchEvent(new s.page.window.Event('input', { bubbles: true }));
      s.three().present();
      const etchedText = 'For Ada, with lo';
      assert.ok(s.strip('config').includes(`“${etchedText}”`), s.strip('config'));
      assert.ok(texts(engrave).includes(`${ENGRAVING}/${ENGRAVING} · free · etched on the left cup`));
      // Etched on the left cup: a Label in a panel on the shell, in the finish's tone.
      const etching = s.panels().find(p => p.mesh.parent.name === 'engraving');
      assert.ok(etching && texts(etching).includes(etchedText));
      assert.ok(texts(s.holder('spec')).includes(etchedText), 'the spec card too');
      // Keys go to the focused Edit: Backspace.
      s.three().active.key('Backspace');
      s.three().present();
      assert.ok(s.strip('config').includes('“For Ada, with l”'));
    } finally {
      s.page.dispose();
    }
  });

  it('selects the spec card’s text with a drag across its plane, and a triple press', async () => {
    const s = await room();
    try {
      s.step(60);
      const spec = s.holder('spec');
      const three = s.three();
      // A triple press on the title selects it whole.
      const [tx, ty] = three.project(spec, 40, 14 + 12);
      three.input('pointerdown', tx, ty, { button: 0, buttons: 1, detail: 3 });
      three.input('pointerup', tx, ty, { button: 0, buttons: 0 });
      assert.equal(three.active, spec);
      assert.equal(spec.copied(), 'Halo Over-Ear');
      // A drag from the first row's name to the next row's value: below the title, the price and the rule.
      const top = 14 + 17 * 1.4 + 8 + 15 * 1.4 + 8 + 1 + 8;
      const from = three.project(spec, 16, top + 6);
      const to = three.project(spec, 226, top + 13 * 1.4 + 8 + 6);
      s.drag(from, to, 6);
      const copied = spec.copied();
      assert.ok(copied.includes('Finish') && copied.includes('Soft knit'), JSON.stringify(copied));
      // A drag on the panel never orbits.
      assert.ok(Math.abs(s.object('rig').rotation.y - HOME.yaw) < 1e-3);
    } finally {
      s.page.dispose();
    }
  });

  it('reports its frames, and takes a new theme in place: same renderer, scene and state, restyled', async () => {
    const s = await room({ themed: true });
    try {
      s.step(60);
      assert.equal(s.page.host.querySelector('.app-showroom').getAttribute('data-frames'), '60');
      assert.match(s.strip('fps'), /^\d+ fps$/);
      s.press(s.at['finish:rose']);
      s.press(s.at.bag);
      // Focus the engraving's Edit: a theme change keeps even that.
      const engrave = s.holder('engrave');
      const [ex, ey] = s.three().project(engrave, engrave.width / 2, 14 + 18 + 8 + 18);
      s.three().input('pointerdown', ex, ey, { button: 0, buttons: 1, detail: 1 });
      s.three().input('pointerup', ex, ey, { button: 0, buttons: 0 });
      const first = s.three();
      const floor = s.object('floor').material;
      const painted = JSON.stringify(first.overlay.commands());
      const tide = /** @type {any} */ (THEMES.find(t => t.id === 'tide'));
      s.setTheme(tide);
      s.step(2);
      assert.equal(s.three(), first, 'the same renderer and root');
      assert.equal(s.made.length, 1);
      assert.equal(first.options.theme, tide.ren, 'the primitives took the tokens (setTheme)');
      assert.equal(first.scene.background.getHexString(), tide.colors.canvas.slice(1), 'the background, attached from the view');
      assert.equal(s.object('floor').material, floor);
      assert.equal(floor.color.getHexString(), new THREE.Color(tide.colors.canvas).getHexString(), 'the scene restyled in place');
      assert.notEqual(JSON.stringify(first.overlay.commands()), painted, 'the overlay repainted');
      assert.ok(texts(first.overlay).includes('Finish · Rose') && texts(first.overlay).includes('In your bag: 1'), 'the state stayed');
      assert.equal(engrave.focused?.kind, 4, 'the Edit kept its focus');
    } finally {
      s.page.dispose();
    }
  });

  it('on a phone-sized canvas stacks its overlay, drops the side panels and frames the product from further back', async () => {
    const { drawer } = threeStub();
    const width = 360;
    const height = compactHeight(width);
    assert.ok(width < COMPACT);
    /** @type {any} */
    let three = null;
    const page = open(() => {
      three = $three(THREE, { renderer: drawer, font, width, height, schedule: false });
      return (
        <Root id="showroom-compact" renderer={three} props={{ theme: THEMES[0], rotate: false, width, height }}>
          {() => <Showroom />}
        </Root>
      );
    });
    try {
      assert.ok(await until(() => three?.overlay != null), 'the scene root renders');
      for (let i = 1; i <= 200; i++) three.frame(i * 16);
      three.present();
      const words = texts(three.overlay);
      for (const t of ['Halo Over-Ear', 'Explode', 'Turn', 'Reset', 'Finish · Slate', 'Headband', 'Size', 'Add to bag']) assert.ok(words.includes(t), `${t} in ${words.join(' | ')}`);
      assert.ok(!words.includes('Exploded view'), 'not the wide overlay');
      assert.equal([...three.surfaces].filter((/** @type {any} */ p) => p.panel).length, 0, 'no spec or engraving card beside the product');
      // The camera: the canvas's shape, further back, about the lower point; screen() still agrees with three.js.
      const camera = three.camera;
      assert.ok(Math.abs(camera.aspect - width / height) < 1e-9);
      three.scene.updateMatrixWorld();
      const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      const lensed = { ...HOME, distance: HOME.distance * LENS };
      assert.ok(eye.distanceTo(new THREE.Vector3(...basis(lensed, LOW).eye)) < 1e-6);
      const p = new THREE.Vector3(0, 0, 0).project(camera);
      const [x, y] = /** @type {number[]} */ (screen([0, 0, 0], lensed, width, height, LOW));
      assert.ok(Math.abs(x - ((p.x + 1) / 2) * width) < 1e-6 && Math.abs(y - ((1 - p.y) / 2) * height) < 1e-6);
    } finally {
      page.dispose();
    }
  });

  it('picks the canvas for the page’s width: full, a tablet’s, a phone’s', () => {
    assert.deepEqual(canvasFor(1200), { layout: 'full', size: [WIDTH, HEIGHT] });
    assert.deepEqual(canvasFor(WIDTH), { layout: 'full', size: [WIDTH, HEIGHT] });
    for (const width of [COMPACT, 766, WIDTH - 1]) {
      const { layout, size } = canvasFor(width);
      assert.equal(layout, 'tablet');
      assert.deepEqual(size, [width, HEIGHT + TABLET - BAR.height], 'a little taller: the bar has two rows');
      // Every control and the view row within the canvas and the bar's padding.
      const { bar, corner } = regions(...size);
      for (const [name, [x, y]] of Object.entries(controls(...size))) {
        assert.ok(x > EDGE && x < width - EDGE && y > EDGE && y < size[1] - EDGE, `${name} at ${x}, ${y} on ${width}`);
        if (!['explode', 'rotate', 'reset', 'zoom-out', 'zoom-in'].includes(name)) assert.ok(x > bar[0] && x < bar[0] + bar[2] && y > bar[1] && y < bar[1] + bar[3], `${name} in the bar`);
      }
      assert.ok(corner[0] >= EDGE && corner[1] + corner[3] <= bar[1], 'the view row above the bar');
    }
    assert.equal(canvasFor(COMPACT - 1).layout, 'compact');
  });

  it('on a tablet-sized canvas lays its bar out in two rows where controls() says, the panels beside the product in view', async () => {
    const { drawer } = threeStub();
    const [width, height] = canvasFor(800).size;
    /** @type {any} */
    let three = null;
    /** @type {any} */
    let boxes = null;
    const page = open(() => {
      three = $three(THREE, { renderer: drawer, font, width, height, schedule: false });
      return (
        <Root id="showroom-tablet" renderer={three} props={{ theme: THEMES[0], rotate: false, width, height }} onMessage={(/** @type {any} */ m) => m.layout !== undefined && (boxes = m.layout)}>
          {() => <Showroom />}
        </Root>
      );
    });
    try {
      assert.ok(await until(() => three?.overlay != null), 'the scene root renders');
      for (let i = 1; i <= 200; i++) three.frame(i * 16);
      three.present();
      const words = texts(three.overlay);
      for (const t of ['Halo Over-Ear', 'Exploded view', 'Finish · Slate', 'Headband · Woven strap', 'Size', 'Add to bag']) assert.ok(words.includes(t), `${t} in ${words.join(' | ')}`);
      assert.equal([...three.surfaces].filter((/** @type {any} */ p) => p.panel).length, 2, 'the spec and engraving cards');
      // The controls press where controls() says: the size on the second row, the bag beside it.
      const at = controls(width, height);
      const press = (/** @type {number[]} */ [x, y]) => {
        three.input('pointerdown', x, y, { button: 0, buttons: 1, detail: 1 });
        three.input('pointerup', x, y, { button: 0, buttons: 0 });
        three.input('click', x, y, { button: 0, detail: 1 });
        three.present();
      };
      press(at['size:l']);
      press(at['band:steel']);
      press(at.bag);
      three.present();
      assert.ok(await until(() => (three.present(), texts(three.overlay).includes('Headband · Stainless steel') && texts(three.overlay).includes('In your bag: 1'))), texts(three.overlay).join(' | '));
      // The boxes it reports: in the canvas, none over another.
      assert.ok(await until(() => boxes !== null && boxes.head[3] > 0));
      const inside = (/** @type {number[]} */ b) => b[0] >= 0 && b[1] >= 0 && b[0] + b[2] <= width && b[1] + b[3] <= height;
      const apart = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
      const names = ['head', 'corner', 'bar', 'spec', 'engrave'];
      for (const n of names) assert.ok(inside(boxes[n]), `${n} ${boxes[n]} inside ${width} × ${height}`);
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert.ok(apart(boxes[names[i]], boxes[names[j]]), `${names[i]} ${boxes[names[i]]} clear of ${names[j]} ${boxes[names[j]]}`);
      // The camera stands further back, by the canvas's narrower shape.
      three.scene.updateMatrixWorld();
      const eye = new THREE.Vector3().setFromMatrixPosition(three.camera.matrixWorld);
      assert.ok(eye.distanceTo(new THREE.Vector3(...basis({ ...HOME, distance: HOME.distance * widen(width, height) }).eye)) < 1e-6);
    } finally {
      page.dispose();
    }
  });

  it('made full, then resized to a tablet’s canvas: the camera and where the hotspots show still agree', async () => {
    const { drawer } = threeStub();
    const [width, height] = canvasFor(947).size;
    /** @type {any} */
    let three = null;
    /** @type {any} */
    let setSize = null;
    /** @type {any} */
    let spots = null;
    const page = open(() => {
      const dims = $signal($active(), /** @type {[number, number]} */ ([WIDTH, HEIGHT]));
      setSize = (/** @type {[number, number]} */ s) => (three.resize(...s), $write(dims, s));
      three = $three(THREE, { renderer: drawer, font, width: WIDTH, height: HEIGHT, schedule: false });
      return (
        <Root id="showroom-resized" renderer={three} props={() => ({ theme: THEMES[0], rotate: false, width: $read(dims)[0], height: $read(dims)[1] })} onMessage={(/** @type {any} */ m) => m.spots !== undefined && (spots = m.spots)}>
          {() => <Showroom />}
        </Root>
      );
    });
    try {
      assert.ok(await until(() => three?.overlay != null), 'the scene root renders');
      setSize([width, height]);
      for (let i = 1; i <= 300; i++) three.frame(i * 16);
      three.present();
      const camera = three.camera;
      assert.ok(Math.abs(camera.aspect - width / height) < 1e-9, `the camera's aspect ${camera.aspect}`);
      three.scene.updateMatrixWorld();
      camera.updateProjectionMatrix();
      const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
      assert.ok(eye.distanceTo(new THREE.Vector3(...basis({ ...HOME, distance: HOME.distance * widen(width, height) }).eye)) < 1e-6, `the eye at ${eye.toArray()}, not ${basis({ ...HOME, distance: HOME.distance * widen(width, height) }).eye}`);
      const shown = Object.entries(spots).filter(([k, p]) => k !== 'engrave' && p !== null);
      assert.ok(shown.length > 0);
      for (const [id, [x, y]] of shown) {
        const spot = SPOTS.find(s => s.id === id);
        const object = three.scene.getObjectByName(`spot ${id}`);
        const p = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).project(camera);
        assert.ok(Math.abs(x - ((p.x + 1) / 2) * width) <= 1 && Math.abs(y - ((1 - p.y) / 2) * height) <= 1, `${spot?.id}: reported ${x}, ${y}; drawn ${((p.x + 1) / 2) * width}, ${((1 - p.y) / 2) * height}`);
      }
    } finally {
      page.dispose();
    }
  });

  it('runs the scene application in a worker: the same objects on this thread, props in, input and messages across', async (/** @type {import('node:test').TestContext} */ t) => {
    /** Each worker's end: its session and both ports, closed whatever the test did. @type {(() => void)[]} */
    const ends = [];
    const worker = (/** @type {string} */ id) => {
      const { port1, port2 } = new MessageChannel();
      const session = serve(() => <Showroom />, { port: port1, root: Root(id), construct: CONSTRUCT });
      const end = () => (session.close(), port1.close(), port2.close());
      ends.push(end);
      return Object.assign(port2, { terminate: end });
    };
    const s = await room({ worker });
    after(t, () => {
      s.page.dispose();
      for (const end of ends) end();
    });
    s.press(s.at['finish:sage']);
    s.page.click('Run in a worker');
    assert.ok(await until(() => s.page.all('[data-ren-root="showroom-worker"] canvas').length === 1), 'the worker root replaces the direct one');
    assert.ok(await until(() => s.object('band') !== undefined && s.three().overlay !== null), 'the worker built the scene here');
    assert.ok(s.strip('where').includes('in a worker'));
    // Its store started from the kept configuration, and its interface is in the overlay.
    s.three().present();
    assert.ok(await until(() => (s.three().present(), texts(s.three().overlay).includes('Finish · Sage'))), 'the configuration carried over');
    assert.equal(s.object('right cup').getObjectByName('shell').geometry.type, 'LatheGeometry', 'constructor params crossed');
    assert.equal(s.three().camera.fov, 38, 'the main camera crossed');
    // A press on the overlay goes to the worker; the change comes back.
    s.press(s.at['band:steel']);
    assert.ok(await until(() => s.object('strap') === undefined), 'the worker removed the strap');
    assert.ok(await until(() => s.strip('config').includes('Stainless steel')));
    // A drag raycast here orbits there: the pointer's x and y cross, the camera rig's rotation comes back.
    const rig = s.object('rig');
    const yaw = rig.rotation.y;
    s.drag([560, 260], [460, 260]);
    assert.ok(await until(() => rig.rotation.y > yaw + 0.5), 'the camera turned');
    // The wheel's delta crosses too: the camera comes closer.
    const camera = s.three().camera;
    const far = camera.position.z;
    s.three().input('wheel', 500, 300, { deltaY: -300 });
    assert.ok(await until(() => camera.position.z < far - 0.5), 'the wheel zoomed from the worker');
    // Its animations run on its own frames and cross as signal writes.
    assert.ok(await until(() => Number(s.page.host.querySelector('.app-showroom').getAttribute('data-frames')) >= 30, 3000), 'frames reported from the worker');
    s.page.click('Run on this thread');
    assert.ok(await until(() => s.page.all('[data-ren-root="showroom-scene"] canvas').length === 1));
    s.step(2);
    assert.ok(texts(s.three().overlay).includes('Headband · Stainless steel'), 'back, with the configuration');
  });
});

