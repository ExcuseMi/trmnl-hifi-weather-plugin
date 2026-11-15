#!/usr/bin/env python3
"""Fixed weather days for the site (docs/data/scenarios.json): Open-Meteo-shaped answers (celsius, mm, km/h; the page converts
for fahrenheit) plus air quality, a sensor and the settings an example wants. Believable shapes, no real forecast."""
import json
import math
import os
import sys
from datetime import datetime, timedelta

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'data', 'scenarios.json')
PAST, AHEAD = 24, 72


def sun_times(lat, lon, off, date):
    doy = date.timetuple().tm_yday
    decl = math.radians(23.44) * math.sin(2 * math.pi * (doy - 81) / 365)
    x = -math.tan(math.radians(lat)) * math.tan(decl)
    half = math.degrees(math.acos(max(-1, min(1, x)))) / 15
    noon = 12 - lon / 15 + off / 3600   # local solar noon on the clock (no equation of time)
    return noon - half, noon + half


def hm(v):
    return '%02d:%02d' % (int(v), int(round((v % 1) * 60)) % 60)


def build(spec):
    lat, lon, off = spec['lat'], spec['lon'], spec['off']
    now = datetime.fromisoformat(spec['now'])           # local, on the hour
    start = now - timedelta(hours=PAST)
    n = PAST + AHEAD
    days = spec['days']                                  # (lo, hi, code, prob, uv, gust, rain_mm) per day, day 0 = today
    d0 = now.replace(hour=0)
    H = {k: [] for k in ['time', 'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
                         'pressure_msl', 'weather_code', 'is_day', 'wind_speed_10m', 'wind_gusts_10m', 'uv_index',
                         'relative_humidity_2m']}
    for k in range(n):
        t = start + timedelta(hours=k)
        i = k - PAST                                      # hours from now
        di = max(0, (t.replace(hour=0) - d0).days)
        lo, hi = days[min(di, len(days) - 1)][:2]
        sr, ss = sun_times(lat, lon, off, t)
        f = 0.5 - 0.5 * math.cos(2 * math.pi * (t.hour - (sr - 1.5)) / 24)
        temp = lo + (hi - lo) * f + spec.get('dtemp', lambda i: 0)(i)
        sun = max(0.0, math.sin(math.pi * (t.hour + 0.5 - sr) / (ss - sr))) if sr < t.hour + 0.5 < ss else 0.0
        code, prob, mm = spec['wx'](i, t.hour)
        wind = spec['wind'](i, t.hour)
        gust = spec['gust'](i, t.hour)
        uvmax = days[min(di, len(days) - 1)][4]
        cloud_cut = 0.35 if code >= 3 else (0.7 if code == 2 else 1.0)
        hum = spec['hum'](i, t.hour)
        H['time'].append(t.strftime('%Y-%m-%dT%H:%M'))
        H['temperature_2m'].append(round(temp, 1))
        H['apparent_temperature'].append(round(temp - wind * 0.06 + (hum - 50) * 0.02, 1))
        H['precipitation_probability'].append(prob)
        H['precipitation'].append(round(mm, 1))
        H['pressure_msl'].append(round(spec['press'](i), 1))
        H['weather_code'].append(code)
        H['is_day'].append(1 if sun > 0 else 0)
        H['wind_speed_10m'].append(round(wind, 1))
        H['wind_gusts_10m'].append(round(gust, 1))
        H['uv_index'].append(round(uvmax * sun * cloud_cut, 1))
        H['relative_humidity_2m'].append(int(round(hum)))
    c = {k: H[k][PAST] for k in H if k != 'time'}
    cur = {'time': H['time'][PAST], 'interval': 900, 'is_day': c['is_day'], 'temperature_2m': c['temperature_2m'],
           'apparent_temperature': c['apparent_temperature'], 'relative_humidity_2m': c['relative_humidity_2m'],
           'wind_speed_10m': c['wind_speed_10m'], 'wind_direction_10m': spec.get('dir', 240),
           'wind_gusts_10m': c['wind_gusts_10m'], 'pressure_msl': c['pressure_msl'], 'weather_code': c['weather_code'],
           'uv_index': c['uv_index']}
    daily = {k: [] for k in ['time', 'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_max',
                             'apparent_temperature_min', 'precipitation_probability_max', 'uv_index_max',
                             'wind_gusts_10m_max', 'precipitation_sum', 'sunrise', 'sunset']}
    for j, (lo, hi, code, prob, uv, gust, rain) in enumerate(days):
        d = d0 + timedelta(days=j)
        sr, ss = sun_times(lat, lon, off, d)
        daily['time'].append(d.strftime('%Y-%m-%d'))
        daily['weather_code'].append(code)
        daily['temperature_2m_max'].append(hi)
        daily['temperature_2m_min'].append(lo)
        daily['apparent_temperature_max'].append(round(hi - 1.5, 1))
        daily['apparent_temperature_min'].append(round(lo - 2.5, 1))
        daily['precipitation_probability_max'].append(prob)
        daily['uv_index_max'].append(uv)
        daily['wind_gusts_10m_max'].append(gust)
        daily['precipitation_sum'].append(rain)
        daily['sunrise'].append(d.strftime('%Y-%m-%d') + 'T' + hm(sr))
        daily['sunset'].append(d.strftime('%Y-%m-%d') + 'T' + hm(ss))
    answer = {'latitude': lat, 'longitude': lon, 'utc_offset_seconds': off, 'timezone': 'auto', 'current': cur,
              'hourly': H, 'daily': daily}
    # air quality: today (forecast_days=2) from local midnight
    aq_h = {'time': [], 'european_aqi': []}
    pol = spec.get('pollen', {})
    for k in pol:
        aq_h[k] = []
    for k in range(48):
        t = d0 + timedelta(hours=k)
        aq_h['time'].append(t.strftime('%Y-%m-%dT%H:%M'))
        aq_h['european_aqi'].append(round(spec['aqi'](k - now.hour), 0))
        for key, v in pol.items():
            aq_h[key].append(round(v * (0.4 + 0.6 * math.sin(math.pi * max(0, min(1, (t.hour - 5) / 14)))), 1))
    aq_c = {'time': H['time'][PAST], 'interval': 3600, 'european_aqi': aq_h['european_aqi'][now.hour]}
    for key, v in pol.items():
        aq_c[key] = aq_h[key][now.hour]
    aq = {'latitude': lat, 'longitude': lon, 'utc_offset_seconds': off, 'current': aq_c, 'hourly': aq_h}
    return answer, aq


