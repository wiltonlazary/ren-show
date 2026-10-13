async () => {
  // Pulse in a real Worker: the dashboard streams, pauses and resumes, switches
  // its range, and the page reports what the boundary and its frames cost.
  // A window of n animation frames, where the page applies the worker's messages.
  const frames = n => new Promise(resolve => {
    const step = () => (--n > 0 ? requestAnimationFrame(step) : resolve()); // timer: feature, the window's next frame
    requestAnimationFrame(step); // timer: feature, the window the check watches
  });
  const root = await wait(() => document.querySelector('[data-ren-root="pulse-worker"]'));
  await wait(() => root.querySelectorAll('.kpi b').length === 4 && root.querySelectorAll('svg.latency path').length >= 5 && root.querySelectorAll('.heat .cell').length === 24);
  const kpis = () => [...root.querySelectorAll('.kpi b')].map(b => b.textContent).join(' | ');
  const clock = () => root.querySelector('.clock')?.textContent ?? '';
  const meter = label => document.querySelector(`[data-meter="${label}"] b`)?.textContent ?? '';
  const first = kpis();
  const started = clock();
  await wait(() => kpis() !== first && clock() !== started, 5000);
  await wait(() => root.querySelectorAll('.tail .line').length > 20, 5000);
  // Pause: nothing moves; resume: it moves again.
  await press('Pause');
  await wait(() => button('Resume'));
  // The worker's last frames may follow the Resume button (they go in the low
  // lane, the button is urgent): the dashboard holds three frames running
  // still, 300 at most.
  for (let calm = 0, last = '', n = 0; calm < 3 && n < 300; n++) {
    // timer: poll, the page applies what is left at its frames and says nothing once it is done.
    await new Promise(r => requestAnimationFrame(r));
    calm = kpis() + clock() === last ? calm + 1 : 0;
    last = kpis() + clock();
  }
  const held = kpis();
  const heldClock = clock();
  // Across a second of frames, past a tick of the dashboard's clock, nothing moves.
  await frames(90);
  if (kpis() !== held || clock() !== heldClock) throw new Error(`paused, yet the dashboard moved: ${held} → ${kpis()}`);
  await press('Resume');
  await wait(() => kpis() !== held && clock() !== heldClock, 5000);
  // Ranges: the axis changes to minutes over an hour.
  const axis = () => [...root.querySelectorAll('.chart .axis.x span')].slice(0, 5).map(s => s.textContent).join(' ');
  const short = axis();
  await press('1 h');
  await wait(() => button('1 h')?.getAttribute('aria-pressed') === 'true' && axis() !== short && /^\d\d:\d\d \d\d:\d\d/.test(axis()));
  // A faster feed, then the numbers once the feed reports the new rate.
  await press('60 Hz');
  await wait(() => button('60 Hz')?.getAttribute('aria-pressed') === 'true');
  await wait(() => /ticks\/s/.test(meter('feed')) && meter('page frames') !== '–' && Number(meter('messages applied').replace(/,/g, '')) > 20 && parseFloat(meter('feed')) > 40, 10000);
  const messages = Number(meter('messages applied').replace(/,/g, ''));
  if (!(messages > 20)) throw new Error(`too few messages applied: ${meter('messages applied')}`);
  const hz = parseFloat(meter('feed'));
  if (!(hz > 20)) throw new Error(`the feed ticks slowly: ${meter('feed')}`);
  const report = `worker dashboard streams: ${messages} messages applied (${meter('records')} records), apply ${meter('apply time')}, received ${meter('received')}; feed ${meter('feed')}, tick work ${meter('tick work')}; page frames ${meter('page frames')}, late ${meter('late frames')}`;
  await press('30 Hz');
  await press('5 min');
  return report;
}
