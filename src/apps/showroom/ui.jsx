// Showroom's interface, all portable primitives inside the three.js root:
// - the overlay (primitives placed in the scene lie over the canvas): the
//   product's name and price, the corner controls and the configurator bar
//   (on a phone, Compact: the same controls stacked);
// - panels (primitives inside a three.js object become a textured plane in
//   3D): the spec card beside the product, the engraving card with its Edit,
//   and the detail card a hotspot opens, which turns to face the camera.
// Every color is the theme's, passed in as `c` (its getters follow a new
// theme, so the styles that read them are functions), except the swatches,
// which show the finishes themselves (materials.js).

import { $at } from 'rrx-core';
import { View, Label, Action, Edit } from 'ren-core';
import { FINISHES, CUSHIONS, BANDS, SIZES, PRODUCT, ENGRAVING, pick, price, weight, dollars, summary } from './materials.js';
import { WIDTH, EDGE, BAR, GROUP, SWATCH, CUSHION, BANDING, SIZING, BAG, CORNER, WIDTHS, span, barOf } from './layout.js';

/** @typedef {import('./materials.js').Config} Config */
/** @typedef {import('../../themes.js').Palette} Palette */

/**
 * What the interface does to the store (scene.jsx makes it).
 * @typedef {object} Actions
 * @property {(key: 'finish' | 'cushion' | 'band' | 'size', id: string) => void} choose
 * @property {(text: string) => void} engrave
 * @property {() => void} explode toggles the exploded view
 * @property {() => void} rotate toggles the turntable
 * @property {() => void} reset flies home
 * @property {(factor: number) => void} zoom
 * @property {() => void} add adds the configuration to the bag
 * @property {() => void} close closes the detail card
 */

/**
 * @typedef {object} Shared
 * @property {import('rrx-core').Box<any>} S the store: `config`, `view`, `bag`
 * @property {Actions} act
 * @property {Palette} c the theme's colors
 */

/** The configuration in the store, read whole (tracks every field). @param {import('rrx-core').Box<any>} S @returns {Config} */
const config = S => $at(S, ['config']);

/** A chip of the bar: an option, filled with the accent while chosen. @param {{ text: string, on: () => boolean, width: number, c: Palette, press: () => void }} p */
function Chip(p) {
  const { c } = p;
  return (
    <Action
      text={p.text}
      onPress={p.press}
      style={() => ({
        width: p.width,
        height: GROUP.control,
        minHeight: 0,
        radius: GROUP.control / 2,
        fontSize: 13,
        cursor: 'pointer',
        border: 1,
        borderColor: p.on() ? c.accent : c.border,
        background: p.on() ? c.accent : c.surface,
        color: p.on() ? c.accentInk : c.ink,
        hover: { background: p.on() ? c.accent : c.raised },
      })}
    />
  );
}

/** A group of the bar: its heading, then its controls in a row. @param {{ heading: () => string, width: number, c: Palette, children: any }} p */
function Group(p) {
  return (
    <View style={{ width: p.width, gap: GROUP.gap, shrink: 0 }}>
      <Label text={p.heading} style={() => ({ height: GROUP.heading, fontSize: 12, fontWeight: 'bold', color: p.c.label })} />
      <View style={{ direction: 'row', height: GROUP.control }}>{p.children}</View>
    </View>
  );
}

/**
 * The overlay: the whole canvas, clear where it has nothing, so the pointer
 * reaches the scene there. On a tablet's canvas (narrower than the full
 * one) the bar takes two rows: finish, cushions and headband, then the
 * size beside the summary (layout.js, controls()): a canvas that turns
 * tablet or back makes the overlay again. `onHead` hears the heading
 * block's size.
 * @param {Shared & { hint: () => string, size: () => [number, number], onHead?: (e: any) => void }} p
 */
