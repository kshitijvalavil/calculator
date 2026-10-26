// Minimal repros for findings from explore.cjs.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4599/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForSelector('[data-testid=result]');
  // A: one null entry in history
  for (const [label, val] of [['[null]', '[null]'], ['[{}]', '[{}]'], ['{"a":1}', '{"a":1}'], ['[1]', '[1]']]) {
    await p.evaluate(v => localStorage.setItem('calc.history.v1', v), val);
    errs.length = 0; await p.reload(); await p.waitForTimeout(400);
    const alive = await p.getByTestId('result').count();
    console.log(`history=${label}: renders=${!!alive} errors=${JSON.stringify(errs)}`);
    if (!alive && label === '[null]') await p.screenshot({ path: __dirname + '/bugs/history-null-entry-white-screen.png' });
  }
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('[data-testid=result]');
  // B: real clipboard paste via Ctrl+V
  await p.evaluate(() => navigator.clipboard.writeText('12+3'));
  await p.getByTestId('expression').click();
  await p.keyboard.press('Control+V'); await p.waitForTimeout(100);
  console.log('ctrl+v "12+3" ->', JSON.stringify(await p.getByTestId('expression').innerText()), JSON.stringify(await p.getByTestId('result').innerText()));
  // C: history size cap
  for (let i = 0; i < 3; i++) { await p.keyboard.press('1'); await p.keyboard.press('Enter'); }
  console.log('history stored entries:', await p.evaluate(() => JSON.parse(localStorage.getItem('calc.history.v1') || '[]').length));
  await b.close();
})();