def calm():
    return dict(
        id='calm', title='Calm sunny summer day', place='Amsterdam', lat=52.37, lon=4.9, off=7200, now='2026-06-20T08:00',
        look='Nothing to warn about: the wind, UV, air quality and humidity meters stay low. Sunrise, sunset and the moon fill the right block.',
        days=[(14, 24.5, 1, 3, 6.4, 24, 0), (15, 26, 1, 3, 6.8, 22, 0), (16, 27.5, 2, 10, 6.6, 26, 0), (15, 25, 2, 25, 5.2, 30, 0.4),
              (14, 22, 80, 55, 4.0, 38, 3.2), (13, 21, 3, 20, 3.5, 30, 0.2), (12, 22, 1, 5, 6.0, 20, 0)] + [(13, 23, 2, 10, 5.5, 25, 0)] * 7,
        wx=lambda i, h: ((0 if h < 13 else 1), 2, 0), wind=lambda i, h: 6 + 5 * math.sin(math.pi * (h - 6) / 14) if 6 < h < 20 else 5,
        gust=lambda i, h: 12 + 8 * math.sin(math.pi * (h - 6) / 14) if 6 < h < 20 else 9, hum=lambda i, h: 78 - 33 * max(0, math.sin(math.pi * (h - 6) / 14)),
        press=lambda i: 1022.5 + 0.02 * i, aqi=lambda k: 18 + 0.2 * k, pollen={'grass_pollen': 6}, dir=60)


def rain():
    def wx(i, h):
        if 2 <= i <= 7:
            return (63 if 3 <= i <= 5 else 61), 85, (2.1 if 3 <= i <= 5 else 0.8)
        if 8 <= i <= 12:
            return 80, 45, 0.3
        return (3 if i < 2 else 2), (35 if 0 <= i < 2 else 10), 0
    return dict(
        id='rain', title='Rain arriving in two hours', place='London', lat=51.51, lon=-0.13, off=3600, now='2026-04-18T14:00',
        look='The right block turns into an hour calendar: dry now, rain from 16:00, with the amount below it. An umbrella shows beside the temperature.',
        days=[(7, 14, 61, 90, 3.4, 38, 8.5), (6, 13, 80, 50, 4.0, 34, 1.5), (5, 15, 2, 15, 4.8, 26, 0), (6, 16, 1, 5, 5.5, 20, 0),
              (8, 17, 3, 20, 4.4, 24, 0.2), (9, 14, 63, 80, 3.0, 40, 6.0)] + [(7, 13, 2, 25, 4.0, 26, 0.5)] * 8,
        wx=wx, dtemp=lambda i: -1.5 if 3 <= i <= 8 else 0, wind=lambda i, h: 14 + (10 if 2 <= i <= 8 else 0), gust=lambda i, h: 28 + (20 if 2 <= i <= 8 else 0),
        hum=lambda i, h: 62 + (25 if i >= 2 else 0), press=lambda i: 1011 - 0.35 * i, aqi=lambda k: 26, pollen={'birch_pollen': 12}, dir=225)