export function Overlay(p) {
  const { S, act, c } = p;
  const width = p.size()[0];
  const tablet = width < WIDTH;
  /** The bar's groups and summary: one row, or on a tablet the two given. @param {any[]} first @param {any[]} second */
  const rows = (first, second) =>
    tablet
      ? [<View style={{ direction: 'row', gap: BAR.gap }}>{first}</View>, <View style={{ direction: 'row', gap: BAR.gap }}>{second}</View>]
      : [...first, ...second];
  const view = (/** @type {string} */ key) => $at(S, ['view', key]);
  const corner = (/** @type {() => string} */ text, /** @type {() => void} */ press, /** @type {number} */ width = CORNER.width) => (
    <Action
      text={text}
      onPress={press}
      style={() => ({ width, height: CORNER.height, minHeight: 0, radius: CORNER.height / 2, fontSize: 13, cursor: 'pointer', background: `${c.surface}e6`, color: c.ink, border: 1, borderColor: c.rule, hover: { background: c.raised }, press: { background: c.soft } })}
    />
  );
  return (
    <View style={() => ({ width: p.size()[0], height: p.size()[1], padding: EDGE, justify: 'between' })}>
      <View style={{ direction: 'row', justify: 'between', align: 'start' }}>
        <View style={{ width: 460, gap: 4 }} onResize={p.onHead}>
          <Label text="Showroom · Headphones" style={() => ({ fontSize: 12, fontWeight: 'bold', color: c.accent })} />
          <Label text={PRODUCT.name} style={() => ({ fontSize: 30, fontWeight: 'bold', color: c.ink })} />
          <Label text={() => `${dollars(price(config(S)))} · ${weight(config(S))} g · ${PRODUCT.battery} h battery`} style={() => ({ fontSize: 15, color: c.ink })} />
          <Label wrap text={() => summary(config(S))} style={() => ({ fontSize: 13, color: c.muted })} />
          <Label text={p.hint} style={() => ({ fontSize: 12, color: c.muted, italic: true })} />
          <Label text={() => { const n = $at(S, ['bag']); return n === 0 ? '' : `In your bag: ${n}`; }} style={() => ({ fontSize: 13, fontWeight: 'bold', color: c.accent })} />
        </View>
      </View>
      <View style={{ gap: CORNER.above }}>
        {/* The view controls: a row at the right, above the bar (layout.js controls()). */}
        <View style={{ direction: 'row', justify: 'end', gap: CORNER.gap }}>
          {corner(() => (view('exploded') ? 'Assemble' : 'Exploded view'), act.explode)}
          {corner(() => (view('rotate') ? 'Pause turntable' : 'Turntable'), act.rotate)}
          {corner(() => 'Reset view', act.reset)}
          {corner(() => '−', () => act.zoom(1.18), CORNER.zoom)}
          {corner(() => '+', () => act.zoom(1 / 1.18), CORNER.zoom)}
        </View>
        <View
          style={() => ({ direction: tablet ? 'column' : 'row', height: barOf(width), padding: BAR.padding, gap: BAR.gap, radius: 18, background: `${c.surface}f0`, border: 1, borderColor: c.rule, shadow: { y: 8, blur: 24, color: `${c.ink}26` } })}
        >
          {rows([
          <Group heading={() => `Finish · ${pick(FINISHES, config(S).finish).name}`} width={WIDTHS[0]} c={c}>
            <View style={{ direction: 'row', gap: SWATCH.gap }}>
              {FINISHES.map(f => (
                <Action
                  text=""
                  label={f.name}
                  onPress={() => act.choose('finish', f.id)}
                  style={() => ({ width: SWATCH.size, height: SWATCH.size, minHeight: 0, radius: SWATCH.size / 2, cursor: 'pointer', background: f.shell.color, border: config(S).finish === f.id ? 3 : 1, borderColor: config(S).finish === f.id ? c.accent : c.border })}
                />
              ))}
            </View>
          </Group>,
          <Group heading={() => `Cushions · ${pick(CUSHIONS, config(S).cushion).name}`} width={WIDTHS[1]} c={c}>
            <View style={{ direction: 'row', gap: CUSHION.gap }}>
              {CUSHIONS.map(o => <Chip text={o.name.split(' ')[0]} width={CUSHION.width} c={c} on={() => config(S).cushion === o.id} press={() => act.choose('cushion', o.id)} />)}
            </View>
          </Group>,
          <Group heading={() => `Headband · ${pick(BANDS, config(S).band).name}`} width={WIDTHS[2]} c={c}>
            <View style={{ direction: 'row', gap: BANDING.gap }}>
              {BANDS.map(o => <Chip text={o.id === 'steel' ? 'Steel' : 'Strap'} width={BANDING.width} c={c} on={() => config(S).band === o.id} press={() => act.choose('band', o.id)} />)}
            </View>
          </Group>],
          [<Group heading={() => 'Size'} width={WIDTHS[3]} c={c}>
            <View style={{ direction: 'row', gap: SIZING.gap }}>
              {SIZES.map(o => <Chip text={o.name} width={SIZING.width} c={c} on={() => config(S).size === o.id} press={() => act.choose('size', o.id)} />)}
            </View>
          </Group>,
          <View style={{ grow: 1, align: 'end', gap: BAG.gap }}>
            <Label text={() => dollars(price(config(S)))} style={() => ({ height: BAG.price, fontSize: 18, fontWeight: 'bold', color: c.ink })} />
            <Action
              text={() => ($at(S, ['bag']) === 0 ? 'Add to bag' : 'Add another')}
              onPress={act.add}
              style={() => ({ width: BAG.width, height: BAG.height, minHeight: 0, radius: BAG.height / 2, fontSize: 15, cursor: 'pointer', fontWeight: 'bold', background: c.accent, color: c.accentInk, hover: { background: `${c.accent}e0` }, press: { background: `${c.accent}c0` } })}
            />
          </View>]
          )}
        </View>
      </View>
    </View>
  );
}

