// The board view: a column per status over the mirror's columns. A card
// drags between columns with pointer events; its ghost follows the pointer in
// a Portal, and the drop is an optimistic move ($act over the store's
// overlay) that the fake server may reject, which rolls the card back.

import { $signal, $read, $write, $at, $lookup, $batch, $cleanup, $owner, $memo, $select } from 'rrx-core';
import { $active, For, Show, Portal } from 'ren-core';
import { Model, CARDS } from './model.js';
import { STATUSES } from './data.js';
import { StatusIcon, PriorityIcon, Avatar, LabelChip } from './icons.jsx';

/** Pixels the pointer travels before a press becomes a drag. */
export const SLOP = 4;

/** A card's face, shared by the card and its ghost. @param {{ id: string }} props */
function Face(props) {
  const m = $lookup(Model);
  const id = props.id;
  return (
    <>
      <header>
        <span class="id">{id}</span>
        <Avatar id={() => m.field(id, 'assignee')} size="small" />
      </header>
      <p class="title">{() => m.field(id, 'title')}</p>
      <footer>
        <PriorityIcon priority={() => m.field(id, 'priority')} />
        <For each={() => m.field(id, 'labels')}>{name => <LabelChip name={name()} />}</For>
        {() => (m.field(id, 'estimate') ? <span class="estimate">{`${m.field(id, 'estimate')} ${m.field(id, 'estimate') === 1 ? 'pt' : 'pts'}`}</span> : null)}
      </footer>
    </>
  );
}

export function Board() {
  const m = $lookup(Model);
  const R = $active();
  /** The card being dragged, and where the pointer is. */
  const drag = $signal(R, /** @type {{ id: string, x: number, y: number, dx: number, dy: number } | null} */ (null));
  // The lifted card, apart from the pointer: a move reruns no card.
  const lifted = $memo(R, () => $read(drag)?.id ?? null);
  const isLifted = $select(R, () => $read(lifted));
  const over = $signal(R, /** @type {import('./data.js').Status | null} */ (null));
  /** @type {{ id: string, x: number, y: number, dx: number, dy: number, target: any } | null} */
  let press = null;
  let dragged = false;
  /** @type {(() => void) | null} */
  let release = null;
  const end = () => {
    release?.();
    release = null;
    press = null;
  };
  $cleanup(/** @type {any} */ ($owner(R)), end);

  /** @param {any} e */
  const moved = e =>
    $batch(R, () => {
      if (press === null) return;
      const d = $read(drag);
      if (d === null) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < SLOP) return;
        dragged = true;
        $write(drag, { id: press.id, x: e.clientX, y: e.clientY, dx: press.dx, dy: press.dy });
        $write(over, m.field(press.id, 'status'));
      } else $write(drag, { ...d, x: e.clientX, y: e.clientY });
    });
  const dropped = () =>
    $batch(R, () => {
      const d = $read(drag);
      const to = $read(over);
      if (d !== null && to !== null) m.move(d.id, to);
      $write(drag, null);
      $write(over, null);
      end();
    });
  /** @param {any} e @param {string} id */
  const down = (e, id) => {
    if (e.button !== 0) return;
    const card = e.currentTarget;
    const box = card.getBoundingClientRect?.() ?? { left: e.clientX, top: e.clientY };
    press = { id, x: e.clientX, y: e.clientY, dx: e.clientX - box.left, dy: e.clientY - box.top, target: card };
    dragged = false;
    const owner = card.ownerDocument;
    owner.addEventListener('pointermove', moved);
    owner.addEventListener('pointerup', dropped);
    owner.addEventListener('pointercancel', dropped);
    release = () => {
      owner.removeEventListener('pointermove', moved);
      owner.removeEventListener('pointerup', dropped);
      owner.removeEventListener('pointercancel', dropped);
    };
  };

  return (
    <div class={() => `board${$read(lifted) !== null ? ' dragging' : ''}`}>
      <For each={STATUSES}>
        {status => {
          const s = status().id;
          const ids = () => /** @type {string[]} */ ($at(m.view, ['columns', s]) ?? []);
          const count = $memo(R, () => ids().length);
          const limit = () => $read(m.limits)[`col:${s}`] ?? CARDS;
          return (
            <section class={() => `column${$read(over) === s ? ' over' : ''}`} data-status={s} onPointerOver={() => $read(lifted) !== null && $write(over, s)}>
              <header>
                <StatusIcon status={s} />
                <span class="name">{status().name}</span>
                <span class="count">{count}</span>
              </header>
              <div class="cards">
                <For each={() => ids().slice(0, limit())}>
                  {id => {
                    const card = id();
                    return (
                      <article
                        class={() => `card${isLifted(card) ? ' lifted' : ''}${$at(m.moving, [card]) ? ' saving' : ''}${m.isOpen(card) ? ' open' : ''}`}
                        data-id={card}
                        onPointerDown={e => down(e, card)}
                        onClick={() => {
                          if (!dragged) m.open(card);
                          dragged = false;
                        }}
                      >
                        <Face id={card} />
                      </article>
                    );
                  }}
                </For>
                <Show when={() => $read(count) > limit()}>
                  <button type="button" class="more" onClick={() => m.showMore(`col:${s}`, limit() + CARDS * 2)}>
                    {() => `Show more (${($read(count) - limit()).toLocaleString('en-US')})`}
                  </button>
                </Show>
              </div>
            </section>
          );
        }}
      </For>
      <Show when={() => $read(lifted) !== null && $read(m.layer)}>
        {() => (
          <Portal into={$read(m.layer)}>
            <article
              class="card ghost"
              aria-hidden="true"
              style={() => {
                const d = $read(drag);
                return d === null ? '' : `transform: translate(${d.x - d.dx}px, ${d.y - d.dy}px) rotate(2deg)`;
              }}
            >
              {() => {
                const id = $read(lifted);
                return id === null ? null : <Face id={id} />;
              }}
            </article>
          </Portal>
        )}
      </Show>
    </div>
  );
}
