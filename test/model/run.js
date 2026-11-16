// Pure-logic tests for the SWModel block in plugin/src/transform.js. Run: node test/model/run.js
// The block is cut out between its markers, so the test runs the same bytes the device does.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../plugin/src/transform.js'), 'utf-8');
const a = src.indexOf('// ==== MODEL_BEGIN ====');
const b = src.indexOf('// ==== MODEL_END ====');
if (a < 0 || b < 0) throw new Error('MODEL markers missing in transform.js: move them with the block, never delete them');
const SWModel = new Function(src.slice(a, b) + '\nreturn SWModel;')();
const T = require('../../plugin/src/transform.js');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugin/tests/fixtures', n + '.json'), 'utf-8'));

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
function eq(got, want, msg) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error((msg || '') + ' got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
}
function ok(v, msg) { if (!v) throw new Error(msg || 'not true'); }

// removed '3h slots span their hours and the next slot\'s first hour': the interval setting and the 3h slots are gone (owner 2026-11-10, days are the only list)
// removed 'hourly slots take one hour and the next': the interval setting is gone (owner 2026-11-10)
test('the days list: 14 days from today with min, max, rain chance and the weekday', () => {
  const m = SWModel.build(fx('mixed'), {});
  eq(m.days.length, 14);
  eq(m.days[0].label, 'SU', '2026-11-08 is a Sunday');
  eq([m.days[0].lo, m.days[0].hi, m.days[0].rain], [1.4, 13.1, 90]);
});

// removed 'rain is the highest chance inside the slot, not past its end': slots by interval are gone (owner 2026-11-10); the rain window has its own cases below
test('storm beats snow beats rain', () => {
  eq([95, 99, 75, 86, 61, 82, 45, 0, null].map(SWModel.severity), [4, 4, 3, 3, 2, 2, 1, 0, 0]);
});

test('an error answer gives no signal with the reason', () => {
  const m = SWModel.build(fx('error'), {});
  eq(m.ok, false);
  ok(/Latitude/.test(m.reason));
});

test('nothing at all gives no signal', () => {
  eq(SWModel.build(null, {}).ok, false);
  eq(SWModel.build({}, {}).ok, false);
});

test('empty arrays still show the current temperature', () => {
  const m = SWModel.build(fx('empty'), {});
  eq(m.ok, true);
});

test('null temperatures make missing slots, not NaN', () => {
  const m = SWModel.build(fx('nulls'), {});
  ok(m.days.every((s) => s.missing || (Number.isFinite(s.lo) && Number.isFinite(s.hi))));
  eq(m.now.temp, fx('nulls').hourly.temperature_2m[0], 'falls back to the first hour');
});

// removed 'an unknown interval falls back to 3h': the interval setting is gone (owner 2026-11-10)

// Fuzz: every scale holds its data with a free segment either side and lights at least one segment.



test('format: rounding, no negative zero', () => {
  eq([SWModel.fmt(-0.3), SWModel.fmt(12.5), SWModel.fmt(null)], ['0', '13', '--']);
});

test('icon kinds follow the WMO code; the worst of a slot wins', () => {
  // owner: hail is its own kind (WMO 96, 99, a thunderstorm with hail), freezing rain is sleet, 71-77 and 85-86 snow
  eq([0, 1, 2, 3, 45, 51, 56, 61, 65, 66, 67, 71, 73, 75, 77, 80, 82, 85, 86, 95, 96, 99, null].map(SWModel.kind),
    ['clear', 'partly', 'partly', 'cloud', 'fog', 'drizzle', 'sleet', 'rain', 'heavy', 'sleet', 'sleet', 'snow', 'snow', 'snow', 'snow',
      'rain', 'heavy', 'snow', 'snow', 'storm', 'hail', 'hail', null]);
  eq(SWModel.worstKind([0, 2, 61, 3]), 'rain');
  // owner 2026-11-14: the condition text and the icon agree (code 1 read 'partly cloudy' under a full sun)
  const TXT_KIND = { 1000: 'clear', 1003: 'partly', 1006: 'cloud', 1009: 'cloud' }, W2 = T.WMO_TO_WAPI || {};
  ok(Object.keys(W2).length > 10, 'WMO_TO_WAPI exported');
  Object.keys(W2).forEach((c) => { if (TXT_KIND[W2[c]]) eq(SWModel.kind(+c), TXT_KIND[W2[c]], 'WMO ' + c + ' text ' + W2[c] + ' vs icon'); });
  const m = SWModel.build(fx('mixed'), {});
  eq(m.days[0].icon, 'rain');
  eq(m.now.day, false, '06:00 in November is night');
  eq(m.now.sync, '06:00');
});

test('the rain window: first wet hour to the end of the wet run', () => {
  const m = SWModel.build(fx('mixed'), {});
  eq([m.rain.fromLabel, m.rain.toLabel, m.rain.now], ['17:00', '23:00', false]);
  eq(SWModel.rainWindow([{ h: '06', p: 10, wet: false }], 50), null);
  eq(m.hours.length, 25);
});

test('the wet spell says what falls first: snow, hail, else rain', () => {
  const at = (code) => SWModel.rainWindow([{ h: '17', p: 80, icon: SWModel.kind(code), wet: true }, { h: '18', p: 10, icon: 'cloud', wet: false }], 50);
  eq([at(73).type, at(86).type, at(96).type, at(99).type, at(63).type, at(67).type], ['snow', 'snow', 'hail', 'hail', 'rain', 'rain']);
});

// removed 'data age from the local data time, the offset and the render time': ageMinutes is gone; the sensor staleness rule is tested below
test('humidity and UV now come through; missing ones are null, never a crash', () => {
  const m = SWModel.build(fx('mixed'), {});
  eq([m.now.hum, m.now.uv], [91, 1.8]);
  // an old cached answer without the uv fields
  const old = fx('mixed');
  delete old.current.uv_index; delete old.current.relative_humidity_2m;
  const o = SWModel.build(old, {});
  eq([o.ok, o.now.hum, o.now.uv], [true, null, null]);
  eq(SWModel.fmt(o.now.uv), '--');
  // a null inside the list
  const nl = fx('mixed'); nl.current.uv_index = null;
  const n = SWModel.build(nl, {});
  eq([n.now.uv, n.now.hum], [null, 91]);
});


test('the rain window: a wet code needs 30 percent, a dry code needs the chosen chance', () => {
  eq(SWModel.rainWindow([{ h: '17', p: 25, wet: true }], 50), null, 'wet code, 25 percent: dry');
  eq(SWModel.rainWindow([{ h: '17', p: 35, wet: true }, { h: '18', p: 5, wet: false }], 50).fromLabel, '17:00');
  eq(SWModel.rainWindow([{ h: '17', p: 55, wet: false }, { h: '18', p: 5, wet: false }], 50).fromLabel, '17:00', 'chance alone starts a window');
  eq(SWModel.rainWindow([{ h: '17', p: 45, wet: false }], 50), null);
});

test('no evening mode (owner 2026-11-12): at 19:00 the console shows now and tomorrow is in the days list', () => {
  const e = fx('mixed'); e.current.time = '2026-11-08T19:00';
  const m = SWModel.build(e, {});
  ok(!('ev' in m) || m.ev == null, 'no evening model');
  eq(m.today.hi, SWModel.build(fx('mixed'), {}).today.hi, 'today values stay today\'s');
  const v = T.buildView(m, T.buildI18n('nl'), e.daily);
  eq(v.days[1].name, T.buildView(SWModel.build(fx('mixed'), {}), T.buildI18n('nl'), fx('mixed').daily).days[1].name, 'tomorrow is the second day, as by day');
  ok(v.days.length >= 2, 'tomorrow on screen');
});