def storm():
    def wx(i, h):
        if 0 <= i <= 14:
            return (95 if 5 <= i <= 6 else 65 if 2 <= i <= 4 else 63), 90, (3.8 if 2 <= i <= 4 else 1.4)
        if 15 <= i <= 22:
            return 80, 55, 0.5
        return (3 if i < 0 else 2), (25 if i < 0 else 20), 0
    return dict(
        id='storm', title='Autumn storm with gusts', place='Amsterdam', lat=52.37, lon=4.9, off=7200, now='2026-10-20T15:00',
        look='The wind meter is full and its gust mark is far out; the barometer trend points down fast. Rain and thunder in the calendar.',
        days=[(9, 13, 95, 95, 1.6, 92, 16.5), (8, 12, 80, 60, 2.2, 61, 3.0), (7, 11, 3, 25, 2.0, 44, 0.2), (6, 12, 61, 55, 2.4, 50, 2.0),
              (7, 12, 3, 20, 2.0, 38, 0.1)] + [(7, 11, 2, 20, 2.0, 30, 0)] * 9,
        wx=wx, dtemp=lambda i: -1.5 if 2 <= i <= 6 else 0, wind=lambda i, h: 54 + 6 * math.sin(i / 2) if -3 <= i <= 16 else 28,
        gust=lambda i, h: 92 + 6 * math.sin(i) if -3 <= i <= 16 else 52, hum=lambda i, h: 88, dir=250,
        press=lambda i: 1010 - 0.8 * (i + 24) if i < 12 else 981 + 1.0 * (i - 12), aqi=lambda k: 14)


def snow():
    def wx(i, h):
        if 3 <= i <= 16:
            return (75 if 7 <= i <= 10 else 73 if 4 <= i <= 12 else 71), 85, (1.2 if 7 <= i <= 10 else 0.6)
        return (3 if i < 3 else 71), (20 if i < 3 else 60), 0
    return dict(
        id='snow', title='Frost and snow', place='Chicago', lat=41.88, lon=-87.63, off=-21600, now='2026-01-14T07:00', us=True,
        look='Below freezing with snow coming: the parka cue and snow in the hour calendar. Fahrenheit and 12 h, as the city is in the US.',
        days=[(-11, -4, 73, 90, 1.0, 46, 8.0), (-12, -6, 71, 60, 1.4, 36, 2.0), (-14, -9, 2, 10, 2.0, 28, 0), (-10, -3, 3, 20, 1.5, 30, 0),
              (-7, 0, 71, 55, 1.2, 38, 1.8), (-5, 1, 3, 20, 1.4, 30, 0)] + [(-6, 0, 2, 15, 1.5, 26, 0)] * 8,
        wx=wx, dtemp=lambda i: 1.5 if i > 8 else 0, wind=lambda i, h: 22 + (8 if i > 3 else 0), gust=lambda i, h: 44 + (14 if i > 3 else 0),
        hum=lambda i, h: 74 + (14 if i > 3 else 0), press=lambda i: 1008 - 0.45 * i, aqi=lambda k: 30, dir=310)


def heat():
    return dict(
        id='heat', title='Heat wave, high UV, poor air', place='Madrid', lat=40.42, lon=-3.7, off=7200, now='2026-07-16T15:00',
        look='The UV meter is at its top and air quality is high; humidity is very low, and the strip shows the heat through the night.',
        days=[(23, 38.5, 0, 0, 10.8, 30, 0), (24, 39.5, 0, 0, 10.9, 28, 0), (24, 40.2, 0, 5, 10.6, 32, 0), (23, 37, 2, 10, 9.4, 30, 0),
              (21, 33, 95, 40, 8.0, 60, 2.0)] + [(20, 31, 2, 10, 8.5, 28, 0)] * 9,
        wx=lambda i, h: (0, 0, 0), wind=lambda i, h: 9 + 7 * math.sin(math.pi * (h - 8) / 12) if 8 < h < 20 else 6,
        gust=lambda i, h: 20 + 8 * math.sin(math.pi * (h - 8) / 12) if 8 < h < 20 else 12, hum=lambda i, h: 42 - 24 * max(0, math.sin(math.pi * (h - 6) / 14)),
        press=lambda i: 1014 + 0.01 * i, aqi=lambda k: 62 + 1.2 * max(0, 15 - abs(k - 7)) if True else 0, dir=90)


