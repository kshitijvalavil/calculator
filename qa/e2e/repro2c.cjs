// Round 2: force a render-time error (history timestamp formatting throws) to reach the
// error-boundary screen, then test "Try again" and the reset button.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4599/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForSelector('[data-testid=result]');
  for (const k of ['6', '*', '7', 'Enter']) await p.keyboard.press(k);
  await p.waitForTimeout(200);
  // Arm a one-shot-able failure: every time-formatting API throws while window.__boom is true.
  await p.addInitScript(() => {
    window.__boom = sessionStorage.getItem('boom') !== 'off';
    const wrap = (obj, key) => { const orig = obj[key]; obj[key] = function (...a) { if (window.__boom) throw new Error('forced render failure'); return orig.apply(this, a); }; };
    wrap(Date.prototype, 'toLocaleTimeString'); wrap(Date.prototype, 'toLocaleString'); wrap(Date.prototype, 'toLocaleDateString');
    const fmtDesc = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format');
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { configurable: true, get() { if (window.__boom) throw new Error('forced render failure'); return fmtDesc.get.call(this); } });
    wrap(Intl.DateTimeFormat.prototype, 'formatToParts');
  });
  await p.reload(); await p.waitForTimeout(700);
  const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('errors so far:', JSON.stringify(errs.slice(0, 2)));
  console.log('after forced failure:', JSON.stringify(body.slice(0, 200)));
  const buttons = await p.$$eval('button', bs => bs.map(b => b.getAttribute('aria-label') || b.textContent.trim()));
  console.log('buttons:', JSON.stringify(buttons.slice(0, 10)));
  if (!/Something went wrong/.test(body)) { console.log('boundary not reached'); await b.close(); return; }
  await p.screenshot({ path: __dirname + '/bugs/r2-boundary-screen.png' });
  // Focus management on the boundary screen
  console.log('focused element on boundary:', await p.evaluate(() => document.activeElement?.tagName + ' ' + (document.activeElement?.textContent || '').trim().slice(0, 30)));
  // 1) Try again while the fault persists: must not loop/crash
  const tryAgain = p.getByRole('button', { name: /try again/i });
  if (await tryAgain.count()) { await tryAgain.click(); await p.waitForTimeout(300);
    console.log('Try again (fault persists):', JSON.stringify((await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80))); }
  // 2) Remove the fault, click Try again: should recover with history intact
  await p.evaluate(() => { window.__boom = false; sessionStorage.setItem('boom', 'off'); });
  if (await tryAgain.count()) { await tryAgain.click(); await p.waitForTimeout(300); }
  const recovered = await p.getByTestId('result').count();
  const hist = recovered ? await p.getByTestId('history-result').allInnerTexts() : [];
  console.log('Try again (fault fixed): renders=', !!recovered, 'history=', JSON.stringify(hist));
  // 3) Reset path: re-arm, reload, click reset, confirm storage cleared and app works
  await p.evaluate(() => sessionStorage.setItem('boom', 'on')); await p.reload(); await p.waitForTimeout(600);
  const reset = p.getByRole('button', { name: /reset/i });
  console.log('reset buttons on boundary:', await reset.count());
  if (await reset.count()) {
    await p.evaluate(() => sessionStorage.setItem('boom', 'off'));
    await reset.first().click(); await p.waitForTimeout(500);
    const ok = await p.getByTestId('result').count();
    const stored = await p.evaluate(() => localStorage.getItem('calc.history.v1'));
    console.log('after reset: renders=', !!ok, 'stored history=', JSON.stringify(stored), 'url=', p.url());
    if (ok) { for (const k of ['2', '+', '2', 'Enter']) await p.keyboard.press(k); await p.waitForTimeout(150); console.log('2+2 after reset ->', await p.getByTestId('result').innerText()); }
  }
  console.log('page errors:', JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
