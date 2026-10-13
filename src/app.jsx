// ren-show shell: a top bar (the brand, the command palette, the theme
// menu), a sidebar of every section (home, the applications, the feature
// demos grouped by library) and the current section. On a narrow screen the
// sidebar is a drawer, opened from the top bar's menu button. Changing the section
// stops the previous one's scope, so everything it made goes with it. The
// theme is a signal provided as Look: the shell turns it into CSS custom
// properties, and the canvases and scenes read it where they draw.

import { $signal, $read, $write, $lookup, $cleanup, $owner, $watch, $memo } from 'rrx-core';
import { $active, For, Show, Portal, Runtime } from 'ren-core';
import { Assets } from './assets.js';
import { apps } from './apps/index.js';
import { demos } from './demos/index.js';
import { Home } from './home.jsx';
import { THEMES, Look, themed, properties } from './themes.js';

/**
 * A place in the shell: the home page, an application or a demo.
 * @typedef {{ id: string, kind: 'home' | 'app' | 'demo', title: string, group: string, item: any }} Section
 */

/** @type {Section} */
const HOME = { id: 'home', kind: 'home', title: 'Home', group: '', item: null };
/** Every section, in the sidebar's order. @type {Section[]} */
export const sections = [
  HOME,
  ...apps.map(a => /** @type {Section} */ ({ id: a.id, kind: 'app', title: a.title, group: 'apps', item: a })),
  ...demos.map(d => /** @type {Section} */ ({ id: d.id, kind: 'demo', title: d.title, group: d.group, item: d })),
];

