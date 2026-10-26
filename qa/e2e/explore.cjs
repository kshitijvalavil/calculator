// Exploratory "try to break it" pass against a vite preview build (local mode).
// Usage: URL=http://localhost:4599/ node qa/e2e/explore.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.URL || 'http://localhost:4599/';
const BUGS = __dirname + '/bugs';
fs.mkdirSync(BUGS, { recursive: true });
const findings = []; let passed = 0;

(async () => {
  const browser = await chromium.launch();
  async function fresh(viewport = { width: 1280, height: 900 }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
    page.on('dialog', async d => { page.errors.push('DIALOG: ' + d.message()); await d.dismiss(); });
    await page.goto(URL); await page.waitForSelector('[data-testid=result]');
    return page;
  }
  const expr = p => p.locator('[data-testid=expression]').innerText();
  const result = p => p.locator('[data-testid=result]').innerText();
  const btn = (p, name) => p.getByRole('button', { name, exact: true });
  async function clickSeq(p, names) { for (const n of names) await btn(p, n).click(); }
  async function historyCount(p) {
    return p.evaluate(() => {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i)) || '';
        try { const j = JSON.parse(v); if (Array.isArray(j)) n = Math.max(n, j.length); else if (j && Array.isArray(j.calculations)) n = Math.max(n, j.calculations.length); } catch {}
      }
      return n;
    });
  }
  async function check(name, p, fn) {
    try {
      const msg = await fn();
      const errs = p.errors.splice(0);
      if (msg || errs.length) {
        const file = `${BUGS}/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
        await p.screenshot({ path: file, fullPage: true });
        findings.push({ name, problem: [msg, ...errs].filter(Boolean).join(' | '), screenshot: file.replace(/^.*qa\//, 'qa/') });
      } else passed++;
    } catch (e) {
      const file = `${BUGS}/${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-exception.png`;
      await p.screenshot({ path: file, fullPage: true }).catch(() => {});
      findings.push({ name, problem: 'script exception: ' + e.message.split('\n')[0], screenshot: file.replace(/^.*qa\//, 'qa/') });
    }
  }
  const badText = s => /NaN|Infinity|undefined|null|\[object|^-0$/.test(s);

  // 1. Keyboard mash
  let p = await fresh();
  await check('keyboard mash 800 keys', p, async () => {
    const keys = ['0','1','2','3','4','5','6','7','8','9','+','-','*','/','^','%','!','(',')','.','Enter','=','Backspace','Delete','Escape','e','p','s','x','Tab',' ','ArrowLeft','ArrowRight'];
    let seed = 7; const r = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    const weird = [];
    for (let i = 0; i < 800; i++) {
      await p.keyboard.press(keys[Math.floor(r() * keys.length)]);
      if (i % 50 === 0) { const e = await expr(p), res = await result(p); if (badText(e) || badText(res)) weird.push(`${JSON.stringify(e)} => ${JSON.stringify(res)}`); }
    }
    await p.keyboard.press('Escape');
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    for (const k of ['2', '+', '2', 'Enter']) await p.keyboard.press(k);
    const res = await result(p);
    if (weird.length) return 'bad display text during mash: ' + weird.slice(0, 3).join('; ');
    if (!/^4$/.test(res.trim())) return `after mash, Escape then 2+2 Enter shows ${JSON.stringify(res)}`;
  });

  // 2. Backspace on empty display
  p = await fresh();
  await check('backspace on empty display', p, async () => {
    await btn(p, 'all clear').click();
    for (let i = 0; i < 5; i++) await btn(p, 'backspace').click();
    for (let i = 0; i < 5; i++) await p.keyboard.press('Backspace');
    const e = await expr(p), r = await result(p);
    if (badText(e) || badText(r) || r.trim() !== '0') return `after Backspace on empty: expr=${JSON.stringify(e)} result=${JSON.stringify(r)}`;
    await clickSeq(p, ['7']);
    if ((await expr(p)).trim() !== '7') return `typing 7 after backspaces shows ${JSON.stringify(await expr(p))}`;
  });

  // 3. Double-click equals
  p = await fresh();
  await check('double-click equals', p, async () => {
    await clickSeq(p, ['2', 'plus', '3']);
    await btn(p, 'equals').dblclick();
    await p.waitForTimeout(300);
    const r = await result(p), e = await expr(p), n = await historyCount(p);
    const tape = await p.locator('text=/2\\s*\\+\\s*3/').count();
    const problems = [];
    if (!/5/.test(r) && !/5/.test(e)) problems.push(`display after dblclick: expr=${JSON.stringify(e)} result=${JSON.stringify(r)}`);
    if (n > 1) problems.push(`double-click "=" saved ${n} history entries for one calculation`);
    return problems.join('; ');
  });

  // 4. Theme toggle mid-calculation
  p = await fresh();
  await check('theme toggle mid-calculation', p, async () => {
    await clickSeq(p, ['1', '2', 'plus', '3']);
    const before = await expr(p);
    await p.getByTestId('theme-toggle').click();
    await p.getByTestId('theme-toggle').click();
    await p.getByTestId('theme-toggle').click();
    const after = await expr(p);
    if (after !== before) return `expression changed on theme toggle: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
    // keyboard focus is now on the theme button: Enter would toggle theme instead of evaluating?
    await p.keyboard.press('Enter');
    await p.waitForTimeout(100);
    const r = await result(p), e2 = await expr(p);
    const dark = await p.evaluate(() => document.documentElement.className + ' ' + (document.documentElement.dataset.theme || ''));
    if (!/15/.test(r + e2)) return `Enter after toggling theme (focus on toggle) did not evaluate: expr=${JSON.stringify(e2)} result=${JSON.stringify(r)} theme=${dark}`;
  });

  // 5. Exponential result fed back into the next calculation
  p = await fresh();
  await check('continue from exponential result', p, async () => {
    for (const k of '1000000*1000000*1000000*1000000'.split('')) await p.keyboard.press(k);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(100);
    const r1 = await result(p);
    await p.keyboard.press('*'); await p.keyboard.press('2'); await p.keyboard.press('Enter');
    await p.waitForTimeout(100);
    const r2 = await result(p), e2 = await expr(p);
    if (!/2e\+24|2 × 10\^?24|2,000,000,000,000,000,000,000,000|2000000000000000000000000/.test(r2.replace(/\s/g, ''))) return `1e+24 then ×2 = gives ${JSON.stringify(r2)} (expr ${JSON.stringify(e2)}, first result ${JSON.stringify(r1)})`;
  });

  // 6. Very long input
  p = await fresh();
  await check('very long input (600 keys)', p, async () => {
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 300; i++) { await p.keyboard.press('9'); await p.keyboard.press('+'); }
    await p.keyboard.press('1');
    const overflow = await p.evaluate(() => ({ page: document.documentElement.scrollWidth > window.innerWidth }));
    const box = await p.getByTestId('expression').boundingBox();
    const keypad = await p.getByRole('group', { name: 'Keypad' }).boundingBox();
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const r = await result(p);
    const problems = [];
    if (overflow.page) problems.push('long expression causes horizontal page scroll');
    if (box && keypad && box.width > keypad.width + 60) problems.push(`expression box grew to ${Math.round(box.width)}px (keypad ${Math.round(keypad.width)}px)`);
    if (badText(r)) problems.push(`result ${JSON.stringify(r)}`);
    if (!/2701/.test(r)) problems.push(`601-char expression 9+9+...+1 result shows ${JSON.stringify(r)} (expected 2701)`);
    return problems.join('; ');
  });

  // 7. Paste junk
  p = await fresh();
  await check('paste junk', p, async () => {
    const junk = ['<img src=x onerror=alert(1)>', '1e3', '２＋２', '2+2\n=', '9'.repeat(5000), '💥'.repeat(100), 'sqrt(-1)', ')))(((', '‮1+2'];
    const shown = [];
    for (const j of junk) {
      await btn(p, 'all clear').click();
      await p.getByTestId('expression').click();
      await p.evaluate(t => {
        const dt = new DataTransfer(); dt.setData('text/plain', t);
        const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        (document.activeElement || document.body).dispatchEvent(ev);
      }, j);
      await p.waitForTimeout(50);
      const e = await expr(p), r = await result(p);
      shown.push(`${JSON.stringify(j.slice(0, 20))} -> expr ${JSON.stringify(e.slice(0, 30))} / result ${JSON.stringify(r.slice(0, 30))}`);
      if (badText(e) || badText(r)) return 'bad text after paste: ' + shown.at(-1);
    }
    const imgs = await p.locator('[data-testid=expression] img, [data-testid=result] img').count();
    if (imgs) return 'pasted HTML was rendered as markup (img element present)';
    console.log('paste behaviour:\n  ' + shown.join('\n  '));
  });

  // 8. 320px wide
  p = await fresh({ width: 320, height: 640 });
  await check('320px viewport layout', p, async () => {
    await p.getByRole('button', { name: 'Scientific' }).click().catch(() => {});
    await p.waitForTimeout(200);
    const m = await p.evaluate(() => {
      const out = { sw: document.documentElement.scrollWidth, iw: window.innerWidth, offscreen: [], small: [] };
      for (const b of document.querySelectorAll('button')) {
        const r = b.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > window.innerWidth + 1 || r.left < -1) out.offscreen.push(b.getAttribute('aria-label') || b.textContent.trim());
        if (r.width < 40 || r.height < 40) out.small.push(`${b.getAttribute('aria-label') || b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    const problems = [];
    if (m.sw > m.iw) problems.push(`horizontal scroll at 320px (scrollWidth ${m.sw})`);
    if (m.offscreen.length) problems.push(`buttons off-screen: ${m.offscreen.join(', ')}`);
    if (m.small.length) problems.push(`tap targets < 40px: ${m.small.slice(0, 8).join(', ')}`);
    await p.screenshot({ path: __dirname + '/explore-320.png', fullPage: true });
    // long number at 320
    await p.getByRole('button', { name: 'Standard' }).click().catch(() => {});
    for (let i = 0; i < 40; i++) await btn(p, '9').click();
    const sw2 = await p.evaluate(() => document.documentElement.scrollWidth);
    if (sw2 > 320) problems.push(`40-digit number causes horizontal scroll at 320px (${sw2})`);
    return problems.join('; ');
  });

  // 9. Corrupted localStorage
  p = await fresh();
  await check('corrupted localStorage history', p, async () => {
    await clickSeq(p, ['1', 'plus', '1', 'equals']);
    await p.waitForTimeout(200);
    const keys = await p.evaluate(() => Object.keys(localStorage));
    await p.evaluate(ks => { for (const k of ks) localStorage.setItem(k, '{not json'); }, keys);
    await p.reload(); await p.waitForTimeout(400);
    const alive = await p.getByTestId('result').count();
    if (!alive) return `app did not render after corrupting localStorage keys ${keys.join(',')}`;
    await p.evaluate(ks => { for (const k of ks) localStorage.setItem(k, JSON.stringify([{ id: 1, expression: null, result: {}, created_at: 'x' }, 'str', null])); }, keys);
    await p.reload(); await p.waitForTimeout(400);
    if (!(await p.getByTestId('result').count())) return `app white-screens with schema-invalid history in ${keys.join(',')}`;
    p.errors = p.errors.filter(e => !/JSON/.test(e)); // tolerate logged parse errors
  });

  // 10. Huge history
  p = await fresh();
  await check('5000-entry history renders', p, async () => {
    await clickSeq(p, ['1', 'plus', '1', 'equals']);
    await p.waitForTimeout(200);
    const key = await p.evaluate(() => Object.keys(localStorage).find(k => { try { return Array.isArray(JSON.parse(localStorage.getItem(k))); } catch { return false; } }));
    if (!key) return 'could not find history array in localStorage';
    await p.evaluate(k => {
      const one = JSON.parse(localStorage.getItem(k))[0];
      const arr = Array.from({ length: 5000 }, (_, i) => ({ ...one, id: `${one.id}-${i}`, expression: `${i}+1`, result: String(i + 1) }));
      localStorage.setItem(k, JSON.stringify(arr));
    }, key);
    const t0 = Date.now(); await p.reload(); await p.waitForSelector('[data-testid=result]'); const dt = Date.now() - t0;
    const t1 = Date.now(); await clickSeq(p, ['2', 'plus', '2', 'equals']); const dt2 = Date.now() - t1;
    const n = await historyCount(p);
    if (dt > 3000 || dt2 > 2000) return `slow with 5000 entries: reload ${dt} ms, one calc ${dt2} ms`;
    console.log(`history after 5000 seed + 1: ${n} entries kept in storage`);
  });

  // 11. Assorted key sequences
  p = await fresh();
  const seqs = [
    ['decimal point', 'decimal point', 'decimal point', '5'],
    ['multiply', '5', 'equals'],
    ['toggle sign'],
    ['toggle sign', 'toggle sign', '5', 'equals'],
    ['5', 'toggle sign', 'equals'],
    ['0', '0', '0', '7', 'equals'],
    ['1', 'divide', '0', 'equals'],
    ['5', 'plus', 'minus', 'multiply', 'divide', '2', 'equals'],
    ['percent', 'percent', 'equals'],
    ['9', 'equals', 'equals', 'equals'],
    ['2', 'plus', 'equals'],
    ['1', 'divide', '0', 'equals', '5'],
    ['1', 'decimal point', '5', 'decimal point', '5'],
    ['0', 'toggle sign', 'equals'],
  ];
  for (const s of seqs) {
    await check('sequence ' + s.join(' '), p, async () => {
      await btn(p, 'all clear').click();
      await clickSeq(p, s);
      await p.waitForTimeout(80);
      const e = await expr(p), r = await result(p);
      console.log(`seq [${s.join(', ')}] -> expr ${JSON.stringify(e)} result ${JSON.stringify(r)}`);
      if (badText(e) || badText(r)) return `shows expr=${JSON.stringify(e)} result=${JSON.stringify(r)}`;
    });
  }

  // 12. Scientific mode at 320px: long results, angle toggle mid-calculation, auto-close
  p = await fresh({ width: 320, height: 700 });
  await p.getByRole('button', { name: 'Scientific' }).click();
  const sci = [
    ['170 factorial result fits', ['1', '7', '0', 'factorial', 'equals'], r => /e\+306/.test(r)],
    ['2÷3 long result fits', ['2', 'divide', '3', 'equals'], r => /0\.666/.test(r)],
    ['unclosed paren auto-closes', ['left parenthesis', '2', 'plus', '3', 'equals'], r => /^5$/.test(r.trim())],
    ['tan 90 is a domain error', ['tangent', '9', '0', 'equals'], r => !/^\d/.test(r.trim())],
  ];
  for (const [name, keys, ok] of sci) {
    await check('320 scientific: ' + name, p, async () => {
      await btn(p, 'all clear').click();
      for (const k of keys) await btn(p, k).click();
      await p.waitForTimeout(80);
      const r = await result(p);
      const m = await p.evaluate(() => { const o = document.querySelector('[data-testid=result]'); return { sw: document.documentElement.scrollWidth, ow: o.scrollWidth, cw: o.clientWidth }; });
      console.log(`320 sci ${name}: result ${JSON.stringify(r)} page sw=${m.sw} output ${m.ow}/${m.cw}`);
      const probs = [];
      if (!ok(r)) probs.push(`unexpected result ${JSON.stringify(r)}`);
      if (m.sw > 320) probs.push(`page scrolls horizontally (${m.sw}px)`);
      if (m.ow > m.cw + 2) probs.push(`result text clipped/overflowing its box (${m.ow} > ${m.cw})`);
      const rb = await p.getByTestId('result').boundingBox();
      const vis = await p.evaluate(() => { const o = document.querySelector('[data-testid=result]'); const r = document.createRange(); r.selectNodeContents(o); const b = r.getBoundingClientRect(); let a = o.parentElement; while (a && getComputedStyle(a).overflow === 'visible') a = a.parentElement; const c = a ? a.getBoundingClientRect() : { left: 0, right: innerWidth }; return { textL: b.left, textR: b.right, clipL: c.left, clipR: c.right }; });
      if (vis.textL < vis.clipL - 1 || vis.textR > vis.clipR + 1) probs.push(`result text extends beyond its clipping container (text ${Math.round(vis.textL)}..${Math.round(vis.textR)}px, container ${Math.round(vis.clipL)}..${Math.round(vis.clipR)}px) - digits are cut off`);
      return probs.join('; ');
    });
  }
  await check('angle toggle mid-calculation re-evaluates preview', p, async () => {
    await btn(p, 'all clear').click();
    await btn(p, 'sine').click();
    await clickSeq(p, ['3', '0']);
    const degPrev = await result(p);
    await btn(p, 'radians').click();
    await p.waitForTimeout(80);
    const radPrev = await result(p);
    console.log(`sin(30 preview deg=${JSON.stringify(degPrev)} rad=${JSON.stringify(radPrev)}`);
    if (degPrev === radPrev) return `preview did not change when switching DEG->RAD mid-expression (${JSON.stringify(degPrev)})`;
  });

  await browser.close();
  console.log(`\nE2E EXPLORATORY: ${passed} checks passed, ${findings.length} findings`);
  for (const f of findings) console.log(`- ${f.name}: ${f.problem}\n  screenshot: ${f.screenshot}`);
  fs.writeFileSync(__dirname + '/bugs/findings.json', JSON.stringify(findings, null, 2));
})();
