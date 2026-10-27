// Round 3 sign-off sweep: GitHub Pages sub-path smoke test + a few final exploratory checks.
// SUB=http://localhost:4600/calculator/ (static server over a VITE_BASE=/calculator/ build), URL=root preview.
const { chromium } = require('playwright');
const SUB = process.env.SUB || 'http://localhost:4600/calculator/';
const URL = process.env.URL || 'http://localhost:4599/';
let pass = 0; const fail = [];
const ok = (c, m) => { if (c) pass++; else fail.push(m); console.log(`${c ? 'PASS' : 'FAIL'}: ${m}`); };
(async () => {
  const b = await chromium.launch();
  // ---- Pages sub-path ----
  const ctx = await b.newContext(); const p = await ctx.newPage();
  const bad = [], errs = [];
  p.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  p.on('requestfailed', r => bad.push(`failed ${r.url()}`));
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(SUB); await p.waitForSelector('[data-testid=result]', { timeout: 10000 }).catch(() => {});
  ok(await p.getByTestId('result').count() === 1, 'app renders at /calculator/ sub-path');
  const outside = [];
  p.on('request', r => { if (!r.url().startsWith(SUB) && !r.url().startsWith('data:')) outside.push(r.url()); });
  for (const k of ['1', '2', '*', '3', 'Enter']) await p.keyboard.press(k);
  await p.waitForTimeout(300);
  ok((await p.getByTestId('result').innerText()).trim() === '36', 'calculates 12*3 = 36 on sub-path');
  await p.getByTestId('theme-toggle').click();
  const theme = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.reload(); await p.waitForSelector('[data-testid=result]');
  ok(await p.getByTestId('history-result').count() >= 1, 'history persists across reload on sub-path');
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === theme, `theme (${theme}) persists across reload`);
  const fontsOk = await p.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family); });
  ok(fontsOk.length > 0, `web fonts load from sub-path (${[...new Set(fontsOk)].join(', ')})`);
  ok(bad.length === 0, `no 4xx/failed requests on sub-path ${bad.length ? JSON.stringify(bad.slice(0, 5)) : ''}`);
  ok(outside.length === 0, `no requests escape the /calculator/ prefix ${outside.length ? JSON.stringify(outside.slice(0, 3)) : ''}`);
  ok(errs.length === 0, `no console/page errors on sub-path ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
  const ls = await p.evaluate(() => Object.keys(localStorage));
  console.log('INFO: localStorage keys', JSON.stringify(ls), '(origin-wide on github.io: shared by every Pages project of the same user)');
  await ctx.close();

  // ---- final exploratory checks (root build) ----
  const q = await b.newPage(); const qe = []; q.on('pageerror', e => qe.push(e.message));
  await q.goto(URL); await q.waitForSelector('[data-testid=result]');
  for (const k of ['4', 'Enter']) await q.keyboard.press(k);
  await q.getByRole('button', { name: 'Add label to 4' }).click();
  await q.keyboard.type('a1+2=');                       // digits/operators typed into the label
  await q.keyboard.press('Enter');
  const lbl = await q.evaluate(() => JSON.parse(localStorage.getItem('calc.history.v1'))[0].label);
  const ex = await q.getByTestId('expression').innerText();
  ok(lbl === 'a1+2=' && !/1\s*\+\s*2/.test(ex), `keys typed in label go only to the label (label=${JSON.stringify(lbl)}, expr=${JSON.stringify(ex)})`);
  // label save via keyboard then Enter evaluates
  for (const k of ['9', '-', '1', 'Enter']) await q.keyboard.press(k);
  await q.waitForTimeout(100);
  ok(/8/.test(await q.getByTestId('result').innerText()), 'after keyboard-saving a label, typing 9-1 Enter evaluates to 8');
  // reuse a history result then continue
  await q.getByRole('button', { name: /^Reuse result 8/ }).first().click();
  for (const k of ['*', '2', 'Enter']) await q.keyboard.press(k);
  await q.waitForTimeout(100);
  ok((await q.getByTestId('result').innerText()).trim() === '16', `reuse result 8 then *2 = 16 (got ${await q.getByTestId('result').innerText()})`);
  // reuse an exponential result then continue
  await q.keyboard.press('Escape');
  for (const k of '1000000*1000000*1000000*1000000'.split('').concat(['Enter'])) await q.keyboard.press(k);
  await q.waitForTimeout(100);
  await q.getByRole('button', { name: /^Reuse result 1e\+24/ }).first().click();
  for (const k of ['+', '1', 'Enter']) await q.keyboard.press(k);
  await q.waitForTimeout(100);
  const r = (await q.getByTestId('result').innerText()).trim();
  ok(r === '1.000000000000000000000001e+24' || r === '1e+24', `reuse 1e+24 then +1 stays ~1e+24 (got ${r}, expr ${await q.getByTestId('expression').innerText()})`);
  // delete everything then keyboard still fine
  while (await q.getByRole('button', { name: /^Delete / }).count()) await q.getByRole('button', { name: /^Delete / }).first().click();
  ok(await q.getByTestId('history-result').count() === 0, 'deleting every history entry works');
  for (const k of ['2', '^', '1', '0', 'Enter']) await q.keyboard.press(k);
  await q.waitForTimeout(100);
  ok((await q.getByTestId('result').innerText()).trim() === '1024', 'keyboard 2^10 = 1024 after emptying history');
  // Tab order sanity: first Tab lands on a visible, labelled control
  await q.reload(); await q.waitForSelector('[data-testid=result]');
  await q.keyboard.press('Tab');
  const f = await q.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); return { name: a.getAttribute('aria-label') || a.textContent.trim(), visible: r.width > 0 && r.height > 0, outline: getComputedStyle(a).outlineStyle + ' ' + getComputedStyle(a).boxShadow.slice(0, 30) }; });
  ok(f.visible && !!f.name, `first Tab focuses a visible labelled control (${f.name}; focus style ${f.outline})`);
  ok(qe.length === 0, `no page errors in sweep ${JSON.stringify(qe.slice(0, 3))}`);
  await b.close();
  console.log(`\nFINAL SWEEP: ${pass} passed, ${fail.length} failed`); for (const m of fail) console.log(' - ' + m);
})();
