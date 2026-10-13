async () => {
  // The Code field's runs on the DOM: a mirror over the field, its text set
  // where the field sets its own (the caret and selection are the field's).
  const area = await wait(() => [...document.querySelectorAll('article[data-demo="primitives"] textarea')].find(t => t.getAttribute('aria-label') === 'Code'));
  const mirror = area.nextElementSibling;
  // Shown, holding the value, and set in the field's font (copied at its sync).
  await wait(() => mirror && mirror.getAttribute('data-ren-mirror') === '' && mirror.style.display === 'block' && mirror.textContent === area.value && getComputedStyle(mirror).fontFamily === getComputedStyle(area).fontFamily && getComputedStyle(mirror).fontSize === getComputedStyle(area).fontSize);
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  const field = area.getBoundingClientRect();
  const box = mirror.getBoundingClientRect();
  for (const k of ['left', 'top', 'width', 'height']) if (!near(field[k], box[k])) throw new Error('the mirror ' + k + ' ' + box[k] + ' is not the field\'s ' + field[k]);
  if (getComputedStyle(area).webkitTextFillColor !== 'rgba(0, 0, 0, 0)') throw new Error('the field\'s own text is not transparent');
  // The range of the mirror's text from `from` to `to` (offsets in the value).
  const range = (from, to) => {
    const r = document.createRange();
    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
    let at = 0;
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const end = at + n.data.length;
      if (from >= at && from <= end) r.setStart(n, from - at);
      if (to >= at && to <= end) { r.setEnd(n, to - at); break; }
      at = end;
    }
    return r.getBoundingClientRect();
  };
  const cs = getComputedStyle(area);
  const left = field.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const top = field.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const line = parseFloat(cs.lineHeight);
  // Each row as wide as the field's plain text in its own font, from its content origin, a line apart.
  // Its font from the longhands: the `font` shorthand is empty where kerning or ligatures are off (the canvases' fonts).
  const font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  await wait(() => document.fonts.check(font));
  const context = document.createElement('canvas').getContext('2d');
  context.font = font;
  context.fontKerning = cs.fontKerning === 'none' ? 'none' : 'auto';
  const rows = area.value.split('\n');
  let start = 0;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = range(start, start + rows[i].length);
    const plain = context.measureText(rows[i]).width;
    if (!near(r.left, left) || Math.abs(r.width - plain) > 1) throw new Error('row ' + i + ' at ' + r.left + ', ' + r.width + ' wide; the field sets it at ' + left + ', ' + plain + ' wide');
    const middle = top + line * i + line / 2;
    if (Math.abs((r.top + r.bottom) / 2 - middle) > 1.5) throw new Error('row ' + i + ' is centered at ' + (r.top + r.bottom) / 2 + ', the field\'s line at ' + middle);
    out.push(rows[i].length);
    start += rows[i].length + 1;
  }
  // Typing: the view answers with new runs; a long value scrolls, and the mirror with it.
  const type = value => { area.value = value; area.dispatchEvent(new Event('input', { bubbles: true })); };
  type(Array.from({ length: 12 }, (_, i) => 'let n' + i + ' = ' + i).join('\n'));
  await wait(() => mirror.style.display === 'block' && mirror.textContent === area.value);
  area.scrollTop = area.scrollHeight;
  await wait(() => area.scrollTop > 0 && mirror.firstChild.style.transform === 'translate(0px, ' + -area.scrollTop + 'px)');
  const last = range(area.value.lastIndexOf('\n') + 1, area.value.length);
  const bottom = field.top + parseFloat(cs.borderTopWidth) + area.clientHeight - parseFloat(cs.paddingBottom);
  if (Math.abs(last.bottom - bottom) > line) throw new Error('scrolled, the last row ends at ' + last.bottom + ', the field\'s content at ' + bottom);
  return 'Code field: mirror on the field, ' + out.length + ' rows aligned, scrolled with it';
}
