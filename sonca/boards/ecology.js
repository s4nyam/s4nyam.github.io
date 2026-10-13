/* ==========================================================
   Section 9, board "ecology": a fish stock, an ant or bee colony.

   THE NCA UPDATE IS THE PAGE'S OWN AND IS NOT MODIFIED: every
   generation is one call of kit.S.NCA's step(). What this board
   adds are ENVIRONMENT RULES that act on the grid between steps.
   None of them is in nca.py. They are ported line for line from
   the research scripts (work/ecology/eco.js, world.js, harvest.js,
   ifd.js, nest.js, bridge.js, search_patch.js):

   Fishery tab
   - harvest: after each step every living cell is removed with
     probability h, state and agent together (the lab's wound with
     radius 0). Cells inherited this step but not yet alive are
     not touched.
   Foraging tab
   - food quality q (does not run out): before each step a living
     cell on a site of quality q has its age counter lowered by one
     (floored at 0) with probability q, i.e. it skips ageing.
   - patch input R (runs out): before each step R units go to R
     distinct random living cells of the patch (the fractional part
     as a coin flip); a fed cell skips ageing that step.
   - walls: after each step every wall site is cleared.
   - trail field (double bridge, optional): after each step
     phi <- 0.95 phi + 1 on every living site; before the next step
     a living cell skips ageing with probability
     phi^2 / (phi^2 + 4^2).
   - colony cap (double bridge, optional): after each step random
     living cells are removed until at most 408 remain.

   Geometries are the measured ones: harvest 64 x 64; patch worlds
   64 x 64 with four 14 x 14 patches; nest 96 x 96 with five gaps;
   bridge 72 x 72; density-threshold genome 48 x 48 with four
   10 x 10 patches of q = 0.75. Offline numbers come from
   boards/data/ecology.js and are labelled with their run counts.
   ========================================================== */

