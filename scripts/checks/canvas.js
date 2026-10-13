async () => {
  // Blueprint, a renderer of ren-show's own on ren-canv: the work order
  // drawn on a 2D canvas, laid out by the Stack engine in its worker; a
  // real click on its button (routed by attach) adds a step.
  const value = label => [...document.querySelectorAll('.value')].find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;
  const canvas = await wait(() => document.querySelector('canvas.blueprint'));
  const commands = () => document.querySelector('[data-commands]').textContent.split('\n').filter(Boolean).map(line => JSON.parse(line));
  const text = s => commands().find(c => c[0] === 'text' && c[1] === s);
  await wait(() => Number(value('frames drawn')) >= 1 && text('Add a step'));
  // Drawn: the canvas holds more than its ground.
  const ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Set();
  for (let i = 0; i < pixels.length; i += 4 * 97) colors.add(pixels[i] + ',' + pixels[i + 1] + ',' + pixels[i + 2]);
  if (colors.size < 3) throw new Error('the blueprint is blank');
  const add = text('Add a step');
  const box = canvas.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, clientX: box.left + add[2] + 4, clientY: box.top + add[3] - 4, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 }));
  canvas.dispatchEvent(new PointerEvent('pointerup', at));
  await wait(() => text('Step 3') && text('3 steps'));
  return value('frames drawn') + ' frames, ' + commands().length + ' commands, ' + colors.size + ' sampled colors; a click added step 3';
}
