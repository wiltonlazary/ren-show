// Mail: one mail client written only with ren-core's portable primitives
// (View, Scroll, Label, Edit, Action, Shape) and their portable style and
// events. No HTML tag, no renderer and no DOM API: the same component runs
// on ren-dom, on a Skia canvas, in a three.js overlay or panel, and in a
// worker. The page gives it its colors, size and (for the parity script)
// commands through the root's props; it answers through Send.
//
// Layout is fixed in pixels where geometry matters (rows, bars), so every
// renderer puts the same row under the same point, and text is cut to the
// same length everywhere (data.js `clip`), so the visible text is the same.
// Input is the DOM's everywhere: one onKey on the client's root hears the
// keys bubbling from whatever has the focus, refs focus the search and
// compose fields, and the scrollbar's thumb captures the pointer.
// Colors are read where they are drawn, so a new theme restyles the client
// in place (the page calls the renderer's setTheme and sends the colors).

import { $signal, $read, $write, $memo, $batch, $watch, $lookup, $cleanup, $owner, $untrack, $after } from 'rrx-core';
import { $active, Props, Send, View, Scroll, Label, Edit, Action, Shape, For, Show } from 'ren-core';
import { THEMES, argb } from '../../themes.js';
import { Mailbox, ROW } from './model.js';
import { FOLDERS, LABELS, short, long, clip } from './data.js';

/** The theme colors the client draws with (hex), as the page sends them. @typedef {import('../../themes.js').Palette} Colors */

/**
 * A scripted command, as the parity panel sends it (the same commands the
 * keyboard and the pointer run).
 * @typedef {{ seq: number, op: 'key' | 'go' | 'search' | 'open' | 'draft' | 'send' | 'undo' | 'scroll', arg?: any }} Command
 */

/**
 * A keyboard or pointer event as the handlers read it (the DOM's, ren-canv's
 * or a worker's Input).
 * @typedef {{ key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, preventDefault?: () => void }} Keyed
 */

/**
 * What the page sends as the root's props.
 * @typedef {object} Settings
 * @property {Colors} colors
 * @property {number} [width] in pixels (1100)
 * @property {number} [height] in pixels (660)
 * @property {boolean} [still] toasts stay and no timers run (the parity script)
 * @property {Command | null} [command] the next scripted command
 */

/**
 * What the client sends back: ready once built, then an acknowledgement
 * of each scripted command.
 * @typedef {{ ready: true, rows: number } | { ack: number }} Report
 */

/** The client's size when the page gives none. */
export const WIDTH = 1100;
export const HEIGHT = 660;

/** The bars and columns, in pixels. */
export const TOP = 56;
export const STATUS = 32;
export const HEAD = 44;
export const SIDE = 212;
export const LIST = 380;
/**
 * Below this width (a phone) the client shows one pane at a time: the
 * list, the open message (with a way back) or the compose sheet, and the
 * mailboxes from the top bar's menu.
 */
export const NARROW = 720;
/** The scrollbar's track width. */
const TRACK = 10;
/** The shortest scrollbar thumb. */
const THUMB = 36;

/** Focuses a ref where it can take the focus (a worker's handle cannot). @param {any} node */
const focus = node => {
  if (typeof node?.focus === 'function') node.focus();
};

/** A tint of a theme color: the color with an alpha byte (00 to ff). @param {string} hex @param {string} alpha */
const tint = (hex, alpha) => `${hex.slice(0, 7)}${alpha}`;

/** @param {number} n */
const thousands = n => n.toLocaleString('en-US');

/** A name's initials. @param {string} name */
const initials = name =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase();

/** A stable series index for a name. @param {string} name */
const hue = name => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 6;
};

/**
 * The mail client. Reads its settings from the root's Props; tests may pass
 * them directly.
 * @param {{ settings?: Settings }} props
 */
