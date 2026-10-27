// Dumps the interactive surface of the app (buttons, inputs, landmarks) to learn the UI black-box.
const { chromium } = require('playwright');
(async () => {
  const url = process.env.URL || 'http://localhost:4599/';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = []; p.on('console', m => logs.push(`${m.type()}: ${m.text()}`)); p.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  await p.goto(url); await p.waitForTimeout(500);
  const items = await p.$$eval('button, input, textarea, [role], output, [aria-live], select', els => els.map(e => ({
    tag: e.tagName, role: e.getAttribute('role'), name: e.getAttribute('aria-label') || e.textContent.trim().slice(0, 30),
    id: e.id, testid: e.getAttribute('data-testid'), live: e.getAttribute('aria-live') })));
  console.log(JSON.stringify(items, null, 0));
  await p.screenshot({ path: __dirname + '/explore-initial.png', fullPage: true });
  console.log(logs.join('\n'));
  await b.close();
})();
