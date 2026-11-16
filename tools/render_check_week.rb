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
          { false => { false => 7, true => 4 }, true => { false => 7, true => 7 } }
        end
    [c[lg][port], n].min
  end

  def self.expected_style(view, fields, cls)
    return 'dig' unless view == 'full'
    ws = fields['week_style']
    return 'eq' if ws == 'eq'
    return 'dig' if ws == 'digital'
    cls.include?('screen--lg') && !cls.include?('screen--1bit') && !cls.include?('screen--2bit') ? 'eq' : 'dig'
  end

  # Returns [problems_by_check]. png: the screenshot path; c: the case hash; fields: the case's settings.
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
    # WEEKSTYLE: Auto -> sliders on the X, Digital on the rest; smaller views always Digital
    style = cols.any? { |q| !q['groove'].empty? } ? 'eq' : 'dig'
    style = 'none' if cols.empty?
    want_style = expected_style(view, fields, cls)
    out['WEEKSTYLE'] << "drew #{style}, want #{want_style}" unless style == want_style || cols.empty?
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
    if style == 'eq'
      parts = cols.map { |q| q['part'] }.compact
      out['WEEKSCALE'] << 'parts differ in height or top' if parts.map { |p| (p[3] - p[1]).round }.uniq.size > 1 || parts.map { |p| p[1].round }.uniq.size > 1
      tk = cols.map { |q| q['ticks'].map { |v| v.round(1) }.uniq.sort }
      out['WEEKSCALE'] << "tick positions differ between columns #{tk.uniq.size}" if tk.uniq.size > 1
      lab = g['lab']
      out['WEEKSCALE'] << 'no scale labels' if lab.nil? || lab['texts'].empty?
      if lab && !tk.empty? && !parts.empty?
        z = cols[0]['z']
        ys = tk[0].map { |v| parts[0][1] + v * z }
        lab['texts'].each { |(t, yc, _l, _r)| out['WEEKSCALE'] << "label #{t} at #{yc.round(1)} not on a tick #{ys.map { |v| v.round(1) }.inspect}" if ys.map { |v| (v - yc).abs }.min > 3.0 }
      end
    end
    # WEEKZERO: the 0 line is one element across the strip; every pixel of it is ink except inside a track, range bar or knob;
    # no label ink within 2 rows of it; none when 0 is not on the scale (digital draws none)
    if style == 'eq'
      z = g['zero']
      if z.nil?
        out['WEEKZERO'] << 'no 0 line element' if g['lab'] && g['lab']['texts'].any? { |(t, _)| t.to_s.start_with?('0') }
      else
        boxes = cols.flat_map { |q| q['rects'] + q['groove'] + [] }.map { |b| b.map { |v| v * kx } }
        inbox = ->(x, y) { boxes.any? { |(l, t, r, b)| x >= l.floor - 1 && x <= r.ceil + 1 && y >= t.floor - 1 && y <= b.ceil + 1 } }
        lum = ->(x, y) { v = img[x, y]; (ChunkyPNG::Color.r(v) + ChunkyPNG::Color.g(v) + ChunkyPNG::Color.b(v)) / 3.0 }
        dark = lum.(2, 2) < 100
        ink = ->(x, y) { dark ? lum.(x, y) > 55 : lum.(x, y) < 225 }
        x0 = (z[0] * kx).ceil + 1
        x1 = (z[2] * kx).floor - 1
        yc = ((z[1] + z[3]) / 2 * kx).round
        tickbox = cols.flat_map { |q| q['ticks'].map { |v| [(q['box'][0] + q['box'][2]) / 2 - 80, q['part'][1] + v * q['z'] - 1.5, (q['box'][0] + q['box'][2]) / 2 + 80, q['part'][1] + v * q['z'] + 1.5] } }.map { |b| b.map { |v| v * kx } }
        intick = ->(x, y) { tickbox.any? { |(l, t, r, b)| x >= l && x <= r && y >= t && y <= b } }
        rows = (yc - 4..yc + 4).map { |y| [y, (x0..x1).count { |x| !inbox.(x, y) && !ink.(x, y) }, (x0..x1).count { |x| !inbox.(x, y) && !intick.(x, y) && ink.(x, y) }] }
        line = rows.select { |_, miss, _| miss.zero? }.map(&:first)
        out['WEEKZERO'] << "no row of the 0 line is unbroken (not-ink pixels per row #{rows.map { |y, m, _| "#{y}:#{m}" }.join(' ')})" if line.empty?
        unless line.empty?
          bands = [line.min - 2, line.max + 2]
          near = bands.map { |y| [y, (x0..x1).count { |x| !inbox.(x, y) && !intick.(x, y) && ink.(x, y) }] }.select { |_, n| n.positive? }
          out['WEEKZERO'] << "ink next to the 0 line outside boxes (a label on the line?): #{near.map { |y, n| "#{y}:#{n}" }.join(' ')}" unless near.empty?
        end
      end
    end
    # WEEKONES (digital): in every column the high and low ones-digit right edges and degree-sign left edges agree within 1 px,
    # and each column has the same slot (relative to its own left edge) within 3.5 px (the columns sit on whole pixels, the digits' own sub-pixel offsets remain)
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
        out['WEEKONES'] << "column #{i}: ones right edge high #{hr} low #{lr}" if (hr - lr).abs > 1
        out['WEEKONES'] << "column #{i}: degree sign left edge high #{hd} low #{ld}" if (hd - ld).abs > 1
        rel = hr - (q['box'][0] * kx).round
        out['WEEKONES'] << "column #{i}: slot #{rel} vs #{prev}" if prev && (rel - prev).abs > 3.5
        prev ||= rel
      end
    end
    out
  end
end
