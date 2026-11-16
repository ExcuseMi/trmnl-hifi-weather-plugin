# trmnl-hifi-weather-plugin

## Hi-Fi Weather

![Hi-Fi Weather on the TRMNL X](assets/screenshot.png)

The weather as a calm early-80s hi-fi receiver, for [TRMNL](https://trmnl.com) e-paper displays:

- **Dials** (TRMNL X): a barometer with the pressure trend, and a temperature dial with today's low and high.
- **Console**: the temperature in segment digits with what to wear (parka, jacket, sweater or T-shirt, and an umbrella); block meters for wind and gusts, UV, air quality, humidity, pollen and pressure when they matter, grey cells for what is still to come today.
- **Rain or sun**: an hour calendar when rain is coming; otherwise sunrise, sunset and the moon as it looks from your location.
- **Bottom strip**: the coming hours, or the coming days as a week display, one column per day: EQ sliders (a knob for the high and one for the low on one shared scale, a thin 0° line when 0 is on the scale) or Digital (high and low in segment digits, aligned on the ones digit). The weather icon and what to wear sit above each column. Auto (the default) takes sliders on the TRMNL X and Digital on smaller and 1-bit or 2-bit screens; the smaller views always show Digital.
- **Lit labels**: a meter label that turns white on black (mirrored in dark mode) says the value is in its bad range: WIND from 50 km/h (30 mph), UV from 8, AQI from 60, POLLEN from 50, CO2 from 1400 ppm, the sensor's HUM below 30 % or above 60 %.
- **Look**: no panels or frames, thin divider lines where two sections meet (grey on greyscale screens, dotted black on 1-bit). Units (°C, hPa, mm) are grey and small; the °C sits at the top of its number. Small views show two meter rows or none, never a single one.
- **Indoor sensor**: with a TRMNL temperature sensor on the screen, indoor becomes the big reading and outdoor moves beside it, or show another TRMNL's sensor (a hallway upstairs) with outside as the big reading. Readings older than 3 hours are ignored. Other sources: Home Assistant, Awair, AirGradient, Sensibo, Ecowitt, Adafruit IO or any JSON link (below).

Every view (full, half horizontal, half vertical, quadrant), 1-bit, greyscale and colour screens, dark mode, 24 or 12 hour time. When Open-Meteo is slow or down, the last saved forecast shows with its time.

### Settings

| Setting | What it does |
|---|---|
| Location | City, postal code or latitude,longitude |
| Temperature unit | Celsius or Fahrenheit |
| Time format | 24 hours (17:00) or 12 hours (5:00 PM) |
| Bottom strip | Days, hours, or hours then days |
| Switch to days at | With Hours, then days: the hour the hours give way to the days, 12:00 to 23:00, default 18:00. |
| Hide title bar | Hides the title bar on the full view |
| Week display | Auto (default: EQ sliders on the TRMNL X, Digital on smaller, 1-bit and 2-bit screens), EQ sliders or Digital. Smaller views always show Digital. |
| What to wear | On by default. Off hides the clothing and umbrella icons everywhere (next to the temperature and in the week). |
| Sensor | None (outside weather only), This TRMNL (this screen's own sensor), Another TRMNL, or a provider: Home Assistant, Awair, AirGradient, Sensibo, Ecowitt, Adafruit IO, Custom link (JSON). The fields of the chosen option show; see Indoor sensor sources below. |
| Sensor from another TRMNL | Shows for Another TRMNL only: the digits in the address of its page on trmnl.com. Empty or not found: this TRMNL's own sensor. |
| Sensor icon | The icon in front of the sensor's reading: House (default), or Anemometer (a mast with cups) for a sensor outside, such as a weather station or a balcony sensor. Only the icon changes; room for more icons later. |
| Sensor name | Optional short name, for example Upstairs, shown beside the sensor's icon and on the temperature dial. Empty: the icon alone. |
| Main reading | Which reading comes first: Automatic (the sensor when it is this screen's own, outside when it comes from another TRMNL), Sensor, or Outside. The other follows beside it, its meters after. Both temperatures are the same size. |

### Indoor sensor sources

Set **Sensor** to a provider and fill in the fields that show. The reading takes the place of a TRMNL sensor (icon from Sensor icon, name, main reading, CO2 meter when the source gives CO2; None shows no CO2 meter). TRMNL fetches it from the cloud: the source must be reachable from the internet. Tokens sit in password fields and go only to the provider. Readings older than 3 hours are ignored; when the source fails the last good reading stays up to 3 hours and the bottom bar says SENSOR OFFLINE with its time.

Beta = built from the provider's API docs, not yet confirmed with a real device; tell us if one fails.

| Source | What you fill in | API docs |
|---|---|---|
| Home Assistant | Tested. Address of your Home Assistant from the internet (https://, for example Nabu Casa or a Cloudflare tunnel; a local address does not work), a long-lived access token (your profile, Security), the entity ids for temperature, humidity and CO2 (humidity and CO2 optional). Fahrenheit entities are converted. | https://developers.home-assistant.io/docs/api/rest/ |
| Awair | **Beta**. Access token from the Awair Developer Console. Device type and id are optional (empty: your first Awair). The free tier allows 300 readings per device per day. | https://docs.developer.getawair.com/ |
| AirGradient | **Beta**. Token of your place (app.airgradient.com, Settings, Place). Location id optional (empty: the first indoor monitor). | https://api.airgradient.com/public/docs/api/v1/ |
| Sensibo | **Beta**. API key from home.sensibo.com/me/api. Device id optional (empty: your first device with a reading). Temperature and humidity only. Unit assumed Celsius. | https://sensibo.github.io/api/ |
| Ecowitt | **Beta**. Application key and API key from ecowitt.net (API management) and the MAC of the station. Indoor temperature, humidity and, with a CO2 sensor, CO2. | https://doc.ecowitt.net/web/#/apiv3en?page_id=17 |
| Adafruit IO | **Beta**. Username, active key, and the feed key for each reading (temperature required), plus the unit the temperature feed uses. | https://io.adafruit.com/api/docs/ |
| Custom link (JSON) | **Beta**. Any https:// link that answers JSON: optional header name and token, a dot path for each reading (data.rooms.0.temp), optional time path, the temperature unit. | - |

### Adding a provider

| Step | Where |
|---|---|
| 1. One option in the Sensor select; value is the provider word (`home_assistant`, `awair`, `adafruit`) | `plugin/src/settings.yml`, `sensor_source` |
| 2. Its fields as `sensor_<prefix>_<field>` (field words: `token`, `key`, `id`, `url`, `temp`, `hum`, `co2`, `unit`), group Sensor, `optional: true`, name and description in en, de, fr, es-ES, nl, ja | same file, before `sensor_label` |
| 3. Rules: one `when` per option hiding every other provider's fields and `sensor_device_id`, `required:` listing only its own must-haves | `conditional_validation` of `sensor_source` |
| 4. A normaliser returning `{t, h, c, at}` (Celsius, percent, ppm, epoch seconds) and its id in `SENS_IDS` | `SENS_PROV` in `plugin/src/transform.js` |
| 5. A test with the answer copied from the provider's docs, plus the failures (401, 500, timeout) | `test/model/sensors.js`; the settings guard in `test/model/run.js` checks 2 and 3 |
| 6. A row in "Indoor sensor sources" here and in `tools/site/page/index.html`, then `tools/site/build.sh` | docs |

### Reading the screen

Every part of the screen is explained with numbered pictures in the [full guide](https://excusemi.github.io/trmnl-hifi-weather-plugin/#guide). The meters in short: ten blocks (five on small screens), yellow is a warning and red is alarming on colour screens; light grey blocks are the highest value still to come today, an outlined block is the strongest gust.

| Meter | Full meter | Good | Warning (yellow) | Alarming (red) |
|---|---|---|---|---|
| WIND | 0 to 60 km/h (0 to 40 mph) | under 30 km/h (20 mph) | 30 to 50 km/h (20 to 30 mph) | over 50 km/h (30 mph) |
| UV | UV index 0 to 11 | under 3 (low) | 3 to 7 (moderate, high) | 8 and up (very high, extreme) |
| AQI | European AQI 0 to 100 | under 40 (good, fair) | 40 to 60 (moderate) | over 60 (poor to extremely poor) |
| HUM | 0 to 100 % relative humidity | plain reading, no bands | | |
| POLLEN | grains per m3, strongest type | under 10 (low) | 10 to 50 (moderate) | over 50 (high, very high) |
| BARO | 970 to 1050 hPa | plain reading, about 1013 hPa is normal | | |
| CO2 | 400 to 2000 ppm (indoor sensor) | under 1000 ppm | 1000 to 1400 ppm | over 1400 ppm |
| RAIN | 3 blocks, mm per hour | 1 block: drizzle, under 1 | 2 blocks: rain, from 1 | 3 blocks: heavy rain, from 4 |

The same legend is in the plugin's settings under Legend.

Data comes from [Open-Meteo](https://open-meteo.com); no key is needed.

## Development

Built with [trmnlp](https://github.com/usetrmnl/trmnlp).

```bash
cd plugin
trmnlp serve        # preview
trmnlp test         # RSpec specs in plugin/tests
node ../test/model/run.js   # pure-logic tests of the weather model
(cd .. && npm install && node tools/build.js)   # after editing source/shared.liquid
ruby ../tools/sync_trmnl_i18n.rb   # re-sync TRMNL's translations
```

## Editing

Edit `source/shared.liquid` (all comments live there), then run `node tools/build.js`: it writes `plugin/src/shared.liquid` (Liquid comments stripped, long Liquid variable names shortened, page script minified), which is what trmnlp pushes. Never edit the built file; the model tests fail when it is out of date or over 84 KB.

Before a live push, save the full output of each render suite (base and `tools/render_check_b22.json`) to a file, never piped through `tail`, and run `tools/suite_green.sh <file>...`: push only on GREEN. Also run `tools/lint_gate.sh` (`trmnlp lint` against `tools/lint_baseline.txt`, fails on any new finding such as a `<style>` block or a `style=` attribute): push only on GREEN.

Two render-check tiers, same spec (`tools/render_check_spec.rb`), run base first, then devices, then ship:

| Tier | Cases | Run |
|---|---|---|
| Base | `tools/render_check_cases.json` (OG, X, colour OG; scope unchanged); `tools/render_check_b22.json`: Home Assistant reading live, kept after an outage, none (OG, X) | `cd plugin && SW_CASES_FILE=../tools/render_check_cases.json SW_OUT=<dir> trmnlp test ../tools/render_check_spec.rb` |
| Devices | `tools/render_check_devices.json`: every TRMNL model x full/hh/hv/quadrant, portrait full+hv, one dark, full and portrait full with an indoor sensor | `tools/check_devices.sh [out_dir] [model-substring]` prints a pass/fail table per device (about 35 min for all, one browser) |

Regenerate the device file after TRMNL adds a model: `python3 tools/make_device_cases.py` (reads trmnl.com/api/models). Playdate is left out until the owner decides on small screens.

## Try-it site (GitHub Pages, from main /docs)

The real transform and markup run in the page (LiquidJS), inside TRMNL's `trmnl-frame`. Regenerate: `tools/site/build.sh` (writes `docs/`; `--check` fails when stale, also run by the model tests). Guard: `tools/site/check_fidelity.sh` compares the page's markup with trmnlp's Ruby Liquid for 12 cases (no browser). `node tools/site/smoke.cjs` loads every example x device x view in Chromium and Firefox and fails on a crash, a page error or an empty part (needs Playwright, see the file header; about 12 minutes; `--quick` for a few).

## Open items

| Item | Detail |
|---|---|
| Palma hh CONDRATIO | Passes at 1.147 against the 1.15 limit (B19 re-measured; the old 1.2 and the full-sens 1.31 no longer show: full-sens has no sibling in its group). Margin is 0.003: a change to the md portrait half horizontal digits or `swOGPortrait` can tip it. |
| Sun times on small screens | Where the segment digits would be under 24 px (the OG), sunrise and sunset stay in the normal bold font. Known exception, accepted by the owner (2026-11-16); the X draws them in the page's 7-segment digits. |
| Day label weight on 1-bit | On the OG 1-bit render the day name TUE has 4 px stems where the other names have 3 px (a glyph raster effect of the font at that size, not its position; counts in the B31 notes). |
| Device tier, own-sensor cases | 4 of the 117 `-sens` cases are red at 3a230e7, all on models with no framework CSS rules under trmnlp (the harness gap, see `tools/check_devices.sh` KNOWN): `kobo_clara_2e__full-sens` (digit height 22.4), `kobo_libra_color__full-port-sens`, `onyx_boox_go_10_3_lumi__full-port-sens`, `tcl_nxtpaper_14__full-port-sens` (row 2 icon meets low, gap 1 px). The avalue_epd_42s, generic_16_9 and palma `-sens` cases are green. |

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 ExcuseMi.

The weather texts (the `sw_i18n` capture in each `plugin/src/<view>.liquid`, the slots between the `I18N_TRMNL` markers in `shared.liquid`) come from
[usetrmnl/trmnl-i18n](https://github.com/usetrmnl/trmnl-i18n) and stay under its MIT licence; see
[third_party/trmnl-i18n-LICENSE](third_party/trmnl-i18n-LICENSE). The weather icons are loaded from trmnl.com and are not part of this repository.