/**
 * The overlay on a compact canvas (a phone): the name and price, the view
 * controls in a row under them, and the bar's groups wrapped above a row
 * of the price and "Add to bag".
 * @param {Shared & { size: () => [number, number] }} p
 */
export function Compact(p) {
  const { S, act, c } = p;
  const view = (/** @type {string} */ key) => $at(S, ['view', key]);
  const small = (/** @type {() => string} */ text, /** @type {() => void} */ press, /** @type {number} */ width) => (
    <Action
      text={text}
      onPress={press}
      style={() => ({ width, height: CORNER.height, minHeight: 0, radius: CORNER.height / 2, fontSize: 13, cursor: 'pointer', background: `${c.surface}e6`, color: c.ink, border: 1, borderColor: c.rule, hover: { background: c.raised }, press: { background: c.soft } })}
    />
  );
  return (
    <View style={() => ({ width: p.size()[0], height: p.size()[1], padding: 10, justify: 'between' })}>
      <View style={{ gap: 8 }}>
        <View style={{ gap: 2 }}>
          <Label text="Showroom · Headphones" style={() => ({ fontSize: 12, fontWeight: 'bold', color: c.accent })} />
          <Label text={PRODUCT.name} style={() => ({ fontSize: 24, fontWeight: 'bold', color: c.ink })} />
          <Label text={() => `${dollars(price(config(S)))} · ${weight(config(S))} g · ${PRODUCT.battery} h battery`} style={() => ({ fontSize: 14, color: c.ink })} />
        </View>
        <View style={{ direction: 'row', wrap: true, gap: 6 }}>
          {small(() => (view('exploded') ? 'Assemble' : 'Explode'), act.explode, 84)}
          {small(() => (view('rotate') ? 'Pause' : 'Turn'), act.rotate, 64)}
          {small(() => 'Reset', act.reset, 60)}
          {small(() => '−', () => act.zoom(1.18), 36)}
          {small(() => '+', () => act.zoom(1 / 1.18), 36)}
        </View>
      </View>
      <View style={() => ({ padding: 10, gap: 12, radius: 16, background: `${c.surface}f0`, border: 1, borderColor: c.rule, shadow: { y: 8, blur: 24, color: `${c.ink}26` } })}>
        <View style={{ direction: 'row', wrap: true, gap: 12 }}>
          <Group heading={() => `Finish · ${pick(FINISHES, config(S).finish).name}`} width={WIDTHS[0]} c={c}>
            <View style={{ direction: 'row', gap: SWATCH.gap }}>
              {FINISHES.map(f => (
                <Action
                  text=""
                  label={f.name}
                  onPress={() => act.choose('finish', f.id)}
                  style={() => ({ width: SWATCH.size, height: SWATCH.size, minHeight: 0, radius: SWATCH.size / 2, cursor: 'pointer', background: f.shell.color, border: config(S).finish === f.id ? 3 : 1, borderColor: config(S).finish === f.id ? c.accent : c.border })}
                />
              ))}
            </View>
          </Group>
          <Group heading={() => `Cushions · ${pick(CUSHIONS, config(S).cushion).name}`} width={WIDTHS[1]} c={c}>
            <View style={{ direction: 'row', gap: CUSHION.gap }}>
              {CUSHIONS.map(o => <Chip text={o.name.split(' ')[0]} width={CUSHION.width} c={c} on={() => config(S).cushion === o.id} press={() => act.choose('cushion', o.id)} />)}
            </View>
          </Group>
          {/* The headband chips a little narrower, so Headband and Size share a row on a 360 pixel phone. */}
          <Group heading={() => 'Headband'} width={span(BANDS.length, 72, BANDING.gap)} c={c}>
            <View style={{ direction: 'row', gap: BANDING.gap }}>
              {BANDS.map(o => <Chip text={o.id === 'steel' ? 'Steel' : 'Strap'} width={72} c={c} on={() => config(S).band === o.id} press={() => act.choose('band', o.id)} />)}
            </View>
          </Group>
          <Group heading={() => 'Size'} width={WIDTHS[3]} c={c}>
            <View style={{ direction: 'row', gap: SIZING.gap }}>
              {SIZES.map(o => <Chip text={o.name} width={SIZING.width} c={c} on={() => config(S).size === o.id} press={() => act.choose('size', o.id)} />)}
            </View>
          </Group>
        </View>
        <View style={{ direction: 'row', justify: 'between', align: 'center' }}>
          <Label text={() => dollars(price(config(S)))} style={() => ({ fontSize: 18, fontWeight: 'bold', color: c.ink })} />
          <Action
            text={() => ($at(S, ['bag']) === 0 ? 'Add to bag' : `Add another · ${$at(S, ['bag'])}`)}
            onPress={act.add}
            style={() => ({ width: BAG.width, height: BAG.height, minHeight: 0, radius: BAG.height / 2, fontSize: 15, cursor: 'pointer', fontWeight: 'bold', background: c.accent, color: c.accentInk, hover: { background: `${c.accent}e0` }, press: { background: `${c.accent}c0` } })}
          />
        </View>
      </View>
    </View>
  );
}

