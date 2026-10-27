// Round 2: discover history/label/show-more UI.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(process.env.URL || 'http://localhost:4599/'); await p.waitForSelector('[data-testid=result]');
  for (let i = 0; i < 25; i++) { for (const k of String(i)) await p.keyboard.press(k); await p.keyboard.press('+'); await p.keyboard.press('1'); await p.keyboard.press('Enter'); }
  const dump = async () => console.log(JSON.stringify(await p.$$eval('aside button, aside input, aside [role], [data-testid*=history] *[aria-label], section button', els => els.map(e => `${e.tagName}|${e.getAttribute('aria-label') || ''}|${e.textContent.trim().slice(0, 25)}|${e.getAttribute('data-testid') || ''}`))));
  await dump();
  await p.screenshot({ path: __dirname + '/round2-history.png', fullPage: true });
  await b.close();
})();
