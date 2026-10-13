async () => {
  const out = [];
  const app = await wait(() => document.querySelector('article[data-demo="showroom"] .app-showroom'));
  let canvas = await wait(() => app.querySelector('[data-ren-root="showroom-scene"] canvas'));
  await wait(() => canvas.width > 0);
  // In view first, as a shopper sees it: a press focuses the canvas, and focusing scrolls it into view.
  canvas.scrollIntoView({ block: 'center' });
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) throw new Error('no WebGL context on the showroom canvas');
  out.push(gl.getParameter(gl.VERSION));
  const controls = JSON.parse(app.dataset.controls);
  const spots = () => JSON.parse(app.dataset.spots || '{}');
  const config = () => app.querySelector('.strip .config').textContent;
  // A canvas point (its CSS pixels: the full 1000 by 640, or a tablet's page-wide canvas) on the screen, read at each event.
  const client = ([x, y]) => {
    const box = canvas.getBoundingClientRect();
    return [box.left + x, box.top + y];
  };
  const fire = (type, at, extra = {}) => {
    const [clientX, clientY] = client(at);
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, detail: 1, ...extra }));
  };
  const click = at => {
    fire('pointerdown', at);
    fire('pointerup', at);
    const [clientX, clientY] = client(at);
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX, clientY, button: 0, detail: 1 }));
  };
  // Waits until the scene reports its camera and parts still where the last
  // action takes them (`moved`: it applies input in its next frame, so a
  // report from before the action says nothing of it).
  const settled = (moved = () => true) => wait(() => app.dataset.still === 'true' && app.dataset.spots !== '{}' && moved(spots()) && spots());
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Frames per second while the turntable turns: between two of the scene's reports (every 30 frames).
  const report = async after => {
    await wait(() => app.dataset.frames !== after);
    return [Number(app.dataset.frames), performance.now()];
  };
  const [f1, t1] = await report(app.dataset.frames);
  const [f2, t2] = await report(String(f1));
  out.push((((f2 - f1) * 1000) / (t2 - t1)).toFixed(0) + ' frames/s turning');
  // Pause the turntable (an Action in the overlay; turning, it reports itself moving), then orbit with a real drag.
  click(controls.rotate);
  const before = await settled();
  const from = [620, 430];
  fire('pointerdown', from);
  // Left and down: the camera swings round and rises.
  for (let i = 1; i <= 8; i++) fire('pointermove', [from[0] - i * 15, from[1] + i * 5]);
  fire('pointerup', [from[0] - 120, from[1] + 40]);
  // The whole report: any one hotspot (the crown) is behind the product for part of the turntable's turn, where it reports null before and after.
  const after = await settled(s => !same(s, before)).catch(() => spots());
  if (same(after, before)) throw new Error('the drag did not orbit: the hotspots stayed at ' + JSON.stringify(before));
  const moved = Object.keys(after).find(k => !same(after[k], before[k]));
  out.push('orbit moved the ' + moved + ' from ' + before[moved] + ' to ' + after[moved]);
  // Pick a hotspot in view (the page gets null for one behind the product) and clear of the overlay's parts and the side panels (as the scene reports them): hover it, click it; the camera flies there and its card opens.
  const boxes = JSON.parse(app.dataset.boxes);
  const [, , cw, ch] = boxes.canvas;
  const clear = p => p && p[0] > 20 && p[0] < cw - 20 && p[1] > 20 && p[1] < ch - 20 && ['head', 'corner', 'bar', 'spec', 'engrave'].every(n => !boxes[n] || p[0] < boxes[n][0] - 8 || p[0] > boxes[n][0] + boxes[n][2] + 8 || p[1] < boxes[n][1] - 8 || p[1] > boxes[n][1] + boxes[n][3] + 8);
  // Where the turn left every hotspot behind the product or under a panel, orbit on (a few drags at most) until one shows.
  let seen = after;
  let id = ['crown', 'shell', 'band', 'cushion'].find(k => clear(seen[k]));
  for (let turn = 0; turn < 4 && !id; turn++) {
    const last = spots();
    fire('pointerdown', from);
    for (let i = 1; i <= 8; i++) fire('pointermove', [from[0] - i * 15, from[1]]);
    fire('pointerup', [from[0] - 120, from[1]]);
    seen = await settled(s => !same(s, last)).catch(() => spots());
    id = ['crown', 'shell', 'band', 'cushion'].find(k => clear(seen[k]));
  }
  if (!id) throw new Error('no hotspot in the clear: ' + app.dataset.spots);
  fire('pointermove', seen[id], { buttons: 0 });
  click(seen[id]);
  await wait(() => app.dataset.open === id);
  const flown = await settled(s => !same(s[id], seen[id]));
  out.push('hotspot ' + id + ' opened, camera flew (' + seen[id] + ' to ' + flown[id] + ')');
  // Reset view closes it and flies home.
  click(controls.reset);
  await wait(() => app.dataset.open === '');
  // Options in the overlay: a finish, the steel band, the exploded view, the bag.
  click(controls['finish:glacier']);
  await wait(() => config().startsWith('Glacier'));
  click(controls['band:steel']);
  await wait(() => config().includes('Stainless steel') && config().includes('$508'));
  // The exploded view pulls the parts apart (the scene reports it moving, then still), then assembles.
  click(controls.explode);
  await wait(() => app.dataset.still === 'false');
  await wait(() => app.dataset.still === 'true');
  const exploded = spots();
  click(controls.explode);
  click(controls.bag);
  await wait(() => app.dataset.bag === '1');
  out.push('configured: ' + config());
  // Engrave: press the Edit on its 3D panel, then type into the native entry that takes the focus.
  click(controls.reset);
  // Home once assembled: the parts away from where the exploded view held them.
  const home = await settled(s => !same(s, exploded));
  click(home.engrave);
  const entry = await wait(() => (document.activeElement?.matches('textarea[data-ren-entry]') ? document.activeElement : null));
  entry.value = 'ren-three';
  entry.setSelectionRange(9, 9);
  entry.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'ren-three' }));
  await wait(() => config().includes('“ren-three”'));
  out.push('engraved through the panel');
  // The scene application in a worker: three.js stays here; the state carries over.
  if (button('Run in a worker')) {
    await press('Run in a worker');
    canvas = await wait(() => app.querySelector('[data-ren-root="showroom-worker"] canvas'));
    await wait(() => Number(app.dataset.frames) >= 30);
    click(controls['finish:rose']);
    await wait(() => config().startsWith('Rose') && config().includes('“ren-three”'));
    out.push('worker: ' + app.querySelector('.strip .fps').textContent + ', configured there');
    await press('Run on this thread');
    await wait(() => app.querySelector('[data-ren-root="showroom-scene"] canvas'));
  }
  return out.join(', ');
}