export function Mail(props) {
  const R = $active();
  // Settings given directly: no parent root to answer.
  const send = props.settings === undefined ? $lookup(Send) : () => {};
  /** @returns {Settings} */
  const settings = () => props.settings ?? /** @type {Settings | undefined} */ ($lookup(Props)) ?? { colors: THEMES[0].colors };
  // The size is read once (a new size is a new root); the colors wherever they are drawn.
  const first = $untrack(R, settings);
  const colors = $memo(R, () => settings().colors);
  /** The current theme's colors: each read tracks the theme. @type {Colors} */
  const c = /** @type {any} */ (new Proxy({}, { get: (_, key) => /** @type {any} */ ($read(colors))[key] }));
  const width = first.width ?? WIDTH;
  const height = first.height ?? HEIGHT;
  const body = height - TOP - STATUS - 2;
  const viewport = body - HEAD - 1;
  const mail = Mailbox(R, { viewport, still: first.still === true });
  const owner = $owner(R);
  if (owner !== null) $cleanup(owner, () => mail.close());

  /** The fields that take the focus: the search, and compose's first field. */
  const fields = { search: /** @type {any} */ (null), compose: /** @type {any} */ (null) };
  /** The fields that have the focus (typing keys are text, not shortcuts). @type {Set<string>} */
  const focused = new Set();
  /** A field's focus handlers, and its release when it goes (a removed field sends no blur). @param {string} name */
  const typist = name => ({ onFocus: () => void focused.add(name), onBlur: () => void focused.delete(name), gone: () => void focused.delete(name) });

  /**
   * The shortcuts: one handler on the client's root hears every key from
   * whatever has the focus. Enter and Space belong to the focused control
   * (a row opens the cursor's message, a button presses); a field's keys
   * are its own text.
   * @param {Keyed} e
   */
  const onKey = e => {
    if (focused.size > 0 || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Enter' || e.key === ' ') return;
    const acted = mail.key(e.key);
    if (acted === 'search') {
      // The key's own character stays out of the field it focuses.
      e.preventDefault?.();
      focus(fields.search);
    }
  };

  // The parity script's commands, acknowledged once run.
  $watch(
    R,
    () => settings().command ?? null,
    cmd => {
      if (cmd === null) return;
      run(mail, cmd);
      send({ ack: cmd.seq });
    },
  );

  const reader = width - SIDE - LIST - 2;
  const narrow = width < NARROW;
  send({ ready: true, rows: mail.messages.length });
  /** @type {Part} */
  const part = { mail, c, typist, fields, narrow };
  // On a phone the mailboxes take the pane while chosen from the menu.
  const browsing = $signal(R, false);
  return (
    <View style={() => ({ width, height, background: c.canvas, color: c.ink, fontSize: 14, lineHeight: 1.35 })} onKey={onKey}>
      <Bar {...part} menu={() => $batch(R, () => ($write(browsing, !$read(browsing)), mail.back()))} />
      <View style={() => ({ height: 1, shrink: 0, background: c.rule })} />
      {narrow ? (
        <Panes {...part} width={width} height={body} viewport={viewport} browsing={browsing} />
      ) : (
        <View style={{ direction: 'row', height: body, shrink: 0 }}>
          <Sidebar {...part} height={body} width={SIDE} />
          <View style={() => ({ width: 1, background: c.rule })} />
          <List {...part} viewport={viewport} width={LIST} />
          <View style={() => ({ width: 1, background: c.rule })} />
          <View style={() => ({ width: reader, height: body, background: c.surface })}>
            <Show when={mail.composing} fallback={<Reader {...part} height={body} />}>
              <Compose {...part} />
            </Show>
          </View>
        </View>
      )}
      <View style={() => ({ height: 1, shrink: 0, background: c.rule })} />
      <Status {...part} />
    </View>
  );
}

/**
 * Which pane a phone shows: the compose sheet while it is open, the
 * mailboxes while chosen, the open message, else the list.
 * @param {import('./model.js').Mail} mail @param {boolean} browsing
 * @returns {'compose' | 'folders' | 'reader' | 'list'}
 */
export const paneOf = (mail, browsing) => ($read(mail.composing) ? 'compose' : browsing ? 'folders' : $read(mail.opened) !== null ? 'reader' : 'list');

/**
 * The client on a phone: one pane at a time, as wide as the client. The
 * list is the desktop's (the same rows, the same seven in view); the open
 * message has a way back to it over the reading pane.
 * @param {Part & { width: number, height: number, viewport: number, browsing: import('rrx-core').Writable<boolean> }} props
 */
function Panes(props) {
  const R = $active();
  const { mail, c, width, height, browsing } = props;
  const pane = $memo(R, () => paneOf(mail, $read(browsing)));
  /** A folder chosen from the mailboxes: its list shows. @param {import('./model.js').Folder} f */
  const go = f =>
    $batch(R, () => {
      mail.go(f);
      mail.back();
      $write(browsing, false);
    });
  return (
    <View style={() => ({ width, height, shrink: 0, background: c.surface })}>
      {() => {
        switch ($read(pane)) {
          case 'folders':
            return <Sidebar {...props} height={height} width={width} go={go} />;
          case 'compose':
            return <Compose {...props} />;
          case 'reader':
            return (
              <>
                <View style={{ direction: 'row', align: 'center', gap: 10, height: HEAD, shrink: 0, padding: [0, 12] }}>
                  <Button text={() => `‹ ${titleOf(mail)}`} label="Back to the list" c={c} onPress={mail.back} />
                </View>
                <View style={() => ({ height: 1, shrink: 0, background: c.rule })} />
                <Reader {...props} height={height - HEAD - 1} />
              </>
            );
          default:
            return <List {...props} width={width} />;
        }
      }}
    </View>
  );
}

/**
 * Runs one scripted command on the model.
 * @param {import('./model.js').Mail} mail @param {Command} cmd
 */
export function run(mail, cmd) {
  switch (cmd.op) {
    case 'key':
      mail.key(String(cmd.arg));
      break;
    case 'go':
      mail.go(cmd.arg);
      break;
    case 'search':
      mail.search(String(cmd.arg));
      break;
    case 'open':
      mail.open($read(mail.list)[Number(cmd.arg)] ?? null);
      break;
    case 'draft':
      $write(mail.draft.to, cmd.arg?.to ?? '');
      $write(mail.draft.subject, cmd.arg?.subject ?? '');
      $write(mail.draft.body, cmd.arg?.body ?? '');
      break;
    case 'send':
      mail.send();
      break;
    case 'undo':
      mail.undo();
      break;
    case 'scroll':
      mail.scrollBy(Number(cmd.arg));
      break;
  }
}

/** A one-cell grid: a Tap's content and its Action share the cell. */
const CELL = /** @type {const} */ ({ display: 'grid', columns: '1fr', rows: '1fr', shrink: 0 });

/**
 * A pressable area: its content with a transparent Action over it (one grid
 * cell holds both), so a press anywhere presses the Action and gives it the
 * keyboard focus, on every renderer.
 * @param {{ label: () => string, style: any, over?: () => any, onPress: () => void, onKey?: (e: Keyed) => void, children?: any }} props
 */
function Tap(props) {
  const own = props.style;
  const style = typeof own === 'function' ? () => ({ ...CELL, ...own() }) : { ...CELL, ...own };
  return (
    <View style={style}>
      <View style={{ column: 1, row: 1, select: 'none' }}>{props.children}</View>
      <Action
        text=""
        label={props.label}
        style={() => ({ column: 1, row: 1, minHeight: 0, padding: 0, border: 0, radius: 0, background: 'transparent', cursor: 'pointer', ...props.over?.() })}
        onPress={props.onPress}
        onKey={props.onKey}
      />
    </View>
  );
}

/**
 * What every part of the client shares: the model, the current colors, the
 * focus handlers of a field, the fields refs focus, and whether the client
 * is a phone's (`narrow`: one pane at a time).
 * @typedef {{ mail: import('./model.js').Mail, c: Colors, typist: (name: string) => { onFocus: () => void, onBlur: () => void, gone: () => void }, fields: { search: any, compose: any }, narrow: boolean }} Part
 */

/** A small button in the client's style. @param {{ text: any, c: Colors, onPress: () => void, accent?: boolean, label?: string }} props */
function Button(props) {
  const c = props.c;
  const accent = props.accent === true;
  return (
    <Action
      text={props.text}
      label={props.label}
      style={() => ({
        height: 32,
        minHeight: 32,
        padding: [0, 14],
        radius: 8,
        fontSize: 13,
        fontWeight: accent ? 'bold' : 'normal',
        background: accent ? c.accent : c.surface,
        color: accent ? c.accentInk : c.ink,
        border: accent ? 0 : 1,
        borderColor: c.border,
        cursor: 'pointer',
        hover: { background: accent ? tint(c.accent, 'e0') : c.raised },
        press: { background: accent ? tint(c.accent, 'c0') : c.soft },
      })}
      onPress={props.onPress}
    />
  );
}

/**
 * The top bar: the brand, the search field, the sync light and Compose; on
 * a phone the menu of mailboxes in place of the brand, and the field takes
 * the room left.
 * @param {Part & { menu: () => void }} props
 */
function Bar(props) {
  const { mail, c, typist, fields, narrow } = props;
  const bars = () => [0, 7, 14].map(y => ({ kind: 'round', x: 3, y: y + 5, right: 25, bottom: y + 7, radius: 1, color: argb(c.ink) }));
  const envelope = () => [
    { kind: 'round', x: 1, y: 4, right: 27, bottom: 22, radius: 4, color: argb(c.accent) },
    { kind: 'path', points: [3, 7, 14, 15, 25, 7], closed: false, color: argb(c.accentInk), width: 2, stroke: 2 },
  ];
  return (
    <View style={() => ({ direction: 'row', align: 'center', gap: 14, height: TOP, shrink: 0, padding: [0, 18], background: c.surface })}>
      {narrow ? (
        <Tap label={() => 'Mailboxes'} style={{ width: 28, height: 26, radius: 6 }} over={() => ({ radius: 6, hover: { background: tint(c.ink, '14') } })} onPress={props.menu}>
          <Shape shapes={bars} width={28} height={26} />
        </Tap>
      ) : (
        <>
          <Shape shapes={envelope} width={28} height={26} />
          <Label text="Mail" style={{ fontSize: 19, fontWeight: 'bold', width: 64 }} />
        </>
      )}
      <Edit
        label="Search mail   /"
        value={mail.typed}
        ref={(/** @type {any} */ node) => (fields.search = node)}
        style={() => ({ ...(narrow ? { grow: 1, shrink: 1, minWidth: 0 } : { width: 360 }), height: 36, minHeight: 36, radius: 18, padding: [0, 16], background: c.soft, border: 1, borderColor: c.rule, fontSize: 14, focus: { borderColor: c.accent } })}
        onChange={e => mail.search(e.value)}
        onSubmit={() => mail.open($read(mail.list)[0] ?? null)}
        onFocus={typist('search').onFocus}
        onBlur={typist('search').onBlur}
        onKey={(/** @type {Keyed} */ e) => {
          if (e.key === 'Escape') {
            // The key still reaches the client's root as the field's (not a
            // shortcut); the field lets the focus go after it.
            mail.search('');
            queueMicrotask(() => fields.search?.blur?.());
          } else if (e.key === 'ArrowDown') mail.key('j');
          else if (e.key === 'ArrowUp') mail.key('k');
        }}
      />
      {narrow ? null : <View style={{ grow: 1 }} />}
      <Shape width={10} height={10} shapes={() => [{ kind: 'oval', x: 1, y: 1, right: 9, bottom: 9, color: argb($read(mail.syncing) > 0 ? c.accent : c.rule) }]} />
      <Button text="Compose" accent c={c} onPress={() => mail.compose(false)} />
    </View>
  );
}

/**
 * The folders and labels, with their counts; `go` shows a folder (on a
 * phone, its list too).
 * @param {Part & { height: number, width: number, go?: (f: import('./model.js').Folder) => void }} props
 */
function Sidebar(props) {
  const { mail, c } = props;
  const go = props.go ?? mail.go;
  /** @param {{ id: import('./model.js').Folder, name: string, glyph: () => any, count: () => number, quiet?: boolean }} f */
  const item = f => {
    const here = () => $read(mail.folder) === f.id && $read(mail.query) === '';
    return (
      <Tap
        label={() => `${f.name}, ${f.count()}`}
        style={() => ({ height: 34, radius: 8, background: here() ? c.accentSoft : 'transparent' })}
        over={() => ({ radius: 8, hover: { background: tint(c.ink, '0d') } })}
        onPress={() => go(f.id)}
      >
        <View style={{ direction: 'row', align: 'center', gap: 10, height: 34, padding: [0, 10] }}>
          {f.glyph()}
          <Label text={f.name} style={() => ({ grow: 1, fontSize: 14, fontWeight: here() ? 'bold' : 'normal', color: c.ink })} />
          <Label text={() => (f.count() === 0 ? '' : thousands(f.count()))} style={() => ({ fontSize: 12, color: here() ? c.ink : c.muted, fontWeight: f.quiet ? 'normal' : 'bold' })} />
        </View>
      </Tap>
    );
  };
  const count = (/** @type {string} */ key) => () => $read(mail.counts)[key] ?? 0;
  const heading = (/** @type {number} */ top) => () => /** @type {any} */ ({ fontSize: 11, fontWeight: 'bold', color: c.muted, padding: [top, 10, 6, 10] });
  return (
    <Scroll style={() => ({ width: props.width, height: props.height, padding: [14, 10], gap: 2, background: c.canvas })}>
      <Label text="MAILBOXES" style={heading(4)} />
      {FOLDERS.map(f =>
        item({
          id: f.id,
          name: f.name,
          glyph: () => <Label text={f.glyph} style={() => ({ width: 18, textAlign: 'center', color: c.accent, fontSize: 14 })} />,
          count: count(f.id),
          quiet: f.id !== 'inbox',
        }),
      )}
      <Label text="LABELS" style={heading(16)} />
      {LABELS.map((l, i) =>
        item({
          id: `label:${l}`,
          name: l,
          glyph: () => (
            <View style={{ width: 18, align: 'center' }}>
              <View style={() => ({ width: 10, height: 10, radius: 5, background: c.series[i % 6] })} />
            </View>
          ),
          count: count(`label:${l}`),
        }),
      )}
    </Scroll>
  );
}

/** The list's title: the folder's name, or Search. @param {import('./model.js').Mail} mail */
const titleOf = mail => {
  const q = $read(mail.query).trim();
  if (q !== '') return 'Search';
  const f = $read(mail.folder);
  return f.startsWith('label:') ? f.slice(6) : (FOLDERS.find(x => x.id === f)?.name ?? f);
};

/**
 * The message list: a window of rows over the whole folder, scrolled by the
 * wheel and by a thumb that captures the pointer while it is dragged.
 * @param {Part & { viewport: number, width: number }} props
 */
function List(props) {
  const R = $active();
  const { mail, c, viewport } = props;
  /** The rows on screen, keyed by their slot: scrolling rereads a row, it never rebuilds one. */
  const slots = $memo(R, () => {
    const rows = $read(mail.list);
    const offset = $read(mail.offset);
    const from = Math.floor(offset / ROW);
    // Only the rows that show, whole or in part.
    const count = Math.ceil((viewport + (offset % ROW)) / ROW);
    /** @type {{ slot: number, id: number }[]} */
    const out = [];
    for (let i = 0; i < count && from + i < rows.length; i++) out.push({ slot: i, id: rows[from + i] });
    return out;
  });
  const total = () => $read(mail.list).length;
  const thumb = () => {
    const n = total() * ROW;
    return n <= viewport ? 0 : Math.max(THUMB, Math.round((viewport * viewport) / n));
  };
  const thumbTop = () => {
    const room = viewport - thumb();
    const limit = mail.limit();
    return limit === 0 ? 0 : Math.round(($read(mail.offset) / limit) * room);
  };
  /** A drag of the thumb: where it started, or null. @type {{ y: number, offset: number } | null} */
  let drag = null;
  const title = () => titleOf(mail);
  const subtitle = () => {
    const q = $read(mail.query).trim();
    const n = total();
    if (q !== '') return `${thousands(n)} ${n === 1 ? 'result' : 'results'} for “${clip(q, 18)}”`;
    return `${thousands(n)} ${n === 1 ? 'message' : 'messages'}`;
  };
  return (
    <View style={() => ({ width: props.width, background: c.surface })}>
      <View style={{ direction: 'row', align: 'center', justify: 'between', height: HEAD, shrink: 0, padding: [0, 16] }}>
        <Label text={title} style={{ fontSize: 16, fontWeight: 'bold' }} />
        <Label text={subtitle} style={() => ({ fontSize: 12, color: c.muted })} />
      </View>
      <View style={() => ({ height: 1, shrink: 0, background: c.rule })} />
      <View
        style={{ direction: 'row', height: viewport, shrink: 0, overflow: 'hidden' }}
        prevent="wheel"
        onWheel={e => {
          e.preventDefault();
          mail.scrollBy(e.deltaY * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? viewport : 1));
        }}
      >
        <View style={{ grow: 1, shrink: 1, overflow: 'hidden' }}>
          <View style={() => ({ margin: [-($read(mail.offset) % ROW), 0, 0, 0] })}>
            <For each={slots} by={s => s.slot}>
              {slot => <Row {...props} id={() => slot().id} />}
            </For>
          </View>
          <Show when={() => total() === 0}>
            <Label text={() => ($read(mail.query).trim() === '' ? 'Nothing here.' : 'No messages match.')} style={() => ({ padding: [40, 0], textAlign: 'center', color: c.muted })} />
          </Show>
        </View>
        <View
          style={{ width: TRACK, shrink: 0, padding: [2, 2], touchAction: 'none' }}
          onPointerDown={e => {
            // On the thumb, a drag that keeps the pointer (as the DOM's capture);
            // elsewhere on the track, a page toward the press.
            const top = thumbTop();
            const y = e.offsetY;
            if (y >= top && y <= top + thumb()) {
              drag = { y: e.y, offset: $read(mail.offset) };
              /** @type {any} */ (e.currentTarget)?.setPointerCapture?.(e.pointerId);
            } else mail.scrollBy(y < top ? -viewport : viewport);
          }}
          onPointerMove={e => {
            if (drag === null) return;
            const room = viewport - thumb();
            if (room > 0) mail.scrollTo(drag.offset + ((e.y - drag.y) / room) * mail.limit());
          }}
          onPointerUp={() => (drag = null)}
          // A press the browser takes back ends the drag too.
          onPointerCancel={() => (drag = null)}
        >
          <View style={() => ({ margin: [thumbTop(), 0, 0, 0], height: thumb(), radius: 3, background: thumb() === 0 ? 'transparent' : c.border, cursor: 'default' })} />
        </View>
      </View>
    </View>
  );
}

