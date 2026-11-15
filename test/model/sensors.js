// B22: indoor sources other than a TRMNL sensor. Each provider has a mocked answer copied from its documentation (URL in the
// comment); the run is the real T.run with a fake fetch. Called from run.js with its helpers.
'use strict';
const NOW = Date.UTC(2026, 10, 8, 5, 10) / 1000;
const iso = (ago) => new Date((NOW - ago) * 1000).toISOString();
const TOKEN = 'SECRET-TOKEN-4711';

module.exports = async function sensorSourceTests({ T, fx, check, eq, ok }) {
  const of = global.fetch;
  let calls = [];
  // a fake fetch: Open-Meteo answers from the fixture, everything else from `route(url, opts)` -> {status, body} | 'hang' | 'timeout' | 'text'
  const fake = (route) => (url, opts) => {
    calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
    if (/open-meteo/.test(url)) return Promise.resolve({ ok: true, status: 200, json: async () => (url.includes('air-quality') ? {} : fx('mixed')) });
    const r = route(String(url), opts || {});
    if (r === 'hang') return new Promise(() => {});
    if (r === 'timeout') return Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    if (r === 'text') return Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });
  };
  const run = (values, state) => T.run({ trmnl: { user: { locale: 'en' }, state: state, system: { timestamp_utc: NOW }, plugin_settings: { custom_fields_values: values } } });
  const logs = [];
  const ol = [console.log, console.error, console.warn, console.info];
  const spy = () => { ['log', 'error', 'warn', 'info'].forEach((k) => { console[k] = (...a) => logs.push(a.join(' ')); }); };
  const unspy = () => { console.log = ol[0]; console.error = ol[1]; console.warn = ol[2]; console.info = ol[3]; };
  const keep = setInterval(() => {}, 1000);   // AbortSignal.timeout does not hold the Node loop
  try {
    // ---- one case per provider: the documented answer gives the normalised reading ----
    const HA = { sensor_source: 'ha', sensor_ha_url: 'https://ha.example.com/', sensor_ha_token: TOKEN, sensor_ha_temp: 'sensor.t', sensor_ha_hum: 'sensor.h', sensor_ha_co2: 'sensor.c' };
    const haRoute = (over) => (url, o) => {
      const id = url.split('/api/states/')[1];
      const st = { 'sensor.t': { state: '19.6', attributes: { unit_of_measurement: '°C', device_class: 'temperature' } }, 'sensor.h': { state: '48', attributes: { unit_of_measurement: '%' } }, 'sensor.c': { state: '612', attributes: { unit_of_measurement: 'ppm' } } }[id];
      return over && over[id] ? over[id] : { status: 200, body: Object.assign({ entity_id: id, last_changed: iso(9000), last_updated: iso(9000), last_reported: iso(60), context: {} }, st) };
    };
    await check('B22 Home Assistant (GET /api/states/<entity_id>, Bearer token): temperature, humidity and CO2 normalised; last_reported is the time', async () => {
      calls = []; global.fetch = fake(haRoute());
      const r = await run(HA);
      eq(r.ph.sx, { t: 19.6, h: 48, c: 612 });
      eq(r.sensor, { src: 'ha', ok: true, err: null, kept: false });
      eq(r.trmnl_state.sx, { t: 19.6, h: 48, c: 612, at: NOW - 60 }, 'saved for the next run');
      const ha = calls.filter((c) => /ha\.example\.com/.test(c.url));
      eq(ha.map((c) => c.url).sort(), ['https://ha.example.com/api/states/sensor.c', 'https://ha.example.com/api/states/sensor.h', 'https://ha.example.com/api/states/sensor.t']);
      ok(ha.every((c) => c.headers.Authorization === 'Bearer ' + TOKEN), 'Bearer header');
      ok(!r.ui.stale, 'no status when all is well');
      eq(r.ph.id, '', 'the provider replaces the TRMNL device id');
    });
    await check('B22 Home Assistant: Fahrenheit entity converted; unavailable humidity and a missing CO2 entity give null, not a failure', async () => {
      global.fetch = fake(haRoute({ 'sensor.t': { status: 200, body: { state: '68.0', attributes: { unit_of_measurement: '°F' }, last_reported: iso(10) } }, 'sensor.h': { status: 200, body: { state: 'unavailable', attributes: {} } } }));
      const r = await run(Object.assign({}, HA, { sensor_ha_co2: '' }));
      eq(r.ph.sx, { t: 20, h: null, c: null });
    });
    await check('B22 Awair (GET .../devices/{type}/{id}/air-data/latest?fahrenheit=false, Bearer): comp temp, humid, co2', async () => {
      calls = []; global.fetch = fake((url) => /air-data\/latest/.test(url)
        ? { status: 200, body: { data: [{ timestamp: iso(100), score: 90, sensors: [{ comp: 'temp', value: 24.499999618530273 }, { comp: 'humid', value: 49.999999618530273 }, { comp: 'co2', value: 419 }, { comp: 'voc', value: 399 }, { comp: 'pm25', value: 5 }], indices: [] }] } }
        : { status: 200, body: { devices: [{ name: 'My Awair v2', deviceType: 'awair-r2', deviceId: 7, deviceUUID: 'awair-r2_7' }] } });
      const r = await run({ sensor_source: 'awair', sensor_awair_token: TOKEN });
      eq(r.ph.sx, { t: 24.5, h: 50, c: 419 });
      const urls = calls.map((c) => c.url).filter((u) => /awair/.test(u));
      eq(urls, ['https://developer-apis.awair.is/v1/users/self/devices', 'https://developer-apis.awair.is/v1/users/self/devices/awair-r2/7/air-data/latest?fahrenheit=false'], 'no type/id: the first device of the list');
      ok(calls.filter((c) => /awair/.test(c.url)).every((c) => c.headers.Authorization === 'Bearer ' + TOKEN));
      calls = []; await run({ sensor_source: 'awair', sensor_awair_token: TOKEN, sensor_awair_type: 'awair-element', sensor_awair_id: '12' });
      eq(calls.map((c) => c.url).filter((u) => /awair/.test(u)), ['https://developer-apis.awair.is/v1/users/self/devices/awair-element/12/air-data/latest?fahrenheit=false'], 'type and id given: one request');
    });
    await check('B22 Awair: an empty data list (device silent for 10 minutes) is an offline sensor, weather intact', async () => {
      global.fetch = fake(() => ({ status: 200, body: { data: [] } }));
      const r = await run({ sensor_source: 'awair', sensor_awair_token: TOKEN, sensor_awair_type: 'awair-r2', sensor_awair_id: '1' });
      eq([r.sensor.ok, r.sensor.err, r.ph.sx], [false, 'shape', { t: null, h: null, c: null }]);
      ok(r.model.now.temp !== null && r.ui.stale === 'SENSOR OFFLINE', 'weather there, status ' + r.ui.stale);
    });
    await check('B22 AirGradient (GET /public/api/v1/locations/{id}/measures/current?token=): atmp, rhum, rco2, timestamp', async () => {
      calls = []; global.fetch = fake(() => ({ status: 200, body: { locationId: 1, locationType: 'indoor', pm02: 4.1, atmp: 22.3, rhum: 41, rco2: 733, timestamp: iso(30) } }));
      const r = await run({ sensor_source: 'airgradient', sensor_ag_token: TOKEN, sensor_ag_location: '1' });
      eq(r.ph.sx, { t: 22.3, h: 41, c: 733 });
      eq(calls.map((c) => c.url).filter((u) => /airgradient/.test(u)), ['https://api.airgradient.com/public/api/v1/locations/1/measures/current?token=' + TOKEN]);
      global.fetch = fake(() => ({ status: 200, body: [{ locationType: 'outdoor', atmp: 5, rhum: 90 }, { locationType: 'indoor', atmp: 21, rhum: 40, rco2: 600, timestamp: iso(5) }] }));
      eq((await run({ sensor_source: 'airgradient', sensor_ag_token: TOKEN })).ph.sx, { t: 21, h: 40, c: 600 }, 'no id: the first indoor location of the place');
    });
    await check('B22 Sensibo (GET /pods/{id}?fields=measurements&apiKey=): measurements temperature, humidity, time', async () => {
      calls = []; global.fetch = fake(() => ({ status: 200, body: { status: 'success', result: { measurements: { temperature: 23.4, humidity: 55.2, time: iso(20) } } } }));
      const r = await run({ sensor_source: 'sensibo', sensor_sb_key: TOKEN, sensor_sb_id: 'AbCd1234' });
      eq(r.ph.sx, { t: 23.4, h: 55, c: null });
      eq(calls.map((c) => c.url).filter((u) => /sensibo/.test(u)), ['https://home.sensibo.com/api/v2/pods/AbCd1234?fields=measurements&apiKey=' + TOKEN]);
      global.fetch = fake(() => ({ status: 200, body: { result: [{ id: 'x' }, { id: 'y', measurements: { temperature: 20, humidity: 40, time: iso(5) } }] } }));
      eq((await run({ sensor_source: 'sensibo', sensor_sb_key: TOKEN })).ph.sx, { t: 20, h: 40, c: null }, 'no id: the first device with a measurement');
    });
    await check('B22 Ecowitt (GET /api/v3/device/real_time, call_back=all, temp_unitid=1): indoor.temperature, indoor.humidity, indoor_co2.co2 as strings', async () => {
      calls = []; const t = String(NOW - 40);
      global.fetch = fake(() => ({ status: 200, body: { code: 0, msg: 'success', time: String(NOW), data: { outdoor: { temperature: { time: t, unit: 'ºC', value: '3.1' } }, indoor: { temperature: { time: t, unit: 'ºC', value: '21.4' }, humidity: { time: t, unit: '%', value: '47' } }, indoor_co2: { co2: { time: t, unit: 'ppm', value: '655' } } } } }));
      const r = await run({ sensor_source: 'ecowitt', sensor_ew_app: 'APP' + TOKEN, sensor_ew_key: 'KEY' + TOKEN, sensor_ew_mac: 'ff:ee:dd:cc:bb:aa' });
      eq(r.ph.sx, { t: 21.4, h: 47, c: 655 });
      const u = calls.map((c) => c.url).filter((x) => /ecowitt/.test(x))[0];
      ok(u.startsWith('https://api.ecowitt.net/api/v3/device/real_time?') && /temp_unitid=1/.test(u) && /mac=FF%3AEE%3ADD%3ACC%3ABB%3AAA/.test(u), 'request ' + u.replace(TOKEN, '*'));
      global.fetch = fake(() => ({ status: 200, body: { code: 40010, msg: 'Invalid application Key', time: '1', data: [] } }));
      eq((await run({ sensor_source: 'ecowitt', sensor_ew_app: 'a', sensor_ew_key: 'b', sensor_ew_mac: 'FF:EE:DD:CC:BB:AA' })).sensor.err, 'shape', 'an error code in the body is a failure');
    });
    await check('B22 Adafruit IO (GET /api/v2/{user}/feeds/{key}/data/last, X-AIO-Key): value is a string, created_epoch the time; Fahrenheit converted', async () => {
      calls = []; global.fetch = fake((url) => ({ status: 200, body: { id: '1', value: url.includes('/temp/') ? '68.9' : url.includes('/hum/') ? '44' : '900', feed_id: 1, created_at: iso(50), created_epoch: NOW - 50 } }));
      const r = await run({ sensor_source: 'adafruit', sensor_ada_user: 'jane', sensor_ada_key: TOKEN, sensor_ada_temp: 'temp', sensor_ada_hum: 'hum', sensor_ada_co2: 'co2', sensor_temp_unit: 'fahrenheit' });
      eq(r.ph.sx, { t: 20.5, h: 44, c: 900 });
      const ad = calls.filter((c) => /adafruit/.test(c.url));
      eq(ad.map((c) => c.url).sort(), ['https://io.adafruit.com/api/v2/jane/feeds/co2/data/last', 'https://io.adafruit.com/api/v2/jane/feeds/hum/data/last', 'https://io.adafruit.com/api/v2/jane/feeds/temp/data/last']);
      ok(ad.every((c) => c.headers['X-AIO-Key'] === TOKEN));
    });
    await check('B22 custom link: dot paths (lists by index), header name + token, Fahrenheit, optional time path', async () => {
      calls = []; global.fetch = fake(() => ({ status: 200, body: { data: { rooms: [{ t: '70.7', h: '38.4' }], co2: 701, at: NOW - 15 } } }));
      const v = { sensor_source: 'custom', sensor_cu_url: 'https://example.com/api/room.json?x=1', sensor_cu_header: 'X-Api-Key', sensor_cu_token: TOKEN, sensor_cu_temp: 'data.rooms.0.t', sensor_cu_hum: 'data.rooms.0.h', sensor_cu_co2: 'data.co2', sensor_cu_time: 'data.at', sensor_temp_unit: 'fahrenheit' };
      const r = await run(v);
      eq(r.ph.sx, { t: 21.5, h: 38, c: 701 });
      eq(calls.filter((c) => /example\.com/.test(c.url)).map((c) => [c.url, c.headers['X-Api-Key']]), [['https://example.com/api/room.json?x=1', TOKEN]]);
      calls = []; await run(Object.assign({}, v, { sensor_cu_header: '' }));
      eq(calls.filter((c) => /example\.com/.test(c.url))[0].headers.Authorization, 'Bearer ' + TOKEN, 'a token without a header name is a Bearer token');
      eq((await run(Object.assign({}, v, { sensor_cu_temp: 'data.nothing' }))).sensor.err, 'shape', 'a path that finds nothing is a failure');
    });

    // ---- failures: the weather stays, the reading is the last good one (with its age) or none ----
    const failures = { timeout: ['timeout', 'timeout'], 'HTTP 401': [{ status: 401, body: { message: 'Unauthorized' } }, 'http401'], 'HTTP 500': [{ status: 500, body: {} }, 'http500'], 'bad JSON': ['text', 'json'] };
    for (const name of Object.keys(failures)) {
      await check('B22 ' + name + ': weather intact, no reading, status "SENSOR OFFLINE"; with a good reading 20 min old: kept with its time', async () => {
        global.fetch = fake(() => failures[name][0]);
        const bad = await run(HA);
        eq([bad.sensor.ok, bad.sensor.err, bad.sensor.kept], [false, failures[name][1], false]);
        ok(bad.ui.ok === true && bad.model.now.temp !== null && bad.ph && bad.weather && !bad.weather.error, 'weather intact');
        eq(bad.ph.sx, { t: null, h: null, c: null }, 'no reading: the markup shows no indoor (and does not fall back to sensor_readings)');
        eq(bad.ui.stale, 'SENSOR OFFLINE');
        const saved = { v: 1, sx: { t: 19.6, h: 48, c: 612, at: NOW - 1200 } };
        const kept = await run(HA, saved);
        eq(kept.ph.sx, { t: 19.6, h: 48, c: 612 });
        ok(kept.sensor.kept && /^SENSOR OFFLINE · as of \d\d:\d\d$/.test(kept.ui.stale), 'status with the time of the reading: ' + kept.ui.stale);
        eq(kept.trmnl_state.sx, saved.sx, 'the good reading is written back as it was, not renewed');
        const old = await run(HA, { v: 1, sx: { t: 19.6, h: 48, c: 612, at: NOW - 3 * 3600 - 60 } });
        eq([old.ph.sx.t, old.ui.stale, old.trmnl_state.sx], [null, 'SENSOR OFFLINE', undefined], 'older than 3 h is no reading');
      });
    }
    await check('B22 a reading the source marks older than 3 h, a temperature out of range, a bad setup: all offline', async () => {
      global.fetch = fake(haRoute({ 'sensor.t': { status: 200, body: { state: '19', attributes: { unit_of_measurement: '°C' }, last_reported: iso(3 * 3600 + 5) } } }));
      eq((await run(HA)).sensor.err, 'old');
      global.fetch = fake(haRoute({ 'sensor.t': { status: 200, body: { state: '450', attributes: {} } } }));
      eq((await run(HA)).sensor.err, 'range');
      calls = []; global.fetch = fake(haRoute());
      for (const url of ['http://ha.example.com', 'https://localhost:8123', 'https://192.168.1.5', 'https://user:pw@ha.example.com', 'ftp://x', '']) eq((await run(Object.assign({}, HA, { sensor_ha_url: url }))).sensor.err, 'setup', 'address ' + url);
      eq((await run(Object.assign({}, HA, { sensor_ha_temp: 'not an entity' }))).sensor.err, 'setup');
      eq((await run(Object.assign({}, HA, { sensor_ha_token: '' }))).sensor.err, 'setup');
      eq(calls.filter((c) => !/open-meteo/.test(c.url)).length, 0, 'a refused setup makes no request');
    });
    await check('B22 the forecast status wins over the sensor status; a failing source never changes the forecast', async () => {
      global.fetch = fake(() => 'timeout');
      const base = await run({});
      const bad = await run(HA);
      eq(bad.weather, base.weather); eq(bad.model.now, base.model.now);
      eq(bad.ui.meters, base.ui.meters, 'same meters');
    });
    await check('B22 no provider chosen (or a TRMNL source): no request to any source, no sx, existing behaviour', async () => {
      calls = []; global.fetch = fake(() => 'timeout');
      for (const v of [{}, { sensor_source: 'own' }, { sensor_source: 'other', sensor_device_id: '2' }, { sensor_source: 'nonsense' }, { sensor_source: 'ha', sensor_show: 'hide', sensor_co2: 'hide' }]) {
        const r = await run(v);
        eq([r.sensor, r.ph ? r.ph.sx : 'noph', r.trmnl_state.sx], [null, v.sensor_show ? 'noph' : undefined, undefined]);
      }
      eq(calls.filter((c) => !/open-meteo/.test(c.url)).length, 0);
      eq((await run({ sensor_source: 'other', sensor_device_id: '2' })).ph.id, '2');
      eq((await run({ sensor_device_id: '2' })).ph.id, '2', 'a device number saved before the source setting existed still works');
    });

    // ---- the secret never leaves ----
    await check('B22 no token in any output, state or log line, success or failure', async () => {
      logs.length = 0; spy();
      try {
        for (const route of [haRoute(), () => ({ status: 401, body: { message: 'bad token ' } }), () => 'timeout', () => 'text']) {
          global.fetch = fake(route);
          for (const v of [HA, { sensor_source: 'airgradient', sensor_ag_token: TOKEN }, { sensor_source: 'sensibo', sensor_sb_key: TOKEN }, { sensor_source: 'custom', sensor_cu_url: 'https://example.com/x?key=' + TOKEN, sensor_cu_token: TOKEN, sensor_cu_temp: 'a' }]) {
            const r = await run(v, { v: 1 });
            ok(!JSON.stringify(r).includes(TOKEN), 'token in the output of ' + v.sensor_source);
          }
        }
      } finally { unspy(); }
      eq(logs.filter((l) => l.includes(TOKEN)), [], 'no log line holds the token');
      ok(!/console\./.test(require('fs').readFileSync(require('path').join(__dirname, '../../plugin/src/transform.js'), 'utf8').split('// ==== SENSOR_BEGIN ====')[1].split('// ==== SENSOR_END ====')[0]), 'the sensor code has no console call at all');
    });

    // ---- the run budget ----
    await check('B22 a source that never answers (deaf to its abort signal) ends inside the run budget and the weather is there', async () => {
      global.fetch = fake(() => 'hang');
      for (const v of [HA, { sensor_source: 'awair', sensor_awair_token: TOKEN }, { sensor_source: 'adafruit', sensor_ada_user: 'u', sensor_ada_key: 'k', sensor_ada_temp: 't' }]) {
        const t0 = Date.now(), r = await run(v);
        const ms = Date.now() - t0;
        ok(ms < 3200, v.sensor_source + ' ran ' + ms + ' ms (TRMNL stops at 5000 incl. VM start)');
        ok(r.ui.ok && r.model.now.temp !== null && r.sensor.err === 'timeout', 'weather there, sensor ' + r.sensor.err);
      }
    });
    await check('B22 a source and a forecast that both hang: still under the budget', async () => {
      global.fetch = () => new Promise(() => {});
      const t0 = Date.now(), r = await run(HA);
      ok(Date.now() - t0 < 3200, 'ran ' + (Date.now() - t0) + ' ms');
      ok(r && typeof r === 'object' && r.sensor && r.sensor.ok === false);
    });
    await check('B22 the source is read in parallel with the forecast (a slow forecast does not delay the sensor start)', async () => {
      const order = [];
      global.fetch = (url) => { order.push(/open-meteo/.test(url) ? 'om' : 'src'); return /open-meteo/.test(url) ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200, json: async () => ({ state: '20', attributes: {}, last_reported: iso(1) }) }); };
      await run(Object.assign({}, HA, { sensor_ha_hum: '', sensor_ha_co2: '' }));
      ok(order.includes('src') && order.indexOf('src') < 3, 'the source request starts with the forecast requests: ' + order.join());
    });
  } finally { global.fetch = of; clearInterval(keep); unspy(); }
};
