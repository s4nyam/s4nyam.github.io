/* ==========================================================
   Self-Replicating Neural Cellular Automata project page

   Sources for everything on this page:
   - SONCA_RUNS (assets/data/runs.js) holds the 24 long runs.
     Every series is recovered from the vector plots published
     with the paper and resampled onto a 5-generation grid;
     the bands are the five-fold min-max envelopes drawn there.
   - The substrate in the hero and in section 3 is a port of
     nca.py: same liveness gate, same birth-only mutation, same
     post-scan squash / threshold / budget order, same GHC and
     RWSP colourings. It is labelled Live because it runs here;
     it is a demonstration of the rule, not a rerun of the paper.
   - The agent explorer, the metric sandbox and the genome probe
     are built for this page and badged Illustration. Their
     formulas are the paper's; their inputs are yours.
   ========================================================== */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';
  var D = window.SONCA_RUNS;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmt(v, d) { return Number(v).toFixed(d === undefined ? 2 : d); }
  function group(root, attr, fn) {
    var btns = $$('button[' + attr + ']', root);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
        fn(b.getAttribute(attr), b);
      });
    });
  }
  function tipAt(tip, svg, vbW, vbH, x, y, html) {
    var box = svg.getBoundingClientRect(), wrap = svg.parentNode.getBoundingClientRect();
    tip.innerHTML = html;
    var px = box.left - wrap.left + x * box.width / vbW;
    var tw = tip.offsetWidth || 170;
    px = Math.max(tw / 2 + 4, Math.min(wrap.width - tw / 2 - 4, px));
    tip.style.left = px + 'px';
    tip.style.top = (box.top - wrap.top + y * box.height / vbH) + 'px';
    tip.classList.add('on');
  }
  function hideTip(tip) { tip.classList.remove('on'); }
  // '#rrggbb' -> 'rgba(...)'. Needed because a CSS custom property cannot be
  // alpha-adjusted directly, and the min-max bands are translucent.
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
  }

  /* ==========================================================
     The substrate. A port of nca.py's update_ca, one generation
     per step(). Typed arrays replace one nn.Module per pixel;
     nothing else about the rule is changed.
     ========================================================== */

  var P = 44;                 // parameters per agent: 36 + 2 + 4 + 2
  var XA1 = Math.sqrt(6 / 20); // xavier_uniform bound, fc1 (18 -> 2)
  var XA2 = Math.sqrt(6 / 4);  // xavier_uniform bound, fc2 (2 -> 2)

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

  // One deterministic bit per rounded weight. nca.py uses Python's hash() of
  // the rounded, scaled value; any deterministic per-value bit preserves what
  // GHC measures, so a small integer hash stands in for it here.
  function geneBit(w) {
    var n = Math.round(w * 100) | 0;
    n = (n ^ 61) ^ (n >>> 16);
    n = (n + (n << 3)) | 0;
    n ^= n >>> 4;
    n = Math.imul(n, 0x27d4eb2d);
    n ^= n >>> 15;
    return n & 1;
  }

  function NCA(opts) {
    var s = {};
    s.act = opts.act || 'sigmoid';
    s.alpha = s.act === 'sigmoid' ? 0.5 : 0;
    s.ip = opts.ip;
    s.ppp = opts.ppp;
    s.budget = opts.budget;          // Infinity for no mortality
    s.gen = 0;

    s.resize = function (W) {
      s.W = W; s.H = W; s.N = W * W;
      s.st = new Float32Array(2 * s.N);
      s.nx = new Float32Array(2 * s.N);
      s.g = new Float32Array(P * s.N);
      s.has = new Uint8Array(s.N);
      s.bud = new Int32Array(s.N);
      s.inh = new Uint8Array(s.N);
      s.loci = [0, 0, 0];
    };

    s.seed = function (initProb) {
      var i, k, n = s.N;
      s.st.fill(0); s.nx.fill(0); s.g.fill(0); s.has.fill(0); s.bud.fill(0);
      s.gen = 0;
      // three weight indices fixed for the whole run, as RWSP requires
      var pick = [];
      while (pick.length < 3) {
        var c = (Math.random() * P) | 0;
        if (pick.indexOf(c) < 0) pick.push(c);
      }
      s.loci = pick;
      // founders are placed uniformly at random and given xavier weights
      var want = Math.max(1, Math.round(n * initProb));
      var placed = 0, guard = 0;
      while (placed < want && guard++ < n * 40) {
        var idx = (Math.random() * n) | 0;
        if (s.has[idx]) continue;
        s.has[idx] = 1;
        var v = s.alpha + (1 - s.alpha) * 1;      // random_tensor is torch.ones
        s.st[idx] = v; s.st[n + idx] = v;
        var base = idx * P;
        for (k = 0; k < 36; k++) s.g[base + k] = (Math.random() * 2 - 1) * XA1;
        for (k = 38; k < 42; k++) s.g[base + k] = (Math.random() * 2 - 1) * XA2;
        // biases stay zero, as nn.init.zeros_ leaves them
        placed++;
      }
      return s;
    };

    var nb = new Float32Array(18);
    var hid = new Float32Array(2);
    var liveN = new Int32Array(9);

    s.step = function () {
      var W = s.W, H = s.H, n = s.N, st = s.st, nx = s.nx, g = s.g;
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
                var sel = liveN[(Math.random() * cnt) | 0] * P;
                var dst = idx * P;
                if (!s.has[idx]) {
                  // the cell was dead: this is a birth, so copy AND mutate
                  for (k = 0; k < P; k++) g[dst + k] = g[sel + k];
                  for (k = 0; k < 36; k++) if (Math.random() < ppp) g[dst + k] += Math.random() * 2 - 1;
                  for (k = 38; k < 42; k++) if (Math.random() < ppp) g[dst + k] += Math.random() * 2 - 1;
                  s.has[idx] = 1;
                  s.inh[idx] = 1;
                } else {
                  // already alive: nca.py deep-copies without perturbing
                  for (k = 0; k < P; k++) g[dst + k] = g[sel + k];
                }
              }
            }
          } else {
            base = idx * P;
            for (k = 0; k < P; k++) g[base + k] = 0;
            s.has[idx] = 0;
          }
          nx[idx] = o0; nx[n + idx] = o1;
        }
      }

      // squash the whole board, then threshold on alpha
      for (k = 0; k < 2 * n; k++) nx[k] = tanhAct ? Math.tanh(nx[k]) : sigmoid(nx[k]);
      for (idx = 0; idx < n; idx++) {
        if (nx[idx] <= alpha) { nx[idx] = 0; nx[n + idx] = 0; }
      }
      // budget: count a generation for every living cell, clear it for the rest
      for (idx = 0; idx < n; idx++) {
        if (Math.round(nx[idx] * 10) / 10 > alpha) s.bud[idx]++;
        else s.bud[idx] = 0;
      }
      if (isFinite(s.budget)) {
        for (idx = 0; idx < n; idx++) {
          if (s.bud[idx] > s.budget) { s.bud[idx] = 0; nx[idx] = 0; nx[n + idx] = 0; }
        }
      }
      // a zero counter means dead; clear the agent too, unless it was just
      // inherited — those keep their genome so they can be born next step
      for (idx = 0; idx < n; idx++) {
        if (s.bud[idx] === 0) {
          nx[idx] = 0; nx[n + idx] = 0;
          if (!s.inh[idx]) {
            base = idx * P;
            for (k = 0; k < P; k++) g[base + k] = 0;
            s.has[idx] = 0;
          }
        }
      }

      s.st = nx; s.nx = st;
      s.gen++;
      return s;
    };

    // zero a disc of cells, state and agent together: the paper's annihilation
    // kernel. Recovery can then only come from inheritance across the rim.
    s.wound = function (ci, cj, r) {
      var W = s.W, n = s.N, di, dj, k;
      for (di = -r; di <= r; di++) {
        for (dj = -r; dj <= r; dj++) {
          if (di * di + dj * dj > r * r) continue;
          var idx = ((ci + di + W) % W) * W + ((cj + dj + W) % W);
          s.st[idx] = 0; s.st[n + idx] = 0;
          s.bud[idx] = 0; s.has[idx] = 0; s.inh[idx] = 0;
          for (k = 0; k < P; k++) s.g[idx * P + k] = 0;
        }
      }
    };

    s.ghc = function (idx) {
      var base = idx * P, r = 0, gg = 0, b = 0, k;
      for (k = 0; k < 8; k++) r = (r << 1) | geneBit(s.g[base + k]);
      for (k = 8; k < 16; k++) gg = (gg << 1) | geneBit(s.g[base + k]);
      for (k = 16; k < 24; k++) b = (b << 1) | geneBit(s.g[base + k]);
      return [r, gg, b];
    };

    s.rwsp = function (idx) {
      var base = idx * P, out = [0, 0, 0], k;
      for (k = 0; k < 3; k++) {
        var w = Math.round(s.g[base + s.loci[k]] * 10) / 10;
        var v = Math.trunc(w * 255) % 256;
        out[k] = v < 0 ? v + 256 : v;      // np.uint8 wraps rather than clips
      }
      return out;
    };

    s.resize(opts.W || 96);
    s.seed(opts.init === undefined ? 0.08 : opts.init);
    return s;
  }

  // magma, sampled at 12 stops — the colormap the paper's grids are drawn in
  var MAGMA = [[0, 0, 4], [24, 15, 61], [68, 15, 118], [114, 31, 129], [158, 47, 127],
  [205, 64, 113], [240, 96, 93], [251, 147, 84], [254, 194, 106], [252, 236, 151],
  [253, 253, 191], [255, 255, 224]];
  function magma(t) {
    if (t <= 0) return [0, 0, 0];
    var x = Math.min(0.999, t) * (MAGMA.length - 1);
    var i = x | 0, f = x - i, a = MAGMA[i], b = MAGMA[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function paint(cv, s, mode) {
    var ctx = cv.getContext('2d');
    if (cv.width !== s.W) { cv.width = s.W; cv.height = s.H; }
    var img = ctx.createImageData(s.W, s.H), d = img.data, n = s.N, i, c;
    for (i = 0; i < n; i++) {
      var o = i * 4;
      var alive = s.st[i] > s.alpha;
      if (mode === 'alpha' || mode === 'chem') {
        var v = mode === 'alpha' ? s.st[i] : s.st[n + i];
        // tanh runs put live states on (alpha, 1]; rescale both onto [0,1]
        var t = alive ? (v - s.alpha) / (1 - s.alpha) : 0;
        c = magma(t);
      } else if (!alive) {
        c = [0, 0, 0];
      } else {
        c = mode === 'ghc' ? s.ghc(i) : s.rwsp(i);
      }
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------------- shared metric maths (as the paper defines them) -------

     All four phenotypic tools coarse-grain the same way — round the cell state
     to one decimal — so they share one histogram. States live in [-1, 1], which
     at that precision is 21 bins; binning once and working from counts avoids a
     sort and a string-keyed map on every generation.
     ------------------------------------------------------------------------ */

  var BINS = 21;                               // -1.0 .. 1.0 in steps of 0.1
  function binOf(v) { return (Math.round(v * 10) + 10) | 0; }
  function binVal(b) { return (b - 10) / 10; }

  // |Sigma| is fixed by the rounding precision and the activation: the dead
  // state plus {0.6..1.0} for sigmoid, plus {0.1..1.0} for tanh.
  function sigmaSize(act) { return act === 'tanh' ? 11 : 6; }

  var _hist = new Int32Array(BINS);
  function histOf(vals, n, out) {
    out = out || _hist;
    out.fill(0);
    for (var i = 0; i < n; i++) out[binOf(vals[i])]++;
    return out;
  }

  function gepFrom(hist, n, sigma) {
    var h = 0, b, p;
    for (b = 0; b < BINS; b++) {
      if (!hist[b]) continue;
      p = hist[b] / n;
      h += -p * Math.log(p);
    }
    return h / Math.log(sigma);
  }

  // the k-th order statistic (0-based), read off the cumulative counts
  function nth(hist, k) {
    var cum = 0, b;
    for (b = 0; b < BINS; b++) {
      cum += hist[b];
      if (cum > k) return binVal(b);
    }
    return binVal(BINS - 1);
  }

  function gcvpFrom(hist, n) {
    var med = n % 2
      ? nth(hist, (n - 1) / 2)
      : (nth(hist, n / 2 - 1) + nth(hist, n / 2)) / 2;
    med = Math.round(med * 10) / 10;
    var mb = binOf(med);
    var same = (mb >= 0 && mb < BINS) ? hist[mb] : 0;
    return Math.sqrt((n - same) / n);
  }

  var _field = null, _loc = null;
  function clogvFrom(hist, vals, n, W, H) {
    var fmin = Infinity, fmax = -Infinity, b;
    for (b = 0; b < BINS; b++) {
      if (!hist[b]) continue;
      if (hist[b] < fmin) fmin = hist[b];
      if (hist[b] > fmax) fmax = hist[b];
    }
    var norm = new Float64Array(BINS), span = fmax - fmin;
    for (b = 0; b < BINS; b++) norm[b] = span ? (hist[b] - fmin) / span : 0;

    if (!_field || _field.length < n) { _field = new Float64Array(n); _loc = new Float64Array(n); }
    var i;
    for (i = 0; i < n; i++) _field[i] = norm[binOf(vals[i])];

    var a, c, di, dj;
    for (a = 0; a < W; a++) {
      for (c = 0; c < H; c++) {
        var sum = 0, sq = 0;
        for (di = -1; di <= 1; di++) {
          var ai = (a + di + W) % W;
          for (dj = -1; dj <= 1; dj++) {
            var v = _field[ai * W + ((c + dj + H) % H)];
            sum += v; sq += v * v;
          }
        }
        var mu = sum / 9;
        _loc[a * W + c] = Math.sqrt(Math.max(0, sq / 9 - mu * mu));
      }
    }
    var gs = 0, gq = 0;
    for (i = 0; i < n; i++) { gs += _loc[i]; gq += _loc[i] * _loc[i]; }
    var gm = gs / n;
    return Math.sqrt(Math.max(0, gq / n - gm * gm));
  }

  function uniqueColours(s, which) {
    var seen = new Set(), i;
    for (i = 0; i < s.N; i++) {
      if (s.st[i] <= s.alpha) continue;
      var v = which === 'ghc' ? s.ghc(i) : s.rwsp(i);
      seen.add((v[0] << 16) | (v[1] << 8) | v[2]);
    }
    return seen.size;
  }

  /* ---------------- chrome: theme, nav, lightbox, bibtex ---------------- */

  $('#themeToggle').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { }
    document.dispatchEvent(new CustomEvent('themechange'));
  });

  if ('IntersectionObserver' in window) {
    var navLinks = $$('#topnav a');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('section[id]').forEach(function (sec) { io.observe(sec); });
  }

  (function () {
    var lb = $('#lightbox'), lbImg = $('#lightboxImg');
    function zoom(src, alt) { lbImg.src = src; lbImg.alt = alt || ''; lb.classList.add('on'); }
    lb.addEventListener('click', function () { lb.classList.remove('on'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('on'); });
    document.addEventListener('click', function (e) {
      var im = e.target;
      if (im.tagName !== 'IMG') return;
      if (im.closest('figure.fig') || im.closest('.runshots')) zoom(im.src, im.alt);
    });
  })();

  $('#copyBib').addEventListener('click', function () {
    var txt = $('#bibtex').textContent, msg = $('#copiedMsg');
    function done() { msg.classList.add('on'); setTimeout(function () { msg.classList.remove('on'); }, 1600); }
    if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(done, done); }
    else {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta); done();
    }
  });

  /* ---------------- hero: the substrate in its three views ---------------- */

  (function () {
    var cvA = $('#heroAlpha'), cvG = $('#heroGhc'), cvR = $('#heroRwsp');
    var genOut = $('#heroGen'), playBtn = $('#heroPlay');
    var sim = NCA({ W: 120, init: 0.06, ip: 0.10, ppp: 0.02, budget: 4, act: 'sigmoid' });
    var running = !reduceMotion, last = 0, raf = null;

    function draw() {
      paint(cvA, sim, 'alpha'); paint(cvG, sim, 'ghc'); paint(cvR, sim, 'rwsp');
      genOut.textContent = 'generation ' + sim.gen;
    }
    function loop(t) {
      raf = requestAnimationFrame(loop);
      if (!running || t - last < 90) return;
      last = t;
      // a long-dead grid is not worth watching; restart it
      var alive = 0, i;
      for (i = 0; i < sim.N; i += 7) if (sim.st[i] > sim.alpha) alive++;
      if (sim.gen > 20 && alive === 0) sim.seed(0.06);
      sim.step();
      draw();
    }
    playBtn.addEventListener('click', function () {
      running = !running;
      playBtn.textContent = running ? 'Pause' : 'Play';
    });
    $('#heroSeed').addEventListener('click', function () { sim.seed(0.06); draw(); });

    draw();
    if (reduceMotion) playBtn.textContent = 'Play';
    raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
      else if (!raf) raf = requestAnimationFrame(loop);
    });
  })();

  /* ---------------- 1. run one agent by hand ---------------- */

  (function () {
    var gridEl = $('#nbGrid'), geneEl = $('#agentGenes'), eqEl = $('#agentEq');
    var verdict = $('#agentVerdict'), body = $('#agentBody');
    var chan = 0;
    var nbv = [new Float64Array(9), new Float64Array(9)];
    var gene = new Float64Array(P);
    var ALPHA = 0.5;

    function fresh() {
      var k;
      for (k = 0; k < 36; k++) gene[k] = (Math.random() * 2 - 1) * XA1;
      for (k = 36; k < 38; k++) gene[k] = 0;
      for (k = 38; k < 42; k++) gene[k] = (Math.random() * 2 - 1) * XA2;
      for (k = 42; k < 44; k++) gene[k] = 0;
    }
    function seedNb() {
      for (var k = 0; k < 9; k++) {
        var on = Math.random() < 0.45;
        nbv[0][k] = on ? 0.6 + Math.random() * 0.4 : 0;
        nbv[1][k] = on ? 0.6 + Math.random() * 0.4 : 0;
      }
      nbv[0][4] = 0.8; nbv[1][4] = 0.7;
    }

    function forward() {
      var h = [0, 0], k, m;
      for (k = 0; k < 2; k++) {
        var acc = gene[36 + k];
        for (m = 0; m < 18; m++) acc += gene[k * 18 + m] * (m < 9 ? nbv[0][m] : nbv[1][m - 9]);
        h[k] = sigmoid(acc);
      }
      return [
        sigmoid(gene[42] + gene[38] * h[0] + gene[39] * h[1]),
        sigmoid(gene[43] + gene[40] * h[0] + gene[41] * h[1]),
        h
      ];
    }

    function buildGrid() {
      clear(gridEl);
      for (var k = 0; k < 9; k++) {
        (function (k) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'nbcell' + (k === 4 ? ' centre' : '');
          b.setAttribute('aria-label', 'Neighbour ' + (k + 1) + ', click to change its value');
          b.addEventListener('click', function () {
            var v = nbv[chan][k];
            nbv[chan][k] = v === 0 ? 0.6 : (v >= 0.95 ? 0 : Math.round((v + 0.1) * 10) / 10);
            render();
          });
          gridEl.appendChild(b);
        })(k);
      }
    }

    function render() {
      var cells = $$('.nbcell', gridEl), k;
      for (k = 0; k < 9; k++) {
        var v = nbv[chan][k];
        var c = magma(v > ALPHA ? (v - ALPHA) / (1 - ALPHA) : 0);
        cells[k].style.background = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
        cells[k].textContent = v > 0 ? v.toFixed(1) : '';
        cells[k].style.color = v > 0.75 ? '#1a1206' : '#fff';
      }

      clear(geneEl);
      for (k = 0; k < P; k++) {
        var i = document.createElement('i');
        var w = gene[k];
        var t = Math.max(0, Math.min(1, (w + 1.4) / 2.8));
        var g = magma(t);
        i.style.background = 'rgb(' + (g[0] | 0) + ',' + (g[1] | 0) + ',' + (g[2] | 0) + ')';
        if (k >= 36 && k < 38 || k >= 42) i.style.opacity = '.32';
        i.title = (k < 36 ? 'fc1.w[' + k + ']' : k < 38 ? 'fc1.b (fixed)' : k < 42 ? 'fc2.w' : 'fc2.b (fixed)')
          + ' = ' + w.toFixed(3);
        geneEl.appendChild(i);
      }

      var out = forward();
      eqEl.textContent =
        'h  = sigmoid(W₁x + b₁) = [' + fmt(out[2][0], 3) + ', ' + fmt(out[2][1], 3) + ']\n' +
        'y  = sigmoid(W₂h + b₂) = [' + fmt(out[0], 3) + ', ' + fmt(out[1], 3) + ']\n' +
        'α  = ' + fmt(out[0], 3) + '  vs threshold 0.5';

      var anyLive = false;
      for (k = 0; k < 9; k++) if (nbv[0][k] > ALPHA || nbv[1][k] > ALPHA) anyLive = true;

      if (!anyLive) {
        verdict.textContent = 'Dead, and unreachable.';
        verdict.style.color = css('--text-mute');
        body.textContent = 'No value in the neighbourhood exceeds α, so the liveness gate fires before '
          + 'the agent is ever run. State and weights are both zeroed, and nothing can reach this cell until '
          + 'a neighbour comes back to life.';
      } else if (out[0] > ALPHA) {
        verdict.textContent = 'Alive, at ' + fmt(out[0], 2) + '.';
        verdict.style.color = css('--alive');
        body.textContent = 'The agent returns an above-threshold α, so the cell survives into the next '
          + 'generation carrying this state. Rounded to one decimal it belongs to type '
          + (Math.round(out[0] * 10) / 10).toFixed(1) + ' — one of the six labels CTFP counts.';
      } else {
        verdict.textContent = 'Dies this step.';
        verdict.style.color = css('--gcvp');
        body.textContent = 'A living neighbour let the agent run, but its output falls at or below α, so '
          + 'the post-scan threshold clears the cell. This is the only selective filter in the substrate: a '
          + 'genome that cannot clear the threshold removes itself.';
      }
    }

    group($('.chanpick'), 'data-chan', function (v) { chan = +v; render(); });
    $('#agentMutate').addEventListener('click', function () {
      for (var k = 0; k < 42; k++) {
        if (k >= 36 && k < 38) continue;
        if (Math.random() < 0.2) gene[k] += Math.random() * 2 - 1;
      }
      render();
    });
    $('#agentFresh').addEventListener('click', function () { fresh(); seedNb(); render(); });
    document.addEventListener('themechange', render);

    buildGrid(); fresh(); seedNb(); render();
  })();

  /* ---------------- 2. step through the update rule ---------------- */

  (function () {
    var svg = $('#ruleSvg'), list = $('#ruleSteps'), kicker = $('#ruleKicker'), body = $('#ruleBody');
    var countEl = $('#ruleCount');
    var step = 0;

    var TEXT = [
      ['Liveness gate', 'A cell with no living neighbour cannot be reached by inheritance, so it is cleared '
        + 'outright — state and weights together. The test looks at all nine positions in both channels, '
        + 'and a cell counts as one of its own neighbours.'],
      ['Output', 'The agent reads the flattened 3×3×2 neighbourhood and returns two values. This '
        + 'happens before the inheritance branch, so the state written this generation comes from the genome '
        + 'the cell held at the start of the step.'],
      ['Inheritance', 'With probability ip the cell picks one living neighbour uniformly at random and '
        + 'deep-copies its network. Nothing about the choice depends on how well that neighbour is doing; '
        + 'the only filter anywhere in the substrate is whether a cell clears α.'],
      ['Mutation', 'Each of the 40 weights is perturbed with probability ppp by noise drawn uniformly on '
        + '[−1, 1]. Bounded support is the point: every mutation moves a weight by at most 1, so the rare '
        + 'very large jumps a Gaussian tail permits cannot occur. In the released code this branch runs only '
        + 'when the cell was dead — mutation happens at birth.'],
      ['Life budget', 'A per-cell counter increments each generation a cell is alive and resets when it dies. '
        + 'At budget b the cell is forced to die and its counter resets. Cells that have just inherited a '
        + 'genome are protected, so a newly seeded genome survives to be born next step.']
    ];

    function draw() {
      clear(svg);
      var cA = css('--alive'), cR = css('--rule-strong'), cN = css('--navy'), cG = css('--gcvp'),
        cC = css('--chem'), cP = css('--panel'), cT = css('--text-soft');
      var ox = 24, oy = 60, cs = 46;

      var defs = el('defs');
      var mk = el('marker', {
        id: 'rarw', viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      });
      mk.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: cR }));
      defs.appendChild(mk); svg.appendChild(defs);

      svg.appendChild(el('text', { x: ox, y: 34, class: 'axistext' },
        step === 4 ? 'the cell, generation by generation' : 'the 3 × 3 neighbourhood at (i, j)'));

      // which neighbours are drawn as alive in this illustration
      var live = [1, 3, 5, 8];
      var r, c, i;
      for (r = 0; r < 3; r++) {
        for (c = 0; c < 3; c++) {
          i = r * 3 + c;
          var isC = i === 4;
          var alive = live.indexOf(i) >= 0;
          var fill = cP;
          if (step === 0) fill = alive ? cA : cP;
          else if (alive) fill = cA;
          if (isC) fill = step >= 3 ? cC : (step >= 1 ? cA : cP);
          svg.appendChild(el('rect', {
            x: ox + c * cs, y: oy + r * cs, width: cs - 4, height: cs - 4,
            fill: fill, stroke: isC ? cN : cR, 'stroke-width': isC ? 2.4 : 1.2
          }));
        }
      }
      svg.appendChild(el('text', { x: ox + cs + (cs - 4) / 2, y: oy + cs + 28, class: 'axistext', 'text-anchor': 'middle' }, '(i, j)'));

      // the selected neighbour, once inheritance is on screen
      if (step >= 2) {
        svg.appendChild(el('rect', {
          x: ox + 2 * cs - 2, y: oy - 2, width: cs, height: cs,
          fill: 'none', stroke: css('--ghc'), 'stroke-width': 2.6, 'stroke-dasharray': '4 3'
        }));
        svg.appendChild(el('path', {
          d: 'M' + (ox + 2 * cs + 18) + ',' + (oy + 20) + ' C 250,' + (oy + 10) + ' 250,' + (oy + 70) + ' ' + (ox + cs + 26) + ',' + (oy + cs + 10),
          fill: 'none', stroke: css('--ghc'), 'stroke-width': 1.8, 'marker-end': 'url(#rarw)'
        }));
      }

      // the right-hand panel: what the step produces
      var px = 232;
      svg.appendChild(el('rect', { x: px, y: 54, width: 168, height: 168, fill: cP, stroke: cR, 'stroke-width': 1.4 }));
      var label = ['state = 0\nagent = [0 … 0]', 'y = W₂ · act(W₁x + b₁) + b₂',
        'agent ← deepcopy(neighbour)', 'w += U(−1, 1)  with prob ppp', 'counter += 1   → b ?  die'][step];
      var lines = label.split('\n');
      for (i = 0; i < lines.length; i++) {
        svg.appendChild(el('text', {
          x: px + 84, y: 112 + i * 20, 'text-anchor': 'middle',
          class: 'serieslabel', 'font-family': 'ui-monospace, Menlo, monospace', 'font-size': 12
        }, lines[i]));
      }
      svg.appendChild(el('text', { x: px + 84, y: 78, class: 'axistext', 'text-anchor': 'middle' }, 'step ' + (step + 1)));

      if (step === 3) {
        // the 40 mutable weights, a few of them struck
        for (i = 0; i < 40; i++) {
          var hit = (i % 7) === 3;
          svg.appendChild(el('rect', {
            x: px + 12 + (i % 20) * 7.6, y: 146 + ((i / 20) | 0) * 14, width: 6, height: 11,
            fill: hit ? cG : cT, opacity: hit ? 1 : .35
          }));
        }
        svg.appendChild(el('text', { x: px + 84, y: 194, class: 'axistext', 'text-anchor': 'middle' }, '40 mutable weights'));
      }
      if (step === 4) {
        for (i = 0; i < 6; i++) {
          svg.appendChild(el('rect', {
            x: px + 16 + i * 24, y: 150, width: 18, height: 18,
            fill: i < 4 ? cA : cP, stroke: cR, 'stroke-width': 1.1
          }));
          svg.appendChild(el('text', { x: px + 25 + i * 24, y: 186, class: 'axistext', 'text-anchor': 'middle' }, i + 1));
        }
        svg.appendChild(el('text', { x: px + 84, y: 206, class: 'axistext', 'text-anchor': 'middle' }, 'b = 4'));
      }
    }

    function set(n) {
      step = Math.max(0, Math.min(TEXT.length - 1, n));
      $$('li', list).forEach(function (li, i) { li.setAttribute('aria-current', i === step); });
      kicker.textContent = TEXT[step][0];
      body.textContent = TEXT[step][1];
      countEl.textContent = 'Step ' + (step + 1) + ' of ' + TEXT.length;
      draw();
    }

    $$('li', list).forEach(function (li) {
      li.addEventListener('click', function () { set(+li.getAttribute('data-step')); });
    });
    $('#rulePrev').addEventListener('click', function () { set(step - 1); });
    $('#ruleNext').addEventListener('click', function () { set(step + 1); });
    document.addEventListener('themechange', draw);
    set(0);
  })();

  /* ---------------- 3. the substrate lab ---------------- */

  (function () {
    var cvA = $('#labAlpha'), cvC = $('#labChem'), cvG = $('#labGhc'), cvR = $('#labRwsp');
    var svg = $('#labChart'), tip = $('#labTip'), legendEl = $('#labLegend');
    var playBtn = $('#labPlay');
    var W = 860, H = 240, L = 54, R = 118, T = 16, B = 40;

    var PRESETS = [
      { id: 'dyn', name: 'Sparse and dynamic', init: 0.02, ip: 0.10, ppp: 0.02, budget: 4, act: 'sigmoid' },
      { id: 'full', name: 'No mortality', init: 0.02, ip: 0.10, ppp: 0.02, budget: Infinity, act: 'sigmoid' },
      { id: 'churn', name: 'High inheritance', init: 0.02, ip: 0.50, ppp: 0.02, budget: 4, act: 'sigmoid' },
      { id: 'tanh', name: 'tanh substrate', init: 0.08, ip: 0.10, ppp: 0.02, budget: Infinity, act: 'tanh' },
      { id: 'lo', name: 'Low mutation', init: 0.08, ip: 0.20, ppp: 0.02, budget: 8, act: 'sigmoid' },
      { id: 'hi', name: 'High mutation', init: 0.08, ip: 0.20, ppp: 0.80, budget: 8, act: 'sigmoid' }
    ];

    var cfg = { W: 112, init: 0.08, ip: 0.10, ppp: 0.02, budget: 4, act: 'sigmoid' };
    var sim = NCA(cfg);
    var hist = { gep: [], gcvp: [], clogv: [], ghc: [], rwsp: [], occ: [] };
    var running = !reduceMotion, raf = null, last = 0;
    var show = { gep: true, gcvp: true, clogv: true, ghc: true, rwsp: true };

    function reseed() {
      sim.act = cfg.act;
      sim.alpha = cfg.act === 'sigmoid' ? 0.5 : 0;
      sim.ip = cfg.ip; sim.ppp = cfg.ppp; sim.budget = cfg.budget;
      if (sim.W !== cfg.W) sim.resize(cfg.W);
      sim.seed(cfg.init);
      hist = { gep: [], gcvp: [], clogv: [], ghc: [], rwsp: [], occ: [] };
      render(); drawChart();
    }

    function measure() {
      var vals = sim.st, n = sim.N;
      var alive = 0, i;
      for (i = 0; i < n; i++) if (sim.st[i] > sim.alpha) alive++;
      var g = uniqueColours(sim, 'ghc'), r = uniqueColours(sim, 'rwsp');
      var hh = histOf(vals, n);
      var e = gepFrom(hh, n, sigmaSize(sim.act));
      hist.gep.push(e);
      hist.gcvp.push(gcvpFrom(hh, n));
      hist.clogv.push(clogvFrom(hh, vals, n, sim.W, sim.H));
      hist.ghc.push(g); hist.rwsp.push(r);
      hist.occ.push(alive / sim.N);
      if (hist.gep.length > 420) {
        Object.keys(hist).forEach(function (k) { hist[k].shift(); });
      }
      $('#labGen').textContent = sim.gen;
      $('#labAliveN').textContent = alive.toLocaleString();
      $('#labGhcN').textContent = g.toLocaleString();
      $('#labRwspN').textContent = r.toLocaleString();
      $('#labGep').textContent = fmt(e, 2);
      $('#labOcc').textContent = Math.round(alive / sim.N * 100) + '%';
    }

    function render() {
      paint(cvA, sim, 'alpha'); paint(cvC, sim, 'chem');
      paint(cvG, sim, 'ghc'); paint(cvR, sim, 'rwsp');
    }

    var SERIES = [
      { k: 'gep', lab: 'GEP', v: '--gep', axis: 'l' },
      { k: 'gcvp', lab: 'GCVP', v: '--gcvp', axis: 'l' },
      { k: 'clogv', lab: 'CLOGV', v: '--clogv', axis: 'l' },
      { k: 'ghc', lab: 'GHC', v: '--ghc', axis: 'r' },
      { k: 'rwsp', lab: 'RWSP', v: '--rwsp', axis: 'r' }
    ];

    function drawChart() {
      clear(svg);
      var iw = W - L - R, ih = H - T - B;
      var n = hist.gep.length;
      var maxCount = 1, i, s;
      for (i = 0; i < n; i++) maxCount = Math.max(maxCount, hist.ghc[i], hist.rwsp[i]);
      maxCount = Math.max(10, maxCount);
      var X = function (i) { return L + (n < 2 ? 0 : iw * i / (n - 1)); };
      var YL = function (v) { return T + ih * (1 - Math.max(0, Math.min(1, v))); };
      var YR = function (v) { return T + ih * (1 - v / maxCount); };

      for (i = 0; i <= 4; i++) {
        var v = i / 4, y = YL(v);
        svg.appendChild(el('line', { x1: L, x2: L + iw, y1: y, y2: y, class: i ? 'gridline' : 'gridline' }));
        svg.appendChild(el('text', { x: L - 9, y: y + 4, class: 'ticktext', 'text-anchor': 'end' }, v.toFixed(2)));
        svg.appendChild(el('text', { x: L + iw + 9, y: y + 4, class: 'ticktext' },
          Math.round(maxCount * v).toLocaleString()));
      }
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: T + ih, class: 'axisline' }));
      svg.appendChild(el('line', { x1: L, x2: L + iw, y1: T + ih, y2: T + ih, class: 'axisline' }));
      svg.appendChild(el('text', { x: L, y: H - 8, class: 'ticktext' },
        n ? 'generation ' + Math.max(0, sim.gen - n + 1) : 'generation'));
      svg.appendChild(el('text', { x: L + iw, y: H - 8, class: 'ticktext', 'text-anchor': 'end' },
        'generation ' + sim.gen));
      svg.appendChild(el('text', {
        x: 13, y: T + ih / 2, class: 'ticktext', 'text-anchor': 'middle',
        transform: 'rotate(-90 13 ' + (T + ih / 2) + ')'
      }, 'bounded metrics'));
      svg.appendChild(el('text', {
        x: W - 12, y: T + ih / 2, class: 'ticktext', 'text-anchor': 'middle',
        transform: 'rotate(-90 ' + (W - 12) + ' ' + (T + ih / 2) + ')'
      }, 'unique colours'));

      if (n < 2) return;
      SERIES.forEach(function (ser) {
        if (!show[ser.k]) return;
        var Y = ser.axis === 'l' ? YL : YR;
        var dstr = '';
        for (i = 0; i < n; i++) dstr += (i ? 'L' : 'M') + fmt(X(i), 1) + ',' + fmt(Y(hist[ser.k][i]), 1);
        svg.appendChild(el('path', {
          d: dstr, fill: 'none', stroke: css(ser.v),
          'stroke-width': ser.axis === 'r' ? 2.2 : 1.9,
          'stroke-dasharray': ser.axis === 'r' ? '' : ''
        }));
        svg.appendChild(el('text', {
          x: L + iw + 42, y: Y(hist[ser.k][n - 1]) + 4, class: 'serieslabel', fill: css(ser.v)
        }, ser.lab));
      });
    }

    function buildLegend() {
      clear(legendEl);
      SERIES.forEach(function (ser) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', show[ser.k]);
        b.innerHTML = '<i class="swatch line" style="background:var(' + ser.v + ')"></i>' + ser.lab
          + (ser.axis === 'r' ? ' <span style="opacity:.6">(right)</span>' : '');
        b.addEventListener('click', function () {
          show[ser.k] = !show[ser.k];
          b.setAttribute('aria-pressed', show[ser.k]);
          drawChart();
        });
        legendEl.appendChild(b);
      });
    }

    function loop(t) {
      raf = requestAnimationFrame(loop);
      if (!running || t - last < 70) return;
      last = t;
      sim.step(); render();
      if (sim.gen % 2 === 0) { measure(); drawChart(); }
    }

    // presets
    var pres = $('#labPresets');
    PRESETS.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = p.name;
      b.setAttribute('aria-pressed', i === 0 ? 'false' : 'false');
      b.addEventListener('click', function () {
        $$('button', pres).forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
        cfg.init = p.init; cfg.ip = p.ip; cfg.ppp = p.ppp; cfg.budget = p.budget; cfg.act = p.act;
        $('#labInit').value = p.init; $('#oLabInit').textContent = fmt(p.init, 3);
        $('#labIp').value = p.ip; $('#oLabIp').textContent = fmt(p.ip, 2);
        $('#labPpp').value = p.ppp; $('#oLabPpp').textContent = fmt(p.ppp, 2);
        $('#labBudget').value = isFinite(p.budget) ? p.budget : 21;
        $('#oLabBudget').textContent = isFinite(p.budget) ? p.budget : '∞';
        $$('button[data-act]').forEach(function (o) {
          o.setAttribute('aria-pressed', o.getAttribute('data-act') === p.act);
        });
        reseed();
      });
      pres.appendChild(b);
    });

    // ip, ppp and the budget take effect on the running grid; init_prob and the
    // grid size cannot, so those reseed — on 'change', not on every drag frame.
    function bind(id, out, key, fmtN, reseedOnChange) {
      var inp = $(id), o = $(out);
      inp.addEventListener('input', function () {
        var v = parseFloat(inp.value);
        if (key === 'budget') {
          cfg.budget = v >= 21 ? Infinity : v;
          o.textContent = v >= 21 ? '∞' : v;
          sim.budget = cfg.budget;
          return;
        }
        cfg[key] = v;
        o.textContent = fmtN(v);
        if (key === 'ip') sim.ip = v;
        else if (key === 'ppp') sim.ppp = v;
      });
      if (reseedOnChange) inp.addEventListener('change', reseed);
    }
    bind('#labInit', '#oLabInit', 'init', function (v) { return fmt(v, 3); }, true);
    bind('#labIp', '#oLabIp', 'ip', function (v) { return fmt(v, 2); });
    bind('#labPpp', '#oLabPpp', 'ppp', function (v) { return fmt(v, 2); });
    bind('#labBudget', '#oLabBudget', 'budget', function (v) { return v; });
    bind('#labSize', '#oLabSize', 'W', function (v) { return v; }, true);

    group(document, 'data-act', function (v) { cfg.act = v; reseed(); });

    playBtn.addEventListener('click', function () {
      running = !running;
      playBtn.textContent = running ? 'Pause' : 'Play';
    });
    $('#labStep').addEventListener('click', function () {
      sim.step(); render(); measure(); drawChart();
    });
    $('#labReset').addEventListener('click', reseed);

    // drag on the alpha view to annihilate a region
    (function () {
      var drawing = false;
      function hit(e) {
        var r = cvA.getBoundingClientRect();
        var ci = Math.floor((e.clientY - r.top) / r.height * sim.W);
        var cj = Math.floor((e.clientX - r.left) / r.width * sim.H);
        if (ci < 0 || cj < 0 || ci >= sim.W || cj >= sim.H) return;
        sim.wound(ci, cj, Math.max(3, Math.round(sim.W / 22)));
        render();
      }
      cvA.addEventListener('pointerdown', function (e) {
        drawing = true; cvA.setPointerCapture(e.pointerId); hit(e); e.preventDefault();
      });
      cvA.addEventListener('pointermove', function (e) { if (drawing) hit(e); });
      cvA.addEventListener('pointerup', function () { drawing = false; });
      cvA.addEventListener('pointercancel', function () { drawing = false; });
    })();

    document.addEventListener('themechange', drawChart);
    buildLegend();
    render(); measure(); drawChart();
    if (reduceMotion) playBtn.textContent = 'Play';
    raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; }
      else if (!raf) raf = requestAnimationFrame(loop);
    });

    // hover readout on the live chart
    svg.addEventListener('pointermove', function (e) {
      var n = hist.gep.length;
      if (n < 2) return;
      var box = svg.getBoundingClientRect();
      var vx = (e.clientX - box.left) / box.width * W;
      var i = Math.round((vx - L) / (W - L - R) * (n - 1));
      if (i < 0 || i >= n) { hideTip(tip); return; }
      var rows = SERIES.filter(function (s) { return show[s.k]; }).map(function (s) {
        var val = hist[s.k][i];
        return '<div class="row"><i style="background:' + css(s.v) + '"></i>' + s.lab + ' '
          + (s.axis === 'r' ? Math.round(val).toLocaleString() : fmt(val, 3)) + '</div>';
      }).join('');
      tipAt(tip, svg, W, H, L + (W - L - R) * i / (n - 1), T,
        '<b>generation ' + (sim.gen - n + 1 + i) + '</b>' + rows);
    });
    svg.addEventListener('pointerleave', function () { hideTip(tip); });
  })();

  /* ---------------- 4. paint a grid, watch the metrics ---------------- */

  (function () {
    var gridEl = $('#mdGrid'), brushEl = $('#mdBrush');
    var N = 10;
    var TYPES = [0, 0.6, 0.7, 0.8, 0.9, 1.0];
    var brush = 0.8;
    var cells = new Float64Array(N * N);

    function build() {
      gridEl.style.gridTemplateColumns = 'repeat(' + N + ', 1fr)';
      clear(gridEl);
      var i;
      for (i = 0; i < N * N; i++) {
        (function (i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-label', 'Cell ' + (i + 1));
          b.addEventListener('pointerdown', function (e) { cells[i] = brush; paintGrid(); e.preventDefault(); });
          b.addEventListener('pointerenter', function (e) {
            if (e.buttons === 1) { cells[i] = brush; paintGrid(); }
          });
          gridEl.appendChild(b);
        })(i);
      }
      TYPES.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = t === 0 ? 'dead' : t.toFixed(1);
        b.setAttribute('aria-pressed', t === brush);
        b.addEventListener('click', function () {
          brush = t;
          $$('button', brushEl).forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
        });
        brushEl.appendChild(b);
      });
    }

    function paintGrid() {
      var btns = $$('button', gridEl), i;
      for (i = 0; i < N * N; i++) {
        var v = cells[i];
        var c = magma(v > 0.5 ? (v - 0.5) / 0.5 : 0);
        btns[i].style.background = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
        btns[i].textContent = v > 0 ? v.toFixed(1).slice(1) : '';
        btns[i].style.color = v > 0.85 ? 'rgba(20,12,4,.75)' : 'rgba(255,255,255,.75)';
      }
      compute();
    }

    function compute() {
      var vals = cells, n = N * N;
      var hh = histOf(vals, n, new Int32Array(BINS));
      var e = gepFrom(hh, n, 6), gc = gcvpFrom(hh, n), cl = clogvFrom(hh, vals, n, N, N);
      $('#mdGepVal').textContent = fmt(e, 3);
      $('#mdGcvpVal').textContent = fmt(gc, 3);
      $('#mdClogvVal').textContent = fmt(cl, 3);
      $('#mdGepBar').style.width = Math.min(100, e * 100) + '%';
      $('#mdGcvpBar').style.width = Math.min(100, gc * 100) + '%';
      $('#mdClogvBar').style.width = Math.min(100, cl / 0.5 * 100) + '%';

      var maxc = 1, k;
      for (k = 0; k < BINS; k++) maxc = Math.max(maxc, hh[k]);
      var bar = $('#mdCtfp'), ax = $('#mdCtfpAxis');
      clear(bar); clear(ax);
      TYPES.forEach(function (t) {
        var c = hh[binOf(t)] || 0;
        var i = document.createElement('i');
        var col = magma(t > 0.5 ? (t - 0.5) / 0.5 : 0);
        i.style.background = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
        i.style.alignSelf = 'flex-end';
        i.style.height = Math.max(6, c / maxc * 100) + '%';
        i.title = 'type ' + t.toFixed(1) + ': ' + c + ' cells';
        bar.appendChild(i);
        var s = document.createElement('span');
        s.textContent = c;
        ax.appendChild(s);
      });

      var live = 0, i2;
      for (i2 = 0; i2 < n; i2++) if (vals[i2] > 0.5) live++;
      var liveTypes = 0;
      TYPES.forEach(function (t) { if (t > 0 && hh[binOf(t)]) liveTypes++; });
      var note = $('#mdNote');
      if (live === 0) {
        note.textContent = 'An empty grid is a single label, so the entropy is 0 and so is the gross-cell '
          + 'variance: every cell matches the median.';
      } else if (liveTypes === 1 && live === n) {
        note.textContent = 'One species filling the grid. GEP reads ' + fmt(e, 2) + ' — near zero, '
          + 'correctly — while GCVP reads ' + fmt(gc, 2) + '. This is the regime where the two disagree.';
      } else {
        note.textContent = liveTypes + ' living type' + (liveTypes === 1 ? '' : 's') + ' over ' + live
          + ' cells. GEP is normalised by log|Σ| with |Σ| = 6, so an even mix of all six labels '
          + 'would read 1.00; GCVP counts only whether a cell differs from the median, which is why it '
          + 'climbs faster than the entropy does.';
      }
    }

    $('#mdUniform').addEventListener('click', function () { cells.fill(0.8); paintGrid(); });
    $('#mdMixed').addEventListener('click', function () {
      for (var i = 0; i < N * N; i++) cells[i] = TYPES[i % TYPES.length];
      paintGrid();
    });
    $('#mdRandom').addEventListener('click', function () {
      for (var i = 0; i < N * N; i++) cells[i] = Math.random() < 0.35 ? 0 : TYPES[1 + ((Math.random() * 5) | 0)];
      paintGrid();
    });
    $('#mdClear').addEventListener('click', function () { cells.fill(0); paintGrid(); });

    build();
    for (var i = 0; i < N * N; i++) cells[i] = Math.random() < 0.4 ? 0 : TYPES[1 + ((Math.random() * 5) | 0)];
    paintGrid();
    document.addEventListener('themechange', paintGrid);
  })();

  /* ---------------- 5. what each probe can see ---------------- */

  (function () {
    var barEl = $('#probeGenes'), ppp = 0.02;
    var gene = new Float64Array(P);
    var loci = [5, 19, 31];
    var events = 0, ghcSeen = 0, rwspSeen = 0;

    function fresh() {
      var k;
      for (k = 0; k < 36; k++) gene[k] = (Math.random() * 2 - 1) * XA1;
      for (k = 38; k < 42; k++) gene[k] = (Math.random() * 2 - 1) * XA2;
      gene[36] = gene[37] = gene[42] = gene[43] = 0;
      events = ghcSeen = rwspSeen = 0;
      render();
    }

    function colours() {
      var r = 0, g = 0, b = 0, k;
      for (k = 0; k < 8; k++) r = (r << 1) | geneBit(gene[k]);
      for (k = 8; k < 16; k++) g = (g << 1) | geneBit(gene[k]);
      for (k = 16; k < 24; k++) b = (b << 1) | geneBit(gene[k]);
      var rw = loci.map(function (i) {
        var v = Math.trunc(Math.round(gene[i] * 10) / 10 * 255) % 256;
        return v < 0 ? v + 256 : v;
      });
      return { ghc: [r, g, b], rwsp: rw };
    }

    function one() {
      var before = colours(), k, touchedProbe = false;
      for (k = 0; k < 42; k++) {
        if (k >= 36 && k < 38) continue;
        if (Math.random() < ppp) {
          gene[k] += Math.random() * 2 - 1;
          if (loci.indexOf(k) >= 0) touchedProbe = true;
        }
      }
      var after = colours();
      events++;
      if (before.ghc.join() !== after.ghc.join()) ghcSeen++;
      if (before.rwsp.join() !== after.rwsp.join()) rwspSeen++;
      return touchedProbe;
    }

    function render() {
      clear(barEl);
      for (var k = 0; k < P; k++) {
        var i = document.createElement('i');
        var t = Math.max(0, Math.min(1, (gene[k] + 1.8) / 3.6));
        var c = magma(t);
        i.style.background = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
        if (loci.indexOf(k) >= 0) i.style.boxShadow = 'inset 0 0 0 2px ' + css('--rwsp');
        if ((k >= 36 && k < 38) || k >= 42) i.style.opacity = '.3';
        i.title = 'w[' + k + '] = ' + gene[k].toFixed(3) + (loci.indexOf(k) >= 0 ? ' — probed' : '');
        barEl.appendChild(i);
      }
      var c = colours();
      $('#probeGhcChip').style.background = 'rgb(' + c.ghc.join(',') + ')';
      $('#probeRwspChip').style.background = 'rgb(' + c.rwsp.join(',') + ')';
      $('#probeState').innerHTML = 'GHC reads <span class="mono">rgb(' + c.ghc.join(', ') + ')</span>, '
        + 'RWSP reads <span class="mono">rgb(' + c.rwsp.join(', ') + ')</span>. '
        + 'The hash is a proxy for genome identity, not for genome distance &mdash; similar colours do not '
        + 'imply similar weight vectors.';

      var pg = 1 - Math.pow(1 - ppp, 40), pr = 1 - Math.pow(1 - ppp, 3);
      $('#probeGhcP').textContent = fmt(pg * 100, 1) + '%';
      $('#probeRwspP').textContent = fmt(pr * 100, 1) + '%';
      $('#probeGhcBar').style.width = pg * 100 + '%';
      $('#probeRwspBar').style.width = pr * 100 + '%';

      $('#probeTally').innerHTML = events === 0
        ? 'No events applied yet.'
        : '<b>' + events + '</b> inheritance events. The GHC colour changed <b>' + ghcSeen + '</b> times ('
        + fmt(ghcSeen / events * 100, 0) + '%), the RWSP colour <b>' + rwspSeen + '</b> times ('
        + fmt(rwspSeen / events * 100, 0) + '%). Both run below the bars above, and for GHC that gap is the '
        + 'hash&rsquo;s own bias: the colour is 24 bits drawn from 24 of the 44 values, and a perturbed value '
        + 'leaves its bit unchanged about half the time. It is the same effect the collision test measures.';
    }

    $('#probePpp').addEventListener('input', function () {
      ppp = parseFloat(this.value);
      $('#oProbePpp').textContent = fmt(ppp, 2);
      render();
    });
    $('#probeStep').addEventListener('click', function () { one(); render(); });
    $('#probeRun').addEventListener('click', function () {
      for (var i = 0; i < 50; i++) one();
      render();
    });
    $('#probeReset').addEventListener('click', fresh);
    document.addEventListener('themechange', render);
    fresh();
  })();

  /* ---------------- 6. the 24 long runs ---------------- */

  (function () {
    if (!D || !D.runs) return;
    var pick = $('#runPick'), shots = $('#runShots'), meta = $('#runMeta');
    var cur = 1;
    var GRID = D.grid;

    var NOTES = {
      budgeted: ['Diversity is preserved.',
        'Mortality keeps space open. Cells die on schedule, empty space is continually reopened, and every '
        + 'reopened cell is a birth — which is the only event that produces a mutated genome. The entropy '
        + 'stays up and the GHC and RWSP curves stay separated.'],
      full: ['The grid fills, then the genomes stop turning over.',
        'With no life budget the substrate saturates: once nearly every cell is occupied, few cells die, so '
        + 'few new agents form. GHC rises during growth and then decays as the surviving colonies share a '
        + 'genotype. This is the clearest consequence of mutation happening only at birth.'],
      dead: ['Extinct within a few tens of generations.',
        'ip = 0.50 with b = 4 is the one combination in the grid that does not survive. A budget of 4 forces '
        + 'every cell to die after four generations, so the population lives only if each cell seeds a viable '
        + 'neighbour inside that window; at ip = 0.50 a living cell replaces its own working genome roughly '
        + 'every other generation, so a genome that clears α is rarely kept long enough to do the seeding.'],
      highip: ['Persistent, but churning.',
        'The same high inheritance probability survives at b = 8: doubling the window is enough for a genome '
        + 'to seed a neighbour before it is overwritten. Diversity settles at an intermediate level.']
    };

    function noteFor(r) {
      if (r.died) return NOTES.dead;
      if (!isFinite(r.budget) || r.budget === null) return NOTES.full;
      if (r.ip >= 0.5) return NOTES.highip;
      return NOTES.budgeted;
    }

    function build() {
      var n;
      for (n = 1; n <= 24; n++) {
        (function (n) {
          var r = D.runs[n];
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = n;
          b.setAttribute('aria-pressed', n === cur);
          b.setAttribute('aria-label', 'Experiment ' + n + (r.died ? ', died early' : ''));
          if (r.died) b.className = 'died';
          b.addEventListener('click', function () {
            $$('button', pick).forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
            cur = n; show();
          });
          pick.appendChild(b);
        })(n);
      }
    }

    function show() {
      var r = D.runs[cur];
      var bud = (r.budget === null || !isFinite(r.budget)) ? '∞' : r.budget;
      meta.innerHTML =
        '<span>experiment <b>' + cur + '</b></span>' +
        '<span>init_prob <b>' + fmt(r.init, 2) + '</b></span>' +
        '<span>ip <b>' + fmt(r.ip, 2) + '</b></span>' +
        '<span>budget <b>' + bud + '</b></span>' +
        '<span>activation <b>' + r.act + '</b></span>' +
        '<span>ppp <b>0.02</b></span>' +
        '<span>200 &times; 200, 1000 generations, five-fold</span>' +
        (r.died ? '<span style="color:var(--gcvp)"><b>died early</b></span>' : '');

      // runs that died are exported at generation 10 rather than 1000
      var late = r.died ? '10' : '1000';
      var endLab = r.died ? 'at the end, generation 10' : 'at generation 1000';
      var SHOTS = [
        [cur + '-nca-alpha.png', '&alpha; channel ' + endLab, 'Alpha channel of experiment ' + cur + ' ' + endLab],
        [cur + '-nca-chem.png', 'chemistry ' + endLab, 'Hidden chemistry channel of experiment ' + cur + ' ' + endLab],
        [cur + '-ghc1.png', 'GHC, generation 1', 'Genotype hash colouring at generation 1'],
        [cur + '-ghc' + late + '.png', 'GHC, generation ' + late, 'Genotype hash colouring at generation ' + late],
        [cur + '-rwsp' + late + '.png', 'RWSP, generation ' + late, 'Three-locus probe at generation ' + late]
      ];
      clear(shots);
      SHOTS.forEach(function (sh) {
        var f = document.createElement('figure');
        f.innerHTML = '<img loading="lazy" decoding="async" src="assets/runs/' + sh[0] + '" alt="' + sh[2] + '">'
          + '<figcaption>' + sh[1] + '</figcaption>';
        shots.appendChild(f);
      });

      var nt = noteFor(r);
      $('#runKicker').textContent = 'Experiment ' + cur + ' — init ' + fmt(r.init, 2)
        + ', ip ' + fmt(r.ip, 2) + ', b ' + bud + ', ' + r.act;
      $('#runVerdict').textContent = nt[0];
      $('#runBody').textContent = nt[1];

      drawPd(); drawGd(); drawCtfp();
    }

    // round an axis maximum up so the four gridlines land on readable numbers,
    // without giving away much of the plot height
    var LADDER = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];
    function niceMax(v) {
      if (!(v > 0)) return 1;
      var e = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
      var m = v / e;
      for (var i = 0; i < LADDER.length; i++) if (m <= LADDER[i] + 1e-9) return LADDER[i] * e;
      return 10 * e;
    }

    function axes(svg, W, H, L, R, T, B, ymax, ylab, fmtY) {
      var iw = W - L - R, ih = H - T - B, i;
      for (i = 0; i <= 4; i++) {
        var v = ymax * i / 4, y = T + ih * (1 - i / 4);
        svg.appendChild(el('line', { x1: L, x2: L + iw, y1: y, y2: y, class: i ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 9, y: y + 4, class: 'ticktext', 'text-anchor': 'end' }, fmtY(v)));
      }
      for (i = 0; i <= 5; i++) {
        var x = L + iw * i / 5;
        svg.appendChild(el('text', { x: x, y: T + ih + 18, class: 'ticktext', 'text-anchor': 'middle' }, i * 200));
      }
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: T + ih, class: 'axisline' }));
      svg.appendChild(el('text', { x: L + iw / 2, y: H - 5, class: 'ticktext', 'text-anchor': 'middle' }, 'generation'));
      svg.appendChild(el('text', {
        x: 12, y: T + ih / 2, class: 'ticktext', 'text-anchor': 'middle',
        transform: 'rotate(-90 12 ' + (T + ih / 2) + ')'
      }, ylab));
    }

    function line(svg, ys, X, Y, colour, width) {
      var d = '', i, started = false;
      for (i = 0; i < ys.length; i++) {
        if (ys[i] === null || ys[i] === undefined) continue;
        d += (started ? 'L' : 'M') + fmt(X(i), 1) + ',' + fmt(Y(ys[i]), 1);
        started = true;
      }
      if (d) svg.appendChild(el('path', { d: d, fill: 'none', stroke: colour, 'stroke-width': width || 2 }));
    }

    function band(svg, hi, lo, X, Y, colour) {
      if (!hi || !lo) return;
      var d = '', i;
      for (i = 0; i < hi.length; i++) d += (i ? 'L' : 'M') + fmt(X(i), 1) + ',' + fmt(Y(hi[i]), 1);
      for (i = lo.length - 1; i >= 0; i--) d += 'L' + fmt(X(i), 1) + ',' + fmt(Y(lo[i]), 1);
      svg.appendChild(el('path', { d: d + 'Z', fill: colour, stroke: 'none' }));
    }

    var PDW = 520, PDH = 300, PL = 48, PR = 62, PT = 14, PB = 40;

    function drawPd() {
      var svg = $('#runPdSvg'), r = D.runs[cur];
      clear(svg);
      var iw = PDW - PL - PR, ih = PDH - PT - PB;
      var all = r.pd.gep.concat(r.pd.gcvp, r.pd.clogv).filter(function (v) { return v !== null; });
      var ymax = Math.max(0.2, niceMax(Math.max.apply(null, all.concat([0.1]))));
      var X = function (i) { return PL + iw * GRID[i] / 1000; };
      var Y = function (v) { return PT + ih * (1 - v / ymax); };
      axes(svg, PDW, PDH, PL, PR, PT, PB, ymax, 'value', function (v) { return v.toFixed(2); });
      [['clogv', '--clogv', 'CLOGV'], ['gcvp', '--gcvp', 'GCVP'], ['gep', '--gep', 'GEP']].forEach(function (s) {
        line(svg, r.pd[s[0]], X, Y, css(s[1]), 2);
      });
      var labs = [['gep', '--gep', 'GEP'], ['gcvp', '--gcvp', 'GCVP'], ['clogv', '--clogv', 'CLOGV']]
        .map(function (s) {
          var arr = r.pd[s[0]];
          return { y: Y(arr[arr.length - 1] || 0), c: css(s[1]), t: s[2] };
        }).sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < labs.length; k++) if (labs[k].y - labs[k - 1].y < 15) labs[k].y = labs[k - 1].y + 15;
      labs.forEach(function (l) {
        svg.appendChild(el('text', { x: PL + iw + 8, y: l.y + 4, class: 'serieslabel', fill: l.c }, l.t));
      });
      hover(svg, $('#runPdTip'), PDW, PDH, PL, PR, PT,
        [['GEP', r.pd.gep, '--gep', 3], ['GCVP', r.pd.gcvp, '--gcvp', 3], ['CLOGV', r.pd.clogv, '--clogv', 3]]);
    }

    function drawGd() {
      var svg = $('#runGdSvg'), r = D.runs[cur];
      clear(svg);
      var iw = PDW - PL - PR, ih = PDH - PT - PB;
      var all = (r.gd.ghc || []).concat(r.gd.rwsp || [], r.gd.ghc_hi || [])
        .filter(function (v) { return v !== null && v !== undefined; });
      var ymax = Math.max(100, niceMax(Math.max.apply(null, all.concat([100])) * 1.04));
      var X = function (i) { return PL + iw * GRID[i] / 1000; };
      var Y = function (v) { return PT + ih * (1 - v / ymax); };
      axes(svg, PDW, PDH, PL, PR, PT, PB, ymax, 'unique colours',
        function (v) { return Math.round(v).toLocaleString(); });
      band(svg, r.gd.ghc_hi, r.gd.ghc_lo, X, Y, rgba(css('--ghc'), 0.16));
      band(svg, r.gd.rwsp_hi, r.gd.rwsp_lo, X, Y, rgba(css('--rwsp'), 0.16));
      line(svg, r.gd.rwsp, X, Y, css('--rwsp'), 2.2);
      line(svg, r.gd.ghc, X, Y, css('--ghc'), 2.2);
      var yg = Y(r.gd.ghc[r.gd.ghc.length - 1] || 0), yr = Y(r.gd.rwsp[r.gd.rwsp.length - 1] || 0);
      if (Math.abs(yg - yr) < 15) yr = yg + 15;
      svg.appendChild(el('text', { x: PL + iw + 8, y: yg + 4, class: 'serieslabel', fill: css('--ghc') }, 'GHC'));
      svg.appendChild(el('text', { x: PL + iw + 8, y: yr + 4, class: 'serieslabel', fill: css('--rwsp') }, 'RWSP'));
      hover(svg, $('#runGdTip'), PDW, PDH, PL, PR, PT,
        [['GHC', r.gd.ghc, '--ghc', 0], ['RWSP', r.gd.rwsp, '--rwsp', 0]]);
    }

    var CTFP_HUES = ['--text-mute', '--gep', '--clogv', '--cyan', '--gcvp', '--ghc', '--rwsp', '--chem',
      '--navy', '--alive', '--warn'];

    function drawCtfp() {
      var svg = $('#runCtfpSvg'), r = D.runs[cur], leg = $('#runCtfpLegend');
      clear(svg); clear(leg);
      var iw = PDW - PL - PR, ih = PDH - PT - PB;
      var series = r.ctfp.counts, types = r.ctfp.types;
      // the dead-state count dwarfs every living type, so plot the living ones
      var living = [], i;
      for (i = 0; i < types.length; i++) {
        if (parseFloat(types[i]) === 0) continue;
        if (series[i] && series[i].length) living.push(i);
      }
      var all = [];
      living.forEach(function (i) { all = all.concat(series[i]); });
      all = all.filter(function (v) { return v !== null && v !== undefined; });
      var ymax = Math.max(50, niceMax(Math.max.apply(null, all.concat([50])) * 1.04));
      var X = function (i) { return PL + iw * GRID[i] / 1000; };
      var Y = function (v) { return PT + ih * (1 - v / ymax); };
      axes(svg, PDW, PDH, PL, PR, PT, PB, ymax, 'cells of this type',
        function (v) { return Math.round(v).toLocaleString(); });

      if (!living.length) {
        svg.appendChild(el('text', {
          x: PL + iw / 2, y: PT + ih / 2, class: 'serieslabel', 'text-anchor': 'middle',
          fill: css('--text-mute')
        }, 'no living cells recorded'));
        return;
      }

      living.forEach(function (i, k) {
        line(svg, series[i], X, Y, css(CTFP_HUES[k % CTFP_HUES.length]), 1.8);
        var b = document.createElement('span');
        b.innerHTML = '<i class="swatch line" style="background:var(' + CTFP_HUES[k % CTFP_HUES.length] + ')"></i>'
          + 'type ' + types[i];
        leg.appendChild(b);
      });
      hover(svg, $('#runCtfpTip'), PDW, PDH, PL, PR, PT, living.map(function (i, k) {
        return ['type ' + types[i], series[i], CTFP_HUES[k % CTFP_HUES.length], 0];
      }));
    }

    function hover(svg, tip, W, H, L, R, T, rows) {
      svg.addEventListener('pointermove', function (e) {
        var box = svg.getBoundingClientRect();
        var vx = (e.clientX - box.left) / box.width * W;
        var frac = (vx - L) / (W - L - R);
        if (frac < -0.02 || frac > 1.02) { hideTip(tip); return; }
        var i = Math.max(0, Math.min(GRID.length - 1, Math.round(frac * (GRID.length - 1))));
        var html = '<b>generation ' + GRID[i] + '</b>';
        rows.forEach(function (r) {
          var v = r[1] && r[1][i];
          if (v === null || v === undefined) return;
          html += '<div class="row"><i style="background:' + css(r[2]) + '"></i>' + r[0] + ' '
            + (r[3] ? Number(v).toFixed(r[3]) : Math.round(v).toLocaleString()) + '</div>';
        });
        tipAt(tip, svg, W, H, L + (W - L - R) * i / (GRID.length - 1), T, html);
      });
      svg.addEventListener('pointerleave', function () { hideTip(tip); });
    }

    document.addEventListener('themechange', function () { drawPd(); drawGd(); drawCtfp(); });
    build(); show();
  })();

  /* ---------------- 7. when does a lineage saturate? ---------------- */

  (function () {
    var svg = $('#satSvg'), tip = $('#satTip');
    var W = 520, H = 300, L = 50, R = 24, T = 16, B = 44;
    var ppp = 0.02, ip = 0.10;

    function sigmaAt(g) { return Math.sqrt(6 * ppp * ip * g); }
    function gStar() { return 16 / (6 * ppp * ip); }

    function draw() {
      clear(svg);
      var iw = W - L - R, ih = H - T - B;
      var gMax = Math.max(120, Math.min(4000, gStar() * 1.8));
      var yMax = 8;
      var X = function (g) { return L + iw * g / gMax; };
      var Y = function (v) { return T + ih * (1 - Math.min(v, yMax) / yMax); };
      var i;

      for (i = 0; i <= 4; i++) {
        var v = yMax * i / 4, y = Y(v);
        svg.appendChild(el('line', { x1: L, x2: L + iw, y1: y, y2: y, class: i ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 9, y: y + 4, class: 'ticktext', 'text-anchor': 'end' }, v.toFixed(0)));
      }
      for (i = 0; i <= 4; i++) {
        var x = L + iw * i / 4;
        svg.appendChild(el('text', { x: x, y: T + ih + 18, class: 'ticktext', 'text-anchor': 'middle' },
          Math.round(gMax * i / 4).toLocaleString()));
      }
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: T + ih, class: 'axisline' }));
      svg.appendChild(el('text', { x: L + iw / 2, y: H - 6, class: 'ticktext', 'text-anchor': 'middle' },
        'inheritance generations'));
      svg.appendChild(el('text', {
        x: 12, y: T + ih / 2, class: 'ticktext', 'text-anchor': 'middle',
        transform: 'rotate(-90 12 ' + (T + ih / 2) + ')'
      }, 'pre-activation s.d.'));

      // the saturation line at 4
      svg.appendChild(el('line', {
        x1: L, x2: L + iw, y1: Y(4), y2: Y(4), stroke: css('--gcvp'),
        'stroke-width': 1.6, 'stroke-dasharray': '7 5'
      }));
      svg.appendChild(el('text', { x: L + 6, y: Y(4) - 7, class: 'serieslabel', fill: css('--gcvp') },
        'sigmoid saturates ≈ 4'));

      var d = '';
      for (i = 0; i <= 160; i++) {
        var g = gMax * i / 160;
        d += (i ? 'L' : 'M') + fmt(X(g), 1) + ',' + fmt(Y(sigmaAt(g)), 1);
      }
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: css('--navy'), 'stroke-width': 2.6 }));

      var gs = gStar();
      if (gs <= gMax) {
        svg.appendChild(el('line', {
          x1: X(gs), x2: X(gs), y1: Y(4), y2: T + ih, stroke: css('--cyan'),
          'stroke-width': 1.4, 'stroke-dasharray': '3 3'
        }));
        svg.appendChild(el('circle', {
          cx: X(gs), cy: Y(4), r: 5.5, fill: css('--cyan'),
          stroke: css('--bg-sunk'), 'stroke-width': 2
        }));
      }

      // where the two settings the paper names actually land
      [[0.02, 0.10, 'ppp 0.02, ip 0.10'], [0.80, 0.10, 'ppp 0.80']].forEach(function (mk) {
        var g = 16 / (6 * mk[0] * mk[1]);
        if (g > gMax) return;
        svg.appendChild(el('circle', {
          cx: X(g), cy: Y(4), r: 3.5, fill: 'none', stroke: css('--text-mute'), 'stroke-width': 1.4
        }));
      });
    }

    function update() {
      var gs = gStar();
      $('#satVerdict').textContent = gs > 100000 ? '—' : Math.round(gs).toLocaleString();
      var body = $('#satBody');
      if (gs > 2000) {
        body.textContent = 'Slower than the 1000-generation horizon of the long runs, so weights stay in the '
          + 'near-linear regime for the whole experiment. Small genotypic differences still map to different '
          + 'rounded states, which is why several types coexist and the phenotype stays diverse.';
      } else if (gs > 200) {
        body.textContent = 'Comparable to the horizon of the long runs. Saturation starts to bite late in the '
          + 'trajectory, which is where CTFP begins concentrating on one type while the genotypic count keeps '
          + 'climbing.';
      } else {
        body.textContent = 'A few tens to a couple of hundred generations — the high-mutation regime. '
          + 'Units saturate long before the horizon, states pile into the extreme bins and round into a single '
          + 'CTFP label, while the weight vectors underneath keep diverging.';
      }
      draw();
    }

    $('#satPpp').addEventListener('input', function () {
      ppp = parseFloat(this.value); $('#oSatPpp').textContent = fmt(ppp, 2); update();
    });
    $('#satIp').addEventListener('input', function () {
      ip = parseFloat(this.value); $('#oSatIp').textContent = fmt(ip, 2); update();
    });
    svg.addEventListener('pointermove', function (e) {
      var box = svg.getBoundingClientRect();
      var iw = W - L - R;
      var gMax = Math.max(120, Math.min(4000, gStar() * 1.8));
      var vx = (e.clientX - box.left) / box.width * W;
      var g = Math.max(0, (vx - L) / iw * gMax);
      if (g > gMax) { hideTip(tip); return; }
      tipAt(tip, svg, W, H, L + iw * g / gMax, T + (H - T - B) * (1 - Math.min(sigmaAt(g), 8) / 8),
        '<b>generation ' + Math.round(g).toLocaleString() + '</b><div class="row">s.d. '
        + fmt(sigmaAt(g), 2) + '</div>');
    });
    svg.addEventListener('pointerleave', function () { hideTip(tip); });
    document.addEventListener('themechange', draw);
    update();
  })();

  /* ---------------- 8. the released animations ---------------- */

  (function () {
    var grid = $('#animGrid');
    var ANIMS = [
      ['exp1-nca', 'Experiment 1, the substrate',
        'Both channels of a 30 × 30 run at init 0.1, ip 0.2, ppp 0.2, b 4. The title band carries the live counts.'],
      ['exp1-rwsp', 'Experiment 1, RWSP',
        'The same run under the three-locus probe. Large single-colour colonies: the probed loci are rarely the mutated ones.'],
      ['exp1-ghc', 'Experiment 1, GHC',
        'The same run under the full-genome hash. Visibly heterogeneous where RWSP was uniform.'],
      ['exp2-nca', 'Experiment 2, the substrate',
        'A lower mutation rate, ppp 0.02, and no life budget. The grid fills and holds.'],
      ['exp2-rwsp', 'Experiment 2, RWSP',
        'Almost static once the grid is full — few births, and the probe misses most of what does change.'],
      ['exp2-ghc', 'Experiment 2, GHC',
        'The full genome still registers turnover during growth, then settles as the colonies stabilise.']
    ];
    ANIMS.forEach(function (a) {
      var f = document.createElement('figure');
      f.className = 'anim';
      f.innerHTML =
        '<button class="shot" type="button" aria-pressed="false" aria-label="Play ' + a[1] + '">'
        + '<img loading="lazy" decoding="async" src="assets/anim/' + a[0] + '-poster.jpg" alt="' + a[1] + '" '
        + 'data-gif="assets/anim/' + a[0] + '.gif">'
        + '<span class="play">Play</span></button>'
        + '<figcaption><b>' + a[1] + '.</b> ' + a[2] + '</figcaption>';
      grid.appendChild(f);
    });
    grid.addEventListener('click', function (e) {
      var btn = e.target.closest('.shot');
      if (!btn) return;
      var im = $('img', btn);
      if (btn.getAttribute('aria-pressed') === 'true') {
        btn.setAttribute('aria-pressed', 'false');
        im.src = im.getAttribute('data-gif').replace('.gif', '-poster.jpg');
      } else {
        btn.setAttribute('aria-pressed', 'true');
        im.src = im.getAttribute('data-gif');
      }
    });
  })();

})();
