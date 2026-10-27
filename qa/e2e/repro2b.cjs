// Round 2: how does the app behave when storage access fails in different ways? Looks for the
// error-boundary screen ("Something went wrong" / "Try again" / reset) and tests its buttons.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4599/';
const variants = {
  'localStorage getter throws': () => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }),
  'getItem throws': () => { Storage.prototype.getItem = function () { throw new DOMException('denied', 'SecurityError'); }; },
  'getItem throws only for history key': () => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (/history/.test(k)) throw new Error('boom'); return g.call(this, k); }; },
  'getItem returns non-JSON object': () => { const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { return /history/.test(k) ? '[{"id":"a","expression":"1+1","result":"2","mode":"standard","angle":"deg","label":null,"created_at":"2026-01-01T00:00:00Z","toString":1}]' : g.call(this, k); }; },
  'setItem throws after first calc': () => { let n = 0; const s = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/history/.test(k) && ++n > 1) throw new DOMException('quota', 'QuotaExceededError'); return s.call(this, k, v); }; },
  'matchMedia missing': () => { delete window.matchMedia; window.matchMedia = undefined; },
  'crypto.randomUUID missing (http, non-secure context)': () => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined }); },
};
(async () => {
  const b = await chromium.launch();
  for (const [name, fn] of Object.entries(variants)) {
    const ctx = await b.newContext(); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(fn);
    await p.goto(URL); await p.waitForTimeout(700);
    let alive = await p.getByTestId('result').count();
    let calc = '';
    if (alive) {
      for (const k of ['3', '+', '4', 'Enter', '5', '+', '5', 'Enter']) await p.keyboard.press(k);
      await p.waitForTimeout(200);
      alive = await p.getByTestId('result').count();
      calc = alive ? await p.getByTestId('result').innerText() : '';
    }
    const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 140);
    const boundary = /Something went wrong/.test(body);
    console.log(`[${name}] renders=${!!alive} lastResult=${JSON.stringify(calc)} boundary=${boundary} errors=${JSON.stringify(errs.slice(0, 2))}${alive ? '' : ' body=' + JSON.stringify(body)}`);
    if (boundary) {
      await p.screenshot({ path: `${__dirname}/bugs/r2-boundary-${name.replace(/\W+/g, '-')}.png` });
      for (const label of ['Try again', /reset/i]) {
        const bt = p.getByRole('button', { name: label });
        if (await bt.count()) {
          await bt.first().click(); await p.waitForTimeout(500);
          const after = (await p.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80);
          console.log(`   clicked ${label}: app renders=${!!(await p.getByTestId('result').count())} body=${JSON.stringify(after)}`);
          if (await p.getByTestId('result').count()) break;
        }
      }
    }
    await ctx.close();
  }
  await b.close();
})();
