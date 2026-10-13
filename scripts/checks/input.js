async () => {
  // One notes board on the DOM, Skia and three.js: root-wide keys, the
  // composer focused by "/", the pinned note followed through real scrolls
  // (its moves and the root's scrolls) and its size through a real resize.
  const host = id => document.querySelector('[data-ren-root="board-' + id + '"]');
  await wait(() => ['dom', 'skia', 'three'].every(id => host(id)) && host('skia').querySelector('canvas') && host('three').querySelector('canvas'));
  const dom = host('dom');
  await wait(() => dom.textContent.includes('On dom:') && host('skia').textContent.includes('On skia:') && host('three').textContent.includes('On three:'));
  const out = [];
  // The DOM: keys with nothing focused reach the board's root.
  document.activeElement?.blur?.();
  const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key(document.body, 'n');
  await wait(() => dom.textContent.includes('Note 14') && dom.textContent.includes('key n'));
  key(document.body, '/');
  await wait(() => document.activeElement === dom.querySelector('input'));
  out.push('dom: N added a note, / focused the composer');
  // A real scroll of the list: the marker follows the pinned note.
  const list = dom.querySelector('[data-ren="Scroll"]');
  const where = () => dom.querySelector('[data-where]').textContent;
  if (!where().includes('below')) throw new Error('the pinned note starts ' + where());
  list.scrollTop = 120;
  await wait(() => where().includes('in view'));
  list.scrollTop = list.scrollHeight;
  await wait(() => where().includes('above'));
  out.push('dom: ' + dom.querySelector('[data-heard]').textContent);
  // Its size, through a real ResizeObserver.
  const pin = () => dom.querySelector('[data-heard]').textContent.split(' · ')[2];
  const before = pin();
  [...dom.querySelectorAll('button')].find(b => b.textContent === 'Lengthen the pin').click();
  await wait(() => pin() !== before && pin() !== 'pin -');
  out.push('dom ' + pin());
  // Skia: its canvas routes the root's keys, and the wheel scrolls its list.
  const skia = host('skia');
  const canvas = skia.querySelector('canvas');
  canvas.focus();
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));
  await wait(() => skia.textContent.includes('Note 14') && skia.textContent.includes('key n'));
  const box = canvas.getBoundingClientRect();
  const wheel = dy => canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: box.left + 100, clientY: box.top + 120, deltaY: dy }));
  wheel(100);
  await wait(() => skia.textContent.includes('The pinned note is in view'));
  wheel(400);
  await wait(() => skia.textContent.includes('The pinned note is above'));
  out.push('skia: N added a note, the marker followed the wheel');
  return out.join(' | ');
}
