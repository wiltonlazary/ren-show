async () => {
  // The ticket rendered by each renderer's plain render: on an element, on
  // a Skia canvas (its frames decoded) and in a three.js scene on WebGL;
  // its hold takes a real Web Lock through the shared Locker.
  const pane = id => document.querySelector('[data-target="' + id + '"]');
  const value = label => [...document.querySelectorAll('.value')].find(v => v.querySelector('small').textContent === label)?.querySelector('b').textContent;
  await wait(() => pane('dom')?.textContent.includes('Hall B') && pane('skia')?.querySelector('canvas') && pane('three')?.querySelector('canvas'));
  await wait(() => /^\d+ commands, [1-9]\d* texts$/.test(value("Skia's last frame (decoded)") ?? ''));
  const gl = pane('three').querySelector('canvas').getContext('webgl2') ?? pane('three').querySelector('canvas').getContext('webgl');
  if (!gl) throw new Error('no WebGL context on the three.js canvas');
  const hold = [...pane('dom').querySelectorAll('button')].find(b => b.textContent === 'Hold the seat');
  hold.click();
  await wait(() => pane('dom').textContent.includes('held here'));
  await press('Which locks are held?');
  await wait(() => value('locks held (Locker query)') === 'seat-4-12');
  [...pane('dom').querySelectorAll('button')].find(b => b.textContent === 'Release').click();
  await wait(() => pane('dom').textContent.includes('free'));
  await press('Which locks are held?');
  await wait(() => value('locks held (Locker query)') === 'none');
  await press('Make the page');
  const markup = await wait(() => { const t = document.querySelector('[data-page]').textContent; return t.startsWith('<!doctype html>') ? t : null; });
  if (!markup.includes('Hall B') || !markup.includes('name="theme-color"')) throw new Error('the static page lacks the ticket: ' + markup.slice(0, 200));
  return 'skia ' + value("Skia's last frame (decoded)") + ', the seat held and released through Web Locks, a page of ' + markup.length + ' characters';
}
