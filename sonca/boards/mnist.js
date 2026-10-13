/* ==========================================================
   Section 9, board "mnist": can the substrate read a digit?

   Also defines SONCA.mnistShared (engine, data loader, sample
   grid, chart), which boards/cmnist.js reuses. This file must
   therefore load before cmnist.js, as index.html has it.

   THE RULE IS MODIFIED. The board runs the "clamped-alpha" frame
   of the research scripts (core.js, level2.js), not nca.py.
   What differs from nca.py and from app.js's NCA.step:
     1. alpha is clamped to the digit and is a read-only input: an
        ink pixel (> 127 of 255) has alpha a (1.0; in Colored MNIST
        1.0 for red ink and 0.6 for green), every other pixel 0. The
        agent's alpha output o0 is discarded, so it is not computed.
     2. a cell is alive iff its clamped alpha > 0.5 (the substrate's
        sigmoid liveness threshold, applied to the clamped value).
        Cells off the digit are dead and their chemistry is 0.
     3. chemistry is the only thing the agents write:
          h_k   = sigmoid(g[36+k] + sum over the 3x3 neighbourhood of
                  w * alpha + w * chem)          (page weight layout)
          chem' = sigmoid(g[43] + g[40] h_0 + g[41] h_1)
        with zero biases, exactly the page's forward pass. Chemistry
        starts at 0 everywhere.
     4. no inheritance, mutation or life budget while the board runs:
        either one shared genome sits in every living cell (the
        evolved rules and the untrained one), or a frozen tissue
        keeps one genome per site (the substrate-native result); a
        site on the ink that has no agent stays dead.
     5. read-out: a cell's class is its chemistry bin (chem > 0.5 for
        two classes, floor(10 chem) for ten), and the digit's answer
        is the majority vote of its living cells, read at step 30,
        the horizon every rule was evolved for; ties go to the lower
        class.
   The tissue itself was grown offline (level2.js) with a further
   change: after 30 steps on a training digit every living cell of
   the wrong class died, and births (copy and mutate from a living
   neighbour) refilled the sites; the budget was off. The board
   only replays the frozen result.
   ========================================================== */

