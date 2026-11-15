// Guard: the site's engine (transform in the page + LiquidJS) gives the same markup as trmnlp (Ruby Liquid) for the same inputs.
// Usage: node tools/site/check_fidelity.mjs prep <dir> | compare <dir>   (tools/site/check_fidelity.sh runs both around trmnlp)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const E = require('./engine.js');
const { Liquid } = require(path.join(root, 'node_modules/liquidjs'));
const [mode, dir] = process.argv.slice(2);
const scenarios = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/scenarios.json'), 'utf8'));
const shared = fs.readFileSync(path.join(root, 'plugin/src/shared.liquid'), 'utf8');
const plugin = {
  main: /\{%\s*template main\s*%\}([\s\S]*)\{%\s*endtemplate\s*%\}/.exec(shared)[1],
  views: Object.fromEntries(['full', 'half_horizontal', 'half_vertical', 'quadrant'].map((v) => [v, fs.readFileSync(path.join(root, 'plugin/src', v + '.liquid'), 'utf8')])),
  transform: fs.readFileSync(path.join(root, 'plugin/src/transform.js'), 'utf8')
};
const engine = E.create({ Liquid, plugin });
const sc = (id) => scenarios.find((s) => s.id === id);
const variants = [
  ['calm-x-full-en', 'calm', 'x', 'full', 'en', {}],
  ['calm-og-hv-de', 'calm', 'og', 'half_vertical', 'de', { bottom: 'hours' }],
  ['rain-og-full-fr', 'rain', 'og', 'full', 'fr', {}],
  ['storm-x-hh-nl', 'storm', 'x', 'half_horizontal', 'nl', { time_format: '12' }],
  ['snow-x-full-f', 'snow', 'x', 'full', 'en', { unit: 'fahrenheit', time_format: '12', bottom: 'days' }],
  ['snow-og-q-ja', 'snow', 'og', 'quadrant', 'ja', {}],
  ['heat-og-full-es', 'heat', 'og', 'full', 'es', {}],
  ['pollen-x-hv-en', 'pollen', 'x', 'half_vertical', 'en', { hide_title_bar: 'true' }],
  ['sensor-x-full-en', 'sensor', 'x', 'full', 'en', {}],
  ['sensor-og-full-en', 'sensor', 'og', 'full', 'en', {}],
  ['sensor2-x-full-en', 'sensor2', 'x', 'full', 'en', {}],
  ['sensor2-og-hv-en', 'sensor2', 'og', 'half_vertical', 'en', { sensor_primary: 'sensor' }]
];
const opts = (v) => {
  const [, id, device, , language, settings] = v, s = sc(id);
  return { scenario: s, device, language, settings: Object.assign({ lat_lon: s.lat + ',' + s.lon }, s.settings || {}, settings), sensor: s.sensor || null };
};
if (mode === 'prep') {
  fs.mkdirSync(dir, { recursive: true });
  const cases = variants.map((v) => {
    const o = opts(v), s = o.scenario, f = o.settings.unit === 'fahrenheit';
    const get = async (u) => (await E.mockFetch(s)(u)).json();
    return get('https://api.open-meteo.com/v1/forecast?' + (f ? 'temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph' : '')).then(async (answer) => ({
      name: v[0], model: E.DEVICES[v[2]].model, view: v[3], locale: E.LOCALES[v[4]], now: new Date(E.scenarioNowMs(s)).toISOString(),
      fields: Object.assign({}, E.DEFAULT_FIELDS, o.settings), answer, aq: await get('https://air-quality-api.open-meteo.com/'),
      sensor_readings: undefined, _sensor: o.sensor
    }));
  });
  Promise.all(cases).then(async (cs) => {
    for (const c of cs) {   // the sensor readings as the engine builds them
      if (c._sensor) c.sensor_readings = (await engine.compute(opts(variants.find((v) => v[0] === c.name)))).sensor_readings;
      delete c._sensor;
    }
    fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cs));
  });
} else {
  const norm = (h) => h.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  const body = (h) => { const i = h.indexOf('<div class="view'); return norm(h.slice(h.indexOf('>', h.indexOf('<div class="view')) + 1, h.lastIndexOf('</body>'))).replace(/(<\/div>)+\s*$/, ''); };
  let bad = 0;
  for (const v of variants) {
    const ruby = JSON.parse(fs.readFileSync(path.join(dir, 'out', v[0] + '.json'), 'utf8'));
    const o = opts(v), data = await engine.compute(o), mine = norm(await engine.renderView(data, v[3]));
    const theirs = body(ruby.html).replace(/^<div class="view[^>]*>/, '').replace(/^ */, '');
    const a = mine.replace(/(<\/div>)+$/, ''), b = theirs.replace(/(<\/div>)+$/, '');
    const same = a === b;
    if (o.sensor && !theirs.includes('>' + o.sensor.temperature.toFixed(1)) && !theirs.includes(String(o.sensor.temperature))) { console.log('DIFF ' + v[0] + ': the sensor reading ' + o.sensor.temperature + ' is not on the trmnlp screen (sensor markup not reached)'); bad++; continue; }
    if (!same) { let i = 0; while (a[i] === b[i]) i++; console.log('DIFF ' + v[0] + ' at ' + i + '\n  site: ' + a.slice(i - 60, i + 100) + '\n  ruby: ' + b.slice(i - 60, i + 100)); bad++; } else console.log('same ' + v[0] + ' (' + a.length + ' chars)');
  }
  process.exit(bad ? 1 : 0);
}
