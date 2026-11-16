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
 ('WEEKCOLS','source/shared.liquid',"'5,4,7,7' | split","'4,4,6,6' | split",['b31-x-forced-dig']),
 ('WEEKTODAY','source/shared.liquid','<span class="label label--inverted label--large text--bold" data-sw-today>','<span class="label label--large text--bold" data-sw-today>',['b31-x-forced-dig']),
 ('WEEKCUE','plugin/src/transform.js',"out.days[0].cue = out.cue.slice(0, 3);","out.days[0].cue = ['tshirt'];",['b31-x-forced-dig']),
 ('WEEKCUE-nowear','plugin/src/transform.js',"if (opt && opt.wear === false) {","if (false) {",['b31-x-nowear']),
 ('WEEKONES','source/shared.liquid',"n1(L.xr - ((n - 1) * 70 + 56) * h / 100)","n1(L.xr + (lo ? 8 : 0) - ((n - 1) * 70 + 56) * h / 100)",['b31-x-forced-dig']),
 # hours (owner 2026-11-16, H1): same harness, the HZERO check
 ('HZERO-shadow','source/shared.liquid',"return svg(W, H, '<g data-sw-cells=\"' + n + '\" data-sw-area=\"' + n1(G.U * lh)","return svg(W, H, g(SHADOW + ' text--gray-65', cells) + '<g data-sw-cells=\"' + n + '\" data-sw-area=\"' + n1(G.U * lh)",['b31-x-hours-neg']),
 ('HZERO-black','source/shared.liquid',"fill = blk(hi);","fill = blk(true);",['b31-og-hours-neg']),
 ('HZERO-nohang','source/shared.liquid',"var v = Math.round(q.tV), up = v >= 0,","var v = Math.round(q.tV), up = true,",['b31-x-hours-neg']),
 ('HZERO-noline','source/shared.liquid',"if (!G.below || !API.hbarW) return svg(W, H, '');","return svg(W, H, '');",['b31-x-hours-neg']),
 ('HZERO-broken','source/shared.liquid',"<line data-sw-hzline x1=","<line data-sw-hzline stroke-dasharray=\"300 12\" x1=",['b31-x-hours-neg']),
 ('HZERO-label','source/shared.liquid',": G.y0 - G.e - gp / 2;   /* a value below 0",": G.y0 + 3 + fs * 0.36 + 0 * gp;   /* a value below 0",['b31-x-hours-neg']),
 
 ('SUNTIGHT-narrow','source/shared.liquid',"'</g>'; x += W + G; }\n});","'</g>'; x += (c === '1' ? T : W) + G; }\n});",['b31-x-sun-ones']),
 ('ROWBAND-count','source/shared.liquid',"{%- assign wr_md = 4 %}{% assign wr_lg = 7 %}","{%- assign wr_md = 3 %}{% assign wr_lg = 7 %}",['b31-og1-port-full-dry']),
 ('ROWBAND-fill','source/shared.liquid','<div class="relative grow basis--0 w--full h--min-0 {% if i < wr_md %}block','<div class="relative shrink-0 w--full h--[9cqh] {% if i < wr_md %}block',['b31-og1-port-full-dry']),
 ('ROWGAP-pad','source/shared.liquid',"Math.max(3 / k, 0.15 * b.offsetHeight)","Math.max(3 / k, 0.01 * b.offsetHeight)",['b31-og1-port-full-rain']),
 ('ROWONES','source/shared.liquid',"gp = 0.4 * h1, x0 = 0, y1 = (H - h1) / 2, hi, lo;","gp = 0.4 * h1, x0 = i * 3, y1 = (H - h1) / 2, hi, lo;",['b31-og1-port-full-dry']),
 ('ROWSYM','source/shared.liquid',"inn.style.setProperty('padding-bottom', pd, 'important')","inn.style.setProperty('padding-bottom', '0px', 'important')",['b31-og1-port-full-rain','b31-x-port-full-dig']),
 ('DIALSENS','source/shared.liquid',"for (var tk = 0; tk < 3 && (Math.ceil(Math.max(...iq)","for (var tk = 0; tk < 0 && (Math.ceil(Math.max(...iq)",['b31-x-f-sens-cold']),
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
    keys=sorted(set(re.findall(r'^(WEEK[A-Z]+|HZERO|HCURVE|HOURS|SUNTIGHT|ROWGAP|ROWBAND|ROWONES|ARC|DIGITROW) ',out,re.M)))
    summ=re.findall(r'\d+ examples, \d+ failures?',out)
    lines=[l[:200] for l in out.split('\n') if l.startswith(('WEEK','HZERO','HCURVE','SUNTIGHT','ROWGAP','ROWBAND','ROWONES','ARC','DIGITROW'))][:3]
    print(name,'->',keys,summ,lines,flush=True)
