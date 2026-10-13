/* ==========================================================
   Section 9 board: inpainting — "Restore what was erased".

   Two levels, one tab each.

   A. The substrate as is. The page's NCA (app.js) runs the rule unchanged.
      The one addition is bookkeeping: every genome carries a lineage label,
      the founder it descends from, copied whenever the genome is copied and
      cleared whenever it is cleared (a port of the research's tracked.js).
      The tracked step below makes exactly the same random draws as app.js's
      s.step(), so a tracked grid evolves exactly as an untracked one would.
      The visitor cuts the grid with the page's annihilation kernel (s.wound)
      and every readout is computed live over the cells that were cut.

   B. One evolved rule. The page's NCA again, completely unmodified: every
      cell is founded from one genome found offline by CMA-ES (40 weights,
      biases 0), with ip = 1 and ppp = 0, so every copy is a copy of the same
      genome. The inheritance switch sets ip = 0.2, with mutation off or with
      ppp = 0.02 (transplant.js). The genomes and the 20 MNIST test digits are embedded
      in boards/data/inpaint.js; the offline results quoted in the notes come
      from the verified report.
   ========================================================== */

(function () {
  'use strict';
  if (!window.SONCA || !window.SONCA.board) return;

  window.SONCA.board('inpaint', function (root, kit) {
    var S = kit.S, P = S.P;
    var host = root.querySelector('.boardlive');
    host.innerHTML = '<p class="note">Loading the board&hellip;</p>';

    // ---------- small DOM helpers ----------
    function h(tag, attrs, kids) {
      var n = document.createElement(tag), k;
      for (k in (attrs || {})) {
        if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
      }
      (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
      return n;
    }
    function btn(label, cls) { return h('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: label }); }
    function pct(v) { return v === null || v === undefined || isNaN(v) ? '–' : Math.round(v * 100) + '%'; }
    function pct1(v) { return v === null || v === undefined || isNaN(v) ? '–' : (v * 100).toFixed(1) + '%'; }
    function fig(label, em, aria, draw) {
      var cv = h('canvas', { class: 'cv' + (draw ? ' draw' : ''), width: 96, height: 96, 'aria-label': aria });
      var lab = h('span', { text: label }), e = h('em', { text: em });
      var f = h('figure', { class: 'cvfig' }, [cv, h('figcaption', null, [lab, e])]);
      return { fig: f, cv: cv, lab: lab, em: e };
    }
    // segmented control in the page's .switch style; returns { set(key) }
    function seg(hostEl, items, onPick, initial) {
      var bs = items.map(function (it) {
        var b = h('button', { type: 'button', text: it.label, 'aria-pressed': String(it.key === initial) });
        if (it.title) b.title = it.title;
        b.addEventListener('click', function () { set(it.key); onPick(it.key); });
        hostEl.appendChild(b);
        return b;
      });
      function set(key) { bs.forEach(function (b, i) { b.setAttribute('aria-pressed', String(items[i].key === key)); }); }
      return { set: set };
    }
    function readnum(el, items) {
      kit.clear(el);
      var out = {};
      items.forEach(function (it) {
        var b = h('b', { text: '–' });
        el.appendChild(h('div', null, [b, document.createTextNode(it[1])]));
        out[it[0]] = b;
      });
      return out;
    }
    function setNum(b, txt) { if (b && b.textContent !== txt) b.textContent = txt; }

    // ---------- shared colour helpers (canvases are drawn on the dark void in both themes) ----------
    var PAL = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7',
      '#9c755f', '#bab0ac', '#8cd17d', '#d37295'].map(function (c) {
        var n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      });
    // overlay colours, checked for colour-blind separation on the void background
    var C_RIGHT = [47, 181, 154], C_WRONG = [240, 122, 42], C_GONE = [168, 53, 122], C_EMPTY = [61, 111, 232];
    var C_OUT = [62, 62, 72], C_DEADCUT = [22, 22, 30];
    function hashRGB(l, rgb) { // heal.js's hcol
      var x = Math.imul(l ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
      rgb[0] = 64 + (x & 191); rgb[1] = 64 + ((x >>> 8) & 191); rgb[2] = 64 + ((x >>> 16) & 191);
    }
    function setRGB(rgb, c, f) { f = f === undefined ? 1 : f; rgb[0] = c[0] * f; rgb[1] = c[1] * f; rgb[2] = c[2] * f; }
    function tint(rgb, f) { rgb[0] += (255 - rgb[0]) * f; rgb[1] += (255 - rgb[1]) * f; rgb[2] += (255 - rgb[2]) * f; }

    // kit.draw with the ImageData kept on the canvas, so a repaint allocates nothing
    function draw(cv, W, pixel) {
      if (cv.width !== W || cv.height !== W) { cv.width = W; cv.height = W; cv._img = null; }
      var ctx = cv.getContext('2d');
      if (!cv._img) cv._img = ctx.createImageData(W, W);
      var d = cv._img.data, rgb = [0, 0, 0], n = W * W, i, o;
      for (i = 0; i < n; i++) {
        rgb[0] = rgb[1] = rgb[2] = 0;
        pixel(i, rgb);
        o = i * 4;
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
      }
      ctx.putImageData(cv._img, 0, 0);
    }

    // a 53-bit hash of one genome's 44 float bit patterns, for "is this genome new?"
    function genomeHash(u32, base) {
      var h1 = 0x811c9dc5 | 0, h2 = 0x9e3779b9 | 0, k, x;
      for (k = 0; k < P; k++) {
        x = u32[base + k];
        h1 = Math.imul(h1 ^ x, 16777619);
        h2 = Math.imul(h2 ^ x, 0x85ebca6b); h2 ^= h2 >>> 13;
      }
      return (h1 >>> 0) * 2097152 + (h2 >>> 11);
    }

    // the step the board shows a few generations per second of; frames are throttled here
    function stepper(rate) {
      return { rate: rate, acc: 0, last: null };
    }
    function due(sp, t) {
      if (sp.last === null) sp.last = t;
      sp.acc += Math.min(120, t - sp.last) * sp.rate / 1000;
      sp.last = t;
      var n = Math.floor(sp.acc);
      sp.acc -= n;
      return Math.min(n, 4);
    }

    /* ======================================================
       The lineage-tracked step. A copy of app.js's s.step() with ONE change:
       s.lin[i], the founder label of cell i's genome, is copied whenever the
       genome is copied (at birth and on a live re-copy) and zeroed whenever the
       genome is zeroed. Nothing else differs, and the random draws happen in
       the same order, so the dynamics are exactly the page's.
       ====================================================== */
    function trackedStep(s) {
      var nb = new Float32Array(18), hid = new Float32Array(2), liveN = new Int32Array(9), sigmoid = S.sigmoid;
      return function () {
        var W = s.W, H = s.H, n = s.N, st = s.st, nx = s.nx, g = s.g, lin = s.lin;
        var alpha = s.alpha, ip = s.ip, ppp = s.ppp;
        var tanhAct = s.act === 'tanh';
        var i, j, dx, dy, k, m, idx, base;
        s.inh.fill(0);
        for (i = 0; i < W; i++) {
          for (j = 0; j < H; j++) {
            idx = i * W + j;
            var any = false;
            for (dx = -1; dx <= 1; dx++) {
              var ni = (i + dx + W) % W;
              for (dy = -1; dy <= 1; dy++) {
                var nj = (j + dy + H) % H;
                var p = ni * W + nj;
                var a = st[p], b = st[n + p];
                nb[(dx + 1) * 3 + (dy + 1)] = a;
                nb[(dx + 1) * 3 + (dy + 1) + 9] = b;
                if (a > alpha || b > alpha) any = true;
              }
            }
            var o0 = 0, o1 = 0;
            if (any) {
              base = idx * P;
              for (k = 0; k < 2; k++) {
                var acc = g[base + 36 + k];
                var off = base + k * 18;
                for (m = 0; m < 18; m++) acc += g[off + m] * nb[m];
                hid[k] = tanhAct ? Math.tanh(acc) : sigmoid(acc);
              }
              o0 = g[base + 42] + g[base + 38] * hid[0] + g[base + 39] * hid[1];
              o1 = g[base + 43] + g[base + 40] * hid[0] + g[base + 41] * hid[1];
              if (Math.random() < ip) {
                var cnt = 0;
                for (dx = -1; dx <= 1; dx++) {
                  var mi = (i + dx + W) % W;
                  for (dy = -1; dy <= 1; dy++) {
                    var mj = (j + dy + H) % H;
                    var q = mi * W + mj;
                    if (st[q] > alpha) liveN[cnt++] = q;
                  }
                }
                if (cnt) {
                  var src = liveN[(Math.random() * cnt) | 0];
                  var sel = src * P, dst = idx * P;
                  if (!s.has[idx]) {
                    for (k = 0; k < P; k++) g[dst + k] = g[sel + k];
                    for (k = 0; k < 36; k++) if (Math.random() < ppp) g[dst + k] += Math.random() * 2 - 1;
                    for (k = 38; k < 42; k++) if (Math.random() < ppp) g[dst + k] += Math.random() * 2 - 1;
                    s.has[idx] = 1;
                    s.inh[idx] = 1;
                  } else {
                    for (k = 0; k < P; k++) g[dst + k] = g[sel + k];
                  }
                  lin[idx] = lin[src];                              // added: the label rides along
                }
              }
            } else {
              base = idx * P;
              for (k = 0; k < P; k++) g[base + k] = 0;
              s.has[idx] = 0;
              lin[idx] = 0;                                         // added
            }
            nx[idx] = o0; nx[n + idx] = o1;
          }
        }
        for (k = 0; k < 2 * n; k++) nx[k] = tanhAct ? Math.tanh(nx[k]) : sigmoid(nx[k]);
        for (idx = 0; idx < n; idx++) {
          if (nx[idx] <= alpha) { nx[idx] = 0; nx[n + idx] = 0; }
        }
        for (idx = 0; idx < n; idx++) {
          if (Math.round(nx[idx] * 10) / 10 > alpha) s.bud[idx]++;
          else s.bud[idx] = 0;
        }
        if (isFinite(s.budget)) {
          for (idx = 0; idx < n; idx++) {
            if (s.bud[idx] > s.budget) { s.bud[idx] = 0; nx[idx] = 0; nx[n + idx] = 0; }
          }
        }
        for (idx = 0; idx < n; idx++) {
          if (s.bud[idx] === 0) {
            nx[idx] = 0; nx[n + idx] = 0;
            if (!s.inh[idx]) {
              base = idx * P;
              for (k = 0; k < P; k++) g[base + k] = 0;
              s.has[idx] = 0;
              lin[idx] = 0;                                         // added
            }
          }
        }
        s.st = nx; s.nx = st;
        s.gen++;
        return s;
      };
    }

    kit.load('boards/data/inpaint.js?v=1', function (err) {
      var D = window.SONCA_DATA && window.SONCA_DATA.inpaint;
      if (err || !D) {
        host.innerHTML = '<p class="note">The board&rsquo;s data could not be loaded. Reload the page to try again.</p>';
        return;
      }
      build(D);
    });

    var api = { frame: function () { }, show: function () { }, hide: function () { } };

    function build(D) {
      kit.clear(host);
      host.appendChild(h('style', {
        text:
          '[data-board="inpaint"] .ip-rows{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;align-items:center;margin-bottom:10px}' +
          '[data-board="inpaint"] .ip-rows .ctl-label{white-space:nowrap}' +
          '[data-board="inpaint"] .ip-status{margin:0 0 8px;font-size:14px;color:var(--text)}' +
          '[data-board="inpaint"] .ip-pane .cvrow{grid-template-columns:repeat(4,minmax(0,1fr))}' +
          '[data-board="inpaint"] .ip-pane .legend{margin-top:8px;font-size:12.5px}' +
          '[data-board="inpaint"] .ip-pane .readout .controls{margin:6px 0 8px;gap:8px}' +
          '[data-board="inpaint"] .ip-pane .slider{grid-template-columns:7.5em 1fr 4.4em}' +
          '[data-board="inpaint"] .ip-pane [hidden],[data-board="inpaint"] .ip-pane[hidden]{display:none!important}' +
          '@media (max-width:880px){[data-board="inpaint"] .ip-pane .cvrow{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
          '@media (max-width:560px){[data-board="inpaint"] .ip-rows{grid-template-columns:1fr;gap:6px}}'
      }));

      var levelRow = h('div', { class: 'ip-rows' });
      var levelSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Choose a level' });
      levelRow.appendChild(h('span', { class: 'ctl-label', text: 'Level' }));
      levelRow.appendChild(h('div', null, [levelSw]));
      host.appendChild(levelRow);

      var paneA = h('div', { class: 'ip-pane' });
      var paneB = h('div', { class: 'ip-pane', hidden: '' });
      host.appendChild(paneA); host.appendChild(paneB);

      var A = buildA(paneA, D), B = buildB(paneB, D);
      var level = 'a';
      seg(levelSw, [
        { key: 'a', label: 'The substrate as is' },
        { key: 'b', label: 'One evolved rule' }
      ], function (k) {
        level = k;
        paneA.hidden = k !== 'a'; paneB.hidden = k !== 'b';
        (k === 'a' ? A : B).show();
      }, 'a');

      var frames = 0;
      api.frame = function (t) {
        frames++;
        if (level === 'a') A.frame(t); else B.frame(t);
      };
      api.show = function () { (level === 'a' ? A : B).show(); };
      api.frames = function () { return frames; };
      document.addEventListener('themechange', function () { A.chart(true); });
      var lastW = 0;
      window.addEventListener('resize', function () {
        var w = host.clientWidth;
        if (Math.abs(w - lastW) > 40) { lastW = w; if (level === 'a') A.chart(true); }
      });
      api.show();
    }

    /* ======================================================
       A. The substrate as is: cut a living mosaic, watch the rim refill it.
       ====================================================== */
    function buildA(pane, D) {
      var STARTS = [
        { key: 'voronoi', label: 'Twelve regions', W: 96, ip: 0.20, ppp: 0.02, warm: 100,
          note: 'Twelve founders, each filling a region of the grid, run for 100 generations to settle. '
            + 'ip&nbsp;0.2, ppp&nbsp;0.02, no budget. In the offline runs every lineage in the centre cut also lived outside it.' },
        { key: 'pair', label: 'Two lineages', W: 96, ip: 0.20, ppp: 0.02, warm: 'full',
          note: 'The lab&rsquo;s <i>Two lineages</i> pattern, grown until the grid is full (plus 50 generations). '
            + 'The centre cut lies midway between the two founders.' },
        { key: 'preset', label: 'The lab’s Wound and heal', W: 112, ip: 0.10, ppp: 0.02, init: 0.08, warm: 60,
          note: 'The lab&rsquo;s <i>Wound and heal</i> preset: about a thousand random founders, ip&nbsp;0.1, '
            + 'cut at generation 60. Many small lineages live only inside the cut.' }
      ];
      var start = STARTS[0];

      var rows = h('div', { class: 'ip-rows' });
      var startHost = h('div', { role: 'group', 'aria-label': 'Starting pattern' });
      rows.appendChild(h('span', { class: 'ctl-label', text: 'Start from' }));
      rows.appendChild(startHost);
      pane.appendChild(rows);
      var noteEl = h('p', { class: 'note presetnote' });
      pane.appendChild(noteEl);

      var fBefore = fig('before', 'at the cut', 'Lineage map at the moment of the first cut');
      var fNow = fig('now', 'drag to cut', 'Live lineage map; drag to cut a disc', true);
      var fOver = fig('refill', 'vs before', 'Wounded cells coloured by whether they carry their old lineage');
      var fRim = fig('nearest-rim fill', 'reference', 'What copying the nearest surviving rim lineage would give');
      var cvrow = h('div', { class: 'cvrow' }, [fBefore.fig, fNow.fig, fOver.fig, fRim.fig]);

      function sw(c, label) {
        return h('span', null, [h('i', { class: 'swatch', style: 'background:rgb(' + c.join(',') + ')' }), document.createTextNode(label)]);
      }
      var legend = h('div', { class: 'legend', 'aria-label': 'Colours of the refill view' }, [
        sw(C_RIGHT, 'old lineage back'), sw(C_WRONG, 'another lineage'),
        sw(C_GONE, 'another; the old one lives nowhere outside'), sw(C_EMPTY, 'not refilled yet')
      ]);

      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Share of refilled cells carrying their old lineage against generations since the cut: this grid live, and the offline means');
      var tip = h('div', { class: 'tip' });
      var chartbox = h('div', { class: 'chartbox', style: 'margin-top:14px' }, [svg, tip]);
      var chartLegend = h('div', { class: 'legend' });
      var chartNote = h('p', { class: 'note', style: 'margin:6px 0 0;font-size:13px' });

      var left = h('div', null, [cvrow, legend, chartbox, chartLegend, chartNote]);

      var status = h('p', { class: 'ip-status' });
      var rn = h('div', { class: 'readnum' });
      var R = readnum(rn, [
        ['h', 'generations since the cut'],
        ['refilled', 'of the cut cells alive again'],
        ['restored', 'of refilled cells carry their old lineage'],
        ['chance', 'chance, from the mix of lineages'],
        ['rim', 'nearest-rim fill (reference)'],
        ['ceiling', 'ceiling: old lineage still lives outside'],
        ['exact', 'carry their exact pre-cut genome'],
        ['fresh', 'carry a genome that existed nowhere before']
      ]);
      var bPlay = btn(kit.reduceMotion ? 'Play' : 'Pause', 'primary'), bStep = btn('Step');
      var bCut = btn('Cut the centre'), bClear = btn('Clear record'), bNew = btn('New grid');
      bCut.title = 'Start a new record and cut the centre disc, as in the offline runs';
      bClear.title = 'Forget the current cut; the next cut starts a new record';
      var controls = h('div', { class: 'controls' }, [bPlay, bStep, bCut, bClear, bNew]);
      var speedIn = h('input', { type: 'range', min: '5', max: '90', step: '5', value: '30', id: 'ipSpeedA' });
      var speedOut = h('output', { for: 'ipSpeedA' });
      var slider = h('div', { class: 'slider' }, [h('label', { for: 'ipSpeedA', text: 'speed' }), speedIn, speedOut]);
      var sideNote = h('p', {
        class: 'note', style: 'margin-top:10px', html:
          'All eight numbers are measured live over the cells that were alive when cut. A cell&rsquo;s '
          + 'state and lineage are recorded the first time it is cut; later strokes add to the record until '
          + '<b>Clear record</b>. The nearest-rim fill copies each cut cell&rsquo;s nearest surviving lineage: '
          + 'a reference, not a bound. The ceiling is the share whose lineage still lived outside the cut.'
      });
      var right = h('div', { class: 'readout' }, [status, rn, controls, slider, sideNote]);
      pane.appendChild(h('div', { class: 'lab' }, [left, right]));

      // ---------- simulation ----------
      var sim = S.NCA({ W: 96, init: 0, ip: 0.2, ppp: 0.02, budget: Infinity, act: 'sigmoid' });
      sim.step = trackedStep(sim);
      var running = !kit.reduceMotion, phase = 'warm', fullAt = -1, palette = true;
      var sp = stepper(30);
      var rec = null, live = [], dirty = true, chartDirty = true, lastChart = -1e9, lastMeasure = null;
      var bufs = null;

      kit.slider(speedIn, speedOut, function (v) { return v + '/s'; }, function (v) { sp.rate = v; });

      function alloc() {
        var N = sim.N;
        bufs = {
          mark: new Uint8Array(N), edge: new Uint8Array(N), preAlive: new Uint8Array(N),
          before: new Int32Array(N), preG: new Float32Array(N * P), nr: new Int32Array(N),
          outside: new Uint8Array(N + 2), pc: new Int32Array(N + 2), qc: new Int32Array(N + 2),
          seen: new Uint8Array(N + 2), dist: new Int32Array(N), queue: new Int32Array(N), D: new Int32Array(N)
        };
      }

      function labelOf(l, rgb) {
        if (!l) { rgb[0] = rgb[1] = rgb[2] = 0; return; }
        if (palette) setRGB(rgb, PAL[(l - 1) % PAL.length]); else hashRGB(l, rgb);
      }

      function reseed() {
        var W = start.W;
        sim.ip = start.ip; sim.ppp = start.ppp; sim.budget = Infinity;
        sim.act = 'sigmoid'; sim.alpha = 0.5;
        if (sim.W !== W || !sim.lin || sim.lin.length !== W * W) { sim.resize(W); sim.lin = new Int32Array(W * W); }
        var lab = sim.lin;
        lab.fill(0);
        palette = start.key !== 'preset';
        if (start.key === 'voronoi') {
          sim.seed(0, function (s) {
            var K = 12, sites = [], gens = [], i, j, k;
            for (k = 0; k < K; k++) {
              sites.push([(Math.random() * W) | 0, (Math.random() * W) | 0]);
              gens.push(S.founderGenome(s, 'solo'));
            }
            for (i = 0; i < W; i++) {
              for (j = 0; j < W; j++) {
                var best = 0, bd = 1e9;
                for (k = 0; k < K; k++) {
                  var di = Math.abs(i - sites[k][0]), dj = Math.abs(j - sites[k][1]);
                  di = Math.min(di, W - di); dj = Math.min(dj, W - dj);
                  var d = di * di + dj * dj;
                  if (d < bd) { bd = d; best = k; }
                }
                s.found(i * W + j, gens[best]); lab[i * W + j] = best + 1;
              }
            }
          });
        } else if (start.key === 'pair') {
          sim.seed(0, function (s) {
            var r = (W >> 1) * W;
            s.found(r + (W >> 2), S.founderGenome(s, 'trial')); lab[r + (W >> 2)] = 1;
            s.found(r + ((3 * W) >> 2), S.founderGenome(s, 'trial')); lab[r + ((3 * W) >> 2)] = 2;
          });
        } else {
          sim.seed(start.init);
          for (var i = 0; i < sim.N; i++) lab[i] = sim.has[i] ? i + 1 : 0;
        }
        alloc();
        rec = null; live = []; phase = 'warm'; fullAt = -1; lastMeasure = null;
        dirty = chartDirty = staticDirty = true;
        setStatus();
      }

      function occupancy() {
        var a = 0, i; for (i = 0; i < sim.N; i++) if (sim.st[i] > sim.alpha) a++;
        return a / sim.N;
      }
      function warmTarget() { return start.warm === 'full' ? (fullAt < 0 ? null : fullAt + 50) : start.warm; }
      function warmDone() {
        if (start.warm === 'full') {
          if (fullAt < 0 && (occupancy() >= 0.995 || sim.gen >= 1500)) fullAt = sim.gen;
          return fullAt >= 0 && sim.gen >= fullAt + 50;
        }
        return sim.gen >= start.warm;
      }

      function setStatus() {
        var txt;
        if (phase === 'warm') {
          var tgt = warmTarget();
          txt = 'Settling: generation ' + sim.gen + (tgt ? ' of ' + tgt : ', growing to fill the grid') + '. Cutting opens after that.';
        } else if (!rec) {
          txt = 'No cut recorded. Drag on “now”, or press Cut the centre.';
        } else {
          txt = rec.strokes > 1
            ? 'First cut at generation ' + rec.firstGen + '; ' + rec.strokes + ' strokes, the last at generation ' + rec.t0 + '.'
            : 'Cut at generation ' + rec.firstGen + '. Watch the rim refill it.';
        }
        if (status.textContent !== txt) status.textContent = txt;
      }

      // ---------- the wound record ----------
      function beginRecord() {
        var N = sim.N, i, l, u32 = new Uint32Array(sim.g.buffer);
        rec = { firstGen: sim.gen, t0: sim.gen, strokes: 0, nD: 0, gset: new Set(), rim: null, ceiling: null, needRef: true };
        bufs.mark.fill(0); bufs.edge.fill(0); bufs.preAlive.fill(0);
        for (i = 0; i < N; i++) {
          l = sim.st[i] > sim.alpha ? sim.lin[i] : 0;
          bufs.before[i] = l;
        }
        addGenomes(u32);
      }
      function addGenomes(u32) {
        for (var i = 0; i < sim.N; i++) if (sim.st[i] > sim.alpha) rec.gset.add(genomeHash(u32, i * P));
      }
      // "existed nowhere before" means before the record began (its first stroke)
      function stroke() {
        if (!rec) beginRecord();
        rec.strokes++;
        live = [];
        chartDirty = true;
      }
      function cut(ci, cj, r) {
        var W = sim.W, di, dj, k;
        for (di = -r; di <= r; di++) {
          for (dj = -r; dj <= r; dj++) {
            if (di * di + dj * dj > r * r) continue;
            var idx = ((ci + di + W) % W) * W + ((cj + dj + W) % W);
            if (!bufs.mark[idx]) {
              bufs.mark[idx] = 1;
              var al = sim.st[idx] > sim.alpha && sim.lin[idx] > 0;
              bufs.preAlive[idx] = al ? 1 : 0;
              bufs.before[idx] = al ? sim.lin[idx] : 0;
              for (k = 0; k < P; k++) bufs.preG[idx * P + k] = sim.g[idx * P + k];
              if (al) bufs.D[rec.nD++] = idx;
            }
            sim.lin[idx] = 0;
          }
        }
        sim.wound(ci, cj, r);           // the page's annihilation kernel, unchanged
        rec.t0 = sim.gen;
        live = [];                      // the live curve restarts with "generations since the cut"
        chartDirty = true;
        rec.needRef = true;
        dirty = staticDirty = true;
      }

      // nearest-rim fill and ceiling, once per change of the cut set: O(N)
      function references() {
        var N = sim.N, W = sim.W, b = bufs, i, h = 0, t = 0, q;
        b.outside.fill(0);
        b.dist.fill(-1);
        for (i = 0; i < N; i++) {
          b.edge[i] = 0;
          if (!b.mark[i] && b.before[i]) {
            b.outside[b.before[i]] = 1;
            b.nr[i] = b.before[i]; b.dist[i] = 0; b.queue[t++] = i;
          } else b.nr[i] = 0;
        }
        while (h < t) {
          var c = b.queue[h++], ci = (c / W) | 0, cj = c % W, dx, dy;
          for (dx = -1; dx <= 1; dx++) {
            for (dy = -1; dy <= 1; dy++) {
              if (!dx && !dy) continue;
              var n2 = ((ci + dx + W) % W) * W + ((cj + dy + W) % W);
              if (b.dist[n2] >= 0) continue;
              b.dist[n2] = b.dist[c] + 1; b.nr[n2] = b.nr[c]; b.queue[t++] = n2;
            }
          }
        }
        var ok = 0, ceil = 0;
        for (q = 0; q < rec.nD; q++) {
          i = b.D[q];
          if (b.nr[i] === b.before[i]) ok++;
          if (b.outside[b.before[i]]) ceil++;
        }
        rec.rim = rec.nD ? ok / rec.nD : null;
        rec.ceiling = rec.nD ? ceil / rec.nD : null;
        // outline of the cut set (4-neighbour boundary) for the maps
        for (i = 0; i < N; i++) {
          if (!b.mark[i]) continue;
          var r0 = (i / W) | 0, c0 = i % W;
          if (!b.mark[((r0 + 1) % W) * W + c0] || !b.mark[((r0 - 1 + W) % W) * W + c0] ||
            !b.mark[r0 * W + (c0 + 1) % W] || !b.mark[r0 * W + (c0 - 1 + W) % W]) b.edge[i] = 1;
        }
        rec.needRef = false;
      }

      function measure() {
        if (!rec || !rec.nD) return null;
        var b = bufs, nD = rec.nD, alpha = sim.alpha, g = sim.g, pre = b.preG, u32 = new Uint32Array(g.buffer);
        var both = 0, same = 0, exact = 0, fresh = 0, q, i, k, l0, l1;
        for (q = 0; q < nD; q++) {
          i = b.D[q];
          if (!(sim.st[i] > alpha && sim.lin[i])) continue;
          both++;
          l0 = b.before[i]; l1 = sim.lin[i];
          if (l0 === l1) same++;
          b.pc[l0]++; b.qc[l1]++;
          var base = i * P, eq = true;
          for (k = 0; k < P; k++) if (g[base + k] !== pre[base + k]) { eq = false; break; }
          if (eq) exact++;
          if (!rec.gset.has(genomeHash(u32, base))) fresh++;
        }
        var chance = 0;
        for (q = 0; q < nD; q++) {
          i = b.D[q];
          if (!(sim.st[i] > alpha && sim.lin[i])) continue;
          l0 = b.before[i];
          if (!b.seen[l0]) { b.seen[l0] = 1; chance += b.pc[l0] * b.qc[l0]; }
        }
        for (q = 0; q < nD; q++) {
          i = b.D[q];
          b.pc[b.before[i]] = 0; b.seen[b.before[i]] = 0;
          b.qc[sim.lin[i]] = 0;
        }
        return {
          h: sim.gen - rec.t0, refilled: both / nD,
          restored: both ? same / both : null, chance: both ? chance / (both * both) : null,
          exact: both ? exact / both : null, fresh: both ? fresh / both : null
        };
      }

      function step() {
        sim.step();
        if (phase === 'warm') {
          if (warmDone()) { phase = 'heal'; cutCentre(); }
          return;
        }
        if (rec) {
          if (rec.needRef) references();
          var m = measure();
          lastMeasure = m;
          if (m && m.restored !== null && m.h <= 400) { live.push([m.h, m.restored]); chartDirty = true; }
        }
      }

      function cutCentre() {
        if (phase === 'warm') return;
        rec = null;
        stroke();
        cut(sim.W >> 1, sim.W >> 1, Math.round(sim.W * 0.22));
        references();
        lastMeasure = measure();
        setStatus();
      }

      // ---------- drawing ----------
      var staticDirty = true, lastStatic = -1e9;
      function paint(t) {
        var b = bufs, W = sim.W, alpha = sim.alpha, has = !!rec;
        if (has && rec.needRef) { references(); staticDirty = true; }
        var tmp = [0, 0, 0];
        var both = staticDirty || (!has && t - lastStatic > 300);
        if (both) { staticDirty = false; lastStatic = t; }
        draw(fNow.cv, W, function (i, rgb) {
          if (sim.st[i] > alpha) labelOf(sim.lin[i], rgb);
          if (has && b.edge[i]) tint(rgb, 0.55);
        });
        if (both) draw(fBefore.cv, W, function (i, rgb) {
          if (!has) {
            if (sim.st[i] > alpha) { labelOf(sim.lin[i], rgb); rgb[0] *= 0.3; rgb[1] *= 0.3; rgb[2] *= 0.3; }
            return;
          }
          labelOf(b.before[i], rgb);
          if (b.edge[i]) tint(rgb, 0.55);
        });
        draw(fOver.cv, W, function (i, rgb) {
          var aliveNow = sim.st[i] > alpha && sim.lin[i] > 0;
          if (!has || !b.mark[i]) { if (aliveNow) setRGB(rgb, C_OUT); return; }
          if (!b.preAlive[i]) { setRGB(rgb, C_DEADCUT); return; }
          if (!aliveNow) setRGB(rgb, C_EMPTY);
          else if (sim.lin[i] === b.before[i]) setRGB(rgb, C_RIGHT);
          else if (b.outside[b.before[i]]) setRGB(rgb, C_WRONG);
          else setRGB(rgb, C_GONE);
        });
        if (both) draw(fRim.cv, W, function (i, rgb) {
          if (!has) { if (sim.st[i] > alpha) setRGB(rgb, C_OUT); return; }
          if (!b.mark[i]) { labelOf(b.before[i], tmp); setRGB(rgb, tmp, 0.3); return; }
          if (!b.preAlive[i]) { setRGB(rgb, C_DEADCUT); return; }
          labelOf(b.nr[i], rgb);
          if (b.edge[i]) tint(rgb, 0.55);
        });
        fNow.em.textContent = phase === 'warm' ? 'settling…' : 'drag to cut';
        fBefore.em.textContent = has ? 'at the cut' : 'no cut yet';
      }

      function readout() {
        var m = lastMeasure, has = !!rec;
        setNum(R.h, has ? String(sim.gen - rec.t0) : '–');
        setNum(R.refilled, m ? pct(m.refilled) : '–');
        setNum(R.restored, m ? pct(m.restored) : '–');
        setNum(R.chance, m ? pct(m.chance) : '–');
        setNum(R.rim, has && rec.rim !== null ? pct(rec.rim) : '–');
        setNum(R.ceiling, has && rec.ceiling !== null ? pct(rec.ceiling) : '–');
        setNum(R.exact, m ? pct1(m.exact) : '–');
        setNum(R.fresh, m ? pct(m.fresh) : '–');
      }

      // the chart's viewBox follows its box, so its text stays near 1:1 from phone to desktop
      var chartW = 560;
      function chart(force) {
        var bw = chartbox.clientWidth;
        if (bw) chartW = Math.max(360, Math.min(760, Math.round(bw)));
        if (!force && !chartDirty) return;
        chartDirty = false;
        var c = D.curves[start.key], H = c.H;
        function pts(arr) { return H.map(function (x, k) { return [x, arr[k]]; }); }
        var wide = chartW >= 520;
        var series = [
          { label: 'healed', long: 'healed wound (offline)', colour: '--alive', points: pts(c.wound), dots: true, width: 2 },
          { label: 'never cut', long: 'same disc, never cut (offline)', colour: '--clogv', points: pts(c.control), dots: true, width: 2 },
          { label: 'nearest rim', long: 'nearest-rim fill (offline)', colour: '--rwsp', points: [[0, c.rim], [400, c.rim]], dash: '6 4', width: 1.6 },
          { label: 'ceiling', long: 'ceiling (offline)', colour: '--text-soft', points: [[0, c.ceiling], [400, c.ceiling]], dash: '2 4', width: 1.6 },
          { label: 'chance', long: 'chance (offline)', colour: '--text-mute', points: pts(c.chance), dash: '2 3', width: 1.6 }
        ];
        if (live.length > 1) series.push({ label: 'this grid', long: 'this grid (live)', colour: '--navy', points: live, width: 2.6 });
        series.forEach(function (s) { s.end = wide; });
        kit.chart(svg, {
          w: chartW, h: Math.round(Math.max(230, Math.min(300, chartW * 0.45))), right: wide ? 92 : 14, left: 46,
          x: { min: 0, max: 400, ticks: 4, label: 'generations since the cut', fmt: function (v) { return Math.round(v); } },
          y: { min: 0, max: 1, ticks: 4, label: 'old lineage back', fmt: function (v) { return Math.round(v * 100) + '%'; } },
          series: series, tip: tip
        });
        kit.clear(chartLegend);
        series.forEach(function (s) {
          var col = S.css(s.colour);
          var swatch = h('i', { class: 'swatch line', style: 'background:' + col + (s.dash ? ';opacity:.8' : '') });
          chartLegend.appendChild(h('span', null, [swatch, document.createTextNode(s.long)]));
        });
        chartNote.textContent = 'Offline: mean of ' + c.n + ' seeds with the centre cut, the same start and settings. '
          + 'Early points cover only the cells refilled so far, which sit next to the rim.';
      }

      function frame(t) {
        if (running) {
          if (phase === 'warm') {
            var t0 = performance.now();
            do { step(); } while (phase === 'warm' && performance.now() - t0 < 14);
            sp.last = t; sp.acc = 0;
            dirty = true;
            setStatus();
          } else {
            // a slow machine runs the grid slower rather than dropping frames
            var n = due(sp, t), tb = performance.now();
            for (var k = 0; k < n && (k === 0 || performance.now() - tb < 12); k++) step();
            if (n) dirty = true;
          }
        } else sp.last = t;
        if (dirty) { paint(t); readout(); dirty = false; }
        if (chartDirty && t - lastChart > 300) { chart(); lastChart = t; }
      }

      // ---------- controls ----------
      var startPills = kit.pills(startHost, STARTS.map(function (s) { return { key: s.key, label: s.label }; }), function (k) {
        start = STARTS.filter(function (s) { return s.key === k; })[0];
        noteEl.innerHTML = start.note;
        reseed(); chart(true);
      }, start.key);
      noteEl.innerHTML = start.note;

      bPlay.addEventListener('click', function () {
        running = !running; bPlay.textContent = running ? 'Pause' : 'Play';
      });
      bStep.addEventListener('click', function () { step(); setStatus(); dirty = true; });
      bCut.addEventListener('click', function () { cutCentre(); dirty = true; });
      bClear.addEventListener('click', function () {
        rec = null; live = []; lastMeasure = null; dirty = chartDirty = staticDirty = true; setStatus();
      });
      bNew.addEventListener('click', function () { reseed(); chart(true); });

      var brush = function () { return Math.max(3, Math.round(sim.W / 22)); };
      kit.pointer(fNow.cv, function () { return sim.W; }, function () { return sim.W; }, function (row, col, ph) {
        if (phase === 'warm') { status.textContent = 'Wait for the grid to settle, then cut.'; return; }
        if (ph === 'up') { setStatus(); return; }
        if (row < 0 || col < 0 || row >= sim.W || col >= sim.W) return;
        if (ph === 'down' || !rec) stroke();
        cut(row, col, brush());
        if (ph === 'down') setStatus();
      });

      reseed();
      void startPills;
      return {
        frame: frame,
        show: function () { dirty = true; chart(true); },
        chart: chart,
        sim: sim
      };
    }

    /* ======================================================
       B. One evolved rule, in every cell.
       ====================================================== */
    function buildB(pane, D) {
      var TEX = {
        stripes2: function (i) { return i % 2 === 0 ? 1 : 0; },
        stripes4: function (i) { return i % 4 < 2 ? 1 : 0; },
        checker: function (i, j) { return (i + j) % 2 === 0 ? 1 : 0; },
        diag4: function (i, j) { return (i + j) % 4 < 2 ? 1 : 0; },
        mesh4: function (i, j) { return i % 4 === 0 || j % 4 === 0 ? 1 : 0; },
        dots3: function (i, j) { return i % 4 < 2 && j % 4 < 2 ? 1 : 0; }
      };
      // board genome per texture with mutation on (ip 0.2, ppp 0.02): plantings, of 10, that repaired the cut
      // exactly (verifier's checks/board_checks.js, verify.md section 2.4; re-run in QA with the same result)
      var MUT10 = { stripes2: 0, stripes4: 3, checker: 6, diag4: 3 };
      var TASKS = [
        { key: 'stripes2', label: 'stripes', kind: 'tex', solved: true },
        { key: 'stripes4', label: 'wide stripes', kind: 'tex', solved: true },
        { key: 'checker', label: 'checkerboard', kind: 'tex', solved: true },
        { key: 'diag4', label: 'diagonal bands', kind: 'tex', solved: true },
        { key: 'mesh4', label: 'grid lines', kind: 'tex', solved: false,
          note: 'Of three CMA-ES runs for grid lines (fitness 0.81, 0.81 and 0.83 of a possible 1), the rule that best repaired held-out cuts. '
            + 'None holds the mesh and repairs it. That is a search failure over three runs, not a proven limit.' },
        { key: 'dots3', label: 'dots', kind: 'tex', solved: false,
          note: 'The best rule of three CMA-ES runs for dots (fitness 0.67, 0.73 and 0.68 of a possible 1). '
            + 'None holds the dots and repairs them. That is a search failure over three runs, not a proven limit.' },
        { key: 'disc', label: 'grow a disc', kind: 'disc', solved: false,
          note: 'Grow a disc of radius 8 from a 3&nbsp;&times;&nbsp;3 seed on the 32&nbsp;&times;&nbsp;32 training grid, then '
            + 'regrow it after the right half is cut at generation 50. The best rule of three draws stripes instead. '
            + 'Offline scores 0.30, 0.25 and 0.27 (mean IoU, grown and regrown), against 0.19 for filling the whole grid.' },
        { key: 'digit', label: 'half a digit', kind: 'digit', solved: false,
          note: 'The top half of a binarised MNIST test digit is given; the rule runs 30 steps and the bottom half is '
            + 'scored by IoU. Offline, on 300 test digits, the best of three runs scored 0.228 against 0.233 for '
            + 'extending the last given row straight down; the other two runs 0.121 and 0.105.' }
      ];
      var MODES = [
        { key: 'shared', label: 'ip 1, no mutation', ip: 1, ppp: 0, cutAt: 30 },
        { key: 'ip', label: 'ip 0.2', ip: 0.2, ppp: 0, cutAt: 100 },
        { key: 'mut', label: 'ip 0.2 + mutation', ip: 0.2, ppp: 0.02, cutAt: 100 }
      ];
      var task = TASKS[2], mode = MODES[0];

      var rows = h('div', { class: 'ip-rows' });
      var solvedHost = h('div', { class: 'presets', role: 'group', 'aria-label': 'Patterns a rule was found for' });
      var unsolvedHost = h('div', { class: 'presets', role: 'group', 'aria-label': 'Patterns no rule was found for' });
      var modeLabel = h('span', { class: 'ctl-label', text: 'Inheritance' });
      var modeSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Inheritance and mutation' });
      var modeWrap = h('div', null, [modeSw]);
      rows.appendChild(h('span', { class: 'ctl-label', text: 'Repaired' }));
      rows.appendChild(solvedHost);
      rows.appendChild(h('span', { class: 'ctl-label', text: 'No rule found' }));
      rows.appendChild(unsolvedHost);
      rows.appendChild(modeLabel);
      rows.appendChild(modeWrap);
      pane.appendChild(rows);
      var noteEl = h('p', { class: 'note presetnote' });
      pane.appendChild(noteEl);

      var f1 = fig('target', '', 'The target pattern');
      var f2 = fig('now', 'drag to cut', 'Alpha channel of the grid running the evolved rule; drag to cut', true);
      var f3 = fig('errors', 'vs target', 'Cells that differ from the target');
      var f4 = fig('genomes', 'GHC', 'Genotype hash colouring: one colour per genome');
      var cvrow = h('div', { class: 'cvrow' }, [f1.fig, f2.fig, f3.fig, f4.fig]);
      function sw(c, label) {
        return h('span', null, [h('i', { class: 'swatch', style: 'background:rgb(' + c.join(',') + ')' }), document.createTextNode(label)]);
      }
      var legend = h('div', { class: 'legend' }, [
        sw(C_WRONG, 'alive, should be empty'), sw(C_EMPTY, 'empty, should be alive'), sw([210, 210, 220], 'outline: the cut')
      ]);
      var left = h('div', null, [cvrow, legend]);

      var status = h('p', { class: 'ip-status' });
      var rn = h('div', { class: 'readnum' });
      var R = {};
      var bPlay = btn(kit.reduceMotion ? 'Play' : 'Pause', 'primary'), bStep = btn('Step');
      var bCut = btn('Cut the centre'), bNew = btn('Replant');
      var bPrev = btn('‹ Digit'), bNext = btn('Digit ›');
      bPrev.setAttribute('aria-label', 'Previous digit'); bNext.setAttribute('aria-label', 'Next digit');
      var controls = h('div', { class: 'controls' }, [bPlay, bStep, bCut, bNew, bPrev, bNext]);
      var speedIn = h('input', { type: 'range', min: '2', max: '60', step: '1', value: '15', id: 'ipSpeedB' });
      var speedOut = h('output', { for: 'ipSpeedB' });
      var slider = h('div', { class: 'slider' }, [h('label', { for: 'ipSpeedB', text: 'speed' }), speedIn, speedOut]);
      var sideNote = h('p', { class: 'note', style: 'margin-top:10px' });
      pane.appendChild(h('div', { class: 'lab' }, [left, h('div', { class: 'readout' }, [status, rn, controls, slider, sideNote])]));

      var sim = S.NCA({ W: 48, init: 0, ip: 1, ppp: 0, budget: Infinity, act: 'sigmoid' });
      var running = !kit.reduceMotion, sp = stepper(15), dirty = true;
      var tgt = null, mark = null, edge = null, cutDone = false, t0 = null, gen0 = 0;
      var digitIdx = 0, digits = null, digitScores = null, digitMeans = null;
      kit.slider(speedIn, speedOut, function (v) { return v + '/s'; }, function (v) { sp.rate = v; });

      function genome(key) { return Float32Array.from(D.genomes[key].g); }

      // ---------- digits: unpack and score once ----------
      function unpackDigits() {
        if (digits) return;
        digits = D.digits.map(function (d) {
          var bin = atob(d.b), px = new Uint8Array(784), k;
          for (k = 0; k < 784; k++) px[k] = (bin.charCodeAt(k >> 3) >> (7 - (k & 7))) & 1;
          var t = new Uint8Array(32 * 32), y, x;   // 28x28 placed at offset 2 in a 32x32 grid, as tasks.js
          for (y = 0; y < 28; y++) for (x = 0; x < 28; x++) if (px[y * 28 + x]) t[(y + 2) * 32 + x + 2] = 1;
          return { y: d.y, t: t, ext: extendDown(t) };
        });
      }
      // es_digit.js's 'extend down' baseline: each column on in the last given row (grid row 15) is drawn down to row 29
      function extendDown(t) {
        var p = new Uint8Array(32 * 32), x, y;
        for (x = 0; x < 32; x++) if (t[15 * 32 + x]) for (y = 16; y < 30; y++) p[y * 32 + x] = 1;
        return p;
      }
      function iouRows(pred, t, top) {
        var I = 0, U = 0, i;
        for (i = 0; i < 1024; i++) {
          if ((((i / 32) | 0) < 16) !== top) continue;
          if (pred[i] && t[i]) I++;
          if (pred[i] || t[i]) U++;
        }
        return U ? I / U : 1;
      }
      function aliveMask(s) {
        var m = new Uint8Array(s.N); for (var i = 0; i < s.N; i++) m[i] = s.st[i] > s.alpha ? 1 : 0; return m;
      }
      function plantDigit(s, d, g) {
        s.seed(0, function (ss) { for (var i = 0; i < 1024; i++) if (d.t[i] && i < 16 * 32) ss.found(i, g); });
      }
      function scoreDigits() {
        if (digitScores) return;
        unpackDigits();
        var g = genome('digit'), s = S.NCA({ W: 32, init: 0, ip: 1, ppp: 0, budget: Infinity, act: 'sigmoid' });
        var rule = 0, ext = 0;
        digitScores = digits.map(function (d) {
          plantDigit(s, d, g);
          for (var k = 0; k < 30; k++) s.step();
          var r = iouRows(aliveMask(s), d.t, false), e = iouRows(d.ext, d.t, false);
          rule += r / digits.length; ext += e / digits.length;
          return { rule: r, ext: e };
        });
        digitMeans = { rule: rule, ext: ext };
      }

      // ---------- planting ----------
      function plant() {
        var k = task.kind, W, i, j, g = genome(task.key);
        if (k === 'tex') {
          W = 48;
          sim.ip = mode.ip; sim.ppp = mode.ppp;
        } else { W = 32; sim.ip = 1; sim.ppp = 0; }
        if (sim.W !== W) sim.resize(W);
        tgt = new Uint8Array(W * W);
        if (k === 'tex') {
          for (i = 0; i < W; i++) for (j = 0; j < W; j++) tgt[i * W + j] = TEX[task.key](i, j);
          sim.seed(0, function (s) { for (var q = 0; q < s.N; q++) if (tgt[q]) s.found(q, g); });
        } else if (k === 'disc') {
          var m = W >> 1;
          for (i = -8; i <= 8; i++) for (j = -8; j <= 8; j++) if (i * i + j * j <= 64) tgt[(m + i) * W + m + j] = 1;
          sim.seed(0, function (s) {
            for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) s.found((m + di) * W + m + dj, g);
          });
        } else {
          scoreDigits();
          tgt = digits[digitIdx].t;
          plantDigit(sim, digits[digitIdx], g);
        }
        mark = new Uint8Array(W * W); edge = new Uint8Array(W * W); tgtDirty = true;
        cutDone = false; t0 = null; gen0 = 0;
        if (k === 'digit') { running = !kit.reduceMotion; }
        bPlay.textContent = running ? 'Pause' : 'Play';
        dirty = true;
        setStatus();
      }

      function aDigit(y) { return (y === 8 ? 'an ' : 'a ') + y; }
      function cutAt() { return task.kind === 'tex' ? mode.cutAt : task.kind === 'disc' ? 50 : null; }
      function markCells(list) {
        var W = sim.W, k, i;
        for (k = 0; k < list.length; k++) mark[list[k]] = 1;
        for (i = 0; i < sim.N; i++) {
          edge[i] = 0;
          if (!mark[i]) continue;
          var r0 = (i / W) | 0, c0 = i % W;
          if (!mark[((r0 + 1) % W) * W + c0] || !mark[((r0 - 1 + W) % W) * W + c0] ||
            !mark[r0 * W + (c0 + 1) % W] || !mark[r0 * W + (c0 - 1 + W) % W]) edge[i] = 1;
        }
      }
      function disc(ci, cj, r) {
        var W = sim.W, out = [], di, dj;
        for (di = -r; di <= r; di++) for (dj = -r; dj <= r; dj++) {
          if (di * di + dj * dj <= r * r) out.push(((ci + di + W) % W) * W + ((cj + dj + W) % W));
        }
        sim.wound(ci, cj, r);           // the page's annihilation kernel
        return out;
      }
      function cutCentre() {
        if (task.kind === 'digit') return;
        var W = sim.W, list;
        if (task.kind === 'disc') {      // tasks.js shapePhases: cut away the right half
          list = [];
          for (var i = 0; i < W; i++) {
            for (var j = W >> 1; j < W; j++) {
              var q = i * W + j;
              sim.wound(i, j, 0); list.push(q);
            }
          }
        } else list = disc(W >> 1, W >> 1, 10);   // transplant.js: radius 10 at the centre of 48
        mark.fill(0);
        markCells(list);
        cutDone = true; t0 = sim.gen;
        dirty = true; setStatus();
      }

      function step() {
        if (task.kind === 'digit' && sim.gen >= 30) { running = false; bPlay.textContent = 'Replay'; return; }
        sim.step();
        var c = cutAt();
        if (c !== null && !cutDone && sim.gen >= c) cutCentre();
        if (task.kind === 'digit' && sim.gen >= 30) { running = false; bPlay.textContent = 'Replay'; setStatus(); }
        dirty = true;
      }

      function setStatus() {
        var txt, c = cutAt();
        if (task.kind === 'digit') {
          txt = sim.gen < 30 ? 'Running the rule on digit ' + (digitIdx + 1) + ' of 20: step ' + sim.gen + ' of 30.'
            : 'Done: digit ' + (digitIdx + 1) + ' of 20 (' + aDigit(digits[digitIdx].y) + '), scored after 30 steps.';
        } else if (!cutDone) {
          txt = 'Holding the ' + (task.kind === 'disc' ? 'disc' : 'pattern') + '. The cut comes at generation ' + c
            + (task.kind === 'disc' ? ' (the right half).' : '; or drag on “now”.');
        } else {
          txt = 'Cut at generation ' + t0 + '. Drag on “now” to cut more.';
        }
        if (status.textContent !== txt) status.textContent = txt;
      }

      // ---------- readouts ----------
      function layoutReadout() {
        if (task.kind === 'tex') {
          R = readnum(rn, [
            ['gen', 'generation'], ['h', 'generations since the cut'],
            ['wound', 'cut cells correct'], ['all', 'whole grid correct'],
            ['wrong', 'cells wrong'], ['genomes', 'genomes in use']
          ]);
        } else if (task.kind === 'disc') {
          R = readnum(rn, [
            ['gen', 'generation'], ['h', 'generations since the cut'],
            ['iou', 'IoU with the disc'], ['fill', 'IoU of filling the whole grid'],
            ['alive', 'living cells'], ['genomes', 'genomes in use']
          ]);
        } else {
          R = readnum(rn, [
            ['gen', 'step, of 30'], ['top', 'top half kept (IoU)'],
            ['rule', 'bottom half, this rule (IoU)'], ['ext', 'bottom half, extend down'],
            ['rule20', 'all 20 digits, this rule'], ['ext20', 'all 20 digits, extend down']
          ]);
        }
      }
      function genomeCount() {
        var set = new Set(), u32 = new Uint32Array(sim.g.buffer), i;
        for (i = 0; i < sim.N; i++) if (sim.st[i] > sim.alpha) set.add(genomeHash(u32, i * P));
        return set.size;
      }
      function readout() {
        var N = sim.N, alpha = sim.alpha, i, a;
        if (task.kind === 'digit') {
          var m = aliveMask(sim);
          setNum(R.gen, String(sim.gen));
          setNum(R.top, kit.fmt(iouRows(m, tgt, true), 3));
          setNum(R.rule, kit.fmt(iouRows(m, tgt, false), 3));
          setNum(R.ext, kit.fmt(digitScores[digitIdx].ext, 3));
          setNum(R.rule20, kit.fmt(digitMeans.rule, 3));
          setNum(R.ext20, kit.fmt(digitMeans.ext, 3));
          return;
        }
        setNum(R.gen, String(sim.gen));
        setNum(R.h, cutDone ? String(sim.gen - t0) : '–');
        setNum(R.genomes, String(genomeCount()));
        if (task.kind === 'tex') {
          var ok = 0, wn = 0, wok = 0;
          for (i = 0; i < N; i++) {
            a = sim.st[i] > alpha ? 1 : 0;
            if (a === tgt[i]) ok++;
            if (mark[i]) { wn++; if (a === tgt[i]) wok++; }
          }
          setNum(R.wound, wn ? pct1(wok / wn) : '–');
          setNum(R.all, pct1(ok / N));
          setNum(R.wrong, String(N - ok));
        } else {
          var I = 0, U = 0, al = 0, area = 0;
          for (i = 0; i < N; i++) {
            a = sim.st[i] > alpha;
            if (a) al++;
            if (tgt[i]) area++;
            if (a && tgt[i]) I++;
            if (a || tgt[i]) U++;
          }
          setNum(R.iou, kit.fmt(U ? I / U : 0, 3));
          setNum(R.fill, kit.fmt(area / N, 3));
          setNum(R.alive, String(al));
        }
      }

      // ---------- drawing ----------
      var C_TGT = [236, 226, 200], C_OK = [70, 70, 80], tgtDirty = true;
      function paint() {
        var W = sim.W, alpha = sim.alpha, dig = task.kind === 'digit';
        if (dig) {
          var d = digits[digitIdx];
          draw(f1.cv, W, function (i, rgb) {
            if (i >= 16 * 32) { rgb[0] = rgb[1] = rgb[2] = 52; return; }
            if (d.t[i]) setRGB(rgb, C_TGT);
          });
          kit.paint(f2.cv, sim, 'alpha');
          draw(f3.cv, W, function (i, rgb) {
            if (i < 16 * 32 ? d.t[i] : d.ext[i]) setRGB(rgb, C_TGT);
          });
          draw(f4.cv, W, function (i, rgb) { if (d.t[i]) setRGB(rgb, C_TGT); });
          return;
        }
        if (tgtDirty) { tgtDirty = false; draw(f1.cv, W, function (i, rgb) { if (tgt[i]) setRGB(rgb, C_TGT); }); }
        kit.paint(f2.cv, sim, 'alpha');
        draw(f3.cv, W, function (i, rgb) {
          var a = sim.st[i] > alpha ? 1 : 0;
          if (a && !tgt[i]) setRGB(rgb, C_WRONG);
          else if (!a && tgt[i]) setRGB(rgb, C_EMPTY);
          else if (a) setRGB(rgb, C_OK);
          if (edge[i]) tint(rgb, 0.6);
        });
        kit.paint(f4.cv, sim, 'ghc');
      }

      function captions() {
        var dig = task.kind === 'digit';
        f1.lab.textContent = dig ? 'given' : 'target';
        f1.em.textContent = dig ? 'top half' : (task.kind === 'disc' ? 'radius 8' : task.label);
        f2.lab.textContent = dig ? 'the rule' : 'now';
        f2.em.textContent = dig ? 'after its steps' : 'drag to cut';
        f2.cv.classList.toggle('draw', !dig);
        f3.lab.textContent = dig ? 'extend down' : 'errors';
        f3.em.textContent = dig ? 'baseline' : 'vs target';
        f4.lab.textContent = dig ? 'the real digit' : 'genomes';
        f4.em.textContent = dig ? aDigit(digits[digitIdx].y) : 'GHC';
        legend.hidden = dig;
        bPrev.hidden = bNext.hidden = !dig;
        bCut.hidden = bStep.hidden = dig;
        bNew.hidden = dig;
        modeLabel.hidden = modeWrap.hidden = task.kind !== 'tex';
        bCut.textContent = task.kind === 'disc' ? 'Cut the right half' : 'Cut the centre';
      }

      function notes() {
        var txt;
        if (task.kind === 'tex' && task.solved) {
          if (mode.key === 'shared') {
            txt = 'One genome, found by CMA-ES, runs in every cell; ip&nbsp;1 and no mutation, so every copy is the same rule. '
              + 'Offline, all four simple textures were solved in 3 of 3 runs, and the rules restored 78&ndash;100% of 40 random cuts exactly.';
          } else if (mode.key === 'ip') {
            txt = 'The same genome at ip&nbsp;0.2, so a cell copies a neighbour&rsquo;s genome only in some generations; mutation off. '
              + 'Offline, 8 of 12 such genomes repaired the cut exactly (11 of 12 at ip&nbsp;1).';
          } else {
            txt = 'ip&nbsp;0.2 with mutation at birth, ppp&nbsp;0.02. Offline, planted once each, 3 of 12 genomes repaired the cut. '
              + 'Over 10 plantings each, the four genomes on this board repaired it in 12 of 40 (this one in ' + MUT10[task.key]
              + ' of 10) and the other eight in 5 of 80: mutation breaks the texture in most runs, but not in all. '
              + 'Every empty cell next to a living one inherits a neighbour&rsquo;s genome with probability ip each generation, '
              + 'and may mutate it, so new genomes (the GHC view) appear across the whole texture, not only in the cut.';
          }
        } else txt = task.note;
        noteEl.innerHTML = txt;
        sideNote.innerHTML = task.kind === 'digit'
          ? 'All six numbers are computed live, here, on the 20 embedded test digits.'
          : 'The rule is the page&rsquo;s substrate, unchanged; only the starting grid and the genome are chosen. '
          + 'Drag on &ldquo;now&rdquo; to cut; the cut cells are scored until you replant.';
      }

      function choose(k) {
        task = TASKS.filter(function (t) { return t.key === k; })[0];
        running = !kit.reduceMotion;
        pressTasks();
        if (task.kind === 'digit') scoreDigits();
        layoutReadout(); captions(); notes(); plant();
      }

      // one pressed pill across the two rows
      var taskBtns = [];
      TASKS.forEach(function (t) {
        var b = h('button', { type: 'button', text: t.label, 'aria-pressed': String(t === task) });
        b.addEventListener('click', function () { choose(t.key); });
        (t.solved ? solvedHost : unsolvedHost).appendChild(b);
        taskBtns.push(b);
      });
      function pressTasks() { taskBtns.forEach(function (b, k) { b.setAttribute('aria-pressed', String(TASKS[k] === task)); }); }

      seg(modeSw, MODES, function (k) {
        mode = MODES.filter(function (m) { return m.key === k; })[0];
        notes(); plant();
      }, mode.key);

      bPlay.addEventListener('click', function () {
        if (task.kind === 'digit' && sim.gen >= 30) { plant(); running = true; bPlay.textContent = 'Pause'; return; }
        running = !running; bPlay.textContent = running ? 'Pause' : 'Play';
      });
      bStep.addEventListener('click', function () { step(); setStatus(); });
      bCut.addEventListener('click', function () { cutCentre(); });
      bNew.addEventListener('click', function () { plant(); });
      function moveDigit(d) {
        digitIdx = (digitIdx + d + 20) % 20;
        running = true; plant(); captions();
      }
      bPrev.addEventListener('click', function () { moveDigit(-1); });
      bNext.addEventListener('click', function () { moveDigit(1); });

      kit.pointer(f2.cv, function () { return sim.W; }, function () { return sim.W; }, function (row, col, ph) {
        if (task.kind === 'digit' || ph === 'up') return;
        if (row < 0 || col < 0 || row >= sim.W || col >= sim.W) return;
        if (!cutDone) { mark.fill(0); cutDone = true; }
        t0 = sim.gen;
        markCells(disc(row, col, Math.max(2, Math.round(sim.W / 16))));
        dirty = true;
        if (ph === 'down') setStatus();
      });

      function frame(t) {
        if (running) {
          var n = due(sp, t), tb = performance.now();
          for (var k = 0; k < n && running && (k === 0 || performance.now() - tb < 12); k++) step();
          if (n) setStatus();
        } else sp.last = t;
        if (dirty) { paint(); readout(); dirty = false; }
      }

      layoutReadout(); captions(); notes(); plant();
      return { frame: frame, show: function () { dirty = true; }, sim: sim };
    }

    return {
      frame: function (t) { api.frame(t); },
      show: function () { api.show(); },
      hide: function () { api.hide(); },
      _api: api
    };
  });
})();