test('time format: the setting decides, 24 h when missing, the TIME constant overrides', () => {
  eq([T.timeIs12(null, '12'), T.timeIs12(null, 12), T.timeIs12(null, '24'), T.timeIs12(null, T.field({}, 'time_format', '24'))], [true, true, false, false], 'missing field: 24 h');
  eq([T.timeIs12('24', '12'), T.timeIs12('12', '24')], [false, true], 'constant wins');
  const y = fs.readFileSync(path.join(__dirname, '../../plugin/src/settings.yml'), 'utf-8');
  const fields = y.split(/^- keyname: /m).slice(1).map((part) => ({ key: part.split('\n')[0], group: (/^  group: (.+)$/m.exec(part) || [])[1] || null }));
  const OLD = ['author_info', 'lat_lon', 'unit', 'time_format', 'bottom', 'bottom_switch', 'hide_title_bar', 'sensor_label', 'sensor_primary'];
  const keys = fields.map((f) => f.key), GRP = 'Sensor';
  eq(keys.filter((k) => OLD.includes(k)), OLD, 'B22: the live setting keys that stay (label, main reading) keep their name and order; sensor_show is merged into sensor_source and sensor_co2 is removed (owner 2026-11-15: the CO2 meter follows the source) (owner 2026-11-15)');
  eq(fields.filter((f) => OLD.includes(f.key)).map((f) => f.group), [null, null, 'Display', 'Display', 'Display', 'Display', 'Display', GRP, GRP], 'settings groups (the legend is the last, collapsed group)');
  ok(!keys.includes('sensor_show'), 'sensor_show is gone: "None" in the Sensor select is the hide');
  const B31 = ['week_style', 'show_wear'];
  ok(fields.filter((f) => !OLD.includes(f.key) && !B31.includes(f.key)).every((f) => f.group === GRP && /^sensor_/.test(f.key)), 'B22: the new source settings are all in the Sensor group');
  eq(fields.filter((f) => B31.includes(f.key)).map((f) => [f.key, f.group]), [['week_style', 'Display'], ['show_wear', 'Display']], 'B31: the week display and what-to-wear settings are new fields in the Display group');
  ok(keys.indexOf('week_style') === keys.indexOf('hide_title_bar') + 1 && keys.indexOf('show_wear') === keys.indexOf('week_style') + 1, 'B31: both sit right after hide_title_bar, no existing key moved');
  const ws = y.split(/^- keyname: week_style/m)[1].split(/^- keyname: /m)[0];
  ok(/options:\n  - Blocks: blocks\n  - Digital: digital\n  default: blocks\n/.test(ws), 'B32: week_style options Blocks (new, the default) and Digital (value unchanged); the removed auto and eq values map to Blocks in the page');
  ok(/default: true/.test(y.split(/^- keyname: show_wear/m)[1].split(/^- keyname: /m)[0]), 'B31: show_wear is a boolean, default on');
  ['name', 'name-de', 'name-fr', 'name-es-ES', 'name-nl', 'name-ja', 'description-de', 'description-fr', 'description-es-ES', 'description-nl', 'description-ja'].forEach((k) => ok(new RegExp('^  ' + k + ': ', 'm').test(ws), 'B31: week_style has ' + k));
  const grp = keys.slice(keys.indexOf('sensor_source'));
  eq([grp[0], grp[1], grp.slice(-3)], ['sensor_source', 'sensor_device_id', ['sensor_icon', 'sensor_label', 'sensor_primary']], 'order in the group: source, provider fields, place (B24), label, main reading');
  // B22 (coordinator, server copy 541930): TRMNL silently fails the form's required check for a field a rule hides unless it is optional: true; a provider's must-haves are required only when it is chosen
  const blocks = y.split(/^- keyname: /m).slice(1), blk = (k) => blocks.find((q) => q.startsWith(k + '\n'));
  const cv = blk('sensor_source').split(/^  - when: /m).slice(1).map((w) => ({ when: w.split('\n')[0].replace(/'/g, ''), hidden: [...w.matchAll(/^    - (\w+)$/gm)].map((m) => m[1]), required: ((/^    required: \[(.*)\]$/m.exec(w) || [])[1] || '').split(', ').filter(Boolean) }));
  const named = new Set(cv.flatMap((c) => c.hidden).concat(['sensor_label']));
  // B24 (owner 2026-11-15): Sensor icon, House (default) or Anemometer, right after the provider fields; None hides it; it only sets the icon of the sensor's reading
  const sp = blk('sensor_icon');
  ok(sp && /^  group: Sensor$/m.test(sp) && /^  field_type: select$/m.test(sp) && /^  optional: true$/m.test(sp) && /- House: house\n  - Anemometer: anemometer\n  default: house\n/.test(sp), 'B24: sensor_icon is an optional select in the Sensor group, House by default');
  ok(cv.find((c) => c.when === 'none').hidden.includes('sensor_icon') && cv.filter((c) => c.when !== 'none').every((c) => !c.hidden.includes('sensor_icon')), 'B24: only None hides the icon');
  ok(/^  description: 'The icon in front of/m.test(sp) && /^  description-de: 'Das Symbol vor/m.test(sp) && /^  description-fr: 'L.{1,2}icône devant/m.test(sp) && /^  description-es-ES: 'El icono delante/m.test(sp) && /^  description-nl: 'Het icoon voor/m.test(sp) && /^  description-ja: 'センサーの値の前に/m.test(sp), 'B24: the description says in every language that it is the icon in front of the reading');
  ok(!/conditional_validation/.test(sp), 'B24: the icon hides nothing (layout and values stay)');
  ['name', 'description'].forEach((w) => ['', '-de', '-fr', '-es-ES', '-nl', '-ja'].forEach((l) => ok(new RegExp('^  ' + w + l + ': .{4,}', 'm').test(sp), 'B24: sensor_icon has ' + w + l)));
  eq([...named].filter((k) => !blk(k) || !/^  optional: true$/m.test(blk(k))), [], 'every field a rule hides is optional: true (else the form cannot be saved with it hidden)');
  // one naming pattern (owner 2026-11-15): option value = provider word, keys sensor_<prefix>_<field>, the same field words everywhere; a new provider adds one option and its prefixed keys
  const PREF = { home_assistant: 'hass', awair: 'awair', airgradient: 'airgradient', sensibo: 'sensibo', ecowitt: 'ecowitt', adafruit: 'adafruit', custom: 'custom' }, PROV = Object.keys(PREF);
  const optVals = [...blk('sensor_source').matchAll(/^  - [^:\n]+: (\w+)$/gm)].map((m) => m[1]);
  eq(optVals, ['none', 'own', 'other'].concat(PROV), 'Sensor options: None (hide), This TRMNL, Another TRMNL, then the providers');
  eq(cv.map((c) => c.when), optVals, 'one visibility rule per option');
  // B23 (owner 2026-11-15): providers not yet tried against a real account say (beta) in the option label (the label is the same in every language); the tested ones do not
  const optLabels = Object.fromEntries([...blk('sensor_source').matchAll(/^  - ([^\n]+): (\w+)$/gm)].map((m) => [m[2], m[1]]));
  eq(['awair', 'airgradient', 'sensibo', 'ecowitt', 'adafruit', 'custom'].filter((v) => !/ \(beta\)$/.test(optLabels[v])), [], 'B23: the six untested providers are labelled (beta)');
  eq(['none', 'own', 'other', 'home_assistant'].filter((v) => /beta/i.test(optLabels[v])), [], 'B23: None, the TRMNL options and Home Assistant are not beta');
  ok(['description', 'description-de', 'description-fr', 'description-es-ES', 'description-nl', 'description-ja'].every((d) => new RegExp('^  ' + d + ": '.*(Beta|Bêta|ベータ)").test(blk('sensor_source').split('\n').find((l) => l.startsWith('  ' + d + ':')))), 'B23: the Sensor description explains beta in all six languages');
  const all = [...new Set(cv.flatMap((c) => c.hidden))].filter((k) => k !== 'sensor_icon'), FIELD = /^(token|key|app_key|temp|hum|co2|id|url|type|header|time|unit|user)$/;
  all.forEach((k) => { if (k === 'sensor_device_id') return; const m = /^sensor_(\w+?)_(app_key|\w+)$/.exec(k), pv = PROV.find((x) => k.startsWith('sensor_' + PREF[x] + '_')); ok(pv && FIELD.test(k.slice(('sensor_' + PREF[pv] + '_').length)), k + ' follows sensor_<provider>_<field>'); });
  const ownOf = (o) => all.filter((k) => !c_hidden(o).includes(k)), c_hidden = (o) => cv.find((q) => q.when === o).hidden;
  PROV.forEach((pv) => {
    const c = cv.find((q) => q.when === pv), own = ownOf(pv);
    ok(c.required.length > 0 && c.required.every((k) => own.includes(k)), pv + ': required names only its own fields: ' + c.required);
    ok(own.every((k) => k.startsWith('sensor_' + PREF[pv] + '_')), pv + ': shows only its own prefixed fields: ' + own);
    ok(c.required.every((k) => !named.has(k) || /^  optional: true$/m.test(blk(k))), pv + ': required fields stay optional in the field itself (the rule makes them required)');
    ok(c.hidden.includes('sensor_device_id'), pv + ': the device number is hidden');
  });
  const byWhen = (o) => cv.find((q) => q.when === o);
  eq([byWhen('none').required, byWhen('own').required], [[], []], 'None and This TRMNL require nothing');
  ok(byWhen('none').hidden.includes('sensor_device_id') && byWhen('own').hidden.includes('sensor_device_id'), 'the device number is hidden for None and This TRMNL');
  eq([byWhen('other').required, ownOf('other')], [['sensor_device_id'], ['sensor_device_id']], 'Another TRMNL shows and requires the device number and nothing else');
  ok(all.filter((k) => k !== 'sensor_device_id').every((k) => byWhen('other').hidden.includes(k) && byWhen('none').hidden.includes(k)), 'no provider field shows for None, This TRMNL or Another TRMNL');
  ['name', 'description'].forEach((w) => ok(keys.filter((k) => k.startsWith('sensor_')).every((k) => ['de', 'fr', 'es-ES', 'nl', 'ja'].every((l) => new RegExp('^  ' + w + '-' + l + ': .{2,}', 'm').test(blk(k)))), 'every sensor field has ' + w + ' in de, fr, es-ES, nl, ja'));
  // B13 (owner 2026-11-14) overrides 'a screen shows only its own sensor': an optional setting picks another TRMNL's sensor; empty keeps the own one
  const part = (k) => y.split(/^- keyname: /m).slice(1).find((q) => q.startsWith(k + '\n'));
  ['sensor_device_id', 'sensor_label', 'sensor_primary'].forEach((k) => ['description', 'description-de', 'description-fr', 'description-es-ES', 'description-nl', 'description-ja'].forEach((d) => ok(new RegExp('^  ' + d + ': .{20,}', 'm').test(part(k)), k + ' has ' + d)));
  ok(/field_type: string/.test(part('sensor_device_id')) && /field_type: string/.test(part('sensor_label')) && !/default:/.test(part('sensor_device_id')) && !/default:/.test(part('sensor_label')), 'device id and label: text fields with no default (label empty = icon only)');
  ok(/trmnl\.com/.test(part('sensor_device_id')), 'the device id description says where the number is');
  ok(!/big/i.test(part('sensor_primary').split('\n').find((l) => l.startsWith('  description: '))) && !/found automatically/.test(part('sensor_source')), 'sensor texts match the layout: no "big" reading (both temperatures are one size), no automatic-only sensor');
  ok(/- Automatic: auto\n  - Sensor: sensor\n  - Outside: outside\n  default: auto\n/.test(part('sensor_primary')), 'main reading: Automatic (default), Sensor, Outside');
  ok(/- 24 hours \(17:00\): '24'\n  - 12 hours \(5:00 PM\): '12'\n  default: '24'\n/.test(y) && /- Days: days\n  - Hours: hours\n  - Hours, then days: auto\n  default: auto\n/.test(y), 'time format 24 by default, bottom strip hours then days after 18:00 by default');
});

test('temperature trend arrow: +3 h against now, 1 degree C or 2 degrees F', () => {
  eq([T.tempTrend(4, 5, false), T.tempTrend(4, 4.9, false), T.tempTrend(4, 3, false), T.tempTrend(4, 3.1, false), T.tempTrend(null, 3, false)], ['up', 'level', 'down', 'level', null]);
  eq([T.tempTrend(40, 42, true), T.tempTrend(40, 41.9, true), T.tempTrend(40, 38, true), T.tempTrend(40, 38.1, true)], ['up', 'level', 'down', 'level']);
  const v = T.buildView(SWModel.build(fx('mixed'), {}), T.buildI18n('nl'), fx('mixed').daily);
  eq(v.tdial.arrow, 'up', 'mixed: 1.6 now, 4.6 at 09:00');
});

test('bottom strip auto: hours until 17:59 local, days from 18:00', () => {
  eq([T.bottomHours('auto', '2026-11-13T17:59'), T.bottomHours('auto', '2026-11-13T18:00'), T.bottomHours('auto', '2026-11-13T00:00'), T.bottomHours('auto', null)], [true, false, true, false]);
  eq([T.bottomHours('hours', '2026-11-13T20:00'), T.bottomHours('days', '2026-11-13T09:00')], [true, false]);
  // B25 (owner 2026-11-15): the switch hour is a setting (12 to 23, default 18; anything else is 18)
  const at = (sw, h) => T.bottomHours('auto', '2026-11-13T' + h + ':00', sw);
  eq([at('21', '20'), at('21', '21'), at('21', '22'), at('12', '11'), at('12', '12'), at('23', '22'), at('23', '23')], [true, false, false, true, false, true, false], 'hours before the set hour, days at it and after');
  eq([at(undefined, '17'), at(undefined, '18'), at('', '18'), at('18', '17'), at('18', '18')], [true, false, false, true, false], 'unset or empty: 18');
  eq([at('11', '17'), at('11', '18'), at('24', '17'), at('24', '18'), at('abc', '17'), at('abc', '18'), at(null, '18'), at('21.7', '20'), at('21.7', '21')], [true, false, true, false, true, false, false, true, false], 'an invalid hour is 18; a fraction counts as its whole hour');
  eq([T.bottomHours('hours', '2026-11-13T23:00', '12'), T.bottomHours('days', '2026-11-13T12:00', '23')], [true, false], 'the hour only matters for Hours, then days');
  {
    const y = fs.readFileSync(path.join(__dirname, '../../plugin/src/settings.yml'), 'utf-8'), blocks = y.split(/^- keyname: /m).slice(1), blk = (k) => blocks.find((q) => q.startsWith(k + '\n'));
    const bs = blk('bottom_switch'), bt = blk('bottom');
    ok(bs && /^  optional: true$/m.test(bs) && /^  default: '18'$/m.test(bs) && /^  group: Display$/m.test(bs), 'B25: bottom_switch is optional with default 18, in Display');
    eq([...bs.matchAll(/^  - '(\d\d):00': '(\d\d)'$/gm)].map((m) => [m[1], m[2]]), Array.from({ length: 12 }, (_, i) => [String(12 + i), String(12 + i)]), 'B25: the hours 12 to 23, labelled 12:00 to 23:00');
    ok(/^  - Hours, then days: auto$/m.test(bt) && !/after 18:00/.test(bt), 'B25: the auto option is labelled Hours, then days (value auto)');
    ok(/- when: 'days'\n    hidden:\n    - bottom_switch\n  - when: 'hours'\n    hidden:\n    - bottom_switch/.test(bt), 'B25: the hour shows only for Hours, then days');
    ['name', 'description'].forEach((w) => ['', '-de', '-fr', '-es-ES', '-nl', '-ja'].forEach((l) => ok(new RegExp('^  ' + w + l + ': .{4,}', 'm').test(bs), 'B25: bottom_switch has ' + w + l)));
  }
});

test('air quality: the current index at any hour (no evening mode)', () => {
  const e = fx('mixed'); e.current.time = '2026-11-08T19:00';
  const aq = { current: { time: '2026-11-08T19:00', european_aqi: 30 }, hourly: { time: ['2026-11-08T20:00', '2026-11-09T09:00', '2026-11-09T10:00'], european_aqi: [30, 55, 75] } };
  eq(SWModel.build(Object.assign({}, e, { aq }), {}).now.aqi, 30);
});

// removed 'indoor sensor: latest reading, dropped when older than 3 hours': the input never carries sensor_readings on TRMNL (owner's live payload), so the transform no longer parses readings; the markup path is the render cases x-sens* (x-sens-stale: over 3 h shows nothing)
test('indoor sensor in the view: BUITEN/BINNEN twin readout, twin needle, CO2 meter and the indoor meters first (owner 2026-11-14)', () => {
  const raw = fx('mixed'), view = (inn) => { const M = SWModel.build(raw, {}); M.inn = Object.assign({ temp: null, hum: null, co2: null, press: null }, inn); return T.buildView(M, T.buildI18n('nl'), raw.daily); };
  const none = view({});
  eq([none.inn, none.tdial.twin, none.meters.some((m) => m.key === 'co2')], [null, null, false], 'no sensor: nothing changes');
  const v = view({ temp: 21.6, hum: 48, co2: 900 });
  eq([v.inn.temp, v.inn.out, v.inn.in, v.inn.hum, v.tdial.twin, 'feels' in v, 'felt' in v.inn], ['21.6', 'BUITEN', 'BINNEN', '', 21.6, false, false], 'owner 2026-11-13: no felt readout, no felt line under BUITEN; the humidity is in the meter now');
  const hmt = v.meters.filter((m) => m.key === 'humidity')[0];
  eq([hmt && hmt.tw.out, hmt && hmt.tw.in, hmt && hmt.tw.m.frac > 0.4 && hmt.tw.m.frac < 0.6, none.meters.some((m) => m.tw), view({ temp: 21.6 }).meters.some((m) => m.tw)], ['BUITEN', 'BINNEN', true, false, false], 'owner 2026-11-13: indoor humidity is a second block set on the humidity row, one set without the sensor or without a humidity reading');
  ok(v.tdial.b >= 21.6, 'dial scale holds the indoor needle');
  const out = view({}), M0 = SWModel.build(raw, {}), cold = Object.assign({}, M0, { now: Object.assign({}, M0.now, { temp: 15, feels: 1 }) });
  eq(['feels' in out, T.buildView(cold, T.buildI18n('nl'), raw.daily).cue[0]], [false, 'sweater'], 'owner 2026-11-13: no felt readout without a sensor either; owner 2026-11-16: the console cue is today\'s column cue (daily range 1.4 to 13.1: no parka, the warmest 13.1 gives the sweater), not the felt temperature now');
  // owner 2026-11-14 (replaces 'CO2 above 1400 ppm moves up to second place, a normal reading stays last'): with an indoor reading the indoor group comes first, CO2 then the indoor humidity row (the outdoor humidity right after it), then the other outdoor meters in the usual order; no indoor reading: the usual order
  const ks = (inn) => view(inn).meters.map((m) => m.key);
  eq(ks({ temp: 21.6, hum: 48, co2: 900 }).slice(0, 2), ['co2', 'humidity'], 'CO2, then the humidity twin first');
  eq(ks({ temp: 21.6, co2: 1500 }).slice(0, 2), ['co2', 'wind'], 'CO2 first at any reading, without an indoor humidity the outdoor meters follow in the usual order');
  eq(ks({ temp: 21.6, hum: 48 })[0], 'humidity', 'no CO2 reading: the humidity twin first');
  eq(ks({})[0], 'wind', 'no indoor reading: the usual order');
  eq(ks({ temp: 21.6, hum: 48, co2: 900 }).filter((k) => k !== 'co2' && k !== 'humidity'), ks({}).filter((k) => k !== 'humidity').slice(0, 2), 'the other outdoor meters keep their usual order');
});

test('temperature readout: no decimal once the whole part has 3+ characters (owner, step 12: 104.6 F touched the divider)', () => {
  const raw = fx('mixed'), at = (t) => { const M = SWModel.build(raw, {}); M.now.temp = t; return T.buildView(M, T.buildI18n('nl'), raw.daily); };
  eq([104.6, -13.2, -12, 38.3, -2.5, 99.96, -0.04].map((t) => at(t).tdial.value), ['105', '-13', '-12', '38.3', '-2.5', '100', '0.0']);
});

test('sun: the next sunrise and sunset, tomorrow flagged (owner 2026-11-12)', () => {
  const at = (hm) => { const d = JSON.parse(JSON.stringify(fx('mixed'))); d.current.time = '2026-11-08T' + hm; return T.sunTimes(d); };
  const m = at('06:00'), a = at('15:00'), e = at('17:00');
  eq([m.riseL, m.riseTom, m.setL, m.setTom], ['07:21', false, '16:35', false], 'before sunrise: both today');
  eq([a.riseL, a.riseTom, a.setL, a.setTom], ['07:22', true, '16:35', false], 'afternoon: sunrise is tomorrow');
  eq([e.riseL, e.riseTom, e.setL, e.setTom], ['07:22', true, '16:34', true], 'after sunset: both tomorrow');
});

// v2 X full view: the parts the layout places (buildView in transform.js)
test('the X view: meters in owner order, rain calendar on a wet day, seven days from today (X half vertical shows 7), today flagged', () => {
  const raw = fx('mixed'), M = SWModel.build(raw, {}), v = T.buildView(M, T.buildI18n('nl'), raw.daily, 'wi-moon-full');
  eq(v.meters.map((m) => m.key), ['wind', 'humidity', 'baro'], 'no REGEN meter row (the rain gauge replaced it)');
  ok(v.rain && !v.dry && v.rain.hours.length === 12, 'rain calendar on a wet day');
  eq(v.days.map((d) => d.name), ['ZO', 'MA', 'DI', 'WO', 'DO', 'VR', 'ZA'], 'seven days from today'); eq(v.days.map((d) => d.today), [true, false, false, false, false, false, false]);
  ok(!JSON.stringify(v).includes('<svg'), 'the transform builds no SVG (owner 2026-11-12)');
});
test('rain gauge (owner 2026-11-13): 3 blocks by the peak hourly rain (1 under 1 mm/h, 2 from 1, 3 from 4; 0.04 and 0.16 in/h), label the 12 h total capped 10+ mm / 0.4+ in', () => {
  const raw = fx('mixed'), mk = (f) => { const M = SWModel.build(raw, {}); if (f) f(M); const v = T.buildView(M, T.buildI18n('nl'), raw.daily); ok(!v.meters.some((m) => m.key === 'regen'), 'no REGEN meter'); return v.rain; };
  const hrs = (M, a) => { M.hours.forEach((q) => { q.mm = 0; }); a.forEach((x, k) => { M.hours[M.rain.from + k].mm = x; }); };
  const g = (a, u) => mk((M) => { if (u) M.unit = u; hrs(M, a); }).gauge;
  eq([g([0.9]).segs, g([1]).segs, g([3.9]).segs, g([4]).segs, g([40]).segs], [1, 2, 2, 3, 3], 'blocks from the peak hour: 1 / 2 from 1 mm/h / 3 from 4 mm/h');
  eq([g([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]).segs, g([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]).label], [1, '4 mm'], 'a long light rain is 1 block, the label is the total');
  eq([g([2, 2]).segs, g([2, 2]).label, g([3, 3, 3, 3]).label], [2, '4 mm', '10+ mm'], 'total label, capped at 10+ mm');
  eq([g([0.03], 'F').segs, g([0.04], 'F').segs, g([0.15], 'F').segs, g([0.16], 'F').segs], [1, 2, 2, 3], 'inch thresholds 0.04 and 0.16 per hour');
  eq([g([0.1, 0.1, 0.1], 'F').label, g([0.5], 'F').label, g([0.01], 'F').label], ['0.3 in', '0.4+ in', '<0.1 in'], 'inch labels, capped');
  eq(mk((M) => { M.hours.forEach((q) => { q.mm = null; }); }).gauge, null, 'hidden without an amount');
  eq(mk((M) => { M.hours.forEach((q) => { q.mm = 0; }); }).gauge, null, 'hidden at 0');
  ok(!T.buildView((() => { const M = SWModel.build(raw, {}); M.rain = null; return M; })(), T.buildI18n('nl'), raw.daily).rain, 'no calendar, no gauge');
});
test('the X view: a dry day shows sun times and the moon, no calendar', () => {
  const raw = fx('mixed'), n = raw.hourly.time.length;
  raw.hourly.precipitation_probability = Array(n).fill(0); raw.hourly.weather_code = Array(n).fill(1); raw.hourly.precipitation = Array(n).fill(0);
  const v = T.buildView(SWModel.build(raw, {}), T.buildI18n('nl'), raw.daily, 'wi-moon-full');
  ok(!v.rain && v.dry && /wi-moon-full/.test(v.dry.moon), 'dry block with the moon');
});
test('the X view: no data gives no crash and empty parts', () => {
  const M = SWModel.build(fx('error'), {}), v = T.buildView(M, T.buildI18n('en'), null, null);
  eq(v.ok, false); eq(v.days.length, 0);
});
// Page drawings (DRAW block of source/shared.liquid, the readable source: the built page script is minified into one statement), cut out like the model.
const shRaw = fs.readFileSync(path.join(__dirname, '../../source/shared.liquid'), 'utf-8');
const sh = shRaw.replace(/\{\{ (\d+) \| times: \w+ \| round \| at_most: 100 \}\}/g, '$1');   // per-view size factors read as the full view's values
const da = sh.indexOf('// ==== DRAW_BEGIN ===='), db = sh.indexOf('// ==== DRAW_END ====');
if (da < 0 || db < 0) throw new Error('DRAW markers missing in shared.liquid');
const D = new Function(sh.slice(da, db) + '\nreturn SWDraw;')();
test('segment digits: lit segments only, no ghost segments (owner 2026-11-12)', () => {
  eq((D.digits('1', 100).match(/<polygon/g) || []).length, 2, 'a 1 is two segments');
  eq((D.digits('8.8', 100).match(/<polygon/g) || []).length, 14); ok(/<rect/.test(D.digits('8.8', 100)), 'decimal point');
});
test('segment digits: LCD cells (owner 2026-11-14): the minus takes the empty integer cell, narrow minus glyph, no extra gap', () => {
  const w = (s) => +/viewBox="0 0 ([\d.]+)/.exec(D.digits(s, 100))[1];
  eq(w('-2'), w('22'), 'a minus in the reserved cell: same width as two digits');
  ok(w('-12') < w('-2') + w('2') * 0.9, 'a minus before two digits is narrow, not digit-wide: ' + w('-12') + ' vs ' + w('-2'));
  ok(w('-') < w('2') * 0.9, 'minus glyph narrower than a digit cell');
});
test('meters (owner 2026-11-12): order wind, uv, aqi, humidity, pollen, baro, co2; pollen only above zero', () => {
  const raw = fx('mixed'), M0 = SWModel.build(raw, {});
  const keys = (pol, extra) => { const M = SWModel.build(raw, {}); M.rain = null; M.now.pollen = pol; Object.assign(M.now, extra || {}); return T.buildView(M, T.buildI18n('nl'), raw.daily).meters.map((m) => m.key); };
  eq([keys(0).includes('pollen'), keys(null).includes('pollen'), keys(undefined).includes('pollen'), keys(0.05).includes('pollen')], [false, false, false, true], 'zero, null, missing hide pollen; low pollen shows');
  const k = keys(0.4, { aqi: 30 }); ok(k.indexOf('humidity') >= 0 && k.indexOf('pollen') > k.indexOf('humidity'), 'humidity before pollen: ' + k);
  ok(M0 && keys(0.4, { aqi: 30 }).slice(0, 3).join() === 'wind,aqi,humidity', 'priority: humidity kept before pollen when rows run short: ' + k);
});
test('block meter: any reading above zero lights one cell', () => {
  const lit = (s) => ((s.split('<g data-sw-on data-sw-st="a">')[1] || '').match(/data-sw-c=/g) || []).length;   // the current cells (owner 2026-11-13: full ink)
  eq([lit(D.meter({ frac: 0.01 }, 300, 40)), lit(D.meter({ frac: 0 }, 300, 40))], [1, 0]);
});
test('block meter: half lit lights five of ten, no data lights none', () => {
  const lit = (s) => ((s.split('<g data-sw-on data-sw-st="a">')[1] || '').match(/data-sw-c=/g) || []).length;
  eq([lit(D.meter({ frac: 0.5 }, 300, 20)), lit(D.meter({ frac: null }, 300, 20)), lit(D.meter({ frac: 2 }, 300, 20))], [5, 0, 10]);
  const nr = D.meter({ frac: 0.5 }, 120, 40);   // B32: a row whose cells would be taller than wide draws 5 wider cells, the values scale to 5, no offset shadow
  eq([(nr.match(/data-sw-c=/g) || []).length, lit(nr), /text--gray-65/.test(nr)], [5, 3, false], 'narrow row: 5 cells, half lit = 3 of 5, no shadow');
});
test('indoor humidity balance meter (owner 2026-11-16): the cells fill outward from the centre tick by the bands, the edge cells are the lamp', () => {
  const st = (h) => { const x = D.meter({ tw: { m: { frac: h / 100 } } }, 300, 20, 10, 1), on = x.split('<g data-sw-on data-sw-st="a">')[1] || ''; return { cells: [...on.matchAll(/data-sw-c="(\d)"/g)].map((m) => +m[1]), tick: /data-sw-bt/.test(on), shadow: /text--gray-65/.test(x) }; };
  eq([25, 30, 39, 40, 55, 56, 65, 66, 100].map((h) => st(h).cells), [[0, 1], [1], [1], [], [], [3], [3], [3, 4], [3, 4]], 'under 30 two left, 30 to under 40 one left, 40 to 55 none, over 55 to 65 one right, over 65 two right');
  ok(st(50).tick && !st(50).shadow, 'one centre tick, no shadow');
}); 
test('the try-it page offers exactly the options of settings.yml for every select it shows (owner 2026-11-16: it still offered the removed EQ sliders)', () => {
  const y = fs.readFileSync(path.join(__dirname, '../../plugin/src/settings.yml'), 'utf8'), h = fs.readFileSync(path.join(__dirname, '../../tools/site/page/index.html'), 'utf8');
  const opts = (k) => { const m = y.match(new RegExp('^- keyname: ' + k + '\\n[\\s\\S]*?^  options:\\n((?:  - .*\\n)+)', 'm')); return m ? m[1].split('\n').filter(Boolean).map((l) => l.replace(/^.*: ?'?([^':]*)'?$/, '$1')) : null; };
  let n = 0, wk = false;
  for (const m of h.matchAll(/<select id="(\w+)">([\s\S]*?)<\/select>/g)) {
    const want = opts(m[1]); if (!want) continue;
    n++; if (m[1] === 'week_style') wk = true; eq([...m[2].matchAll(/<option value="([^"]*)"/g)].map((q) => q[1]).sort(), want.slice().sort(), 'select ' + m[1] + ' follows settings.yml');
  }
  ok(n >= 4 && wk, 'the check saw ' + n + ' selects (week_style among them)');
});
test('rain calendar: 12 hours from the first wet hour, rain hours lit', () => {
  const hrs = Array.from({ length: 25 }, (_, i) => ({ h: String(i).padStart(2, '0') }));
  const c = T.rainHours(hrs, { from: 5, to: 7 });
  eq(c.length, 12); eq(c[0].h, '05', 'starts at the first wet hour'); eq(c.filter((q) => q.wet).map((q) => q.h), ['05', '06', '07']);
  eq(T.rainHours(hrs, { from: 0, to: 2 })[0].h, '00', 'raining now: starts now'); eq(T.rainHours(hrs, { from: 20, to: 22 })[0].h, '13', 'always 12 cells');
  const svg = D.rain(c, 600, 120);
  eq((svg.match(/<rect/g) || []).length, 3, 'one lit cell per rain hour'); ok(!/gray/.test(svg), 'dry hours in full text colour');
});
test('dials: needle drawn last, low mark hollow, high mark solid, baro zone icons', () => {
  const t = D.dial({ now: 1.6, lo: 1.4, hi: 13.1, a: 0, b: 15, step: 5 }, 900, 380, false);
  const nl = t.replace(/<g data-sw-dlab.*<\/g><\/svg>$/, '</svg>');   /* B18: only the scale numbers (knock-out group) come after the needle */
  ok(/<circle[^>]*\/><\/g><\/g><\/svg>$/.test(nl) && nl !== t, 'hub (needle group) is the last thing drawn, then the scale numbers');
  ok(/fill="none" stroke="currentColor"[^>]*stroke-linejoin/.test(t), 'hollow low mark');
  const b = D.dial({ now: 1013, lo: 1008, hi: 1016, a: 970, b: 1050, icons: ['a.svg', 'b.svg', 'c.svg', 'd.svg'] }, 900, 380, true);
  eq((b.match(/<image /g) || []).length, 4, 'four zone icons');
  ok(D.dial({ now: null, lo: null, hi: null, a: 0, b: 15, step: 5 }, 900, 380, false).indexOf('<polygon') < 0, 'no data: no needle, no marks');
});
test('right column: no rule between the rain calendar and the sun times (owner 2026-11-12, later decision)', () => {
  ok(sh.indexOf('data-sw-sep="rain-sun"') < 0, 'no rain-sun separator');
});
test('week display colours (owner 2026-11-16; B32: the EQ sliders are gone): the Digital lows as dark as the highs, no ghost segments, black on 2-bit and 1-bit', () => {
  const SWD = { scale: { major: 5, deg: '°' }, days: [{ hi: '13°', lo: '1°', hiV: 13, loV: 1, today: true }, { hi: '12°', lo: '3°', hiV: 12, loV: 3 }] };
  const wk = (m, i, st) => { D.mode = m; D.nCols = 7; D.wcw = 200; D.ws = st; const r = D.part(SWD, 'wday', i, 200, 200); D.mode = null; return r; };
  const dg = wk({ dark: false, bits: 4 }, 0, 'dig');
  ok(/data-sw-glyph/.test(dg) && !/data-sw-groove/.test(dg), 'digital: segment digits, no groove, no divider line (calm, spaced)');
  ok(!/text--gray-45|text--gray-40 /.test(dg.replace(/text--gray-40/, '')), 'digital 4-bit: the lows are not the mid grey (darkest grey like the highs)');
  ok(!/(^|[^:])text--gray-(7\d|80)/.test(dg), 'digital: no ghost segments (no faint grey digit parts)');
  ok(!/text--gray-45/.test(wk({ dark: false, bits: 2 }, 0, 'dig')) && !/text--gray-45/.test(wk({ dark: false, bits: 1 }, 0, 'dig')), 'digital 2-bit and 1-bit: lows black');
});
test('panel face (owner 2026-11-16, replaces the 2026-11-12 plain fill): nothing is drawn on any screen; the dividers are the markup\'s framework border lines', () => {
  const f = (m) => { D.mode = m; const s = D.part({}, 'face', 0, 1200, 400); D.mode = null; return s; };
  [{ dark: false, bits: 4 }, { dark: true, bits: 4 }, { dark: false, bits: 2 }, { dark: true, bits: 2 }, { dark: false, bits: 1 }].forEach((m) => ok(f(m) === '', 'no fill, outline or box ' + JSON.stringify(m)));
  const src = fs.readFileSync(path.join(__dirname, '../../plugin/src/shared.liquid'), 'utf8');
  ok(!/<style/.test(src), 'the built markup has no <style> block (TRMNL template hard rule)');
  const attrs = (src.match(/\sstyle=/g) || []).length;
  ok(attrs <= 2, 'style= attributes in the built markup: ' + attrs + ' (ratchet: at most 2 on 2026-11-16, only falls)');
  ok(!/data-sw-divider/.test(src), 'no drawn divider divs');
});
test('dial light: backlight in light mode (2-bit up), glow in dark (blur 4-bit, halo 2-bit, none 1-bit)', () => {
  const t = (m) => { D.mode = m; const s = D.dial({ now: 5, lo: 1, hi: 9, a: 0, b: 15, step: 5 }, 900, 380, false); D.mode = null; return s; };
  ok(!/data-sw-backlight/.test(t({ dark: false, bits: 4 })), 'light 4-bit: no backlight lamps (owner 2026-11-12)');
  ok(!/data-sw-fill/.test(t({ dark: false, bits: 4 })), 'the dial draws no fill of its own: the panel face does, edge to edge (owner 2026-11-12)'); ok(!/data-sw-backlight/.test(t({ dark: false, bits: 1 })), 'no backlight on 1-bit');
  ok(/data-sw-glow="4"[\s\S]*feGaussianBlur|feGaussianBlur[\s\S]*data-sw-glow="4"/.test(t({ dark: true, bits: 4 })), 'dark 4-bit blur glow');
  ok(/feMorphology/.test(t({ dark: true, bits: 2 })) && !/feGaussianBlur/.test(t({ dark: true, bits: 2 })), 'dark 2-bit halo, no blur');
  ok(!/data-sw-glow|data-sw-backlight/.test(t({ dark: true, bits: 1 })), '1-bit dark: nothing');
  ok(/<circle[^>]*\/><\/g><\/g><\/svg>$/.test(t({ dark: true, bits: 4 }).replace(/<g data-sw-dlab.*<\/g><\/svg>$/, '</svg>')), 'needle hub still last (before the scale numbers)');
});
test('dark glow on the lit parts: blur halo on 4-bit, crisp halo on 2-bit, none in light mode or 1-bit (owner 2026-11-12)', () => {
  const SWv = { temp: '12', meters: [{ frac: 0.5 }], rain: { hours: [{ h: '14', wet: true }, { h: '15', wet: false }] }, sun: { phase: 0.3 } };
  const parts = (m) => { D.mode = m; D.src = 'x.svg'; const r = ['temp', 'meter', 'rain', 'moon', 'icon'].map((k) => [k, D.part(SWv, k, 0, 200, 60)]); D.mode = null; return r; };
  parts({ dark: true, bits: 4 }).forEach(([k, s]) => ok(/<g filter="url\(#swgl\d+\)" data-sw-glow="4">/.test(s) && /feGaussianBlur stdDeviation/.test(s) && /slope="0.75"/.test(s), k + ': dark 4-bit halo'));
  parts({ dark: true, bits: 2 }).forEach(([k, s]) => ok(/data-sw-glow="2"/.test(s) && /feMorphology/.test(s) && !/feGaussianBlur/.test(s), k + ': dark 2-bit crisp halo'));
  [{ dark: false, bits: 4 }, { dark: false, bits: 2 }, { dark: true, bits: 1 }, { dark: false, bits: 1 }].forEach((m) => parts(m).forEach(([k, s]) => ok(!/data-sw-glow|swgl/.test(s), k + ': no glow ' + JSON.stringify(m))));
  D.mode = { dark: true, bits: 4 }; const r = D.rain([{ h: '14', wet: true }], 120, 40); D.mode = null;
  ok(r.indexOf('data-sw-glow') < r.lastIndexOf('<rect'), 'halo under the lit cell, not over it');
  D.mode = { dark: true, bits: 4 }; ok(!/text--gray-40/.test(D.meter({ frac: 0.5 }, 200, 30, 10)), 'dark: lit meter cells in full ink, as live'); D.mode = null;
  ok((sh.match(/<img [^>]*data-sw-icon>/g) || []).length === 4, 'weather (full and small console), rain and the sun rise/set icon (one loop, drawn twice) marked to glow');
});
test('moon glow outside the disk in dark mode, none in light or 1-bit (owner 2026-11-12)', () => {
  const at = (m) => { D.mode = m; const v = D.moon(0.3, 100); D.mode = null; return v; };
  const d = at({ dark: true, bits: 4 });
  ok(/<mask [^>]*>.*<circle cx="50" cy="50" r="2[7-9][\d.]*" fill="#000"\/><\/mask>/.test(d), 'mask cuts out the disk');
  ok(/<g mask="url\(#swmk\d+\)" data-sw-moonhalo><defs>.*<g filter="url\(#swgl\d+\)" data-sw-glow="4"><circle[^>]*\/><\/g><\/g>/.test(d), 'the halo is the whole disk, under the mask');
  ok(!/data-sw-glow[^>]*><path/.test(d), 'no halo on the lit part itself');
  [{ dark: false, bits: 4 }, { dark: true, bits: 1 }].forEach((m) => ok(!/swmk|swgl/.test(at(m)), 'no halo ' + JSON.stringify(m)));
});
test('week columns by size class (owner 2026-11-16, never measured): full 7, 4 on the OG portrait; half vertical 4, 3 in portrait; smaller views and the half vertical always Digital', () => {
  ok(/assign wk_cs = '5,4,7,7' \| split/.test(sh), 'full view: md landscape 5 (owner 2026-11-16: calmer on small screens), md portrait 4, lg landscape 7, lg portrait 7');
  ok(/if view == 3 %\}\{% assign wk_cs = '4,3,4,3' \| split/.test(sh), 'half vertical: 4 landscape, 3 portrait on both sizes');
  ok(/assign ws = 'blocks' %\}\{% if cf.week_style == 'digital' %\}\{% assign ws = 'dig' %\}/.test(sh), 'B32: Blocks (the old day rows) is the default on every view; only the saved value digital is Digital, any other (the removed eq and auto, unknown) is Blocks');
  ok(/<span class="title title--base text--bold" data-sw-dname>\{\{ d\.name \}\}/.test(sh) && /data-sw-today>/.test(sh), 'names: today lit, the others plain');
  ok(/lg:portrait:\{% if i < wk_cd %\}block/.test(sh) && /grow basis--0 w--min-0 h--full/.test(sh), 'columns equal width, shown per size class');
});
test('OG full (md): no dials, 5-segment meters, 4 days; X (lg) keeps dials, 10 segments, 5 days', () => {
  ok(/<div class="hidden lg:block h--\[\d+cqh\][^"]*"><div class="flex flex--row/.test(sh), 'dials only on lg');
  ok(/lg:hidden" data-sw-part="\{\{ pk \}\}" data-sw-n="5"/.test(sh) && /hidden lg:block[^"]*" data-sw-part="\{\{ pk \}\}" data-sw-n="10"/.test(sh), 'meter copies per size');
  ok(/data-sw-wcol/.test(sh) && /<div class="relative z--2 flex flex--row gap--none w--full h--full" data-sw-week>/.test(sh), 'every week column in one full-width row (no half-width wrapper)');
  ok(/{% if d.today %}<span class="label label--inverted[^"]*" data-sw-today>/.test(sh), 'OG: today a lit lamp on the day name (owner 2026-11-12)');
  D.mode = { bits: 1 }; ok(/data-sw-st="e"><g><rect/.test(D.meter({ frac: 0 }, 200, 30, 5)), '1-bit: unlit cells drawn in full colour'); D.mode = null;
  const cells = (n) => (D.meter({ frac: 0 }, 400, 30, n).match(/<rect/g) || []).length;
  eq([cells(5), cells(10)], [5, 10]);
  D.mode = { bits: 2 }; ok(/text--gray-30/.test(D.meter({ frac: 0 }, 200, 30, 5)), '2-bit: unlit cells dark enough to show (native dark grey)'); D.mode = null;
});
test('rain unit: icon left of the grid on every size (owner 2026-11-12, later decision)', () => {
  const u = sh.indexOf('data-sw-unit="rain"'), end = sh.indexOf('data-sw-part="rain"', u);
  ok(u > 0 && /\{\{ ru_cls \}\}/.test(sh.slice(sh.lastIndexOf('<div', u), u)) && /assign ru_cls = 'flex--row lg:portrait:flex--col'/.test(sh), 'row on md and lg');
  ok(/{% if stk %}[^\n]*{% assign ru_cls = 'flex--col lg:flex--row' %}/.test(sh), 'narrow stacked md column: icon above the calendar (owner 2026-11-12)');
  ok(/<img class="image image--adaptive \{\{ ib_cls \}\}" src="\{\{ ui.rain.icon \}\}"/.test(sh.slice(u, end)) && /h--\[\{\{ cal_m \}\}cqh\] lg:h--\[\{\{ cal_l \}\}cqh\][^"]*" data-sw-part="rain"/.test(sh) && /capture ib_cls %\}aspect--1\/1 h--\[\{\{ ib_m \}\}cqh\] lg:h--\[\{\{ ib_l \}\}cqh\]/.test(sh), 'icon as tall as the grid on md and lg');
  ok(/{% if view == 3 %}[^\n]*{% assign ru_cls = 'flex--row' %}/.test(sh), 'stacked md: icon above, one row tall; OG half vertical: icon left at the calendar height (owner 2026-11-12)');
  ok(/<div class="\{\{ ib_cls \}\}" data-sw-part="moon">/.test(sh), 'moon box the same as the rain icon box');
  const T3 = (h) => D.rain(Array.from({ length: 12 }, (_, i) => ({ h: String(i), wet: false })), 300, h).match(/<text/g).length;
  eq([T3(150), T3(500)], [6, 9], 'short rain: 2 x 3; a narrow tall box: 3 x 3');
  eq(T3(300), 9, 'a box sized for 3 rows: 3 x 3');
  const R3 = (w, h, lp) => { D.lp = lp || 0; const n = D.rain(Array.from({ length: 12 }, (_, i) => ({ h: String(i), wet: false })), w, h, 3).match(/<text/g).length; D.lp = 0; return n; };
  eq(R3(300, 160), 9, 'long rain: 3 x 3 in a box that holds it');
  eq([R3(300, 120), R3(300, 160, 50)], [6, 6], 'long rain: 2 x 3 when 3 rows only fit too flat or below the label size (owner 2026-11-12)');
  ok(/data-sw-part="rain" data-sw-rows="{{ rr_m }},{{ rr }}"/.test(sh) && /{% if view == 2 %}{% assign rr_m = 2 %}/.test(sh), 'quadrant and half-horizontal md boxes sized for 2 rows; OG half vertical 3 when the rain is long (owner 2026-11-12)');
  const c = Array.from({ length: 12 }, (_, i) => ({ h: String(i), wet: i >= 2 && i <= 6 }));
  eq([T.rainRows(c), T.rainRows(c.map((q, i) => ({ h: q.h, wet: i >= 2 && i <= 5 })))], [3, 2], 'rows: 3 when the rain runs past the sixth hour');
});
test('sun/moon unit: moon left of the sun rows on every size, grey ink (owner 2026-11-12, later decision)', () => {
  const u = sh.indexOf('data-sw-unit="sun"'), rows = sh.indexOf('ui.sun[sk]', u);
  ok(u > 0 && /\{\{ su_cls \}\} \{% if ui.rain %\}flex--left[^%]*\{% else %\}flex--center/.test(sh.slice(sh.lastIndexOf('<div', u), u)) && /assign su_cls = 'flex--row'/.test(sh) && !/assign su_cls = '[^']*portrait:flex--col/.test(sh), 'row on md and lg; centred when dry, on the rain icon\'s left edge when it rains');
  const m = sh.indexOf('data-sw-part="moon"', u); ok(m > u && m < rows, 'moon before the sun rows');
  ok(!/<img[^>]*ui.sun.moon/.test(sh), 'no moon icon image');
  eq(D.moon(null, 60), '');
});
// Lit area of a moon path: SVG arcs to polylines by the spec's endpoint-to-centre conversion, then the shoelace area.
function pathArea(d) {
  const n = d.match(/-?[\d.]+/g).map(Number), pts = [[n[0], n[1]]];
  for (let i = 2; i + 7 <= n.length; i += 7) {
    const [x1, y1] = pts[pts.length - 1], [rx, ry, , fa, fs, x2, y2] = n.slice(i, i + 7);
    if (rx < 1e-6) { pts.push([x2, y2]); continue; }
    const xp = (x1 - x2) / 2, yp = (y1 - y2) / 2, lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry), s2 = lam > 1 ? Math.sqrt(lam) : 1, Rx = rx * s2, Ry = ry * s2;
    let k = Math.sqrt(Math.max(0, (Rx * Rx * Ry * Ry - Rx * Rx * yp * yp - Ry * Ry * xp * xp) / (Rx * Rx * yp * yp + Ry * Ry * xp * xp))); if (fa === fs) k = -k;
    const cxp = k * Rx * yp / Ry, cyp = -k * Ry * xp / Rx, cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (xp - cxp) / Rx, (yp - cyp) / Ry); let dt = ang((xp - cxp) / Rx, (yp - cyp) / Ry, (-xp - cxp) / Rx, (-yp - cyp) / Ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
    for (let j = 1; j <= 200; j++) { const t = t1 + dt * j / 200; pts.push([cx + Rx * Math.cos(t), cy + Ry * Math.sin(t)]); }
  }
  let A = 0, X = 0; pts.forEach((q, i) => { const r = pts[(i + 1) % pts.length]; A += q[0] * r[1] - r[0] * q[1]; X += q[0]; });
  return { area: Math.abs(A) / 2, mx: X / pts.length };
}
test('day names without full ICU (item 22): own weekday table, not Intl', () => {
  const real = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function () { return new real('en', arguments[1]); };   // TRMNL's serverless Node: English only
  try {
    eq(T.dayNames(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-15'], 'nl'), ['MA', 'DI', 'WO', 'ZO'], 'nl');
    eq(T.dayNames(['2026-11-13'], 'de-AT'), ['FR'], 'de-AT by its base language');
    eq(T.dayNames(['2026-11-13'], 'en-GB'), ['FRI'], 'en');
  } finally { Intl.DateTimeFormat = real; }
});
test('meter cell states for today (owner 2026-11-13): active, reached earlier, expected later, empty; one peak outline', () => {
  const S = (m, n) => { const r = D.cellStates(m, n); return r.st.join('') + '|' + r.peak; };
  // now, past max, later max, peak (fractions of the scale) -> cell states and the peak cell
  const table = [
    [{ frac: 0.3, past: 0.6, later: 0.9, peak: 0.9 }, 10, 'aaapppllle|8'],
    [{ frac: 0.3, past: 0.9, later: 0.6, peak: 0.9 }, 10, 'aaappppppe|8'],    // later below the past max: no later cells
    [{ frac: 0.7, past: 0.2, later: 0.4, peak: 0.7 }, 10, 'aaaaaaaeee|6'],    // now is the max: the peak on an active cell
    [{ frac: 0.2, past: null, later: 0.5, peak: 0.5 }, 10, 'aallleeeee|4'],   // no past hours (first hour of the day)
    [{ frac: 0.2, past: 0.55, later: 0.35, peak: 0.87 }, 10, 'aappppeeee|8'], // WIND: the max gust past the speeds, on an empty cell
    [{ frac: 0.3, past: 0.55, later: 0.95, peak: 0.95 }, 5, 'aapll|4'],
    [{ frac: null, past: null, later: null, peak: null }, 5, 'eeeee|-1'],
  ];
  table.forEach(([m, n, want]) => eq(S(m, n), want, JSON.stringify(m) + ' on ' + n));
  const svg = D.meter({ frac: 0.3, past: 0.6, later: 0.9, peak: 0.9 }, 300, 30, 10), gsv = D.meter({ frac: 0.2, past: 0.4, later: 0.3, peak: 0.8 }, 300, 30, 10);
  eq([(svg.match(/data-sw-gust/g) || []).length, (gsv.match(/data-sw-gust/g) || []).length], [0, 1], 'peak outline only outside today\'s range (owner): none when the range already reaches it, one for a gust beyond it');
  eq([1, (svg.match(/data-sw-st="p"><g class="([^"]+)"/) || [])[1] === (svg.match(/data-sw-st="l"><g class="([^"]+)"/) || [])[1] && !/stroke-dasharray/.test(svg)], [1, true], 'one peak outline; earlier and later cells share one range grey (owner: now + today\'s range)');
});
test('forecast cells: a light grey (owner 2026-11-14 "maybe a lighter gray")', () => {
  const lc = (m) => { D.mode = m; const s = D.meter({ frac: 0.3, past: null, later: 0.9, peak: 0.9 }, 300, 30, 10); D.mode = null; return (s.match(/data-sw-st="l"><g class="([^"]+)"/) || [])[1]; };
  eq([lc({ dark: false, bits: 1 }), lc({ dark: false, bits: 4 })], ['text--gray-75', 'text--gray-40'], '1-bit gray-75; X light gray-40 (B18 2026-11-15: gray-75 is the X panel grey, the cells did not show; B26 owner go 2026-11-15: the empty outline is gray-50, 85 from the panel, so the forecast fill went from gray-55 to gray-40; render check FORECAST and EMPTYC)');
});
// removed 'sensor readings in the shape TRMNL shows' and 'sensor_device picks one device': they ran the transform-side parser, which is gone; a screen shows only its own sensor (owner 2026-11-14), covered by the render cases og-sens-devid, og-sens-other*, og-sens-noid
test('moon tilt: bright limb as the observer sees it (owner 2026-11-14, true tilt)', () => {
  const L = (t, la, lo) => T.moonLimb(Date.parse(t), la, lo), near = (a, b, tol) => Math.abs(((a - b + 540) % 360) - 180) <= tol;
  ok(near(L('2026-11-14T18:00Z', 50.85, 3.35), 242, 6), 'Deerlijk 2026-11-14 19h: waxing crescent lit low on the right (reference site), ' + L('2026-11-14T18:00Z', 50.85, 3.35));
  ok(near(L('2026-11-14T09:00Z', -33.87, 151.21), 151, 6), 'Sydney the same evening: lit low on the left (southern sky flips), ' + L('2026-11-14T09:00Z', -33.87, 151.21));
  ok(near(L('2026-12-01T06:00Z', 50.85, 3.35), 109, 6), 'Deerlijk 2026-12-01 07h: waning, lit on the left, ' + L('2026-12-01T06:00Z', 50.85, 3.35));
  eq(T.moonLimb(NaN, 50, 3), null); eq(T.moonLimb(Date.parse('2026-11-14T18:00Z'), undefined, 3), null);
  const p = T.moonPhase('2026-11-14T19:00', 3600); ok(p > 0.14 && p < 0.19, 'phase at the refresh time, waxing crescent ' + p);
  ok(T.moonPhase('2026-11-14T23:00', 3600) > p, 'later the same evening: further on');
  D.mode = { bits: 4 }; const s = D.moon(p, 100, 242); D.mode = null;
  ok(/data-sw-moon="lit" transform="rotate\((-?[\d.]+) 50 50\)"/.test(s) && /rotate\(28 50 50\)/.test(s), 'the lit part rotated from the right (270) to 242: 28 degrees clockwise');
  ok(!/rotate/.test(D.moon(p, 100)), 'no location: no rotation');
});
test('moon drawn from the phase: lit fraction within 10 % for crescent, quarter, gibbous and full, light and dark, lit side right while waxing', () => {
  const H = 100, r = H * 0.27, disk = Math.PI * r * r;
  [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9].forEach((p) => {
    const want = (1 - Math.cos(2 * Math.PI * p)) / 2;
    [false, true].forEach((dark) => {
      D.mode = { dark, bits: 4 }; const s = D.moon(p, H); D.mode = null;
      const d = /<path d="([^"]+)" data-sw-moon="lit"/.exec(s)[1], a = pathArea(d);
      ok(Math.abs(a.area / disk - want) <= 0.1, 'p ' + p + (dark ? ' dark' : ' light') + ': lit ' + (a.area / disk).toFixed(3) + ' want ' + want.toFixed(3));
      if (want < 0.99) ok(p < 0.5 ? a.mx > H / 2 : a.mx < H / 2, 'p ' + p + ': lit on the ' + (p < 0.5 ? 'right' : 'left'));
      ok(/<circle[^>]*fill="none"/.test(s) && !/text--gray-45"><circle[^>]*fill="none"/.test(s), 'limb outline in full ink, light and dark (Calm, owner)');
      ok(dark ? !/text--gray-45"><path/.test(s) : /text--gray-20"><circle[^>]*data-sw-moon="disk"\/><\/g><g class="text--white"><path/.test(s), dark ? 'dark: lit part in full (light) ink' : 'light: dark disc, lit part white on it (owner 2026-11-14, printed moon-phase icon)');
    });
  });
  D.mode = { bits: 4 }; const nm = D.moon(0, H); D.mode = null;
  ok(!/<path/.test(nm) && /text--gray-20"><circle[^>]*data-sw-moon="disk"/.test(nm) && /<circle[^>]*fill="none"/.test(nm), 'new moon: a dark disc with its outline, no lit part (owner 2026-11-14)');
  for (let d = 1; d <= 30; d++) { const t = '2026-11-' + String(d).padStart(2, '0') + 'T12:00', ic = T.moonIcon(t), p = T.moonPhase(t);
    if (ic === 'wi-moon-alt-full') ok(Math.abs(p - 0.5) < 0.03, t + ' full at ' + p); if (ic === 'wi-moon-alt-new') ok(p < 0.03 || p > 0.97, t + ' new at ' + p); }
  eq(T.moonPhase(null), null);
});
test('parka needs the coldest felt under 3 C AND the warmest felt under 8 C (owner 2026-11-16); otherwise the top by the warmest', () => {
  const C = (o, F) => T.cueFor(Object.assign({ rain: false, wind: null, gust: null, lo: null, hi: null, uv: null, day: true }, o), F).join('+');
  eq([C({ lo: 1, hi: 7.9 }), C({ lo: 1, hi: 8 }), C({ lo: 2.9, hi: 5 }), C({ lo: 3, hi: 5 }), C({ lo: -5, hi: 15 }), C({ lo: -5, hi: 11.9 })], ['parka', 'jacket', 'parka', 'jacket', 'sweater', 'jacket'], 'both limits; a cold morning with a mild afternoon is no parka');
  eq([C({ lo: 37.4, hi: 46 }, true), C({ lo: 37.2, hi: 46 }, true), C({ lo: 37.2, hi: 46.4 }, true)], ['jacket', 'parka', 'jacket'], 'Fahrenheit: 3 C = 37.4 F, 8 C = 46.4 F');
  const day = T.dayCueInput({ time: ['2026-11-08T07:00', '2026-11-08T12:00', '2026-11-08T16:00'], apparent_temperature: [1, 9, 16] }, { time: ['2026-11-08'] }, 0);
  eq([day.lo, day.hi, T.cueFor(day, false)[0]], [1, 16, 'sweater'], 'felt 1 at 07:00 and 16 in the afternoon: not a parka (the top follows the warmest, 16 is under 18)');
});
test('barometer trend over 3 h with +/-1 hPa thresholds; clothing cues for every rule and limit', () => {
  eq([T.pressTrend(1011, 1010), T.pressTrend(1010.9, 1010), T.pressTrend(1009, 1010), T.pressTrend(1009.1, 1010), T.pressTrend(1010, null), T.pressTrend(null, 1010)], ['rising', 'steady', 'falling', 'steady', null, null]);
  const C = (o, F) => T.cueFor(Object.assign({ rain: false, wind: null, gust: null, lo: null, hi: null, uv: null, day: true }, o), F).join('+');
  eq([C({ rain: true, lo: 15 }), C({ rain: true, lo: 15, wind: 80, gust: 120 }), C({ rain: true, lo: 1 })], ['sweater+umbrella', 'sweater+umbrella', 'parka+umbrella'], 'rain: always the umbrella extra, the top by felt temperature; no raincoat (owner)');
  eq([C({ lo: -2.1, hi: 25 }), C({ lo: 2.9, hi: 25 }), C({ lo: 3, hi: 25 }), C({ lo: -2.1, hi: 5 }), C({ lo: 2.9, hi: 5 }), C({ lo: 3, hi: 5 })], ['tshirt', 'tshirt', 'tshirt', 'parka', 'parka', 'jacket'], 'parka under 3 from the coldest AND under 8 from the warmest (owner 2026-11-16: a cold morning with a warm afternoon is no parka), no beanie');
  eq([C({ lo: 40.8 }, true), C({ lo: 41 }, true), C({ lo: 37.3 }, true), C({ lo: 37.4 }, true)], ['jacket', 'jacket', 'parka', 'jacket'], 'Fahrenheit: 5 C = 41 F, 3 C = 37.4 F');
  eq([C({ lo: 5, hi: 15, uv: 6 }), C({ lo: 5, hi: 15, uv: 5.9 }), C({ lo: 5, hi: 15, uv: 8, day: false }), C({ lo: 1, uv: 9 })], ['sweater', 'sweater', 'sweater', 'parka'], 'no sunglasses at any UV (owner)');
  eq([C({ hi: 11.9 }), C({ hi: 12 }), C({ hi: 17.9 }), C({ hi: 18 }), C({ hi: 53.5 }, true), C({ hi: 53.6 }, true), C({ hi: 64.3 }, true), C({ hi: 64.4 }, true)], ['jacket', 'sweater', 'sweater', 'tshirt', 'jacket', 'sweater', 'sweater', 'tshirt'], 'tops from the warmest: jacket under 12, sweater under 18, t-shirt; F 53.6 and 64.4');
  eq([C({ rain: true, lo: -5, uv: 7 }), C({ rain: true, wind: 40, lo: -5, uv: 7 })], ['parka+umbrella', 'parka+umbrella'], 'top layer and umbrella only');
  eq([C({}), C({ uv: 8 }), C({ rain: true })], ['', '', 'umbrella'], 'no temperature: no top layer, the umbrella still applies');
  const i = T.buildI18n('nl');
  eq([i.ours.p_steady, i.ours.p_rising, i.ours.p_falling], ['STABIEL', 'STIJGEND', 'DALEND']);
  eq(T.buildI18n('xx').ours.p_rising, 'RISING', 'unknown language falls back to English');
  const f = fx('mixed');
  const M = SWModel.build(f, {}), calm = T.buildView(M, i, f.daily, null, 0.3, { pressAgo: 1015 }), none = T.buildView(M, i, f.daily, null, 0.3);
  eq([calm.cue, calm.baro.trend], [['sweater', 'umbrella'], 'DALEND'], 'mixed has rain in the window, 1013.2 now against 1015; the cue is today\'s column cue (owner 2026-11-16)');
  eq(none.baro.trend, null, 'no pressure 3 h ago: no trend');
});
test('past_hours=3: the past hours are cut so every hourly list starts at the current hour; the pressure 3 h ago is kept', () => {
  const f = fx('mixed'), p = JSON.parse(JSON.stringify(f)), H = p.hourly;
  H.pressure_msl = H.time.map((_, k) => 1013 - k);
  ['2026-11-08T03:00', '2026-11-08T04:00', '2026-11-08T05:00'].reverse().forEach((t, j) => Object.keys(H).forEach((k) => H[k].unshift(k === 'time' ? t : (k === 'pressure_msl' ? 1020 + j : H[k][0]))));
  const d = T.dropPast(p);
  eq(d.ago, 1022, 'pressure at 03:00');
  eq(d.weather.hourly.time[0], f.hourly.current_time || f.current.time);
  const a = SWModel.build(f, {}), b = SWModel.build(d.weather, {});
  eq(b.hours.map((q) => [q.h, q.t, q.p]), a.hours.map((q) => [q.h, q.t, q.p]), 'hours unchanged by the cut');
  eq(b.rain, a.rain, 'rain window unchanged');
  eq(T.dropPast(f).ago, null, 'no past hours: no trend');
  eq(T.dropPast(null).weather, null);
});
test('hours strip: 12 hours from now, stamps per time format, rain only on wet hours, one scale holding every hour', () => {
  const f = fx('mixed'), M = SWModel.build(f, {}), i = T.buildI18n('nl');
  const v = T.buildView(M, i, f.daily, null, 0.3, { hours: true }), d = T.buildView(M, i, f.daily, null, 0.3);
  ok(!('hours' in d) && !('hscale' in d), 'Days (default): no hours keys, the page stays as it was');
  eq(v.hours.length, 12);
  eq(v.hours.map((q) => q.hl), M.hours.filter((q, k) => k % 2 === 0).slice(0, 12).map((q) => q.hl), 'stamps every 2 hours from the (even) current hour (owner 2026-11-13)');
  const H = (h, p) => ({ h: h, hl: String(h).padStart(2, '0'), t: 5, p: p, wet: false, icon: 'cloudy', day: true }), hs13 = Array.from({ length: 25 }, (_, k) => H((13 + k) % 24, k === 2 ? 80 : 0));
  const s13 = T.hourStrip(hs13, String, '°', H(12, 0));
  eq(s13.hours.map((q) => q.hl).slice(0, 4), ['12', '14', '16', '18'], 'at 13:30 the slots are 12, 14, 16 (even hours; 12 from the hour before)');
  eq(s13.hours.map((q) => q.wet).slice(0, 3), [false, true, false], 'wet over the pair: 15:00 wet marks the 14 column');
  eq(T.hourStrip(hs13, String, '°', null).hours[0].hl, '13', 'no hour before: start at the current hour');
  eq(v.hours.map((q) => q.now), [true].concat(Array(11).fill(false)), 'only the current hour is now');
  const W1 = (q) => !!q && (q.p !== null ? q.p >= (q.wet ? 30 : 50) : q.wet); eq(v.hours.map((q) => q.wet), Array.from({ length: 12 }, (_, j) => W1(M.hours[2 * j]) || W1(M.hours[2 * j + 1])), 'wet as the rain window counts it, over each pair of hours');
  ok(v.hours.some((q) => q.wet) && v.hours.some((q) => !q.wet), 'mixed has wet and dry hours');
  ok(v.hours.every((q) => q.tV === null || (q.tV > v.hscale.a && q.tV <= v.hscale.b)), 'every hour above the floor, inside the scale');
  const dry = JSON.parse(JSON.stringify(f)); dry.hourly.precipitation_probability = dry.hourly.precipitation_probability.map(() => 0); dry.hourly.weather_code = dry.hourly.weather_code.map(() => 1);
  ok(T.buildView(SWModel.build(dry, {}), i, f.daily, null, 0.3, { hours: true }).hours.every((q) => !q.wet), 'dry: no rain stamps');
  eq(T.hourStrip([], String, '°'), null);
});
test('meters: forecast only, the later max from today\'s coming hours, the peak (WIND: max gust still to come) (owner 2026-11-13, forecast only 2026-11-14)', () => {
  const f = fx('mixed'), today = (k) => String(f.hourly.time[k]).slice(0, 10) === '2026-11-08';
  const g = JSON.parse(JSON.stringify(f)); g.current.time = '2026-11-08T13:00'; g.current.relative_humidity_2m = 30; g.current.wind_speed_10m = 12; g.current.wind_gusts_10m = 20; g.current.pressure_msl = 1010;
  g.hourly.relative_humidity_2m = f.hourly.time.map((t, k) => today(k) ? (k === 2 ? 55 : (k === 11 ? 95 : 40)) : 100);   // 08:00 55 (past), 17:00 95 (later), tomorrow 100
  g.hourly.wind_speed_10m = f.hourly.time.map((t, k) => today(k) ? (k === 1 ? 33 : (k === 12 ? 21 : 8)) : 50); g.hourly.wind_gusts_10m = f.hourly.time.map((t, k) => today(k) ? (k === 4 ? 52 : 15) : 99);
  g.hourly.pressure_msl = f.hourly.time.map((t, k) => today(k) ? (k === 3 ? 1031 : (k === 14 ? 1022 : 1005)) : 1049);
  const d = T.dropPast(g), raw = Object.assign({}, d.weather, { todayHourly: d.today });
  eq(d.weather.hourly.time[0], '2026-11-08T13:00', 'every other consumer still sees the hours from the current hour');
  const v = T.buildView(SWModel.build(raw, {}), T.buildI18n('nl'), g.daily), m = (k) => v.meters.find((q) => q.key === k) || {};
  const r2 = (x) => x === null || x === undefined ? x : Math.round(x * 1000) / 1000, P = (k) => [m(k).frac, m(k).past, m(k).later, m(k).peak].map(r2);
  eq(P('humidity'), [0.3, null, 0.95, 0.95], 'humidity: now 30, earlier 55 not shown, later 95 (tomorrow\'s 100 not counted)');
  eq(P('wind'), [0.2, null, 0.35, 0.333], 'wind: later speed 21, peak the max gust from now on 20 (the earlier 52 and tomorrow\'s 99 not counted)');
  eq(P('baro'), [0.5, null, 0.65, 0.65], 'baro: later 1022 on 970..1050 (the earlier 1031 not shown); peak the later max');
  eq(D.cellStates(m('humidity'), 10).st.join(''), 'aaalllllll', 'humidity on 10 cells');
  const none = T.buildView(SWModel.build(f, {}), T.buildI18n('nl'), f.daily), h = none.meters.find((q) => q.key === 'humidity');
  eq([h.past, h.later], [null, null], 'no hourly humidity: no earlier or later cells');
  eq(v.meters.filter((q) => q.key === 'co2' || q.key === 'pollen').filter((q) => q.past !== null || q.later !== null || q.peak !== null).length, 0, 'CO2 and pollen: no marks');
});
test('today: the console cue and the week column come from one function on today 07:00 to 19:00 (Fable review wip 11: parka in the panel, sweater in the column)', () => {
  const f = fx('mixed'), M = SWModel.build(f, {}), i = T.buildI18n('nl'), date = f.daily.time[0];
  const ht = [], at = [];
  for (let h = 0; h < 24; h++) { ht.push(date + 'T' + String(h).padStart(2, '0') + ':00'); at.push(h < 8 || h > 15 ? 1 : 13); }
  at[7] = 1;
  const v = T.buildView(M, i, f.daily, null, 0.3, { hourly: { time: ht, apparent_temperature: at } });
  eq([v.days[0].today, v.cue.join('+'), v.days[0].cue.join('+')], [true, v.days[0].cue.join('+'), v.days[0].cue.join('+')], 'the panel and today column show the same advice');
  eq(v.cue[0], 'sweater', 'coldest 1, warmest 13: no parka (the warmest is not under 8), the top follows the warmest');
  const w = T.buildView(M, i, f.daily, null, 0.3, { hourly: { time: ht, apparent_temperature: at.map((x) => x === 13 ? 6 : x) } });
  eq([w.cue[0], w.days[0].cue[0]], ['parka', 'parka'], 'coldest 1, warmest 6: the parka in both');
});
test('per-day clothing cue: daytime hours 07:00 to 19:00 from the hourly data, daily values where the hours are missing', () => {
  const d = { time: ['2026-11-08', '2026-11-09'], temperature_2m_min: [0, 8], temperature_2m_max: [10, 15], apparent_temperature_min: [-5, 6], apparent_temperature_max: [8, 14], precipitation_probability_max: [90, 10], uv_index_max: [1, 7] };
  const ht = [], at = [], pp = [];
  for (let h = 0; h < 24; h++) { ht.push('2026-11-08T' + String(h).padStart(2, '0') + ':00'); at.push(h < 7 || h > 19 ? -9 : (h === 7 ? 4 : 13)); pp.push(h === 20 ? 99 : 20); }
  const H = { time: ht, apparent_temperature: at, precipitation_probability: pp };
  const a = T.dayCueInput(H, d, 0);
  eq([a.lo, a.hi, a.rain, a.uv], [4, 13, false, 1], 'only 07..19: the night cold and the 20:00 rain do not count');
  eq(T.cueFor(a, false), ['sweater']);
  const at7 = at.slice(); at7[19] = 2.5; eq(T.dayCueInput(Object.assign({}, H, { apparent_temperature: at7 }), d, 0).lo, 2.5, '19:00 is in the window');
  const b = T.dayCueInput(H, d, 1);
  eq([b.lo, b.hi, b.rain, b.uv], [6, 14, false, 7], 'no hours for the day: daily fields');
  eq(T.cueFor(b, false), ['sweater']);
  const c = T.dayCueInput(null, { time: ['2026-11-08'], temperature_2m_min: [1], temperature_2m_max: [9], precipitation_probability_max: [60] }, 0);
  eq([c.lo, c.hi, c.rain, T.cueFor(c, false)], [1, 9, true, ['jacket', 'umbrella']], 'no felt fields: air temperature; rain from the daily value (the warmest 9 is no parka)');
  const f = fx('mixed'), M = SWModel.build(f, {}), i = T.buildI18n('nl');
  const v = T.buildView(M, i, f.daily, null, 0.3, { hourly: f.hourly });
  ok(v.days.every((q) => Array.isArray(q.cue) && q.cue.length >= 1 && q.cue.length <= 2), 'top layer and at most the umbrella on every day');
  eq(v.days.map((q) => q.cue), v.days.map((q, k) => T.cueFor(T.dayCueInput(f.hourly, f.daily, k), false).slice(0, 3)), 'days: the list capped at 3');
});
test('days axis (owner bug): from the values as shown (rounded, -0 as 0) and only the days a view shows; the current temperature counts', () => {
  const f = JSON.parse(JSON.stringify(fx('mixed'))), D = f.daily;
  D.temperature_2m_min = D.temperature_2m_min.map((v, k) => k < 5 ? -0.4 : (k === 5 ? -3 : 4)); D.temperature_2m_max = D.temperature_2m_max.map(() => 8);
  f.current.temperature_2m = 1.6;
  const v = T.buildView(SWModel.build(f, {}), T.buildI18n('nl'), f.daily, null, 0.3, {});
  eq(v.days.slice(0, 5).map((d) => d.lo), ['0°', '0°', '0°', '0°', '0°'], 'lows -0.4 show as 0');
  ok(v.scales && v.scales[5], 'a scale per shown row count');
  eq([v.scales[5].a, v.scales[6].a], [0, -5], '5 rows: the hidden 6th day at -3 does not widen the axis; 6 rows: it does');
  f.current.temperature_2m = -1; eq(T.buildView(SWModel.build(f, {}), T.buildI18n('nl'), f.daily, null, 0.3, {}).scales[5].a, -5, 'the current temperature still counts');
});
test('every plugin/src file stays under 98 KiB: TRMNL refuses an import over 100 KB (step 18: shared.liquid reached 102.3 KB)', () => {
  const dir = path.join(__dirname, '../../plugin/src');
  fs.readdirSync(dir).forEach((n) => { const b = fs.statSync(path.join(dir, n)).size; ok(b < 98 * 1024, n + ' is ' + b + ' bytes, limit ' + 98 * 1024); });
});
test('plugin/src/shared.liquid is the build of source/shared.liquid: run node tools/build.js (owner 2026-11-13)', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sw-build-'));
  const out = path.join(tmp, 'shared.liquid');
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, '../../tools/build.js'), out], { stdio: 'pipe' });
  const built = fs.readFileSync(out, 'utf8'); fs.rmSync(tmp, { recursive: true });
  ok(built === fs.readFileSync(path.join(__dirname, '../../plugin/src/shared.liquid'), 'utf8'), 'plugin/src/shared.liquid differs from the build of source/shared.liquid: run `node tools/build.js` and commit both');
});
test('built shared.liquid stays under 95 KB (owner 2026-11-16: 95 KB, Blocks style back): a source edit that pushes it over must cut code first (limit 98 KiB above is the hard one)', () => {
  const b = fs.statSync(path.join(__dirname, '../../plugin/src/shared.liquid')).size;
  ok(b < 95 * 1000, 'plugin/src/shared.liquid is ' + b + ' bytes after the build, budget ' + 95 * 1000 + ': trim source/shared.liquid (dead code, duplicates), not the guard');
});
async function hangTest() {   // owner 2026-11-14: 'Transform timed out after 5s' (TRMNL limit); a request that never answers must not hold the run
  const of = global.fetch, t0 = Date.now(), keep = setInterval(() => {}, 1000);   // AbortSignal.timeout does not hold the Node loop
  global.fetch = (u, o) => new Promise((res, rej) => { if (o && o.signal) o.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  let out = null; try { out = await T.run({ trmnl: { user: { locale: 'nl' }, system: { timestamp_utc: Date.UTC(2026, 10, 8, 5, 10) / 1000 }, plugin_settings: { custom_fields_values: { lat_lon: '50.8,3.4' } } } }); } finally { global.fetch = of; clearInterval(keep); }
  const ms = Date.now() - t0;
  ok(ms < 3000, 'a hanging Open-Meteo request ends the run in ' + ms + ' ms (TRMNL stops at 5000 incl. VM start)');
  ok(out && typeof out === 'object', 'and the run still returns a view');
}
async function deafTest() {   // a request that ignores its abort signal: only the run deadline (RUN_MS) ends it
  const of = global.fetch, t0 = Date.now(), keep = setInterval(() => {}, 1000);
  global.fetch = () => new Promise(() => {});
  let out = null; try { out = await T.run({ trmnl: { user: { locale: 'nl' }, system: { timestamp_utc: Date.UTC(2026, 10, 8, 5, 10) / 1000 }, plugin_settings: { custom_fields_values: { lat_lon: '50.8,3.4' } } } }); } finally { global.fetch = of; clearInterval(keep); }
  const ms = Date.now() - t0;
  ok(ms < 3200, 'a request deaf to its abort signal ends the run in ' + ms + ' ms');
  ok(out && typeof out === 'object', 'and the run still returns a view');
}
async function pollTest() {   // owner 2026-11-14: own requests with deadlines, no polling URLs; IDX_0/IDX_1 still used when present
  const y = fs.readFileSync(path.join(__dirname, '../../plugin/src/settings.yml'), 'utf8');
  ok(/^strategy: static$/m.test(y) && /^polling_url: ''$/m.test(y), 'no polling URLs: a failed one fails the whole refresh before the transform (owner 2026-11-14)');
  const of = global.fetch; let calls = 0; global.fetch = async () => { calls++; throw new Error('no network'); };
  let out; try { out = await T.run({ IDX_0: fx('mixed'), IDX_1: {}, trmnl: { user: { locale: 'nl' }, system: { timestamp_utc: Date.UTC(2026, 10, 8, 5, 10) / 1000 }, plugin_settings: { custom_fields_values: { lat_lon: '50.8,3.4' } } } }); } finally { global.fetch = of; }
  ok(out && out.model && out.model.now && out.model.now.temp !== null, 'weather from IDX_0 without fetching it');
  eq(calls, 1, 'only the unusable IDX_1 (no current) is fetched again');
}
async function sensorSettingsTests() {
  const originalFetch = global.fetch;
  global.fetch = async (url) => ({ ok: true, json: async () => url.includes('air-quality') ? {} : fx('mixed') });
  const sensor = { device_1: { temperature: [{ '2026-11-08 05:30:00 UTC': 21.6 }], humidity: [{ '2026-11-08 05:30:00 UTC': 48 }], carbon_dioxide: [{ '2026-11-08 05:30:00 UTC': 1600 }], pressure: [{ '2026-11-08 05:30:00 UTC': 1010 }] } };
  const run = (values, nested = false, readings = sensor) => T.run({ sensor_readings: nested ? undefined : readings, trmnl: { user: { locale: 'nl' }, sensor_readings: nested ? readings : undefined, plugin_settings: { custom_fields_values: values } } });
  async function check(name, fn) {
    try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  }
  try {
    // removed 'sensor_co2: hide removes only CO2' and the parts of the two checks below that gave the transform readings: on TRMNL the input never carries sensor_readings (owner's live payload), so no reading reaches the transform
    await check('the transform ignores sensor_readings in its input and keeps the payload small (owner 2026-11-14)', async () => {
      const none = await run({}, false, null);
      for (const nested of [false, true]) {
        const r = await run({}, nested);
        eq(r.ui, none.ui, 'readings in the input change nothing');
        eq(r.model.inn, none.model.inn, 'no model readings');
        ok(!('sensors' in r) && !('sens_in' in r) && !('ui_in' in r) && !('ui_in_t' in r), 'no sensor leftovers in the payload');
      }
      const size = Buffer.byteLength(JSON.stringify(none));
      ok(size < 22000, 'payload ' + size + ' bytes, the sensor path adds only a small overlay');
      const io = { inn: none.ph.inn, twin: none.ph.twin, tw: none.ph.tw };
      ok(Buffer.byteLength(JSON.stringify(io)) < 400, 'indoor overlay ' + Buffer.byteLength(JSON.stringify(io)) + ' bytes');
      ok(Buffer.byteLength(JSON.stringify(none.ph)) < 1200, 'overlay with the CO2 meter lists ' + Buffer.byteLength(JSON.stringify(none.ph)) + ' bytes');
    });
    await check('sensor_source none leaves no overlay at all (no CO2 meter either), This TRMNL and the default carry it', async () => {
      const hid = await run({ sensor_source: 'none' }, false, null);
      eq([hid.ph, hid.ui.inn], [null, null], 'None: no indoor overlay and no CO2 meter (owner 2026-11-15: the CO2 meter follows the Sensor setting)');
      ok(!/keyname: sensor_co2/.test(fs.readFileSync(path.join(__dirname, '../../plugin/src/settings.yml'), 'utf-8')), 'owner 2026-11-15: no sensor_co2 setting any more, the CO2 meter follows the Sensor source');
      for (const values of [{}, { sensor_source: 'own' }]) { const r = await run(values, false, null); eq([r.ph.inn.out, r.ph.inn.in, r.ph.tw.k, r.ui.inn], ['BUITEN', 'BINNEN', 'humidity', null]); }
    });
    await check('B13: another TRMNL\'s sensor, label and main reading come from the settings into the overlay', async () => {
      const d = await run({}, false, null);
      eq([d.ph.id, d.ph.im, d.ph.lab, d.ph.inn.im], ['', true, null, true], 'defaults: this screen\'s sensor, sensor main, no label');
      const own = await run({ sensor_label: ' living  room ' }, false, null);
      eq([own.ph.id, own.ph.im, own.ph.lab, own.ph.l8], ['', true, 'LIVING ROOM', undefined], 'own sensor with a label: still main, label upper case, spaces tidied, no short form (the page Clamp cuts)');
      const rem = await run({ sensor_source: 'other', sensor_device_id: ' 2 ', sensor_label: 'Upstairs' }, false, null);
      eq([rem.ph.id, rem.ph.im, rem.ph.inn.im, rem.ph.lab], ['2', false, false, 'UPSTAIRS'], 'another device: Automatic makes outside main');
      for (const [pri, id, want] of [['auto', '', true], ['auto', '7', false], ['sensor', '', true], ['sensor', '7', true], ['outside', '', false], ['outside', '7', false], ['bogus', '7', false]]) {
        eq((await run({ sensor_primary: pri, sensor_source: id ? 'other' : 'own', sensor_device_id: id }, false, null)).ph.im, want, 'sensor_primary ' + pri + (id ? ' with an id' : ' own sensor'));
      }
      eq((await run({ sensor_source: 'other', sensor_device_id: 'abc 12x3' }, false, null)).ph.id, '123', 'the id keeps its digits only');
      const bad = await run({ sensor_label: '<b>"x"</b>&' }, false, null);
      ok(!/[<>"'&]/.test(bad.ph.lab), 'no markup characters survive in the label: ' + bad.ph.lab);
      const lg = await run({ sensor_label: 'Upstairs guest bedroom north wing' }, false, null), one = await run({ sensor_label: 'a'.repeat(60) }, false, null);
      eq([lg.ph.lab, one.ph.lab.length], ['UPSTAIRS GUEST BEDROOM NORTH WING', 40], 'a long label stays whole (the page Clamp cuts it to its space); only a bound of 40 characters on the data');
      eq((await run({ sensor_source: 'none', sensor_device_id: '2' }, false, null)).ph, null, 'None ignores the device number and shows nothing');
      eq([(await run({ sensor_source: 'own', sensor_device_id: '2' }, false, null)).ph.id, (await run({ sensor_source: 'other', sensor_device_id: 'abc' }, false, null)).ph.id, (await run({ sensor_source: 'other', sensor_device_id: '' }, false, null)).ph.im], ['', '', true], 'Another TRMNL with an empty or non-numeric number is this TRMNL: no id, the sensor is the main reading (owner 2026-11-15: TRMNL saves the form without the number)');
    });
    await check('B13: with the outside reading main, the sensor\'s meters come after the outdoor ones (CO2 last, the twin humidity pair together)', async () => {
      const so = await run({ sensor_source: 'other', sensor_device_id: '2' }, false, null), me = await run({}, false, null);
      const k = (l) => l.map((m) => m.key);
      eq(k(me.ph.mn)[0], 'co2', 'sensor main: CO2 first, as before');
      eq(k(so.ph.mn).slice(-1), ['co2'], 'outside main: CO2 last');
      ok(k(so.ph.hn).indexOf('humidity') >= 0 && k(so.ph.hn).indexOf('co2') < 0, 'the list without CO2 keeps the humidity twin');
      eq(k(so.ph.mn).filter((x) => x !== 'co2'), k(me.ph.mn).filter((x) => x !== 'co2').sort((a, b) => k(so.ph.mn).indexOf(a) - k(so.ph.mn).indexOf(b)), 'the other meters keep one order');
      eq(so.ph.tw.k, 'humidity', 'the humidity row is still the twin');
    });
    await check('CO2 overlay (owner 2026-11-14, changed 2026-11-15: no sensor_co2 setting, the CO2 meter follows the Sensor source, None = none): the overlay always carries the CO2 list, None carries nothing', async () => {
      const on = await run({}, false, null), only = await run({ sensor_source: 'none' }, false, null);
      const slim = (l) => l.map((m) => Object.keys(m).sort().join());
      ok(Array.isArray(on.ph.mn) && on.ph.mn.length > 0 && Array.isArray(on.ph.hn), 'the CO2 list and the list without CO2');
      ok(slim(on.ph.mn).every((k) => k === 'idx,key,label,rank') && slim(on.ph.hn).every((k) => k === 'idx,key,label,rank'), 'lists hold key, label, idx, rank only (no view copies)');
      eq([on.ph.mn[0].key, on.ph.hn[0].key, on.ph.mu], ['co2', 'humidity', undefined], 'owner 2026-11-14: CO2 first at any reading (one list, no high-reading variant), the humidity twin first without CO2');
      eq(only.ph, null, 'owner 2026-11-15: Sensor None = no CO2 meter at all');
      eq(on.ui.meters.some((m) => m.key === 'co2'), false, 'the plain view never carries CO2');
    });
    await check('CO2 overlay parity: the meters of the view with a stand-in reading equal the page script merge of the list, with and without the other meters', async () => {
      const raw = fx('mixed'), i18n = T.buildI18n('nl');
      const mk = (co2, tweak) => { const M = SWModel.build(raw, {}); if (tweak) tweak(M); M.inn = { temp: null, hum: null, co2, press: null }; return T.buildView(M, i18n, raw.daily); };
      const slim = (l) => l.map((m) => ({ key: m.key, label: m.label, idx: m.idx, rank: m.rank }));
      // the page script's merge (source/shared.liquid, SWP): the meters already in the view plus the CO2 one, in the list's order
      const merge = (base, ph, co2) => ph.mn.map((e) => { const b = base.filter((m) => m.key === e.key)[0] || { key: e.key, label: e.label, frac: Math.max(0, Math.min(1, (co2 - 400) / 1600)), past: null, later: null, peak: null, zones: ph.cz }; return Object.assign({}, b, { idx: e.idx, rank: e.rank }); });
      const tweaks = [null, (M) => { M.now.aqi = null; M.now.hum = null; }, (M) => { M.now.pollen = 0; M.now.wind = null; M.today.uvMax = 5; M.now.day = true; }, (M) => { M.now.aqi = null; M.now.hum = null; M.now.pollen = 0; M.now.wind = null; M.now.press = null; }];
      tweaks.forEach((tw, ti) => {
        const base = mk(null, tw), mn = mk(800, tw);
        const ph = { mn: slim(mn.meters), cz: mn.meters.filter((m) => m.key === 'co2').map((m) => m.zones)[0] || null };
        [[800, mn], [1800, mn], [1401, mn], [1400, mn]].forEach(([c, want]) => {
          const got = merge(base.meters, ph, c);
          eq(got.map((m) => m.key + m.idx + m.rank), want.meters.map((m) => m.key + m.idx + m.rank), 'order, idx, rank (variant ' + ti + ', ' + c + ' ppm)');
          const g = got.filter((m) => m.key === 'co2')[0], w = want.meters.filter((m) => m.key === 'co2')[0];
          if (w) { eq([g.label, g.zones], [w.label, w.zones], 'co2 label and zones'); ok(Math.abs(g.frac - (c - 400) / 1600) < 1e-9, 'co2 frac'); }
          got.filter((m) => m.key !== 'co2').forEach((m) => { const o = want.meters.filter((q) => q.key === m.key)[0]; eq(Object.assign({}, m, { idx: o.idx, rank: o.rank }), Object.assign({}, o, { idx: o.idx, rank: o.rank }), 'other meters unchanged: ' + m.key); });
        });
      });
    });
    await check('overlay: the view with a stand-in reading equals the view plus the overlay, with and without a humidity meter', async () => {
      const raw = fx('mixed'), i18n = T.buildI18n('nl');
      const slimL = (l) => l.map((m) => ({ key: m.key, label: m.label, idx: m.idx, rank: m.rank }));
      // the page script's merge (source/shared.liquid, SWP): the overlay, and the indoor order of the list ph.hn (owner 2026-11-14: the humidity twin first)
      const merge = (u, o, hn) => { const v = JSON.parse(JSON.stringify(u)); v.inn = o.inn; v.tdial.twin = o.twin; if (o.tw) v.meters.forEach((m) => { if (m.key === o.tw.k) m.tw = { out: o.tw.out, in: o.tw.in, m: { frac: 0.5 } }; }); if (hn) v.meters = hn.map((e) => Object.assign({}, v.meters.filter((m) => m.key === e.key)[0], { idx: e.idx, rank: e.rank })); return v; };
      for (const noHum of [false, true]) {
        const mk = (inn) => { const M = SWModel.build(raw, {}); if (noHum) M.now.hum = null; M.inn = Object.assign({ temp: null, hum: null, co2: null, press: null }, inn); return T.buildView(M, i18n, raw.daily); };
        const a = mk({}), b = mk({ temp: a.tdial.now, hum: 50 }), o = T.phOverlay(b);
        eq(merge(a, o, slimL(b.meters)), JSON.parse(JSON.stringify(b)), 'overlay complete' + (noHum ? ' (no humidity meter)' : ''));
        eq(!!o.tw, !noHum, 'the twin meter key only with a humidity meter');
      }
    });
  } finally { global.fetch = originalFetch; }
}
// Saved state (owner 2026-11-13): the offline copy, the clothing/meter memory and the indoor trend.
const AT = Date.UTC(2026, 10, 8, 5, 0) / 1000;   // mixed.json: 2026-11-08T06:00 local, UTC+1
function bigAnswer() {   // every hourly and daily field the transform asks for, 24 past + 48 hours, 14 days, long decimals
  const f = fx('mixed'), t0 = Date.UTC(2026, 10, 7, 6), H = {}, D = {};
  H.time = Array.from({ length: 72 }, (_, i) => new Date(t0 + i * 3600e3).toISOString().slice(0, 16));
  ['temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation', 'pressure_msl', 'weather_code', 'is_day', 'wind_speed_10m', 'wind_gusts_10m', 'uv_index', 'relative_humidity_2m']
    .forEach((k, j) => { H[k] = H.time.map((_, i) => k === 'pressure_msl' ? 1013.25 + i / 7 : (k === 'weather_code' ? 61 : (k === 'is_day' ? i % 2 : -12.345 + i * 1.111 + j))); });
  D.time = f.daily.time;
  ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max', 'apparent_temperature_min', 'precipitation_probability_max', 'uv_index_max', 'wind_gusts_10m_max', 'precipitation_sum']
    .forEach((k, j) => { D[k] = D.time.map((_, i) => k === 'weather_code' ? 95 : -10.123 + i * 1.234 + j); });
  D.sunrise = f.daily.sunrise; D.sunset = f.daily.sunset;
  return Object.assign({}, f, { hourly: H, daily: D });
}
test('clothing hysteresis (owner 2026-11-13): the top layer stays until 1 C (2 F) past the threshold, then flip', () => {
  const c = (lo, hi, prev, F) => T.cueFor({ lo: lo, hi: hi, rain: false, day: true }, !!F, prev);
  eq(c(5, 12.5, null)[0], 'sweater', 'no memory: threshold as before');
  eq(c(5, 12.5, { top: 'jacket' })[0], 'jacket', 'warmer by 0.5: stays');
  eq(c(5, 12.9, { top: 'jacket' })[0], 'jacket', 'warmer by 0.9: stays');
  eq(c(5, 13, { top: 'jacket' })[0], 'sweater', 'warmer by 1: flips');
  eq(c(5, 11.2, { top: 'sweater' })[0], 'sweater', 'colder by 0.8: stays');
  eq(c(5, 10.9, { top: 'sweater' })[0], 'jacket', 'colder by 1.1: flips');
  eq(c(2.5, 6, { top: 'jacket' })[0], 'jacket', 'parka needs under 2 C');
  eq(c(1.9, 6, { top: 'jacket' })[0], 'parka');
  eq(c(-5, 0, { top: 'tshirt' })[0], 'parka', 'a big change skips levels');
  eq(c(55, 54.6, { top: 'jacket' }, true)[0], 'jacket', 'F: 53.6 threshold + 1 F stays');
  eq(c(55, 55.7, { top: 'jacket' }, true)[0], 'sweater', 'F: past by 2 F flips');
  ok(c(5.5, 20, { top: 'tshirt', bn: true, mit: true }).every((k) => k === 'tshirt' || k === 'umbrella'), 'an old saved {bn} or {mit} is accepted and ignored: no beanie, no mittens');
  eq(c(2.5, 8, { top: 'jacket', bn: true, mit: true })[0], 'jacket', 'old flags do not disturb the top layer');
});
test('lit meter labels (owner 2026-11-16): a value in the top zone lights its label, 2 % margin like the other flags, outdoor humidity never', () => {
  const f = fx('mixed'), view = (mut, prevMt) => { const m = SWModel.build(f, {}); m.now.day = true; mut(m); return T.buildView(m, T.buildI18n('en'), f.daily, null, 0.3, { prevMt: prevMt }); };
  const bad = (v, k) => (v.meters.filter((m) => m.key === k)[0] || {}).bad;
  eq(bad(view((m) => { m.now.wind = 55; }), 'wind'), true, 'wind 55 km/h (zone starts at 49.8): lit');
  eq(bad(view((m) => { m.now.wind = 20; }), 'wind'), false, 'wind 20: not lit');
  eq(bad(view((m) => { m.now.wind = 49.5; }), 'wind'), false, 'wind 49.5, no memory: not lit (below 49.8)');
  eq(bad(view((m) => { m.now.wind = 49.5; }, { bad: { wind: true } }), 'wind'), true, 'wind 49.5 after a lit reading: stays lit (margin)');
  eq(bad(view((m) => { m.now.wind = 50.5; }, { bad: { wind: false } }), 'wind'), false, 'wind 50.5 after an unlit reading: not yet lit (needs 51)');
  eq(bad(view((m) => { m.now.wind = 53; }, { bad: { wind: false } }), 'wind'), true, 'wind 53 after an unlit reading: lit');
  eq(bad(view((m) => { m.now.wind = 47; }, { bad: { wind: true } }), 'wind'), false, 'wind 47 after a lit reading: off');
  eq(bad(view((m) => { m.now.aqi = 70; }), 'aqi'), true, 'AQI 70: lit');
  eq(bad(view((m) => { m.now.aqi = 30; }), 'aqi'), false, 'AQI 30: not lit');
  eq(bad(view((m) => { m.now.hum = 10; }), 'humidity'), undefined, 'outdoor humidity 10 %: never flagged');
  eq(bad(view((m) => { m.now.hum = 99; }), 'humidity'), undefined, 'outdoor humidity 99 %: never flagged');
  eq(view((m) => { m.now.wind = 55; }).keep.mt.bad.wind, true, 'remembered for the next run');
  const src = fs.readFileSync(path.join(__dirname, '../../plugin/src/shared.liquid'), 'utf8');
  ok(/function swLit\(\)/.test(src) || /swLit/.test(src) || /label--inverted/.test(src), 'the page lights the label with the Framework class label--inverted');
});
test('meter flags with a margin (owner 2026-11-13): UV from today\'s max 3 (+/-0.5), high CO2 first past 1400 (+/-50)', () => {
  const f = fx('mixed'), view = (uvMax, co2, prevMt) => { const m = SWModel.build(f, {}); m.now.day = true; m.today.uvMax = uvMax; m.now.uv = 1; m.inn.co2 = co2; return T.buildView(m, T.buildI18n('en'), f.daily, null, 0.3, { prevMt: prevMt }); };
  const keys = (v) => v.meters.map((m) => m.key);
  ok(keys(view(3.2, null, null)).includes('uv'), 'no memory: 3.2 shows UV');
  ok(!keys(view(3.2, null, { uv: false })).includes('uv'), 'off, 3.2: stays off');
  ok(keys(view(3.6, null, { uv: false })).includes('uv'), 'off, 3.6: on');
  ok(keys(view(2.7, null, { uv: true })).includes('uv'), 'on, 2.7: stays on');
  ok(!keys(view(2.4, null, { uv: true })).includes('uv'), 'on, 2.4: off');
  eq(view(2.4, null, { uv: true }).keep.mt.uv, false, 'remembered');
  eq(keys(view(1, 1420, { co2: false }))[1] === 'co2', false, 'CO2 1420 after a low reading: not moved up');
  eq(keys(view(1, 1460, { co2: false }))[1], 'co2', 'CO2 1460: moved up');
  eq(keys(view(1, 1360, { co2: true }))[1], 'co2', 'CO2 1360 after a high reading: stays up');
  eq(keys(view(1, 1340, { co2: true }))[1] === 'co2', false, 'CO2 1340: back');
});
async function stateTests() {
  const originalFetch = global.fetch;
  let answer = null, aq = {};
  global.fetch = async (url) => { if (url.includes('air-quality')) return { ok: true, json: async () => aq }; if (!answer) throw new Error('offline'); return { ok: true, json: async () => answer }; };
  const run = (state, at = AT + 600, fields = {}, extra = {}) => T.run(Object.assign({ trmnl: { user: { locale: 'en' }, state: state, system: { timestamp_utc: at }, plugin_settings: { custom_fields_values: fields } } }, extra));
  async function check(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
  try {
    await check('state, first run: no state (missing, empty object) still renders and writes the copy', async () => {
      answer = fx('mixed');
      for (const st of [undefined, {}]) {
        const r = await run(st);
        eq(r.ui.ok, true); ok(!r.ui.stale, 'a good fetch is not stale');
        ok(r.trmnl_state && !Array.isArray(r.trmnl_state) && typeof r.trmnl_state === 'object', 'trmnl_state is an object');
        eq([r.trmnl_state.snap.at, r.trmnl_state.snap.ct, r.trmnl_state.snap.d0], [AT, '2026-11-08T06:00', '2026-11-08']);
      }
    });
    await check('fahrenheit asks Open-Meteo for inches and mph, celsius for mm', async () => {
      answer = fx('mixed'); const urls = [], f0 = global.fetch; global.fetch = async (u) => { urls.push(u); return f0(u); };
      try { await run(undefined, AT + 600, { unit: 'fahrenheit' }); await run(undefined, AT + 600, {}); } finally { global.fetch = f0; }
      const w = urls.filter((u) => u.startsWith('https://api.open-meteo.com'));
      ok(w[0].includes('precipitation_unit=inch') && w[0].includes('wind_speed_unit=mph'), 'F: ' + w[0]); ok(w[1].includes('precipitation_unit=mm'), 'C: ' + w[1]);
    });
    await check('state size: the full trmnl_state stays under 7000 bytes on the biggest answer', async () => {
      answer = bigAnswer(); aq = { current: { time: '2026-11-08T06:00', european_aqi: 33 }, hourly: { time: answer.hourly.time, european_aqi: answer.hourly.time.map((_, i) => 20 + i) } };
      const r = await run({}), n = Buffer.byteLength(JSON.stringify(r.trmnl_state));
      ok(n < 7000, 'state is ' + n + ' bytes');
      eq(r.trmnl_state.snap.h.temperature_2m.length, 51, '3 past hours, the current one and what the answer holds ahead (47; up to 51: 24 h of age plus 6 hours, B31 review)');
      aq = {};
    });
    await check('offline: a failed fetch shows the saved copy at the current hour, stale "as of", the copy written back unchanged', async () => {
      answer = fx('mixed'); const good = await run({}), snap = good.trmnl_state.snap;
      answer = null;
      const r = await run({ snap: snap }, AT + 4 * 3600 + 600);   // 10:10 local
      eq(r.ui.ok, true, 'renders from the copy');
      eq(r.ui.stale, 'as of 06:00');
      eq(r.model.hours[0].h, '10', 'past hours dropped');
      eq(r.clock, '10:10');
      eq(r.ui.temp, (Math.round(fx('mixed').hourly.temperature_2m[4] * 10) / 10).toFixed(1), 'the temperature of the current hour');
      eq(r.trmnl_state.snap, snap, 'copy unchanged');
      const p = await run({ snap: snap }, AT + 4 * 3600 + 600, { time_format: '12' });
      eq(p.ui.stale, 'as of 6:00 AM', 'time format setting');
    });
    await check('offline: older than 24 h, under 6 hours left, or no copy gives NO SIGNAL', async () => {
      answer = fx('mixed'); const snap = (await run({})).trmnl_state.snap;
      answer = null;
      // B31 review: the copy is the one snapOf writes (48 hours ahead), not a hand-made one: the promised 24 h really hold
      eq((await run({ snap: snap }, AT + 86400 - 60)).ui.ok, true, 'just under 24 h');
      eq((await run({ snap: snap }, AT + 86400 + 60)).ui.ok, false, 'older than 24 h');
      const short = JSON.parse(JSON.stringify(snap)); Object.keys(short.h).forEach((k) => { short.h[k] = short.h[k].slice(0, 9); });
      eq((await run({ snap: short }, AT + 3 * 3600 + 600)).ui.ok, true, '6 hours left (09:00 to 14:00)');
      eq((await run({ snap: short }, AT + 4 * 3600 + 600)).ui.ok, false, '5 hours left');
      eq((await run({})).ui.ok, false, 'no copy');
      ok(!('snap' in (await run({}, AT, {})).trmnl_state), 'no copy to keep');
    });
    await check('state shapes: a string, an array, a number, bad or missing keys never crash; a failed fetch then shows NO SIGNAL', async () => {
      answer = fx('mixed'); const snap = (await run({})).trmnl_state.snap;
      const bad = ['x', [1, 2], 7, null, { snap: 'x' }, { snap: [] }, { snap: {} }, { snap: Object.assign({}, snap, { h: 'x' }) }, { snap: Object.assign({}, snap, { h0: 5 }) },
        { snap: Object.assign({}, snap, { at: 'now' }) }, { snap: Object.assign({}, snap, { d: [], sr: 'x', aq: 'x', c: {} }) }, { snap: Object.assign({}, snap, { h: { temperature_2m: 'abc' } }) }, { snap: Object.assign({}, snap, { h: null, c: null, d: null }) }];
      for (const st of bad) {
        answer = fx('mixed'); const g = await run(st); eq(g.ui.ok, true, 'good fetch with state ' + JSON.stringify(st).slice(0, 40));
        answer = null; const f = await run(st); ok(f.ui && typeof f.trmnl_state === 'object', 'failed fetch with ' + JSON.stringify(st).slice(0, 40));
      }
      answer = null; const r = await run({ snap: Object.assign({}, snap, { d: [], sr: 'x', aq: 'x' }) });
      eq(r.ui.ok, true, 'a copy without days still shows now');
    });
    await check('state: the clothing cue and meter flags are remembered run to run; bad shapes ignored', async () => {
      answer = fx('mixed');
      const r = await run({});
      eq(r.trmnl_state.cue, { top: r.ui.cue[0] }, 'only the top layer is saved');
      ok(!('keep' in r.ui), 'memory not in the merge variables');
      const other = r.ui.cue[0] === 'parka' ? 'jacket' : 'parka';
      ok((await run({ cue: { top: other, bn: false } })).ui.cue[0] !== undefined);
      for (const bad of [{ cue: 'x' }, { cue: { top: 5 } }, { mt: [] }, { cue: null, mt: 'x' }]) eq((await run(bad)).ui.cue, r.ui.cue, 'ignored ' + JSON.stringify(bad));
    });
    // removed 'indoor trend: points per 30 min ...': the trend, low/high and CO2 arrow needed readings in the transform input, which TRMNL never sends (owner's live payload)
    await check('no indoor state: an old saved inn is dropped, nothing indoor is written', async () => {
      answer = fx('mixed');
      const S = Math.floor((AT + 600) / 1800), rd = { device_1: { temperature: [{ '2026-11-08 05:00:00 UTC': 21 }], carbon_dioxide: [{ '2026-11-08 05:00:00 UTC': 900 }] } };
      const r = await run({ inn: { d: '2026-11-08', lo: 19, hi: 21, p: [[S - 6, 20, 800]] } }, AT + 600, {}, { sensor_readings: rd });
      ok(!('inn' in r.trmnl_state), 'no inn in the saved state');
      ok(!r.ui.inn && !r.model.inn.temp, 'no indoor reading from the transform input');
    });
    await check('state size guard: an oversize state drops the copy, and always stays an object under 8000 bytes', () => {
      const big = { v: 1, snap: { pad: 'x'.repeat(5000) } };
      const a = T.fitState(big); ok(Buffer.byteLength(JSON.stringify(a)) <= 8000); eq(a.snap, big.snap, 'copy kept');
      const b = T.fitState({ v: 1, snap: { pad: 'x'.repeat(9000) } }); eq(b, { v: 1 });
      const c = { v: 1, snap: { a: 1 } }; eq(T.fitState(c), c, 'small state unchanged');
    });
  } finally { global.fetch = originalFetch; }
}
test('location icons (owner 2026-11-14, B10): the outdoor icon is ink on 1-bit (grey dithers away), grey on 2 bit; readout icons are sized by the script from the unit font', () => {
  const m0 = D.mode;
  D.mode = { bits: 1 }; const o1 = D.part({}, 'loc', 0, 40, 40), i1 = D.part({}, 'loc', 1, 40, 40);
  D.mode = { bits: 2 }; const o2 = D.part({}, 'loc', 0, 40, 40);
  D.mode = m0;
  ok(!/text--gray/.test(o1) && !/text--gray/.test(i1), '1-bit: no grey class on either icon');
  ok(/text--gray-30/.test(o2), '2-bit: the outdoor icon stays grey');
  ok(/data-sw-part="loc"[^>]*data-sw-lz/.test(sh) && /data-sw-lsp/.test(sh) && /1\.4 \* parseFloat\(getComputedStyle\(lzu\)\.fontSize\)/.test(sh), 'twin readout icons: marked, spacer marked, 1.4 unit fonts in swPaint');
});
async function aTest(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); } }
sensorSettingsTests().then(() => require('./sensors.js')({ T, fx, check: aTest, eq, ok })).then(stateTests).then(() => require('./review.js')({ T, fx, SWModel, check: aTest, eq, ok })).then(() => aTest('a hanging request ends within TRMNL\'s 5 s', hangTest)).then(() => aTest('a request deaf to its abort signal', deafTest)).then(() => aTest('no polling URLs; IDX data used when present', pollTest)).then(() => {
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
});
test('2-bit meter cells are the native dark grey, not black (owner 2026-11-13); week ranges are covered by the week colours test', () => {
  D.mode = { dark: false, bits: 2 }; const m = D.meter({ frac: 0.5 }, 200, 30, 5); D.mode = null;
  ok(/gray-30/.test(m) && !/text--black/.test(m), '2-bit meter cells gray-30, not black');
});

test('plugin name translated for the title bar when the instance name is the default (owner 2026-11-13)', () => {
  eq(['en-US', 'de', 'nl', 'fr-CA', 'ja', 'xx'].map((l) => T.buildI18n(l).ours.app), ['Hi-Fi Weather', 'Hi-Fi Weather', 'Hi-Fi Weather', 'Hi-Fi Weather', 'Hi-Fi Weather', 'Hi-Fi Weather']);
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../plugin/src/shared.liquid'), 'utf8');
  ok(/instance_name ?%\}\{% ?if (\w+) == blank or \1 == 'Hi-Fi Weather' or \1 == 'Radio Weather' ?%\}\{% ?assign \1 ?= ?i18n\.ours\.app/.test(src), 'title bar uses i18n.ours.app when instance_name is the default');
});

test('no shown label falls back to English in any locale (item 38.1)', () => {
  const tsrc = require('fs').readFileSync(require('path').join(__dirname, '../../plugin/src/transform.js'), 'utf8');
  const KEYS = eval(tsrc.match(/^var OURS_KEYS = (.*);$/m)[1]);
  const OURS = eval('(' + tsrc.match(/^var OURS = (.*);$/m)[1] + ')');
  const SHOWN = ['uv', 'pollen', 'm_hum', 'hum', 'baro', 'indoor', 'outdoor', 'p_steady', 'p_rising', 'p_falling', 'temperature', 'app', 'asof', 'no_signal'];
  const empty = [];
  Object.keys(OURS).forEach((l) => { const p = OURS[l].split('|'); SHOWN.forEach((k) => { if (!p[KEYS.indexOf(k)]) empty.push(l + ':' + k); }); });
  eq(empty, [], 'empty slots');
  ['ja', 'ko', 'zh-CN', 'zh-HK'].forEach((l) => { const p = OURS[l].split('|'); KEYS.forEach((k, i) => { if (!p[i] && !['raining_now'].includes(k)) empty.push(l + ':' + k); }); });
  eq(empty, [], 'empty CJK slots');
});

test('guide (owner 2026-11-16: the Legend field and the numbered legends are gone): the site guide section and the README explain every meter; About links the guide in every language', () => {
  const root = path.join(__dirname, '..', '..'), rd = (f) => fs.readFileSync(path.join(root, f), 'utf-8');
  const SITE = 'https://excusemi.github.io/trmnl-hifi-weather-plugin/';
  const y = rd('plugin/src/settings.yml'), parts = y.split(/^- keyname: /m).slice(1);
  const part = (k) => parts.find((q) => q.startsWith(k + '\n'));
  // the meter keys come from the transform (RO_ORDER) plus the rain gauge the markup draws
  const keys = JSON.parse(/var RO_ORDER = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"')).concat(['rain']);
  ok(keys.length === 8 && keys.includes('co2') && keys.includes('pollen'), 'meter keys read from transform.js: ' + keys);
  const site = rd('tools/site/page/index.html');
  ok(site.includes('id="guide"'), 'the site has the guide section');
  const LAB = { wind: 'WIND', uv: 'UV', aqi: 'AQI', humidity: 'HUM', pollen: 'POLLEN', baro: 'BARO', co2: 'CO2', rain: 'RAIN' };
  const readme = rd('README.md');
  ok(readme.includes('### Reading the screen') && readme.includes(SITE + '#guide'), 'README has the section and links the guide');
  keys.forEach((k) => ok(readme.includes('| ' + LAB[k] + ' |'), 'README table has a row for ' + k));
  // the numbers the texts quote are the code's: if a zone or scale moves, the texts move with it
  ok(/ZONES = \{ wind: \[0\.5, F_ \? 0\.75 : 0\.83\], co2: \[0\.375, 0\.625\], pollen: \[0\.3, 0\.6\], aqi: \[0\.4, 0\.6\], uv: \[3 \/ 11, 8 \/ 11\] \}/.test(src) && /SCL = \{ wind: \[0, F_ \? 40 : 60\], uv: \[0, 11\], aqi: \[0, 100\], humidity: \[0, 100\], baro: \[970, 1050\] \}/.test(src) && /bar\(M\.inn\.co2, 400, 2000\)/.test(src), 'warning zones and scales the guide quotes are unchanged: update guide, README and settings with them');
  const D6 = ['description', 'description-de', 'description-fr', 'description-es-ES', 'description-nl', 'description-ja'];
  const txt = (p, k) => { const m = new RegExp('^  ' + k + ": '(.*)'$", 'm').exec(p); return m ? m[1] : null; };
  ok(!/^- keyname: legend$/m.test(y), 'the Legend field is gone');
  D6.forEach((d) => {
    const a = txt(part('author_info'), d);
    ok(a && a.includes('<a href="' + SITE + '#guide"'), d + ': About links the guide');
    ok(a && /30 \/ 50/.test(a) && /3 \/ 8/.test(a) && /40 \/ 60/.test(a) && /10 \/ 50/.test(a) && /1000 \/ 1400/.test(a), d + ': About quotes the warning / alarming numbers');
  });
});

test('About text (B17): HTML, 100+ words in English (TRMNL search), all six languages, learn-more URL; the site in docs/ is current', () => {
  const y = fs.readFileSync(path.join(__dirname, '../../plugin/src/settings.yml'), 'utf-8');
  const about = y.split(/^- keyname: /m).slice(1).find((q) => q.startsWith('author_info\n'));
  const SITE = 'https://excusemi.github.io/trmnl-hifi-weather-plugin/';
  ok(about.includes('  learn_more_url: ' + SITE + '\n'), 'learn_more_url is the site');
  const text = (k) => { const m = new RegExp('^  ' + k + ": '(.*)'$", 'm').exec(about); return m ? m[1].replace(/''/g, "'") : null; };
  ['description', 'description-de', 'description-fr', 'description-es-ES', 'description-nl', 'description-ja'].forEach((k) => {
    const t = text(k);
    ok(t && t.length > 200, k + ' present');
    ok(t.includes('<strong>') && t.includes('<br />'), k + ' has the markup');
    ok(t.includes(SITE) && t.includes('open-meteo.com'), k + ' links the site and credits Open-Meteo');
    ok(!/[—–]/.test(t), k + ' has no dashes');
  });
  const words = text('description').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  ok(words >= 100, 'English about text is ' + words + ' words, needs 100');
  // docs/ is built by tools/site/build.sh from plugin/src: a stale copy would show an old plugin on the site
  const r = require('child_process').spawnSync('node', [path.join(__dirname, '../../tools/site/build.js'), '--check'], { encoding: 'utf-8' });
  eq(r.status, 0, 'docs/ is up to date (run tools/site/build.sh): ' + r.stderr);
});
test('site favicon (owner 2026-11-16): the page links the plugin icon as SVG, a 32x32 PNG and an apple-touch-icon, and the files are in the site source and in docs/', () => {
  const root = path.join(__dirname, '../..'), html = fs.readFileSync(path.join(root, 'tools/site/page/index.html'), 'utf8');
  ok(/<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/.test(html), 'svg icon link');
  ok(/<link rel="icon" type="image\/png" sizes="32x32" href="favicon-32\.png">/.test(html), '32x32 png link');
  ok(/<link rel="apple-touch-icon" href="apple-touch-icon\.png">/.test(html), 'apple-touch-icon link');
  ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'].forEach((f) => {
    ok(fs.existsSync(path.join(root, 'tools/site/page', f)) && fs.statSync(path.join(root, 'tools/site/page', f)).size > 100, f + ' in the site source');
    ok(fs.existsSync(path.join(root, 'docs', f)), f + ' in docs/');
  });
  eq(fs.readFileSync(path.join(root, 'tools/site/page/favicon.svg'), 'utf8'), fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8'), 'favicon.svg is the plugin icon');
});
