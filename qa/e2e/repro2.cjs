// Round 2 minimal repros: label Enter focus trap, sin( mode switch, blocked storage.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4599/';
(async () => {
  const b = await chromium.launch();
  let p = await b.newPage(); await p.goto(URL); await p.waitForSelector('[data-testid=result]');
  for (const k of ['1', '+', '1', 'Enter']) await p.keyboard.press(k);
  await p.getByRole('button', { name: 'Add label to 1 + 1' }).click();
  await p.keyboard.type('groceries');
  await p.getByRole('button', { name: 'Save label', exact: true }).click();
  for (const k of ['2', '+', '3', 'Enter', '*', '2', 'Enter']) await p.keyboard.press(k);
  await p.waitForTimeout(150);
  const h = await p.evaluate(() => JSON.parse(localStorage.getItem('calc.history.v1')).map(r => `${r.expression}=${r.result} [${r.label}]`));
  console.log('label repro: expr', JSON.stringify(await p.getByTestId('expression').innerText()), 'history', JSON.stringify(h));
  await p.screenshot({ path: __dirname + '/bugs/r2-label-enter-reopens-editor.png' });
  await p.close();

  p = await b.newPage(); await p.goto(URL); await p.waitForSelector('[data-testid=result]');
  await p.getByRole('button', { name: 'Scientific' }).click();
  for (const n of ['sine', '3', '0']) await p.getByRole('button', { name: n, exact: true }).click();
  console.log('sin(30 sci preview', JSON.stringify(await p.getByTestId('result').innerText()));
  await p.getByRole('button', { name: 'Standard' }).click();
  await p.getByRole('button', { name: 'equals', exact: true }).click(); await p.waitForTimeout(80);
  console.log('after Standard + =', JSON.stringify(await p.getByTestId('expression').innerText()), JSON.stringify(await p.getByTestId('result').innerText()));
  await p.close();

  p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
  await p.goto(URL); await p.waitForTimeout(800);
  console.log('blocked storage body:', JSON.stringify((await p.locator('body').innerText()).slice(0, 300)), 'errors', JSON.stringify(errs));
  const reset = p.getByRole('button', { name: /reset|try again|start over|clear/i });
  console.log('reset buttons', await reset.count());
  await p.screenshot({ path: __dirname + '/bugs/r2-blocked-storage.png' });
  if (await reset.count()) { await reset.first().click(); await p.waitForTimeout(500); console.log('after reset:', JSON.stringify((await p.locator('body').innerText()).slice(0, 120))); }
  await b.close();
})();
