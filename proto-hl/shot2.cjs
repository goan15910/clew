// node shot2.cjs <html> <png> <w> <h> <scale> [js] [hoverSelector] [clip-selector]
const { chromium } = require('playwright');
(async () => {
  const [,, url, out, w, h, scale, js, hover, clipSel] = process.argv;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +scale });
  await p.goto('file://' + require('path').resolve(url));
  await p.waitForTimeout(300);
  if (js) await p.evaluate(js);
  if (hover) { const el = p.locator(hover).first(); await el.scrollIntoViewIfNeeded(); await el.hover(); }
  await p.waitForTimeout(700);
  if (clipSel) { await p.locator(clipSel).first().screenshot({ path: out }); }
  else await p.screenshot({ path: out });
  await b.close();
})();
