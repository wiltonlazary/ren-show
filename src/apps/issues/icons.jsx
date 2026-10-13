// Small pieces of the Issues app: status and priority glyphs, avatars and
// label chips, in SVG and CSS so every theme colors them.

import { person, LABELS } from './data.js';

/**
 * The status glyph: a gauge, a square frame whose level rises a quarter a
 * stage (an idea's frame dashed, shipped full); dropped a bare frame with a
 * bar across.
 * @param {{ status: import('./data.js').Status | (() => import('./data.js').Status) }} props
 */
export function StatusIcon(props) {
  const status = () => (typeof props.status === 'function' ? props.status() : props.status);
  const level = () => LEVELS[status()] ?? 0;
  return (
    <svg class={() => `status-icon s-${status()}`} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <rect class="frame" x="1.75" y="1.75" width="10.5" height="10.5" rx="2.5" />
      <rect class="level" x="3.5" y={() => 10.5 - (7 * level()) / 4} width="7" height={() => (7 * level()) / 4} rx="1" />
      {() => (status() === 'dropped' ? <path class="bar" d="M4.5 7h5" /> : null)}
    </svg>
  );
}

/** How many quarters of each stage's gauge are filled. @type {Record<string, number>} */
const LEVELS = { idea: 0, ready: 1, doing: 2, checking: 3, shipped: 4, dropped: 0 };

/**
 * The priority glyph: a diamond of four pips, P1 all lit (in the danger
 * color), P4 one; unset an empty outline.
 * @param {{ priority: number | (() => number) }} props
 */
export function PriorityIcon(props) {
  const p = () => (typeof props.priority === 'function' ? props.priority() : props.priority);
  const lit = (/** @type {number} */ k) => (p() !== 0 && k <= 5 - p() ? 'pip on' : 'pip');
  return (
    <svg class={() => `priority-icon p-${p()}`} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {() =>
        p() === 0 ? (
          <path class="unset" d="M7 1.8L12.2 7L7 12.2L1.8 7Z" />
        ) : (
          <>
            <circle class={lit(1)} cx="7" cy="11" r="1.9" />
            <circle class={lit(2)} cx="3" cy="7" r="1.9" />
            <circle class={lit(3)} cx="11" cy="7" r="1.9" />
            <circle class={lit(4)} cx="7" cy="3" r="1.9" />
          </>
        )
      }
    </svg>
  );
}

/** An assignee's initials on their series color; a dashed ring when unassigned. @param {{ id: string | null | (() => string | null), size?: 'small' }} props */
export function Avatar(props) {
  const id = () => (typeof props.id === 'function' ? props.id() : props.id);
  return (
    <span class={() => `avatar${props.size ? ` ${props.size}` : ''}${id() === null ? ' none' : ` hue-${person(id())?.hue ?? 0}`}`} title={() => person(id())?.name ?? 'Unassigned'}>
      {() => person(id())?.initials ?? ''}
    </span>
  );
}

/** A label chip with its color dot. @param {{ name: string }} props */
export const LabelChip = props => (
  <span class={`label-chip hue-${LABELS.indexOf(props.name) % 6}`}>
    <i />
    {props.name}
  </span>
);

/** A keyboard key. @param {{ children?: any }} props */
export const Key = props => <kbd class="key">{props.children}</kbd>;