/** One row of the list. @param {Part & { id: () => number }} props */
function Row(props) {
  const { mail, c } = props;
  const m = () => {
    $read(mail.version);
    return /** @type {import('./data.js').Message} */ (mail.message(props.id()));
  };
  const selected = () => $read(mail.selected) === props.id();
  const unread = () => !m().read;
  // Enter and Space on a focused row open the cursor's message (j and k move
  // the cursor, not the focus); the press they cause is then theirs.
  let keyed = false;
  return (
    <Tap
      label={() => `${m().from}: ${m().subject}`}
      style={{ height: ROW }}
      over={() => ({ hover: { background: tint(c.ink, '0a') }, press: { background: tint(c.ink, '14') } })}
      onPress={() => {
        if (keyed) keyed = false;
        else mail.open(props.id());
      }}
      onKey={e => {
        keyed = e.key === 'Enter' || e.key === ' ';
        if (keyed) mail.open();
      }}
    >
      <View style={() => ({ direction: 'row', height: ROW - 1, padding: [9, 14, 7, 8], gap: 6, background: selected() ? c.accentSoft : c.surface })}>
        <View style={() => ({ width: 3, radius: 2, background: selected() ? c.accent : 'transparent' })} />
        <View style={{ width: 10, padding: [6, 0, 0, 0] }}>
          <View style={() => ({ width: 8, height: 8, radius: 4, background: unread() ? c.accent : 'transparent' })} />
        </View>
        <View style={{ grow: 1, shrink: 1, gap: 1, overflow: 'hidden' }}>
          <View style={{ direction: 'row', align: 'center', gap: 8, height: 20 }}>
            <Label text={() => clip(m().from, 26)} style={() => ({ grow: 1, fontSize: 14, fontWeight: unread() ? 'bold' : 'normal' })} />
            <Label text={() => `${m().starred ? '★ ' : ''}${short(m().date)}`} style={() => ({ fontSize: 12, color: m().starred ? c.accent : c.muted })} />
          </View>
          <Label text={() => clip(m().subject, 40)} style={() => ({ fontSize: 13, height: 18, fontWeight: unread() ? 'bold' : 'normal', color: c.ink })} />
          <Label text={() => clip(m().preview, 46)} style={() => ({ fontSize: 13, height: 18, color: c.muted })} />
        </View>
      </View>
      <View style={() => ({ height: 1, background: c.rule })} />
    </Tap>
  );
}

