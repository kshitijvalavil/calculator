// Round 2 exploratory pass: label editing, Show more, error boundary, scientific panel,
// paste of junk/long text, dark-mode contrast. Usage: URL=http://localhost:4599/ node qa/e2e/explore2.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4599/';
const BUGS = __dirname + '/bugs'; fs.mkdirSync(BUGS, { recursive: true });
const findings = []; let passed = 0;
const HKEY = 'calc.history.v1';

(async () => {
  const browser = await chromium.launch();
  async function fresh(viewport = { width: 1280, height: 900 }, opts = {}) {
    const ctx = await browser.newContext({ viewport, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
    const page = await ctx.newPage(); page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('dialog', async d => { page.errors.push('DIALOG: ' + d.message()); await d.dismiss(); });
    await page.goto(URL); await page.waitForSelector('[data-testid=result]');
    return page;
  }
  const expr = p => p.getByTestId('expression').innerText();
  const result = p => p.getByTestId('result').innerText();
  const btn = (p, name) => p.getByRole('button', { name, exact: true });
  const keys = async (p, s) => { for (const k of s) await p.keyboard.press(k); };
  async function check(name, p, fn) {
    try {
      const msg = await fn(); const errs = p.errors.splice(0);
      if (msg || errs.length) {
        const file = `${BUGS}/r2-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
        await p.screenshot({ path: file, fullPage: true });
        findings.push({ name, problem: [msg, ...errs].filter(Boolean).join(' | '), screenshot: file.replace(/^.*qa\//, 'qa/') });
      } else passed++;
    } catch (e) {
      const file = `${BUGS}/r2-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-exception.png`;
      await p.screenshot({ path: file, fullPage: true }).catch(() => {});
      findings.push({ name, problem: 'script exception: ' + e.message.split('\n')[0], screenshot: file.replace(/^.*qa\//, 'qa/') });
    }
  }
  async function paste(p, text) {
    await p.getByTestId('expression').click();
    await p.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t);
      (document.activeElement || document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
    await p.waitForTimeout(80);
  }
  const bad = s => /NaN|Infinity|undefined|null|\[object|^-0$/.test(s);
  const log = (...a) => console.log(...a);

  // ---------- A. Label editing ----------
  let p = await fresh();
  await check('label: Enter after mouse-saving a label evaluates the expression', p, async () => {
    await keys(p, ['1', '+', '1', 'Enter']);
    await btn(p, 'Add label to 1 + 1').click();
    await p.keyboard.type('groceries');
    await btn(p, 'Save label').click();
    await p.waitForTimeout(100);
    await keys(p, ['2', '+', '3']);
    const exprBefore = await expr(p);
    await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    const editorOpen = await p.locator('input.tape__label-input, input[aria-label^="Label for"]').count();
    const r = await result(p), e = await expr(p);
    const active = await p.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
    log(`label/Enter: typed-before-Enter=${JSON.stringify(exprBefore)} after: expr=${JSON.stringify(e)} result=${JSON.stringify(r)} editorOpen=${editorOpen} focus=${active}`);
    const probs = [];
    if (editorOpen) probs.push(`Enter re-opened the label editor (focus was on "${active}")`);
    if (!/5/.test(r)) probs.push(`Enter did not evaluate 2+3 (result ${JSON.stringify(r)}, expr ${JSON.stringify(e)})`);
    if (!/2\s*\+\s*3/.test(exprBefore)) probs.push(`digits typed after saving label did not reach the calculator (expr ${JSON.stringify(exprBefore)})`);
    return probs.join('; ');
  });
  p = await fresh();
  await check('label: Enter saves, Escape cancels, clear works', p, async () => {
    await keys(p, ['7', 'Enter']);
    const probs = [];
    await btn(p, 'Add label to 7').click(); await p.keyboard.type('first'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    if (!(await p.getByText('first', { exact: true }).count())) probs.push('Enter in label input did not save');
    const resAfter = await result(p);
    const opened = await p.locator('input[aria-label^="Label for"]').count();
    if (opened) probs.push('editor still open after Enter');
    // reopen with the edit button (aria-label may change)
    const editBtn = p.getByRole('button', { name: /label/i }).filter({ hasNot: p.locator('input') }).first();
    await editBtn.click(); await p.keyboard.press('Control+A'); await p.keyboard.type('second'); await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    if (await p.getByText('second', { exact: true }).count()) probs.push('Escape saved the label instead of cancelling');
    if (!(await p.getByText('first', { exact: true }).count())) probs.push('Escape lost the previous label');
    const resEsc = await result(p);
    if (resEsc !== resAfter) probs.push(`Escape in label editor also cleared the calculator (${JSON.stringify(resAfter)} -> ${JSON.stringify(resEsc)})`);
    await editBtn.click(); await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    const stored = await p.evaluate(k => JSON.parse(localStorage.getItem(k))[0].label, HKEY);
    if (stored !== null && stored !== undefined) probs.push(`clearing label stored ${JSON.stringify(stored)} instead of null`);
    return probs.join('; ');
  });
  p = await fresh();
  await check('label: hostile and long labels', p, async () => {
    await keys(p, ['9', 'Enter']);
    const probs = [];
    const tryLabel = async (text, via = 'type') => {
      await p.getByRole('button', { name: /label/i }).first().click();
      const inp = p.locator('input[aria-label^="Label for"]');
      await inp.fill('');
      if (via === 'type') await p.keyboard.type(text); else await inp.fill(text);
      const v = await inp.inputValue();
      await p.keyboard.press('Enter'); await p.waitForTimeout(80);
      const stored = await p.evaluate(k => JSON.parse(localStorage.getItem(k))[0].label, HKEY);
      return { v, stored };
    };
    let r = await tryLabel('<img src=x onerror=alert(1)>');
    if (await p.locator('.tape img, [class*=tape] img').count()) probs.push('label HTML rendered as markup');
    r = await tryLabel('x'.repeat(200), 'fill');
    if ([...(r.stored || '')].length > 80) probs.push(`label of ${[...r.stored].length} chars stored (limit 80)`);
    r = await tryLabel('😀'.repeat(80), 'fill');
    log(`80-emoji label: input kept ${[...r.v].length} emoji, stored ${[...(r.stored || '')].length}`);
    if ([...(r.stored || '')].length < 80) probs.push(`80-emoji label truncated to ${[...(r.stored || '')].length} emoji (input maxlength counts UTF-16 units; contract/DB allow 80 chars)`);
    r = await tryLabel('   ', 'fill');
    log(`whitespace label stored as ${JSON.stringify(r.stored)}`);
    if (r.stored === '   ') probs.push('whitespace-only label stored verbatim');
    return probs.join('; ');
  });

  // ---------- B. Show more ----------
  p = await fresh();
  await check('history Show more', p, async () => {
    await keys(p, ['1', 'Enter']);
    await p.evaluate(k => {
      const one = JSON.parse(localStorage.getItem(k))[0];
      const t = Date.now();
      localStorage.setItem(k, JSON.stringify(Array.from({ length: 450 }, (_, i) => ({ ...one, id: crypto.randomUUID(), expression: `${450 - i} + 0`, result: String(450 - i), created_at: new Date(t - i * 1000).toISOString() }))));
    }, HKEY);
    await p.reload(); await p.waitForSelector('[data-testid=result]');
    const shown0 = await p.getByTestId('history-result').count();
    const more = p.getByRole('button', { name: /show more|load more|more/i });
    const hasMore = await more.count();
    log(`history: 450 stored, ${shown0} rendered initially, show-more buttons: ${hasMore}`);
    if (!hasMore) return shown0 >= 450 ? '' : `only ${shown0} of 450 entries shown and no "Show more" control`;
    const probs = []; let shown = shown0, clicks = 0;
    while (await more.count() && clicks < 50) {
      await more.first().click(); clicks++; await p.waitForTimeout(60);
      const now = await p.getByTestId('history-result').count();
      if (now <= shown) { probs.push(`click ${clicks} on Show more did not add entries (${now})`); break; }
      shown = now;
    }
    const exprs = await p.locator('button[aria-label^="Reuse expression"]').evaluateAll(bs => bs.map(b => b.textContent.trim()));
    log(`after ${clicks} clicks: ${shown} rendered; first ${exprs[0]}, last ${exprs.at(-1)}`);
    if (shown < 450) probs.push(`after ${clicks} clicks only ${shown}/450 entries reachable`);
    if (new Set(exprs).size !== exprs.length) probs.push('duplicate entries after Show more');
    for (let i = 1; i < exprs.length; i++) if (parseInt(exprs[i]) > parseInt(exprs[i - 1])) { probs.push(`order broken at ${exprs[i - 1]} -> ${exprs[i]}`); break; }
    // new calc while expanded: does the list collapse/duplicate?
    await keys(p, ['8', '8', '8', 'Enter']); await p.waitForTimeout(100);
    const top = await p.locator('button[aria-label^="Reuse expression"]').first().textContent();
    if (!/888/.test(top)) probs.push(`new calculation not at top after Show more (top: ${top})`);
    // delete while expanded
    const before = await p.getByTestId('history-result').count();
    await p.getByRole('button', { name: /^Delete / }).nth(5).click(); await p.waitForTimeout(100);
    const after = await p.getByTestId('history-result').count();
    log(`delete while expanded: ${before} -> ${after}`);
    if (after !== before - 1) probs.push(`deleting one entry while expanded changed count ${before} -> ${after}`);
    return probs.join('; ');
  });

  // ---------- C. Error boundary ----------
  for (const [name, val] of [
    ['object expression', [{ id: 'x1', expression: { a: 1 }, result: { b: 2 }, mode: 'standard', angle: 'deg', label: { c: 3 }, created_at: new Date().toISOString() }]],
    ['bad date', [{ id: 'x2', expression: '1+1', result: '2', mode: 'standard', angle: 'deg', label: null, created_at: 'not a date' }]],
    ['huge label', [{ id: 'x3', expression: '1+1', result: '2', mode: 'weird', angle: 'grad', label: 'L'.repeat(100000), created_at: 12 }]],
  ]) {
    p = await fresh();
    await check(`error boundary / bad history: ${name}`, p, async () => {
      await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [HKEY, val]);
      await p.reload(); await p.waitForTimeout(500);
      const alive = await p.getByTestId('result').count();
      const body = (await p.locator('body').innerText()).slice(0, 300).replace(/\s+/g, ' ');
      log(`bad history (${name}): app renders=${!!alive}; body: ${body.slice(0, 160)}`);
      p.errors = p.errors.filter(e => !/Objects are not valid|Invalid time value/.test(e) || !alive ? true : false);
      if (alive) return '';
      // reset screen expected
      const reset = p.getByRole('button', { name: /reset|try again|start over|clear/i });
      if (!(await reset.count())) return `white screen, no reset UI: ${body}`;
      await p.screenshot({ path: `${BUGS}/r2-error-boundary-${name.replace(/\W+/g, '-')}.png` });
      await reset.first().click(); await p.waitForTimeout(400);
      if (!(await p.getByTestId('result').count())) return 'reset button did not recover the app';
      await p.reload(); await p.waitForTimeout(400);
      if (!(await p.getByTestId('result').count())) return 'app crashes again after reload (reset did not clear the bad data)';
      p.errors.length = 0;
    });
  }
  p = await fresh();
  await check('error boundary: localStorage throws (quota / disabled)', p, async () => {
    await p.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError'); }; });
    await p.reload(); await p.waitForSelector('[data-testid=result]');
    await keys(p, ['3', '+', '4', 'Enter']); await p.waitForTimeout(200);
    const r = await result(p);
    if (!/7/.test(r)) return `with setItem throwing, 3+4 shows ${JSON.stringify(r)}`;
    p.errors = p.errors.filter(e => !/quota/i.test(e));
  });
  p = await fresh();
  await check('error boundary: localStorage getItem throws (blocked storage)', p, async () => {
    await p.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
    await p.reload(); await p.waitForTimeout(500);
    if (!(await p.getByTestId('result').count())) return 'white screen / reset screen when localStorage access throws (private mode, blocked cookies)';
    await keys(p, ['3', '+', '4', 'Enter']); await p.waitForTimeout(200);
    if (!/7/.test(await result(p))) return `3+4 shows ${await result(p)} with blocked storage`;
    p.errors = p.errors.filter(e => !/denied/i.test(e));
  });

  // ---------- D. Scientific panel ----------
  p = await fresh();
  await btn(p, 'Scientific').click();
  const sciCases = [
    [['square root', '9', 'equals'], '3'],
    [['2', 'power', '1', '0', 'equals'], '1024'],
    [['2', 'sine', '3', '0', 'equals'], '1'],
    [['pi', 'pi', 'equals'], null],
    [['Euler\'s number', '3', 'equals'], null],
    [['5', 'factorial', 'factorial', 'equals'], null],
    [['natural logarithm', 'Euler\'s number', 'equals'], '1'],
    [['logarithm base 10', '1', '0', '0', '0', 'equals'], '3'],
    [['cosine', 'cosine', 'cosine', '0', 'equals'], null],
    [['left parenthesis', 'right parenthesis', 'equals'], null],
    [['right parenthesis', 'right parenthesis', '5', 'equals'], null],
    [['4', 'factorial', 'equals', 'factorial', 'equals'], null],
    [['2', 'power', 'power', '3', 'equals'], null],
    [['square root', 'minus', '4', 'equals'], null],
  ];
  for (const [seq, want] of sciCases) {
    await check('scientific: ' + seq.join(' '), p, async () => {
      await btn(p, 'all clear').click();
      for (const k of seq) await btn(p, k).click();
      await p.waitForTimeout(60);
      const e = await expr(p), r = await result(p);
      log(`sci [${seq.join(', ')}] -> ${JSON.stringify(e)} = ${JSON.stringify(r)}`);
      if (bad(e) || bad(r)) return `bad text: ${JSON.stringify(e)} / ${JSON.stringify(r)}`;
      if (want && r.trim() !== want) return `expected ${want}, got ${JSON.stringify(r)} (expr ${JSON.stringify(e)})`;
    });
  }
  await check('scientific: 300 random panel presses', p, async () => {
    const names = await p.$$eval('button', bs => bs.map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(n => n && !/theme|Standard|Scientific|^Reuse|^Delete|label/i.test(n)));
    let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const weird = [];
    for (let i = 0; i < 300; i++) {
      await btn(p, names[Math.floor(rnd() * names.length)]).click();
      if (i % 20 === 0) { const e = await expr(p), r = await result(p); if (bad(e) || bad(r)) weird.push(`${e} => ${r}`); }
    }
    return weird.length ? 'bad text: ' + weird.slice(0, 3).join('; ') : '';
  });
  await check('scientific -> standard with an open function', p, async () => {
    await btn(p, 'all clear').click();
    await btn(p, 'sine').click(); await btn(p, '3').click(); await btn(p, '0').click();
    await btn(p, 'Standard').click();
    const e = await expr(p);
    await btn(p, 'equals').click(); await p.waitForTimeout(60);
    const r = await result(p);
    log(`sin(30 then Standard: expr ${JSON.stringify(e)} = ${JSON.stringify(r)}`);
    if (bad(r)) return `bad result ${r}`;
  });

  // ---------- E. Paste junk / long text ----------
  p = await fresh();
  await check('paste: the app\'s own exponential result', p, async () => {
    const probs = [];
    for (const [text, want] of [['1e+24', /1e\+24|1000000000000000000000000/], ['2.5e-8', /2\.5e-8|0\.000000025/], ['1e3', /1000|SYNTAX|isn't|Check|invalid/i]]) {
      await btn(p, 'all clear').click(); await paste(p, text);
      const e = await expr(p), r = await result(p);
      log(`paste ${text}: expr ${JSON.stringify(e)} preview ${JSON.stringify(r)}`);
      if (!want.test(r) && !(e.trim() === '' && r.trim() === '0')) probs.push(`pasting "${text}" becomes ${JSON.stringify(e)} = ${JSON.stringify(r)} (silently wrong value)`);
    }
    return probs.join('; ');
  });
  await check('paste: long text', p, async () => {
    const probs = [];
    await btn(p, 'all clear').click(); await paste(p, '1+'.repeat(400) + '1');
    let e = await expr(p), r = await result(p);
    const len = e.replace(/\s/g, '').length;
    log(`paste 801-char sum: expression now ${len} non-space chars, preview ${JSON.stringify(r)}`);
    const notice = await p.locator('[role=status], [role=alert], [aria-live]').allInnerTexts();
    if (len < 801) log(`  truncated; live regions: ${JSON.stringify(notice)}`);
    if (/^\d+$/.test(r.trim()) && len < 801 && !notice.some(t => /long|limit|500|truncat/i.test(t))) probs.push(`801-char paste silently truncated to ${len} chars and shows ${r} as if it were the answer (full sum is 401)`);
    await btn(p, 'all clear').click(); await paste(p, 'lorem ipsum '.repeat(2000));
    e = await expr(p); r = await result(p);
    if (bad(e) || bad(r)) probs.push(`junk text paste gives ${e}/${r}`);
    await btn(p, 'all clear').click(); await paste(p, '２＋２');
    e = await expr(p);
    if (!e.trim()) log('  full-width digits ２＋２ are dropped entirely');
    await btn(p, 'all clear').click(); await keys(p, ['5']); await paste(p, '+3');
    e = await expr(p); if (!/5\s*\+\s*3/.test(e)) probs.push(`paste "+3" after typing 5 gives ${JSON.stringify(e)} (paste replaces instead of appending?)`);
    return probs.join('; ');
  });

  // ---------- F. Dark mode contrast ----------
  for (const theme of ['dark', 'light']) {
    p = await fresh({ width: 1280, height: 900 }, { colorScheme: theme });
    await check(`contrast (${theme})`, p, async () => {
      const t = await p.getByTestId('theme-toggle').getAttribute('aria-label');
      if (theme === 'dark' && /dark/i.test(t)) await p.getByTestId('theme-toggle').click();
      if (theme === 'light' && /light/i.test(t)) await p.getByTestId('theme-toggle').click();
      await keys(p, ['1', '/', '0', 'Enter']); // error message in display
      await keys(p, ['7', 'Enter']);
      await p.getByRole('button', { name: /^Add label to 7/ }).first().click();
      await p.waitForTimeout(300);
      const low = await p.evaluate(() => {
        const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
        const lum = ({ r, g, b }) => { const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
        const bgOf = el => { const stack = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
          let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; if (base.a < 1) base = { r: 255, g: 255, b: 255, a: 1 };
          for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base); return base; };
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        while (walker.nextNode()) {
          const el = walker.currentNode.parentElement; const txt = walker.currentNode.textContent.trim();
          if (!txt || seen.has(el)) continue; seen.add(el);
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          if (r.width === 0 || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
          let fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el); if (fg.a < 1) fg = blend(fg, bg);
          const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = size >= 24 || (bold && size >= 18.66);
          if (ratio < (large ? 3 : 4.5)) out.push(`"${txt.slice(0, 30)}" ${ratio.toFixed(2)}:1 (${size}px, fg ${cs.color}, bg rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`);
        }
        const ph = document.querySelector('input[placeholder]'); if (ph) { const c = getComputedStyle(ph, '::placeholder').color; out.push(`(placeholder color ${c})`); }
        return out;
      });
      await p.screenshot({ path: `${__dirname}/round2-${theme}.png`, fullPage: true });
      const real = low.filter(l => !l.startsWith('(placeholder'));
      log(`contrast ${theme}: ${real.length} text nodes below WCAG AA ${low.find(l => l.startsWith('(placeholder')) || ''}`);
      for (const l of real) log('   ' + l);
      return real.length ? `${real.length} text elements below WCAG AA: ${real.slice(0, 6).join('; ')}` : '';
    });
  }

  await browser.close();
  console.log(`\nE2E ROUND 2: ${passed} checks passed, ${findings.length} findings`);
  for (const f of findings) console.log(`- ${f.name}: ${f.problem}\n  screenshot: ${f.screenshot}`);
  fs.writeFileSync(BUGS + '/findings-round2.json', JSON.stringify(findings, null, 2));
})();
