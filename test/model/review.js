// Tests added after the Fable functional review of 41f111e (2026-11-16): each was seen red on the code before its fix.
module.exports = async ({ T, fx, check, eq, ok }) => {
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
};