/** The reading pane: the open message, or the shortcuts. A Scroll's height is its own (the region's by default), so it is given. @param {Part & { height: number }} props */
function Reader(props) {
  const { mail, c } = props;
  const m = () => {
    $read(mail.version);
    const id = $read(mail.opened);
    return id === null ? null : mail.message(id);
  };
  return (
    <Scroll style={{ height: props.height, padding: props.narrow ? [16, 16] : [22, 28], gap: 14 }}>
      <Show when={() => m() !== null} fallback={<Empty c={c} />}>
        {() => {
          // The branch stays live until the empty state takes its place: it
          // keeps showing the last message meanwhile.
          /** @type {import('./data.js').Message} */
          let last = /** @type {any} */ (m());
          const msg = () => (last = m() ?? last);
          return (
            <View style={{ gap: 14 }}>
              <Label wrap text={() => msg().subject} style={{ fontSize: 21, fontWeight: 'bold', lineHeight: 1.3 }} />
              <View style={{ direction: 'row', gap: 6, wrap: true }}>
                <For each={() => msg().labels}>
                  {l => {
                    const i = Math.max(0, LABELS.indexOf(l()));
                    return <Label text={l()} style={() => ({ fontSize: 12, padding: [2, 10], radius: 10, background: tint(c.series[i], '26'), color: c.ink })} />;
                  }}
                </For>
              </View>
              <View style={{ direction: 'row', align: 'center', gap: 12 }}>
                <View style={() => ({ width: 40, height: 40, radius: 20, align: 'center', justify: 'center', background: c.series[hue(msg().from)] })}>
                  <Label text={() => initials(msg().from)} style={() => ({ fontSize: 14, fontWeight: 'bold', color: c.canvas })} />
                </View>
                <View style={{ grow: 1, shrink: 1, gap: 2 }}>
                  <Label text={() => msg().from} style={{ fontWeight: 'bold' }} />
                  <Label wrap={props.narrow} text={() => `${msg().email} → ${msg().to}`} style={() => ({ fontSize: 12, color: c.muted })} />
                  {props.narrow ? <Label text={() => long(msg().date)} style={() => ({ fontSize: 12, color: c.muted })} /> : null}
                </View>
                {props.narrow ? null : <Label text={() => long(msg().date)} style={() => ({ fontSize: 12, color: c.muted })} />}
              </View>
              <View style={{ direction: 'row', gap: 8, wrap: props.narrow }}>
                <Button text={() => (msg().place === 'archive' ? 'Move to Inbox' : 'Archive')} c={c} onPress={mail.archive} />
                <Button text={() => (msg().starred ? '★ Unstar' : '☆ Star')} c={c} onPress={mail.star} />
                <Button text="Mark unread" c={c} onPress={mail.unread} />
                <Button text="Reply" c={c} onPress={() => mail.compose(true)} />
              </View>
              <View style={() => ({ height: 1, background: c.rule })} />
              <For each={() => msg().body}>{p => <Label wrap text={p()} style={{ fontSize: 15, lineHeight: 1.55 }} />}</For>
            </View>
          );
        }}
      </Show>
    </Scroll>
  );
}