/** @param {string} hash */
const find = hash => sections.find(s => s.id === hash.replace(/^#/, '')) ?? HOME;

/** The sidebar's groups. */
const GROUPS = [
  { id: 'apps', title: 'Applications' },
  { id: 'rrx-core', title: 'rrx-core · reactive core' },
  { id: 'ren-core', title: 'ren-core · components and renderers' },
];

/** Where the chosen theme is kept between visits. */
const KEPT = 'ren-show:theme';

/** Reads storage that may be missing or refuse access. @param {any} view */
const kept = view => {
  try {
    return view?.localStorage?.getItem(KEPT) ?? null;
  } catch {
    return null;
  }
};

/** @param {{ start?: string, window?: any, theme?: string }} props */
export function App(props) {
  const R = $active();
  const env = $lookup(Assets);
  const current = $signal(R, find(props.start ?? ''));
  const go = (/** @type {Section} */ section) => {
    $write(current, section);
    $write(palette, false);
    $write(drawer, false);
  };
  const view = props.window ?? null;
  // The window of the document this root renders into, where there is one.
  const page = /** @type {any} */ ($lookup(Runtime).element)?.ownerDocument?.defaultView ?? null;
  // The theme: the one asked for, the one kept, or the system's light or dark.
  const dark = page?.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
  const theme = $signal(R, themed(props.theme ?? kept(page) ?? (dark ? 'tonal-dark' : 'tonal')));
  const menu = $signal(R, false);
  const palette = $signal(R, false);
  // The sidebar as a drawer (narrow screens only: the sheet shows it so).
  const drawer = $signal(R, false);
  /** @type {any} */
  let toggle = null;
  /** @type {any} */
  let nav = null;
  // Opening moves the focus to the current section's link (once the drawer
  // shows); closing by the button, Escape or the backdrop gives it back to
  // the button.
  const openDrawer = () => {
    $write(drawer, true);
    queueMicrotask(() => {
      const here = nav?.querySelector('a.here') ?? nav?.querySelector('a');
      here?.focus?.({ preventScroll: true });
      here?.scrollIntoView?.({ block: 'nearest' });
    });
  };
  const closeDrawer = () => {
    if (!$read(drawer)) return;
    $write(drawer, false);
    toggle?.focus?.();
  };
  /**
   * Tab stays inside the open drawer: past its last link it wraps to its
   * first control, and back.
   * @param {KeyboardEvent} e
   */
  const trap = e => {
    if (e.key !== 'Tab' || !$read(drawer) || nav === null) return;
    const stops = [...nav.querySelectorAll('button, a[href]')];
    const [first, last] = [stops[0], stops.at(-1)];
    const at = nav.ownerDocument.activeElement;
    if (e.shiftKey ? at === first : at === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };
  const choose = (/** @type {import('./themes.js').Theme} */ t) => {
    $write(theme, t);
    try {
      page?.localStorage?.setItem(KEPT, t.id);
    } catch {
      // Private windows may refuse storage; the choice still holds for this visit.
    }
  };
  if (view !== null) {
    // Back and forward follow the hash.
    const follow = () => go(find(view.location.hash));
    view.addEventListener('hashchange', follow);
    $cleanup(/** @type {any} */ ($owner(R)), () => view.removeEventListener('hashchange', follow));
  }
  if (page !== null) {
    // The page outside the shell (body, scrollbars) follows the theme too.
    const html = page.document.documentElement;
    $watch(R, () => $read(theme), t => {
      html.setAttribute('data-theme', t.id);
      html.style.colorScheme = t.dark ? 'dark' : 'light';
      for (const [key, value] of properties(t)) html.style.setProperty(key, value);
    });
    // The page behind an open drawer does not scroll (the sheet, on narrow screens).
    $watch(R, () => $read(drawer), open => void html.classList.toggle('drawer-open', open));
    // Ctrl or Cmd+K opens the command palette anywhere; Escape closes it and
    // the theme menu. An application that took the key (Issues has its own
    // palette) keeps it.
    const keys = (/** @type {KeyboardEvent} */ e) => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $write(palette, !$read(palette));
      } else if (e.key === 'Escape') {
        $write(palette, false);
        $write(menu, false);
        closeDrawer();
      }
    };
    page.addEventListener('keydown', keys);
    $cleanup(/** @type {any} */ ($owner(R)), () => page.removeEventListener('keydown', keys));
  }
  const at = (/** @type {number} */ step) => () => {
    const i = sections.indexOf($read(current));
    return sections[(i + step + sections.length) % sections.length];
  };
  const previous = at(-1);
  const next = at(1);
  /**
   * A step link's click: going there re-renders the link's own href before
   * the browser follows it (the section after next), so the step records the
   * hash itself.
   * @param {() => Section} target
   */
  const step = target => (/** @type {MouseEvent} */ e) => {
    e.preventDefault();
    const s = target();
    go(s);
    view?.history?.pushState(null, '', `#${s.id}`);
  };
  const link = (/** @type {Section} */ s) => (
    <a href={`#${s.id}`} class={() => ($read(current) === s ? 'here' : '')} onClick={() => go(s)}>
      {s.title}
    </a>
  );
  return (
    <Look value={theme}>
      <div class={() => ($read(drawer) ? 'shell drawer-open' : 'shell')} data-theme={() => $read(theme).id} style={() => Object.fromEntries(properties($read(theme)))}>
        <header class="top">
          <button
            type="button"
            class="menu"
            aria-label="Sections"
            aria-controls="sections"
            aria-expanded={() => String($read(drawer))}
            ref={(/** @type {any} */ el) => void (toggle = el)}
            onClick={() => ($read(drawer) ? closeDrawer() : openDrawer())}
          >
            <span class="bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          <a class="brand" href="#home" onClick={() => go(HOME)}>
            <span class="mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <b>ren</b>
              <small>show</small>
            </span>
          </a>
          <button type="button" class="search" aria-label="Search sections and themes" onClick={() => $write(palette, true)}>
            <i class="glass" aria-hidden="true" />
            <span>Search sections and themes…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span class="mode" title="How this bundle's JSX was built">
            {env.mode === 'compiled' ? 'compiled templates' : 'JSX runtime'}
          </span>
          <div class={() => ($read(menu) ? 'theme-menu open' : 'theme-menu')}>
            <button type="button" class="current" aria-label={() => `Theme: ${$read(theme).name}`} aria-expanded={() => String($read(menu))} onClick={() => $write(menu, !$read(menu))}>
              <span class="chip" aria-hidden="true" style={() => ({ '--a': $read(theme).colors.accent, '--b': $read(theme).colors.canvas, '--c': $read(theme).colors.surface })} />
              <span>{() => $read(theme).name}</span>
            </button>
            <section class="themes" aria-label="Theme">
              {[false, true].map(isDark => (
                <div>
                  <h2>{isDark ? 'Dark' : 'Light'}</h2>
                  <div class="swatches">
                    {THEMES.filter(t => t.dark === isDark).map(t => (
                      <button
                        type="button"
                        class={() => ($read(theme) === t ? 'swatch on' : 'swatch')}
                        data-theme-id={t.id}
                        title={t.name}
                        aria-pressed={() => String($read(theme) === t)}
                        style={{ '--a': t.colors.accent, '--b': t.colors.canvas, '--c': t.colors.surface }}
                        onClick={() => choose(t)}
                      >
                        <span class="chip" aria-hidden="true" />
                        <span class="name">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        </header>
        <div class="scrim" aria-hidden="true" onClick={closeDrawer} />
        <nav class="side" id="sections" aria-label="Sections" ref={(/** @type {any} */ el) => void (nav = el)} onKeyDown={trap}>
          <div class="drawer-head">
            <span class="title">Sections</span>
            <button type="button" class="close" aria-label="Close the sections" onClick={closeDrawer}>
              <i aria-hidden="true" />
            </button>
          </div>
          <ul class="first">
            <li>{link(HOME)}</li>
          </ul>
          {GROUPS.map(group => {
            const members = sections.filter(s => s.group === group.id);
            return members.length === 0 ? null : (
              <section>
                <h2>
                  {group.title}
                  <span class="count">{String(members.length)}</span>
                </h2>
                <ul>
                  <For each={members}>{s => <li>{link(s())}</li>}</For>
                </ul>
              </section>
            );
          })}
        </nav>
        <main class="page">
          {() => {
            const section = $read(current);
            if (section.kind === 'home') return <Home go={id => go(find(id))} />;
            const item = section.item;
            const View = item.View;
            const prefix = section.kind === 'app' ? `apps/${section.id}/` : `demos/${section.id}.jsx`;
            const files = Object.keys(env.sources).filter(f => (section.kind === 'app' ? f.startsWith(prefix) : f === prefix));
            return (
              <article data-demo={section.id} class={section.kind === 'app' ? `app app-frame` : 'demo-page'}>
                <header class="hero">
                  <p class="group">{section.kind === 'app' ? 'Application' : item.group}</p>
                  <h2>{item.title}</h2>
                  <p class="summary">{item.summary}</p>
                  <p class="apis">
                    {item.apis.map((/** @type {string} */ api) => (
                      <code>{api}</code>
                    ))}
                  </p>
                </header>
                <View />
                {files.map(file => (
                  <details class="source">
                    <summary>Source · src/{file}</summary>
                    <pre class="code">{env.sources[file]}</pre>
                  </details>
                ))}
              </article>
            );
          }}
          <footer class="steps">
            <a class="step" href={() => `#${previous().id}`} onClick={step(previous)}>
              <small>Previous</small>
              <span>{() => previous().title}</span>
            </a>
            <a class="step next" href={() => `#${next().id}`} onClick={step(next)}>
              <small>Next</small>
              <span>{() => next().title}</span>
            </a>
          </footer>
        </main>
        <Show when={() => $read(palette)}>
          {() => (
            <Portal>
              <Palette go={go} choose={choose} close={() => $write(palette, false)} />
            </Portal>
          )}
        </Show>
      </div>
    </Look>
  );
}

/**
 * The command palette: every section and theme, filtered as you type;
 * arrows move, Enter runs, Escape or a click outside closes.
 * @param {{ go: (s: Section) => void, choose: (t: import('./themes.js').Theme) => void, close: () => void }} props
 */
function Palette(props) {
  const R = $active();
  const query = $signal(R, '');
  const active = $signal(R, 0);
  /** @typedef {{ label: string, hint: string, run: () => void }} Command */
  /** @type {Command[]} */
  const all = [
    ...sections.map(s => ({ label: s.title, hint: s.kind === 'home' ? 'page' : s.kind === 'app' ? 'application' : s.group, run: () => props.go(s) })),
    ...THEMES.map(t => ({ label: `Theme: ${t.name}`, hint: t.dark ? 'dark theme' : 'light theme', run: () => (props.choose(t), props.close()) })),
  ];
  // Every word of the query appears in the label or its hint.
  const found = $memo(R, () => {
    const words = $read(query).toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(c => words.every(w => `${c.label} ${c.hint}`.toLowerCase().includes(w))).slice(0, 12);
  });
  const run = (/** @type {Command | undefined} */ c) => c?.run();
  return (
    <div class="palette-backdrop" onClick={e => e.target === e.currentTarget && props.close()}>
      <div class="palette" role="dialog" aria-label="Command palette">
        <input
          class="palette-input"
          placeholder="Jump to a section or theme…"
          // Focused as it opens, once attached (a ref runs before): an
          // autofocus attribute would be refused (the page already has a
          // focused element) and logged.
          ref={(/** @type {any} */ el) => queueMicrotask(() => el?.focus?.())}
          value={() => $read(query)}
          onInput={e => {
            $write(query, e.currentTarget.value);
            $write(active, 0);
          }}
          onKeyDown={e => {
            const list = $read(found);
            if (e.key === 'ArrowDown') $write(active, Math.min(list.length - 1, $read(active) + 1));
            else if (e.key === 'ArrowUp') $write(active, Math.max(0, $read(active) - 1));
            else if (e.key === 'Enter') run(list[$read(active)]);
            else return;
            e.preventDefault();
          }}
        />
        <ul class="palette-list">
          <For each={found} fallback={<li class="quiet">Nothing matches</li>}>
            {(command, i) => (
              <li class={() => (i() === $read(active) ? 'on' : '')} onPointerMove={() => $write(active, i())} onClick={() => run(command())}>
                <span>{command().label}</span>
                <small>{command().hint}</small>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}
