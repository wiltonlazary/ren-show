// Pulse: the telemetry engine alone, then the dashboard opened on happy-dom
// in both modes: its application served over a MessageChannel with the real
// `serve` (worker mode) and in a root on the page (main thread), both ticking
// on one manual clock that the tests advance.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Root } from 'ren-core';
import { serve } from 'ren-core/worker';
import { open, clock, after } from './page.jsx';
import pulse, { THRESHOLDS } from '../src/apps/pulse/index.jsx';
import { Pulse, SEED, HOLD } from '../src/apps/pulse/dashboard.jsx';
import { Engine, Ring, REGIONS, CAPACITY, BUCKETS, RANGES, EPOCH, INCIDENT, ALL } from '../src/apps/pulse/engine.js';
import { WINDOW } from '../src/apps/pulse/logs.jsx';
import { argb, nice, sparkline, latency } from '../src/apps/pulse/charts.js';

/**
 * Re-checks `check` until it holds or `ms` pass; returns whether it held.
 * The page runs workers, WebAssembly and frames that report no single event.
 * @param {() => boolean} check
 */
const until = async (check, ms = 3000) => {
  // timer: poll, a bounded re-check of the page's state
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 2))) if (check()) return true;
  return check();
};

describe('pulse engine', () => {
  it('is deterministic: one seed, one history; the history stays put as time moves', () => {
    const a = new Engine(SEED);
    const b = new Engine(SEED);
    for (let i = 0; i < 90; i++) {
      a.advance(33);
      b.advance(33);
    }
    assert.deepEqual([a.live.rps, a.live.p99, a.live.errors], [b.live.rps, b.live.p99, b.live.errors]);
    assert.deepEqual(a.spark('cpu'), b.spark('cpu'));
    const s = a.series(RANGES['1h']);
    assert.equal(s.time.length, BUCKETS);
    assert.ok(s.p50.every((v, i) => v > 0 && v < s.p95[i] && s.p95[i] < s.p99[i]), 'p50 < p95 < p99 in every bucket');
    // A minute later, the buckets that remain show the same values.
    a.advance(60_000);
    const later = a.series(RANGES['1h']);
    assert.equal(later.time[BUCKETS - 3], s.time[BUCKETS - 2]);
    assert.equal(later.p99[BUCKETS - 3], s.p99[BUCKETS - 2]);
    const other = new Engine(SEED + 1);
    other.advance(33);
    assert.notEqual(other.live.rps, a.live.rps);
  });

  it('spikes one region in an incident, then recovers', () => {
    const e = new Engine(SEED);
    e.advance(1000);
    const calm = e.regions.map(r => r.errors);
    assert.ok(calm.every(x => x < 0.01), 'under 1% errors normally');
    const region = e.incident(2);
    assert.equal(region, 2);
    for (let i = 0; i < 300; i++) e.advance(50); // 15 s
    assert.equal(e.burning, 2);
    assert.ok(e.regions[2].errors > 0.1, `the region burns: ${e.regions[2].errors}`);
    assert.ok(e.regions[0].errors < 0.01, 'the others do not');
    assert.ok(e.live.errors > 0.02 && e.live.p99 > 600);
    for (let i = 0; i < 100; i++) e.advance(500); // 50 s
    assert.equal(e.burning, -1);
    assert.ok(e.regions[2].errors < 0.01, 'recovered');
    assert.equal(e.incident(), 3, 'the next incident moves to the next region');
  });

  it('keeps 10,000 log lines in a ring and finds them by level and text', () => {
    const ring = new Ring();
    for (let i = 0; i < CAPACITY + 2500; i++) ring.push(EPOCH + i, i % 4, i % REGIONS.length, i % 8, `line ${i}`);
    assert.equal(ring.size, CAPACITY);
    assert.equal(ring.first, 2500);
    assert.deepEqual(ring.find(ring.total - 1, 3, ALL, ''), [12499, 12498, 12497]);
    assert.deepEqual(ring.find(ring.total - 1, 2, 1 << 3, ''), [12499, 12495], 'errors only');
    assert.deepEqual(ring.find(ring.total - 1, 5, ALL, 'line 250'), [2509, 2508, 2507, 2506, 2505], 'text, lowercase, within the ring only');
    assert.equal(ring.count(ring.total - 1, ALL, 'line 2499'), 0, 'overwritten lines are gone');
    assert.equal(ring.count(ring.total - 1, 1 << 0, ''), CAPACITY / 4);
    // The engine fills it with lines of every level at about 45 a second.
    const e = new Engine(SEED);
    for (let i = 0; i < 600; i++) e.advance(100);
    assert.ok(e.logs.total > 1000 && e.logs.total < 4000, `${e.logs.total} lines in a minute`);
    assert.ok([...e.logs.counts].every(n => n > 0), 'every level');
    // A deploy rolls out every 11 minutes or so, logged as it lands.
    const [next] = e.deploys(e.t + 600_000, e.t + 1_800_000);
    while (e.t < next.at + 5000) e.advance(1000);
    assert.equal(e.logs.size, CAPACITY, 'the ring is full');
    assert.ok(e.logs.text.includes(`deploy ${next.service} ${next.version} rolled out (6/6 hosts healthy)`), 'the deploy is logged');
  });

  it('draws charts as shapes in the palette', () => {
    assert.equal(argb('#4f46e5'), 0xff4f46e5);
    assert.equal(argb('#abc', 0x80), 0x80aabbcc);
    assert.equal(nice(730), 1000);
    assert.equal(nice(180), 200);
    const spark = sparkline([1, 3, 2, 5], 0xff112233);
    assert.deepEqual(spark.map(f => f.kind), ['path', 'path', 'oval']);
    assert.equal(spark[0].closed, true);
    const e = new Engine(SEED);
    const paint = { series: [1, 2, 3, 4, 5, 6].map(n => 0xff000000 + n), accent: 0xff0000aa, danger: 0xffaa0000, muted: 0xff777777, rule: 0xffdddddd, ink: 0xff111111 };
    const plain = latency(e.series(RANGES['5m']), paint, -1, []);
    const hovered = latency(e.series(RANGES['5m']), paint, 10, [e.t - 60_000]);
    assert.ok(plain.max >= e.live.p99);
    assert.equal(hovered.figures.length - plain.figures.length, 2 + 1 + 6, 'a deploy marker, the crosshair and a dot pair per percentile');
  });
});

