// The portable primitives: the same tree renders on the DOM (here) and on
// Skia (the Skia demo renders this Gallery on a canvas).

import { $signal, $read, $write, $memo } from 'rrx-core';
import { $active, View as Box, Layout, Scroll, Label, Edit, Action, Image, Shape } from 'ren-core';
import { Block } from '../kit.jsx';
import { look, tone, argb } from '../themes.js';

/** The badge image, served next to the page. */
export const BADGE = './badge.png';

const KEYWORDS = new Set(['let', 'const', 'return', 'function', 'if', 'else', 'for', 'of', 'new']);

/**
 * A small highlighter: an Edit's value as styled runs (keywords, numbers,
 * strings, comments) in the theme's colors. The runs' texts join to the
 * value, so the Edit shows them; the value itself stays plain text.
 * @param {string} code
 */
export function highlight(code) {
  const { ren, colors } = look();
  const [, number, string] = colors.series.map(argb);
  /** @type {{ text: string, style?: any }[]} */
  const runs = [];
  for (const [token] of code.matchAll(/\/\/[^\n]*|"[^"\n]*"?|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|\s+|[^\sA-Za-z_$\d"/]+|\//g)) {
    if (token.startsWith('//')) runs.push({ text: token, style: { color: ren.muted, italic: true } });
    else if (token.startsWith('"')) runs.push({ text: token, style: { color: string } });
    else if (/^\d/.test(token)) runs.push({ text: token, style: { color: number } });
    else if (KEYWORDS.has(token)) runs.push({ text: token, style: { color: ren.accent, fontWeight: 700 } });
    else runs.push({ text: token });
  }
  return runs;
}

/**
 * Every primitive with its properties and events, renderer-neutral: no HTML
 * tags, only ren-core primitives.
 * @param {{ source?: string | null }} props `source` for the Image (none: no Image)
 */
export function Gallery(props) {
  const R = $active();
  const name = $signal(R, 'Nora');
  const notes = $signal(R, 'Multi-line\ntext');
  const code = $signal(R, 'let answer = 42\n// styled runs, plain value\nconst name = "ren"');
  const events = $signal(R, 'no events yet');
  const bold = $signal(R, false);
  const hidden = $signal(R, false);
  const angle = $signal(R, 0);
  // The shapes follow the angle (a hand sweeping around a dial) and the theme.
  const shapes = $memo(R, () => {
    const { ren, colors } = look();
    const [one, two, three] = colors.series.map(argb);
    const a = ($read(angle) * Math.PI) / 180;
    const x = 60 + Math.cos(a) * 40;
    const y = 60 + Math.sin(a) * 40;
    return [
      { kind: 'oval', x: 16, y: 16, right: 104, bottom: 104, color: ren.soft },
      { kind: 'oval', x: 16, y: 16, right: 104, bottom: 104, color: ren.accent, stroke: 3 },
      { kind: 'line', x: 60, y: 60, right: x, bottom: y, color: ren.danger, stroke: 4 },
      { kind: 'rect', x: 124, y: 20, right: 164, bottom: 60, color: two },
      { kind: 'round', x: 124, y: 70, right: 164, bottom: 104, radius: 8, color: three },
      { kind: 'path', points: [180, 100, 200, 20, 220, 100], closed: true, color: one },
    ];
  });
  const source = props.source ?? null;
  return (
    <Box gap={12} pad={12} fill={tone('paper')}>
      <Layout layout="row" gap={12}>
        <Label text="Label" size={22} color={tone('accent')} />
        <Label text={() => ($read(bold) ? 'selected' : 'not selected')} size={14} />
        <Action text="Toggle" selected={bold} onPress={() => $write(bold, !$read(bold))} />
      </Layout>
      <Label wrap text="A wrapping label keeps its words together and breaks lines to fit the width it is given, on the DOM and on the canvas alike." width={320} />
      <Layout layout="row" gap={12}>
        <Edit
          label="Name"
          value={name}
          invalid={() => $read(name).trim() === ''}
          onChange={e => $write(name, e.value)}
          onSubmit={e => $write(events, `submitted "${e.value}"`)}
          onKey={e => $write(events, `key ${e.key}`)}
          onFocus={() => $write(events, 'focus')}
          onBlur={() => $write(events, 'blur')}
          width={200}
        />
        <Label text={() => `Hello, ${$read(name) || '…'}`} />
      </Layout>
      <Layout layout="row" gap={12}>
        <Edit lines={3} label="Notes" value={notes} onChange={e => $write(notes, e.value)} width={320} />
        {/* Monospace: a bold keyword keeps its advance, so the field's caret stays on the runs on the DOM too. */}
        <Edit lines={3} label="Code" value={code} runs={() => highlight($read(code))} onChange={e => $write(code, e.value)} width={300} style={{ fontFamily: 'monospace' }} />
      </Layout>
      <Label text={events} color={tone('muted')} />
      <Layout layout="row" gap={12}>
        <Shape shapes={shapes} width={240} height={120} />
        <Box gap={8}>
          <Action text="Turn the hand" onPress={() => $write(angle, ($read(angle) + 30) % 360)} />
          <Action text={() => ($read(hidden) ? 'Show the list' : 'Hide the list')} onPress={() => $write(hidden, !$read(hidden))} />
        </Box>
        {source !== null ? <Image source={source} label="The ren badge" width={96} height={96} /> : null}
      </Layout>
      <Scroll height={120} gap={4} hidden={hidden}>
        {Array.from({ length: 20 }, (_, i) => (
          <Label text={`Scrolling row ${i + 1}`} />
        ))}
      </Scroll>
    </Box>
  );
}

function View() {
  return (
    <div class="demo">
      <Block title="Gallery" note="View, Layout, Scroll, Label, Edit, Action, Image and Shape, with their portable properties and events; the Code field shows its value in highlighted runs while it stays plain text. The Skia demo renders this same component on a canvas.">
        <Gallery source={BADGE} />
      </Block>
    </div>
  );
}

export default {
  id: 'primitives',
  group: 'ren-core',
  title: 'Portable primitives',
  apis: ['View', 'Layout', 'Scroll', 'Label', 'Edit', 'Action', 'Image', 'Shape', 'Edit runs'],
  summary: 'Eight primitives with one set of properties and events. The DOM renderer maps them to elements, and the Skia renderer lays them out and paints them itself.',
  View,
};
