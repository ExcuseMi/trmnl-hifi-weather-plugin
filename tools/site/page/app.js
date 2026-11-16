(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var CITIES = {
    us: [['New York', 40.71, -74.01], ['Chicago', 41.88, -87.63], ['Denver', 39.74, -104.99], ['Los Angeles', 34.05, -118.24]],
    world: [['London', 51.51, -0.13], ['Berlin', 52.52, 13.41], ['Paris', 48.86, 2.35], ['Madrid', 40.42, -3.7], ['Amsterdam', 52.37, 4.9], ['Tokyo', 35.68, 139.69]]
  };
  var LANGS = ['en', 'de', 'fr', 'es', 'nl', 'ja'];
  var DEMO_SENSOR = { own: { device: 1, temperature: 21.4, humidity: 46, carbon_dioxide: 1180 }, other: { device: 2, temperature: 19.6, humidity: 52, carbon_dioxide: 640 } };

  // ---- the visitor
  function visitor() {
    var lang = (navigator.language || 'en-US'), tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no time zone */ }
    var base = lang.slice(0, 2).toLowerCase();
    var us = lang === 'en-US' || /^(America\/(New_York|Detroit|Toronto|Chicago|Denver|Phoenix|Boise|Los_Angeles|Vancouver|Anchorage|Juneau)|Pacific\/Honolulu|US\/)/.test(tz);
    var city;
    if (us) city = /Chicago|Mexico|Winnipeg|Central/.test(tz) ? 'Chicago' : /Denver|Phoenix|Boise|Mountain/.test(tz) ? 'Denver' : /Los_Angeles|Vancouver|Anchorage|Honolulu|Pacific/.test(tz) ? 'Los Angeles' : 'New York';
    else city = { de: 'Berlin', fr: 'Paris', es: 'Madrid', nl: 'Amsterdam', ja: 'Tokyo', en: 'London' }[base] || (/^Asia\//.test(tz) ? 'Tokyo' : /^Europe\//.test(tz) ? 'Berlin' : 'London');
    return { us: us, city: city, language: LANGS.indexOf(base) >= 0 ? base : 'en' };
  }
  var V = visitor();
  var allCities = CITIES.us.concat(CITIES.world);
  var cityOf = function (n) { return allCities.filter(function (c) { return c[0] === n; })[0]; };
  var isUsCity = function (n) { return CITIES.us.some(function (c) { return c[0] === n; }); };

  // ---- state
  var S = {
    source: 'live', city: V.city, device: 'og', view: 'full', language: V.language, dark: false, hw: 'none',
    f: { unit: V.us ? 'fahrenheit' : 'celsius', time_format: V.us ? '12' : '24', bottom: 'auto', bottom_switch: '18', sensor_icon: 'house', hide_title_bar: 'false', week_style: 'auto', show_wear: 'true', sensor_show: 'show', sensor_label: '', sensor_primary: 'auto' }
  };
  var scenarios = [], engine = null, token = 0, lastUrl = null, timer = 0, liveCache = {};

  // ---- controls
  function seg2(id, key) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (key === 'device') S.device = b.dataset.v; else S.f[key] = b.dataset.v;
      sync(); update();
    });
  }
  function sync() {
    ['unit', 'time_format', 'sensor_show'].forEach(function (k) {
      [].forEach.call($(k).children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === S.f[k])); });
    });
    [].forEach.call($('device').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === S.device)); });
    $('view').value = S.view; $('lang').value = S.language; $('dark').checked = S.dark; $('hw').value = S.hw;
    $('bottom').value = S.f.bottom; $('bottom_switch').value = S.f.bottom_switch; $('bottom_switch').disabled = S.f.bottom !== 'auto'; $('sensor_icon').value = S.f.sensor_icon; $('hide_title_bar').checked = S.f.hide_title_bar === 'true'; $('week_style').value = S.f.week_style; $('show_wear').checked = S.f.show_wear !== 'false';
    $('sensor_label').value = S.f.sensor_label; $('sensor_primary').value = S.f.sensor_primary;
    $('loc').value = S.city; $('loc').disabled = S.source !== 'live';
    [].forEach.call($('chips').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === S.source)); });
    var sens = S.hw !== 'none';
    ['sensor_label', 'sensor_primary', 'sensor_icon'].forEach(function (k) { $(k).disabled = !sens; });
  }
  function bind(id, fn, ev) { $(id).addEventListener(ev || 'change', function () { fn($(id)); sync(); update(ev === 'input' ? 350 : 0); }); }

  function pickSource(id) {
    S.source = id;
    if (id === 'live') return;
    var sc = scenarios.filter(function (s) { return s.id === id; })[0];
    var us = sc.us;
    S.f.unit = us ? 'fahrenheit' : 'celsius'; S.f.time_format = us ? '12' : '24';
    var st = sc.settings || {};
    S.hw = sc.sensor ? (sc.sensor.device === 1 ? 'own' : 'other') : 'none';
    S.f.sensor_label = st.sensor_label || ''; S.f.sensor_primary = st.sensor_primary || 'auto';
  }

  function build() {
    var chips = $('chips');
    var mk = function (id, text) { var b = document.createElement('button'); b.type = 'button'; b.dataset.id = id; b.textContent = text; b.addEventListener('click', function () { pickSource(id); sync(); update(); }); chips.appendChild(b); };
    mk('live', 'Live weather');
    scenarios.forEach(function (s) { mk(s.id, s.title.replace(/^With a /, '').replace(/^Sensor from another TRMNL, with a label$/, 'Other TRMNL sensor')); });
    var loc = $('loc');
    [['In the US', CITIES.us], ['Elsewhere', CITIES.world]].forEach(function (g) {
      var og = document.createElement('optgroup'); og.label = g[0];
      g[1].forEach(function (c) { var o = document.createElement('option'); o.value = c[0]; o.textContent = c[0]; og.appendChild(o); });
      loc.appendChild(og);
    });
    seg2('device', 'device'); seg2('unit', 'unit'); seg2('time_format', 'time_format'); seg2('sensor_show', 'sensor_show');
    bind('loc', function (e) { S.city = e.value; S.f.unit = isUsCity(S.city) ? 'fahrenheit' : 'celsius'; S.f.time_format = isUsCity(S.city) ? '12' : '24'; });
    bind('view', function (e) { S.view = e.value; });
    bind('lang', function (e) { S.language = e.value; });
    bind('dark', function (e) { S.dark = e.checked; });
    bind('bottom', function (e) { S.f.bottom = e.value; });
    bind('bottom_switch', function (e) { S.f.bottom_switch = e.value; });
    bind('sensor_icon', function (e) { S.f.sensor_icon = e.value; });
    bind('hide_title_bar', function (e) { S.f.hide_title_bar = e.checked ? 'true' : 'false'; });
    bind('week_style', function (e) { S.f.week_style = e.value; });
    bind('show_wear', function (e) { S.f.show_wear = e.checked ? 'true' : 'false'; });
    bind('hw', function (e) { S.hw = e.value; });
    bind('sensor_primary', function (e) { S.f.sensor_primary = e.value; });
    bind('sensor_label', function (e) { S.f.sensor_label = e.value; }, 'input');
  }

  // ---- segment digits for the shown clock
  var SEGS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  var SEGP = { a: [2, 0, 8, 2], b: [10, 2, 2, 8], c: [10, 12, 2, 8], d: [2, 20, 8, 2], e: [0, 12, 2, 8], f: [0, 2, 2, 8], g: [2, 10, 8, 2] };
  function seg(text) {
    var x = 0, out = '';
    String(text).split('').forEach(function (ch) {
      if (ch === ':') { out += '<rect x="' + (x + 2) + '" y="6" width="2.4" height="2.4"/><rect x="' + (x + 2) + '" y="15.6" width="2.4" height="2.4"/>'; x += 7; return; }
      if (!SEGS[ch]) { x += 6; return; }
      SEGS[ch].split('').forEach(function (s) { var p = SEGP[s]; out += '<rect x="' + (x + p[0]) + '" y="' + p[1] + '" width="' + p[2] + '" height="' + p[3] + '" rx=".8"/>'; });
      x += 14;
    });
    return '<svg viewBox="0 0 ' + x + ' 22" height="26" width="' + Math.round(x * 26 / 22) + '" fill="currentColor">' + out + '</svg>';
  }

  // ---- render
  function liveFetch(url) {   // one answer per URL for five minutes: view, dark and language changes do not ask Open-Meteo again
    var hit = liveCache[url];
    if (!hit || Date.now() - hit.at > 300000) {
      hit = liveCache[url] = { at: Date.now(), p: fetch(url).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, status: r.status, json: function () { return Promise.resolve(body); } }; }); }) };
      hit.p.catch(function () { delete liveCache[url]; });
    }
    return hit.p;
  }

  async function show(o, sc, note) {
    var my = ++token;
    var data = await engine.compute({ scenario: sc, device: S.device, language: S.language, settings: o.settings, sensor: o.sensor, fetch: liveFetch });
    if (data.weather && data.weather.error) throw new Error(data.weather.reason || 'no weather');
    var markup = await engine.renderView(data, S.view);
    if (my !== token) return;
    var html = engine.pageHtml(markup, { device: S.device, view: S.view, dark: S.dark, clockMs: sc ? E.scenarioNowMs(sc) : 0 });
    var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    var fr = $('frame');
    if (fr.getAttribute('model') !== S.device) {   // a new element per device: the component's own model switch leaves the X picture unscaled
      var nf = document.createElement('trmnl-frame'); nf.id = 'frame'; nf.setAttribute('model', S.device);
      fr.replaceWith(nf); fr = nf;
    }
    fr.setAttribute('color', S.dark ? 'black' : 'white');
    fr.setAttribute('src', url);
    if (lastUrl) setTimeout(function (u) { URL.revokeObjectURL(u); }.bind(null, lastUrl), 4000);
    lastUrl = url;
    $('seg').innerHTML = data.clock ? seg(data.clock) : '';
    $('look').textContent = note.look;
    $('status').textContent = note.status;
  }

  function settingsFor(lat, lon) {
    var f = S.f, s = { lat_lon: lat + ',' + lon, unit: f.unit, time_format: f.time_format, bottom: f.bottom, bottom_switch: f.bottom_switch, sensor_icon: f.sensor_icon, hide_title_bar: f.hide_title_bar, week_style: f.week_style, show_wear: f.show_wear,
      sensor_source: f.sensor_show === 'hide' ? 'none' : (S.hw === 'other' ? 'other' : 'own'), sensor_label: f.sensor_label, sensor_primary: f.sensor_primary, sensor_device_id: S.hw === 'other' ? '2' : '' };
    return s;
  }
  function sensorFor(sc) {
    if (S.hw === 'none') return null;
    if (sc && sc.sensor && ((sc.sensor.device === 1) === (S.hw === 'own'))) return sc.sensor;
    return DEMO_SENSOR[S.hw];
  }

  async function render() {
    if (!engine) return;
    var sc = S.source === 'live' ? null : scenarios.filter(function (s) { return s.id === S.source; })[0];
    try {
      if (sc) {
        await show({ settings: settingsFor(sc.lat, sc.lon), sensor: sensorFor(sc) }, sc, { look: sc.look, status: sc.title + ' · ' + sc.place + ' · fixed example data' });
      } else {
        var c = cityOf(S.city);
        await show({ settings: settingsFor(c[1], c[2]), sensor: sensorFor(null) }, null, { look: 'The real weather now in ' + S.city + ', from Open-Meteo, run through the plugin in your browser.', status: 'Live · ' + S.city + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
      }
    } catch (err) {
      if (!sc) {   // Open-Meteo unreachable: say so and fall back to a fixed day
        S.source = scenarios[0].id; pickSource(S.source); sync();
        $('status').textContent = 'Live weather could not be loaded (' + (err && err.message || err) + '). Showing an example instead.';
        var sc0 = scenarios[0];
        try { await show({ settings: settingsFor(sc0.lat, sc0.lon), sensor: sensorFor(sc0) }, sc0, { look: sc0.look, status: 'Live weather could not be loaded; showing the example "' + sc0.title + '".' }); } catch (e2) { $('status').textContent = 'Could not draw the screen: ' + e2.message; }
      } else $('status').textContent = 'Could not draw the screen: ' + (err && err.message || err);
    }
  }
  function update(delay) { clearTimeout(timer); timer = setTimeout(render, delay || 0); }

  // ---- start
  var E = window.SWEngine;
  Promise.all([
    fetch('plugin/main.liquid').then(function (r) { return r.text(); }),
    fetch('plugin/views.json').then(function (r) { return r.json(); }),
    fetch('plugin/transform.js').then(function (r) { return r.text(); }),
    fetch('data/scenarios.json').then(function (r) { return r.json(); })
  ]).then(function (r) {
    scenarios = r[3];
    engine = E.create({ Liquid: window.liquidjs.Liquid, plugin: { main: r[0], views: r[1], transform: r[2] } });
    build(); sync();
    var go = function () { update(); };
    if (window.customElements && customElements.get('trmnl-frame')) go(); else customElements.whenDefined('trmnl-frame').then(go);
  }).catch(function (e) { $('status').textContent = 'The page could not load its files: ' + e.message; });
})();
