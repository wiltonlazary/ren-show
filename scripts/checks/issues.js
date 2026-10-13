async () => {
  const app = await wait(() => document.querySelector('article[data-demo="issues"] .app-issues'));
  await press('List');
  await wait(() => app.querySelector('.list .row'));
  const rows = app.querySelectorAll('.list .row').length;
  // The command palette opens on Ctrl+K from anywhere on the page and runs a command with Enter.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  const input = await wait(() => app.querySelector('.palette-input'));
  await wait(() => document.activeElement === input);
  input.value = 'board';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => app.querySelector('.palette-item.active')?.textContent.includes('Switch to board view'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await wait(() => app.querySelector('.board .card') && !app.querySelector('.palette'));
  // Drag the first Ready card to Checking with pointer events: it moves at once, optimistically.
  const card = app.querySelector('.column[data-status="ready"] .card');
  const id = card.getAttribute('data-id');
  const box = card.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientX: box.left + 20, clientY: box.top + 12 };
  card.dispatchEvent(new PointerEvent('pointerdown', at));
  document.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: at.clientX + 40, clientY: at.clientY + 8 }));
  await wait(() => app.querySelector('.layer .card.ghost'));
  const checking = app.querySelector('.column[data-status="checking"]');
  const target = checking.getBoundingClientRect();
  checking.dispatchEvent(new PointerEvent('pointerover', { ...at, clientX: target.left + 30, clientY: target.top + 30 }));
  document.dispatchEvent(new PointerEvent('pointerup', { ...at, clientX: target.left + 30, clientY: target.top + 30 }));
  await wait(() => checking.querySelector(`.card[data-id="${id}"]`));
  await wait(() => !app.querySelector(`.card[data-id="${id}"].saving`), 5000);
  const kept = checking.querySelector(`.card[data-id="${id}"]`) ? 'accepted' : 'rolled back';
  // Filter from the search box: the low-lane search keeps the list until its answer lands.
  await press('List');
  await wait(() => app.querySelector('.list .row'));
  const search = app.querySelector('.search input');
  search.value = 'leak';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => {
    const titles = [...app.querySelectorAll('.list .row .title')].map(t => t.textContent);
    return titles.length > 0 && titles.length < rows && titles.every(t => /leak/i.test(t)) && !app.querySelector('.search .spinner');
  });
  const found = app.querySelectorAll('.list .row').length;
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(() => app.querySelectorAll('.list .row').length === rows);
  return `${rows} rows; palette ran "Switch to board view"; ${id} dragged to Checking (${kept}); "leak" shows ${found} rows`;
}
