// Captures the four guide screens (tools/site/page/guide/g1-g4.png) from the built try-it site (docs/) and prints each numbered badge's
// position (percent of the picture) from the drawn parts, so the page's badges can be set again after a layout change.
// Usage: node tools/site/capture_guide.cjs [outdir]   (default tools/site/page/guide). Needs Playwright like smoke.cjs and the network.
const path = require('path');
const fs = require('fs');
const http = require('http');
const pwPath = process.env.PLAYWRIGHT || ['/home/dev/workspace/hamley-life/node_modules/playwright', 'playwright'].find((p) => { try { require.resolve(p); return true; } catch (e) { return false; } });
const pw = require(pwPath);
const docs = path.join(__dirname, '..', '..', 'docs');
const out = process.argv[2] || path.join(__dirname, 'page', 'guide');
// picture -> scenario, device, view, settings, and for each guide id the selector of the part it points at
const PICS = {
  g1: { id: 'heat', f: { bottom: 'hours' }, parts: { baro: '[data-sw-part="baro"]', pressure: '[data-sw-part="baro"] ~ [data-sw-cap]', tdial: '[data-sw-part="tdial"]', marks: 'text[data-sw-mark]', trend: '[data-sw-part="tdial"] ~ div[data-sw-cap]', meters: '[data-sw-part^="meter"]', cells: '[data-sw-st="l"]', title: '[data-sw-cond]', digits: '[data-sw-part="temp"]', cues: '[data-sw-part="cue"]', sun: '[data-sw-suntime]', moon: '[data-sw-part="moon"]', hours: '[data-sw-part="hbar"]', footer: '.title_bar' } },
  g2: { id: 'rain', f: { bottom: 'days' }, parts: { rain: '[data-sw-unit="rain"] img', calendar: '[data-sw-part="rain"]', gust: '[data-sw-part^="meter"] [data-sw-st="a"]' } },
  g3: { id: 'sensor', f: { bottom: 'days' }, parts: { sensor: '[data-sw-twin="in"] [data-sw-part="loc"]', outside: '[data-sw-twin="out"] [data-sw-part="cue"]', twin: '[data-sw-part="tdial"]', small: '[data-sw-twin="out"] [data-sw-part="temp"]' } },
  g4: { id: 'snow', f: { bottom: 'days', unit: 'celsius' }, parts: { days: '[data-sw-wkblocks]', today: '[data-sw-today]', range: '[data-sw-part="day"]', numbers: '[data-sw-row="day"] span.title:not([data-sw-dname])', daycues: '[data-sw-part="dcue"]' } },
};
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.liquid': 'text/plain; charset=utf-8' };
  const srv = http.createServer((q, r) => {
    const f = path.join(docs, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
    if (!f.startsWith(docs) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}
(async () => {
  const s = await serve();
  const all = {};
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'Europe/Berlin' });
  await page.goto(s.url, { waitUntil: 'load' });
  await page.waitForSelector('#chips button', { timeout: 15000 });
  for (const [g, d] of Object.entries(PICS)) {
    await page.click('#chips [data-id="' + d.id + '"]');
    await page.click('#device [data-v="x"]');
    await page.selectOption('#view', 'full');
    if (d.f.bottom) await page.selectOption('#bottom', d.f.bottom);
    if (d.f.week_style) await page.selectOption('#week_style', d.f.week_style);
    if (d.f.unit) await page.click('#unit [data-v="' + d.f.unit + '"]');
    await page.waitForTimeout(800);
    let frame = null;
    for (let t = 0; t < 40; t++) { for (const f of page.frames()) { try { if (await f.evaluate(() => !!document.querySelector('[data-sw-drawn]'))) frame = f; } catch (e) { /* gone */ } } if (frame) break; await page.waitForTimeout(400); }
    await page.waitForTimeout(2600);
    const el = await page.$('#frame');
    const box = await el.boundingBox();
    await el.screenshot({ path: path.join(out, g + '.png') });
    const fb = await (await frame.frameElement()).boundingBox();
    const pos = {};
    for (const [id, sel] of Object.entries(d.parts)) {
      const r = await frame.evaluate((q) => { const e = [].filter.call(document.querySelectorAll(q), (x) => { const b = x.getBoundingClientRect(); return b.width > 0 && (b.height > 0 || x.tagName === 'line'); })[0]; if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom, innerWidth, innerHeight]; }, sel);
      if (!r) { pos[id] = null; continue; }
      const k = fb.width / r[4];
      pos[id] = [((fb.x - box.x) + (r[0] + r[2]) / 2 * k) / box.width * 100, ((fb.y - box.y) + (r[1] + (r[3] - r[1]) * 0.35) * k) / box.height * 100].map((v) => v.toFixed(1));
    }
    console.log(g, box.width + 'x' + box.height, JSON.stringify(pos));
    all[g] = pos;
  }
  fs.writeFileSync(path.join(out, 'positions.json'), JSON.stringify(all, null, 1));
  await browser.close(); s.srv.close();
})();
