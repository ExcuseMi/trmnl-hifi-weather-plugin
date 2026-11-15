#!/usr/bin/env node
// Writes docs/ (GitHub Pages, from main /docs): the page, the plugin's own transform and markup, and the fixed weather days.
// Regenerate: tools/site/build.sh   (check only: tools/site/build.sh --check)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const docs = path.join(root, 'docs');
const check = process.argv.includes('--check');
const files = {};

const shared = fs.readFileSync(path.join(root, 'plugin/src/shared.liquid'), 'utf8');
const m = /\{%\s*template main\s*%\}([\s\S]*)\{%\s*endtemplate\s*%\}/.exec(shared);
if (!m) throw new Error('plugin/src/shared.liquid has no {% template main %}');
files['plugin/main.liquid'] = m[1];
const views = {};
for (const v of ['full', 'half_horizontal', 'half_vertical', 'quadrant']) views[v] = fs.readFileSync(path.join(root, 'plugin/src', v + '.liquid'), 'utf8');
files['plugin/views.json'] = JSON.stringify(views);
files['plugin/transform.js'] = fs.readFileSync(path.join(root, 'plugin/src/transform.js'), 'utf8');
files['engine.js'] = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
for (const f of ['index.html', 'app.js']) files[f] = fs.readFileSync(path.join(__dirname, 'page', f), 'utf8');
files['data/scenarios.json'] = execFileSync('python3', [path.join(__dirname, 'scenarios.py'), '--stdout'], { encoding: 'utf8' });

let bad = 0;
for (const [rel, text] of Object.entries(files)) {
  const p = path.join(docs, rel);
  if (check) {
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== text) { console.error('docs/' + rel + ' is out of date: run tools/site/build.sh'); bad++; }
  } else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
}
if (check) process.exit(bad ? 1 : 0);
let total = 0;
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : (total += fs.statSync(p).size); } })(docs);
console.log('docs/ written, ' + total + ' bytes');