/** The shortcuts, when no message is open. @param {{ c: Colors }} props */
function Empty(props) {
  const c = props.c;
  const rows = [
    ['j  k', 'next and previous message'],
    ['↵', 'open the message'],
    ['e', 'archive, and on to the next'],
    ['s', 'star or unstar'],
    ['u', 'mark unread'],
    ['r', 'reply'],
    ['c', 'compose'],
    ['z', 'undo'],
    ['/', 'search'],
  ];
  return (
    <View style={{ gap: 10, padding: [30, 0] }}>
      <Label text="No message open" style={{ fontSize: 20, fontWeight: 'bold' }} />
      <Label wrap text="Press a message to read it. The keys work from anywhere in the client, except while you type in a field." style={() => ({ color: c.muted })} />
      <View style={{ gap: 6, padding: [10, 0] }}>
        {rows.map(([k, what]) => (
          <View style={{ direction: 'row', align: 'center', gap: 12 }}>
            <Label text={k} style={() => ({ width: 56, padding: [2, 8], radius: 6, textAlign: 'center', background: c.soft, border: 1, borderColor: c.rule, fontSize: 13, fontWeight: 'bold' })} />
            <Label text={what} style={() => ({ fontSize: 13, color: c.label })} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** The compose sheet: its first empty field takes the focus as it opens. @param {Part} props */
function Compose(props) {
  const { mail, c, typist, fields } = props;
  const field = () => ({ height: 38, minHeight: 38, radius: 8, padding: [0, 12], background: c.surface, border: 1, borderColor: c.border, focus: { borderColor: c.accent } });
  /** @param {Keyed} e */
  const escape = e => {
    if (e.key === 'Escape') mail.discard();
  };
  // Once the sheet is in place: the To field, or the text of a reply.
  const R = $active();
  const reply = $untrack(R, () => $read(mail.draft.to)) !== '';
  /** @param {any} node @param {boolean} first */
  const place = (node, first) => {
    if (!first) return;
    fields.compose = node;
    // After the flush that places the sheet: a node takes the focus once it is in the view.
    $after(R, () => focus(node));
  };
  const owner = $owner(R);
  /** @param {string} name */
  const common = name => {
    const t = typist(name);
    if (owner !== null) $cleanup(owner, t.gone);
    return { onKey: escape, onFocus: t.onFocus, onBlur: t.onBlur };
  };
  return (
    <View style={{ grow: 1, padding: props.narrow ? [16, 16] : [22, 28], gap: 12 }}>
      <Label text="New message" style={{ fontSize: 20, fontWeight: 'bold', height: 28 }} />
      <Edit label="To" value={mail.draft.to} ref={(/** @type {any} */ n) => place(n, !reply)} style={/** @type {any} */ (field)} onChange={e => $write(mail.draft.to, e.value)} {...common('to')} />
      <Edit label="Subject" value={mail.draft.subject} style={/** @type {any} */ (field)} onChange={e => $write(mail.draft.subject, e.value)} {...common('subject')} />
      <Edit
        lines={10}
        label="Write your message…"
        value={mail.draft.body}
        ref={(/** @type {any} */ n) => place(n, reply)}
        style={() => /** @type {any} */ ({ ...field(), height: undefined, minHeight: 0, grow: 1, padding: [10, 12], lineHeight: 1.5 })}
        onChange={e => $write(mail.draft.body, e.value)}
        {...common('body')}
      />
      <View style={{ direction: 'row', gap: 8, align: 'center' }}>
        <Button text="Send" accent c={c} onPress={mail.send} />
        <Button text="Discard" c={c} onPress={mail.discard} />
      </View>
    </View>
  );
}

/**
 * The status bar: the counts, and the toast with its undo, or the
 * shortcuts; on a phone the toast in place of the counts, and no shortcuts.
 * @param {Part} props
 */
function Status(props) {
  const { mail, c, narrow } = props;
  const counts = () => <Label text={() => `${thousands($read(mail.counts).all)} messages · ${thousands($read(mail.counts).unread)} unread`} style={() => ({ fontSize: 12, color: c.muted })} />;
  return (
    <View style={() => ({ direction: 'row', align: 'center', gap: 12, height: STATUS, shrink: 0, padding: narrow ? [0, 12] : [0, 16], background: c.surface })}>
      {narrow ? null : counts()}
      {narrow ? null : <View style={{ grow: 1 }} />}
      <Show
        when={() => $read(mail.toast) !== null}
        fallback={narrow ? counts : <Label text="j k move · ↵ open · e archive · s star · / search · c compose" style={() => ({ fontSize: 12, color: c.muted })} />}
      >
        <View style={() => ({ direction: 'row', align: 'center', gap: 10, padding: [0, 4, 0, 12], radius: 8, height: 26, background: c.ink })}>
          <Label text={() => $read(mail.toast)?.text ?? ''} style={() => ({ fontSize: 12, color: c.surface })} />
          <Show when={() => $read(mail.toast)?.undo != null}>
            <Action
              text="Undo"
              style={() => ({ height: 22, minHeight: 22, padding: [0, 10], radius: 6, fontSize: 12, fontWeight: 'bold', background: 'transparent', color: c.surface, cursor: 'pointer', hover: { background: tint(c.surface, '26') } })}
              onPress={mail.undo}
            />
          </Show>
        </View>
      </Show>
    </View>
  );
}
