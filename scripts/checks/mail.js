async () => {
  // Mail on every renderer: on each, a real press opens a message, the keyboard
  // moves and opens the next, a triple press (or the page's selection on the
  // DOM) selects the subject, and compose takes typed text and sends. Then the
  // parity script runs on all of them and must match the DOM's text.
  const article = document.querySelector('article[data-demo="mail"]');
  const stage = () => article.querySelector('.mail-stage');
  // The client's geometry (mail.jsx): top bar 56, list head 44, sidebar 212, list 380, rows 75.
  const row = i => [212 + 1 + 190, 56 + 1 + 44 + 1 + i * 75 + 37];
  const SUBJECT = [212 + 1 + 380 + 1 + 40, 56 + 1 + 22 + 12];
  const TO = [212 + 1 + 380 + 1 + 120, 56 + 1 + 22 + 28 + 12 + 19];
  const selectedText = () => article.querySelector('.mail-selection').getAttribute('data-selection') || '';
  const out = [];

  // The DOM: the client's own elements.
  await press('DOM');
  const dom = await wait(() => stage().querySelector('[data-ren-root="mail-dom"]'));
  const rows = () => [...dom.querySelectorAll('button[aria-label]')].filter(b => b.getAttribute('aria-label').includes(': '));
  await wait(() => rows().length === 7);
  const t0 = performance.now();
  rows()[0].click();
  const subject0 = rows()[0].getAttribute('aria-label').split(': ').slice(1).join(': ');
  await wait(() => dom.textContent.includes('Mark unread') && dom.textContent.includes(subject0));
  const domOpen = performance.now() - t0;
  const next = rows()[1].getAttribute('aria-label').split(': ').slice(1).join(': ');
  rows()[0].focus();
  for (const key of ['j', 'Enter']) rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await wait(() => dom.textContent.includes(next));
  // The reading pane's subject (the list's copy is not selectable).
  const heading = [...dom.querySelectorAll('[data-ren="Label"]')].filter(l => l.textContent === next).pop();
  getSelection().selectAllChildren(heading);
  heading.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await wait(() => selectedText() === next);
  await press('Compose');
  const to = await wait(() => [...dom.querySelectorAll('input')].find(i => i.placeholder === 'To'));
  to.value = 'Tamsin Varga';
  to.dispatchEvent(new Event('input', { bubbles: true }));
  const body = dom.querySelector('textarea');
  body.value = 'Typed on the DOM.';
  body.dispatchEvent(new Event('input', { bubbles: true }));
  await press('Send');
  await wait(() => dom.textContent.includes('Sent to Tamsin Varga'));
  out.push(`dom: opened in ${domOpen.toFixed(1)} ms, j+Enter, selected, sent`);

  // The canvases: real pointer events on the canvas, keys to it, and typing
  // through the native text entry; the accessibility mirror beside the
  // canvas tells what it shows.
  const canvasFlow = async (target, id, before, refs = true) => {
    await press(target);
    if (before) await before();
    const host = await wait(() => stage().querySelector(`[data-ren-root="${id}"]`), 30000);
    const canvas = await wait(() => host.querySelector('canvas'), 30000);
    await wait(() => canvas.width > 0 && host.textContent.includes('Inbox'), 30000);
    canvas.scrollIntoView({ block: 'center' });
    const fire = (type, [x, y], extra = {}) => {
      const box = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: box.left + x, clientY: box.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, detail: 1, ...extra }));
    };
    const tap = (at, extra) => {
      fire('pointerdown', at, extra);
      fire('pointerup', at, extra);
    };
    // Keys go to the canvas, or to the native text entry while an Edit has the focus.
    const key = key => (host.contains(document.activeElement) && document.activeElement !== canvas ? document.activeElement : canvas).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    // A triple press on the reading pane's subject, again until it selects one other than `not`.
    const select = async (not = '') => {
      await wait(() => {
        tap(SUBJECT, { detail: 3 });
        return selectedText().length > 5 && selectedText() !== not && host.textContent.includes(selectedText());
      }).catch(() => {});
      return selectedText();
    };
    const start = performance.now();
    tap(row(0));
    await wait(() => host.textContent.includes('Mark unread'));
    const opened = performance.now() - start;
    // A triple press selects the subject, as on the DOM.
    const subject = await select();
    // The row keeps the keyboard: j and Enter open the next message, another subject.
    tap(row(0));
    key('j');
    key('Enter');
    await wait(() => host.textContent.includes('Mark unread'));
    const second = await select(subject);
    if (second === subject) throw new Error(`${target}: j and Enter did not open the next message (${subject})`);
    // c composes (from a focused row: keys go to what has the focus, and a
    // text selection holds none); To takes the focus as the sheet opens, and
    // typing goes through the native text entry.
    tap(row(0));
    key('c');
    await wait(() => host.textContent.includes('New message'));
    const typing = () => (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') && host.contains(document.activeElement) && document.activeElement;
    // Where a ref cannot take the focus (a worker's handle), a press on To gives it.
    if (!refs) tap(TO);
    const entry = await wait(typing, 3000).catch(() => {
      const a = document.activeElement;
      throw new Error(`${target}: the To field did not take the focus (active: ${a?.tagName} ${a?.getAttribute?.('data-ren-entry') ?? ''} ${a?.getAttribute?.('aria-label') ?? ''}; entries ${host.querySelectorAll('[data-ren-entry]').length})`);
    });
    entry.value = 'Tamsin Varga';
    entry.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Tamsin Varga' }));
    // The client shows what it took (its mirror follows the canvas) before Send reads the draft.
    await wait(() => host.textContent.includes('Tamsin Varga'));
    await press('Send');
    await wait(() => host.textContent.includes('Sent to Tamsin Varga'), 5000);
    return `${target}: opened in ${opened.toFixed(1)} ms, selected “${subject.slice(0, 24)}…”, j+Enter, ${refs ? 'To focused by its ref, typed' : 'To pressed, typed'} and sent`;
  };
  out.push(await canvasFlow('Skia', 'mail-skia'));
  out.push(await canvasFlow('three.js overlay', 'mail-three'));
  out.push(await canvasFlow('three.js panel', 'mail-panel', async () => {
    // Facing the camera, the panel fills the canvas pixel for pixel.
    await press('Face the camera');
    await wait(() => button('Tilt the panel'));
  }));
  if (!button('Skia + worker').disabled) out.push(await canvasFlow('Skia + worker', 'mail-worker', null, false));

  // Parity: the script on every renderer, compared with the DOM.
  await press('Run the parity script');
  await wait(() => /\d+ of \d+ renderers/.test(article.querySelector('.mail-parity .summary').textContent) && !button('Running the parity script…'), 180000);
  const results = [...article.querySelectorAll('tr[data-parity]')].map(tr => [...tr.children].map(td => td.textContent));
  const failed = results.filter(r => r[1] !== 'pass' && r[1] !== 'skipped');
  if (failed.length > 0) throw new Error('parity failed: ' + failed.map(r => r.join(' | ')).join(' / '));
  out.push('parity: ' + results.map(r => `${r[0]} ${r[1]} ${r[2]} in ${r[3]} (slowest ${r[4]})`).join(', '));
  return out.join(' | ');
}
