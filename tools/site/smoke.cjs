// Smoke test for the site (docs/): every example x device x view in Chromium and Firefox. Fails on a crashed tab, a page error,
// a console error from the site, or a frame whose script did not finish drawing or left a part (digits, dial, bars) empty.
// Usage: node tools/site/smoke.cjs [url] [--only=chromium|firefox] [--quick]
// Needs Playwright (not a dependency of this repo): PLAYWRIGHT=/path/to/node_modules/playwright, FIREFOX_EXE=/path/to/firefox.
// Without a url it serves docs/ itself. The frame, framework CSS and fonts come from trmnl.com, so it needs the network.
const path = require('path');
const fs = require('fs');
const http = require('http');
const pwPath = process.env.PLAYWRIGHT || ['/home/dev/workspace/hamley-life/node_modules/playwright', 'playwright'].find((p) => { try { require.resolve(p); return true; } catch (e) { return false; } });
const pw = require(pwPath);
const exe = process.env.FIREFOX_EXE || '/home/dev/.cache/ms-playwright/firefox-1543/firefox/firefox';
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const quick = args.includes('--quick');
const docs = path.join(__dirname, '..', '..', 'docs');

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.liquid': 'text/plain; charset=utf-8' };
  const srv = http.createServer((q, r) => {
    const f = path.join(docs, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0]);
    if (!f.startsWith(docs) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' })));
}

// the drawn screen: the frame that holds .screen with data-sw-drawn; every visible [data-sw-part] must have drawn something
async function inspect(page) {
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate(() => {
        if (!document.querySelector('.screen') || !document.body) return null;
        const err = document.querySelector('[data-sw-error]');
        const drawn = !!document.querySelector('[data-sw-drawn]');
        const empty = [...document.querySelectorAll('[data-sw-part]')].filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && !e.childElementCount && !(e.textContent || '').trim()).map((e) => e.getAttribute('data-sw-part'));
        const parts = document.querySelectorAll('[data-sw-part]').length;
        return { drawn, err: !!err, empty, parts };
      });
      if (r) return r;
    } catch (e) { /* frame gone */ }
  }
  return null;
}

async function run(name, launch, base) {
  const fails = [];
  let browser = await launch();
  let page, crashed;
  const open = async () => {
    if (page) await page.close().catch(() => {});
    page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'en-US', timezoneId: 'Europe/Berlin' });
    crashed = false; page.on('crash', () => { crashed = true; });
    page.on('pageerror', (e) => fails.push(`${name} pageerror: ${e.message.slice(0, 160)}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) fails.push(`${name} console.error: ${m.text().slice(0, 160)}`); });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('#chips button', { timeout: 15000 });
  };
  await open();
  const ids = await page.$$eval('#chips button', (b) => b.map((x) => x.dataset.id));
  const list = quick ? ids.filter((i) => i === 'live' || i === 'sensor2') : ids;
  let n = 0;
  for (const id of list) {
    for (const device of ['og', 'x']) {
      for (const view of ['full', 'half_horizontal', 'half_vertical', 'quadrant']) {
        n++;
        const tag = `${name} ${id}/${device}/${view}`;
        try {
          if (crashed) await open();
          await page.click(`#chips [data-id="${id}"]`);
          await page.click(`#device [data-v="${device}"]`);
          await page.selectOption('#view', view);
          await page.waitForTimeout(500);
          let r = null;
          for (let t = 0; t < 30 && !crashed; t++) { r = await inspect(page); if (r && r.drawn) break; await page.waitForTimeout(400); }
          if (crashed) { fails.push(`${tag}: the tab crashed`); continue; }
          if (!r || !r.drawn) { fails.push(`${tag}: the page script did not finish drawing`); continue; }
          await page.waitForTimeout(2300);   // the script redraws at 0.2, 0.8 and 2 s; a crash after the first draw shows here
          if (crashed) { fails.push(`${tag}: the tab crashed after drawing`); continue; }
          r = await inspect(page);
          if (!r || r.err) fails.push(`${tag}: the plugin showed an error`);
          else if (r.empty.length) fails.push(`${tag}: empty parts ${r.empty.join(',')}`);
        } catch (e) { fails.push(`${tag}: ${crashed ? 'the tab crashed' : e.message.slice(0, 120)}`); }
      }
    }
  }
  await browser.close().catch(() => {});
  console.log(`${name}: ${n} screens, ${fails.length} problems`);
  return fails;
}

(async () => {
  const s = args.find((a) => /^https?:/.test(a)) ? null : await serve();
  const base = s ? s.url : args.find((a) => /^https?:/.test(a));
  let all = [];
  if (only !== 'firefox') all = all.concat(await run('chromium', () => pw.chromium.launch(), base));
  if (only !== 'chromium') all = all.concat(await run('firefox', () => pw.firefox.launch({ executablePath: exe }), base));
  if (s) s.srv.close();
  all.forEach((f) => console.log('FAIL ' + f));
  process.exit(all.length ? 1 : 0);
})();