def pollen():
    return dict(
        id='pollen', title='Spring pollen', place='Paris', lat=48.86, lon=2.35, off=7200, now='2026-04-22T10:00',
        look='A pollen meter joins the others (birch and grass are high today) while the air quality itself is fine.',
        days=[(9, 18, 3, 5, 2.6, 28, 0), (10, 21, 1, 5, 5.8, 26, 0), (10, 19, 2, 20, 5.0, 30, 0), (9, 17, 61, 60, 3.4, 40, 3.0),
              (8, 16, 3, 20, 3.8, 30, 0)] + [(8, 17, 2, 15, 4.8, 25, 0)] * 9,
        wx=lambda i, h: (3 if i < 8 else 2, 4, 0), wind=lambda i, h: 10 + 4 * math.sin(i / 3), gust=lambda i, h: 22 + 6 * math.sin(i / 3),
        hum=lambda i, h: 66 - 22 * max(0, math.sin(math.pi * (h - 6) / 14)), press=lambda i: 1018 - 0.05 * i, aqi=lambda k: 34,
        pollen={'birch_pollen': 210, 'grass_pollen': 48, 'alder_pollen': 6}, dir=45)


def autumn(id_, title, look, place, lat, lon, **extra):
    s = dict(
        id=id_, title=title, place=place, lat=lat, lon=lon, off=3600, now='2026-11-08T06:00', look=look,
        days=[(2, 11.5, 2, 20, 1.8, 30, 0), (3, 12, 61, 60, 2.0, 34, 2.0), (4, 9.5, 3, 20, 1.5, 30, 0), (1, 8, 71, 40, 1.2, 28, 0.5)] + [(2, 9, 2, 20, 1.5, 26, 0)] * 10,
        wx=lambda i, h: ((2 if i < 8 else 3), 12, 0), wind=lambda i, h: 10 + 3 * math.sin(i / 4), gust=lambda i, h: 26 + 5 * math.sin(i / 4),
        hum=lambda i, h: 86 - 20 * max(0, math.sin(math.pi * (h - 6) / 14)), press=lambda i: 1014.5 - 0.1 * i, aqi=lambda k: 38, dir=225)
    s.update(extra)
    return s


SCENARIOS = [
    calm(), rain(), storm(), snow(), heat(), pollen(),
    autumn('sensor', 'With a TRMNL sensor on this screen', 'The indoor temperature comes first in black, outside beside it in grey; the CO2 and indoor humidity meters lead the list.',
           'Berlin', 52.52, 13.41, sensor={'device': 1, 'temperature': 21.4, 'humidity': 46, 'carbon_dioxide': 1180},
           settings={'sensor_source': 'own', 'sensor_co2': 'show', 'sensor_label': '', 'sensor_device_id': '', 'sensor_primary': 'auto'}),
    autumn('sensor2', 'Sensor from another TRMNL, with a label', 'The sensor of a second TRMNL (a hallway upstairs) shows with its label next to the house icon; outside comes first in black.',
           'Paris', 48.86, 2.35, sensor={'device': 2, 'temperature': 19.6, 'humidity': 52, 'carbon_dioxide': 640},
           settings={'sensor_source': 'other', 'sensor_co2': 'show', 'sensor_label': 'Upstairs', 'sensor_device_id': '2', 'sensor_primary': 'auto'}),
]


def main():
    out = []
    for s in SCENARIOS:
        answer, aq = build(s)
        o = {k: s[k] for k in ('id', 'title', 'look', 'place', 'lat', 'lon', 'off', 'now') if k in s}
        o.update(us=bool(s.get('us')), answer=answer, aq=aq)
        if 'sensor' in s:
            o['sensor'] = s['sensor']
            o['settings'] = s['settings']
        out.append(o)
    text = json.dumps(out, separators=(',', ':'))
    if '--stdout' in sys.argv:
        sys.stdout.write(text)
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(text)


if __name__ == '__main__':
    main()
