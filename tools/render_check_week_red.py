#!/usr/bin/env python3
# Red demonstration of the WEEK* render checks (tools/render_check_week.rb): each mutation breaks the page in one way, the named
# check must go red on the named case, then the file is restored and rebuilt. Usage: python3 tools/render_check_week_red.py [MUTATION...]
# Run it with a clean working tree for the files it touches (it copies them back byte for byte).
import json,subprocess,shutil,sys,re
import os,tempfile
R=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')+'/'
B=tempfile.mkdtemp(prefix='weekred-')+'/'
cases={x['name']:x for x in json.load(open(R+'tools/render_check_b31.json'))}
muts=[
 ('WEEKCOLS','source/shared.liquid',"'7,4,7,7' | split","'6,4,6,6' | split",['b31-x-auto-eq']),
 ('WEEKEQ','source/shared.liquid',"flex flex--center-x flex--center-y {{ wk_nh }}","flex flex--center-y {{ wk_nh }}",['b31-x-auto-eq']),
 ('WEEKTODAY','source/shared.liquid','<span class="label label--inverted label--large text--bold" data-sw-today>','<span class="label label--large text--bold" data-sw-today>',['b31-x-auto-eq']),
 ('WEEKSTYLE','source/shared.liquid',"'eq' : 'dig') : wsv","'dig' : 'dig') : wsv",['b31-x-auto-eq']),
 ('WEEKSTYLE-small','source/shared.liquid',"{%- assign ws = 'dig' %}{% if view == 1 %}","{%- assign ws = 'eq' %}{% if view == 1 %}",['b31-x-hv-forced-eq']),
 ('WEEKCUE','plugin/src/transform.js',"out.days[0].cue = out.cue.slice(0, 3);","out.days[0].cue = ['tshirt'];",['b31-x-auto-eq']),
 ('WEEKCUE-nowear','plugin/src/transform.js',"if (opt && opt.wear === false) {","if (false) {",['b31-x-nowear']),
 ('WEEKSCALE','source/shared.liquid',"for (var v = sc.a; v <= sc.b + 1e-9; v += sc.st) { var ty","for (var v = sc.a; v <= sc.b + 1e-9; v += sc.st * (i === 1 ? 2 : 1)) { var ty",['b31-x-auto-eq']),
 ('WEEKZERO','source/shared.liquid',"Math.abs(y0 - c) < fl * 0.5 + 2.5","Math.abs(y0 - c) < -1",['b31-x-frost','b31-og-forced-eq']),
 ('WEEKONES','source/shared.liquid',"n1(L.xr - ((n - 1) * 70 + 56) * h / 100)","n1(L.xr + (lo ? 8 : 0) - ((n - 1) * 70 + 56) * h / 100)",['b31-x-forced-dig']),
 ('WEEKZERO-gap','source/shared.liquid',"y + '\" y2=\"' + y + '\" ' + SK + '1.5\"/>'));","y + '\" y2=\"' + y + '\" ' + SK + '1.5\" stroke-dasharray=\"300 12\"/>'));",['b31-x-frost']),
]
which=sys.argv[1:]
for name,f,old,new,cs in muts:
    if which and name not in which: continue
    src=open(R+f).read()
    assert src.count(old)==1,(name,src.count(old))
    shutil.copy(R+f,B+'redbak.tmp')
    open(R+f,'w').write(src.replace(old,new))
    subprocess.run(['node','tools/build.js'],cwd=R,capture_output=True)
    json.dump([cases[c] for c in cs],open(B+'red_cases.json','w'))
    r=subprocess.run('SW_CASES_FILE=%sred_cases.json SW_OUT=%sred_out timeout 600 trmnlp test ../tools/render_check_spec.rb 2>&1'%(B,B),shell=True,cwd=R+'plugin',capture_output=True,text=True)
    shutil.copy(B+'redbak.tmp',R+f)
    subprocess.run(['node','tools/build.js'],cwd=R,capture_output=True)
    out=r.stdout
    keys=sorted(set(re.findall(r'^(WEEK[A-Z]+) ',out,re.M)))
    summ=re.findall(r'\d+ examples, \d+ failures?',out)
    lines=[l[:200] for l in out.split('\n') if l.startswith('WEEK')][:3]
    print(name,'->',keys,summ,lines,flush=True)
