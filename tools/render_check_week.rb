# frozen_string_literal: true
# B31 week display checks (owner 2026-11-16), called by render_check_spec.rb for every case that shows a week strip.
# They replace the day-row checks (DAYROW, DAYS, DAYSTRIP, DAYPARTS, DAYNAME, DAYALIGN, DIGITCOL, MARKGAP, GEO, GARM, CUEROW)
# that measured the old rows. Every check returns a list of problems; empty = fine. Each was seen red on a broken page
# (tools/render_check_week_red.py breaks the page ten ways and shows each one red).
require 'json'
require 'chunky_png'

module WeekChecks
  # One evaluate: the week's geometry, the SVG parts, the clothing cues, the style the page drew.
  GATHER = <<~'JS'
    (function(){var vis=function(e){var b=e.getBoundingClientRect();return b.width>0&&b.height>0},R=function(e){var b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]},A=function(q,r){return [].filter.call((r||document).querySelectorAll(q),vis)};
    var wk=document.querySelector('[data-sw-week]');if(!wk||!vis(wk))return JSON.stringify({none:true});
    var sc=document.querySelector('.screen'),cl=sc?sc.className:'';
    var cols=A('[data-sw-wcol]').map(function(c){var d=c.querySelector('[data-sw-part="wday"]'),nm=c.querySelector('[data-sw-dname],[data-sw-today]'),g=d&&d.querySelector('svg'),z=g?d.getBoundingClientRect().width/(+g.getAttribute('width')||1):1;
      return {box:R(c),part:d?R(d):null,z:z,name:nm?R(nm):null,nameToday:!!(nm&&nm.hasAttribute('data-sw-today')),nameInv:!!(nm&&/label--inverted/.test(nm.className)),cue:A('[data-sw-part="wcue"]',c).length,icon:A('[data-sw-part="wicon"]',c).length,
        groove:d?[].filter.call(d.querySelectorAll('line[data-sw-groove]'),vis).map(R):[],glyphs:d?d.querySelectorAll('[data-sw-glyph]').length:0,
        ticks:d&&d.querySelector('svg > g')?[].map.call(d.querySelector('svg > g').querySelectorAll('line'),function(l){return +l.getAttribute('y1')}):[],
        rects:d?[].map.call(d.querySelectorAll('rect'),R):[],
        svgs:d?[].map.call(d.querySelectorAll('svg svg'),function(q){return ['x','y','width','height'].map(function(a){return +q.getAttribute(a)})}):[]}});
    var lab=document.querySelector('[data-sw-part="wlab"]'),zl=document.querySelector('[data-sw-part="wzero"] line');
    return JSON.stringify({week:R(wk),cls:cl,w:innerWidth,cols:cols,n:SW.days.length,today:SW.days[0]&&SW.days[0].today,sunCue:(SW.cue||[]).join('+'),dayCue:SW.days[0]?(SW.days[0].cue||[]).join('+'):'',
      cueParts:A('[data-sw-part="cue"],[data-sw-part="wcue"]').length,wcueTotal:A('[data-sw-part="wcue"]').length,
      lab:lab&&vis(lab)?{box:R(lab),texts:[].map.call(lab.querySelectorAll('text'),function(t){var b=t.getBoundingClientRect();return [t.textContent,(b.top+b.bottom)/2,b.left,b.right]})}:null,
      zero:zl?R(zl):null,small:!!document.querySelector('[data-sw-small]')})})()
  JS

  def self.expected_cols(view, cls, n)
    lg = cls.include?('screen--lg')
    port = cls.include?('screen--portrait')
    c = if view == 'half_vertical'
          { false => { false => 4, true => 3 }, true => { false => 4, true => 3 } }
        else
          { false => { false => 5, true => 4 }, true => { false => 7, true => 7 } }
        end
    [c[lg][port], n].min
  end

  def self.run(s, png_path, c, fields)
    g = JSON.parse(s.evaluate(GATHER))
    out = Hash.new { |h, k| h[k] = [] }
    view = c['view'] || 'full'
    out['WEEKCOLS'] << 'a week strip in a quadrant or half horizontal view' if !g['none'] && %w[quadrant half_horizontal].include?(view)
    return out if g['none']
    cols = g['cols']
    cls = g['cls']
    k = ChunkyPNG::Image.from_file(png_path).then { |img| [img, img.width.to_f / g['w']] }
    img, kx = k
    # WEEKCOLS: the day count by size class and orientation, never measured
    want = expected_cols(view, cls, g['n'])
    out['WEEKCOLS'] << "#{cols.size} columns, want #{want}" unless cols.size == want
    # WEEKEQ: equal widths, contiguous, inside the week box, today first and lit, names centred on their column
    if cols.size > 1
      ws = cols.map { |q| q['box'][2] - q['box'][0] }
      out['WEEKEQ'] << "column widths #{ws.map { |v| v.round(1) }.inspect}" if ws.max - ws.min > 1.5
      cols.each_cons(2) { |a, b| out['WEEKEQ'] << "gap #{(b['box'][0] - a['box'][2]).round(1)} between columns" if (b['box'][0] - a['box'][2]).abs > 1.5 }
    end
    wb = g['week']
    cols.each_with_index do |q, i|
      out['WEEKEQ'] << "column #{i} outside the week box" if q['box'][0] < wb[0] - 1 || q['box'][2] > wb[2] + 1
      nm = q['name']
      next unless nm
      out['WEEKEQ'] << "name #{i} outside its column" if nm[0] < q['box'][0] - 1 || nm[2] > q['box'][2] + 1
      cx = (q['box'][0] + q['box'][2]) / 2.0
      out['WEEKEQ'] << "name #{i} centre #{((nm[0] + nm[2]) / 2.0).round(1)} vs column #{cx.round(1)}" if ((nm[0] + nm[2]) / 2.0 - cx).abs > 2.5
    end
    td = cols.each_index.select { |i| cols[i]['nameToday'] }
    out['WEEKTODAY'] << "today labels at #{td.inspect}" unless td == [0] || !g['today']
    out['WEEKTODAY'] << 'today label not lit' if td.any? && !cols[td[0]]['nameInv']
    style = cols.empty? ? 'none' : 'dig'   # B32: the EQ sliders are gone, the columns are the calm Digital week
    # WEEKCUE: today's console cue is today's week cue; What to wear off leaves no cue anywhere
    if c['want_nowear']
      out['WEEKCUE'] << "#{g['cueParts']} cue parts with What to wear off" unless g['cueParts'].zero?
      out['WEEKCUE'] << "cue data left: #{g['sunCue'].inspect} / #{g['dayCue'].inspect}" unless g['sunCue'].empty? && g['dayCue'].empty?
    elsif g['today'] && g['sunCue'] != g['dayCue']
      out['WEEKCUE'] << "console cue #{g['sunCue']} vs today's column #{g['dayCue']}"
    end
    # WEEKCAP (digital): the HI / LO captions (in the page's language) stay inside their column
    if style == 'dig' && g['lab']
      lb = g['lab']['box']
      g['lab']['texts'].each { |(t, _y, l, r)| out['WEEKCAP'] << "caption #{t} #{l.round}-#{r.round} outside its column #{lb[0].round}-#{lb[2].round}" if l < lb[0] - 1 || r > lb[2] + 1 }
    end
    # eq: one shared scale (same height and top for every part, the same tick y in every column, the labels on ticks)
    if style == 'dig'
      prev = nil
      lum = ->(x, y) { v = img[x, y]; (ChunkyPNG::Color.r(v) + ChunkyPNG::Color.g(v) + ChunkyPNG::Color.b(v)) / 3.0 }
      dark = lum.(2, 2) < 100
      cols.each_with_index do |q, i|
        next if q['svgs'].size < 2 || q['part'].nil?
        res = q['svgs'].first(2).map do |(x, y, w, h)|
          xa = ((q['part'][0] + x * q['z']) * kx).round
          xb = ((q['part'][0] + (x + w) * q['z']) * kx).round
          ya = ((q['part'][1] + y * q['z']) * kx).round
          yb = ((q['part'][1] + (y + h) * q['z']) * kx).round
          cl = []
          cur = nil
          (xa..xb).each do |px|
            on = (ya..yb).any? { |py| dark ? lum.(px, py) > 70 : lum.(px, py) < 215 }
            if on then (cur ? cur[1] = px : cur = [px, px])
            elsif cur && px - cur[1] >= 3 then cl << cur; cur = nil
            end
          end
          cl << cur if cur
          cl
        end
        hi, lo = res
        next if hi.size < 2 || lo.size < 2
        hr, hd = hi[-2][1], hi[-1][0]
        lr, ld = lo[-2][1], lo[-1][0]
        out['WEEKONES'] << "column #{i}: ones right edge high #{hr} low #{lr}" if (hr - lr).abs > 2
        out['WEEKONES'] << "column #{i}: degree sign left edge high #{hd} low #{ld}" if (hd - ld).abs > 2
        rel = hr - (q['box'][0] * kx).round
        out['WEEKONES'] << "column #{i}: slot #{rel} vs #{prev}" if prev && (rel - prev).abs > 3.5
        prev ||= rel
      end
    end
    out
  end

  # ROWGAP (portrait rows, owner 2026-11-16): between the dotted dividers (the row edges) and any ink of the row (digits, degree sign, icons, name)
  # at least a tenth of the row, minimum 3 device px, above and below. Pixel scan of each row box; the divider itself (+-2 px) is not ink.
  ROWS_JS = <<~'JS'
    (function(){var bx=[].filter.call(document.querySelectorAll('[data-sw-wrb]'),function(e){var b=e.getBoundingClientRect();return b.width>0&&b.height>0});
    var tb=document.querySelector('.title_bar'),scr=document.querySelector('.screen'),tr=function(x){var b=x&&x.getBoundingClientRect();return b?[b.left,b.top,b.right,b.bottom].map(Math.round):null};var dv=[].map.call(document.querySelectorAll('[data-sw-part=wrdiv]'),function(e){var v=e.querySelector('svg'),a=e.getBoundingClientRect(),b=v&&v.getBoundingClientRect();return b&&a.width>0?[a.top,b.top,b.height]:null}).filter(Boolean);var on=[].map.call(document.querySelectorAll('[data-sw-part=wrow]'),function(e){if(!e.getBoundingClientRect().width)return null;var sv=e.querySelectorAll('svg svg');if(sv.length<2)return null;var rr=function(q){var g=q.querySelectorAll('g[data-sw-glyph]');return g.length?g[g.length-1].getBoundingClientRect().right:null};return [rr(sv[0]),rr(sv[1])]}).filter(Boolean);var nm=bx.map(function(e){var n=e.querySelector('[data-sw-dname],[data-sw-today]'),b=n&&n.getBoundingClientRect();return b&&b.width>0?[b.left,b.right]:null});var bd=document.querySelector('[data-sw-wkrows] > div'),bb=bd&&bd.getBoundingClientRect();return JSON.stringify({names:nm,ones:on,band:bb&&bb.width>0?[bb.left,bb.top,bb.right,bb.bottom]:null,cls:(document.querySelector('.screen')||document.body).className,n:SW.days.length,dv:dv,w:innerWidth,tb:tr(tb),scr:tr(scr),body:tr(document.body),dpr:devicePixelRatio,dbg:bx.map(function(e){var q=function(x){var b=x&&x.getBoundingClientRect();return b?[Math.round(b.top),Math.round(b.bottom)]:null};return [q(e),q(e.querySelector('[data-sw-part=wrdiv]')),q(e.lastElementChild),q(e.querySelector('[data-sw-part=wrow]')),e.lastElementChild.style.paddingTop,(function(){var g=e.querySelector('[data-sw-part=wrow] [data-sw-glyph]'),sv=e.querySelector('[data-sw-part=wrow] svg');return [q(g),q(sv),sv&&sv.getAttribute('height'),sv&&sv.getAttribute('viewBox'),innerHeight]})()]}),rows:bx.map(function(e){var b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]})})})()
  JS

  def self.rowgap(s, png_path, c)
    r = JSON.parse(s.evaluate(ROWS_JS))
    return [{}, nil] if r['rows'].empty?
    puts "RAWROWS #{c['name']} #{r.reject { |kk, _| kk == 'dbg' }.inspect}" if ENV['ROWDBG']
    png = ChunkyPNG::Image.from_file(png_path)
    k = png.width.to_f / r['w']
    bg = ChunkyPNG::Color.r(png[2, (r['rows'][0][1] * k).round])
    lum = ->(x, y) { cc = png[x, y]; (ChunkyPNG::Color.r(cc) * 0.3 + ChunkyPNG::Color.g(cc) * 0.59 + ChunkyPNG::Color.b(cc) * 0.11) }
    ink = ->(x, y) { (lum.(x, y) - bg).abs > 70 }
    # The dividers are found in the picture itself (the layout can still move between the screenshot and the DOM reading): the row of the
    # picture, within 30 px of the DOM edge, with the most ink across the row is the dotted line (its centre).
    rows = r['rows']
    edges = rows.map { |(l, t, rr, b)| [(l * k).round + 2, (rr * k).round - 3, (t * k).round, (b * k).round] }
    found = edges.each_with_index.map do |(x0, x1, y0, _y1), i|
      next nil if i.zero?
      cnt = (y0 - 10..y0 + 10).map { |y| next [0, y] if y < 0 || y >= png.height; [(x0..x1).count { |x| ink.(x, y) }, y] }
      mx = cnt.map(&:first).max
      mx < (x1 - x0) * 0.25 ? nil : (cnt.select { |n, _| n >= mx * 0.6 }.map(&:last).minmax.sum / 2.0)
    end
    puts "ROWFOUND #{c['name']}: #{found.inspect} edges #{edges.map { |e| [e[2], e[3]] }.inspect}" if ENV['ROWDBG']
    off = found.each_with_index.map { |f, i| f && f - edges[i][2] }.compact.first || 0
    out = []; mins = []
    (r['dv'] || []).each_with_index { |(a, b, hh), i| out << "divider #{i + 1} drawn #{(b - a).round(1)} px below its row edge (the svg must start at the edge, 3 px high)" if (b - a).abs > 1.5 }
    rows.each_with_index do |(l, t, rr, b), i|
      x0, x1, y0, y1 = edges[i]
      y0 = found[i].round if found[i]
      y0 = (y0 + off).round if i.zero?
      y1 = found[i + 1] ? found[i + 1].round : (y1 + off).round
      y1 = [y1, png.height - 1].min
      h = y1 - y0
      need = [3.0, 0.1 * h].max - 0.6
      mk = [3, (0.03 * h).ceil + 1].max   # the divider's dots are 3 px (OG) to 5 px (X) thick: not ink
      ys = (y0 + mk..y1 - mk).select { |y| (x0..x1).any? { |x| ink.(x, y) } }
      next if ys.empty?
      top = ys.first - y0; bot = y1 - ys.last
      mins << [top, bot].min
      if (nm = (r['names'] || [])[i]) && !(c['view'] == 'half_vertical' && !r['cls'].include?('screen--lg'))   # (the two-line half vertical rows of the md screens carry the name on their first line)
        # symmetry: the day name (capitals, no glyph with a short end) stands centred between the dividers, within 2 px
        nx0 = (nm[0] * k).round - 2; nx1 = (nm[1] * k).round + 2
        nys = (y0 + mk..y1 - mk).select { |y| (nx0..nx1).any? { |x| ink.(x, y) } }
        unless nys.empty?
          na = nys.first - y0; nb = y1 - nys.last
          puts "ROWNAME #{c['name']} row #{i}: #{na} / #{nb}" if ENV['ROWDBG']
          out << "row #{i}: the day name stands #{na} px below the divider above and #{nb} px above the one below (centre it within 3 px)" if (na - nb).abs > 3.0
        end
      end
      (@rg ||= []) << [top, bot]
      out << "row #{i}: gap above #{top} px, below #{bot} px, need #{need.round(1)} of a #{h}px row" if top < need || bot < need
    end
    puts "ROWPAIRS #{c['name']}: #{@rg.inspect}" if ENV['ROWDBG']
    @rg = []
    puts "ROWOFF #{c['name']}: picture minus DOM #{off.round(1)} px" if ENV['ROWDBG']
    # ROWBAND: the rows share the band evenly (heights within 1.5 px) and fill it (first row at its top, last row at its bottom, 2 px), and there are as
    # many as the size class gives (full and half vertical: 4 md, 7 lg; never more than the days); no empty band.
    # ROWONES: the ones digits of the highs stand on one vertical line across the rows, and so do the lows (within 1.5 px)
    ones = []
    [0, 1].each do |q|
      xs = (r['ones'] || []).map { |o| o[q] }.compact
      ones << "#{q.zero? ? 'high' : 'low'} ones digits spread #{(xs.max - xs.min).round(1)} px across the rows" if xs.size > 1 && xs.max - xs.min > 1.5
    end
    band = []
    if r['band']
      hs = rows.map { |(_, t, _, b)| b - t }
      band << "rows differ in height (#{hs.map(&:round).inspect})" if hs.max - hs.min > 1.5
      band << "rows start #{(rows.first[1] - r['band'][1]).round(1)} px below the band top" if (rows.first[1] - r['band'][1]).abs > 2
      band << "rows end #{(r['band'][3] - rows.last[3]).round(1)} px above the band bottom" if (r['band'][3] - rows.last[3]).abs > 2
      want = [(r['cls'].include?('screen--lg') ? 7 : 4), r['n']].min
      band << "#{rows.size} rows, #{want} by the size class" if rows.size != want
    end
    [{ 'ROWGAP' => out, 'ROWBAND' => band, 'ROWONES' => ones }.reject { |_, v| v.empty? }, mins.min]
  end
end