(function () {
  'use strict';

  var S = window.SONCA;
  if (!S || !S.board) return;

  var P = 44, NS = 'http://www.w3.org/2000/svg';
  var BUDGET_MS = 12;                                  // simulation time allowed per frame
  var RATES = { slow: 15, normal: 60, fast: 600 };     // generations per second (fast = frame budget)
  var FLASH = [120, 205, 255];                         // a cell fished this generation
  var WALL = [46, 46, 60];
  var DARK_GHC = [96, 96, 110];                        // a genome whose hash colour is near black
  function ghcColour(s, i) { var c = s.ghc(i); return c[0] + c[1] + c[2] < 90 ? DARK_GHC : c; }
  function noSelect(cv) { cv.addEventListener('mousedown', function (e) { e.preventDefault(); }); }
  // the engineered always-viable genome of the research: fc1 all +1, fc2 all +2, biases 0
  var ALWAYS = (function () {
    var g = new Float32Array(P), k;
    for (k = 0; k < 36; k++) g[k] = 1;
    for (k = 38; k < 42; k++) g[k] = 2;
    return g;
  })();

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
  function btn(label, cls) { return h('button', { type: 'button', class: cls || 'btn', text: label }); }
  function svgBox(label) {
    var e = document.createElementNS(NS, 'svg');
    e.setAttribute('role', 'img');
    e.setAttribute('aria-label', label);
    return e;
  }
  function col(c) { return c && c.indexOf('--') === 0 ? S.css(c) : c; }
  function fmt(v, d) { return v === null || v === undefined || isNaN(v) ? '–' : Number(v).toFixed(d); }
  function pct(v, d) { return v === null || v === undefined || isNaN(v) ? '–' : (v * 100).toFixed(d || 0) + '%'; }
  function span(a, d) { return fmt(Math.min.apply(null, a), d) + '–' + fmt(Math.max.apply(null, a), d); }

  // a .switch group; items [[key, text]]; returns { set(key) }
  function toggle(host, label, items, initial, onPick) {
    var g = h('div', { class: 'switch', role: 'group', 'aria-label': label });
    var bs = items.map(function (it) {
      var b = h('button', { type: 'button', 'aria-pressed': String(it[0] === initial), text: it[1] });
      b.addEventListener('click', function () { set(it[0]); onPick(it[0]); });
      g.appendChild(b);
      return b;
    });
    function set(k) { bs.forEach(function (b, j) { b.setAttribute('aria-pressed', String(items[j][0] === k)); }); }
    host.appendChild(g);
    return { set: set, el: g };
  }

  // a .readnum grid; items [[key, label]]; set(key, value, note)
  function readGrid(items) {
    var el = h('div', { class: 'readnum' }), map = {};
    items.forEach(function (it) {
      var b = h('b', { text: '–' }), lab = h('span', { text: it[1] }), ref = h('span', { class: 'eco-ref' });
      var d = h('div', {}, [b, lab, ref]);
      el.appendChild(d);
      map[it[0]] = { b: b, lab: lab, ref: ref, d: d };
    });
    return {
      el: el,
      set: function (k, v, r) {
        var m = map[k];
        if (!m) return;
        if (m.b.textContent !== v) m.b.textContent = v;
        var rr = r || '';
        if (m.ref.textContent !== rr) m.ref.textContent = rr;
      },
      label: function (k, t) { if (map[k] && map[k].lab.textContent !== t) map[k].lab.textContent = t; },
      show: function (k, on) { if (map[k]) map[k].d.hidden = !on; }
    };
  }

  // legend items [[colour, label, kind]]; kind 'line' | 'dash' | 'dot' | 'ring' | 'band' | 'bar'
  function legend(host, items) {
    S.clear(host);
    items.forEach(function (it) {
      var c = col(it[0]), sw = h('i', { class: 'swatch line' }), k = it[2] || 'line';
      if (k === 'line') sw.style.background = c;
      else if (k === 'dash') sw.style.background = 'repeating-linear-gradient(90deg,' + c + ' 0 4px,transparent 4px 7px)';
      else if (k === 'dot' || k === 'ring') {
        sw.className = 'swatch';
        sw.style.cssText = 'width:10px;height:10px;border-radius:50%;' +
          (k === 'dot' ? 'background:' + c : 'border:2px solid ' + c + ';box-sizing:border-box');
      } else if (k === 'band') { sw.className = 'swatch'; sw.style.background = S.rgba(c, 0.22); }
      else if (k === 'bar') { sw.className = 'swatch'; sw.style.background = c; }
      else if (k === 'cross') { sw = h('i', { 'aria-hidden': 'true', text: '×' }); sw.style.cssText = 'font-style:normal;font-weight:700;color:' + c; }
      host.appendChild(h('span', {}, [sw, it[1]]));
    });
  }

  // kit.chart's own mapping, so extra marks (bands, dots) can be drawn on top of it
  function scaler(spec) {
    var W = spec.w || 520, H = spec.h || 300, L = spec.left || 50, R = spec.right || 64, T = 14, B = 42;
    var iw = W - L - R, ih = H - T - B;
    return {
      X: function (v) { return L + iw * (v - spec.x.min) / ((spec.x.max - spec.x.min) || 1); },
      Y: function (v) { return T + ih * (1 - (v - spec.y.min) / ((spec.y.max - spec.y.min) || 1)); },
      L: L, T: T, iw: iw, ih: ih
    };
  }
  function boxWidth(el, min, max) {
    var w = el.clientWidth || 0;
    if (!w) w = 520;
    return Math.round(Math.max(min, Math.min(max, w)));
  }

  /* ---------------- grid helpers: environment rules only ---------------- */

  // remove one cell, state and agent together (s.wound with radius 0)
  function kill(s, i) {
    var n = s.N, b = i * P, k;
    s.st[i] = 0; s.st[n + i] = 0; s.bud[i] = 0; s.has[i] = 0; s.inh[i] = 0;
    for (k = 0; k < P; k++) s.g[b + k] = 0;
  }
  function living(s) {
    var c = 0, v = s.st, a = s.alpha, i;
    for (i = 0; i < s.N; i++) if (v[i] > a) c++;
    return c;
  }
  // cells inherited this step that are not alive yet
  function pending(s) {
    var c = 0, i;
    for (i = 0; i < s.N; i++) if (s.inh[i]) c++;
    return c;
  }
  // exact identity of a cell's 44 parameters, folded into one safe integer
  function gkey(u, i) {
    var h1 = 2166136261, h2 = 5381, b = i * P, k, v;
    for (k = 0; k < P; k++) {
      v = u[b + k];
      h1 = Math.imul(h1 ^ v, 16777619);
      h2 = (Math.imul(h2, 33) + v) | 0;
    }
    return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 2097151);
  }
  function distinctGenomes(s) {
    var u = new Uint32Array(s.g.buffer), set = new Set(), v = s.st, a = s.alpha, i;
    for (i = 0; i < s.N; i++) if (v[i] > a) set.add(gkey(u, i));
    return set.size;
  }
  function disc(W, ci, cj, r, fn) {
    var di, dj;
    for (di = -r; di <= r; di++) for (dj = -r; dj <= r; dj++) {
      if (di * di + dj * dj <= r * r) fn(((ci + di + W) % W) * W + ((cj + dj + W) % W));
    }
  }

  /* A world for the foraging experiments: port of work/ecology/world.js.
     The NCA rule is untouched; pre() and post() act between steps. */
  function World(o) {
    var s = S.NCA({ W: o.W, init: 0, ip: o.ip, ppp: o.ppp, budget: o.budget, act: 'sigmoid' });
    var N = s.N;
    var w = {
      s: s, N: N, W: o.W, q: new Float32Array(N), patch: new Int16Array(N).fill(-1), wall: new Uint8Array(N),
      R: o.R || null, field: o.field || null, phi: new Float32Array(N), cap: o.cap || 0
    };
    var lists = [];
    // food: skip ageing w.p. q; trail field: skip ageing w.p. phi^n/(phi^n+theta^n); input R: R fed residents skip it
    w.pre = function () {
      var st = s.st, a = s.alpha, bud = s.bud, q = w.q, f = w.field, i, k, m;
      var thn = f ? Math.pow(f.theta, f.n) : 0;
      for (i = 0; i < N; i++) if (st[i] > a) {
        if (q[i] > 0 && Math.random() < q[i] && bud[i] > 0) bud[i]--;
        if (f) {
          var p = Math.pow(w.phi[i], f.n);
          if (p > 0 && Math.random() < p / (p + thn) && bud[i] > 0) bud[i]--;
        }
      }
      if (w.R) {
        for (k = 0; k < w.R.length; k++) lists[k] = [];
        for (i = 0; i < N; i++) if (st[i] > a && w.patch[i] >= 0 && w.R[w.patch[i]] !== undefined) lists[w.patch[i]].push(i);
        for (k = 0; k < w.R.length; k++) {
          var L = lists[k], r = Math.floor(w.R[k]);
          if (Math.random() < w.R[k] - r) r++;
          r = Math.min(r, L.length);
          for (m = 0; m < r; m++) {
            var j = m + ((Math.random() * (L.length - m)) | 0), t = L[m];
            L[m] = L[j]; L[j] = t;
            if (bud[L[m]] > 0) bud[L[m]]--;
          }
        }
      }
    };
    // walls are cleared; the trail field decays and is laid by every living cell
    w.post = function () {
      var st = s.st, i;
      for (i = 0; i < N; i++) if (w.wall[i] && (s.has[i] || st[i] > 0 || st[N + i] > 0)) kill(s, i);
      if (w.field) {
        var f = w.field;
        for (i = 0; i < N; i++) w.phi[i] = w.phi[i] * (1 - f.rho) + (st[i] > s.alpha ? f.dep : 0);
      }
      if (w.cap) {
        var Lv = [];
        for (i = 0; i < N; i++) if (st[i] > s.alpha) Lv.push(i);
        for (var m = Lv.length; m > w.cap; m--) {
          var j = (Math.random() * m) | 0;
          kill(s, Lv[j]); Lv[j] = Lv[m - 1];
        }
      }
    };
    w.step = function () { w.pre(); s.step(); w.post(); };
    w.rect = function (i0, j0, hh, wd, fn) {
      var i, j;
      for (i = i0; i < i0 + hh; i++) for (j = j0; j < j0 + wd; j++) fn(((i + w.W) % w.W) * w.W + ((j + w.W) % w.W));
    };
    w.disc = function (ci, cj, r, fn) { disc(w.W, ci, cj, r, fn); };
    return w;
  }

  /* A frame clock: steps at a set rate, never more than BUDGET_MS of
     simulation per frame, and never carries a backlog. */
  function Clock(rate) {
    var c = { rate: rate, acc: 0, last: null };
    c.run = function (t, step, flatOut) {
      var dt = c.last === null ? 16.7 : Math.min(100, Math.max(0, t - c.last));
      c.last = t;
      c.acc += flatOut ? 1e9 : c.rate * dt / 1000;
      var t0 = performance.now(), n = 0;
      while (c.acc >= 1) {
        if (!step()) { c.acc = 0; break; }
        c.acc -= 1; n++;
        if (performance.now() - t0 > BUDGET_MS) break;
      }
      if (c.acc > 2) c.acc = flatOut ? 0 : 2;
      return n;
    };
    c.reset = function () { c.last = null; c.acc = 0; };
    return c;
  }

  /* ---------------- the board ---------------- */

  S.board('ecology', function (root, kit) {
    var live = root.querySelector('.boardlive');
    var msg = h('p', { class: 'note', text: 'Loading the offline fishery and foraging results…' });
    live.appendChild(msg);
    var ui = null;
    kit.load('boards/data/ecology.js?v=1', function (err) {
      var D = window.SONCA_DATA && window.SONCA_DATA.ecology;
      if (err || !D) { msg.textContent = 'The board’s data (boards/data/ecology.js) could not be loaded.'; return; }
      live.removeChild(msg);
      ui = build(live, kit, D);
    });
    return {
      frame: function (t) { if (ui) ui.frame(t); },
      show: function () { if (ui) ui.show(); }
    };
  });

  function build(host, kit, D) {
    addStyle();
    var tabRow = h('div', { class: 'controls eco-tabs' }, [h('span', { class: 'ctl-label', text: 'Experiment' })]);
    var paneF = h('div', {}), paneA = h('div', { hidden: '' });
    host.appendChild(tabRow);
    host.appendChild(paneF);
    host.appendChild(paneA);
    var fish = Fishery(paneF, kit, D), ants = null, cur = 'fish';
    function active() { return cur === 'fish' ? fish : ants; }
    toggle(tabRow, 'Choose the experiment', [['fish', 'A fish stock'], ['forage', 'An ant or bee colony']], 'fish', function (k) {
      cur = k;
      paneF.hidden = k !== 'fish';
      paneA.hidden = k !== 'forage';
      if (k === 'forage' && !ants) ants = Forage(paneA, kit, D);
      active().show();
    });
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { active().redraw(); }, 150);
    });
    document.addEventListener('themechange', function () { fish.redraw(); if (ants) ants.redraw(); });
    return { frame: function (t) { active().frame(t); }, show: function () { active().show(); } };
  }

  /* ==========================================================
     Tab 1: harvesting a renewable stock
     ========================================================== */

  function Fishery(host, kit, D) {
    var FD = D.fish, W = FD.W, N = W * W, REG = FD.regimes, BURN = FD.burn;
    var NAMES = { inf: 'No mortality (b = ∞, ip 0.10)', b8: 'Budget 8 (ip 0.20)', b4: 'Budget 4 (ip 0.10)' };
    var PRESETS = {
      gentle: { h: 0.05, label: 'Gentle (h 0.05)' },
      msy: { h: 0.16, label: 'Fish at MSY (h 0.16)' },
      edge: { h: 0.24, label: 'Near the edge (h 0.24)' },
      over: { h: 0.30, label: 'Over-fish (h 0.30)' }
    };
    var st = {
      regime: 'inf', founders: 'xavier', h: 0.16, preset: 'msy', view: 'alpha', curve: 'hy',
      sim: null, K: 1, gen: 0, burn: 0, base: 0, n: [], c: [], holdGen: 0,
      dots: { inf: [], b8: [], b4: [] }, dotRef: null, regrow: null, extinct: null,
      cut: new Uint8Array(N), playing: !kit.reduceMotion, dirty: true, dist: null
    };
    var clock = Clock(RATES.normal);

    /* ---------- markup ---------- */

    var regHost = h('div', { role: 'group', 'aria-label': 'Choose the regime' });
    var preHost = h('div', { role: 'group', 'aria-label': 'Fishing presets' });
    var fdHost = h('div', {});
    host.appendChild(h('div', { class: 'presetrows' }, [
      h('span', { class: 'ctl-label', text: 'Regime' }), regHost,
      h('span', { class: 'ctl-label', text: 'Presets' }), preHost,
      h('span', { class: 'ctl-label', text: 'Founders' }), fdHost
    ]));
    var note = h('p', { class: 'note presetnote', 'aria-live': 'polite' });
    host.appendChild(note);

    var cv = h('canvas', {
      class: 'cv draw', width: W, height: W,
      'aria-label': 'The fished stock, 64 by 64 cells; cells removed in the last generation flash pale blue. Drag to trawl.'
    });
    var cvCap = h('em', { text: 'drag to trawl' });
    var svgT = svgBox('Stock and catch, as fractions of K, over the last 400 generations');
    var tipT = h('div', { class: 'tip' }), legT = h('div', { class: 'legend' });
    var boxT = h('div', { class: 'chartbox' }, [svgT, tipT]);
    var svgC = svgBox('Sustained catch against harvest rate: the offline five-run curve and your own runs');
    var tipC = h('div', { class: 'tip' }), legC = h('div', { class: 'legend' });
    var boxC = h('div', { class: 'chartbox' }, [svgC, tipC]);
    var curveRow = h('div', { class: 'controls eco-curvectl' }, [h('span', { class: 'kicker', text: 'Sustained yield' })]);

    var R = readGrid([
      ['gen', 'generation'], ['hold', 'generations at this h'],
      ['stock', 'stock / K now'], ['catch', 'cells fished this generation'],
      ['mc', 'mean catch / K at this h'], ['ms', 'mean stock / K at this h'],
      ['cv', 'CV of the stock'], ['ac', 'lag-1 autocorrelation'],
      ['regrow', 'regrowth time to 0.9 K'], ['dist', 'distinct genomes'],
      ['msy', 'offline h at MSY'], ['col', 'offline collapse h']
    ]);
    var verdict = h('p', { class: 'verdict na', 'aria-live': 'polite', text: '–' });
    var sub = h('p', { class: 'eco-sub' });
    var bPlay = btn(st.playing ? 'Pause' : 'Play', 'btn primary'), bStep = btn('Step'), bReseed = btn('Reseed');
    var hIn = h('input', { type: 'range', id: 'ecoH', min: '0', max: '0.4', step: '0.005', value: String(st.h) });
    var hOut = h('output', { for: 'ecoH' });
    var bStop = btn('Stop fishing');
    var speedRow = h('div', { class: 'controls eco-tight' }, [h('span', { class: 'ctl-label', text: 'Speed' })]);
    var viewRow = h('div', { class: 'controls eco-tight' }, [h('span', { class: 'ctl-label', text: 'Colour' })]);

    var hRow = h('div', { class: 'eco-hrow' }, [
      h('div', { class: 'slider' }, [h('label', { for: 'ecoH', text: 'h — harvest rate' }), hIn, hOut]), bStop
    ]);
    host.appendChild(h('div', { class: 'lab' }, [
      h('div', {}, [
        hRow,
        h('div', { class: 'eco-stage' }, [
          h('figure', { class: 'cvfig' }, [cv, h('figcaption', {}, [h('span', { text: 'The stock' }), cvCap])]),
          h('div', {}, [boxT, legT])
        ]),
        h('div', { class: 'eco-wide' }, [curveRow, boxC, legC]),
        h('p', {
          class: 'note eco-rule',
          html: '<b>Added rule, not in <span class="mono">nca.py</span>:</b> after every step each living cell is ' +
            'removed, state and agent together, with probability <span class="mono">h</span>. The NCA update itself is unchanged.'
        })
      ]),
      h('div', { class: 'readout' }, [
        R.el, verdict, sub,
        h('div', { class: 'controls', style: 'margin-bottom:10px' }, [bPlay, bStep, bReseed]),
        speedRow, viewRow
      ])
    ]));

    /* ---------- controls ---------- */

    var regPills = kit.pills(regHost, Object.keys(NAMES).map(function (k) { return { key: k, label: NAMES[k] }; }),
      function (k) { st.regime = k; st.preset = null; prePills.set(''); reseed(); }, st.regime);
    var prePills = kit.pills(preHost, Object.keys(PRESETS).map(function (k) { return { key: k, label: PRESETS[k].label }; }),
      function (k) { applyPreset(k); }, st.preset);
    var fdSw = toggle(fdHost, 'Choose the founders', [['xavier', 'random genomes'], ['always', 'always-viable genome']], st.founders,
      function (k) { st.founders = k; reseed(); });
    toggle(speedRow, 'Simulation speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], 'normal',
      function (k) { clock.rate = RATES[k]; });
    toggle(viewRow, 'Colour the living cells by', [['alpha', 'α'], ['ghc', 'genome hash']], 'alpha',
      function (k) { st.view = k; st.dirty = true; paint(); });
    toggle(curveRow, 'Choose the yield plot', [['hy', 'catch vs h'], ['sy', 'catch vs stock'], ['hs', 'stock vs h']], 'hy',
      function (k) { st.curve = k; drawCurve(); });

    var syncH = kit.slider(hIn, hOut, function (v) { return v.toFixed(3); }, function (v) {
      setH(v);
      if (st.preset && Math.abs(PRESETS[st.preset].h - v) > 1e-9) { st.preset = null; prePills.set(''); }
    });
    bStop.addEventListener('click', function () { hIn.value = '0'; syncH(); });
    bPlay.addEventListener('click', function () { setPlaying(!st.playing); });
    bStep.addEventListener('click', function () { setPlaying(false); step(); afterSteps(true); });
    bReseed.addEventListener('click', function () { reseed(); });

    noSelect(cv);
    kit.pointer(cv, W, W, function (r, c, phase) {
      // the pointer is captured while dragging, so it can leave the canvas: ignore it there
      if (phase === 'up' || !st.sim || st.extinct || r < 0 || c < 0 || r >= W || c >= W) return;
      trawl(r, c);
    });

    function setPlaying(on) {
      st.playing = on;
      clock.reset();
      bPlay.textContent = on ? 'Pause' : 'Play';
      if (!on && st.sim) afterSteps(true);              // show the paused state at once
    }

    /* ---------- the experiment ---------- */

    function reseed() {
      var Rg = REG[st.regime], always = st.founders === 'always';
      // random founders: the substrate as it is (ppp 0.02); always-viable: clonal, ppp 0, as offline
      var s = S.NCA({
        W: W, init: always ? 0 : 0.08, ip: Rg.ip, ppp: always ? 0 : Rg.ppp,
        budget: Rg.budget === null ? Infinity : Rg.budget, act: 'sigmoid'
      });
      if (always) s.seed(0, function (t) { for (var i = 0; i < t.N; i++) if (Math.random() < 0.08) t.found(i, ALWAYS); });
      st.sim = s;
      st.K = Rg.Kfrac * N;
      st.gen = 0; st.base = 0; st.n = []; st.c = [];
      st.burn = BURN; st.holdGen = 0; st.dotRef = null; st.regrow = null; st.extinct = null; st.dist = null;
      st.cut.fill(0);
      clock.reset();
      noteText();
      afterSteps(true);
    }
    function applyPreset(k) {
      st.preset = k;
      st.regime = 'inf'; regPills.set('inf');
      st.founders = 'xavier'; fdSw.set('xavier');
      hIn.value = String(PRESETS[k].h);
      st.h = PRESETS[k].h;
      hOut.textContent = st.h.toFixed(3);
      reseed();
      if (!st.playing && !kit.reduceMotion) setPlaying(true);
    }
    function newHold() { st.holdGen = st.gen; st.dotRef = null; st.trawled = false; }
    function setH(v) {
      var prev = st.h;
      if (Math.abs(prev - v) < 1e-9) return;
      st.h = v;
      if (st.burn > 0 || st.extinct) { noteText(); afterSteps(true); return; }
      newHold();
      if (v === 0 && prev > 0) startRegrow(prev);
      else if (v > 0) st.regrow = null;
      noteText();
      afterSteps(true);
    }
    function lastN() { return st.n.length ? st.n[st.n.length - 1] - st.c[st.c.length - 1] : 0; }
    function startRegrow(fromH) {
      var n = lastN();
      st.regrow = n < 0.9 * st.K ? { gen: st.gen, from: n / st.K, h: fromH, gens: null } : null;
    }
    function trawl(r, c) {
      var s = st.sim, a = s.alpha, k = 0;
      disc(W, r, c, 3, function (i) {
        if (s.st[i] > a || s.has[i]) { if (s.st[i] > a) { st.cut[i] = 1; k++; } kill(s, i); }
      });
      if (!k) return;
      if (st.burn === 0) {
        newHold();
        st.trawled = true;
        if (st.h === 0) {
          var n = living(s);
          st.regrow = n < 0.9 * st.K ? { gen: st.gen, from: n / st.K, h: null, gens: null } : st.regrow;
        }
      }
      st.dirty = true;
      paint();
    }
    function harvest(s, h) {
      if (h <= 0) return 0;
      var v = s.st, a = s.alpha, c = 0, i;
      for (i = 0; i < N; i++) if (v[i] > a && Math.random() < h) { kill(s, i); st.cut[i] = 1; c++; }
      return c;
    }
    function record(n, c) {
      st.n.push(n); st.c.push(c);
      if (st.n.length > 3000) { st.n.splice(0, 1000); st.c.splice(0, 1000); st.base += 1000; }
    }
    function step() {
      if (!st.sim || st.extinct) return false;
      var s = st.sim;
      s.step();
      st.gen++;
      st.cut.fill(0);
      var n = living(s);
      if (st.burn > 0) {
        st.burn--;
        record(n, 0);
        if (st.burn === 0) newHold();
        return true;
      }
      var c = harvest(s, st.h);
      record(n, c);
      if (n - c === 0 && pending(s) === 0) { die(); return false; }
      if (st.regrow && st.regrow.gens === null && st.h === 0 && n >= 0.9 * st.K) st.regrow.gens = st.gen - st.regrow.gen;
      var held = st.gen - st.holdGen;
      if (held >= 300 && held % 10 === 0) updateDot();
      return true;
    }
    function die() {
      st.extinct = { gen: st.gen, h: st.h, after: st.gen - st.holdGen };
      // a death after the visitor trawled is not a point on the harvest curve
      if (st.h > 0 && !st.trawled) {
        var list = st.dots[st.regime];
        if (st.dotRef) { st.dotRef.stock = 0; st.dotRef.yld = 0; st.dotRef.dead = true; }
        else list.push({ h: st.h, stock: 0, yld: 0, dead: true, f: st.founders });
        if (list.length > 80) list.shift();
      }
      if (st.regrow && st.regrow.gens === null) st.regrow.dead = true;
      st.dotRef = null;
    }
    function updateDot() {
      var w = windowStats();
      if (!w) return;
      if (!st.dotRef) {
        st.dotRef = { h: st.h, stock: w.stock, yld: w.yld, f: st.founders };
        st.dots[st.regime].push(st.dotRef);
        if (st.dots[st.regime].length > 80) st.dots[st.regime].shift();
      } else { st.dotRef.stock = w.stock; st.dotRef.yld = w.yld; }
    }
    // generations 150+ after the last change of h, at most the last 300 (as in harvest.js, ac1 and sd)
    function windowStats(minHeld) {
      if (st.burn > 0 || !st.sim) return null;
      var held = st.gen - st.holdGen;
      if (held < (minHeld || 200)) return null;
      var g0 = Math.max(st.holdGen + 150, st.gen - 300) + 1, g, m = 0, sn = 0, sc = 0, xs = [];
      for (g = g0; g <= st.gen; g++) {
        var ix = g - st.base - 1;
        if (ix < 0) continue;
        xs.push(st.n[ix]); sn += st.n[ix]; sc += st.c[ix]; m++;
      }
      if (m < 2) return null;
      var mean = sn / m, d = 0, num = 0, k;
      for (k = 0; k < m; k++) {
        d += (xs[k] - mean) * (xs[k] - mean);
        if (k) num += (xs[k] - mean) * (xs[k - 1] - mean);
      }
      return {
        m: m, stock: mean / st.K, yld: sc / m / st.K,
        cv: mean ? Math.sqrt(d / (m - 1)) / mean : null, ac1: d ? num / d : null
      };
    }

    /* ---------- offline references ---------- */

    function row(h) {
      var rows = REG[st.regime].rows, k;
      for (k = 0; k < rows.length; k++) if (Math.abs(rows[k][0] - h) < 1e-9) return rows[k];
      return null;
    }
    function extGens(h) {
      var e = REG[st.regime].ext, k;
      for (k in e) if (Math.abs(parseFloat(k) - h) < 1e-9) return e[k];
      return null;
    }
    function noteText() {
      var t;
      if (st.regime === 'inf') {
        t = 'No mortality: a cell lives until it is fished, and an empty site next to a living cell refills at about the ' +
          'inheritance rate ip. Offline (5 runs): the best catch, 0.0555 K per generation, comes at h ≈ 0.16 with the stock at ' +
          '0.35 K; at h = 0.25, 3 of 5 stocks die within 1000 generations.';
      } else if (st.regime === 'b8') {
        t = 'A lifespan budget of 8 generations, ip 0.20. Offline (5 runs): the best catch, 0.161 K per generation, comes at ' +
          'h = 0.25 with the stock at 0.645 K; at h = 0.37 the stock collapses.';
      } else {
        t = 'A lifespan budget of 4 generations, ip 0.10. Offline (5 runs): the best catch, 0.051 K per generation, comes at ' +
          'h = 0.085 with the stock at 0.61 K; at h = 0.13 the stock collapses.';
      }
      if (st.preset === 'over') {
        t += ' Over-fishing at h = 0.30 killed all 5 offline stocks within 99–157 generations; press Stop fishing before ' +
          'that to watch what is left regrow.';
      } else if (st.preset === 'edge') {
        t += ' At h = 0.24 all 5 offline stocks survived, but they swing: the coefficient of variation is 0.17 and the lag-1 ' +
          'autocorrelation about 0.95, against 0.02 and about 0.8 at the best rate.';
      } else if (st.preset === 'gentle') {
        t += ' Under light fishing the stock settles near ip/(ip + h) = 0.667 K (offline 0.661 K).';
      } else if (st.preset === 'msy') {
        t += ' Schaefer’s logistic model puts the best catch at half of K; here it is about a third.';
      }
      if (st.founders === 'always') {
        t += ' Founders: one engineered genome that stays alive in any neighbourhood, cloned without mutation. Offline ' +
          '(3 runs each, b = ∞): at h = 0.24 it keeps 0.083 of the grid against 0.074 for random founders, also cloned without ' +
          'mutation; both die at 0.26.';
      }
      note.textContent = t;
    }

    /* ---------- the loop ---------- */

    var tRead = kit.every(150), tChart = kit.every(250), tDist = kit.every(700);
    function frame(t) {
      var n = 0;
      if (st.playing && !st.extinct) n = clock.run(t, step, st.burn > 0);
      if (n || st.dirty) paint();
      afterSteps(false, t);
    }
    function afterSteps(force, t) {
      t = t === undefined ? performance.now() : t;
      if (force || tDist(t)) st.dist = st.sim ? distinctGenomes(st.sim) : null;
      if (force || tRead(t)) readouts();
      if (force || tChart(t)) { drawTime(); drawCurve(); }
      if (force) paint();
    }
    function paint() {
      st.dirty = false;
      var s = st.sim;
      if (!s) return;
      var v = s.st, a = s.alpha, ghc = st.view === 'ghc', cut = st.cut;
      kit.draw(cv, W, W, function (i, rgb) {
        var c;
        if (v[i] > a) c = ghc ? ghcColour(s, i) : S.magma((v[i] - a) / (1 - a));
        else if (cut[i]) c = FLASH;
        else return;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      });
    }

    function readouts() {
      var Rg = REG[st.regime], inf = st.regime === 'inf';
      var n = st.n.length ? st.n[st.n.length - 1] : 0, c = st.c.length ? st.c[st.c.length - 1] : 0;
      var held = st.gen - st.holdGen, w = windowStats(), rw = row(st.h);
      R.set('gen', st.burn > 0 ? 'burn-in ' + (BURN - st.burn) + '/' + BURN : String(st.gen));
      R.set('hold', st.burn > 0 ? '–' : String(held), st.burn > 0 ? 'starts after the burn-in' : '');
      R.set('stock', fmt(n / st.K, 3));
      R.set('catch', st.burn > 0 ? '–' : String(c));
      var fished = st.h > 0, idle = st.burn > 0 || st.extinct;
      // the offline rows were run with random founders
      var ow = st.founders === 'always' ? 'offline, random founders' : 'offline';
      function off(v, d) {
        if (!rw || !fished) return '';
        if (rw[7] === 5) return ow + ': 5 of 5 extinct';
        return ow + ' ' + fmt(v, d) + (rw[7] ? ' (' + rw[7] + ' of 5 extinct)' : '');
      }
      R.set('mc', !fished ? '–' : w ? fmt(w.yld, 4) : (idle ? '–' : '…'), off(rw && rw[4], 4));
      R.set('ms', w ? fmt(w.stock, 3) : (idle ? '–' : '…'),
        off(rw && rw[1], 3) + (inf && fished ? (rw ? '\n' : '') + 'ip/(ip+h) ' + fmt(0.1 / (0.1 + st.h), 3) +
          (st.h > 0.1 + 1e-9 ? ', a law that holds for h ≤ ip' : '') : ''));
      R.set('cv', w ? fmt(w.cv, 3) : '–', inf ? 'offline 0.02 at h 0.16,\n0.17 at 0.24' : '');
      R.set('ac', w ? fmt(w.ac1, 2) : '–', inf ? 'offline 0.80–0.95' : '');
      var rg = st.regrow, rtxt = '–', rref = '';
      if (rg) {
        rtxt = rg.gens !== null ? rg.gens + ' gens' : rg.dead ? 'none' : '… ' + (st.gen - rg.gen);
        rref = 'from ' + fmt(rg.from, rg.from < 0.1 ? 3 : 2) + ' K';
        var rr = rg.h !== null ? row(rg.h) : null;
        if (rr && rr[8] !== null && rr[0] > 0) {
          rref += '\noffline ' + Math.round(rr[8]) + ' from h ' + rr[0] + ' (' + (5 - rr[7]) + ' run' + (5 - rr[7] === 1 ? '' : 's') + ')';
        }
      }
      R.set('regrow', rtxt, rref);
      var alive = n - c;
      R.set('dist', st.dist === null ? '–' : String(st.dist),
        st.dist !== null && alive > 0 ? fmt(st.dist / alive, 2) + ' per cell' + (inf ? '\noffline 0.015 at h 0,\n0.54 at h 0.15' : '') : '');
      R.set('msy', fmt(Rg.hMSY, Rg.hMSY < 0.1 ? 3 : 2), 'catch ' + fmt(Rg.MSYperK, 4) + ' K\nstock ' + fmt(Rg.stockAtMSY, 3) + ' K');
      var cr = row(Rg.collapseH);
      R.set('col', fmt(Rg.collapseH, 2), cr ? cr[7] + ' of 5 extinct in 1000 gens' : '');
      status(n, c, w, rw);
    }
    function status(n, c, w, rw) {
      var v = 'Fishing', cls = 'na', t = '';
      var eg = extGens(st.h);
      if (st.extinct) {
        v = 'Extinct'; cls = 'bad';
        t = st.extinct.h > 0
          ? 'After ' + st.extinct.after + ' generations at h = ' + st.extinct.h.toFixed(3) + '.'
          : 'The stock died out.';
        if (eg && st.extinct.h > 0) {
          t += ' Offline at this h' + (st.founders === 'always' ? ', with random founders' : '') + ': ' + eg.length + ' of 5 runs died, after ' + span(eg, 0) + ' generations.';
        }
        t += ' Nothing can be born next to an empty site: reseed.';
      } else if (st.burn > 0) {
        v = 'Unfished burn-in';
        t = 'The stock grows unfished for ' + BURN + ' generations, as offline; fishing at h = ' + st.h.toFixed(3) + ' starts after.';
        if (!st.playing) t += ' Press Play.';
      } else if (st.h === 0) {
        if (st.regrow) {
          v = st.regrow.gens !== null ? 'Regrown' : 'Regrowing';
          cls = st.regrow.gens !== null ? 'ok' : 'na';
          var fromTxt = fmt(st.regrow.from, st.regrow.from < 0.1 ? 3 : 2);
          t = st.regrow.gens !== null
            ? 'Back to 0.9 K in ' + st.regrow.gens + ' generations, from ' + fromTxt + ' K. Regrowth takes longer from a smaller remnant; up to h = 0.2, offline, a stock thinned at random to the same size regrew as fast.'
            : 'Fishing stopped at ' + fromTxt + ' K, ' + (st.gen - st.regrow.gen) + ' generations ago.';
        } else { v = 'Unfished'; t = 'Move h to start fishing.'; }
      } else {
        var held = st.gen - st.holdGen;
        if (!w) t = 'Settling at h = ' + st.h.toFixed(3) + ': the means start 200 generations after the last change (' + held + ' so far).';
        else {
          v = 'Fishing'; cls = 'na';
          t = 'Mean of generations ' + Math.max(150, held - 300) + '–' + held + ' at this h: catch ' + fmt(w.yld, 4) + ' K per generation, stock ' + fmt(w.stock, 3) + ' K.';
        }
        if (rw) {
          t += ' Offline at this h (' + (st.founders === 'always' ? 'random founders, ' : '') + '5 runs, mean of the last 300 of 1000 generations): ' +
            (rw[7] ? rw[7] + ' of 5 extinct' + (eg ? ' after ' + span(eg, 0) + ' generations' : '') + (rw[7] < 5 ? '; survivors at ' + fmt(rw[1], 3) + ' K' : '') + '.'
              : 'stock ' + fmt(rw[1], 3) + ' K, catch ' + fmt(rw[4], 4) + ' K.');
        }
      }
      if (verdict.textContent !== v) verdict.textContent = v;
      verdict.className = 'verdict ' + cls;
      if (sub.textContent !== t) sub.textContent = t;
      bStop.disabled = st.h === 0 || !!st.extinct;
    }

    /* ---------- charts ---------- */

    function drawTime() {
      var w = boxWidth(boxT, 280, 620), hh = Math.round(Math.max(200, Math.min(280, w * 0.66)));
      var g1 = Math.max(400, st.gen), g0 = g1 - 400, sp = [], cp = [], g;
      for (g = Math.max(g0 + 1, st.base + 1); g <= st.gen; g++) {
        var ix = g - st.base - 1;
        sp.push([g, st.n[ix] / st.K]);
        cp.push([g, st.c[ix] / st.K]);
      }
      var series = [], marks = [];
      if (st.burn === 0 && st.h > 0 && !st.extinct) {
        var x0 = Math.max(g0, st.holdGen);
        if (st.regime === 'inf') {
          var law = 0.1 / (0.1 + st.h);
          series.push({ label: 'ip/(ip+h)', colour: '--text-mute', dash: '2 4', width: 1.5, end: false, points: [[x0, law], [g1, law]] });
        }
        var rw = row(st.h);
        if (rw) series.push({ label: 'offline stock at this h', colour: '--alive', dash: '6 4', width: 1.5, end: false, points: [[x0, rw[1]], [g1, rw[1]]] });
      }
      series.push({ label: 'stock / K', colour: '--alive', width: 2, end: false, points: sp });
      series.push({ label: 'catch / K', colour: '--rwsp', width: 1.6, end: false, points: cp });
      if (st.holdGen > g0 && st.holdGen > BURN - 1 && st.burn === 0) marks.push({ x: st.holdGen, label: 'h ' + st.h.toFixed(3), colour: '--text-mute' });
      else if (st.burn === 0 && BURN > g0) marks.push({ x: BURN, label: 'fishing starts', colour: '--text-mute' });
      kit.chart(svgT, {
        w: w, h: hh, left: 44, right: 14, tip: tipT,
        x: { min: g0, max: g1, label: 'generation', ticks: 4 },
        y: { min: 0, max: 1, label: 'fraction of K', ticks: 4, fmt: function (v) { return fmt(v, 2); } },
        series: series, marks: marks
      });
      var li = [['--alive', 'stock / K'], ['--rwsp', 'catch / K']];
      if (series.length > 2) {
        if (st.regime === 'inf') li.push(['--text-mute', 'ip/(ip+h)', 'dash']);
        if (row(st.h)) li.push(['--alive', 'offline stock at this h' + (st.founders === 'always' ? ', random founders' : ''), 'dash']);
      }
      legend(legT, li);
    }

    function drawCurve() {
      var Rg = REG[st.regime], rows = Rg.rows.filter(function (r) { return r[0] <= 0.4 + 1e-9; });
      var w = boxWidth(boxC, 280, 900), hh = Math.round(Math.max(220, Math.min(300, w * 0.4)));
      var view = st.curve, ymaxY = 0, k;
      for (k = 0; k < rows.length; k++) ymaxY = Math.max(ymaxY, rows[k][6]);
      ymaxY = Math.ceil(ymaxY * 1.2 * 50) / 50;
      var xs, ys, line, band = null, marks = [], extra = [];
      if (view === 'hy') {
        xs = { min: 0, max: 0.4, label: 'harvest rate h', ticks: 4, fmt: function (v) { return fmt(v, 2); } };
        ys = { min: 0, max: ymaxY, label: 'catch / K per gen', ticks: 4, fmt: function (v) { return fmt(v, 2); } };
        line = rows.map(function (r) { return [r[0], r[4]]; });
        band = rows.map(function (r) { return [r[0], r[5], r[6]]; });
        marks.push({ x: Rg.hMSY, label: 'MSY', colour: '--navy-soft' });
        marks.push({ x: Rg.collapseH, label: 'collapse', colour: '--gcvp' });
      } else if (view === 'sy') {
        xs = { min: 0, max: 1, label: 'equilibrium stock / K', ticks: 5, fmt: function (v) { return fmt(v, 1); } };
        ys = { min: 0, max: ymaxY, label: 'catch / K per gen', ticks: 4, fmt: function (v) { return fmt(v, 2); } };
        line = rows.map(function (r) { return [r[1], r[4]]; });
        marks.push({ x: Rg.stockAtMSY, label: 'MSY', colour: '--navy-soft' });
        marks.push({ x: 0.5, label: 'Schaefer', colour: '--text-mute' });
      } else {
        xs = { min: 0, max: 0.4, label: 'harvest rate h', ticks: 4, fmt: function (v) { return fmt(v, 2); } };
        ys = { min: 0, max: 1, label: 'equilibrium stock / K', ticks: 4, fmt: function (v) { return fmt(v, 2); } };
        line = rows.map(function (r) { return [r[0], r[1]]; });
        band = rows.map(function (r) { return [r[0], r[2], r[3]]; });
        if (st.regime === 'inf') {
          var lp = [];
          for (k = 0; k <= 40; k++) lp.push([k / 100, 0.1 / (0.1 + k / 100)]);
          extra.push({ label: 'ip/(ip+h)', colour: '--text-mute', dash: '2 4', width: 1.5, end: false, points: lp });
        }
      }
      if (view !== 'sy' && st.burn === 0 && !st.extinct) marks.push({ x: st.h, colour: '--alive' });
      var spec = {
        w: w, h: hh, left: 50, right: 16, tip: tipC, x: xs, y: ys, marks: marks,
        series: extra.concat([{ label: 'offline mean', colour: '--navy-soft', width: 2, end: false, points: line }])
      };
      kit.chart(svgC, spec);
      var sc = scaler(spec), el = S.el;
      if (band) {
        var d = '', j;
        for (j = 0; j < band.length; j++) d += (j ? 'L' : 'M') + sc.X(band[j][0]).toFixed(1) + ',' + sc.Y(band[j][2]).toFixed(1);
        for (j = band.length - 1; j >= 0; j--) d += 'L' + sc.X(band[j][0]).toFixed(1) + ',' + sc.Y(band[j][1]).toFixed(1);
        var poly = el('path', { d: d + 'Z', fill: S.rgba(col('--navy-soft'), 0.18), stroke: 'none' });
        svgC.insertBefore(poly, svgC.querySelector('path'));
      }
      // the visitor's runs: one dot per h held >= 300 generations (hollow ring = still running, cross = died)
      var pts = st.dots[st.regime].slice(), live = windowStats(160);
      function xy(p) { return view === 'hy' ? [p.h, p.yld] : view === 'sy' ? [p.stock, p.yld] : [p.h, p.stock]; }
      pts.forEach(function (p) {
        var q = xy(p), cx = sc.X(q[0]), cy = Math.min(sc.Y(0), sc.Y(q[1])), c = col(p.f === 'always' ? '--chem' : '--alive');
        var m = p.dead
          ? el('path', { d: 'M' + (cx - 4) + ',' + (cy - 4) + 'L' + (cx + 4) + ',' + (cy + 4) + 'M' + (cx - 4) + ',' + (cy + 4) + 'L' + (cx + 4) + ',' + (cy - 4), stroke: c, 'stroke-width': 2 })
          : el('circle', { cx: cx, cy: cy, r: 4.2, fill: c, stroke: col('--bg'), 'stroke-width': 1 });
        var tt = el('title', {}, 'your run: h ' + p.h.toFixed(3) + (p.dead ? ', died' : ', catch ' + fmt(p.yld, 4) + ' K, stock ' + fmt(p.stock, 3) + ' K'));
        m.appendChild(tt);
        svgC.appendChild(m);
      });
      if (live && !st.dotRef && st.h > 0 && !st.extinct) {
        var q = xy({ h: st.h, stock: live.stock, yld: live.yld });
        svgC.appendChild(el('circle', { cx: sc.X(q[0]), cy: sc.Y(q[1]), r: 5, fill: 'none', stroke: col(st.founders === 'always' ? '--chem' : '--alive'), 'stroke-width': 2 }));
      }
      var li = [['--navy-soft', 'offline mean, 5 runs' + (st.founders === 'always' ? ', random founders' : '')], ['--navy-soft', 'min–max', 'band']];
      if (view === 'sy') li.pop();
      if (extra.length) li.push(['--text-mute', 'refill law ip/(ip+h)', 'dash']);
      li.push(['--alive', 'your runs (≥ 300 gens at one h)', 'dot']);
      if (st.dots[st.regime].some(function (p) { return p.f === 'always'; }) || st.founders === 'always') li.push(['--chem', 'your runs, always-viable', 'dot']);
      if (st.dots[st.regime].some(function (p) { return p.dead; })) li.push(['--alive', 'your run died', 'cross']);
      li.push(['--alive', 'this h, still settling', 'ring']);
      legend(legC, li);
    }

    reseed();
    return {
      frame: frame,
      show: function () { afterSteps(true); },
      redraw: function () { drawTime(); drawCurve(); paint(); }
    };
  }

  /* ==========================================================
     Tab 2: foraging colonies
     ========================================================== */

  function Forage(host, kit, D) {
    var FD = D.forage;
    var WORLDS = {
      quality: { label: 'Quality 0.25 · 0.5 · 0.75 · 1', kind: 'ifd' },
      input_lo: { label: 'Input 2 : 4 : 8 : 16', kind: 'ifd' },
      input_hi: { label: 'Input 6 : 12 : 24 : 48', kind: 'ifd' },
      input_eq: { label: 'Equal input', kind: 'ifd' },
      nest: { label: 'Nest and five patches', kind: 'nest' },
      bridge: { label: 'Double bridge', kind: 'bridge' },
      genome: { label: 'Density-threshold genome', kind: 'genome' }
    };
    var GAPS = [3, 6, 10, 15, 22];
    var FIELD = { dep: 1, rho: 0.05, theta: 4, n: 2 };
    var st = {
      world: 'input_lo', bg: 2, corr: 'inf', founders: 'dt', view: 'alpha', brush: 'food',
      w: null, gen: 0, dead: false, playing: !kit.reduceMotion, dirty: true, x: null
    };
    var clock = Clock(RATES.fast);

    /* ---------- markup ---------- */

    var patchHost = h('div', { role: 'group', 'aria-label': 'Food-patch worlds' });
    var colonyHost = h('div', { role: 'group', 'aria-label': 'Colony worlds' });
    var optHost = h('div', { class: 'eco-opts' });
    host.appendChild(h('div', { class: 'presetrows' }, [
      h('span', { class: 'ctl-label', text: 'Food patches' }), patchHost,
      h('span', { class: 'ctl-label', text: 'Colonies' }), colonyHost,
      h('span', { class: 'ctl-label', text: 'Setting' }), optHost
    ]));
    var note = h('p', { class: 'note presetnote', 'aria-live': 'polite' });
    host.appendChild(note);

    var cv = h('canvas', { class: 'cv draw', width: 64, height: 64, 'aria-label': 'The colony world; green is food, grey is wall. Drag to paint food or wipe cells.' });
    var cvCap = h('em', { text: 'drag to paint food' });
    var labHost = h('div', { class: 'eco-labels', 'aria-hidden': 'true' });
    var cvWrap = h('div', { class: 'eco-cvwrap' }, [cv, labHost]);
    var side = h('div', {});
    var svgA = svgBox('Live result for this world'), tipA = h('div', { class: 'tip' }), legA = h('div', { class: 'legend' });
    var boxA = h('div', { class: 'chartbox' }, [svgA, tipA]);
    var tblWrap = h('div', { class: 'tablewrap' });
    var sideHead = h('p', { class: 'kicker eco-sidehead' });
    side.appendChild(sideHead);
    side.appendChild(boxA);
    side.appendChild(tblWrap);
    side.appendChild(legA);

    var R = readGrid([['a', ''], ['b', ''], ['c', ''], ['d', ''], ['e', ''], ['f', '']]);
    var verdict = h('p', { class: 'verdict na', 'aria-live': 'polite', text: '–' });
    var sub = h('p', { class: 'eco-sub' });
    var bPlay = btn(st.playing ? 'Pause' : 'Play', 'btn primary'), bStep = btn('Step'), bRestart = btn('Restart');
    var speedRow = h('div', { class: 'controls eco-tight' }, [h('span', { class: 'ctl-label', text: 'Speed' })]);
    var viewRow = h('div', { class: 'controls eco-tight' }, [h('span', { class: 'ctl-label', text: 'Colour' })]);
    var brushRow = h('div', { class: 'controls eco-tight' }, [h('span', { class: 'ctl-label', text: 'Drag' })]);
    var rule = h('p', { class: 'note eco-rule' });

    host.appendChild(h('div', { class: 'lab' }, [
      h('div', {}, [
        h('div', { class: 'eco-stage' }, [
          h('figure', { class: 'cvfig' }, [cvWrap, h('figcaption', {}, [h('span', { text: 'The world' }), cvCap])]),
          side
        ]),
        rule
      ]),
      h('div', { class: 'readout' }, [
        R.el, verdict, sub,
        h('div', { class: 'controls', style: 'margin-bottom:8px' }, [bPlay, bStep, bRestart]),
        speedRow, viewRow, brushRow
      ])
    ]));

    /* ---------- controls ---------- */

    var pickA = kit.pills(patchHost, ['quality', 'input_lo', 'input_hi', 'input_eq'].map(function (k) { return { key: k, label: WORLDS[k].label }; }),
      function (k) { pickB.set(''); setWorld(k); }, st.world);
    var pickB = kit.pills(colonyHost, ['nest', 'bridge', 'genome'].map(function (k) { return { key: k, label: WORLDS[k].label }; }),
      function (k) { pickA.set(''); setWorld(k); }, '');
    toggle(speedRow, 'Simulation speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], 'fast',
      function (k) { clock.rate = RATES[k]; });
    toggle(viewRow, 'Colour the living cells by', [['alpha', 'α'], ['ghc', 'genome hash']], 'alpha',
      function (k) { st.view = k; paint(); });
    toggle(brushRow, 'What dragging on the world does', [['food', 'paint food'], ['wipe', 'wipe cells']], st.brush,
      function (k) { st.brush = k; cvCap.textContent = k === 'food' ? 'drag to paint food' : 'drag to wipe cells'; });
    bPlay.addEventListener('click', function () { setPlaying(!st.playing); });
    bStep.addEventListener('click', function () { setPlaying(false); step(); refresh(true); });
    bRestart.addEventListener('click', function () { setWorld(st.world); });

    noSelect(cv);
    kit.pointer(cv, function () { return st.w ? st.w.W : 64; }, function () { return st.w ? st.w.W : 64; }, function (r, c, phase) {
      if (phase === 'up' || !st.w) return;
      var w = st.w, s = w.s;
      if (r < 0 || c < 0 || r >= w.W || c >= w.W) return;
      st.poked = true;
      if (st.brush === 'food') w.disc(r, c, 2, function (i) { if (!w.wall[i]) w.q[i] = 1; });
      else w.disc(r, c, 3, function (i) { if (s.has[i] || s.st[i] > s.alpha) kill(s, i); });
      paint();
    });

    function setPlaying(on) {
      st.playing = on;
      clock.reset();
      bPlay.textContent = on ? 'Pause' : 'Play';
      if (!on && st.w) refresh(true);                   // show the paused state at once
    }

    function options() {
      S.clear(optHost);
      var k = WORLDS[st.world].kind;
      optHost.className = 'eco-opts';
      function pills(label, items, cur, pick) {
        var g = h('div', { role: 'group', 'aria-label': label });
        optHost.appendChild(g);
        kit.pills(g, items.map(function (it) { return { key: it[0], label: it[1] }; }), pick, cur);
      }
      if (k === 'nest') {
        pills('Ground between the patches', [['2', 'ground b = 2: cells die out'], ['3', 'ground b = 3: marginal']], String(st.bg),
          function (v) { st.bg = +v; setWorld('nest'); });
      } else if (k === 'bridge') {
        pills('Corridors', [['inf', 'no ageing (b = ∞)'], ['b3', 'b = 3'], ['field', 'b = 3 + trail field'], ['cap', 'b = 3 + trail field + colony cap 408']], st.corr,
          function (v) { st.corr = v; setWorld('bridge'); });
      } else if (k === 'genome') {
        pills('Founders', [['dt', 'density-threshold genome'], ['xavier', 'random genomes']], st.founders,
          function (v) { st.founders = v; setWorld('genome'); });
      } else {
        optHost.appendChild(h('span', { class: 'eco-optnote', text: '64 × 64, ground b = 2, ip 0.10, ppp 0.02; founders scattered at 8%' }));
      }
    }

    /* ---------- worlds (the measured geometries) ---------- */

    function setWorld(key) {
      st.world = key;
      st.gen = 0; st.dead = false; st.poked = false;
      var k = WORLDS[key].kind, w, x = { kind: k };
      if (k === 'ifd') {
        var c = FD.ifd[key], isQ = key === 'quality';
        w = World({ W: 64, ip: 0.10, ppp: 0.02, budget: 2, R: isQ ? null : c.vals.slice() });
        var corners = [[9, 9], [9, 41], [41, 9], [41, 41]];
        corners.forEach(function (cr, p) {
          w.rect(cr[0], cr[1], 14, 14, function (i) { w.patch[i] = p; if (isQ) w.q[i] = c.vals[p]; });
        });
        x.ref = c; x.tint = c.vals.map(function (v) { return v / Math.max.apply(null, c.vals); });
        x.occ = []; x.bg = []; x.isQ = isQ;
        x.labels = corners.map(function (cr, p) { return [cr[0] - 3, cr[1] + 6.5, (isQ ? 'q ' : 'R ') + c.vals[p]]; });
        w.s.seed(0.08);
      } else if (k === 'nest') {
        w = World({ W: 96, ip: 0.10, ppp: 0.02, budget: st.bg });
        var ctr = 48;
        x.pc = GAPS.map(function (d, j) {
          var a = (j / GAPS.length) * 2 * Math.PI + 0.3, rr = 6 + d + 5;
          return [Math.round(ctr + rr * Math.sin(a)), Math.round(ctr + rr * Math.cos(a))];
        });
        w.disc(ctr, ctr, 6, function (i) { w.q[i] = 1; w.patch[i] = 9; });
        x.pc.forEach(function (p, j) { w.disc(p[0], p[1], 5, function (i) { w.q[i] = 1; w.patch[i] = j; }); });
        w.s.seed(0, function (s) { w.disc(ctr, ctr, 6, function (i) { if (Math.random() < 0.5) s.found(i); }); });
        x.labels = [[ctr, ctr, 'nest']].concat(x.pc.map(function (p, j) { return [p[0], p[1], 'gap ' + GAPS[j]]; }));
        x.first = GAPS.map(function () { return -1; });
        x.cnt = [0, 0, 0, 0, 0, 0];
        x.modal = null;
      } else if (k === 'bridge') {
        var field = st.corr === 'field' || st.corr === 'cap';
        w = World({ W: 72, ip: 0.10, ppp: 0.02, budget: st.corr === 'inf' ? Infinity : 3, field: field ? FIELD : null, cap: st.corr === 'cap' ? 408 : 0 });
        buildBridge(w, x);
        x.labels = [[35.5, 9.5, 'nest'], [35.5, 41.5, 'food'], [21, 25.5, 'short branch'], [63.5, 25.5, 'long branch']];
        w.s.seed(0, function (s) { w.rect(x.nest[0], x.nest[1], 12, 12, function (i) { if (Math.random() < 0.5) s.found(i); }); });
      } else {
        var dt = st.founders === 'dt', G = new Float32Array(P), corners48 = [[7, 7], [7, 31], [31, 7], [31, 31]];
        FD.genome.G.forEach(function (v, j) { G[j] = v; });
        w = World({ W: 48, ip: 0.10, ppp: dt ? 0 : 0.02, budget: 4 });
        corners48.forEach(function (cr, p) { w.rect(cr[0], cr[1], 10, 10, function (i) { w.q[i] = 0.75; w.patch[i] = p; }); });
        w.s.seed(0, function (s) { for (var i = 0; i < s.N; i++) if (Math.random() < 0.08) s.found(i, dt ? G : undefined); });
        x.share = []; x.samples = []; x.held = 0; x.alive = 0; x.labels = [];
      }
      st.w = w; st.x = x;
      S.clear(labHost);
      x.labels.forEach(function (L) {
        var e = h('span', { text: L[2] });
        e.style.left = ((L[1] + 0.5) / w.W * 100) + '%';
        e.style.top = ((L[0] + 0.5) / w.W * 100) + '%';
        labHost.appendChild(e);
      });
      clock.reset();
      options();
      noteText();
      layoutSide();
      refresh(true);
    }

    // port of bridge.js build(), unequal branches: short upper corridor, long lower one
    function buildBridge(w, x) {
      var nest = [30, 4], food = [30, 36], S12 = 12, up = 4, dn = 24;
      x.nest = nest; x.food = food;
      w.wall.fill(1);
      function open(i0, j0, hh, wd, br) {
        w.rect(i0, j0, hh, wd, function (i) { w.wall[i] = 0; if (br !== undefined && w.patch[i] < 0) w.patch[i] = br; });
      }
      open(nest[0], nest[1], S12, S12); w.rect(nest[0], nest[1], S12, S12, function (i) { w.q[i] = 1; w.patch[i] = 8; });
      open(food[0], food[1], S12, S12); w.rect(food[0], food[1], S12, S12, function (i) { w.q[i] = 1; w.patch[i] = 9; });
      var jL = nest[1] + 4, jR = food[1] + 5;
      open(nest[0] - up - 3, jL, up + 3, 3, 0); open(nest[0] - up - 3, jL, 3, jR - jL + 3, 0); open(food[0] - up - 3, jR, up + 3, 3, 0);
      open(nest[0] + S12, jL, dn + 3, 3, 1); open(nest[0] + S12 + dn, jL, 3, jR - jL + 3, 1); open(food[0] + S12, jR, dn + 3, 3, 1);
      x.len = [0, 0];
      for (var i = 0; i < w.N; i++) if (w.patch[i] === 0 || w.patch[i] === 1) x.len[w.patch[i]]++;
      x.firstFood = -1; x.firstVia = -1; x.samples = []; x.last = { a: 0, b: 0, f: 0 };
    }

    function step() {
      if (!st.w || st.dead) return false;
      var w = st.w, s = w.s, x = st.x, N = w.N, a = s.alpha, v, i, p;
      w.step();
      st.gen++;
      v = s.st;
      var total = 0;
      if (x.kind === 'ifd') {
        var n = [0, 0, 0, 0], b = 0;
        for (i = 0; i < N; i++) if (v[i] > a) { total++; p = w.patch[i]; if (p >= 0) n[p]++; else b++; }
        x.occ.push(n); x.bg.push(b);
        if (x.occ.length > 300) { x.occ.shift(); x.bg.shift(); }
      } else if (x.kind === 'nest') {
        var cnt = [0, 0, 0, 0, 0, 0];
        for (i = 0; i < N; i++) if (v[i] > a) { total++; p = w.patch[i]; if (p === 9) cnt[5]++; else if (p >= 0) cnt[p]++; }
        for (p = 0; p < 5; p++) if (cnt[p] && x.first[p] < 0) x.first[p] = st.gen;
        x.cnt = cnt;
      } else if (x.kind === 'bridge') {
        var A = 0, B = 0, F = 0;
        for (i = 0; i < N; i++) if (v[i] > a) { total++; p = w.patch[i]; if (p === 0) A++; else if (p === 1) B++; else if (p === 9) F++; }
        if (F && x.firstFood < 0) {
          x.firstFood = st.gen;
          var near = [0, 0], W = w.W, fd = x.food;
          for (i = 0; i < N; i++) if (v[i] > a && (w.patch[i] === 0 || w.patch[i] === 1)) {
            var r = (i / W) | 0, cc = i % W;
            if (cc >= fd[1] + 4 && cc <= fd[1] + 8 && (Math.abs(r - fd[0]) <= 4 || Math.abs(r - (fd[0] + 11)) <= 4)) near[w.patch[i]]++;
          }
          x.firstVia = near[0] > near[1] ? 0 : near[1] > near[0] ? 1 : -1;
        }
        x.last = { a: A, b: B, f: F };
        if ((st.gen - 1) % 10 === 0) x.samples.push([st.gen, A + B ? A / (A + B) : 0.5, A / x.len[0], B / x.len[1]]);
      } else {
        var on = 0, hp = [0, 0, 0, 0];
        for (i = 0; i < N; i++) if (v[i] > a) { total++; p = w.patch[i]; if (p >= 0) { on++; hp[p]++; } }
        x.share.push(total ? on / total : 0);
        if (x.share.length > 100) x.share.shift();
        x.held = hp.filter(function (q) { return q > 0; }).length;
        x.alive = total;
        if (st.gen % 5 === 0) x.samples.push([st.gen, total ? on / total : 0]);
      }
      if (total === 0 && pending(s) === 0) { st.dead = true; return false; }
      return true;
    }

    /* ---------- the loop ---------- */

    var tRead = kit.every(150), tChart = kit.every(300), tModal = kit.every(600);
    function frame(t) {
      var n = 0;
      if (st.playing && !st.dead) n = clock.run(t, step, false);
      if (n || st.dirty) paint();
      refresh(false, t);
    }
    function refresh(force, t) {
      t = t === undefined ? performance.now() : t;
      if (st.x && st.x.kind === 'nest' && (force || tModal(t))) modalGenomes();
      if (force || tRead(t)) readouts();
      if (force || tChart(t)) drawSide();
      if (force) paint();
    }
    function paint() {
      st.dirty = false;
      var w = st.w;
      if (!w) return;
      var s = w.s, v = s.st, a = s.alpha, ghc = st.view === 'ghc', x = st.x, f = w.field;
      kit.draw(cv, w.W, w.W, function (i, rgb) {
        var c;
        if (v[i] > a) c = ghc ? ghcColour(s, i) : S.magma((v[i] - a) / (1 - a));
        else if (w.wall[i]) c = WALL;
        else {
          var lv = w.q[i];
          if (x.kind === 'ifd' && !x.isQ && w.patch[i] >= 0) lv = Math.max(lv, x.tint[w.patch[i]]);
          if (lv > 0) { rgb[0] = 14 + 18 * lv; rgb[1] = 34 + 46 * lv; rgb[2] = 24 + 26 * lv; return; }
          if (f && w.phi[i] > 0.05) {
            var z = w.phi[i] / (w.phi[i] + f.theta);
            rgb[0] = 20 * z; rgb[1] = 40 * z; rgb[2] = 30 + 110 * z; return;
          }
          return;
        }
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      });
    }

    function noteText() {
      var t = '', r = '<b>Added rules, not in <span class="mono">nca.py</span>:</b> ';
      var k = st.world;
      if (k === 'quality') {
        t = 'Four 14 × 14 patches on ground where unfed cells die out. On a patch of quality q a living cell skips its ageing with probability q each generation; this food never runs out.';
        r += 'food of quality q lets a cell skip ageing.';
      } else if (k === 'input_lo' || k === 'input_hi' || k === 'input_eq') {
        var vals = FD.ifd[k].vals;
        t = (k === 'input_eq' ? 'A control: every patch gets 12 food units per generation.' :
          'Food arrives at fixed rates of ' + vals.join(', ') + ' units per generation and is shared:') +
          ' each unit lets one random resident of the patch skip its ageing that generation. Cells do not move between patches; a patch fills by birth from its own residents.';
        r += 'food units handed to random residents let them skip ageing.';
      } else if (k === 'nest') {
        t = 'A colony starts in a nest of full food (q = 1) in a 96 × 96 grid. Five full-food patches sit 3, 6, 10, 15 and 22 cells from the nest across ground of budget ' + st.bg +
          (st.bg === 2 ? ', where cells away from food die out.' : ', where cells barely persist.') +
          ' On full food a cell never ages, so a reached patch is held.';
        r += 'food of quality q = 1 stops ageing.';
      } else if (k === 'bridge') {
        t = 'Walls leave two 3-wide corridors from the nest (left) to the food (right): the upper branch is short, the lower one about twice as long. Argentine ants end up on one branch, the shorter one when they differ.' +
          (st.corr === 'inf' ? ' Here the corridors do not age cells at all.' : st.corr === 'b3' ? ' Corridors at b = 3, with no trail.' :
            st.corr === 'field' ? ' Corridors at b = 3 with an added persistent trail field (blue where no cell lives).' : ' Trail field plus a fixed colony size of 408 cells.');
        r += 'walls are cleared every generation; nest and food are q = 1 food' +
          (st.corr === 'field' || st.corr === 'cap' ? '; a trail field laid by living cells (decay 0.05, half effect at 4) lets a cell skip ageing' : '') +
          (st.corr === 'cap' ? '; random cells are removed above 408' : '') + '.';
      } else {
        t = st.founders === 'dt'
          ? 'Every founder carries one genome, found by a small grid search over the agent’s weights: a living cell dies without a living neighbour, and a newborn needs two. Mutation is off. Four 10 × 10 patches of q = 0.75 cover 17% of a 48 × 48 grid on ground of budget 4.'
          : 'The same world with random founders, as the substrate is (ppp 0.02). The agent cannot sense food in either case.';
        r += 'food of quality 0.75 lets a cell skip ageing with probability 0.75.';
      }
      note.textContent = t;
      rule.innerHTML = r + ' The NCA update itself is unchanged.';
    }

    /* ---------- readouts ---------- */

    function windowMeans() {
      var x = st.x, m = x.occ.length, occ = [0, 0, 0, 0], bg = 0, j, p;
      for (j = 0; j < m; j++) { for (p = 0; p < 4; p++) occ[p] += x.occ[j][p]; bg += x.bg[j]; }
      for (p = 0; p < 4; p++) occ[p] = m ? occ[p] / m : 0;
      return { m: m, occ: occ, bg: m ? bg / m : 0 };
    }
    function slope(xs, ys) {
      var n = xs.length, mx = 0, my = 0, k, sxy = 0, sxx = 0;
      for (k = 0; k < n; k++) { mx += xs[k]; my += ys[k]; }
      mx /= n; my /= n;
      for (k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) * (xs[k] - mx); }
      return sxx ? sxy / sxx : null;
    }
    function ifdStats() {
      var x = st.x, c = x.ref, wm = windowMeans(), tot = wm.occ.reduce(function (a, b) { return a + b; }, 0);
      var share = wm.occ.map(function (o) { return tot ? o / tot : 0; });
      var exp = null, intake = null;
      if (!x.isQ && st.world !== 'input_eq') {
        var lx = [], ly = [];
        for (var p = 0; p < 4; p++) if (wm.occ[p] > 0) { lx.push(Math.log(c.vals[p])); ly.push(Math.log(wm.occ[p])); }
        if (lx.length >= 2) exp = slope(lx, ly);
        intake = c.vals.map(function (v, q) { return wm.occ[q] > 0 ? v / wm.occ[q] : null; });
      }
      return { wm: wm, tot: tot, share: share, exp: exp, intake: intake, ready: st.gen >= 300 };
    }
    function modalGenomes() {
      var w = st.w, s = w.s, x = st.x, u = new Uint32Array(s.g.buffer), v = s.st, a = s.alpha;
      var maps = [], i, p, k;
      for (p = 0; p < 6; p++) maps.push(new Map());
      for (i = 0; i < w.N; i++) if (v[i] > a && w.patch[i] >= 0) {
        p = w.patch[i] === 9 ? 5 : w.patch[i];
        k = gkey(u, i);
        maps[p].set(k, (maps[p].get(k) || 0) + 1);
      }
      var modal = maps.map(function (m) {
        var best = null, bn = 0, tot = 0;
        m.forEach(function (n, key) { tot += n; if (n > bn) { bn = n; best = key; } });
        return best === null ? null : { key: best, share: bn / tot };
      });
      var pairs = 0, shared = 0;
      for (p = 0; p < 6; p++) for (k = p + 1; k < 6; k++) if (modal[p] && modal[k]) { pairs++; if (modal[p].key === modal[k].key) shared++; }
      x.modal = { per: modal, pairs: pairs, shared: shared };
    }

    function readouts() {
      var x = st.x;
      if (!x) return;
      var k = x.kind, v = 'na', vt = '–', t = '';
      var genTxt = String(st.gen);
      if (k === 'ifd') {
        var f = ifdStats(), c = x.ref;
        R.label('a', 'generation'); R.set('a', genTxt, 'offline: mean of 1000–1500, 5 runs');
        R.label('b', 'cells on the patches'); R.set('b', fmt(f.tot, 0), 'mean of the last ' + f.wm.m + ' gens');
        R.label('c', 'matching exponent'); R.set('c', f.exp === null ? '–' : (f.ready ? fmt(f.exp, 2) : '…'),
          c.exp ? 'offline ' + fmt(c.exp[0], 2) + ' (' + fmt(c.exp[1], 2) + '–' + fmt(c.exp[2], 2) + ')' : 'not defined here');
        R.label('d', 'food per cell, poorest → richest');
        R.set('d', f.intake && f.intake[0] !== null && f.intake[3] !== null ? fmt(f.intake[0], 2) + ' → ' + fmt(f.intake[3], 2) : '–',
          c.intake ? 'offline ' + fmt(c.intake[0], 2) + ' → ' + fmt(c.intake[3], 2) : '');
        R.label('e', 'cells per site off the patches'); R.set('e', fmt(f.wm.bg / (64 * 64 - 4 * 196), 4), 'offline 0.003–0.010');
        R.show('f', false);
        if (x.isQ) {
          vt = pct(f.share[3]) + ' on q = 1';
          t = 'Share of the on-patch cells on the q = 1 patch (food share 40%). Offline (5 runs): 0, 10, 26 and 64% for q = 0.25, 0.5, 0.75, 1. Cells on better food live longer, so the colony ends up there.';
        } else if (st.world === 'input_eq') {
          vt = f.share.map(function (q) { return pct(q); }).join(' · ');
          t = 'Equal input gives equal shares. Offline (5 runs): 25% each (24–26%).';
        } else {
          vt = f.exp === null || !f.ready ? 'Settling…' : 'Exponent ' + fmt(f.exp, 2);
          t = 'Slope of log(cells) against log(input) over the four patches: 1 would be input matching, as the ideal free distribution predicts. Below 1, each cell on a rich patch gets more food. Offline (5 runs): ' +
            fmt(c.exp[0], 2) + ' (' + fmt(c.exp[1], 2) + '–' + fmt(c.exp[2], 2) + ').';
        }
      } else if (k === 'nest') {
        var reached = x.first.filter(function (g) { return g > 0; }).length, m = x.modal;
        R.label('a', 'generation'); R.set('a', genTxt, st.gen > 2000 ? 'past the 2000-gen horizon' : 'offline horizon 2000');
        R.label('b', 'patches reached'); R.set('b', reached + ' of 5');
        R.label('c', 'cells in the nest'); R.set('c', String(x.cnt[5]));
        R.label('d', 'cells on the patches'); R.set('d', String(x.cnt[0] + x.cnt[1] + x.cnt[2] + x.cnt[3] + x.cnt[4]));
        R.label('e', 'pairs sharing their top genome');
        R.set('e', m ? m.shared + ' of ' + m.pairs : '–', st.bg === 3 ? 'offline 0 of 75 (5 runs, gen 2000)' : 'offline measured at b = 3');
        R.show('f', false);
        vt = reached + ' of 5 reached';
        v = 'na';
        t = st.bg === 2
          ? 'Offline at b = 2 (10 runs, 2000 generations): the patches 3, 6, 10, 15 and 22 cells away were reached in 10, 9, 2, 0 and 0 runs, and every reached patch was held.'
          : 'On marginal ground the colony spreads thinly. Colour by genome hash: each patch keeps its own lineage. Offline at b = 3 (5 runs): no two patches shared their most common genome.';
      } else if (k === 'bridge') {
        var L = x.len, tail = x.samples.slice(-50), sh = null, d0 = null, d1 = null;
        if (tail.length) {
          sh = tail.reduce(function (a, q) { return a + q[1]; }, 0) / tail.length;
          d0 = tail.reduce(function (a, q) { return a + q[2]; }, 0) / tail.length;
          d1 = tail.reduce(function (a, q) { return a + q[3]; }, 0) / tail.length;
        }
        var ref = FD.bridge[st.corr === 'b3' ? 'none' : st.corr], lenShare = L[0] / (L[0] + L[1]);
        R.label('a', 'generation'); R.set('a', genTxt, 'offline horizon ' + (st.corr === 'inf' ? 1500 : 2500));
        R.label('b', 'food first reached'); R.set('b', x.firstFood > 0 ? 'gen ' + x.firstFood : '–',
          x.firstFood > 0 ? (x.firstVia === 0 ? 'by the short branch' : x.firstVia === 1 ? 'by the long branch' : 'both at once') : '');
        R.label('c', 'short-branch share of branch cells'); R.set('c', fmt(sh, 3), ref ? 'offline final ' + fmt(ref.shareMean, 3) + ' ± ' + fmt(ref.shareSd, 3) : 'mean of the last 500 gens');
        R.label('d', 'share by length'); R.set('d', fmt(lenShare, 3), L[0] + ' vs ' + L[1] + ' sites');
        R.label('e', 'short branch filled'); R.set('e', pct(d0), '');
        R.label('f', 'long branch filled'); R.set('f', pct(d1), ''); R.show('f', true);
        if (x.firstFood < 0) { vt = 'Not there yet'; t = 'No cell has reached the food.'; }
        else {
          vt = x.firstVia === 0 ? 'Short branch first' : x.firstVia === 1 ? 'Long branch first' : 'Both branches at once';
          t = sh === null ? '' : 'Live, the short branch holds ' + fmt(sh, 3) + ' of the branch cells against ' + fmt(lenShare, 3) + ' of the branch length.';
        }
        if (ref) t += ' Offline (10 runs): food reached by the short branch first in ' + ref.firstViaShort + ' of 10, final short-branch share ' + fmt(ref.shareMean, 3) + ' against a length share of ' + fmt(ref.lengthShare, 3) + '; one branch dominated in ' + ref.dominant + ' of 10.';
        else t += ' No offline reference is shown for this setting.';
      } else {
        var mean = x.share.length ? x.share.reduce(function (a, b) { return a + b; }, 0) / x.share.length : null;
        var g = FD.genome, rf = st.founders === 'dt' ? g.dt : g.xavier;
        R.label('a', 'generation'); R.set('a', genTxt, 'offline: mean of 500–600');
        R.label('b', 'share of cells on food'); R.set('b', pct(mean, 1), 'offline ' + fmt(rf.share, 3) + ' (' + fmt(rf.shareMin, 2) + '–' + fmt(rf.shareMax, 2) + ')');
        R.label('c', 'patches held'); R.set('c', x.held + ' of 4', 'offline ' + rf.held.join(', '));
        R.label('d', 'living cells'); R.set('d', String(x.alive));
        R.label('e', 'patch share of the area'); R.set('e', pct(g.patchAreaShare, 1));
        R.show('f', false);
        vt = pct(mean, 0) + ' on food';
        t = st.founders === 'dt'
          ? 'Offline (5 held-out runs, generation 600): 87% on food against 36% for random founders, holding 2 to 4 of the 4 patches; over 3000 generations no lost patch was re-colonised.'
          : 'Random founders spread over the whole grid: offline 36% on food, all 4 patches held.';
      }
      if (st.poked) t += ' You have painted food or wiped cells in this run, so the offline numbers no longer apply to it.';
      if (st.dead) { vt = 'Extinct'; v = 'bad'; t = 'Every cell died: restart.'; }
      t = t.replace(/^\s+/, '');
      if (verdict.textContent !== vt) verdict.textContent = vt;
      verdict.className = 'verdict ' + v;
      if (sub.textContent !== t) sub.textContent = t;
    }

    /* ---------- the side panel: bars, table or chart ---------- */

    function layoutSide() {
      var k = st.x.kind;
      boxA.hidden = k === 'nest';
      tblWrap.hidden = k !== 'nest';
      sideHead.textContent = k === 'ifd' ? 'Where the colony lives, against where the food is'
        : k === 'nest' ? 'Reach across the gaps' : k === 'bridge' ? 'Which branch the colony uses' : 'How much of the colony sits on food';
      S.clear(legA);
    }
    function drawSide() {
      var x = st.x;
      if (!x) return;
      if (x.kind === 'ifd') drawBars();
      else if (x.kind === 'nest') drawTable();
      else if (x.kind === 'bridge') drawBridge();
      else drawGenome();
    }
    function drawBars() {
      var f = ifdStats(), c = st.x.ref, el = S.el;
      var W = boxWidth(boxA, 280, 560), H = Math.round(Math.max(220, Math.min(280, W * 0.62)));
      var L = 40, Rm = 8, T = 16, B = 44, iw = W - L - Rm, ih = H - T - B, ymax = 0.7;
      var Y = function (v) { return T + ih * (1 - Math.min(v, ymax) / ymax); };
      S.clear(svgA);
      svgA.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      [0, 0.2, 0.4, 0.6].forEach(function (v, j) {
        svgA.appendChild(el('line', { x1: L, x2: L + iw, y1: Y(v), y2: Y(v), class: j ? 'gridline' : 'axisline' }));
        svgA.appendChild(el('text', { x: L - 6, y: Y(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, Math.round(v * 100) + '%'));
      });
      var gw = iw / 4, bw = Math.min(28, gw * 0.3), cFood = col('--clogv'), cLive = col('--alive'), cRef = col('--text');
      for (var p = 0; p < 4; p++) {
        var x0 = L + gw * p, mid = x0 + gw / 2, food = c.inShare[p], liv = f.share[p];
        svgA.appendChild(el('rect', { x: mid - bw - 2, y: Y(food), width: bw, height: Y(0) - Y(food), fill: cFood, opacity: 0.85 }));
        svgA.appendChild(el('rect', { x: mid + 2, y: Y(liv), width: bw, height: Math.max(0, Y(0) - Y(liv)), fill: cLive }));
        var rs = c.share[p];
        svgA.appendChild(el('line', { x1: mid + 2 + bw / 2, x2: mid + 2 + bw / 2, y1: Y(rs[1]), y2: Y(rs[2]), stroke: cRef, 'stroke-width': 1.2 }));
        svgA.appendChild(el('line', { x1: mid - 1, x2: mid + bw + 5, y1: Y(rs[0]), y2: Y(rs[0]), stroke: cRef, 'stroke-width': 2.2 }));
        svgA.appendChild(el('text', { x: mid + 2 + bw / 2, y: Math.min(Y(liv), Y(rs[2])) - 5, class: 'ticktext', 'text-anchor': 'middle' }, pct(liv)));
        var lab = c.vals[p] < 1 && st.world === 'quality' ? 'q ' + c.vals[p] : (st.world === 'quality' ? 'q 1' : 'R ' + c.vals[p]);
        svgA.appendChild(el('text', { x: mid, y: T + ih + 16, class: 'ticktext', 'text-anchor': 'middle' }, lab));
        svgA.appendChild(el('text', { x: mid, y: T + ih + 31, class: 'ticktext', 'text-anchor': 'middle' }, fmt(f.wm.occ[p], 0) + ' cells'));
      }
      legend(legA, [['--clogv', 'food share', 'bar'], ['--alive', 'share of on-patch cells, live', 'bar'], ['--text', 'offline mean, 5 runs (range)']]);
    }
    function drawTable() {
      var x = st.x, ref = FD.nest['2'], m = x.modal;
      var showRef = st.bg === 2;
      var head = '<thead><tr><th>Patch</th><th>Reached at</th><th>Cells</th><th>Top genome</th>' +
        (showRef ? '<th>Offline reach</th>' : '') + '</tr></thead>';
      var rows = '<tr><td>nest</td><td>start</td><td>' + x.cnt[5] + '</td><td>' + (m && m.per[5] ? pct(m.per[5].share) : '–') + '</td>' + (showRef ? '<td></td>' : '') + '</tr>';
      for (var p = 0; p < 5; p++) {
        rows += '<tr><td>gap ' + GAPS[p] + '</td><td>' + (x.first[p] > 0 ? 'gen ' + x.first[p] : '–') + '</td><td>' + x.cnt[p] + '</td><td>' +
          (m && m.per[p] ? pct(m.per[p].share) : '–') + '</td>' + (showRef ? '<td>' + ref[p].reached + ' of 10</td>' : '') + '</tr>';
      }
      var html = '<table class="data eco-tbl">' + head + '<tbody>' + rows + '</tbody></table>';
      if (tblWrap.innerHTML !== html) tblWrap.innerHTML = html;
      if (!legA.firstChild || legA.getAttribute('data-k') !== String(st.bg)) {
        S.clear(legA);
        legA.setAttribute('data-k', String(st.bg));
        legA.appendChild(h('span', {
          text: 'Gap: cells of bare ground from the nest edge to the patch edge. Top genome: share of a patch’s cells carrying its most common genome' +
            (showRef ? '. Offline reach: runs out of 10 that reached the patch within 2000 generations, b = 2.' : ' (offline at b = 3: 0.50 on average, 0.30–0.99).')
        }));
      }
    }
    function drawBridge() {
      var x = st.x, W = boxWidth(boxA, 280, 560), H = Math.round(Math.max(210, Math.min(280, W * 0.62)));
      var T = st.corr === 'inf' ? 1500 : 2500, g1 = Math.max(T, st.gen), lenShare = x.len[0] / (x.len[0] + x.len[1]);
      var pts = x.samples.map(function (q) { return [q[0], q[1]]; });
      var marks = x.firstFood > 0 ? [{ x: x.firstFood, label: 'food reached', colour: '--text-mute' }] : [];
      kit.chart(svgA, {
        w: W, h: H, left: 44, right: 14, tip: tipA,
        x: { min: 0, max: g1, label: 'generation', ticks: 4 },
        y: { min: 0, max: 1, label: 'short-branch share', ticks: 4, fmt: function (v) { return fmt(v, 2); } },
        series: [
          { label: 'share by length', colour: '--text-mute', dash: '5 4', width: 1.5, end: false, points: [[0, lenShare], [g1, lenShare]] },
          { label: 'short-branch share', colour: '--alive', width: 2, end: false, points: pts }
        ],
        marks: marks
      });
      legend(legA, [['--alive', 'short branch’s share of branch cells, live'], ['--text-mute', 'its share of branch length', 'dash']]);
    }
    function drawGenome() {
      var x = st.x, g = FD.genome, W = boxWidth(boxA, 280, 560), H = Math.round(Math.max(210, Math.min(280, W * 0.62)));
      var g1 = Math.max(600, st.gen);
      var pts = x.samples.length > 400 ? x.samples.filter(function (q, j) { return j % Math.ceil(x.samples.length / 400) === 0; }) : x.samples;
      kit.chart(svgA, {
        w: W, h: H, left: 44, right: 14, tip: tipA,
        x: { min: 0, max: g1, label: 'generation', ticks: 4 },
        y: { min: 0, max: 1, label: 'share of cells on food', ticks: 4, fmt: function (v) { return fmt(v, 2); } },
        series: [
          { label: 'live', colour: '--alive', width: 2, end: false, points: pts },
          { label: 'genome, offline', colour: '--ghc', dash: '6 4', width: 1.8, end: false, points: [[0, g.dt.share], [g1, g.dt.share]] },
          { label: 'random, offline', colour: '--rwsp', dash: '6 4', width: 1.5, end: false, points: [[0, g.xavier.share], [g1, g.xavier.share]] },
          { label: 'patch area', colour: '--text-mute', dash: '2 4', width: 1.5, end: false, points: [[0, g.patchAreaShare], [g1, g.patchAreaShare]] }
        ]
      });
      legend(legA, [['--alive', 'live, this run'], ['--ghc', 'offline, density-threshold genome', 'dash'],
        ['--rwsp', 'offline, random founders', 'dash'], ['--text-mute', 'patch share of the area', 'dash']]);
    }

    setWorld(st.world);
    return {
      frame: frame,
      show: function () { refresh(true); },
      redraw: function () { drawSide(); paint(); }
    };
  }

  /* ---------------- styles scoped to this board ---------------- */

  var styled = false;
  function addStyle() {
    if (styled) return;
    styled = true;
    var B = '[data-board="ecology"] ';
    var css = [
      '.eco-tabs{margin-bottom:14px}',
      '.eco-stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:16px;align-items:start}',
      '.eco-wide{margin-top:16px;border-top:1px solid var(--rule);padding-top:10px}',
      '.eco-curvectl{margin-bottom:4px}',
      '.eco-tight{margin-bottom:8px}',
      '.eco-rule{margin:12px 0 0;max-width:none}',
      '.eco-sub{font-size:13.5px;color:var(--text-soft);margin:2px 0 12px;max-width:none}',
      '.eco-ref{display:block;font-size:11.5px;color:var(--text-mute);line-height:1.3;margin-top:1px;white-space:pre-line}',
      '.eco-hrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin:0 0 14px;padding:8px 12px;background:var(--panel);border:1px solid var(--rule)}',
      '.eco-hrow .slider{flex:1 1 300px;margin:0}',
      '.eco-hrow .slider label{color:var(--text)}',
      '.eco-cvwrap{position:relative}',
      '.eco-labels{position:absolute;inset:0;pointer-events:none}',
      '.eco-labels span{position:absolute;transform:translate(-50%,-50%);font-size:11px;font-weight:700;color:#fff;white-space:nowrap;text-shadow:0 0 3px #000,0 0 2px #000,0 0 1px #000}',
      '.eco-sidehead{margin:0 0 4px}',
      '.eco-optnote{font-size:13px;color:var(--text-soft);padding-top:4px}',
      '.eco-opts{display:flex;flex-wrap:wrap;gap:6px;margin:0}',
      'table.eco-tbl{font-size:13.5px;margin:4px 0}',
      'table.eco-tbl td,table.eco-tbl th{padding:5px 7px}',
      '.readout .verdict{font-size:20px}',
      '.verdict.ok{color:var(--clogv)}',
      '.verdict.bad{color:var(--gcvp)}',
      '.verdict.na{color:var(--text)}',
      '.legend{font-size:12.5px;gap:6px 14px;margin-top:6px}',
      '.chartbox[hidden],.tablewrap[hidden]{display:none}'
    ];
    var s = document.createElement('style');
    s.textContent = css.map(function (r) { return B + r; }).join('\n') +
      '\n@media (max-width:700px){' + B + '.eco-stage{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }
})();
