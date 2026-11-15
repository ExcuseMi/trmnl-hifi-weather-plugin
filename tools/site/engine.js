// Radio Weather site engine: the plugin's own transform (plugin/src/transform.js) and markup (plugin/src/*.liquid, rendered
// with LiquidJS) run in the page. Used by docs/app.js in the browser and by tools/site/check_fidelity.mjs in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SWEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DEVICES = {
    og: { model: 'og_plus', width: 800, height: 480, bit_depth: 2, classes: 'screen--2bit screen--ogv2 screen--md' },
    x: { model: 'v2', width: 1872, height: 1404, bit_depth: 4, classes: 'screen--4bit screen--v2 screen--lg' }
  };
  var MOUNT = { full: '', half_horizontal: 'mashup mashup--1Tx1B', half_vertical: 'mashup mashup--1Lx1R', quadrant: 'mashup mashup--2x2' };
  var DEFAULT_FIELDS = { lat_lon: '52.52,13.41', unit: 'celsius', time_format: '24', bottom: 'auto', hide_title_bar: 'false',
    sensor_show: 'show', sensor_primary: 'auto', sensor_co2: 'show', days_shown: 'auto', dial_span: '24h' };
  var LOCALES = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', nl: 'nl', ja: 'ja-JP' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function utcStamp(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + ' UTC'; }

  // A scenario's local clock time as a UTC instant (milliseconds), 10 minutes past its hour.
  function scenarioNowMs(sc) { return Date.parse(sc.now + ':00Z') - sc.off * 1000 + 600000; }

  // Open-Meteo answers for a scenario, as the transform asks for them (celsius data turned into the unit in the URL).
  function mockFetch(sc) {
    var cvt = function (obj, u) {
      var o = JSON.parse(JSON.stringify(obj));
      var F = (v) => typeof v === 'number' ? Math.round((v * 9 / 5 + 32) * 10) / 10 : v, K = (v) => typeof v === 'number' ? Math.round(v * 0.621371 * 10) / 10 : v, I = (v) => typeof v === 'number' ? Math.round(v / 25.4 * 1000) / 1000 : v;
      [o.current, o.hourly, o.daily].forEach(function (sec) {
        if (!sec) return;
        Object.keys(sec).forEach(function (k) {
          var m = Array.isArray(sec[k]) ? (a, f) => a.map(f) : (a, f) => f(a);
          if (u.f && /^(temperature|apparent_temperature)/.test(k)) sec[k] = m(sec[k], F);
          if (u.mph && /^wind_(speed|gusts)/.test(k)) sec[k] = m(sec[k], K);
          if (u.inch && /^precipitation(?!_prob)/.test(k) && !/probability/.test(k)) sec[k] = m(sec[k], I);
        });
      });
      return o;
    };
    return function (url) {
      url = String(url);
      var body;
      if (url.indexOf('air-quality') >= 0) body = sc.aq;
      else body = cvt(sc.answer, { f: /temperature_unit=fahrenheit/.test(url), mph: /wind_speed_unit=mph/.test(url), inch: /precipitation_unit=inch/.test(url) });
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
    };
  }

  function frozenDate(ms) {
    var Real = Date, off = ms - Real.now();
    function FD() {
      if (!(this instanceof FD)) return new FD().toString();
      return arguments.length ? new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(arguments))))() : new Real(Real.now() + off);
    }
    FD.prototype = Real.prototype; FD.now = function () { return Real.now() + off; }; FD.parse = Real.parse; FD.UTC = Real.UTC;
    return FD;
  }

  function create(opts) {
    var Liquid = opts.Liquid, plugin = opts.plugin;   // plugin: { main, views: {full: '..'}, transform: 'source' }
    var liquid = new Liquid({
      relativeReference: false, extname: '',
      fs: { readFileSync: function () { return ''; }, existsSync: function () { return true; }, exists: function () { return Promise.resolve(true); },
        readFile: function (f) { return Promise.resolve(plugin.main); }, resolve: function (r, f) { return f; }, contains: function () { return true; }, sep: '/' }
    });
    // Where Ruby's Liquid (TRMNL) and LiquidJS differ: integer division, rounding half away from zero, first of a hash, base64_encode.
    liquid.registerFilter('divided_by', function (v, d) {
      v = Number(v); d = Number(d);
      return Number.isInteger(v) && Number.isInteger(d) && d !== 0 ? Math.floor(v / d) : v / d;
    });
    liquid.registerFilter('round', function (v, digits) {
      var f = Math.pow(10, digits || 0), x = Number(v);
      return (x < 0 ? -1 : 1) * Math.round(Math.abs(x) * f) / f;
    });
    liquid.registerFilter('first', function (v) {   // Ruby's first of a hash is [key, value]
      if (Array.isArray(v)) return v[0];
      if (v && typeof v === 'object') { var k = Object.keys(v)[0]; return k === undefined ? undefined : [k, v[k]]; }
      return undefined;
    });
    liquid.registerFilter('base64_encode', function (v) {
      var b = new TextEncoder().encode(String(v)), t = '';
      for (var i = 0; i < b.length; i++) t += String.fromCharCode(b[i]);
      return btoa(t);
    });
    function transformer(fetchImpl, DateImpl) {
      var mod = { exports: {} };
      return new Function('fetch', 'Date', 'module', plugin.transform + '\n;return run;')(fetchImpl, DateImpl, mod);
    }

    // settings: custom field values (strings); locale: 'en'..; scenario: object or null (live); returns the markup variables
    async function compute(o) {
      var sc = o.scenario, nowMs = sc ? scenarioNowMs(sc) : Date.now();
      var fields = Object.assign({}, DEFAULT_FIELDS, o.settings || {});
      var dev = DEVICES[o.device || 'og'];
      var trmnl = {
        user: { id: 1, name: 'name', first_name: 'first_name', last_name: 'last_name', locale: LOCALES[o.language] || o.language || 'en-US', time_zone: 'UTC', time_zone_iana: 'UTC', utc_offset: 0 },
        device: { id: 1, friendly_id: 'ABC123', percent_charged: 85.0, wifi_strength: 90, height: dev.height, width: dev.width, model: dev.model, bit_depth: dev.bit_depth,
          orientation: 'landscape', firmware_version: '1.8.17', refresh_interval_seconds: 900, sleep_mode_enabled: false, sleep_start_time: 1320, sleep_end_time: 480 },
        system: { timestamp_utc: Math.floor(nowMs / 1000) },
        plugin_settings: { instance_name: 'Radio Weather', refresh_interval_minutes: 5, strategy: 'static', dark_mode: 'no', no_screen_padding: 'no', custom_fields_values: fields }
      };
      var run = transformer(sc ? mockFetch(sc) : o.fetch, sc ? frozenDate(nowMs) : Date);
      var out = await run({ trmnl: { user: trmnl.user, device: trmnl.device, system: { timestamp_utc: trmnl.system.timestamp_utc }, plugin_settings: trmnl.plugin_settings } });
      var data = Object.assign({}, out, { trmnl: Object.assign({}, trmnl, { state: out.trmnl_state }) });
      delete data.trmnl_state;
      var s = o.sensor;   // { device, temperature, humidity, carbon_dioxide } or null
      if (s) {
        var at = {}; at[utcStamp(nowMs - 600000)] = null;
        var rd = (v) => v === undefined || v === null ? [] : [(function () { var e = {}; e[utcStamp(nowMs - 600000)] = v; return e; })()];
        var rs = {}; rs['device_' + s.device] = { temperature: rd(s.temperature), humidity: rd(s.humidity), carbon_dioxide: rd(s.carbon_dioxide), pressure: [] };
        data.sensor_readings = rs;
      }
      return data;
    }

    async function renderView(data, view) {
      var src = plugin.views[view];
      return liquid.parseAndRender(src, data);
    }

    function pageHtml(markup, o) {
      var dev = DEVICES[o.device || 'og'], mount = MOUNT[o.view || 'full'];
      var clock = '';
      if (o.clockMs) {
        clock = '<script>(function(){var R=Date,off=' + o.clockMs + '-R.now();function F(){if(!(this instanceof F))return new F().toString();return arguments.length?new (Function.prototype.bind.apply(R,[null].concat([].slice.call(arguments))))():new R(R.now()+off)}F.prototype=R.prototype;F.now=function(){return R.now()+off};F.parse=R.parse;F.UTC=R.UTC;window.Date=F;var p=Intl.DateTimeFormat.prototype,g=Object.getOwnPropertyDescriptor(p,"format").get,fp=p.formatToParts;Object.defineProperty(p,"format",{get:function(){var b=g.call(this);return function(d){return b(d===undefined?F.now():d)}}});p.formatToParts=function(d){return fp.call(this,d===undefined?F.now():d)}})();</script>';
      }
      var scaled = o.device === 'x';   // the X is laid out at its CSS size (1040x780, TRMNL's own layout pass), then drawn 1.8 times larger
      var inner = '<!DOCTYPE html><html><head><meta charset="utf-8">' + (scaled ? '<style>.trmnl .screen{--pixel-ratio:1!important}</style>' : '') + clock +
        '<link rel="stylesheet" href="https://trmnl.com/css/3.4.6/plugins.css" /><script type="module" src="https://trmnl.com/js/3.4.6/plugins.js"></script>' +
        '<meta name="trmnl-framework-version" content="3.4.6" /><meta name="trmnl-framework-pinned" content="true" />' +
        '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
        '<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet"></head>' +
        '<body class="trmnl"><div class="screen ' + dev.classes + (o.dark ? ' screen--dark-mode dark-mode' : '') + ' screen--fonts-trmnl">' +
        (mount ? '<div class="' + mount + '">' : '') + '<div class="view view--' + (o.view || 'full') + '">' + markup + '</div>' + (mount ? '</div>' : '') + '</div></body></html>';
      if (!scaled) return inner;
      return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}iframe{border:0;width:1040px;height:780px;transform:scale(1.8);transform-origin:0 0}</style></head><body><iframe srcdoc="' +
        inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></iframe></body></html>';
    }
    return { compute: compute, renderView: renderView, pageHtml: pageHtml };
  }
  return { create: create, mockFetch: mockFetch, DEVICES: DEVICES, DEFAULT_FIELDS: DEFAULT_FIELDS, LOCALES: LOCALES, scenarioNowMs: scenarioNowMs };
});
