// Build: source/shared.liquid (readable, all comments) -> plugin/src/shared.liquid (what trmnlp pushes).
// Strips Liquid comments, the markup's indentation and the spaces around filter pipes, minifies the page script (terser; SW and SWDraw keep their names), nothing else changes.
// Usage: node tools/build.js [outFile]   (default plugin/src/shared.liquid)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// Size aliases (owner 2026-11-14, budget 84 KB): long DOM method names and Math calls used dozens of times are renamed to short
// aliases of the SAME functions (prototype aliases, no wrappers) in the built script only; the source stays readable.
// The DOM aliases open the page script; the Math and toFixed aliases open the DRAW block (the model tests run that block alone).
const DOM_ALIAS = { getBoundingClientRect: '$b', querySelectorAll: '$A', querySelector: '$Q', getAttribute: '$g', setAttribute: '$s', hasAttribute: '$h', removeAttribute: '$r', closest: '$c' };
const MATH_ALIAS = ['max', 'min', 'round', 'abs', 'floor', 'ceil', 'cos', 'sin'];
function alias(js) {
  const hit = (k) => new RegExp('\\.' + k + '\\b').test(js);
  const dom = Object.keys(DOM_ALIAS).filter(hit);
  dom.forEach((k) => { js = js.replace(new RegExp('\\.' + k + '\\b', 'g'), '.' + DOM_ALIAS[k]); });
  js = js.replace(/\.parentElement\b/g, '.$p').replace(/\bgetComputedStyle\(/g, '$C(').replace(/\bdocument\./g, '$d.');
  js = js.replace(/Math\.(min|max)\.apply\(null, /g, 'Math.$1(...');   // size: Math.max.apply(null, a) -> Math.max(...a); the call's closing paren stays
  let hw = 0;   // size: element.style.setProperty('height'|'width', v, 'important') -> element.$H(v) / element.$W(v): two Element prototype methods
  js = js.replace(/\.style\.setProperty\('(height|width)', ([^;]*?), 'important'\)/g, (m, k, a) => { if (a.includes('.setProperty(')) throw new Error('size alias swallowed a second call'); hw |= k === 'height' ? 1 : 2; return '.$' + (k === 'height' ? 'H' : 'W') + '(' + a + ')'; });
  const tr = (js.match(/\.style\.transform = /g) || []).length;   // size: element.style.transform = v -> element.$T = v (setter on Element.prototype)
  js = js.replace(/\.style\.transform = /g, '.$T = ');
  let imp = 0;   // setProperty(k, v, 'important') -> $I(k, v): one prototype method, the third argument written once
  js = js.replace(/\.setProperty\(([^;]*?), 'important'\)/g, (m, a) => { if (a.includes('.setProperty(')) throw new Error('important alias swallowed a second call'); imp++; return '.$I(' + a + ')'; });
  js = js.replace(/\.setProperty\(/g, '.$P(').replace(/\.toFixed\(/g, '.$f(');
  const on = (P, ks) => ks.filter((k) => dom.includes(k)).map((k) => P + '.' + DOM_ALIAS[k] + '=' + P + '.' + k + ';').join('');
  const domPre = 'var $sp=\'[data-sw-part="\',$sb=\'[data-sw-\',$sd=\'data-sw-\',$d=document,$C=getComputedStyle,$F=parseFloat;(function(){Object.defineProperty(Node.prototype,"$p",{get(){return this.parentElement}});var E=Element.prototype,D=Document.prototype;' + on('E', ['getBoundingClientRect', 'querySelectorAll', 'querySelector', 'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute', 'closest'])
    + on('D', ['querySelectorAll', 'querySelector']) + (dom.includes('getBoundingClientRect') ? 'Range.prototype.$b=Range.prototype.getBoundingClientRect;' : '') + 'CSSStyleDeclaration.prototype.$P=CSSStyleDeclaration.prototype.setProperty;' + (hw & 1 ? 'E.$H=function(v){this.style.setProperty("height",v,"important")};' : '') + (hw & 2 ? 'E.$W=function(v){this.style.setProperty("width",v,"important")};' : '') + '' + (tr ? 'Object.defineProperty(E,"$T",{set(v){this.style.transform=v}});' : '') + '[["$ow","offsetWidth"],["$oh","offsetHeight"],["$L","classList"],["$1","firstElementChild"],["$y","style"]].forEach(function(a){Object.defineProperty(E,a[0],{get(){return this[a[1]]}})});Array.prototype.$e=Array.prototype.forEach;NodeList.prototype.$e=NodeList.prototype.forEach;DOMTokenList.prototype.$k=DOMTokenList.prototype.contains;Node.prototype.$k=Node.prototype.contains;' + (imp ? 'CSSStyleDeclaration.prototype.$I=function(a,b){this.setProperty(a,b,"important")};' : '') + '})();';
  // parseFloat, the offset sizes, classList, firstElementChild and contains (owner budget, B12): aliased outside the DRAW block only (the same functions and getters)
  const da = js.indexOf('// ==== DRAW_BEGIN ===='), db = js.indexOf('// ==== DRAW_END ====');
  if (da < 0 || db < da) throw new Error('DRAW markers missing');
  const out = (t) => t.replace(/\bparseFloat\(/g, '$F(').replace(/\.offsetWidth\b/g, '.$ow').replace(/\.offsetHeight\b/g, '.$oh').replace(/\.classList\b/g, '.$L').replace(/\.contains\(/g, '.$k(').replace(/\.firstElementChild\b/g, '.$1').replace(/\.style\b/g, '.$y').replace(/\.forEach\(/g, '.$e(');
  // size: the selector and attribute prefixes written dozens of times become three constants (outside the DRAW block; a literal's own quote is kept, so the string value is identical)
  const sel = (t) => t.replace(/'\[data-sw-part="/g, '$sp+\'').replace(/\[data-sw-part="/g, "'+$sp+'").replace(/'\[data-sw-/g, "$sb+'").replace(/\[data-sw-/g, "'+$sb+'").replace(/'data-sw-/g, "$sd+'");
  js = out(sel(js.slice(0, da))) + js.slice(da, db) + out(sel(js.slice(db)));
  const drawPre = '\nvar ' + MATH_ALIAS.map((f) => 'M' + f + '=Math.' + f).join(',') + ';Number.prototype.$f=Number.prototype.toFixed;\n';
  const cut = js.indexOf('// ==== DRAW_BEGIN ====');   // the Math aliases are defined inside the DRAW block: only code after it may use them
  js = js.slice(0, cut) + js.slice(cut).replace(/\bMath\.(max|min|round|abs|floor|ceil|cos|sin)\(/g, (m, f) => 'M' + f + '(');
  js = js.replace('// ==== DRAW_BEGIN ====', '// ==== DRAW_BEGIN ====' + drawPre);
  return domPre + '\n' + js;
}

async function build(src) {
  const { minify } = require('terser');
  let s = src.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '');
  const sa = s.indexOf('<script');
  const tight = (tag) => tag.split(/('[^']*'|"[^"]*")/).map((q, i) => i % 2 ? q : q.replace(/\s*\|\s*/g, '|').replace(/:\s+/g, ':')).join('')
    .replace(/^(\{[{%]-?)\s+/, '$1').replace(/^(\{%-?assign\s+\w+)\s*=\s*/, '$1=').replace(/\s+(-?[}%]\})$/, '$1');   // size: no spaces around a filter pipe, after a filter colon or inside the tag delimiters, around an assign's = (outside quoted text)
  // size: the Liquid variables a template assigns or captures (4+ letters) get short names; strings inside tags and names the view files read stay as they are
  const views = ['full', 'half_horizontal', 'half_vertical', 'quadrant'].map((v) => fs.readFileSync(path.join(ROOT, 'plugin', 'src', v + '.liquid'), 'utf8')).join('\n');
  const tagRe = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
  const vars = [...new Set([...s.matchAll(/\{%-?\s*(?:assign|capture|for)\s+([A-Za-z_]\w{2,})/g)].map((m) => m[1]))].filter((n) => !new RegExp('\\b' + n + '\\b').test(views));
  let nx = 0;
  const short = new Map(vars.map((n) => { let q; do q = 'v' + (nx++).toString(36); while (new RegExp('(?<![\\w.-])' + q + '(?![\\w-])').test(s)); return [n, q]; }));   // never a name the template already uses
  s = s.replace(tagRe, (tag) => tag.split(/('[^']*'|"[^"]*")/).map((q, i) => i % 2 ? q : q.replace(/(?<![\w-])(?<![^.]\.)[A-Za-z_]\w{2,}(?![\w-])/g, (w) => short.get(w) || w)).join(''));
  s = s.slice(0, sa).replace(/^[ \t]+/gm, '').replace(/[ \t]+$/gm, '').replace(/\{\{[^}]*\}\}|\{%(?:[^%'"]|'[^']*'|"[^"]*")*%\}/g, tight) + s.slice(sa);   // size: no indentation in the markup (whitespace there only separates tags)
  { const k = s.indexOf('<script'); s = s.slice(0, k).replace(/([>}])\n+(?=[<{])/g, '$1') + s.slice(k); }   // size: a line break between two tags is only whitespace in a flex layout
  { const k = s.indexOf('<script'), tm = '{%template main%}';   // size: the attribute written 30+ times in the markup is one Liquid variable (outside tags; the rendered HTML is identical)
    let mk = s.slice(0, k).split(/(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/).map((q, i) => i % 2 ? q : q.replace(/ data-sw-part=/g, ' {{dsp}}=').replace(/data-sw-/g, '{{D}}').replace(/<div class="/g, '{{Z}}').replace(/<span class="/g, '{{Y}}').replace(/flex flex--/g, '{{X}}').replace(/lg:portrait:/g, '{{W}}').replace(/shrink-0/g, '{{V}}').replace(/ flex--center/g, '{{U}}').replace(/<\/div><\/div>/g, '{{T}}')).join('');
    if (mk.startsWith(tm)) mk = tm + "{%-assign dsp='data-sw-part'-%}{%-assign D='data-sw-'-%}{%-assign Z='<div class=\"'-%}{%-assign Y='<span class=\"'-%}{%-assign X='flex flex--'-%}{%-assign W='lg:portrait:'-%}{%-assign V='shrink-0'-%}{%-assign U=' flex--center'-%}{%-assign T='</div></div>'-%}" + mk.slice(tm.length); else throw new Error('template start not found');
    s = mk + s.slice(k); }
  const a = s.indexOf('<script'), b = s.indexOf('</script>');
  if (a < 0 || b < a) throw new Error('page script not found in shared.liquid');
  const open = s.slice(a, s.indexOf('>', a) + 1), start = a + open.length;
  let js = s.slice(start, b);
  const lq = [];
  js = js.replace(/\{\{[^}]*\}\}|\{%[^%]*%\}/g, (m) => { lq.push(m); return '__LQ' + (lq.length - 1) + '__'; });
  js = alias(js);
  const r = await minify(js, {
    ecma: 2020, compress: { passes: 4, toplevel: true, pure_getters: true, unsafe_arrows: true, unsafe: true, keep_fargs: false, unsafe_comps: true, unsafe_proto: true, unsafe_methods: true },
    mangle: { toplevel: true, reserved: ['SW', 'SWDraw'], properties: { regex: /^(condH|condW|mainRow|sideCol|calH|calW|cueH|ouW|olW|lbW|fsC|fsU|fsL|fsM|ofU|tW|tH|sW|sH)$/ } },   // the small-view solver's own result fields (size)
    format: { comments: /==== (DRAW|I18N)/, max_line_len: false },
  });
  if (r.error) throw r.error;
  let out = r.code.replace(/__LQ(\d+)__/g, (_, i) => lq[+i]);
  if ((out.match(/__LQ/g) || []).length) throw new Error('Liquid placeholder lost');
  return s.slice(0, start) + '\n' + out + '\n' + s.slice(b);
}
module.exports = { build };
if (require.main === module) {
  const out = process.argv[2] || path.join(ROOT, 'plugin/src/shared.liquid');
  build(fs.readFileSync(path.join(ROOT, 'source/shared.liquid'), 'utf8')).then((t) => {
    fs.writeFileSync(out, t); console.log(out + ': ' + Buffer.byteLength(t) + ' bytes');
  }, (e) => { console.error(e); process.exit(1); });
}
