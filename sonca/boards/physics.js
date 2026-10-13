/* ==========================================================
   Section 9 board: physical dynamics — "Follow a physical law".

   Three views, one per level of the question.

   A. One built genome (the best its agent can do). The page's NCA (app.js)
      runs its rule UNCHANGED on a 64 x 64 torus (ip 0.2, ppp 0.02, no
      budget) in which every cell is founded with the same 44-number genome
      (biases 0). The board only writes STATE, never the rule: at a reset,
      alpha = the genome's own flat-field value and chemistry = 0.5 + r (T - 0.5);
      a heat drop writes chemistry = 0.5 + r/2 into living cells and leaves
      alpha alone. With every cell alive and one genome, inheritance copies an
      identical genome, so nothing mutates. Beside it, the exact discrete law
      (FTCS heat, five-point Laplacian, D = 0.2, or a one-cell shift for the
      advection genome) runs in float64 from the same field. The flat-field
      map and its fixed points are computed live from the genome.

   B. The substrate as is. The page's NCA again, unmodified (ip 0.2, ppp 0 or
      0.02, no budget): one full row of a screened founder genome on a
      160 x 160 torus grows two fronts. Front height, speed and roughness W
      are measured live as in the research's eden.js; the long-time curves
      are the research's offline runs (kpz.js).

   C. Selection on the task (offline only). The research's native.js runs a
      MODIFIED rule (listed in the view); the board replays its six runs.
   ========================================================== */