/** @param {ReturnType<typeof open>} page @param {string} label */
const meter = (page, label) => page.all(`[data-meter="${label}"] b`)[0]?.textContent;
/** @param {ReturnType<typeof open>} page */
const kpis = page => page.texts('.kpi b');

/**
 * Opens Pulse with a manual clock; worker mode serves the dashboard over a
 * MessageChannel on the same clock. `crossed` waits until every message
 * posted either way has been received (the page applies on arrival here).
 */
function start() {
  const c = clock();
  /** @type {any[]} */
  const sessions = [];
  /** Each worker's end: its session and both ports, closed with the page whatever the test did. @type {(() => void)[]} */
  const ends = [];
  /** Messages posted and received on each side: to the page, and to the worker. */
  const toPage = { posted: 0, received: 0 };
  const toWorker = { posted: 0, received: 0 };
  /** Counts what `port` posts into `out` and what it receives into `in_`. @param {MessagePort} port @param {typeof toPage} out @param {typeof toPage} in_ */
  const count = (port, out, in_) => {
    const post = port.postMessage.bind(port);
    port.postMessage = (/** @type {any[]} */ ...args) => (out.posted++, post(...args));
    port.addEventListener('message', () => void in_.received++);
  };
  const worker = (/** @type {string} */ id) => {
    const { port1, port2 } = new MessageChannel();
    count(port1, toPage, toWorker);
    const session = serve(() => <Pulse later={c.later} now={c.now} />, { port: port1, root: Root(id) });
    sessions.push(session);
    count(port2, toWorker, toPage);
    const end = () => {
      session.close();
      port1.close();
      port2.close();
    };
    ends.push(end);
    return Object.assign(port2, { terminate: end });
  };
  const page = open(pulse.View, { worker, later: c.later, now: c.now });
  const close = () => {
    page.dispose();
    for (const end of ends) end();
  };
  /** The view messages the worker posted. */
  const sent = () => sessions.reduce((n, s) => n + s.counters.messages, 0);
  const crossed = () => until(() => toPage.received === toPage.posted && toWorker.received === toWorker.posted);
  return { c, page, sessions, close, sent, crossed };
}

