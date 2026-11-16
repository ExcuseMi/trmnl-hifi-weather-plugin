// Tests added after the Fable functional review of 41f111e (2026-11-16): each was seen red on the code before its fix.
module.exports = async ({ T, fx, SWModel, check, eq, ok }) => {
  const AT = Date.UTC(2026, 10, 8, 12, 0) / 1000;
  // a forecast like Open-Meteo's with the past hours of today (past_hours): 72 hourly values from 00:00 of the first day
  const forecast = (curHour, felt) => {
    const f = JSON.parse(JSON.stringify(fx('mixed'))), date = f.daily.time[0], n = 72, h = f.hourly, src = JSON.parse(JSON.stringify(h));
    Object.keys(src).forEach((k) => { if (Array.isArray(src[k])) h[k] = Array.from({ length: n }, (_, i) => src[k][i % src[k].length]); });
    h.time = Array.from({ length: n }, (_, i) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), i)).toISOString().slice(0, 13) + ':00');
    h.apparent_temperature = Array.from({ length: n }, (_, i) => felt(i % 24));
    f.current.time = date + 'T' + String(curHour).padStart(2, '0') + ':00';
    return f;
  };
  const runAt = async (f, fields = {}) => {
    const of = global.fetch; global.fetch = async (url) => ({ ok: true, json: async () => url.includes('air-quality') ? {} : f });
    try { return await T.run({ trmnl: { user: { locale: 'en' }, system: { timestamp_utc: AT }, plugin_settings: { custom_fields_values: Object.assign({ lat_lon: '50.8,3.4' }, fields) } } }); } finally { global.fetch = of; }
  };
  await check('today\'s cue is the whole 07:00 to 19:00 range at every hour of the day (the past hours are not cut), console = today\'s column', async () => {
    // felt 9 in the morning (07:00 to 12:59), 1 in the afternoon (13:00 on), 1 at night: the day is 1 to 9, no parka (9 is not under 8), a jacket
    const felt = (h) => h >= 7 && h < 13 ? 9 : 1;
    for (const hour of [9, 13, 17, 20, 21]) {
      const r = await runAt(forecast(hour, felt));
      eq([hour, r.ui.cue[0], r.ui.days[0].cue[0]], [hour, 'jacket', 'jacket'], 'cue at ' + hour + ':00 from the full day, the same in the console and in today\'s column');
    }
  });
  await check('temperature dial scale: at most 7 numbers on the arc, in Fahrenheit and Celsius (Fable review: 405060 ran together)', async () => {
    const view = (name, unit) => { const f = fx(name), m = SWModel.build(f, { unit }); return T.buildView(m, T.buildI18n('en'), f.daily, null, 0.3, { hourly: f.hourly }).tdial; };
    [['extreme_f', 'fahrenheit'], ['extreme', 'celsius'], ['mixed', 'celsius'], ['hail', 'celsius']].forEach(([n, u]) => {
      const t = view(n, u), labels = Math.floor((t.b - t.a) / t.step) + 1;
      ok(labels <= 7, n + ': ' + labels + ' numbers on the dial (' + t.a + ' to ' + t.b + ' step ' + t.step + ')');
      ok(t.step === 5 || t.step === 10 || t.step === 20 || t.step === 40, n + ': a round step ' + t.step);
    });
  });
  await check('offline copy: what snapOf writes serves 24 h (it kept 25 hours ahead, so about 19 h)', async () => {
    const f = forecast(13, (h) => 5), sn = T.snapOf(f, {}, null);
    [1, 12, 23, 24].forEach((hrs) => ok(T.fromSnap(sn, sn.at + hrs * 3600 - 60) !== null, 'the copy at ' + hrs + ' h old is shown'));
    eq(T.fromSnap(sn, sn.at + 24 * 3600 + 60), null, 'older than 24 h: NO SIGNAL');
    ok(JSON.stringify(sn).length < 6000, 'the saved state stays small (8 KB budget): ' + JSON.stringify(sn).length);
  });
};