(function () {
  'use strict';

  var S = window.SONCA;
  if (!S || !S.board) return;

  /* ---------------- the clamped-alpha engine ---------------- */

  var W = 28, N = W * W, P = 44, T_MAX = 60, T_SCORE = 30;
  var sig = S.sigmoid;

  // torus neighbours in app.js order: m = (dx+1)*3 + (dy+1), dx the row offset
  var NB = new Int32Array(N * 9);
  (function () {
    var i, j, dx, dy;
    for (i = 0; i < W; i++) for (j = 0; j < W; j++) {
      for (dx = -1; dx <= 1; dx++) for (dy = -1; dy <= 1; dy++) {
        NB[(i * W + j) * 9 + (dx + 1) * 3 + (dy + 1)] = ((i + dx + W) % W) * W + ((j + dy + W) % W);
      }
    }
  })();

  // a presented digit: the clamped alpha map, its living cells, and for
  // each living cell the alpha of its 9 neighbours and their index among
  // the living cells (-1 = dead, chemistry 0)
  function prep(alpha) {
    var pos = new Int32Array(N), alive = [], i, c, m;
    for (i = 0; i < N; i++) {
      pos[i] = -1;
      if (alpha[i] > 0.5) { pos[i] = alive.length; alive.push(i); }
    }
    var n = alive.length, nbi = new Int32Array(n * 9), nba = new Float64Array(n * 9);
    for (c = 0; c < n; c++) {
      for (m = 0; m < 9; m++) {
        var q = NB[alive[c] * 9 + m];
        nbi[c * 9 + m] = pos[q];
        nba[c * 9 + m] = alpha[q];
      }
    }
    return { n: n, alive: alive, nbi: nbi, nba: nba, alpha: alpha };
  }
  function alphaOf(ink, a) {
    var x = new Float64Array(N), i;
    for (i = 0; i < N; i++) x[i] = ink[i] ? a : 0;
    return x;
  }

  // one genome in every living cell for T steps; returns the chemistry of
  // living cell c after step t at hist[t * n + c] (step 0 is all zeros).
  // Same arithmetic order as core.js runClonal, so votes match the research.
  function runClonal(g, d, T) {
    var n = d.n, nbi = d.nbi, nba = d.nba, hist = new Float64Array((T + 1) * n);
    var A0 = new Float64Array(n), A1 = new Float64Array(n), c, m, t, o;
    for (c = 0; c < n; c++) {
      var a0 = g[36], a1 = g[37];
      o = c * 9;
      for (m = 0; m < 9; m++) { a0 += g[m] * nba[o + m]; a1 += g[18 + m] * nba[o + m]; }
      A0[c] = a0; A1[c] = a1;
    }
    for (t = 1; t <= T; t++) {
      var prev = (t - 1) * n, cur = t * n;
      for (c = 0; c < n; c++) {
        var z0 = A0[c], z1 = A1[c];
        o = c * 9;
        for (m = 0; m < 9; m++) {
          var q = nbi[o + m];
          if (q >= 0) { var v = hist[prev + q]; z0 += g[9 + m] * v; z1 += g[27 + m] * v; }
        }
        hist[cur + c] = sig(g[43] + g[40] * sig(z0) + g[41] * sig(z1));
      }
    }
    return hist;
  }

  // a frozen tissue: one genome per site (G, 784 x 44), has[i] = site owns
  // an agent. Same forward pass and order as level2.js present() without
  // learning; a site on the ink without an agent outputs 0.
  function runTissue(G, has, d, T) {
    var n = d.n, alive = d.alive, alpha = d.alpha, hist = new Float64Array((T + 1) * n);
    var ch = new Float64Array(N), nx = new Float64Array(N), c, m, t, i, b;
    for (t = 1; t <= T; t++) {
      for (c = 0; c < n; c++) {
        i = alive[c];
        if (!has[i]) { nx[i] = 0; continue; }
        b = i * P;
        var z0 = G[b + 36], z1 = G[b + 37];
        for (m = 0; m < 9; m++) {
          var q = NB[i * 9 + m], a = alpha[q], v = ch[q];
          z0 += G[b + m] * a + G[b + 9 + m] * v;
          z1 += G[b + 18 + m] * a + G[b + 27 + m] * v;
        }
        nx[i] = sig(G[b + 43] + G[b + 40] * sig(z0) + G[b + 41] * sig(z1));
      }
      for (c = 0; c < n; c++) { i = alive[c]; ch[i] = nx[i]; hist[t * n + c] = nx[i]; }
    }
    return hist;
  }

  function cls(v, K) {
    if (K === 2) return v > 0.5 ? 1 : 0;
    var k = Math.floor(v * 10);
    return k < 0 ? 0 : k > 9 ? 9 : k;
  }

  // per-step class counts of the living cells: counts[t * K + k], living[t]
  function census(hist, d, live, K, T) {
    var n = d.n, counts = new Int32Array((T + 1) * K), living = 0, t, c;
    for (c = 0; c < n; c++) if (live[c]) living++;
    for (t = 0; t <= T; t++) {
      for (c = 0; c < n; c++) if (live[c]) counts[t * K + cls(hist[t * n + c], K)]++;
    }
    return { counts: counts, living: living, K: K };
  }
  // majority vote at step t, first class wins a tie; -1 when nothing lives
  function voteAt(cen, t) {
    if (!cen.living) return { vote: -1, share: 0 };
    var K = cen.K, o = t * K, best = 0, k;
    for (k = 1; k < K; k++) if (cen.counts[o + k] > cen.counts[o + best]) best = k;
    return { vote: best, share: cen.counts[o + best] / cen.living };
  }

  // a whole run of one presented digit under one rule
  // rule = { K, genome } or { K, tissue: {G, has} }
  function simulate(rule, ink, a, T) {
    var d = prep(alphaOf(ink, a === undefined ? 1 : a));
    var live = new Uint8Array(d.n), c, hist;
    if (rule.tissue) {
      for (c = 0; c < d.n; c++) live[c] = rule.tissue.has[d.alive[c]];
      hist = runTissue(rule.tissue.G, rule.tissue.has, d, T);
    } else {
      live.fill(1);
      hist = runClonal(rule.genome, d, T);
    }
    return { d: d, hist: hist, live: live, cen: census(hist, d, live, rule.K, T), K: rule.K, T: T };
  }
  // class of every grid site at step t (-1 dead ink, -2 off the digit)
  function classMap(sim, t, out) {
    var d = sim.d, n = d.n, i, c;
    for (i = 0; i < N; i++) out[i] = -2;
    for (c = 0; c < n; c++) out[d.alive[c]] = sim.live[c] ? cls(sim.hist[t * n + c], sim.K) : -1;
    return out;
  }

  // chemistry of every grid site at step t (-1 dead ink, -2 off the digit)
  function chemMap(sim, t, out) {
    var d = sim.d, n = d.n, i, c;
    for (i = 0; i < N; i++) out[i] = -2;
    for (c = 0; c < n; c++) out[d.alive[c]] = sim.live[c] ? sim.hist[t * n + c] : -1;
    return out;
  }
  // the page's magma, lifted off black so a cell at chemistry 0 still shows
  function paintChem(kit, cv, sim, t, out) {
    chemMap(sim, t, out);
    var noAg = rgbOf(COL.noAgent);
    kit.draw(cv, W, W, function (i, rgb) {
      var v = out[i], c = v >= 0 ? S.magma(0.14 + 0.86 * v) : v === -1 ? noAg : VOID;
      rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
    });
  }

  /* ---------------- data ---------------- */

  function bytes(b64) {
    var s = atob(b64), u = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  // 784-bit mask, bit i of byte i >> 3
  function unpack(b64) {
    var b = bytes(b64), x = new Uint8Array(N), i;
    for (i = 0; i < N; i++) x[i] = (b[i >> 3] >> (i & 7)) & 1;
    return x;
  }

  var DATA = null, waiting = null;
  function decode(raw) {
    var digits = raw.digits.map(function (r, k) {
      return { k: k, testIndex: r[0], label: r[1], ink: unpack(r[2]) };
    });
    var tb = bytes(raw.tissue.g16), G = new Float64Array(N * P), j;
    for (j = 0; j < N * P; j++) {
      var v = tb[2 * j] | (tb[2 * j + 1] << 8);
      if (v >= 32768) v -= 65536;
      G[j] = v / raw.tissue.scale;
    }
    var f64 = function (r) { r.genome = Float64Array.from(r.genome); return r; };
    ['bin01', 'lt5', 'c10'].forEach(function (k) { raw.es[k].runs.forEach(f64); });
    f64(raw.cmnist.colour); f64(raw.cmnist.grayscale);
    return {
      digits: digits, es: raw.es,
      tissue: { G: G, has: bytes(raw.tissue.has), test: raw.tissue.test, shuffled: raw.tissue.shuffled },
      cm: {
        digits: raw.cmnist.digits.map(function (r, k) {
          return { k: k, testIndex: r[0], digit: r[1], y: r[2], colTrain: r[3], colTest: r[4] };
        }),
        colour: raw.cmnist.colour, grayscale: raw.cmnist.grayscale
      }
    };
  }
  // both boards share one data file; load it once, whoever asks first
  function loadData(kit, cb) {
    if (DATA) { setTimeout(function () { cb(null, DATA); }, 0); return; }
    if (waiting) { waiting.push(cb); return; }
    waiting = [cb];
    var done = function (err) {
      var raw = window.SONCA_DATA && window.SONCA_DATA.mnist;
      if (!err && !raw) err = new Error('no data');
      if (!err) {
        try { DATA = decode(raw); } catch (e) { err = e; }
      }
      var list = waiting; waiting = null;
      list.forEach(function (f) { f(err, DATA); });
    };
    if (window.SONCA_DATA && window.SONCA_DATA.mnist) done();
    else kit.load('boards/data/mnist.js?v=1', done);
  }

  /* ---------------- colours ---------------- */

  function rgbOf(hex) {
    var n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // fixed hues: the grids are always drawn on the near-black void, and the
  // chart lines use the same hues so a class reads the same everywhere
  var COL = {
    vote2: ['#5b8ff0', '#f0962a'],
    vote10: ['#5b8ff0', '#f0962a', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
    ink: '#e7e5ef', inkDim: '#8d8b9c', noAgent: '#3c3b49', red: '#e5534b', green: '#45b866'
  };
  var VOID = [11, 12, 16];
  function classRGB(K) { return (K === 2 ? COL.vote2 : COL.vote10).map(rgbOf); }

  /* ---------------- small DOM helpers ---------------- */

  function h(tag, attrs, kids) {
    var e = document.createElement(tag), k;
    for (k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) {
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function btn(label, cls, aria) {
    var b = h('button', { type: 'button', class: cls || 'btn', text: label });
    if (aria) b.setAttribute('aria-label', aria);
    return b;
  }
  function pct(v, d) { return (v * 100).toFixed(d === undefined ? 1 : d) + '%'; }

  var styled = false;
  function addStyle() {
    if (styled) return;
    styled = true;
    var B = '[data-board="mnist"] ', C = '[data-board="cmnist"] ';
    var css = [
      '.mn-tiles{width:100%;height:auto;display:block;cursor:pointer;margin:4px 0 2px;touch-action:manipulation}',
      '.mn-samples{margin-top:18px;border-top:1px solid var(--rule);padding-top:12px}',
      '.mn-samples .controls{margin-bottom:6px}',
      '.mn-tally{font-size:14px;color:var(--text-soft)}',
      '.mn-tally b{color:var(--text)}',
      '.mn-move{display:inline-flex;gap:4px;align-items:center}',
      '.mn-move .btn{padding:5px 9px;min-width:2.3em}',
      '.verdict.ok{color:var(--clogv)}',
      '.verdict.bad{color:var(--gcvp)}',
      '.verdict.na{color:var(--text-soft)}',
      '.mn-sub{font-size:13.5px;color:var(--text-soft);margin:2px 0 10px;max-width:none}',
      '.mn-sw{width:11px;height:11px;display:inline-block;border-radius:2px;vertical-align:-1px}',
      'table.mn-ct{font-size:13.5px;margin:6px 0 4px}',
      'table.mn-ct td,table.mn-ct th{padding:4px 8px}',
      '.chartbox{margin-top:14px}',
      '.cvrow.mn-c3{grid-template-columns:repeat(3,minmax(0,1fr))}',
      '.cvrow.mn-c4{grid-template-columns:repeat(4,minmax(0,1fr))}'
    ];
    var s = document.createElement('style');
    s.textContent = css.map(function (r) { return B + r + '\n' + C + r; }).join('\n')
      + '\n' + B + '.mn-tiles{max-width:780px}'
      + '\n@media (max-width:560px){' + B + '.cvrow.mn-c4{grid-template-columns:repeat(2,minmax(0,1fr))}'
      + B + '.mn-c3 figcaption em,' + C + '.mn-c3 figcaption em{display:none}}';
    document.head.appendChild(s);
  }

  /* ---------------- the grid of sample digits ----------------
     sections = [{ label, items: [digit k, ...] }]
     mode 'rows':   one section per row band, label on the left, 20 a row
     mode 'blocks': sections side by side, label on top, 10 a row      */

  function TileGrid(cv, kit, hooks) {
    var g = { sections: [], rects: {}, order: [], cur: -1 };
    var PITCH = 32, INSET = 2, LABEL = 24, HEAD = 20, GAP = 18;
    var W1 = 0, H1 = 0, scale = 2;
    var off = document.createElement('canvas'); off.width = 28; off.height = 28;
    var octx = off.getContext('2d'), img = octx.createImageData(28, 28);
    var rgb = [0, 0, 0];

    // tiles a row: fewer on a narrow screen, so a tile stays big enough to see and tap
    function perRow(mode) {
      var narrow = (cv.parentNode && cv.parentNode.clientWidth || 800) < 560;
      return mode === 'blocks' ? (narrow ? 5 : 10) : (narrow ? 10 : 20);
    }
    g.layout = function (sections, mode) {
      g.sections = sections; g.mode = mode; g.rects = {}; g.order = []; g.per = perRow(mode);
      var x0, y0, per = g.per, k, s;
      if (mode === 'blocks') {
        x0 = 0; H1 = 0;
        sections.forEach(function (sec) {
          sec.x = x0; sec.y = 0;
          sec.items.forEach(function (idx, j) {
            g.rects[idx] = { x: x0 + (j % per) * PITCH, y: HEAD + Math.floor(j / per) * PITCH };
            g.order.push(idx);
          });
          var rows = Math.max(1, Math.ceil(sec.items.length / per));
          H1 = Math.max(H1, HEAD + rows * PITCH);
          x0 += per * PITCH + GAP;
        });
        W1 = x0 - GAP;
      } else {
        y0 = 0;
        for (k = 0; k < sections.length; k++) {
          s = sections[k]; s.x = 0; s.y = y0;
          s.items.forEach(function (idx, j) {
            g.rects[idx] = { x: LABEL + (j % per) * PITCH, y: y0 + Math.floor(j / per) * PITCH };
            g.order.push(idx);
          });
          s.h = Math.max(1, Math.ceil(s.items.length / per)) * PITCH;
          y0 += s.h;
        }
        W1 = LABEL + per * PITCH; H1 = y0;
      }
      g.resize();
    };

    g.resize = function () {
      if (g.mode && perRow(g.mode) !== g.per) { g.layout(g.sections, g.mode); return; }
      var cw = cv.clientWidth || W1, dpr = window.devicePixelRatio || 1;
      scale = Math.max(1, Math.min(4, Math.ceil(cw * dpr / W1)));
      cv.width = W1 * scale; cv.height = H1 * scale;
      g.drawAll();
    };

    g.drawAll = function () {
      var ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = kit.css('--text-soft');
      ctx.font = '700 ' + (12 * scale) + 'px Lato, sans-serif';
      ctx.textBaseline = 'middle';
      g.sections.forEach(function (sec) {
        if (g.mode === 'blocks') ctx.fillText(sec.label, sec.x * scale, (HEAD / 2 - 1) * scale);
        else ctx.fillText(sec.label, 4 * scale, (sec.y + PITCH / 2) * scale);
      });
      g.order.forEach(function (idx) { g.draw(idx); });
    };

    g.draw = function (idx) {
      var r = g.rects[idx];
      if (!r) return;
      var ctx = cv.getContext('2d'), d = img.data, i, o;
      for (i = 0; i < N; i++) {
        rgb[0] = VOID[0]; rgb[1] = VOID[1]; rgb[2] = VOID[2];
        hooks.pixel(idx, i, rgb);
        o = i * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(r.x * scale, r.y * scale, PITCH * scale, PITCH * scale);
      ctx.drawImage(off, (r.x + INSET) * scale, (r.y + INSET) * scale, 28 * scale, 28 * scale);
      var frame = idx === g.cur ? kit.css('--text') : hooks.mark(idx);
      if (frame) {
        ctx.strokeStyle = frame;
        ctx.lineWidth = (idx === g.cur ? 2 : 1.3) * scale;
        var o2 = (INSET / 2 + 0.1) * scale;
        ctx.strokeRect(r.x * scale + o2, r.y * scale + o2, (PITCH - INSET - 0.2) * scale, (PITCH - INSET - 0.2) * scale);
      }
    };

    g.setCurrent = function (idx) {
      var was = g.cur; g.cur = idx;
      if (was >= 0) g.draw(was);
      if (idx >= 0) g.draw(idx);
    };

    cv.addEventListener('click', function (e) {
      var b = cv.getBoundingClientRect();
      var x = (e.clientX - b.left) / b.width * W1, y = (e.clientY - b.top) / b.height * H1, k;
      for (k = 0; k < g.order.length; k++) {
        var r = g.rects[g.order[k]];
        if (x >= r.x && x < r.x + PITCH && y >= r.y && y < r.y + PITCH) { hooks.pick(g.order[k]); return; }
      }
    });
    return g;
  }

  /* ---------------- the share-of-votes chart ---------------- */

  // series: share of the living cells voting each class at steps 0..t,
  // for the classes that ever hold more than 2% of the cells
  function drawChart(kit, svg, tip, sim, t, names) {
    var K = sim.K, cen = sim.cen, cols = K === 2 ? COL.vote2 : COL.vote10, series = [], k, s;
    var w = Math.max(340, Math.min(860, (svg.parentNode.clientWidth || 600)));
    if (cen.living) {
      for (k = 0; k < K; k++) {
        var mx = 0;
        for (s = 0; s <= sim.T; s++) mx = Math.max(mx, cen.counts[s * K + k] / cen.living);
        if (mx <= 0.02) continue;
        var pts = [];
        for (s = 0; s <= t; s++) pts.push([s, cen.counts[s * K + k] / cen.living]);
        series.push({ label: names[k], colour: cols[k], points: pts, width: 2.2, end: false });
      }
    }
    kit.chart(svg, {
      w: w, h: w < 520 ? 210 : 230, right: 18,
      x: { min: 0, max: sim.T, label: 'step', ticks: 6 },
      y: { min: 0, max: 1, label: 'share of living cells', ticks: 4, fmt: function (v) { return Math.round(v * 100) + '%'; } },
      series: series,
      marks: [{ x: T_SCORE, label: 'answer read', colour: '--text-mute' }],
      tip: tip
    });
  }

  function legend(host, K, names, extra) {
    host.innerHTML = '';
    var cols = K === 2 ? COL.vote2 : COL.vote10, k;
    for (k = 0; k < K; k++) {
      host.appendChild(h('span', {}, [h('i', { class: 'swatch', style: 'background:' + cols[k] }), names[k]]));
    }
    (extra || []).forEach(function (x) {
      host.appendChild(h('span', {}, [h('i', { class: 'swatch', style: 'background:' + x[0] }), x[1]]));
    });
  }

  S.mnistShared = {
    W: W, N: N, P: P, T_MAX: T_MAX, T_SCORE: T_SCORE, NB: NB,
    prep: prep, alphaOf: alphaOf, runClonal: runClonal, runTissue: runTissue, cls: cls,
    census: census, voteAt: voteAt, simulate: simulate, classMap: classMap, chemMap: chemMap, paintChem: paintChem,
    loadData: loadData, COL: COL, VOID: VOID, rgbOf: rgbOf, classRGB: classRGB,
    h: h, btn: btn, pct: pct, addStyle: addStyle, TileGrid: TileGrid, drawChart: drawChart, legend: legend
  };

  /* ==========================================================
     The MNIST board
     ========================================================== */

  S.board('mnist', function (root, kit) {
    var live = root.querySelector('.boardlive');
    var msg = h('p', { class: 'note', text: 'Loading 200 test digits and the evolved rules…' });
    live.appendChild(msg);
    var ui = null;
    loadData(kit, function (err, D) {
      if (err) { msg.textContent = 'The board’s data (boards/data/mnist.js) could not be loaded.'; return; }
      live.removeChild(msg);
      ui = build(live, kit, D, root);
    });
    return {
      frame: function (t) { if (ui) ui.frame(t); },
      show: function () { if (ui) ui.redraw(); }
    };
  });

  function build(host, kit, D, root) {
    addStyle();

    /* ---------- the rules ---------- */

    var RUNS = 'ABC';
    var ink01 = 91;   // ink-count rule fitted on train by the verifier: more than 91 ink cells -> "0"
    var TASK = {
      bin01: { K: 2, names: ['0', '1'], label: function (y) { return y <= 1 ? y : -1; }, only01: true, testN: 416 },
      lt5: { K: 2, names: ['≥ 5', '< 5'], label: function (y) { return y < 5 ? 1 : 0; }, testN: 2000 },
      c10: { K: 10, names: '0123456789'.split(''), label: function (y) { return y; }, testN: 2000 },
      tissue: { K: 2, names: ['0', '1'], label: function (y) { return y <= 1 ? y : -1; }, only01: true, testN: 416 },
      untrained: { K: 10, names: '0123456789'.split('').map(function (c) { return 'bin ' + c; }), label: function () { return -1; } }
    };
    // runs in the order validation ranks them; run A is the one validation picked
    function esRuns(key) { return D.es[key].runs.slice().sort(function (a, b) { return b.val - a.val; }); }
    var SUMMARY = {
      bin01: 'three runs average 88.9% (84.4–91.4%). Chance is 51.9%; the ink count alone gets 92.8%.',
      lt5: 'three runs average 57.2% (56.0–57.9%). Chance is 50.2%; the ink count alone gets 53.0%.',
      c10: 'three runs average 16.3% (11.4–19.75%). Chance is 11.1%; the nearest mean of the ink count gets 22.1%.'
    };
    var TASKNAME = { bin01: '0 vs 1', lt5: 'digit < 5', c10: 'ten digits, one per chemistry bin' };

    var state = {
      rule: 'bin01', run: 0, shuffled: false, untrained: null,
      ink: null, label: -1, digit: -1, src: 'sample', idx: -1,
      sim: null, t: 0, playing: !kit.reduceMotion,
      tiles: {}, queue: [], tissueG: null
    };

    function ruleSpec() {
      var r = state.rule, T = TASK[r];
      if (r === 'tissue') return { K: 2, tissue: { G: state.tissueG || D.tissue.G, has: D.tissue.has } };
      if (r === 'untrained') return { K: 10, genome: state.untrained };
      return { K: T.K, genome: esRuns(r)[state.run].genome };
    }
    function newUntrained() {
      var g = new Float64Array(P);
      S.xavier(g, 0);   // the page's founder draw: xavier_uniform weights, zero biases
      state.untrained = g;
    }
    function shuffleTissue() {
      // move the agents to a random permutation of the occupied sites
      var G = D.tissue.G, has = D.tissue.has, occ = [], i, k;
      for (i = 0; i < N; i++) if (has[i]) occ.push(i);
      var perm = occ.slice();
      for (i = perm.length - 1; i > 0; i--) { k = (Math.random() * (i + 1)) | 0; var tmp = perm[i]; perm[i] = perm[k]; perm[k] = tmp; }
      var out = new Float64Array(G.length);
      for (k = 0; k < occ.length; k++) out.set(G.subarray(perm[k] * P, perm[k] * P + P), occ[k] * P);
      state.tissueG = out;
    }

    function samples() {
      var only01 = TASK[state.rule].only01;
      return D.digits.filter(function (d) { return !only01 || d.label <= 1; });
    }

    /* ---------- markup ---------- */

    var pillHost = h('div', { role: 'group', 'aria-label': 'Choose the rule' });
    var row2Label = h('span', { class: 'ctl-label', text: 'Run' });
    var row2 = h('div', { class: 'controls', style: 'margin:0' });
    var rows = h('div', { class: 'presetrows' }, [h('span', { class: 'ctl-label', text: 'Rule' }), pillHost, row2Label, row2]);
    var note = h('p', { class: 'note presetnote', 'aria-live': 'polite' });

    var cvDigit = h('canvas', { class: 'cv draw', width: 28, height: 28, 'aria-label': 'The digit; draw on it to add ink' });
    var cvVote = h('canvas', { class: 'cv', width: 28, height: 28, 'aria-label': 'Each living cell coloured by its current vote' });
    var cvChem = h('canvas', { class: 'cv', width: 28, height: 28, 'aria-label': 'The chemistry of each living cell, the only state the agents write' });
    var cvMap = h('canvas', { class: 'cv', width: 28, height: 28, 'aria-label': 'The frozen tissue: the usual vote of each site over the sample digits' });
    var capDigit = h('em', { text: 'draw on it' }), capVote = h('em', { text: 'step 0' });
    var figMap = h('figure', { class: 'cvfig' }, [cvMap, h('figcaption', {}, [h('span', { text: 'Tissue map' }), h('em', { text: 'usual vote per site' })])]);
    var cvrow = h('div', { class: 'cvrow mn-c3' }, [
      h('figure', { class: 'cvfig' }, [cvDigit, h('figcaption', {}, [h('span', { text: 'Digit' }), capDigit])]),
      h('figure', { class: 'cvfig' }, [cvChem, h('figcaption', {}, [h('span', { text: 'Chemistry' }), h('em', { text: 'what cells write' })])]),
      h('figure', { class: 'cvfig' }, [cvVote, h('figcaption', {}, [h('span', { text: 'Votes' }), capVote])]),
      figMap
    ]);

    var bNext = btn('Next digit', 'btn'), bClear = btn('Clear and draw'), bCentre = btn('Centre');
    var mv = [['←', 0, -2, 'left'], ['→', 0, 2, 'right'], ['↑', -2, 0, 'up'], ['↓', 2, 0, 'down']].map(function (m) {
      var b = btn(m[0], 'btn', 'Move the ink 2 pixels ' + m[3]);
      b.addEventListener('click', function () { moveInk(m[1], m[2]); });
      return b;
    });
    var digitCtl = h('div', { class: 'controls', style: 'margin:12px 0 0' }, [
      bNext, bClear, bCentre,
      h('span', { class: 'mn-move', role: 'group', 'aria-label': 'Move the ink' }, [h('span', { class: 'ctl-label', text: 'Move' })].concat(mv))
    ]);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Share of the living cells voting each class, step by step');
    var tip = h('div', { class: 'tip' });
    var legendHost = h('div', { class: 'legend' });

    function rn(label) { var b = h('b', { text: '–' }); return { el: h('div', {}, [b, label]), b: b }; }
    var R = { step: rn('step'), living: rn('living cells'), now: rn('vote now'), agree: rn('cells agreeing'), ans: rn('answer at step 30'), truth: rn('true label') };
    var readnum = h('div', { class: 'readnum' }, [R.step.el, R.living.el, R.now.el, R.agree.el, R.ans.el, R.truth.el]);
    var verdict = h('p', { class: 'verdict na', 'aria-live': 'polite', text: '–' });
    var sub = h('p', { class: 'mn-sub' });
    var bPlay = btn(state.playing ? 'Pause' : 'Play', 'btn primary'), bStep = btn('Step'), bRestart = btn('Restart');
    var inkLine = h('p', { class: 'mn-sub' });

    var bAll = btn('Run every sample', 'btn');
    var tally = h('span', { class: 'mn-tally', 'aria-live': 'polite' });
    var cvTiles = h('canvas', { class: 'mn-tiles', 'aria-label': 'The embedded sample digits; click one to load it' });
    var tileNote = h('p', { class: 'note', style: 'margin:4px 0 0' });

    host.appendChild(rows);
    host.appendChild(note);
    host.appendChild(h('div', { class: 'lab' }, [
      h('div', {}, [cvrow, digitCtl, h('div', { class: 'chartbox' }, [svg, tip]), legendHost]),
      h('div', { class: 'readout' }, [
        readnum, verdict, sub,
        h('div', { class: 'controls', style: 'margin-bottom:8px' }, [bPlay, bStep, bRestart]),
        inkLine
      ])
    ]));
    host.appendChild(h('p', { class: 'note', style: 'margin:10px 0 0',
      text: 'A modified rule, as in the research: α is clamped to the ink as a read-only input, the agents write only chemistry, '
        + 'and nothing is inherited, mutated or budgeted while a digit is read. The answer is the majority of the living cells’ chemistry votes at step 30.' }));
    host.appendChild(h('div', { class: 'mn-samples' }, [
      h('div', { class: 'controls' }, [h('span', { class: 'kicker', text: 'Sample digits' }), bAll, tally]),
      cvTiles, tileNote
    ]));

    /* ---------- rule pills and the second row ---------- */

    var pills = kit.pills(pillHost, [
      { key: 'bin01', label: '0 vs 1', title: 'One shared genome evolved (CMA-ES) to tell 0s from 1s' },
      { key: 'lt5', label: 'digit < 5', title: 'One shared genome evolved for digit < 5' },
      { key: 'c10', label: 'ten digits', title: 'One shared genome evolved for ten classes' },
      { key: 'tissue', label: 'own adaptation, 0 vs 1', title: 'The substrate-native tissue: task-coupled death, clone-and-mutate, frozen' },
      { key: 'untrained', label: 'untrained', title: 'A fresh random founder genome on every click' }
    ], function (key) {
      if (key === 'untrained') newUntrained();
      setRule(key);
    }, state.rule);

    function buildRow2() {
      row2.innerHTML = '';
      var r = state.rule;
      if (TASK[r] && D.es[r]) {
        row2Label.textContent = 'Run';
        var sw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Choose one of the three evolved runs' });
        esRuns(r).forEach(function (run, j) {
          var b = h('button', { type: 'button', 'aria-pressed': String(j === state.run), text: RUNS[j] + (j === 0 ? ' · picked' : '') });
          b.title = 'Seed ' + run.seed + ': ' + pct(run.test, 2) + ' on the ' + TASK[r].testN.toLocaleString('en-GB') + ' test digits';
          b.addEventListener('click', function () { state.run = j; buildRow2(); ruleChanged(); });
          sw.appendChild(b);
        });
        row2.appendChild(sw);
      } else if (r === 'tissue') {
        row2Label.textContent = 'Agents';
        var sw2 = h('div', { class: 'switch', role: 'group', 'aria-label': 'Keep the agents where they grew, or shuffle them' });
        [['as grown', false], ['shuffled', true]].forEach(function (o) {
          var b = h('button', { type: 'button', 'aria-pressed': String(state.shuffled === o[1]), text: o[0] });
          b.addEventListener('click', function () {
            if (o[1]) shuffleTissue(); else state.tissueG = null;
            state.shuffled = o[1]; buildRow2(); ruleChanged();
          });
          sw2.appendChild(b);
        });
        row2.appendChild(sw2);
      } else {
        row2Label.textContent = 'Genome';
        var nb = btn('Draw another', 'btn');
        nb.addEventListener('click', function () { newUntrained(); ruleChanged(); });
        row2.appendChild(nb);
      }
    }

    function noteText() {
      var r = state.rule;
      if (r === 'tissue') {
        return state.shuffled
          ? 'The same agents, moved to a random permutation of the occupied sites (a new one on each click). '
            + 'The research’s shuffle answered “0” for every one of the 416 test 0s and 1s (48.1%, below the 51.9% of always answering “1”).'
          : 'Grown by the substrate’s own adaptation, with two changes: agents persisted, dormant off the digit, and instead of a budget every cell of the wrong class died after 30 steps, '
            + 'its site refilled by clone-and-mutate from a neighbour. One genome per site. '
            + 'Frozen, seed 1’s tissue scores 98.8% on the 416 test 0s and 1s, the best of three seeds (the others 92.3% and 49.5%). '
            + 'It is a positional template, so a digit moved sideways or drawn off-centre often fails.';
      }
      if (r === 'untrained') {
        return 'A fresh founder genome, xavier weights and zero biases as the substrate draws them. No read-out was fitted, so cells show their chemistry bin. '
          + '64 of 100 untrained rules gave every test digit the same bin.';
      }
      var run = esRuns(r)[state.run];
      return 'One 40-weight genome shared by every cell, evolved by CMA-ES for ' + TASKNAME[r] + '. Run ' + RUNS[state.run]
        + (state.run === 0 ? ' (picked on validation)' : '') + ' scores ' + pct(run.test, 2) + ' on the '
        + TASK[r].testN.toLocaleString('en-GB') + ' test digits; ' + SUMMARY[r];
    }

    /* ---------- the current digit ---------- */

    function loadSample(d) {
      state.ink = d.ink.slice(); state.digit = d.label; state.label = TASK[state.rule].label(d.label);
      state.src = 'sample'; state.idx = d.k;
      if (grid) grid.setCurrent(d.k);
      restart(true);
    }
    function pickNext() {
      var list = samples(), k = 0;
      if (list.length > 1) {
        do { k = (Math.random() * list.length) | 0; } while (list[k].k === state.idx);
      }
      loadSample(list[k]);
    }
    function edited(kind) {
      // a moved sample keeps its label; added ink makes it a drawing with none
      if (kind === 'drawn') { state.src = 'drawn'; state.digit = -1; state.label = -1; }
      else if (state.src === 'sample') state.src = 'moved';
      if (state.idx >= 0) { state.idx = -1; grid.setCurrent(-1); }
    }
    function moveInk(dr, dc) {
      var out = new Uint8Array(N), i, any = false;
      for (i = 0; i < N; i++) {
        if (!state.ink[i]) continue;
        var r = ((i / W) | 0) + dr, c = (i % W) + dc;
        if (r >= 0 && r < W && c >= 0 && c < W) { out[r * W + c] = 1; any = true; }
      }
      if (!any && (dr || dc)) return;
      state.ink = out;
      if (dr || dc) edited('moved');
      restart(true);
    }
    function centre() {
      // MNIST centres each digit by its centre of mass; the 200 samples sit at (14, 14) on average
      var sr = 0, sc = 0, n = 0, i;
      for (i = 0; i < N; i++) if (state.ink[i]) { sr += (i / W) | 0; sc += i % W; n++; }
      if (!n) return;
      moveInk(Math.round(14 - sr / n), Math.round(14 - sc / n));
    }

    // drawing: a round brush about 2 px wide, interpolated along the stroke
    var drawing = false, lastP = null;
    function brush(fr, fc) {
      var r0 = Math.floor(fr - 1.5), c0 = Math.floor(fc - 1.5), r, c, hit = false;
      for (r = r0; r <= r0 + 3; r++) for (c = c0; c <= c0 + 3; c++) {
        if (r < 0 || r >= W || c < 0 || c >= W) continue;
        var dr = r + 0.5 - fr, dc = c + 0.5 - fc;
        if (dr * dr + dc * dc <= 1.1) { if (!state.ink[r * W + c]) hit = true; state.ink[r * W + c] = 1; }
      }
      return hit;
    }
    function stroke(e) {
      var b = cvDigit.getBoundingClientRect();
      var p = [(e.clientY - b.top) / b.height * W, (e.clientX - b.left) / b.width * W];
      var hit = false;
      if (lastP) {
        var dist = Math.hypot(p[0] - lastP[0], p[1] - lastP[1]), steps = Math.max(1, Math.ceil(dist / 0.4)), s;
        for (s = 1; s <= steps; s++) hit = brush(lastP[0] + (p[0] - lastP[0]) * s / steps, lastP[1] + (p[1] - lastP[1]) * s / steps) || hit;
      } else hit = brush(p[0], p[1]);
      lastP = p;
      if (hit) { if (state.src !== 'drawn') edited('drawn'); restart(false); }
    }
    cvDigit.addEventListener('pointerdown', function (e) {
      drawing = true; lastP = null;
      try { cvDigit.setPointerCapture(e.pointerId); } catch (x) { }
      setPlaying(false); stroke(e); e.preventDefault();
    });
    cvDigit.addEventListener('pointermove', function (e) { if (drawing) stroke(e); });
    function endStroke() {
      if (!drawing) return;
      drawing = false; lastP = null;
      if (!kit.reduceMotion) setPlaying(true);
    }
    cvDigit.addEventListener('pointerup', endStroke);
    cvDigit.addEventListener('pointercancel', endStroke);

    /* ---------- running ---------- */

    var cmap = new Int8Array(N), chem = new Float64Array(N);
    function restart(autoplay) {
      state.sim = simulate(ruleSpec(), state.ink, 1, T_MAX);
      state.t = 0;
      if (autoplay !== false && autoplay !== undefined) setPlaying(!kit.reduceMotion || state.playing);
      render();
    }
    function setPlaying(on) {
      state.playing = on;
      if (on && state.t >= T_MAX) { state.t = 0; }
      bPlay.textContent = on ? 'Pause' : state.t >= T_MAX ? 'Replay' : 'Play';
    }
    function advance() {
      if (state.t >= T_MAX) return;
      state.t++;
      if (state.t === T_SCORE && state.src === 'sample' && state.idx >= 0 && !state.tiles[state.idx]) {
        storeTile(state.idx, state.sim);
        updateTally();
      }
      if (state.t >= T_MAX) setPlaying(false);
      render();
    }

    var tick = kit.every(100);   // 10 steps a second
    var tickAll = kit.every(16);
    function frame(t) {
      if (state.queue.length && tickAll(t)) {
        var k = kit.reduceMotion ? state.queue.length : Math.max(1, Math.round(samples().length / 80));
        while (k-- > 0 && state.queue.length) runTile(state.queue.shift());
        updateTally();
      }
      if (state.playing && tick(t)) advance();
    }

    /* ---------- drawing the board ---------- */

    var RGB2 = classRGB(2), RGB10 = classRGB(10), INK = rgbOf(COL.ink), NOAG = rgbOf(COL.noAgent);
    function rgbFor(K) { return K === 2 ? RGB2 : RGB10; }

    function render() {
      var sim = state.sim, t = state.t, K = sim.K, cols = rgbFor(K), names = TASK[state.rule].names;
      kit.draw(cvDigit, W, W, function (i, rgb) {
        var c = state.ink[i] ? INK : VOID;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      });
      paintChem(kit, cvChem, sim, t, chem);
      classMap(sim, t, cmap);
      kit.draw(cvVote, W, W, function (i, rgb) {
        var k = cmap[i], c = k >= 0 ? cols[k] : k === -1 ? NOAG : VOID;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      });
      if (state.rule === 'tissue') drawMap();
      capVote.textContent = 'step ' + t;
      capDigit.textContent = state.src === 'drawn' ? 'your drawing' : state.src === 'moved' ? 'moved sample' : 'draw on it';

      var cen = sim.cen, v = voteAt(cen, t), ans = t >= T_SCORE ? voteAt(cen, T_SCORE) : null;
      R.step.b.textContent = t + ' / ' + T_MAX;
      R.living.b.textContent = state.rule === 'tissue' ? cen.living + ' of ' + sim.d.n : String(cen.living);
      R.now.b.textContent = v.vote < 0 ? 'none' : names[v.vote];
      R.agree.b.textContent = v.vote < 0 ? '–' : pct(v.share, 0);
      R.ans.b.textContent = !cen.living ? 'none' : ans ? names[ans.vote] : '…';
      var lab = state.label;
      R.truth.b.textContent = state.rule === 'untrained' ? (state.digit >= 0 ? 'digit ' + state.digit : 'none')
        : lab >= 0 ? names[lab] + (state.src === 'moved' ? ' (moved)' : '') : 'none';

      var vt = 'na', txt, wait = state.playing ? 'Running…' : 'Paused before step 30';
      if (!sim.d.n) txt = 'No ink to read';
      else if (!cen.living) txt = 'No living cells';
      else if (state.rule === 'untrained') txt = ans ? 'Bin ' + ans.vote + ', no read-out' : wait;
      else if (lab < 0) txt = ans ? 'Says ' + names[ans.vote] + '; no label' : wait;
      else if (!ans) txt = wait;
      else if (ans.vote === lab) { txt = 'Right'; vt = 'ok'; }
      else { txt = 'Wrong'; vt = 'bad'; }
      verdict.textContent = txt; verdict.className = 'verdict ' + vt;
      sub.textContent = state.src === 'drawn'
        ? 'A drawing is out of distribution: the rules only ever saw centred MNIST digits.'
        : state.src === 'moved' ? 'Moved off its usual position; the label still holds.' : '';

      var nInk = 0, i;
      for (i = 0; i < N; i++) nInk += state.ink[i];
      inkLine.textContent = TASK[state.rule].only01
        ? 'Ink cells: ' + nInk + '. The ink count alone, with a threshold fitted on training digits (more than 91 cells → “0”), says “'
          + (nInk > ink01 ? '0' : '1') + '”; on the 416 test 0s and 1s that one number scores 92.8%.'
        : 'Ink cells: ' + nInk + '.';

      drawChart(kit, svg, tip, sim, t, names);
      if (!state.playing) bPlay.textContent = t >= T_MAX ? 'Replay' : 'Play';
    }

    // the tissue's usual vote per site over the sample 0s and 1s, at step 30;
    // the current digit's ink is drawn at full strength on top of it
    var mapShare = null;
    function computeMap() {
      var ones = new Float64Array(N), seen = new Float64Array(N), spec = ruleSpec();
      samples().forEach(function (d) {
        var sim = simulate(spec, d.ink, 1, T_SCORE), c;
        for (c = 0; c < sim.d.n; c++) {
          if (!sim.live[c]) continue;
          var i = sim.d.alive[c];
          seen[i]++; ones[i] += cls(sim.hist[T_SCORE * sim.d.n + c], 2);
        }
      });
      mapShare = new Float64Array(N);
      for (var i = 0; i < N; i++) mapShare[i] = seen[i] ? ones[i] / seen[i] : -1;
    }
    function drawMap() {
      if (!mapShare) computeMap();
      var has = D.tissue.has, a = RGB2[0], b = RGB2[1];
      kit.draw(cvMap, W, W, function (i, rgb) {
        var on = state.ink[i], f = on ? 1 : 0.42, s = mapShare[i], c;
        if (!has[i]) c = on ? NOAG : VOID;
        else if (s < 0) c = on ? [120, 118, 134] : NOAG;
        else c = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
        rgb[0] = c === VOID ? c[0] : c[0] * f; rgb[1] = c === VOID ? c[1] : c[1] * f; rgb[2] = c === VOID ? c[2] : c[2] * f;
      });
    }

    /* ---------- the sample grid ---------- */

    var tileCls = {};
    function storeTile(k, sim) {
      var out = new Int8Array(N), ans = voteAt(sim.cen, T_SCORE), lab = TASK[state.rule].label(D.digits[k].label);
      classMap(sim, T_SCORE, out);
      tileCls[k] = out;
      state.tiles[k] = { vote: ans.vote, ok: lab >= 0 && ans.vote === lab };
      grid.draw(k);
    }
    function runTile(k) {
      if (state.tiles[k]) return;
      storeTile(k, simulate(ruleSpec(), D.digits[k].ink, 1, T_SCORE));
    }
    var DIM = rgbOf(COL.inkDim);
    var grid = TileGrid(cvTiles, kit, {
      pixel: function (k, i, rgb) {
        var c;
        if (state.tiles[k]) {
          var m = tileCls[k][i], cols = rgbFor(TASK[state.rule].K);
          c = m >= 0 ? cols[m] : m === -1 ? NOAG : VOID;
        } else c = D.digits[k].ink[i] ? DIM : VOID;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      },
      mark: function (k) {
        var r = state.tiles[k];
        return r && state.rule !== 'untrained' && !r.ok ? kit.css('--gcvp') : null;
      },
      pick: function (k) { loadSample(D.digits[k]); }
    });
    function layoutGrid() {
      var list = samples(), secs = [], y;
      for (y = 0; y < 10; y++) {
        var items = list.filter(function (d) { return d.label === y; }).map(function (d) { return d.k; });
        if (items.length) secs.push({ label: String(y), items: items });
      }
      grid.layout(secs, 'rows');
      grid.setCurrent(state.idx);
    }
    function updateTally() {
      var list = samples(), done = 0, ok = 0, bins = {}, nb = 0;
      list.forEach(function (d) {
        var r = state.tiles[d.k];
        if (!r) return;
        done++; if (r.ok) ok++;
        if (!bins[r.vote]) { bins[r.vote] = 1; nb++; }
      });
      bAll.disabled = state.queue.length > 0 || done === list.length;
      if (!done) { tally.textContent = 'Not run yet: play a digit past step 30, or run them all.'; return; }
      if (state.rule === 'untrained') {
        tally.innerHTML = '<b>' + done + '</b> of ' + list.length + ' run; they use <b>' + nb + '</b> chemistry bin' + (nb === 1 ? '' : 's') + '.';
      } else {
        tally.innerHTML = '<b>' + ok + ' of ' + done + '</b> right (' + pct(ok / done, 1) + ')'
          + (done < list.length ? ', ' + done + ' of ' + list.length + ' run' : '') + '.';
      }
    }
    function tileNoteText() {
      var n = samples().length, r = state.rule;
      var base = 'Click a digit to load it. After a run each cell shows its vote at step 30';
      if (r === 'untrained') return base + ' (its chemistry bin). ' + n + ' embedded test digits.';
      return base + '; a red frame marks a wrong answer. These ' + n + ' embedded digits are a sample: the measured figure above is on '
        + (TASK[r].only01 ? 'all 416 test 0s and 1s' : '2,000 test digits') + '.';
    }
    bAll.addEventListener('click', function () {
      state.queue = samples().map(function (d) { return d.k; }).filter(function (k) { return !state.tiles[k]; });
      if (state.queue.length) bAll.disabled = true;
    });

    /* ---------- wiring ---------- */

    function ruleChanged() {
      state.tiles = {}; tileCls = {}; state.queue = []; bAll.disabled = false; mapShare = null;
      figMap.style.display = state.rule === 'tissue' ? '' : 'none';
      cvrow.className = 'cvrow ' + (state.rule === 'tissue' ? 'mn-c4' : 'mn-c3');
      note.textContent = noteText();
      var T = TASK[state.rule];
      legend(legendHost, T.K, T.names, state.rule === 'tissue' ? [[COL.noAgent, 'ink, no agent']] : []);
      if (state.src === 'sample' && state.idx >= 0) {
        var d = D.digits[state.idx];
        if (T.only01 && d.label > 1) { layoutGrid(); pickNext(); finishRule(); return; }
        state.label = T.label(d.label);
      } else if (state.digit >= 0) state.label = T.label(state.digit);
      layoutGrid();
      restart(true);
      finishRule();
    }
    function finishRule() { updateTally(); tileNote.textContent = tileNoteText(); }
    function setRule(key) {
      if (key !== state.rule) { state.run = 0; state.shuffled = false; state.tissueG = null; }
      state.rule = key;
      pills.set(key);
      buildRow2();
      ruleChanged();
    }

    bNext.addEventListener('click', pickNext);
    bClear.addEventListener('click', function () {
      state.ink = new Uint8Array(N); edited('drawn'); setPlaying(false); restart(false);
    });
    bCentre.addEventListener('click', centre);
    bPlay.addEventListener('click', function () { setPlaying(!state.playing); render(); });
    bStep.addEventListener('click', function () { setPlaying(false); advance(); });
    bRestart.addEventListener('click', function () { state.t = 0; render(); });

    document.addEventListener('themechange', function () { render(); grid.drawAll(); });
    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (root.hidden) return; grid.resize(); render(); }, 150);
    });

    // start: run A of 0 vs 1 on a sample 1, where the "1" state floods along the stroke
    buildRow2();
    var first = D.digits.filter(function (d) { return d.label === 1; })[0];
    state.ink = first.ink.slice(); state.digit = 1; state.label = 1; state.idx = first.k;
    ruleChanged();

    return {
      frame: frame,
      redraw: function () { grid.resize(); render(); }
    };
  }
})();