describe('pulse', () => {
  it('describes itself for the shell', () => {
    assert.equal(pulse.id, 'pulse');
    assert.equal(pulse.title, 'Pulse');
    assert.ok(pulse.apis.includes('Root runtime="worker"') && pulse.apis.includes('$stream') && pulse.apis.includes('$defer'));
    assert.equal(typeof pulse.View, 'function');
  });

  it('runs the dashboard in a worker root: it streams, pauses, switches range, and reports its cost', async (/** @type {import('node:test').TestContext} */ t) => {
    const { c, page, close, sent, crossed } = start();
    after(t, () => {
      close();
    });
    const host = () => page.all('[data-ren-root="pulse-worker"]')[0];
    assert.ok(await until(() => host()?.querySelectorAll('.kpi').length === 4), 'the worker publishes the dashboard');
    assert.equal(meter(page, 'application'), 'in a worker');
    const first = kpis(page);
    const clockText = () => page.texts('.clock')[0];
    const t0 = clockText();
    c.advance(1100);
    assert.ok(await until(() => kpis(page).join() !== first.join() && clockText() !== t0), 'values move with the feed');
    assert.match(clockText(), /^13:00:01 UTC$/);
    // Charts are Shape primitives drawn as SVG, filled from the stream.
    assert.ok(await until(() => host().querySelectorAll('svg.latency path').length >= 5));
    assert.equal(host().querySelectorAll('.heat .cell').length, 24);
    assert.equal(host().querySelectorAll('.region-list .region').length, REGIONS.length);

    // Pause: the stream completes with the last frame; nothing moves.
    page.click('Pause');
    assert.ok(await until(() => page.all('button').some(b => b.textContent === 'Resume')));
    assert.ok(await crossed(), 'the last frame reached the page');
    const held = kpis(page).join();
    const heldClock = clockText();
    const before = sent();
    c.advance(2000);
    assert.equal(sent(), before, 'paused: the worker posts nothing as its clock moves');
    assert.ok(await crossed());
    assert.equal(kpis(page).join(), held, 'paused: the tiles hold');
    assert.equal(clockText(), heldClock);
    page.click('Resume');
    assert.ok(await until(() => page.all('button').some(b => b.textContent === 'Pause')));
    c.advance(500);
    assert.ok(await until(() => kpis(page).join() !== held), 'resumed');

    // Ranges: the axis follows, the choice is pressed and kept in Storage.
    const axis = () => page.texts('.chart .axis.x span').slice(0, 5).join(' ');
    const short = axis();
    page.click('1 h');
    assert.ok(await until(() => page.button('1 h').getAttribute('aria-pressed') === 'true'));
    assert.ok(await until(() => axis() !== short));
    assert.match(axis(), /^\d\d:\d\d \d\d:\d\d/, 'minutes, no seconds, over an hour');
    assert.equal(page.window.localStorage.getItem('ren:pulse-worker:range'), '1h');
    page.click('24 h');
    assert.ok(await until(() => page.button('24 h').getAttribute('aria-pressed') === 'true'));

    // A faster feed, then the measured numbers on the page.
    page.click('60 Hz');
    assert.ok(await until(() => page.button('60 Hz').getAttribute('aria-pressed') === 'true'));
    for (let i = 0; i < 4; i++) {
      c.advance(600);
      assert.ok(await crossed());
    }
    assert.ok(await until(() => Number(meter(page, 'messages applied')?.replace(/,/g, '')) > 5), `messages: ${meter(page, 'messages applied')}`);
    assert.match(meter(page, 'records') ?? '', /^[\d,]+ · [\d,]+ low lane$/);
    assert.ok(Number(/** @type {string} */ (meter(page, 'records')).split(' · ')[1].replace(/[^\d]/g, '')) > 0, 'the feed crossed in the low lane');
    assert.match(meter(page, 'apply time') ?? '', /ms avg · [\d.]+ ms max$/);
    assert.ok(await until(() => /ticks\/s/.test(meter(page, 'feed') ?? '')), 'the worker reports its tick rate through Send');
    const hz = parseFloat(/** @type {string} */ (meter(page, 'feed')));
    assert.ok(hz > 50 && hz < 70, `about 60 ticks a second of its clock: ${hz}`);
    assert.match(meter(page, 'tick work') ?? '', /ms avg · [\d.]+ ms max/);
  });

  it('hovers the charts with a crosshair and a tooltip', async (/** @type {import('node:test').TestContext} */ t) => {
    const { c, page, close, sent, crossed } = start();
    after(t, () => {
      close();
    });
    const host = () => page.all('[data-ren-root="pulse-worker"]')[0];
    assert.ok(await until(() => host()?.querySelectorAll('.stage .hits i').length === BUCKETS * 2));
    c.advance(200);
    const lines = () => host().querySelectorAll('svg.latency line').length;
    const before = lines();
    const hit = host().querySelectorAll('.stage .hits i')[30];
    hit.dispatchEvent(new page.window.MouseEvent('mouseover', { bubbles: true }));
    assert.ok(await until(() => host().querySelector('.tip') !== null), 'the tooltip shows');
    assert.match(host().querySelector('.tip').textContent, /UTC.*p50 \d+ ms.*p95 \d+ ms.*p99 \d+ ms.*req\/s/);
    assert.match(host().querySelector('.tip').getAttribute('style'), new RegExp(`left: ?${((30 / (BUCKETS - 1)) * 100).toFixed(2)}%`), 'placed at the hovered bucket');
    assert.ok(await until(() => lines() === before + 1), 'the crosshair is drawn');
    // Both charts share the crosshair.
    assert.ok(host().querySelectorAll('svg.throughput ellipse').length >= 2);
    host().querySelector('.stage').dispatchEvent(new page.window.MouseEvent('mouseleave'));
    assert.ok(await until(() => host().querySelector('.tip') === null && lines() === before));
  });

  it('raises an alert across the boundary when an incident crosses the rule', async (/** @type {import('node:test').TestContext} */ t) => {
    const { c, page, close, sent, crossed } = start();
    after(t, () => {
      close();
    });
    const host = () => page.all('[data-ren-root="pulse-worker"]')[0];
    assert.ok(await until(() => host()?.querySelector('.status .rule') != null));
    assert.match(host().querySelector('.status .rule').textContent, /^OK error rate > 2%$/);
    // The rule reaches the worker as props.
    page.click('p99 latency');
    assert.equal(page.all('input[aria-label="Alert threshold"]')[0].value, String(THRESHOLDS.p99));
    assert.ok(await until(() => /p99 > 800 ms/.test(host().querySelector('.status .rule').textContent)));
    page.type(page.all('input[aria-label="Alert threshold"]')[0], '650');
    assert.ok(await until(() => /p99 > 650 ms/.test(host().querySelector('.status .rule').textContent)));
    page.click('Error rate');
    assert.ok(await until(() => /error rate > 2%/.test(host().querySelector('.status .rule').textContent)));

    page.click('Simulate incident');
    assert.ok(await crossed());
    for (let i = 0; i < 12; i++) {
      c.advance(1000);
      assert.ok(await crossed());
    }
    assert.ok(await until(() => page.all('.pulse-banner').length === 1), 'the banner shows the firing alert');
    assert.match(page.all('.pulse-banner')[0].textContent, /Alert firing.*error rate is [\d.]+%, above 2%: an incident in north-1/);
    assert.equal(page.texts('.toast b')[0], 'Alert firing');
    assert.equal(page.all('.pulse-toolbar .state')[0].textContent, 'Firing');
    assert.ok(host().querySelector('.kpi.firing'), 'the error tile is marked');
    assert.match(host().querySelector('.status .incident').textContent, /^Incident in north-1 · \d+ s left$/);
    // The incident passes; the alert resolves and says so.
    // (One second at a time until it resolves: a toast leaves 8 s after it shows.)
    for (let i = 0; i < INCIDENT / 1000 + 10 && page.all('.pulse-banner').length > 0; i++) {
      c.advance(1000);
      await until(() => false, 15);
    }
    assert.ok(await until(() => page.all('.pulse-banner').length === 0), 'resolved');
    assert.ok(await until(() => page.texts('.toast b').includes('Resolved')));
    c.advance(10_000);
    assert.ok(await until(() => page.all('.toast').length === 0), 'toasts leave on the clock');
    assert.ok(HOLD > 0);
  });

  it('tails the logs: levels, text filter, follow and pause, older lines', async (/** @type {import('node:test').TestContext} */ t) => {
    const { c, page, close, sent, crossed } = start();
    after(t, () => {
      close();
    });
    const host = () => page.all('[data-ren-root="pulse-worker"]')[0];
    assert.ok(await until(() => host()?.querySelector('.tail') != null));
    for (let i = 0; i < 6; i++) {
      c.advance(1000);
      assert.ok(await crossed());
    }
    const rows = () => [...host().querySelectorAll('.tail .line')];
    assert.ok(await until(() => rows().length > 100), `a window of lines: ${rows().length}`);
    assert.ok(rows().length <= WINDOW);
    const seqs = () => rows().map(r => Number(r.getAttribute('data-seq')));
    assert.ok(seqs().every((s, i, all) => i === 0 || s < all[i - 1]), 'newest first');
    // Only errors.
    for (const level of ['debug', 'info', 'warn']) page.click(level);
    assert.ok(await until(() => rows().length > 0 && rows().every(r => r.classList.contains('error'))));
    assert.equal(page.button('info').getAttribute('aria-pressed'), 'false');
    for (const level of ['debug', 'info', 'warn']) page.click(level);
    // Text: typed on the page, filtered in the worker.
    const filter = host().querySelector('input.filter');
    filter.value = 'south-1';
    filter.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.ok(await until(() => rows().length > 0 && rows().every(r => r.textContent.includes('south-1'))));
    assert.match(host().querySelector('.tail-meta').textContent, /shown of [\d,]+ matching/);
    filter.value = 'no such line anywhere';
    filter.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.ok(await until(() => rows().length === 0 && host().querySelector('.tail .quiet')?.textContent === 'No line matches.'));
    filter.value = '';
    filter.dispatchEvent(new page.window.Event('input', { bubbles: true }));
    assert.ok(await until(() => rows().length > 100));
    // Pause the tail: the window holds while new lines count up.
    page.click('Pause tail');
    assert.ok(await until(() => page.all('button').some(b => b.textContent === 'Follow tail')));
    const top = seqs()[0];
    c.advance(2000);
    assert.ok(await until(() => /\d+ newer lines/.test(host().querySelector('.tail-meta .fresh').textContent) && !/^0 /.test(host().querySelector('.tail-meta .fresh').textContent)));
    assert.equal(seqs()[0], top, 'paused: the newest shown stays');
    page.click('Older lines');
    assert.ok(await until(() => seqs()[0] < top - 100), 'a page back');
    page.click('Follow tail');
    assert.ok(await until(() => seqs()[0] > top), 'following again');
  });

  it('sorts the host heatmap by CPU, moving the keyed cells', async (/** @type {import('node:test').TestContext} */ t) => {
    const { c, page, close, sent, crossed } = start();
    after(t, () => {
      close();
    });
    const host = () => page.all('[data-ren-root="pulse-worker"]')[0];
    assert.ok(await until(() => host()?.querySelectorAll('.heat .cell').length === 24));
    c.advance(300);
    const cells = () => [...host().querySelectorAll('.heat .cell')];
    const byName = cells();
    page.click('by CPU');
    const cpu = () => cells().map(cell => Number(cell.querySelector('b').textContent.replace('%', '')));
    assert.ok(await until(() => cpu().every((v, i, all) => i === 0 || v <= all[i - 1] + 1)), `sorted: ${cpu()}`);
    assert.equal(new Set(cells()).size, 24);
    assert.ok(cells().every(cell => byName.includes(cell)), 'the same cells, moved');
    assert.match(cells()[0].getAttribute('style') ?? '', /--heat: ?\d+/);
  });

  it('runs the same dashboard on the main thread, with the same data', async (/** @type {import('node:test').TestContext} */ t) => {
    const { c, page, sessions, close } = start();
    after(t, () => {
      close();
    });
    assert.ok(await until(() => page.all('[data-ren-root="pulse-worker"] .kpi').length === 4));
    c.advance(1000);
    c.advance(100);
    await until(() => page.texts('.clock')[0] === '13:00:01 UTC');
    page.click('On the main thread');
    assert.equal(page.all('[data-ren-root="pulse-worker"]').length, 0, 'the worker root is gone');
    assert.equal(sessions.length, 1);
    const host = () => page.all('[data-ren-root="pulse-main"]')[0];
    assert.equal(host().querySelectorAll('.kpi').length, 4, 'direct: built at once');
    assert.equal(meter(page, 'application'), 'on the main thread');
    assert.equal(meter(page, 'messages applied'), 'none: direct');
    const first = kpis(page).join();
    c.advance(1100);
    assert.notEqual(kpis(page).join(), first, 'direct: it moves synchronously with the clock');
    assert.equal(page.texts('.clock')[0], '13:00:01 UTC', 'a new engine: the same seed from the start');
    page.click('Simulate incident');
    c.advance(8000);
    assert.equal(page.all('.pulse-banner').length, 1, 'alerts reach the page through Send in this mode too');
    c.advance(1000);
    assert.match(meter(page, 'feed') ?? '', /ticks\/s/);
    // And back into a worker.
    page.click('In a worker');
    assert.ok(await until(() => page.all('[data-ren-root="pulse-worker"] .kpi').length === 4));
    assert.equal(sessions.length, 2);
    assert.equal(page.all('.pulse-banner').length, 0, 'a fresh application: no alert yet');
  });

  it('runs on the main thread when the environment has no worker', () => {
    const c = clock();
    const page = open(pulse.View, { worker: null, later: c.later, now: c.now });
    try {
      assert.equal(page.all('[data-ren-root="pulse-main"]').length, 1);
      assert.equal(page.button('In a worker').disabled, true);
      c.advance(500);
      assert.equal(page.texts('.clock')[0], '13:00:00 UTC');
      c.advance(700);
      assert.equal(page.texts('.clock')[0], '13:00:01 UTC');
    } finally {
      page.dispose();
    }
  });
});