/** A card of a panel: the theme's surface, a hairline, rounded. @param {Palette} c @param {number} width */
const card = (c, width) => ({ width, padding: 14, gap: 8, radius: 14, background: `${c.surface}f2`, border: 1, borderColor: c.rule });

/** One row of the spec card. @param {{ name: string, value: () => string, c: Palette }} p */
function Spec(p) {
  return (
    <View style={{ direction: 'row', justify: 'between', gap: 8 }}>
      <Label text={p.name} style={() => ({ fontSize: 13, color: p.c.muted })} />
      <Label text={p.value} style={() => ({ fontSize: 13, color: p.c.ink, fontWeight: 'bold' })} />
    </View>
  );
}

/**
 * The spec card, a panel beside the product: every option at once,
 * selectable text; `onResize` hears its size (the scene stands it on the
 * floor by its height).
 * @param {Shared & { onResize?: (e: any) => void }} p
 */
export function SpecCard(p) {
  const { S, c } = p;
  const get = () => config(S);
  return (
    <View onResize={p.onResize} style={() => ({ ...card(c, 230), select: 'text' })}>
      <Label text={PRODUCT.name} style={() => ({ fontSize: 17, fontWeight: 'bold', color: c.ink })} />
      <Label text={() => dollars(price(get()))} style={() => ({ fontSize: 15, color: c.accent, fontWeight: 'bold' })} />
      <View style={() => ({ height: 1, background: c.rule })} />
      <Spec name="Finish" value={() => pick(FINISHES, get().finish).name} c={c} />
      <Spec name="Cushions" value={() => pick(CUSHIONS, get().cushion).name} c={c} />
      <Spec name="Headband" value={() => pick(BANDS, get().band).name} c={c} />
      <Spec name="Size" value={() => pick(SIZES, get().size).name} c={c} />
      <Spec name="Engraving" value={() => (get().engraving === '' ? 'none' : get().engraving)} c={c} />
      <Spec name="Weight" value={() => `${weight(get())} g`} c={c} />
      <Spec name="Battery" value={() => `${PRODUCT.battery} hours`} c={c} />
    </View>
  );
}

/** The engraving card's size, fixed so the page can say where its field shows. */
export const ENGRAVE = { width: 210, height: 114, padding: 14, title: 18, field: 36, hint: 16, gap: 8 };

/** The engraving card, a panel in front of the product: an Edit typed through the raycast. @param {Shared} p */
export function EngraveCard(p) {
  const { S, act, c } = p;
  const text = () => $at(S, ['config', 'engraving']);
  return (
    <View style={() => ({ ...card(c, ENGRAVE.width), height: ENGRAVE.height, padding: ENGRAVE.padding, gap: ENGRAVE.gap })}>
      <Label text="Engraving" style={() => ({ height: ENGRAVE.title, fontSize: 14, fontWeight: 'bold', color: c.ink })} />
      <Edit value={text} onChange={e => act.engrave(e.value)} style={() => ({ height: ENGRAVE.field, minHeight: 0, minWidth: 0, fontSize: 15, cursor: 'text', radius: 8, border: 1, borderColor: c.border, background: c.canvas, color: c.ink, focus: { borderColor: c.accent } })} />
      <Label text={() => `${text().length}/${ENGRAVING} · free · etched on the left cup`} style={() => ({ height: ENGRAVE.hint, fontSize: 11, color: c.muted })} />
    </View>
  );
}

/** The detail card a hotspot opens. @param {Shared & { title: () => string, body: () => string }} p */
export function DetailCard(p) {
  const { act, c } = p;
  return (
    <View style={() => ({ ...card(c, 240), shadow: { y: 6, blur: 18, color: `${c.ink}2e` } })}>
      <Label text={p.title} style={() => ({ fontSize: 16, fontWeight: 'bold', color: c.ink })} />
      <Label wrap text={p.body} style={() => ({ fontSize: 13, lineHeight: 1.45, color: c.muted })} />
      <Action text="Close" onPress={act.close} style={() => ({ self: 'end', height: 30, minHeight: 0, radius: 15, fontSize: 13, cursor: 'pointer', background: c.soft, color: c.ink, hover: { background: c.raised } })} />
    </View>
  );
}