(function () {
  'use strict';
  if (!window.SONCA || !window.SONCA.board) return;

  window.SONCA.board('physics', function (root, kit) {
    var S = kit.S;
    var host = root.querySelector('.boardlive');
    host.innerHTML = '<p class="note">Loading the board&hellip;</p>';
    var api = null;

    kit.load('boards/data/physics.js?v=1', function (err) {
      var D = window.SONCA_DATA && window.SONCA_DATA.physics;
      if (err || !D) {
        host.innerHTML = '<p class="note">The board&rsquo;s data could not be loaded. Reload the page to try again.</p>';
        return;
      }
      api = build(D);
    });

    return {
      frame: function (t) { if (api) api.frame(t); },
      show: function () { if (api) api.show(); },
      hide: function () { }
    };

    /* ---------------------------------------------------------------- */

    function build(D) {
      var el = S.el, css = S.css;

      // ---------- small DOM helpers ----------
      function h(tag, attrs, kids) {
        var n = document.createElement(tag), k;
        for (k in (attrs || {})) {
          if (k === 'text') n.textContent = attrs[k];
          else if (k === 'html') n.innerHTML = attrs[k];
          else n.setAttribute(k, attrs[k]);
        }
        (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return n;
      }
      function btn(label, cls) { return h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: label }); }
      function seg(hostEl, items, onPick, initial) {
        var bs = items.map(function (it) {
          var b = h('button', { type: 'button', text: it.label, 'aria-pressed': String(it.key === initial) });
          b.addEventListener('click', function () { set(it.key); onPick(it.key); });
          hostEl.appendChild(b);
          return b;
        });
        function set(key) { bs.forEach(function (b, i) { b.setAttribute('aria-pressed', String(items[i].key === key)); }); }
        return { set: set };
      }
      function readnum(box, items) {
        var out = {};
        items.forEach(function (it) {
          var b = h('b', { text: '–' }), cap = h('span', { text: it[1] });
          box.appendChild(h('div', null, [b, cap]));
          out[it[0]] = { b: b, cap: cap };
        });
        return out;
      }
      function setNum(r, txt) { if (r.b.textContent !== txt) r.b.textContent = txt; }
      function setCap(r, txt) { if (r.cap.textContent !== txt) r.cap.textContent = txt; }
      function fig(label, em, aria, draw) {
        var cv = h('canvas', { class: 'cv' + (draw ? ' draw' : ''), width: 64, height: 64, 'aria-label': aria, role: 'img' });
        var lab = h('span', { text: label }), e = h('em', { text: em });
        return { fig: h('figure', { class: 'cvfig' }, [cv, h('figcaption', null, [lab, e])]), cv: cv, lab: lab, em: e };
      }
      function swatch(colourVar, line, dash) {
        var s = h('i', { class: 'swatch' + (line ? ' line' : '') });
        s.setAttribute('data-c', colourVar);
        if (dash) s.setAttribute('data-dash', '1');
        return s;
      }
      function paintSwatches(scope) {
        scope.querySelectorAll('i.swatch[data-c]').forEach(function (s) {
          var c = css(s.getAttribute('data-c'));
          s.style.background = s.getAttribute('data-dash')
            ? 'repeating-linear-gradient(90deg,' + c + ' 0 4px,transparent 4px 7px)' : c;
        });
      }

      // ---------- number formats ----------
      var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
      function sup(n) { return String(n).split('').map(function (c) { return SUP[c] || c; }).join(''); }
      function sci(x, d) {
        if (!isFinite(x)) return '–';
        if (x === 0) return '0';
        var s = x < 0 ? '−' : '', a = Math.abs(x), e = Math.floor(Math.log(a) / Math.LN10), m = a / Math.pow(10, e);
        if (+m.toFixed(d) >= 10) { m /= 10; e += 1; }
        return s + m.toFixed(d) + '×10' + sup(e);
      }
      function fmtErr(x) { return !isFinite(x) ? '–' : x >= 0.01 ? x.toFixed(3) : sci(x, 1); }
      function decade(v) { var e = Math.round(Math.log(v) / Math.LN10); return e === 0 ? '1' : e === 1 ? '10' : '10' + sup(e); }
      function intFmt(v) { return Math.round(v).toLocaleString('en-GB'); }

      // ---------- a small chart in the page's style, with log axes ----------
      // spec: { w, h, left, right, x: {min, max, log, ticks, fmt, tipFmt, label}, y: {...},
      //         series: [{label, colour, points, width, dash, end, dots}], bars: [{x, lo, mid, hi, colour}],
      //         marks: [{x, colour, label}], tip }
      function chart(svg, spec) {
        var W = spec.w, H = spec.h, L = spec.left || 54, R = spec.right || 70, T = 14, B = 40;
        var iw = W - L - R, ih = H - T - B, xs = spec.x, ys = spec.y;
        function tf(ax, v) { return ax.log ? Math.log(Math.max(v, 1e-300)) / Math.LN10 : v; }
        var x0 = tf(xs, xs.min), x1 = tf(xs, xs.max), y0 = tf(ys, ys.min), y1 = tf(ys, ys.max);
        function X(v) { return L + iw * (tf(xs, v) - x0) / ((x1 - x0) || 1); }
        function Y(v) { return T + ih * (1 - (tf(ys, v) - y0) / ((y1 - y0) || 1)); }
        function cy(p) { return Math.max(T - 2, Math.min(T + ih + 2, p)); }
        function col(c) { return c && c.indexOf('--') === 0 ? css(c) : (c || css('--text')); }
        kit.clear(svg);
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        ys.ticks.forEach(function (v) {
          var y = Y(v);
          svg.appendChild(el('line', { x1: L, x2: L + iw, y1: y, y2: y, class: Math.abs(y - (T + ih)) < 0.5 ? 'axisline' : 'gridline' }));
          svg.appendChild(el('text', { x: L - 8, y: y + 4, class: 'ticktext', 'text-anchor': 'end' }, ys.fmt(v)));
        });
        svg.appendChild(el('line', { x1: L, x2: L + iw, y1: T + ih, y2: T + ih, class: 'axisline' }));
        svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: T + ih, class: 'axisline' }));
        xs.ticks.forEach(function (v) {
          svg.appendChild(el('text', { x: X(v), y: T + ih + 17, class: 'ticktext', 'text-anchor': 'middle' }, xs.fmt(v)));
        });
        if (xs.label) svg.appendChild(el('text', { x: L + iw / 2, y: H - 4, class: 'ticktext', 'text-anchor': 'middle' }, xs.label));
        if (ys.label) svg.appendChild(el('text', { x: 12, y: T + ih / 2, class: 'ticktext', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (T + ih / 2) + ')' }, ys.label));
        (spec.marks || []).forEach(function (m) {
          var x = X(m.x); if (x < L - 0.5 || x > L + iw + 0.5) return;
          svg.appendChild(el('line', { x1: x, x2: x, y1: T, y2: T + ih, stroke: col(m.colour || '--text-mute'), 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 }));
          if (m.label) svg.appendChild(el('text', { x: x + 4, y: T + 10, class: 'ticktext' }, m.label));
        });
        (spec.bars || []).forEach(function (b) {
          var x = X(b.x), c = col(b.colour);
          svg.appendChild(el('line', { x1: x, x2: x, y1: cy(Y(b.lo)), y2: cy(Y(b.hi)), stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.55 }));
          svg.appendChild(el('line', { x1: x - 5, x2: x + 5, y1: cy(Y(b.mid)), y2: cy(Y(b.mid)), stroke: c, 'stroke-width': 2.4 }));
        });
        var ends = [];
        (spec.series || []).forEach(function (s) {
          var d = '', pts = s.points || [], k, last = null, gap = true;
          for (k = 0; k < pts.length; k++) {
            var p = pts[k];
            if (p[1] === null || !isFinite(p[1]) || (ys.log && p[1] <= 0) || (xs.log && p[0] <= 0)) continue;
            if (ys.log && p[1] < ys.min * 0.999) { gap = true; continue; }      // below a log axis: leave it out
            d += (gap ? 'M' : 'L') + X(p[0]).toFixed(1) + ',' + cy(Y(p[1])).toFixed(1);
            gap = false; last = p;
          }
          if (!d || s.hide) return;
          var a = { d: d, fill: 'none', stroke: col(s.colour), 'stroke-width': s.width || 2, 'stroke-linejoin': 'round' };
          if (s.dash) a['stroke-dasharray'] = s.dash;
          if (s.opacity) a.opacity = s.opacity;
          svg.appendChild(el('path', a));
          if (s.end && last) {
            var lx = X(last[0]), inline = lx + 8 + 7.2 * s.end.length <= W - 4 && lx < L + iw - 24;
            ends.push({ y: cy(Y(last[1])) + (inline ? -7 : 0), t: s.end, c: col(s.colour), x: inline ? lx + 6 : L + iw + 7 });
          }
        });
        // end labels: by the line's end when there is room, else in the right margin; nudge apart
        ends.sort(function (a, b) { return a.y - b.y; });
        ends.forEach(function (e, k) {
          for (var j = 0; j < k; j++) if (Math.abs(ends[j].x - e.x) < 90 && e.y - ends[j].y < 14) e.y = ends[j].y + 14;
        });
        // then keep them above the x-axis tick labels, pushing the stack back up where needed
        for (var k2 = ends.length - 1; k2 >= 0; k2--) {
          var lim = T + ih - 2;
          for (var j2 = k2 + 1; j2 < ends.length; j2++) if (Math.abs(ends[j2].x - ends[k2].x) < 90) lim = Math.min(lim, ends[j2].y - 14);
          if (ends[k2].y > lim) ends[k2].y = lim;
        }
        ends.forEach(function (e) {
          svg.appendChild(el('text', { x: e.x, y: e.y + 4, class: 'serieslabel', fill: e.c }, e.t));
        });
        if (spec.tip) {
          var tip = spec.tip;
          svg.onpointermove = function (ev) {
            var box = svg.getBoundingClientRect();
            var vx = (ev.clientX - box.left) / box.width * W;
            if (vx < L - 4 || vx > L + iw + 4) { S.hideTip(tip); return; }
            var xt = x0 + (vx - L) / iw * (x1 - x0), rows = '', bx = null, bxAlt = null, bdx = Infinity;
            (spec.series || []).forEach(function (s) {
              if (s.tip === false) return;
              var pts = s.points || [], j, bj = -1, bd = Infinity;
              for (j = 0; j < pts.length; j++) {
                if (pts[j][1] === null || !isFinite(pts[j][1]) || (ys.log && pts[j][1] <= 0)) continue;
                var dd = Math.abs(tf(xs, pts[j][0]) - xt);
                if (dd < bd) { bd = dd; bj = j; }
              }
              if (bj < 0 || bd > (x1 - x0) * (s.tipTol || 0.04)) return;
              if (!s.tipRow && bd < bdx) { bdx = bd; bx = pts[bj][0]; }
              if (s.tipRow && bxAlt === null) bxAlt = pts[bj][0];
              rows += '<div class="row"><i style="background:' + col(s.colour) + '"></i>' +
                (s.tipRow ? s.tipRow(pts[bj], bj) : s.label + ' ' + ys.tipFmt(pts[bj][1])) + '</div>';
            });
            if (bx === null) bx = bxAlt;
            if (bx === null) { S.hideTip(tip); return; }
            S.tipAt(tip, svg, W, H, X(bx), T, '<b>' + (xs.tipFmt ? xs.tipFmt(bx) : bx) + '</b>' + rows);
          };
          svg.onpointerleave = function () { S.hideTip(tip); };
        }
        return { X: X, Y: Y, L: L, T: T, iw: iw, ih: ih };
      }
      function boxWidth(node, fallback) {
        var w = node.clientWidth;
        return w > 0 ? Math.max(300, Math.min(920, Math.round(w))) : fallback;
      }
      function decadeTicks(lo, hi) {
        var a = Math.round(Math.log(lo) / Math.LN10), b = Math.round(Math.log(hi) / Math.LN10), out = [], step = b - a > 6 ? 2 : 1, e;
        for (e = a; e <= b; e += step) out.push(Math.pow(10, e));
        return out;
      }

      // ---------- scoped style ----------
      var style = document.createElement('style');
      style.textContent =
        '[data-board="physics"] .ph-rows{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;align-items:center;margin-bottom:10px}' +
        '[data-board="physics"] .ph-rows .ctl-label{white-space:nowrap}' +
        '[data-board="physics"] .ph-rows > *{justify-self:start;min-width:0}' +
        '[data-board="physics"] .ph-status{margin:0 0 8px;font-size:14px;color:var(--text)}' +
        '[data-board="physics"] .ph-cv3{grid-template-columns:repeat(3,minmax(0,1fr))}' +
        '[data-board="physics"] .ph-scale{display:inline-block;width:84px;height:10px;border-radius:2px;border:1px solid var(--rule-strong)}' +
        '[data-board="physics"] .ph-mini{margin-top:6px}' +
        '[data-board="physics"] .ph-mini .kicker{display:block;margin:10px 0 2px}' +
        '[data-board="physics"] .ph-sm{font-size:13px;margin:6px 0 0}' +
        '[data-board="physics"] .ph-pane[hidden]{display:none}' +
        '[data-board="physics"] .ph-cvwrap{position:relative}' +
        '[data-board="physics"] .tip{white-space:normal;max-width:250px}' +
        '[data-board="physics"] .tip:not(.on){left:0!important;top:0!important}' +
        '[data-board="physics"] .ph-ovl{position:absolute;left:1px;top:1px;width:calc(100% - 2px);height:calc(100% - 2px);pointer-events:none;overflow:hidden}' +
        '[data-board="physics"] .ph-fr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px;align-items:start}' +
        '@media (max-width:880px){[data-board="physics"] .ph-fr{grid-template-columns:1fr}' +
        '[data-board="physics"] .ph-fr .cvfig{max-width:420px}}' +
        '@media (max-width:560px){[data-board="physics"] .ph-rows{grid-template-columns:1fr;gap:6px}' +
        '[data-board="physics"] .ph-cv3 figcaption{flex-direction:column;gap:0}' +
        '[data-board="physics"] .ph-cv3{gap:6px}' +
        // the three level buttons stack rather than wrap inside a pill
        '[data-board="physics"] .ph-level{display:flex;flex-direction:column;border-radius:12px;width:100%}' +
        '[data-board="physics"] .ph-level button{text-align:left}' +
        '[data-board="physics"] .ph-level button + button{border-left:0;border-top:1px solid var(--rule-strong)}}';
      document.head.appendChild(style);

      kit.clear(host);
      var levelRow = h('div', { class: 'ph-rows' });
      var levelSw = h('div', { class: 'switch ph-level', role: 'group', 'aria-label': 'Choose a level' });
      levelRow.appendChild(h('span', { class: 'ctl-label', text: 'Level' }));
      levelRow.appendChild(levelSw);
      host.appendChild(levelRow);
      var paneA = h('div', { class: 'ph-pane' }), paneB = h('div', { class: 'ph-pane', hidden: '' }), paneC = h('div', { class: 'ph-pane', hidden: '' });
      host.appendChild(paneA); host.appendChild(paneB); host.appendChild(paneC);

      var A = heatView(paneA), B = frontView(paneB), C = selectView(paneC);
      var mode = 'heat', views = { heat: A, fronts: B, select: C }, panes = { heat: paneA, fronts: paneB, select: paneC };
      seg(levelSw, [
        { key: 'heat', label: 'One built genome' },
        { key: 'fronts', label: 'The substrate as is' },
        { key: 'select', label: 'Selection on the task' }
      ], function (k) {
        mode = k;
        hideTips();
        Object.keys(panes).forEach(function (p) { panes[p].hidden = p !== k; });
        views[k].show();
      }, 'heat');

      document.addEventListener('themechange', function () {
        paintSwatches(host);
        A.redrawAll(); B.redrawAll(); C.redrawAll();
      });
      var rsz = null;
      window.addEventListener('resize', function () {
        clearTimeout(rsz);
        hideTips();
        rsz = setTimeout(function () { views[mode].redrawAll(); }, 150);
      });
      function hideTips() { host.querySelectorAll('.tip').forEach(function (tp) { S.hideTip(tp); }); }
      paintSwatches(host);
      A.show();

      return {
        frame: function (t) { views[mode].frame(t); },
        show: function () { paintSwatches(host); views[mode].show(); }
      };

      /* ==============================================================
         A. One built genome: the agent against the exact law
         ============================================================== */
      function heatView(pane) {
        var HW = 64, HN = HW * HW, DIFF = 0.2;
        var GEN = {}, ORDER = ['fit02', 'fit05', 'hand05', 'blind05', 'shift02'];
        var LABEL = {
          fit02: 'Fitted, r = 0.2', fit05: 'Fitted, r = 0.5', hand05: 'Hand-built, r = 0.5',
          blind05: 'Blind search, r = 0.5', shift02: 'Advection, r = 0.2'
        };
        var NOTE = {
          fit02: 'Built, not evolved: a fitted two-unit map placed into the 40 weights. Temperature T is stored as chemistry 0.5 + 0.2(T − 0.5), a narrow range.',
          fit05: 'The same construction over a wider range: chemistry 0.5 + 0.5(T − 0.5). The squash bends it more.',
          hand05: 'Built by hand from the heat stencil, with no fitting at all. Chemistry 0.5 + 0.5(T − 0.5).',
          blind05: 'The best of three blind CMA-ES runs from founder-like weights, 12,000 evaluations each. An external optimiser, not the substrate.',
          shift02: 'The fitted construction with a one-cell shift in place of the heat stencil: the field should move one column right per step.'
        };
        D.genomes.forEach(function (g) {
          g.g32 = Float32Array.from(g.genome);
          g.flat = flatMap(g);
          GEN[g.id] = g;
        });
        var gen = GEN.fit02;

        // ---- the substrate grid (page engine, unchanged) and the exact law ----
        var sim = S.NCA({ W: HW, init: 0, ip: 0.2, ppp: 0.02, budget: Infinity, act: 'sigmoid' });
        var T = new Float64Array(HN), T2 = new Float64Array(HN), t = 0;
        var cur = null, hist = null, marks = [], lastBucket = -1;
        function enc(x) { return 0.5 + gen.r * (x - 0.5); }
        function dec(u) { return (u - 0.5) / gen.r + 0.5; }

        function startField() {
          var F = new Float64Array(HN), i, j, b;
          if (gen.law === 'shift') {
            // one disc, as in the research's advection pictures (render_heat.js)
            for (i = 0; i < HW; i++) for (j = 0; j < HW; j++) if ((i - 32) * (i - 32) + (j - 16) * (j - 16) <= 64) F[i * HW + j] = 1;
            return F;
          }
          // hot discs on a cold grid: lib.js icBlobs(64, mulberry32(77), 6), the research's example field
          var rnd = kit.rng(77);
          for (b = 0; b < 6; b++) {
            var ci = rnd() * HW, cj = rnd() * HW, rad = 1.5 + rnd() * HW / 8;
            for (i = 0; i < HW; i++) for (j = 0; j < HW; j++) {
              var di = Math.abs(i - ci), dj = Math.abs(j - cj);
              di = Math.min(di, HW - di); dj = Math.min(dj, HW - dj);
              if (di * di + dj * dj <= rad * rad) F[i * HW + j] = 1;
            }
          }
          return F;
        }
        function reset(F) {
          var n = HN, i, g = gen.g32;
          sim.seed(0, function (s) { for (i = 0; i < s.N; i++) s.found(i, g); });
          for (i = 0; i < n; i++) { sim.st[i] = gen.alpha0; sim.st[n + i] = enc(F[i]); sim.bud[i] = 1; }
          T.set(F); t = 0;
          hist = { err: [], gap: [] }; marks = []; lastBucket = -1;
          measure(); dirty = true; chartDirty = true; miniDirty = true;
        }
        function exactStep() {
          var i, j, W = HW;
          if (gen.law === 'heat') {
            for (i = 0; i < W; i++) for (j = 0; j < W; j++) {
              var c = T[i * W + j];
              var s = T[((i + 1) % W) * W + j] + T[((i - 1 + W) % W) * W + j] + T[i * W + (j + 1) % W] + T[i * W + (j - 1 + W) % W];
              T2[i * W + j] = c + DIFF * (s - 4 * c);
            }
          } else {
            for (i = 0; i < W; i++) for (j = 0; j < W; j++) T2[i * W + j] = T[i * W + (j - 1 + W) % W];
          }
          var tmp = T; T = T2; T2 = tmp;
        }
        function step() {
          sim.step();
          exactStep();
          t++;
          measure();
        }
        function measure() {
          var n = HN, st = sim.st, i, se = 0, sa = 0, sx = 0, alive = 0, pa = -Infinity, px = -Infinity;
          for (i = 0; i < n; i++) {
            if (st[i] > 0.5) alive++;
            var a = dec(st[n + i]), e = a - T[i];
            se += e * e; sa += a; sx += T[i];
            if (a > pa) pa = a;
            if (T[i] > px) px = T[i];
          }
          cur = { rmse: Math.sqrt(se / n), meanA: sa / n, meanX: sx / n, alive: alive, peakA: pa, peakX: px };
          if (t >= 1) {
            var bucket = t <= 100 ? t : 100 + Math.floor(Math.log(t) / Math.LN10 * 100);
            if (bucket !== lastBucket) {
              lastBucket = bucket;
              hist.err.push([t, cur.rmse]);
              hist.gap.push([t, Math.max(1e-9, Math.abs(cur.meanA - cur.meanX))]);
            } else {
              hist.err[hist.err.length - 1] = [t, cur.rmse];
              hist.gap[hist.gap.length - 1] = [t, Math.max(1e-9, Math.abs(cur.meanA - cur.meanX))];
            }
          }
        }
        function drop(row, col, rad) {
          var n = HN, i, j, u = enc(1);
          for (i = -rad; i <= rad; i++) for (j = -rad; j <= rad; j++) {
            if (i * i + j * j > rad * rad) continue;
            var idx = ((row + i + HW) % HW) * HW + ((col + j + HW) % HW);
            T[idx] = 1;
            if (sim.st[idx] > 0.5) sim.st[n + idx] = u;      // living cells only; alpha untouched
          }
          if (t >= 1 && (!marks.length || marks[marks.length - 1] !== t)) { marks.push(t); if (marks.length > 40) marks.shift(); }
          measure(); dirty = true; chartDirty = true;
        }

        // ---- flat-field map, computed live from the genome ----
        // On a flat field every cell reads the same neighbourhood, so one step of the page rule maps a flat
        // temperature T to a flat f(T). The exact law has f(T) = T everywhere; the agent keeps only a few.
        function flatMap(g) {
          var w = g.genome, r = g.r;     // float64 copy: the hand-built map is so flat near T = 0.5 that float32 moves its root
          function sig(x) { return 1 / (1 + Math.exp(-x)); }
          function sums(k) { var sa = 0, su = 0, m; for (m = 0; m < 9; m++) { sa += w[k * 18 + m]; su += w[k * 18 + 9 + m]; } return [sa, su]; }
          var s0 = sums(0), s1 = sums(1);
          function f(Tv) {
            var u = 0.5 + r * (Tv - 0.5), a = 1, it, h0, h1;
            for (it = 0; it < 60; it++) {       // the genome's own settled alpha at this chemistry
              h0 = sig(w[36] + s0[0] * a + s0[1] * u); h1 = sig(w[37] + s1[0] * a + s1[1] * u);
              a = sig(w[42] + w[38] * h0 + w[39] * h1);
            }
            h0 = sig(w[36] + s0[0] * a + s0[1] * u); h1 = sig(w[37] + s1[0] * a + s1[1] * u);
            return (sig(w[43] + w[40] * h0 + w[41] * h1) - 0.5) / r + 0.5;
          }
          var N = 2000, q, xs = [], es = [], fps = [], curve = [], ymax = 0;
          for (q = 0; q <= N; q++) { var Tv = q / N; xs.push(Tv); es.push(f(Tv) - Tv); ymax = Math.max(ymax, Math.abs(es[q])); }
          for (q = 0; q < N; q++) {
            if (es[q] * es[q + 1] < 0) {
              var root = xs[q] + (xs[q + 1] - xs[q]) * es[q] / (es[q] - es[q + 1]);
              fps.push({ T: root, stable: es[q] > 0 && es[q + 1] < 0 });
            }
          }
          for (q = 0; q <= N; q += 10) curve.push([xs[q], es[q]]);
          return { fps: fps, curve: curve, ymax: ymax };
        }
        // where a flat field at mean m drifts: the stable fixed point inside the basin bounded by the
        // unstable fixed points around m (not simply the stable point nearest m)
        function attractor(m) {
          var lo = -Infinity, hi = Infinity, best = null;
          gen.flat.fps.forEach(function (p) {
            if (p.stable) return;
            if (p.T <= m && p.T > lo) lo = p.T;
            if (p.T > m && p.T < hi) hi = p.T;
          });
          gen.flat.fps.forEach(function (p) { if (p.stable && p.T > lo && p.T < hi) best = p; });
          return best;
        }

        // ---- layout ----
        var gRow = h('div', { class: 'ph-rows' }), gHost = h('div', { role: 'group', 'aria-label': 'Choose a genome' });
        gRow.appendChild(h('span', { class: 'ctl-label', text: 'Genome' })); gRow.appendChild(gHost);
        var noteEl = h('p', { class: 'note presetnote' });
        pane.appendChild(gRow); pane.appendChild(noteEl);

        var fX = fig('Exact law', 'FTCS, D = 0.2', 'Exact discrete heat equation. Drag to drop heat.', true);
        var fA = fig('44-parameter agent', 'page engine', 'The agent: chemistry decoded as temperature. Drag to drop heat.', true);
        var fE = fig('|agent − exact|', '', 'Absolute difference between agent and exact law, auto-scaled. Drag to drop heat.', true);
        var cvrow = h('div', { class: 'cvrow ph-cv3' }, [fX.fig, fA.fig, fE.fig]);
        var scale = h('i', { class: 'ph-scale' });
        var stops = []; for (var q = 0; q <= 12; q++) { var c = kit.magma(Math.max(0.001, q / 12)); stops.push('rgb(' + c.map(Math.round).join(',') + ')'); }
        scale.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
        var legend = h('div', { class: 'legend' }, [
          h('span', null, ['T = 0 ', scale, ' 1']),
          h('span', { text: '|agent − exact|: 0 to its current maximum (at least 10⁻⁶)' })
        ]);
        var svg = el('svg', { role: 'img', 'aria-label': 'RMS error and mean-temperature gap against steps, log scales' });
        var tip = h('div', { class: 'tip' });
        var chartbox = h('div', { class: 'chartbox', style: 'margin-top:14px' }, [svg, tip]);
        var chartLegend = h('div', { class: 'legend' }, [
          h('span', null, [swatch('--gcvp', true), 'RMS error, this run (T units)']),
          h('span', null, [swatch('--chem', true), '|mean T, agent − exact|']),
          h('span', null, [swatch('--text-mute', true), 'offline: mean and range over 10 other starting fields']),
          h('span', null, [swatch('--text-mute', true, true), 'heat dropped'])
        ]);
        var left = h('div', null, [cvrow, legend, chartbox, chartLegend, h('p', { class: 'note ph-sm', text:
          'The page’s rule runs unchanged. Every cell is founded with this genome and stays alive, so nothing mutates; the board writes only state: the starting field, and heat drops into chemistry.' })]);

        var status = h('p', { class: 'ph-status', 'aria-live': 'polite' });
        var rnBox = h('div', { class: 'readnum' });
        var rn = readnum(rnBox, [
          ['t', 'steps'], ['err', 'RMS error, agent vs exact (T units)'],
          ['mx', 'mean T, exact law'], ['ma', 'mean T, agent'],
          ['alive', 'cells alive, of 4,096'], ['drift', 'heat drifts toward (flat-field attractor)']
        ]);
        var bPlay = btn(kit.reduceMotion ? 'Play' : 'Pause', 'primary'), bStep = btn('Step');
        var bReset = btn('Reset'), bCold = btn('Cold'), bDrop = btn('Drop heat');
        bReset.title = 'Back to the starting field'; bCold.title = 'T = 0 everywhere'; bDrop.title = 'A hot disc somewhere at random';
        var controls = h('div', { class: 'controls' }, [bPlay, bStep, bReset, bCold, bDrop]);
        var spIn = h('input', { type: 'range', min: '1', max: '20', step: '1', value: '2', id: 'phSpeed' }), spOut = h('output', { for: 'phSpeed' });
        var slider = h('div', { class: 'slider' }, [h('label', { for: 'phSpeed', text: 'steps per frame' }), spIn, spOut]);
        var miniSvg = el('svg', { role: 'img', 'aria-label': 'Change per step on a flat field, against its temperature' });
        var miniCap = h('p', { class: 'note ph-sm' });
        var mini = h('div', { class: 'ph-mini' }, [h('span', { class: 'kicker', text: 'Flat field: change per step' }), h('div', { class: 'chartbox' }, [miniSvg]), miniCap]);
        var right = h('div', { class: 'readout' }, [status, rnBox, controls, slider, mini]);
        pane.appendChild(h('div', { class: 'lab' }, [left, right]));

        var running = !kit.reduceMotion, dirty = true, chartDirty = true, miniDirty = true, spf = 2, dBuf = new Float64Array(HN);
        var tick = kit.every(15), tickRead = kit.every(120), tickChart = kit.every(400);
        kit.slider(spIn, spOut, function (v) { return String(v); }, function (v) { spf = v; });
        kit.pills(gHost, ORDER.map(function (k) { return { key: k, label: LABEL[k] }; }), function (k) { setGenome(k); }, 'fit02');

        function setGenome(id) {
          gen = GEN[id];
          noteEl.textContent = NOTE[id];
          fX.lab.textContent = gen.law === 'heat' ? 'Exact law' : 'Exact shift';
          fX.em.textContent = gen.law === 'heat' ? 'FTCS, D = 0.2' : 'one cell per step';
          fA.em.textContent = 'page engine, r = ' + gen.r;
          bReset.textContent = 'Reset';
          bReset.title = gen.law === 'heat' ? 'Back to the hot discs' : 'Back to one disc';
          reset(startField());
          readouts(); paint(); drawChart(); drawMini();
        }
        bPlay.addEventListener('click', function () { running = !running; bPlay.textContent = running ? 'Pause' : 'Play'; readouts(); });
        bStep.addEventListener('click', function () {
          running = false; bPlay.textContent = 'Play';
          step(); dirty = true; chartDirty = true; miniDirty = true; readouts(); paint(); drawChart(); drawMini();
        });
        bReset.addEventListener('click', function () { reset(startField()); readouts(); paint(); drawChart(); drawMini(); });
        bCold.addEventListener('click', function () { reset(new Float64Array(HN)); readouts(); paint(); drawChart(); drawMini(); });
        var dropRnd = kit.rng(20261013);
        bDrop.addEventListener('click', function () {
          drop((dropRnd() * HW) | 0, (dropRnd() * HW) | 0, 3); readouts(); paint(); drawChart(); drawMini();
        });
        [fX.cv, fA.cv, fE.cv].forEach(function (cv) {
          kit.pointer(cv, HW, HW, function (row, col, phase) {
            // pointer capture keeps reporting outside the canvas: ignore it there, rather than wrap it round the torus
            if (phase === 'up' || row < 0 || col < 0 || row >= HW || col >= HW) return;
            drop(row, col, 3);
            if (!running) { readouts(); paint(); }
          });
        });

        function paint() {
          var n = HN, st = sim.st, r = gen.r, emax = 0, i, d = dBuf;
          kit.draw(fX.cv, HW, HW, function (i, rgb) {
            var c = kit.magma(Math.max(0.001, Math.min(1, T[i]))); rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
          });
          kit.draw(fA.cv, HW, HW, function (i, rgb) {
            if (!(st[i] > 0.5)) return;
            var c = kit.magma(Math.max(0.001, Math.min(1, (st[n + i] - 0.5) / r + 0.5))); rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
          });
          for (i = 0; i < n; i++) { d[i] = Math.abs((st[n + i] - 0.5) / r + 0.5 - T[i]); if (d[i] > emax) emax = d[i]; }
          var escale = Math.max(emax, 1e-6);     // a floor, so float32 rounding at step 0 is not blown up to full colour
          kit.draw(fE.cv, HW, HW, function (i, rgb) {
            var c = kit.magma(Math.max(0.001, d[i] / escale)); rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
          });
          var em = 'max ' + fmtErr(emax);
          if (fE.em.textContent !== em) fE.em.textContent = em;
          dirty = false;
        }
        function readouts() {
          setNum(rn.t, intFmt(t));
          setNum(rn.err, fmtErr(cur.rmse));
          setNum(rn.mx, cur.meanX.toFixed(4));
          setNum(rn.ma, cur.meanA.toFixed(4));
          setNum(rn.alive, intFmt(cur.alive));
          if (gen.law === 'heat') {
            var a = attractor(cur.meanA);
            setNum(rn.drift, a ? 'T = ' + a.T.toFixed(2) : '–');
            setCap(rn.drift, 'heat drifts toward (flat-field attractor)');
          } else {
            setNum(rn.drift, cur.peakA.toFixed(3));
            setCap(rn.drift, 'peak T, agent (exact keeps ' + cur.peakX.toFixed(3) + ')');
          }
          // laps go in the steps caption, and the (aria-live) status changes only with the run state,
          // not with every step, so a screen reader is not flooded while it runs
          setCap(rn.t, gen.law === 'shift' && t > 0 ? 'steps (' + (t / HW).toFixed(1) + ' laps of the grid)' : 'steps');
          var s = running ? 'Running' : 'Paused' + (t ? ' at step ' + intFmt(t) : ' at the start');
          if (status.textContent !== s + '.') status.textContent = s + '.';
        }
        function drawChart() {
          var w = boxWidth(chartbox, 640), H = w < 480 ? 230 : 250;
          var off = gen.offline.at, vals = [];
          hist.err.forEach(function (p) { vals.push(p[1]); });
          hist.gap.forEach(function (p) { if (p[1] > 1e-9) vals.push(p[1]); });
          ['1', '100', '1000'].forEach(function (s) { vals.push(off[s][1], off[s][2]); });
          var lo = Infinity, hi = 0;
          vals.forEach(function (v) { if (v > 0 && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
          var ylo = Math.pow(10, Math.max(-8, Math.floor(Math.log(lo) / Math.LN10)));
          var yhi = Math.pow(10, Math.min(1, Math.ceil(Math.log(hi) / Math.LN10)));
          if (yhi / ylo < 100) ylo = yhi / 100;
          var xhi = Math.max(1000, Math.pow(10, Math.ceil(Math.log(Math.max(1, t)) / Math.LN10)));
          var bars = ['1', '100', '1000'].map(function (s) { return { x: +s, mid: off[s][0], lo: off[s][1], hi: off[s][2], colour: '--text-mute' }; });
          chart(svg, {
            w: w, h: H, left: 58, right: 22,
            x: { min: 0.8, max: xhi * 1.25, log: true, ticks: decadeTicks(1, xhi), fmt: function (v) { return intFmt(v); }, tipFmt: function (v) { return 'step ' + intFmt(v); }, label: 'step' },
            y: { min: ylo, max: yhi, log: true, ticks: decadeTicks(ylo, yhi), fmt: decade, tipFmt: fmtErr, label: 'T units' },
            series: [
              { label: 'offline', colour: '--text-mute', points: bars.map(function (b) { return [b.x, b.mid]; }), hide: true, tipTol: 0.02,
                tipRow: function (pt, j) { return 'offline at step ' + intFmt(pt[0]) + ': ' + fmtErr(bars[j].mid) + ' (' + fmtErr(bars[j].lo) + '\u2013' + fmtErr(bars[j].hi) + ')'; } },
              { label: '|mean gap|', colour: '--chem', points: hist.gap, width: 1.8 },
              { label: 'RMS error', colour: '--gcvp', points: hist.err, width: 2.2 }
            ],
            bars: bars,
            marks: marks.map(function (m) { return { x: m }; }),
            tip: tip
          });
          chartDirty = false;
        }
        function drawMini() {
          var w = boxWidth(mini, 300), H = 150, F = gen.flat, ym = F.ymax * 1.15 || 1e-6;
          var L = 62, R = 10, Tt = 10, B = 26, iw = w - L - R, ih = H - Tt - B;
          function X(v) { return L + iw * v; }
          function Y(v) { return Tt + ih * (1 - (v + ym) / (2 * ym)); }
          kit.clear(miniSvg);
          miniSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + H);
          [-F.ymax, 0, F.ymax].forEach(function (v) {
            miniSvg.appendChild(el('line', { x1: L, x2: L + iw, y1: Y(v), y2: Y(v), class: v === 0 ? 'axisline' : 'gridline' }));
            miniSvg.appendChild(el('text', { x: L - 6, y: Y(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v === 0 ? '0' : (v > 0 ? '+' : '') + sci(v, 1)));
          });
          [0, 0.5, 1].forEach(function (v) {
            miniSvg.appendChild(el('text', { x: X(v), y: H - 8, class: 'ticktext', 'text-anchor': 'middle' }, v === 0 ? 'T = 0' : String(v)));
          });
          miniSvg.appendChild(el('line', { x1: L, x2: L, y1: Tt, y2: Tt + ih, class: 'axisline' }));
          var d = F.curve.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join('');
          miniSvg.appendChild(el('path', { d: d, fill: 'none', stroke: css('--chem'), 'stroke-width': 2 }));
          var a = gen.law === 'heat' ? attractor(cur.meanA) : null;
          if (gen.law === 'heat') {
            var mx = X(Math.max(0, Math.min(1, cur.meanA)));
            miniSvg.appendChild(el('line', { x1: mx, x2: mx, y1: Tt, y2: Tt + ih, stroke: css('--cyan'), 'stroke-width': 1.4, 'stroke-dasharray': '3 3' }));
            if (a) {
              var ax = X(a.T), y0 = Y(0), dir = ax > mx ? 1 : -1;
              if (Math.abs(ax - mx) > 8) {
                miniSvg.appendChild(el('line', { x1: mx, x2: ax - dir * 7, y1: y0 - 9, y2: y0 - 9, stroke: css('--cyan'), 'stroke-width': 1.6 }));
                miniSvg.appendChild(el('path', { d: 'M' + (ax - dir * 7) + ',' + (y0 - 13) + 'L' + (ax - dir * 1) + ',' + (y0 - 9) + 'L' + (ax - dir * 7) + ',' + (y0 - 5) + 'Z', fill: css('--cyan') }));
              }
            }
          }
          F.fps.forEach(function (p) {
            var on = a && p === a;
            miniSvg.appendChild(el('circle', {
              cx: X(p.T), cy: Y(0), r: on ? 5.5 : 4.2, fill: p.stable ? css('--chem') : css('--panel'),
              stroke: on ? css('--cyan') : css('--chem'), 'stroke-width': on ? 2.4 : 1.6
            }));
          });
          var st = F.fps.filter(function (p) { return p.stable; }).map(function (p) { return p.T.toFixed(2); });
          var un = F.fps.filter(function (p) { return !p.stable; }).map(function (p) { return p.T.toFixed(2); });
          var cap = 'The exact law changes a flat field by 0 at every T. This genome keeps only T = ' + st.join(', ') +
            ' (filled: attract)' + (un.length ? ' and ' + un.join(', ') + ' (open: repel)' : '') + '.';
          if (gen.law === 'shift') cap += ' Hot cells settle near the top one and cold cells near the bottom one.';
          else cap += ' The dashed line is the agent’s mean T now.';
          if (miniCap.textContent !== cap) miniCap.textContent = cap;
          miniDirty = false;
        }
        function redrawAll() { paint(); readouts(); drawChart(); drawMini(); }

        function frame(time) {
          if (running && tick(time)) {
            for (var k = 0; k < spf; k++) step();
            dirty = true; chartDirty = true; miniDirty = true;
          }
          if (dirty) paint();
          if (tickRead(time)) readouts();
          if (chartDirty && tickChart(time)) { drawChart(); if (miniDirty) drawMini(); }
        }

        setGenome('fit02');
        return {
          frame: frame,
          show: function () { redrawAll(); },
          redrawAll: redrawAll
        };
      }

      /* ==============================================================
         B. The substrate as is: a line of founders grows two fronts
         ============================================================== */
      function frontView(pane) {
        var FW = 160, HALF = FW >> 1, ROW0 = HALF, STOP = HALF - 4;
        var founder = Float32Array.from(D.fronts.founder), ppp = 0.02, view = 'ghc';
        var sim = S.NCA({ W: FW, init: 0, ip: 0.2, ppp: ppp, budget: Infinity, act: 'sigmoid' });
        var t = 0, hm = [], series = [], cuts = [], over = '', cur = null, upH = new Int32Array(FW), dnH = new Int32Array(FW);

        function reseed() {
          sim.ppp = ppp;
          sim.seed(0, function (s) { for (var j = 0; j < FW; j++) s.found(ROW0 * FW + j, founder); });
          t = 0; hm = [0]; series = []; cuts = []; over = '';
          measure(); dirty = true; chartDirty = true;
        }
        // front heights as in eden.js: for each column, the distance from the founding row of the furthest
        // living cell on that side (within half the grid)
        function measure() {
          var st = sim.st, j, d, alive = 0, i;
          for (i = 0; i < sim.N; i++) if (st[i] > 0.5) alive++;
          var su = 0, sd = 0, qu = 0, qd = 0, mxh = 0;
          for (j = 0; j < FW; j++) {
            var hu = 0, hd = 0;
            for (d = HALF - 1; d >= 0; d--) if (st[(ROW0 - d) * FW + j] > 0.5) { hu = d; break; }
            for (d = HALF - 1; d >= 0; d--) if (st[(ROW0 + d) * FW + j] > 0.5) { hd = d; break; }
            upH[j] = hu; dnH[j] = hd; su += hu; sd += hd; mxh = Math.max(mxh, hu, hd);
          }
          var mu = su / FW, md = sd / FW;
          for (j = 0; j < FW; j++) { qu += (upH[j] - mu) * (upH[j] - mu); qd += (dnH[j] - md) * (dnH[j] - md); }
          // count a front only once it is clearly growing (the research kept fronts that grew)
          var useU = t < 20 || mu > 0.15 * t, useD = t < 20 || md > 0.15 * t, nf = (useU ? 1 : 0) + (useD ? 1 : 0);
          var w2 = nf ? ((useU ? qu / FW : 0) + (useD ? qd / FW : 0)) / nf : NaN;
          var mean = nf ? ((useU ? mu : 0) + (useD ? md : 0)) / nf : NaN;
          hm[t] = mean;
          var speed = t >= 20 && isFinite(mean) ? (mean - hm[t >> 1]) / (t - (t >> 1)) : NaN;
          cur = { alive: alive, mean: mean, W: Math.sqrt(w2), speed: speed, nf: nf, mxh: mxh };
          if (t >= 1 && isFinite(cur.W) && cur.W > 0) series.push([t, cur.W]);
          if (alive === 0) over = 'dead';
          else if (mxh >= STOP) over = 'edge';
          else if (t >= 80 && nf === 0) over = 'stuck';
        }
        function step() { sim.step(); t++; measure(); }

        // ---- layout ----
        var vRow = h('div', { class: 'ph-rows' });
        var pppSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Mutation rate' });
        var viewSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Colouring' });
        vRow.appendChild(h('span', { class: 'ctl-label', text: 'Mutation' })); vRow.appendChild(pppSw);
        vRow.appendChild(h('span', { class: 'ctl-label', text: 'Colour by' })); vRow.appendChild(viewSw);
        var lineSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Show the measured front' });
        vRow.appendChild(h('span', { class: 'ctl-label', text: 'Front line' })); vRow.appendChild(lineSw);
        var noteEl = h('p', { class: 'note presetnote', text: 'The rule runs unchanged. A full row of one screened founder genome, ip = 0.2, no budget, on a 160 × 160 torus. The colony advances up and down; each front’s height is read column by column.' });
        pane.appendChild(vRow); pane.appendChild(noteEl);

        var fF = fig('Line of founders', 'step 0', 'The colony growing from a line of founders. Drag to cut a notch in it.', true);
        fF.cv.width = FW; fF.cv.height = FW;
        // the measured front heights, drawn over the canvas: solid = each column's front, dashed = its mean
        var ovl = el('svg', { viewBox: '0 0 ' + FW + ' ' + FW, preserveAspectRatio: 'none', class: 'ph-ovl', 'aria-hidden': 'true' });
        var wrapCv = h('div', { class: 'ph-cvwrap' });
        fF.fig.insertBefore(wrapCv, fF.cv); wrapCv.appendChild(fF.cv); wrapCv.appendChild(ovl);
        var showLine = true;
        var svg = el('svg', { role: 'img', 'aria-label': 'Front roughness W against steps, log scales, live and offline' });
        var tip = h('div', { class: 'tip' });
        var chartbox = h('div', { class: 'chartbox' }, [svg, tip]);
        var chartLegend = h('div', { class: 'legend' });
        var frow = h('div', { class: 'ph-fr' }, [fF.fig, h('div', null, [chartbox])]);
        var left = h('div', null, [frow, chartLegend, h('p', { class: 'note ph-sm', html:
          'The substrate&rsquo;s offline curve is the research&rsquo;s runs on this engine; the no-network curves are a separate growth rule, run offline. A 160-wide front nears the edge after about 190 steps with W of only about 1.8&ndash;2.4, too short to measure the exponent &beta; live, so &beta; comes from the offline runs (fits from t = 50 to about 625; to 10,060 for the long reference).' })]);

        var status = h('p', { class: 'ph-status', 'aria-live': 'polite' });
        var rnBox = h('div', { class: 'readnum' });
        var rn = readnum(rnBox, [
          ['t', 'steps'], ['h', 'mean front height (rows)'],
          ['v', 'speed (rows per step)'], ['w', 'roughness W (rows)']
        ]);
        var bPlay = btn(kit.reduceMotion ? 'Play' : 'Pause', 'primary'), bReseed = btn('Reseed'), bNew = btn('New founder');
        bReseed.title = 'The same founder, a fresh run'; bNew.title = 'Draw another screened founder genome';
        var controls = h('div', { class: 'controls' }, [bPlay, bReseed, bNew]);
        var spIn = h('input', { type: 'range', min: '5', max: '60', step: '5', value: '30', id: 'phFrontSpeed' }), spOut = h('output', { for: 'phFrontSpeed' });
        var slider = h('div', { class: 'slider' }, [h('label', { for: 'phFrontSpeed', text: 'speed' }), spIn, spOut]);
        var side = h('div', { html:
          '<p class="note ph-sm">White lines: the front read in each column; dashed: its mean height. W is how far the columns stray from that mean. Drag on the colony to cut a notch and watch the front close it.</p>' });
        var speedNote = h('p', { class: 'note ph-sm' });
        side.appendChild(speedNote);
        var right = h('div', { class: 'readout' }, [status, rnBox, controls, slider, side]);
        pane.appendChild(h('div', { class: 'lab' }, [left, right]));

        var running = !kit.reduceMotion, dirty = true, chartDirty = true, rate = 30, acc = 0, lastT = null;
        var tickRead = kit.every(120), tickChart = kit.every(350);
        kit.slider(spIn, spOut, function (v) { return v + '/s'; }, function (v) { rate = v; });
        seg(pppSw, [{ key: '0', label: 'ppp 0' }, { key: '0.02', label: 'ppp 0.02' }], function (k) {
          ppp = +k; reseed(); legendFill(); redrawAll(); if (!kit.reduceMotion) setRun(true);
        }, '0.02');
        seg(lineSw, [{ key: 'on', label: 'shown' }, { key: 'off', label: 'hidden' }], function (k) {
          showLine = k === 'on'; dirty = true; paint();
        }, 'on');
        seg(viewSw, [{ key: 'ghc', label: 'genotype (GHC)' }, { key: 'alpha', label: 'alpha' }], function (k) {
          view = k; dirty = true; paint();
        }, 'ghc');
        function setRun(on) { running = on; bPlay.textContent = on ? 'Pause' : 'Play'; lastT = null; readouts(); }
        bPlay.addEventListener('click', function () {
          if (!running && over) { reseed(); redrawAll(); }
          setRun(!running);
        });
        bReseed.addEventListener('click', function () { reseed(); redrawAll(); setRun(!kit.reduceMotion || running); });
        bNew.addEventListener('click', function () {
          founder = S.founderGenome(sim, 'trial');
          reseed(); redrawAll(); setRun(!kit.reduceMotion || running);
        });
        kit.pointer(fF.cv, FW, FW, function (row, col, phase) {
          if (phase === 'up' || over === 'dead' || row < 0 || col < 0 || row >= FW || col >= FW) return;
          sim.wound(row, col, 5);
          if (t >= 1 && cuts.indexOf(t) < 0) cuts.push(t);
          measure(); dirty = true; chartDirty = true;
          if (!running) { paint(); readouts(); }
        });

        function paint() {
          kit.paint(fF.cv, sim, view);
          kit.clear(ovl);
          if (showLine && over !== 'dead') {
            var du = 'M0,' + (ROW0 - upH[0]), dd = 'M0,' + (ROW0 + dnH[0] + 1), j, mu = 0, md = 0;
            for (j = 0; j < FW; j++) {
              du += 'V' + (ROW0 - upH[j]) + 'H' + (j + 1); dd += 'V' + (ROW0 + dnH[j] + 1) + 'H' + (j + 1);
              mu += upH[j]; md += dnH[j];
            }
            mu /= FW; md /= FW;
            var stl = { fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke', opacity: 0.95 };
            [du, dd].forEach(function (d) { var a = Object.assign({ d: d }, stl); ovl.appendChild(el('path', a)); });
            [ROW0 - mu, ROW0 + md + 1].forEach(function (y) {
              ovl.appendChild(el('line', { x1: 0, x2: FW, y1: y, y2: y, stroke: '#fff', 'stroke-width': 1.4, 'stroke-dasharray': '5 4', 'vector-effect': 'non-scaling-stroke', opacity: 0.9 }));
            });
          }
          var em = 'step ' + intFmt(t);
          if (fF.em.textContent !== em) fF.em.textContent = em;
          dirty = false;
        }
        function readouts() {
          setNum(rn.t, intFmt(t));
          setNum(rn.h, isFinite(cur.mean) ? cur.mean.toFixed(1) : '–');
          setNum(rn.v, isFinite(cur.speed) ? cur.speed.toFixed(3) : '–');
          setNum(rn.w, isFinite(cur.W) ? cur.W.toFixed(2) : '–');
          var s;
          if (over === 'edge') s = 'Run over at step ' + t + ': the fronts are near the edge. Reseed for another run.';
          else if (over === 'dead') s = 'The colony died out at step ' + t + '. Try a new founder.';
          else if (over === 'stuck') s = 'This founder’s line is not advancing. Try a new founder.';
          else s = (running ? 'Growing' : 'Paused' + (t ? ' at step ' + t : ' at the start')) + (cur.nf === 1 && t >= 20 ? '; only one front is advancing' : '') + '.';
          if (status.textContent !== s) status.textContent = s;
        }
        var LEG = null;
        function legendFill() {
          var c = D.fronts.curves, sub = ppp ? c.p02 : c.p0;
          kit.clear(chartLegend);
          LEG = [
            [swatch('--cyan', true), 'this run, 160 wide (live)'],
            [swatch('--ghc', true), 'substrate, 512 wide, ppp ' + ppp + ': ' + sub.n + ' fronts, β = ' + sub.beta.toFixed(2)],
            [swatch('--clogv', true, true), 'no networks, 512 wide: ' + c.ref512.n + ' fronts, β = ' + c.ref512.beta.toFixed(2)],
            [swatch('--gep', true), 'no networks, 2048 wide: ' + c.refLong.n + ' fronts, β = ' + c.refLong.beta.toFixed(2)],
            [swatch('--text-mute', true, true), 'slope 1/3 (KPZ, long times)']
          ];
          LEG.forEach(function (it) { chartLegend.appendChild(h('span', null, it)); });
          paintSwatches(chartLegend);
          speedNote.textContent = 'Offline, on a 512-wide grid at ppp ' + ppp + ', the front advanced at ' + sub.speed.toFixed(3) +
            ' rows per step (' + sub.n + ' fronts); a growth rule with no networks, in which every newborn survives, gives ' + c.ref512.speed.toFixed(3) + '.';
        }
        function drawChart() {
          var w = boxWidth(chartbox, 460), H = Math.max(260, Math.min(380, Math.round(w * 0.82)));
          var c = D.fronts.curves, sub = ppp ? c.p02 : c.p0;
          var a = sub.pts.filter(function (p) { return p[0] >= 50; })[0];
          // a slope-1/3 line through the offline substrate curve at t = 50
          var guide = [3, 10, 100, 1000, 12000].map(function (tt) { return [tt, a[1] * Math.pow(tt / a[0], 1 / 3)]; });
          chart(svg, {
            w: w, h: H, left: 50, right: 74,
            x: { min: 1, max: 12000, log: true, ticks: [1, 10, 100, 1000, 10000], fmt: function (v) { return intFmt(v); }, tipFmt: function (v) { return 'step ' + intFmt(v); }, label: 'step' },
            y: { min: 0.5, max: 10, log: true, ticks: [0.5, 1, 2, 5, 10], fmt: function (v) { return String(v); }, tipFmt: function (v) { return v.toFixed(2); }, label: 'roughness W (rows)' },
            series: [
              { label: 'slope 1/3', colour: '--text-mute', points: guide, width: 1.4, dash: '5 4', end: 'slope 1/3', tip: false },
              { label: 'no networks, 2048', colour: '--gep', points: c.refLong.pts, width: 1.8, end: '2048 wide' },
              { label: 'no networks, 512', colour: '--clogv', points: c.ref512.pts, width: 1.8, dash: '6 3' },
              { label: 'substrate, 512', colour: '--ghc', points: sub.pts, width: 2 },
              { label: 'this run', colour: '--cyan', points: series, width: 2.6 }
            ],
            marks: cuts.map(function (m) { return { x: m, colour: '--cyan' }; }),
            tip: tip
          });
          chartDirty = false;
        }
        function redrawAll() { paint(); readouts(); drawChart(); paintSwatches(chartLegend); }

        function frame(time) {
          if (running && !over) {
            if (lastT === null) lastT = time;
            acc += Math.min(100, time - lastT) * rate / 1000; lastT = time;
            var n = Math.min(3, Math.floor(acc));
            acc -= Math.floor(acc);
            for (var k = 0; k < n && !over; k++) step();
            if (n) { dirty = true; chartDirty = true; }
            if (over) { setRun(false); drawChart(); }
          }
          if (dirty) paint();
          if (tickRead(time)) readouts();
          if (chartDirty && tickChart(time)) drawChart();
        }

        reseed(); legendFill();
        return {
          frame: frame,
          show: function () { redrawAll(); },
          redrawAll: redrawAll
        };
      }

      /* ==============================================================
         C. Selection on the task: the research's offline runs
         ============================================================== */
      function selectView(pane) {
        var N = D.native;
        var noteEl = h('p', { class: 'note presetnote', html:
          'Offline, with a <b>changed rule</b>. Every 20 steps three hot discs land on the colony. After every cell computes its output and before inheritance, the 5% of fully surrounded living cells whose chemistry missed the heat law by most die, and the killed cells cannot be copied that step. In the control, the same number die at random. r = 0.2, ip = 0.2, ppp = 0.02, 64 × 64, starting from the substrate&rsquo;s own colony.' });
        pane.appendChild(noteEl);
        var svg = el('svg', { role: 'img', 'aria-label': 'Median and best genome error against steps, selection and control runs' });
        var tip = h('div', { class: 'tip' });
        var chartbox = h('div', { class: 'chartbox' }, [svg, tip]);
        var legend = h('div', { class: 'legend' }, [
          h('span', null, [swatch('--gep', true), 'median genome, task deaths (3 runs)']),
          h('span', null, [swatch('--gcvp', true), 'median genome, random deaths (3 runs)']),
          h('span', null, [swatch('--gep', true, true), 'best genome in any task-death run']),
          h('span', null, [swatch('--text', true, true), 'changing nothing'])
        ]);
        var left = h('div', null, [chartbox, legend, h('p', { class: 'note ph-sm', text:
          'Each living genome is scored every 500 steps on 200 fixed test patches, at its own flat alpha; error in T units. That is not the colony’s own field: in one probed run, selection mostly flattened the colony’s chemistry, where the law is easy to satisfy.' })]);
        var rnBox = h('div', { class: 'readnum' });
        var rn = readnum(rnBox, [
          ['ms', 'median error after 20,000 steps, task deaths'], ['mc', 'the same with random deaths'],
          ['b', 'best genome at any sampled time, task deaths'], ['n', 'error of changing nothing']
        ]);
        setNum(rn.ms, '0.30–0.51'); setNum(rn.mc, '1.26–1.68'); setNum(rn.b, '0.25–0.27'); setNum(rn.n, '0.17');
        var right = h('div', { class: 'readout' }, [h('p', { class: 'ph-status', text: 'Offline: 3 runs per arm, 20,000 steps each.' }), rnBox,
          h('p', { class: 'note ph-sm', text: 'Selection kept the median below the control’s, but no sampled genome beat leaving the field unchanged.' })]);
        pane.appendChild(h('div', { class: 'lab' }, [left, right]));

        function drawChart() {
          var w = boxWidth(chartbox, 640), H = w < 480 ? 260 : 300;
          var sel = N.runs.filter(function (r) { return r.arm === 'select'; }), ctl = N.runs.filter(function (r) { return r.arm === 'control'; });
          var best = sel[0].pts.map(function (p, i) { return [p[0], Math.min.apply(null, sel.map(function (r) { return r.pts[i][2]; }))]; });
          var series = [];
          ctl.forEach(function (r, i) { series.push({ label: 'random deaths, run ' + (i + 1), colour: '--gcvp', points: r.pts.map(function (p) { return [p[0], p[1]]; }), width: 1.6, opacity: 0.85, end: i === 0 ? 'random deaths' : '' }); });
          sel.forEach(function (r, i) { series.push({ label: 'task deaths, run ' + (i + 1), colour: '--gep', points: r.pts.map(function (p) { return [p[0], p[1]]; }), width: 1.8, end: i === 1 ? 'task deaths' : '' }); });
          series.push({ label: 'best genome, any run', colour: '--gep', points: best, width: 1.6, dash: '2 3', end: 'best' });
          series.push({ label: 'changing nothing', colour: '--text', points: [[0, N.noChange], [20000, N.noChange]], width: 1.4, dash: '6 4', end: 'no change', tip: false });
          chart(svg, {
            w: w, h: H, left: 50, right: 104,
            x: { min: 0, max: 20000, ticks: w < 480 ? [0, 10000, 20000] : [0, 5000, 10000, 15000, 20000], fmt: intFmt, tipFmt: function (v) { return 'step ' + intFmt(v); }, label: 'step' },
            y: { min: 0, max: 2.5, ticks: [0, 0.5, 1, 1.5, 2, 2.5], fmt: function (v) { return v.toFixed(1); }, tipFmt: function (v) { return v.toFixed(3); }, label: 'genome error (T units)' },
            series: series, tip: tip
          });
        }
        function redrawAll() { drawChart(); paintSwatches(legend); }
        return { frame: function () { }, show: redrawAll, redrawAll: redrawAll };
      }
    }
  });
})();
