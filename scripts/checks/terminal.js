async () => {
  const out = [];
  const app = await wait(() => document.querySelector('article[data-demo="terminal"] .app-terminal'));
  const skiaCanvas = id => app.querySelector('[data-ren-root="' + id + '"] canvas');
  const canvas = await wait(() => skiaCanvas('terminal-skia'));
  await wait(() => canvas.width > 0);
  // In view first, as a user sees it: focusing a canvas scrolls it into view.
  canvas.scrollIntoView({ block: 'center' });
  // timer: feature, a drag and a sweep move the pointer once a frame, as a hand does, and the sweep's frames are what it measures.
  const frame = () => new Promise(r => requestAnimationFrame(r));
  // The desk's geometry (src/apps/terminal/view.jsx): the plot starts right of
  // the watchlist and the drawing strip, under the toolbar and the readout.
  const PLOT = { x: 190 + 38, y: 36 + 1 + 26, w: 960 - 190 - 226 - 38 - 64 };
  const view = () => app.dataset.view.split(' ').map(Number);
  const cursor = () => app.dataset.cursor.split(' ');
  // A point of a canvas's plot, in client coordinates, read at each event (the page may scroll).
  const at = (c, origin, x, y) => {
    const box = c.getBoundingClientRect();
    return [box.left + origin.x + x, box.top + origin.y + y];
  };
  const fire = (c, type, [clientX, clientY], extra = {}) =>
    c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0, buttons: type === 'pointerup' || type === 'pointermove' ? 0 : 1, pointerId: 1, isPrimary: true, ...extra }));
  const wheel = (c, [clientX, clientY], extra) => c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX, clientY, ...extra }));
  const key = (c, k) => c.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const p = (x, y) => at(canvas, PLOT, x, y);

  // Hover: the crosshair follows the pointer, in the plot's pixels.
  fire(canvas, 'pointermove', p(200, 120));
  await wait(() => cursor()[0] === 'main' && Math.abs(Number(cursor()[1]) - 200) <= 1 && Math.abs(Number(cursor()[2]) - 120) <= 1);
  out.push('crosshair at ' + app.dataset.cursor);

  // Drag left 150 px: later candles come into view.
  const [end0, count0] = view();
  fire(canvas, 'pointerdown', p(300, 150));
  for (let i = 1; i <= 6; i++) {
    fire(canvas, 'pointermove', p(300 - i * 25, 150), { buttons: 1 });
    await frame();
  }
  fire(canvas, 'pointerup', p(150, 150));
  const expected = end0 + (150 / PLOT.w) * count0;
  await wait(() => Math.abs(view()[0] - expected) < 0.05 * count0);
  out.push('panned ' + (view()[0] - end0).toFixed(1) + ' candles');

  // The wheel zooms in around the pointer; a pinch (Ctrl) zooms out a little.
  wheel(canvas, p(220, 150), { deltaY: -300 });
  await wait(() => view()[1] < count0 * 0.8);
  const zoomed = view()[1];
  wheel(canvas, p(220, 150), { deltaY: 20, ctrlKey: true });
  await wait(() => view()[1] > zoomed);
  out.push('zoom ' + count0.toFixed(0) + ' → ' + zoomed.toFixed(0) + ' → ' + view()[1].toFixed(0) + ' candles');

  // Keys on the canvas: Bollinger bands on; a trend line drawn with the tool.
  key(canvas, 'b');
  await wait(() => app.dataset.studies.split(' ').includes('bb'));
  key(canvas, 't');
  await wait(() => app.dataset.tool === 'trend');
  fire(canvas, 'pointerdown', p(80, 80));
  for (let i = 1; i <= 4; i++) {
    fire(canvas, 'pointermove', p(80 + i * 40, 80 + i * 20), { buttons: 1 });
    await frame();
  }
  fire(canvas, 'pointerup', p(240, 160));
  await wait(() => app.dataset.drawings === '1');
  out.push('studies ' + app.dataset.studies + ', drawings ' + app.dataset.drawings);

  // Text on the canvas selects: a triple press on the readout, then copy.
  // Off the plot, over the watchlist: the plot hears its pointerleave and the crosshair goes.
  fire(canvas, 'pointermove', at(canvas, { x: 0, y: 0 }, 40, 300));
  await wait(() => app.dataset.cursor === '');
  // Three presses as Chrome sends them (a pointerdown's detail is 0): the canvas counts the run by their times.
  const readout = at(canvas, { x: PLOT.x + 90, y: 36 + 1 + 13 }, 0, 0);
  for (let i = 0; i < 3; i++) {
    fire(canvas, 'pointerdown', readout);
    fire(canvas, 'pointerup', readout);
  }
  await press('Copy selection');
  const copied = await wait(() => app.querySelector('.term-copy .copied').textContent.startsWith('O ') && app.querySelector('.term-copy .copied').textContent);
  out.push('copied "' + copied.slice(0, 40) + '…"');
  key(canvas, 'Delete');
  key(canvas, 'End');

  // Stream at 60 Hz while the pointer sweeps the plot, and read the measurements.
  const sweep = async (c, origin, width, ms) => {
    const end = performance.now() + ms;
    for (let i = 0; performance.now() < end; i++) {
      fire(c, 'pointermove', at(c, origin, 20 + ((i * 7) % (width - 40)), 60 + ((i * 3) % 120)));
      await frame();
    }
  };
  const stats = () => JSON.parse(app.dataset.stats || 'null');
  const measure = async (c, origin, width, label) => {
    await wait(() => stats() !== null && stats().mode === app.dataset.mode);
    await sweep(c, origin, width, 3000);
    const s = await wait(() => stats());
    const cost = k => s[k].frames === 0 ? '-' : s[k].frames + ' frames ' + s[k].p50.toFixed(2) + '/' + s[k].p95.toFixed(2) + '/' + s[k].max.toFixed(1) + ' ms p50/p95/max';
    const repaint = s.skia.frames === 0 ? '' : ' (repaint ' + s.skia.damage + ' damage, ' + s.skia.full + ' full, ' + s.skia.none + ' none)';
    out.push(label + (s.raster ? ' (' + s.raster + ')' : '') + ': ' + s.page.fps.toFixed(1) + ' fps, page p95 ' + s.page.p95.toFixed(1) + ' ms, late ' + s.page.late + '/' + s.page.frames + ', feed ' + s.hz.toFixed(0) + ' Hz; skia ' + cost('skia') + repaint + '; dom ' + cost('dom'));
    return s;
  };
  await press('60 Hz');
  const skia = await measure(canvas, PLOT, PLOT.w, 'Skia desk');
  if (skia.skia.frames === 0) throw new Error('no Skia frames were measured');
  // The same desk rasterized by CanvasKit in software instead of WebGL.
  const before = skiaCanvas('terminal-skia');
  await press('Software');
  const soft = await wait(() => skiaCanvas('terminal-skia') !== before && skiaCanvas('terminal-skia'));
  await wait(() => soft.width > 0 && stats()?.raster === 'software');
  const software = await measure(soft, PLOT, PLOT.w, 'Skia desk');
  if (software.skia.frames === 0) throw new Error('no Skia frames were measured in software');
  await press('WebGL');

  // The chart on ren-dom and ren-skia side by side, from the same frames.
  await press('DOM vs Skia');
  const pane = await wait(() => skiaCanvas('terminal-chart-skia'));
  await wait(() => pane.width > 0 && app.querySelector('[data-ren-root="terminal-chart-dom"] [data-input="main"]'));
  pane.scrollIntoView({ block: 'center' });
  const both = await measure(pane, { x: 0, y: 26 }, 470 - 64, 'DOM vs Skia chart');
  if (both.skia.frames === 0 || both.dom.frames === 0) throw new Error('both renderers must be measured side by side');
  if (both.skia.frames !== both.dom.frames) throw new Error('the two charts took different frames: ' + both.skia.frames + ' against ' + both.dom.frames);

  // The whole desk on ren-dom.
  await press('DOM');
  const desk = await wait(() => app.querySelector('[data-ren-root="terminal-dom"] [data-terminal]'));
  const layer = await wait(() => desk.querySelector('[data-input="main"]'));
  layer.scrollIntoView({ block: 'center' });
  const dom = await measure(layer, { x: 0, y: 0 }, PLOT.w, 'DOM desk');
  if (dom.dom.frames === 0) throw new Error('no DOM frames were measured');
  await press('Skia');
  await wait(() => skiaCanvas('terminal-skia'));
  await press('30 Hz');
  return out.join(' | ');
}
