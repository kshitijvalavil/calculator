// Round 2: contrast of the label input placeholder (::placeholder, 50% alpha) in both themes.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4599/';
(async () => {
  const b = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const p = await b.newPage({ colorScheme: scheme }); await p.goto(URL); await p.waitForSelector('[data-testid=result]');
    const t = await p.getByTestId('theme-toggle').getAttribute('aria-label');
    if ((scheme === 'dark') === /dark/i.test(t)) await p.getByTestId('theme-toggle').click();
    for (const k of ['7', 'Enter']) await p.keyboard.press(k);
    await p.getByRole('button', { name: /^Add label to 7/ }).first().click(); await p.waitForTimeout(200);
    const r = await p.evaluate(() => {
      const toRGBA = c => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d'); x.clearRect(0, 0, 1, 1); x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; };
      const inp = document.querySelector('input[aria-label^="Label for"]');
      let n = inp, bg; while (n) { const c = toRGBA(getComputedStyle(n).backgroundColor); if (c[3] === 255) { bg = c; break; } n = n.parentElement; }
      const ph = getComputedStyle(inp, '::placeholder').color;
      const raw = toRGBA(ph); // canvas un-premultiplies; blend manually with alpha
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d');
      x.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`; x.fillRect(0, 0, 1, 1); x.fillStyle = ph; x.fillRect(0, 0, 1, 1);
      const fg = [...x.getImageData(0, 0, 1, 1).data];
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const L1 = lum(fg), L2 = lum(bg);
      return { ph, bg: bg.slice(0, 3), fg: fg.slice(0, 3), ratio: ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2), size: getComputedStyle(inp).fontSize };
    });
    console.log(scheme, JSON.stringify(r));
    await p.close();
  }
  await b.close();
})();
