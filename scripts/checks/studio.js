async () => {
  const out = [];
  const stage = await wait(() => document.querySelector('article[data-demo="studio"] .stage'));
  const canvas = await wait(() => stage.querySelector('[data-ren-root="studio-canvas"] canvas'));
  await wait(() => canvas.width > 0);
  // The inspector's field of a label, and the layer rows.
  const field = label => [...document.querySelectorAll('.app-studio .inspector label.num')].find(l => l.querySelector('span').textContent === label)?.querySelector('input');
  const row = id => document.querySelector('.app-studio .layers li[data-id="' + id + '"]');
  // A document point on the screen, from the view the stage publishes, read
  // at the moment of each event (selecting a layer may scroll the page).
  const at = (x, y) => {
    const [zoom, left, top] = stage.dataset.camera.split(' ').map(Number);
    const box = canvas.getBoundingClientRect();
    return [box.left + x * zoom + left, box.top + y * zoom + top];
  };
  const fire = (type, [clientX, clientY], extra = {}) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, ...extra }));
  const key = (key, extra = {}) => canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
  // Select the tallest bar with a real press on the canvas: the layers and inspector follow.
  // In view first, as a user sees it: focusing a canvas scrolls it into view,
  // which would move the page between a press and its release.
  canvas.scrollIntoView({ block: 'center' });
  await wait(() => row('bar-5'));
  row('bar-5').click();
  // The inspector follows the selection once the change has flushed.
  await wait(() => row('bar-5').classList.contains('on') && field('X') && field('X').value !== '');
  const x0 = Number(field('X').value);
  const y0 = Number(field('Y').value);
  const w = Number(field('W').value);
  const h = Number(field('H').value);
  key('Escape');
  await wait(() => !row('bar-5').classList.contains('on'));
  const mx = x0 + w / 2;
  const my = y0 + h / 2;
  fire('pointerdown', at(mx, my));
  fire('pointerup', at(mx, my));
  await wait(() => row('bar-5').classList.contains('on') && field('X')?.value === String(x0));
  out.push('pressed Bar 6 on the canvas');
  // The corner handle shows its resize cursor on the canvas (the style's cursor, shown by ren-canv).
  fire('pointermove', at(x0 + w, y0 + h), { buttons: 0 });
  await wait(() => canvas.style.cursor === 'nwse-resize');
  fire('pointermove', at(mx, my), { buttons: 0 });
  out.push('handle cursor ' + 'nwse-resize');
  // Drag it 60 pixels right and 30 down: the inspector follows as it moves.
  const start = at(mx, my);
  fire('pointerdown', start);
  for (let i = 1; i <= 6; i++) fire('pointermove', [start[0] + i * 10, start[1] + i * 5]);
  fire('pointerup', [start[0] + 60, start[1] + 30]);
  const [zoom] = stage.dataset.camera.split(' ').map(Number);
  await wait(() => Math.abs(Number(field('X').value) - (x0 + 60 / zoom)) < 10);
  out.push('dragged to x ' + field('X').value + ', y ' + field('Y').value);
  // Undo from the keyboard puts it back.
  key('z', { ctrlKey: true });
  await wait(() => field('X').value === String(x0));
  // Type in the inspector: the status bar (and the canvas and model) follow the store.
  const input = field('Y');
  input.value = String(y0 - 20);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => document.querySelector('.app-studio .status').textContent.includes('Bar 6 selected') && field('Y').value === String(y0 - 20));
  key('z', { ctrlKey: true });
  await wait(() => field('Y').value === String(y0));
  // A marquee over the bars selects the six.
  key('Escape');
  fire('pointerdown', at(40, 395));
  for (let i = 1; i <= 5; i++) fire('pointermove', at(40 + i * 90, 395 - i * 20));
  fire('pointerup', at(490, 295));
  await wait(() => document.querySelectorAll('.app-studio .layers li.on').length === 6);
  out.push('marquee selected ' + document.querySelectorAll('.app-studio .layers li.on').length);
  key('Escape');
  // Zoom at the pointer with Ctrl and the wheel.
  const before = stage.dataset.camera;
  canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: at(mx, my)[0], clientY: at(mx, my)[1], deltaY: -120, ctrlKey: true }));
  await wait(() => stage.dataset.camera !== before);
  await press('Fit');
  // The 3D preview: a WebGL canvas in the three.js root.
  const scene = await wait(() => document.querySelector('.app-studio [data-ren-root="studio-preview"] canvas'));
  const gl = scene.getContext('webgl2') ?? scene.getContext('webgl');
  if (!gl) throw new Error('no WebGL context on the 3D preview');
  out.push('3D preview on ' + gl.getParameter(gl.VERSION));
  // The exports: HTML from ren-html, then data from ren-json.
  const code = () => document.querySelector('.app-studio .export pre.code')?.textContent ?? '';
  await wait(() => code().includes('data-shape="rect"'));
  const html = code().length;
  await press('Data · ren-json');
  await wait(() => code().startsWith('[') && code().includes('"Weekly revenue"'));
  out.push('export: HTML ' + html + ' chars, JSON ' + code().length + ' chars');
  await press('HTML · ren-html');
  // The layout worker: a new canvas, laid out there and painted.
  const layout = button('Layout worker');
  if (layout) {
    const old = canvas;
    await press('Layout worker');
    const moved = await wait(() => { const c = stage.querySelector('[data-ren-root="studio-canvas"] canvas'); return c && c !== old && c.width > 0 && c; });
    if (!document.querySelector('.app-studio .status').textContent.includes('layout in a worker')) throw new Error('the status does not show the worker');
    await press('This thread');
    await wait(() => { const c = stage.querySelector('[data-ren-root="studio-canvas"] canvas'); return c && c !== moved; });
    out.push('layout worker and back');
  }
  // A new theme restyles the canvas and the preview in place (setTheme): the same canvas elements stay.
  const swatches = [...document.querySelectorAll('.swatch[data-theme-id]')];
  const current = document.querySelector('.shell')?.getAttribute('data-theme');
  const other = swatches.find(s => s.getAttribute('data-theme-id') !== current);
  if (other && document.querySelector('.shell')) {
    const kept = [stage.querySelector('[data-ren-root="studio-canvas"] canvas'), document.querySelector('.app-studio [data-ren-root="studio-preview"] canvas')];
    other.click();
    await wait(() => document.querySelector('.shell').getAttribute('data-theme') === other.getAttribute('data-theme-id'));
    // timer: feature, two frames are the window a remade canvas would show in (nothing signals what does not happen).
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (stage.querySelector('[data-ren-root="studio-canvas"] canvas') !== kept[0] || document.querySelector('.app-studio [data-ren-root="studio-preview"] canvas') !== kept[1]) throw new Error('a theme change made the canvases again');
    swatches.find(s => s.getAttribute('data-theme-id') === current)?.click();
    out.push('theme restyled in place');
  }
  return out.join(', ');
}
