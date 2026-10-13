/* ==========================================================
   Section 9, board "lenia": hold a moving creature.

   THE RULE IS NOT MODIFIED. Every grid on this board is a
   kit.S.NCA (the page's port of nca.py) advanced with step().
   The gallery, the workbench and the founder roll run with every
   cell carrying ONE genome (a clonal founder), ip = 1 and ppp = 0:
   the page's own rule with its two noise sources switched off,
   which makes it a deterministic cellular automaton. The workbench
   lets the visitor switch ip and ppp back on; that is still the
   page's rule, with the page's meaning of both.

   What the board adds around the rule, ported from the research
   scripts (work/lenia/):
   - placing a creature's locked state (exact float32 alpha and
     chemistry, budget counter, has/inh flags, genome in every cell
     with has = 1) onto an empty 64 x 64 torus (make_board_data.js,
     verify_board_data.js: all 18 reproduce at 64 x 64);
   - founder seeds single / plus / disc / soup (lib.js seedShape)
     and the 'screened' founder draw (app.js soloSurvives, here with
     a seeded generator so a roll can be re-run);
   - turning a creature's state 90 degrees about its centre, the
     genome itself unchanged (rot.js), and deleting one cell with
     s.wound(i, j, 0) (robust.js);
   - LeniaClassifier, below: board_classify.js, the incremental port
     of lib.js classify() (verified against it by
     verify_board_classify.js).
   Offline numbers come from the verified research report and are
   labelled with their run counts; everything else is live.
   ========================================================== */

(function () {
  'use strict';

  var S = window.SONCA;
  if (!S || !S.board) return;

  var P = 44, GW = 64, NS = 'http://www.w3.org/2000/svg';
  var RATES = { slow: 125, normal: 66, fast: 15 };    // ms between generations
  var SLICE_MS = 7;                                  // roll: simulation time allowed per frame
  var ROUND_MS = 9;                                  // gallery + workbench: time allowed per frame
  var SINGLE_CAP = 4;                                // roll: generations per frame for a single roll
  var BATCH_MAX = 200;
  var VOID = [6, 7, 11], NEWBORN = [38, 36, 78], FLASH = [120, 205, 255];
  var BUDGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, Infinity];
  var SHAPES = ['single', 'disc1', 'disc2', 'soup'];
  var SHAPE_NAME = { single: 'one founder', disc1: '5-cell plus', disc2: '13-cell disc', soup: '6 × 6 soup' };
  var SEED_PHRASE = { single: 'one founder cell', disc1: 'a 5-cell plus', disc2: 'a 13-cell disc', soup: 'a 6 × 6 soup' };
  var ARMS = [['sigmoid/xavier', 'sigmoid, any draw'], ['sigmoid/solo', 'sigmoid, screened'],
    ['tanh/xavier', 'tanh, any draw'], ['tanh/solo', 'tanh, screened']];
  var KINDS = [['glider', 'glider', '--clogv'], ['fills', 'filled the grid', '--alive'], ['waves', 'waves', '--chem'],
    ['chaotic', 'chaotic', '--gcvp'], ['extinct', 'died out', '--text-mute'], ['other', 'other', '--gep']];
  var CLS = {
    extinct: 'Died out', fills: 'Filled the grid', 'periodic-spanning': 'Periodic waves', wave: 'Waves',
    chaotic: 'Chaotic', glider: 'Glider', 'bounded-drifter': 'Drifting blob', 'bounded-irregular': 'Stalled blob',
    static: 'Still life', oscillator: 'Oscillator'
  };
  function kindOf(cls) {
    return cls === 'glider' || cls === 'fills' || cls === 'chaotic' || cls === 'extinct' ? cls
      : cls === 'wave' || cls === 'periodic-spanning' ? 'waves' : 'other';
  }

  /* ---------------- the outcome classifier ----------------
     board_classify.js from the research, unchanged apart from
     layout: an incremental version of lib.js classify(). Call
     tick() after every s.step(); it returns null while undecided.
     Recurrence (exact state up to translation, confirmed for
     max(2p, 12) steps) is only looked for when ip = 1 and ppp = 0;
     otherwise only the end-of-window geometry is reported. */
  function LeniaClassifier(s, opts) {
    opts = opts || {};
    var W = s.W, T = opts.T || 300;
    var det = s.ip === 1 && s.ppp === 0;
    var f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
    var ro = new Uint8Array(W), co = new Uint8Array(W);
    var seen = {}, logs = [], hist = [], cand = null, t = 0;
    var tFirstBig = -1, densAtBig = NaN, maxH = 0, maxW = 0, done = null;

    function cd(a, b) { var d = (a - b) % W; if (d > W / 2) d -= W; if (d <= -W / 2) d += W; return d; }
    function geom() {
      var st = s.st, a = s.alpha, L = 0, i, j;
      ro.fill(0); co.fill(0);
      for (i = 0; i < W; i++) for (j = 0; j < W; j++) if (st[i * W + j] > a) { ro[i] = 1; co[j] = 1; L++; }
      var R = circSpan(ro, W), C = circSpan(co, W), sr = 0, sc = 0;
      if (L && R[1] < W && C[1] < W) {
        for (i = 0; i < W; i++) for (j = 0; j < W; j++) if (st[i * W + j] > a) { sr += (i - R[0] + W) % W; sc += (j - C[0] + W) % W; }
        sr = R[0] + sr / L; sc = C[0] + sc / L;
      } else { sr = NaN; sc = NaN; }
      return { L: L, r0: R[0], h: R[1], c0: C[0], w: C[1], cr: sr, cc: sc };
    }
    function hashState(g) {
      var n = s.N, st = s.st, fin = isFinite(s.budget), cap = fin ? s.budget + 1 : 0, hsh = 2166136261 >>> 0;
      function mix(v) { hsh ^= v; hsh = Math.imul(hsh, 16777619) >>> 0; }
      var bounded = g.h + 4 < W && g.w + 4 < W, rS, rL, cS, cL, di, dj;
      if (bounded) { rS = g.r0 - 2; rL = g.h + 4; cS = g.c0 - 2; cL = g.w + 4; } else { rS = 0; rL = W; cS = 0; cL = W; }
      mix(rL); mix(cL);
      for (di = 0; di < rL; di++) {
        var i = (rS + di + 2 * W) % W;
        for (dj = 0; dj < cL; dj++) {
          var idx = i * W + (cS + dj + 2 * W) % W;
          f32[0] = st[idx]; mix(u32[0]); f32[0] = st[n + idx]; mix(u32[0]);
          mix(s.has[idx] | (s.inh[idx] << 1));
          if (fin) mix(Math.min(s.bud[idx], cap));
        }
      }
      return { h: hsh, bounded: bounded, r: rS, c: cS };
    }
    function visHash(g) {
      var n = s.N, st = s.st, hsh = 2166136261 >>> 0, di, dj;
      function mix(v) { hsh ^= v; hsh = Math.imul(hsh, 16777619) >>> 0; }
      var rL = Math.min(g.h, W), cL = Math.min(g.w, W); mix(rL); mix(cL);
      for (di = 0; di < rL; di++) {
        var i = (g.r0 + di) % W;
        for (dj = 0; dj < cL; dj++) { var idx = i * W + (g.c0 + dj) % W; f32[0] = st[idx]; mix(u32[0]); f32[0] = st[n + idx]; mix(u32[0]); }
      }
      return hsh;
    }
    function finish(res) {
      var last = hist[hist.length - 1], out = { maxH: maxH, maxW: maxW, tFirstBig: tFirstBig, densAtBig: densAtBig, steps: hist.length };
      var k;
      if (res && res.cls === 'extinct') { out.cls = 'extinct'; out.tEnd = res.tEnd; out.L = 0; return out; }
      var tail = hist.slice(-50), sum = 0;
      for (k = 0; k < tail.length; k++) sum += tail[k].L;
      var occ = sum / tail.length / (W * W);
      out.occ = occ; out.L = last.L; out.h = last.h; out.w = last.w;
      if (res) {
        for (k in res) out[k] = res[k];
        var moving = res.dr !== 0 || res.dc !== 0;
        out.bounded = last.h <= W / 2 && last.w <= W / 2;
        if (out.bounded) out.cls = moving ? 'glider' : (res.vperiod === 1 ? 'static' : 'oscillator');
        else out.cls = occ >= 0.5 ? 'fills' : 'periodic-spanning';
        if (moving) out.speed = Math.sqrt(res.dr * res.dr + res.dc * res.dc) / res.period;
        return out;
      }
      if (last.h <= W / 2 && last.w <= W / 2) {
        var k0 = Math.max(0, hist.length - 100), dr = 0, dc = 0, ok = true;
        for (k = k0 + 1; k < hist.length; k++) {
          if (!isFinite(hist[k].cr) || !isFinite(hist[k - 1].cr)) { ok = false; break; }
          dr += cd(hist[k].cr, hist[k - 1].cr); dc += cd(hist[k].cc, hist[k - 1].cc);
        }
        out.comDisp = ok ? Math.sqrt(dr * dr + dc * dc) : NaN;
        out.cls = ok && out.comDisp >= 5 ? 'bounded-drifter' : 'bounded-irregular';
        return out;
      }
      out.cls = occ >= 0.5 ? 'fills' : (densAtBig < 0.25 ? 'wave' : 'chaotic');
      return out;
    }
    function tick() {
      if (done) return done;
      t++;
      var g = geom();
      hist.push({ L: g.L, h: g.h, w: g.w, cr: g.cr, cc: g.cc });
      if (g.L === 0) return (done = finish({ cls: 'extinct', tEnd: t }));
      if (g.h > maxH) maxH = g.h;
      if (g.w > maxW) maxW = g.w;
      if (tFirstBig < 0 && (g.h > W / 2 || g.w > W / 2)) { tFirstBig = t; densAtBig = g.L / (g.h * g.w); }
      if (det) {
        var hs = hashState(g), key = hs.h + ':' + hs.bounded;
        if (cand) {
          var prev = logs[t - cand.p];
          if (prev && prev.key === key && cd(hs.r, prev.r) === cand.dr && cd(hs.c, prev.c) === cand.dc) {
            if (t >= cand.t0 + Math.max(2 * cand.p, 12)) {
              var res = { period: cand.p, dr: cand.dr, dc: cand.dc, tEnd: t, tLock: cand.t0 - cand.p, bounded: hs.bounded };
              logs[t] = { key: key, r: hs.r, c: hs.c, v: visHash(g), vr: g.r0, vc: g.c0 };
              res.vperiod = cand.p;
              for (var q = 1; q < cand.p; q++) {
                if (cand.p % q) continue;
                var okq = true;
                for (var u = t; u > t - cand.p && okq; u--) {
                  var A = logs[u], B = logs[u - q];
                  if (!A || !B || A.v !== B.v || cd(A.vr, B.vr) * cand.p !== cand.dr * q || cd(A.vc, B.vc) * cand.p !== cand.dc * q) okq = false;
                }
                if (okq) { res.vperiod = q; break; }
              }
              return (done = finish(res));
            }
          } else cand = null;
        }
        if (!cand && seen.hasOwnProperty(key)) {
          var t1 = seen[key], p0 = logs[t1];
          cand = { p: t - t1, dr: cd(hs.r, p0.r), dc: cd(hs.c, p0.c), t0: t };
        }
        seen[key] = t;
        logs[t] = { key: key, r: hs.r, c: hs.c, v: visHash(g), vr: g.r0, vc: g.c0 };
      }
      if (t >= T) return (done = finish(null));
      return null;
    }
    return { tick: tick, steps: function () { return t; }, T: T };
  }

  // minimal circular interval covering the occupied indices: [start, length] (length W if none is empty)
  function circSpan(occ, W) {
    var any = false, i, k;
    for (i = 0; i < W; i++) if (occ[i]) { any = true; break; }
    if (!any) return [0, 0];
    var bestLen = 0, bestEnd = -1, run = 0;
    for (k = 0; k < 2 * W; k++) {
      i = k % W;
      if (!occ[i]) { run++; if (run > bestLen && run <= W) { bestLen = run; bestEnd = i; } } else run = 0;
    }
    if (bestLen === 0) return [0, W];
    return [(bestEnd + 1) % W, W - bestLen];
  }
  function cdW(a, b, W) { var d = (a - b) % W; if (d > W / 2) d -= W; if (d <= -W / 2) d += W; return d; }
  function wrap(v, W) { return ((v % W) + W) % W; }

  // live bounding box and centre of mass on the torus (lib.js geom)
  var _ro = new Uint8Array(GW), _co = new Uint8Array(GW);
  function geomOf(s) {
    var W = s.W, st = s.st, a = s.alpha, L = 0, i, j;
    _ro.fill(0); _co.fill(0);
    for (i = 0; i < W; i++) for (j = 0; j < W; j++) if (st[i * W + j] > a) { _ro[i] = 1; _co[j] = 1; L++; }
    var R = circSpan(_ro, W), C = circSpan(_co, W), sr = NaN, sc = NaN;
    if (L && R[1] < W && C[1] < W) {
      sr = 0; sc = 0;
      for (i = 0; i < W; i++) for (j = 0; j < W; j++) if (st[i * W + j] > a) { sr += (i - R[0] + W) % W; sc += (j - C[0] + W) % W; }
      sr = R[0] + sr / L; sc = C[0] + sc / L;
    }
    return { L: L, r0: R[0], h: R[1], c0: C[0], w: C[1], cr: sr, cc: sc };
  }

  /* ---------------- small helpers ---------------- */

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
  function svgEl(tag, attrs, text) { return S.el(tag, attrs, text); }
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function gcd(a, b) { while (b) { var t = b; b = a % b; a = t; } return a; }
  function frac(n, d) {
    if (!n) return '0';
    var g = gcd(n, d); n /= g; d /= g;
    return d === 1 ? String(n) : n + '/' + d;
  }
  function comma(n) { return Number(n).toLocaleString('en-GB'); }
  function bName(b) { return isFinite(b) ? String(b) : '∞'; }
  // per-axis speed of a glider: the larger of |dr|, |dc| over the period
  function axisSpeed(r) { return frac(Math.max(Math.abs(r.dr), Math.abs(r.dc)), r.period); }
  function dirName(dr, dc) {
    if (!dr && !dc) return 'still';
    if (!dr || !dc) return 'orthogonal';
    return Math.abs(dr) === Math.abs(dc) ? 'diagonal' : 'oblique';
  }
  function sameHeading(a, b) { return a[0] * b[1] - a[1] * b[0] === 0 && a[0] * b[0] + a[1] * b[1] > 0; }
  // quarter turns as in rot.js: q = 1 maps (di, dj) to (dj, -di)
  function rotP(v, q) {
    var a = v[0], b = v[1];
    for (var k = 0; k < ((q % 4) + 4) % 4; k++) { var t = a; a = b; b = -t; }
    return [a, b];
  }
  // a small arrow pointing along (dr, dc) on screen (rows grow downwards)
  function arrowSvg(dr, dc) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-7 -7 14 14');
    svg.setAttribute('class', 'ln-arrow');
    svg.setAttribute('aria-hidden', 'true');
    var ang = Math.atan2(dr, dc) * 180 / Math.PI;
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M-5 0H5M1.5-3.5L5 0L1.5 3.5');
    p.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ')');
    svg.appendChild(p);
    return svg;
  }
  function headingNode(dr, dc, period) {
    var span = h('span', {});
    span.appendChild(arrowSvg(dr, dc));
    span.appendChild(document.createTextNode(' (' + dr + ', ' + dc + ') / ' + period));
    return span;
  }

  // exact float32 values packed as base64 little-endian
  function f32(b64) {
    var bin = atob(b64), n = bin.length, buf = new ArrayBuffer(n), u8 = new Uint8Array(buf), i;
    for (i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
    var dv = new DataView(buf), out = new Float32Array(n >> 2);
    for (i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
    return out;
  }

  /* ---------------- grids ---------------- */

  function budgetOf(b) { return b === 'inf' || b === Infinity ? Infinity : b; }
  function newSim(act, b) { return S.NCA({ W: GW, init: 0, ip: 1, ppp: 0, budget: budgetOf(b), act: act }); }

  // a creature's locked state, centred on an empty grid; the genome goes into every cell with has = 1
  function placeLocked(s, c) {
    var d = c.d, n = d.length >> 1, k, r0 = 1e9, r1 = -1e9, c0 = 1e9, c1 = -1e9;
    for (k = 0; k < n; k++) {
      r0 = Math.min(r0, d[2 * k]); r1 = Math.max(r1, d[2 * k]);
      c0 = Math.min(c0, d[2 * k + 1]); c1 = Math.max(c1, d[2 * k + 1]);
    }
    var oR = (GW >> 1) - Math.floor((r0 + r1) / 2), oC = (GW >> 1) - Math.floor((c0 + c1) / 2);
    s.seed(0, function (t) {
      for (k = 0; k < n; k++) {
        var idx = wrap(oR + d[2 * k], GW) * GW + wrap(oC + d[2 * k + 1], GW), m = c.m[k];
        t.st[idx] = c.fl[2 * k]; t.st[t.N + idx] = c.fl[2 * k + 1];
        t.bud[idx] = m >> 2; t.has[idx] = (m >> 1) & 1; t.inh[idx] = m & 1;
        if (t.has[idx]) t.g.set(c.genome, idx * P);
      }
    });
  }
  // founders (offsets from the grid centre), all carrying the same genome
  function placeSeed(s, cells, genome) {
    s.seed(0, function (t) {
      for (var k = 0; k < cells.length; k += 2) t.found(wrap(32 + cells[k], GW) * GW + wrap(32 + cells[k + 1], GW), genome);
    });
  }
  // lib.js seedShape: single / disc1 (r = 1) / disc2 (r = 2) / soup (6 x 6 box, each cell w.p. 1/2)
  function shapeCells(shape, rng) {
    var out = [], di, dj, r;
    if (shape === 'single') return [0, 0];
    if (shape === 'disc1' || shape === 'disc2') {
      r = shape === 'disc1' ? 1 : 2;
      for (di = -r; di <= r; di++) for (dj = -r; dj <= r; dj++) if (di * di + dj * dj <= r * r) out.push(di, dj);
      return out;
    }
    for (di = -3; di < 3; di++) for (dj = -3; dj < 3; dj++) if (rng() < 0.5) out.push(di, dj);
    return out.length ? out : [0, 0];
  }
  // a founder genome: xavier_uniform weights, zero biases (app.js xavier), from a seeded generator
  function xavierR(rng) {
    var g = new Float32Array(P), k;
    for (k = 0; k < 36; k++) g[k] = (rng() * 2 - 1) * S.XA1;
    for (k = 38; k < 42; k++) g[k] = (rng() * 2 - 1) * S.XA2;
    return g;
  }
  // app.js soloSurvives: alone on the grid, does the founder's first output pass the threshold?
  function soloSurvives(g, act) {
    var f = act === 'tanh' ? Math.tanh : S.sigmoid, alpha = act === 'tanh' ? 0 : 0.5;
    var h0 = f(g[36] + g[4] + g[13]), h1 = f(g[37] + g[22] + g[31]);
    var y = f(g[42] + g[38] * h0 + g[39] * h1);
    return Math.round(y * 10) / 10 > alpha;
  }
  // app.js founderGenome(s, 'solo'): redraw up to 40 times until the founder survives alone
  function screenedR(rng, act) {
    var g;
    for (var r = 0; r < 40; r++) { g = xavierR(rng); if (soloSurvives(g, act)) break; }
    return g;
  }
  function snapshot(s) {
    return { act: s.act, budget: s.budget, st: Float32Array.from(s.st), g: Float32Array.from(s.g),
      has: Uint8Array.from(s.has), bud: Int32Array.from(s.bud), inh: Uint8Array.from(s.inh) };
  }
  function restore(s, z) {
    s.seed(0, function (t) { t.st.set(z.st); t.g.set(z.g); t.has.set(z.has); t.bud.set(z.bud); t.inh.set(z.inh); });
  }
  // rot.js: turn the state (both channels, flags, counters and each cell's genome) a quarter turn about the
  // centre of mass; the genome's weights are not rotated
  function rotateSim(s) {
    var W = s.W, n = s.N, g = geomOf(s);
    if (!g.L) return false;
    var cr = isFinite(g.cr) ? Math.round(g.cr) : W >> 1, cc = isFinite(g.cc) ? Math.round(g.cc) : W >> 1;
    var z = snapshot(s), i, j, k;
    s.st.fill(0); s.g.fill(0); s.has.fill(0); s.bud.fill(0); s.inh.fill(0);
    for (i = 0; i < W; i++) for (j = 0; j < W; j++) {
      var src = i * W + j;
      if (!z.has[src] && !(z.st[src] > s.alpha)) continue;
      var v = rotP([cdW(i, cr, W), cdW(j, cc, W)], 1);
      var dst = wrap(cr + v[0], W) * W + wrap(cc + v[1], W);
      s.st[dst] = z.st[src]; s.st[n + dst] = z.st[n + src];
      s.has[dst] = z.has[src]; s.bud[dst] = z.bud[src]; s.inh[dst] = z.inh[src];
      for (k = 0; k < P; k++) s.g[dst * P + k] = z.g[src * P + k];
    }
    return true;
  }
  // distinct genomes among living cells and among cells holding an inherited genome but not yet alive
  function genomeCounts(s) {
    if (!s._u32) s._u32 = new Uint32Array(s.g.buffer, s.g.byteOffset, s.g.length);
    var u = s._u32, alive = new Set(), born = new Set(), i, k;
    for (i = 0; i < s.N; i++) {
      if (!s.has[i]) continue;
      var hsh = 2166136261 >>> 0, b = i * P;
      for (k = 0; k < P; k++) { hsh ^= u[b + k]; hsh = Math.imul(hsh, 16777619) >>> 0; }
      if (s.st[i] > s.alpha) alive.add(hsh); else born.add(hsh);
    }
    return [alive.size, born.size];
  }

  /* ---------------- painting ---------------- */

  var MAG = null;
  function magLut() {
    MAG = new Uint8Array(256 * 3);
    for (var q = 0; q < 256; q++) {
      var c = S.magma(Math.max(0.001, q / 255));
      MAG[q * 3] = c[0]; MAG[q * 3 + 1] = c[1]; MAG[q * 3 + 2] = c[2];
    }
  }
  // live cells in magma, rescaled so sigmoid creatures (alpha 0.55-0.65) are not near-black; dead cells that
  // hold a just-inherited genome in dim navy; view = { r0, c0, size } crops a window of the torus
  function paintGrid(cv, s, view, flash) {
    if (!MAG) magLut();
    var size = view ? view.size : s.W;
    if (cv.width !== size || cv.height !== size) { cv.width = size; cv.height = size; cv._img = null; }
    var ctx = cv._ctx || (cv._ctx = cv.getContext('2d'));
    var img = cv._img || (cv._img = ctx.createImageData(size, size)), d = img.data;
    var W = s.W, a = s.alpha, inv = 1 / (1 - a), st = s.st, has = s.has;
    var r0 = view ? view.r0 : 0, c0 = view ? view.c0 : 0, x, y, o = 0;
    for (y = 0; y < size; y++) {
      var row = wrap(r0 + y, W) * W;
      for (x = 0; x < size; x++, o += 4) {
        var i = row + wrap(c0 + x, W), v = st[i], c;
        if (v > a) {
          var q = Math.min(255, ((0.3 + 0.7 * (v - a) * inv) * 255) | 0) * 3;
          d[o] = MAG[q]; d[o + 1] = MAG[q + 1]; d[o + 2] = MAG[q + 2];
        } else {
          c = has[i] ? NEWBORN : VOID;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
        }
        d[o + 3] = 255;
      }
    }
    if (flash && !view) {
      var fo = (flash[0] * size + flash[1]) * 4;
      d[fo] = FLASH[0]; d[fo + 1] = FLASH[1]; d[fo + 2] = FLASH[2];
    }
    ctx.putImageData(img, 0, 0);
  }
  // a size x size window centred on the live bounding box; keeps the last window when nothing lives
  function followView(s, size, prev) {
    var g = geomOf(s);
    if (!g.L || g.h >= s.W || g.w >= s.W) return prev || { r0: (s.W - size) >> 1, c0: (s.W - size) >> 1, size: size };
    return { r0: g.r0 + (g.h >> 1) - (size >> 1), c0: g.c0 + (g.w >> 1) - (size >> 1), size: size };
  }

  /* ---------------- scoped styles ---------------- */

  function addStyle() {
    if (document.getElementById('ln-style')) return;
    var B = '[data-board="lenia"] ';
    var css = [
      B + '.ln-sec{margin:26px 0 10px;padding-top:16px;border-top:1px solid var(--rule)}',
      B + '.ln-sec:first-child{margin-top:0;padding-top:0;border-top:0}',
      B + '.ln-sec h4{margin:0 0 2px;font-size:16px;font-family:"Barlow Semi Condensed",sans-serif}',
      B + '.ln-sec p{margin:0;max-width:none}',
      B + '.ln-tiles{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:8px;margin:6px 0 6px}',
      // align-self: a stretched <button> centres its content, which would set the canvases at different heights
      B + '.ln-tile{font:inherit;padding:0;margin:0;background:none;border:0;text-align:left;cursor:pointer;color:inherit;min-width:0;align-self:start}',
      B + '.ln-tile canvas{outline:2px solid transparent;outline-offset:1px}',
      B + '.ln-tile[aria-pressed="true"] canvas{outline-color:var(--navy)}',
      B + '.ln-tile:hover canvas{border-color:var(--navy)}',
      B + '.ln-tile .cap{display:block;font-size:12px;font-weight:700;color:var(--text-soft);padding-top:5px;line-height:1.3;overflow-wrap:anywhere}',
      B + '.ln-tile[aria-pressed="true"] .cap{color:var(--text)}',
      B + '.ln-tile .cap em{display:block;font-style:normal;font-weight:400;color:var(--text-mute)}',
      B + '.ln-bench{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:24px;align-items:start}',
      B + '.ln-bench .readnum{grid-template-columns:repeat(4,minmax(0,1fr))}',
      B + '.ln-shot{position:relative}',
      B + '.ln-over{position:absolute;inset:0;width:100%;display:grid;place-items:center;background:rgba(8,9,14,.25);color:#fff;border:0;cursor:pointer;font:inherit;font-size:15px;font-weight:700;letter-spacing:.02em}',
      B + '.ln-over span{border:1px solid rgba(255,255,255,.7);border-radius:999px;padding:6px 16px;background:rgba(8,9,14,.55)}',
      B + '.ln-over:hover span{background:rgba(8,9,14,.8)}',
      B + '.ln-arrow{width:15px;height:15px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
      B + '.ln-title{font-size:14.5px;margin:0 0 8px;max-width:none}',
      B + '.ln-sub{font-size:14.5px;margin:4px 0 10px;min-height:1.5em;max-width:none}',
      B + '.ln-ref{font-size:13.5px;margin:8px 0 0;max-width:none;color:var(--text-soft)}',
      B + '.ln-ref b{color:var(--text)}',
      B + '.verdict{min-height:1.2em}',
      B + '.ln-ctl .presetrows{margin-bottom:6px}',
      B + '.ln-ctl .controls{margin:10px 0 10px}',
      B + '.ln-ctl .slider{grid-template-columns:auto 1fr 3em;margin:2px 0 6px}',
      B + '.ln-charts{margin-top:18px}',
      B + '.ln-charts .kicker{display:block;margin:0 0 4px}',
      B + '.ln-bars .seg{cursor:default}',
      B + '.ln-swatch{width:10px;height:10px;border-radius:2px;display:inline-block}',
      '@media (max-width:880px){' + B + '.ln-bench{grid-template-columns:1fr}' + B + '.ln-tiles{grid-template-columns:repeat(var(--n2),minmax(0,1fr))}}',
      '@media (max-width:560px){' + B + '.ln-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}' + B + '.ln-bench .readnum{grid-template-columns:repeat(2,minmax(0,1fr))}}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = 'ln-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------------- the board ---------------- */

  S.board('lenia', function (root, kit) {
    var live = root.querySelector('.boardlive');
    var msg = h('p', { class: 'note', text: 'Loading the creatures…' });
    live.appendChild(msg);
    var ui = null;
    kit.load('boards/data/lenia.js?v=1', function (err) {
      var D = window.SONCA_DATA && window.SONCA_DATA.lenia;
      if (err || !D) { msg.textContent = 'The board’s data (boards/data/lenia.js) could not be loaded.'; return; }
      live.removeChild(msg);
      ui = build(live, kit, D);
    });
    return {
      frame: function (t) { if (ui) ui.frame(t); },
      show: function () { if (ui) ui.redraw(); },
      hide: function () { if (ui) ui.hide(); }
    };
  });

  function build(host, kit, D) {
    addStyle();
    D.creatures.concat(D.qd).forEach(function (c) { c.genome = f32(c.g); c.fl = f32(c.f); });
    D.creatures.forEach(function (c) { c.set = 'search'; });
    D.qd.forEach(function (c) { c.set = 'qd'; });
    var DESIGNED = Float32Array.from(D.designed), WAVE = f32(D.wave);

    var playing = !kit.reduceMotion, speed = 'normal', tick = kit.every(RATES.normal), follow = true;
    var vis = { gal: true, bench: true, roll: true };

    /* ======== 1. gallery ======== */

    var setPillHost = h('div', { role: 'group', 'aria-label': 'Which creatures' });
    var viewHost = h('div', {}), speedHost = h('div', {});
    var bPlay = btn(playing ? 'Pause' : 'Play', 'btn primary'), bStep = btn('Step');
    var tilesEl = h('div', { class: 'ln-tiles' });
    var galNote = h('p', { class: 'note', style: 'margin:6px 0 0;max-width:none' });
    var galSec = h('div', { class: 'ln-sec' }, [
      h('h4', { text: 'Gliders found offline, running here' }),
      h('div', { class: 'presetrows', style: 'margin:8px 0 6px' }, [
        h('span', { class: 'ctl-label', text: 'Creatures' }),
        h('div', { class: 'controls', style: 'margin:0;gap:8px 14px' }, [setPillHost, viewHost]),
        h('span', { class: 'ctl-label', text: 'Run' }),
        h('div', { class: 'controls', style: 'margin:0;gap:8px 14px' }, [speedHost, bPlay, bStep])
      ]),
      tilesEl, galNote
    ]);

    /* ======== 2. workbench ======== */

    var cvBench = h('canvas', { class: 'cv draw', width: GW, height: GW,
      'aria-label': 'The selected creature on a 64 by 64 torus; click a cell to delete it' });
    var capBenchName = h('span', { text: '' }), capBenchGen = h('em', { text: 'click a cell to delete it' });
    var benchTitle = h('p', { class: 'ln-title' });
    function rn(label) { var b = h('b', { text: '–' }); return { el: h('div', {}, [b, label]), b: b }; }
    var RB = {
      gen: rn('generation'), cells: rn('live cells'), drift: rn('drift, cells/gen'),
      period: rn('period'), heading: rn('step per period'), gA: rn('genomes in live cells'),
      gN: rn('genomes in newborns'), size: rn('size, rows × cols')
    };
    var benchRead = h('div', { class: 'readnum' }, [RB.gen.el, RB.cells.el, RB.size.el, RB.drift.el, RB.period.el, RB.heading.el, RB.gA.el, RB.gN.el]);
    var benchVerdict = h('p', { class: 'verdict', 'aria-live': 'polite', text: '–' });
    var benchSub = h('p', { class: 'ln-sub', 'aria-live': 'polite' });
    var bRotate = btn('Rotate 90°'), bReset = btn('Reset'), bGrow = btn('Grow from founders');
    var ipHost = h('div', { role: 'group', 'aria-label': 'Inheritance probability ip' });
    var pppHost = h('div', { role: 'group', 'aria-label': 'Mutation probability ppp' });
    var benchRef = h('p', { class: 'ln-ref' });
    var benchTally = h('p', { class: 'ln-ref', 'aria-live': 'polite' });
    var benchSec = h('div', { class: 'ln-sec' }, [
      h('h4', { text: 'Poke one' }),
      h('p', { class: 'note', text: 'Pause, then click a cell to delete it; rotate the body; or switch the page’s noise back on. A fresh outcome check starts after every change.' }),
      h('div', { class: 'ln-bench', style: 'margin-top:12px' }, [
        h('figure', { class: 'cvfig' }, [cvBench, h('figcaption', {}, [capBenchName, capBenchGen])]),
        h('div', { class: 'ln-ctl' }, [
          benchTitle, benchRead, benchVerdict, benchSub,
          h('div', { class: 'controls' }, [bRotate, bReset, bGrow]),
          h('div', { class: 'presetrows' }, [
            h('span', { class: 'ctl-label', text: 'Inheritance ip' }), ipHost,
            h('span', { class: 'ctl-label', text: 'Mutation ppp' }), pppHost
          ]),
          benchRef, benchTally
        ])
      ])
    ]);

    /* ======== 3. roll a founder ======== */

    var cvRoll = h('canvas', { class: 'cv', width: GW, height: GW, 'aria-label': 'A founder you rolled, run on a 64 by 64 torus' });
    var capRollName = h('span', { text: 'No founder yet' }), capRollGen = h('em', { text: '' });
    var srcHost = h('div', { role: 'group', 'aria-label': 'Where the genome comes from' });
    var actHost = h('div', {}), shapeHost = h('div', { role: 'group', 'aria-label': 'Founder seed' }), drawHost = h('div', {});
    var bSlider = h('input', { type: 'range', min: '1', max: '13', step: '1', value: '6', id: 'lnBudget', 'aria-label': 'Budget b' });
    var bOut = h('output', { for: 'lnBudget' });
    var bOver = h('button', { type: 'button', class: 'ln-over', 'aria-label': 'Roll a founder' }, [h('span', { text: 'Roll a founder' })]);
    var bRoll = btn('Roll a founder', 'btn primary'), bAgain = btn('Run again'), bBatch = btn('Roll until a glider'), bPoke = btn('Poke it above');
    function rr(label) { return rn(label); }
    var RR = {
      gen: rr('generation'), cells: rr('live cells'), cls: rr('outcome'), period: rr('period'),
      heading: rr('step per period'), seed: rr('founder')
    };
    var rollRead = h('div', { class: 'readnum' }, [RR.gen.el, RR.cells.el, RR.cls.el, RR.period.el, RR.heading.el, RR.seed.el]);
    var rollVerdict = h('p', { class: 'verdict', 'aria-live': 'polite', text: '–' });
    var rollSub = h('p', { class: 'ln-sub', 'aria-live': 'polite' });
    var rollSec = h('div', { class: 'ln-sec' }, [
      h('h4', { text: 'Roll a founder' }),
      h('p', { class: 'note', text: 'A fresh random genome in every founder cell, run for up to 300 generations and classified as it goes, as in the offline search.' }),
      h('div', { class: 'ln-bench', style: 'margin-top:12px' }, [
        h('figure', { class: 'cvfig' }, [h('div', { class: 'ln-shot' }, [cvRoll, bOver]), h('figcaption', {}, [capRollName, capRollGen])]),
        h('div', { class: 'ln-ctl' }, [
          h('div', { class: 'presetrows' }, [
            h('span', { class: 'ctl-label', text: 'Genome' }), srcHost,
            h('span', { class: 'ctl-label', text: 'Activation' }), actHost,
            h('span', { class: 'ctl-label', text: 'Seed' }), shapeHost,
            h('span', { class: 'ctl-label', text: 'New founders' }), drawHost
          ]),
          h('div', { class: 'slider' }, [h('label', { for: 'lnBudget', text: 'Budget b' }), bSlider, bOut]),
          h('div', { class: 'controls' }, [bRoll, bAgain, bBatch, bPoke]),
          rollRead, rollVerdict, rollSub
        ])
      ])
    ]);

    /* ======== 4. charts ======== */

    var barSvg = document.createElementNS(NS, 'svg');
    barSvg.setAttribute('role', 'img');
    barSvg.setAttribute('class', 'ln-bars');
    barSvg.setAttribute('aria-label', 'Share of each outcome per founder type: the offline search and your rolls');
    var barTip = h('div', { class: 'tip' });
    var barLegend = h('div', { class: 'legend' });
    var qdSvg = document.createElementNS(NS, 'svg');
    qdSvg.setAttribute('role', 'img');
    qdSvg.setAttribute('aria-label', 'Niches filled against evaluations in one MAP-Elites run per activation');
    var qdTip = h('div', { class: 'tip' });
    var qdLegend = h('div', { class: 'legend' });
    var chartSec = h('div', { class: 'two ln-charts' }, [
      h('div', {}, [
        h('span', { class: 'kicker', text: 'Outcomes: offline search (thick) and your rolls (thin)' }),
        h('div', { class: 'chartbox' }, [barSvg, barTip]), barLegend,
        h('p', { class: 'note', style: 'margin-top:8px', html: 'Offline: 40 founders per type, each run at 13 budgets &times; 4 seeds for 300 generations on a 64&nbsp;&times;&nbsp;64 torus (2,080 runs per bar, 8,320 in all). 8 of the 160 founders made a glider somewhere; no run ended as a still life or an oscillator. In a second census of 300 fresh founders per activation, 6 settings each, 18 tanh and 2 sigmoid founders glided.' })
      ]),
      h('div', {}, [
        h('span', { class: 'kicker', text: 'External search: niches filled (offline, one run each)' }),
        h('div', { class: 'chartbox' }, [qdSvg, qdTip]), qdLegend,
        h('p', { class: 'note', style: 'margin-top:8px', html: 'MAP-Elites, 3,000 evaluations per activation. The first 500 are random draws; after that, mostly mutants of archived genomes, each weight perturbed as the substrate does (by up to &plusmn;1) but with probability 0.1 rather than <span class="mono">ppp</span>, with <i>b</i> and the seed also moved. The selection is ours, not the substrate’s. Glider niches: 57 of 61 (sigmoid), 77 of 83 (tanh). The first sigmoid glider came at evaluation 501, still a random draw, because the archive was empty.' })
      ])
    ]);

    host.appendChild(galSec);
    host.appendChild(benchSec);
    host.appendChild(rollSec);
    host.appendChild(chartSec);

    if ('IntersectionObserver' in window) {
      [['gal', galSec], ['bench', benchSec], ['roll', rollSec]].forEach(function (p) {
        new IntersectionObserver(function (es) { vis[p[0]] = es[es.length - 1].isIntersecting; }).observe(p[1]);
      });
    }

    /* ---------------- gallery logic ---------------- */

    var gal = { set: 'search', tiles: [], selected: null };

    function tileCaption(t) {
      var r = t.res, txt;
      if (!r) txt = 'measuring…';
      else if (r.cls === 'glider') txt = 'period ' + r.period + ', ' + axisSpeed(r) + ' cell/gen';
      else txt = CLS[r.cls] || r.cls;
      setText(t.em, txt);
    }
    function buildGallery() {
      gal.tiles.forEach(function (t) { t.live = false; });
      S.clear(tilesEl);
      var list = gal.set === 'search' ? D.creatures : D.qd;
      tilesEl.style.setProperty('--n', String(list.length));
      tilesEl.style.setProperty('--n2', String(Math.ceil(list.length / 2)));
      gal.tiles = list.map(function (c) {
        var cv = h('canvas', { class: 'cv', width: 32, height: 32 });
        var em = h('em', { text: 'measuring…' });
        var b = h('button', { type: 'button', class: 'ln-tile', 'aria-pressed': String(gal.selected === c),
          'aria-label': c.name + ': load it into the workbench' }, [cv, h('span', { class: 'cap' }, [c.name, em])]);
        var sim = newSim(c.act, c.b);
        placeLocked(sim, c);
        var t = { c: c, sim: sim, cls: LeniaClassifier(sim, { T: 300 }), res: null, cv: cv, em: em, b: b, view: null, live: true };
        b.addEventListener('click', function () { selectCreature(c); });
        tilesEl.appendChild(b);
        paintTile(t);
        return t;
      });
      galNote.innerHTML = gal.set === 'search'
        ? 'Eight of the 67 distinct gliders that random founders made in the offline search (39 of the 67 came from two founders). Each tile is that creature’s exact state, dropped on its own 64&nbsp;&times;&nbsp;64 torus and run with <span class="mono">ip</span>&nbsp;=&nbsp;1, <span class="mono">ppp</span>&nbsp;=&nbsp;0; the period and speed under it are measured here.'
        : 'Ten finds of the external search: the largest (169 cells), slower ones down to 1/4 cell per generation, and oblique ones. The tanh archive kept its genomes rounded to 6 decimals; re-run from those, one is the period-42 glider shown, while the run itself logged periods up to 40.';
    }
    function paintTile(t) {
      if (follow) { t.view = followView(t.sim, 32, t.view); paintGrid(t.cv, t.sim, t.view); }
      else paintGrid(t.cv, t.sim, null);
    }
    function stepTile(t) {
      t.sim.step();
      if (!t.res) { t.res = t.cls.tick(); if (t.res) tileCaption(t); }
      paintTile(t);
    }
    function stepGallery() { gal.tiles.forEach(stepTile); }
    function markSelected() {
      gal.tiles.forEach(function (t) { t.b.setAttribute('aria-pressed', String(t.c === gal.selected)); });
    }

    kit.pills(setPillHost, [
      { key: 'search', label: 'Random search · 8' },
      { key: 'qd', label: 'MAP-Elites · 10' }
    ], function (k) { gal.set = k; buildGallery(); }, 'search');
    (function () {
      var g = h('div', { class: 'switch', role: 'group', 'aria-label': 'Tile view' });
      var items = [['follow', 'Follow'], ['torus', 'Whole torus']];
      var bs = items.map(function (it) {
        var b = h('button', { type: 'button', 'aria-pressed': String(it[0] === 'follow'), text: it[1] });
        b.addEventListener('click', function () {
          follow = it[0] === 'follow';
          bs.forEach(function (x, j) { x.setAttribute('aria-pressed', String(items[j][0] === it[0])); });
          gal.tiles.forEach(paintTile);
        });
        g.appendChild(b);
        return b;
      });
      viewHost.appendChild(g);
      var g2 = h('div', { class: 'switch', role: 'group', 'aria-label': 'Speed' });
      var sp = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
      var bs2 = sp.map(function (it) {
        var b = h('button', { type: 'button', 'aria-pressed': String(it[0] === speed), text: it[1] });
        b.addEventListener('click', function () {
          speed = it[0]; tick = kit.every(RATES[speed]);
          bs2.forEach(function (x, j) { x.setAttribute('aria-pressed', String(sp[j][0] === speed)); });
        });
        g2.appendChild(b);
        return b;
      });
      speedHost.appendChild(g2);
    })();
    function setPlaying(on) { playing = on; bPlay.textContent = on ? 'Pause' : 'Play'; }
    bPlay.addEventListener('click', function () { setPlaying(!playing); });
    bStep.addEventListener('click', function () {
      setPlaying(false);
      stepGallery(); stepBench(true);
      if (roll.phase === 'show') stepRollShow();
    });

    /* ---------------- workbench logic ---------------- */

    var bench = {
      item: null, sim: null, cls: null, res: null, gen: 0, chain: null, flash: null, flashN: 0,
      hist: [], counts: [1, 0], ip: 1, ppp: 0,
      tally: { del: 0, delGlide: 0, delSame: 0, rot: 0, rotRot: 0, rotOrig: 0 }
    };

    function benchItemFromCreature(c) {
      return { kind: 'creature', c: c, name: c.name, act: c.act, b: budgetOf(c.b), genome: c.genome, seed: c.seed,
        title: c.name + ': ' + (c.name.indexOf(c.act) === 0 ? '' : c.act + ', ') + 'b = ' + bName(budgetOf(c.b)) + ', grown from ' + SEED_PHRASE[c.shape] +
          (c.set === 'search' ? ' (random search, ' + (c.src === 'solo' ? 'screened' : 'any') + ' draw)' : ' (MAP-Elites)') };
    }
    function selectCreature(c) {
      gal.selected = c;
      markSelected();
      benchLoad(benchItemFromCreature(c), 'reset');
    }
    function benchLoad(item, how) {
      bench.item = item;
      bench.sim = newSim(item.act, item.b);
      bench.sim.ip = bench.ip; bench.sim.ppp = bench.ppp;
      if (how === 'grow') placeSeed(bench.sim, item.seed, item.genome);
      else if (item.kind === 'creature') placeLocked(bench.sim, item.c);
      else restore(bench.sim, item.snap);
      bench.gen = 0; bench.chain = null; bench.flash = null;
      setText(capBenchName, item.name);
      setText(benchTitle, item.title);
      bGrow.disabled = !item.seed;
      watch();
      setText(benchSub, how === 'grow' ? 'Grown from its founders, generation 0.' : '');
      benchRender(null, true);
    }
    // a fresh outcome check from the current state
    function watch() {
      bench.cls = LeniaClassifier(bench.sim, { T: 300 });
      bench.res = null;
      bench.hist = [];
      updateRef();
    }
    /* A poke on a confirmed glider (ip = 1, ppp = 0) is compared with that glider when the new outcome is in.
       Pokes made before the outcome is in join the same chain: turns add up, and a chain that mixes turns
       and deletions is described but not tallied. */
    function poke(kind) {
      var r = bench.res, det = bench.sim.ip === 1 && bench.sim.ppp === 0;
      if (r && r.cls === 'glider') bench.chain = { ref: r, kinds: [], rotQ: 0 };
      else if (r || !det) bench.chain = null;
      if (bench.chain) { bench.chain.kinds.push(kind); if (kind === 'rotate') bench.chain.rotQ++; }
      watch();
    }
    function onOutcome() {
      var r = bench.res, ch = bench.chain, txt;
      bench.chain = null;
      if (!ch) return;
      var ref = [ch.ref.dr, ch.ref.dc], allDel = ch.kinds.length === 1 && ch.kinds[0] === 'delete';
      var allRot = ch.kinds.every(function (k) { return k === 'rotate'; });
      // the offline deletion test removed live cells only, so a newborn's deletion is described but not tallied
      if (ch.kinds.length === 1 && ch.kinds[0] === 'unborn') {
        txt = 'After deleting the newborn: ' + describe(r).toLowerCase() + '.';
      } else if (allDel) {
        bench.tally.del++;
        if (r.cls === 'glider') {
          bench.tally.delGlide++;
          var same = r.period === ch.ref.period && r.dr === ch.ref.dr && r.dc === ch.ref.dc;
          if (same) bench.tally.delSame++;
          var vel = r.dr * ch.ref.period === ch.ref.dr * r.period && r.dc * ch.ref.period === ch.ref.dc * r.period;
          txt = same ? 'After the deletion: still a glider, with the same period and step.'
            : 'After the deletion: a glider again' + (vel ? ' at the same speed and heading' : '') + ', now period ' +
              r.period + ', step (' + r.dr + ', ' + r.dc + ').';
        } else txt = 'After the deletion: ' + describe(r).toLowerCase() + '.';
      } else if (allRot && ch.rotQ % 4) {
        var exp = rotP(ref, ch.rotQ), turn = (ch.rotQ % 4) * 90 + '°';
        bench.tally.rot++;
        if (r.cls === 'glider') {
          var got = [r.dr, r.dc];
          if (sameHeading(got, exp)) { bench.tally.rotRot++; txt = 'After the ' + turn + ' turn: it took the turned heading.'; }
          else if (sameHeading(got, ref)) { bench.tally.rotOrig++; txt = 'After the ' + turn + ' turn: it re-formed and set off on its genome’s original heading, not the turned one.'; }
          else txt = 'After the ' + turn + ' turn: a glider on another heading, step (' + r.dr + ', ' + r.dc + ').';
        } else txt = 'After the ' + turn + ' turn: ' + describe(r).toLowerCase() + '.';
      } else txt = 'After your changes: ' + describe(r).toLowerCase() + '.';
      setText(benchSub, txt);
      updateTally();
    }
    function describe(r) {
      if (r.cls === 'glider') return 'Glider, period ' + r.period + ', ' + axisSpeed(r) + ' cell/gen, ' + dirName(r.dr, r.dc);
      if (r.cls === 'extinct') return 'Died out';
      var s = CLS[r.cls] || r.cls;
      if (r.period && (r.cls === 'fills' || r.cls === 'periodic-spanning')) s += ', period ' + r.period;
      return s;
    }
    function updateRef() {
      var ip = bench.sim.ip, ppp = bench.sim.ppp, t;
      if (ip === 1 && ppp === 0) {
        t = 'Offline, single live cells deleted from 19 gliders (up to 60 per glider): <b>202 of 232</b> deletions left a glider; 69 came back exactly, 76 kept their motion in a new form, 57 moved differently. Of 204 turned copies (90°, 180° or 270°), <b>0</b> set off on the turned heading; 106 of the 107 that re-formed kept the original one.';
      } else if (ip === 1) {
        t = 'With mutation on, the check reads the shape after 300 generations. At <span class="mono">ip</span>&nbsp;=&nbsp;1 a newborn mutant is not yet alive, so no living cell copies it; it computes one output with its genome, which is then overwritten. Offline, with mutation on, <b>591 of 591</b> runs still alive after 600 generations carried only the founder’s genome; 46 were still bounded.';
      } else if (ppp === 0) {
        t = 'Below <span class="mono">ip</span>&nbsp;=&nbsp;1 the check stops looking for an exact repeat and reads the shape after 300 generations. Offline, at <span class="mono">ip</span>&nbsp;=&nbsp;0.9 without mutation, <b>6 of 95</b> gliders were still moving after 400 generations (<span class="mono">ip</span>&nbsp;=&nbsp;0.5: 7 of 95).';
      } else {
        t = 'With noise on, the check reads the shape after 300 generations. Offline, at <span class="mono">ip</span>&nbsp;=&nbsp;0.95 and 0.99 with mutation, <b>3 of 380</b> gliders were still moving after 600 generations, all three one-cell gliders; one carried a mutated genome that still glides.';
      }
      benchRef.innerHTML = t;
    }
    function updateTally() {
      var T = bench.tally, parts = [];
      if (T.del) parts.push('your deletions: <b>' + T.delGlide + ' of ' + T.del + '</b> still glide, ' + T.delSame + ' with the same period and step');
      if (T.rot) parts.push('your turns: <b>' + T.rotRot + ' of ' + T.rot + '</b> took the turned heading, ' + T.rotOrig + ' kept the original');
      benchTally.innerHTML = parts.length ? 'Live, ' + parts.join('; ') + '.' : '';
    }
    function stepBench(force) {
      if (!bench.sim) return;
      bench.sim.step();
      bench.gen++;
      if (!bench.res) {
        bench.res = bench.cls.tick();
        if (bench.res) onOutcome();
      }
      var g = geomOf(bench.sim);
      bench.hist.push(isFinite(g.cr) ? [g.cr, g.cc] : null);
      if (bench.hist.length > 41) bench.hist.shift();
      if (bench.flashN > 0 && --bench.flashN === 0) bench.flash = null;
      benchRender(g, force);
    }
    function benchRender(g, force) {
      var s = bench.sim;
      if (!s) return;
      g = g || geomOf(s);
      paintGrid(cvBench, s, null, bench.flash);
      setText(RB.gen.b, String(bench.gen));
      setText(RB.cells.b, String(g.L));
      setText(RB.size.b, !g.L ? '–' : g.h >= s.W || g.w >= s.W ? 'spans the torus' : g.h + ' × ' + g.w);
      // drift of the centre of mass over the last 40 generations, along the faster axis
      var hs = bench.hist, ok = hs.length > 40, dr = 0, dc = 0, k;
      for (k = 1; ok && k < hs.length; k++) {
        if (!hs[k] || !hs[k - 1]) { ok = false; break; }
        dr += cdW(hs[k][0], hs[k - 1][0], s.W); dc += cdW(hs[k][1], hs[k - 1][1], s.W);
      }
      setText(RB.drift.b, ok ? (Math.max(Math.abs(dr), Math.abs(dc)) / 40).toFixed(2) : '–');
      if (force || bench.gen % 3 === 0) {
        bench.counts = genomeCounts(s);
        setText(RB.gA.b, String(bench.counts[0]));
        setText(RB.gN.b, String(bench.counts[1]));
      }
      var r = bench.res;
      if (r && r.cls === 'glider') {
        setText(RB.period.b, String(r.period));
        S.clear(RB.heading.b); RB.heading.b.appendChild(headingNode(r.dr, r.dc, r.period));
      } else {
        setText(RB.period.b, r && r.period ? String(r.period) : '–');
        setText(RB.heading.b, '–');
      }
      setText(benchVerdict, r ? describe(r) : 'Watching… ' + bench.cls.steps() + ' of 300');
    }
    kit.pointer(cvBench, GW, GW, function (row, col, phase) {
      if (phase !== 'down' || !bench.sim) return;
      row = Math.max(0, Math.min(GW - 1, row)); col = Math.max(0, Math.min(GW - 1, col));
      var idx = row * GW + col, s = bench.sim;
      var was = s.st[idx] > s.alpha ? 'a live cell' : s.has[idx] ? 'a newborn' : '';
      bench.flash = [row, col]; bench.flashN = 12;
      if (!was) { setText(benchSub, 'Nothing to delete at (' + row + ', ' + col + '): that cell is empty.'); benchRender(null, false); return; }
      s.wound(row, col, 0);
      poke(was === 'a live cell' ? 'delete' : 'unborn');
      setText(benchSub, 'Deleted ' + was + ' at (' + row + ', ' + col + ').');
      benchRender(null, true);
    });
    bRotate.addEventListener('click', function () {
      if (!bench.sim) return;
      if (!rotateSim(bench.sim)) return;
      poke('rotate');               // reads the outcome from before the turn
      setText(benchSub, 'Turned the body 90° about its centre; the genome is unchanged.');
      benchRender(null, true);
    });
    bReset.addEventListener('click', function () { if (bench.item) benchLoad(bench.item, 'reset'); });
    bGrow.addEventListener('click', function () { if (bench.item && bench.item.seed) benchLoad(bench.item, 'grow'); });
    function noise(text) {
      bench.chain = null;
      setText(benchSub, text);
      watch();
      benchRender(null, true);
    }
    var ipPills = kit.pills(ipHost, [
      { key: '1', label: '1' }, { key: '0.99', label: '0.99' }, { key: '0.95', label: '0.95' },
      { key: '0.9', label: '0.9' }, { key: '0.5', label: '0.5' }
    ], function (k) {
      bench.ip = parseFloat(k); ipPills.set(k);
      if (bench.sim) { bench.sim.ip = bench.ip; noise('Inheritance set to ip = ' + k + '.'); }
    }, '1');
    var pppPills = kit.pills(pppHost, [
      { key: '0', label: '0' }, { key: '0.005', label: '0.005' }, { key: '0.02', label: '0.02' }
    ], function (k) {
      bench.ppp = parseFloat(k); pppPills.set(k);
      if (bench.sim) { bench.sim.ppp = bench.ppp; noise('Mutation set to ppp = ' + k + '.'); }
    }, '0');

    /* ---------------- roll logic ---------------- */

    var roll = {
      src: 'xavier', gsrc: 'xavier', act: 'tanh', shape: 'soup', bi: 5, draw: 'search', phase: 'idle',
      sim: null, cls: null, res: null, seed: 0, genome: null, cells: null, fresh: false,
      batch: null, tally: {}
    };
    ARMS.forEach(function (a) { roll.tally[a[0]] = { n: 0, glider: 0, fills: 0, waves: 0, chaotic: 0, extinct: 0, other: 0 }; });

    var srcPills = kit.pills(srcHost, [
      { key: 'xavier', label: 'Any draw' }, { key: 'solo', label: 'Screened draw' },
      { key: 'designed', label: 'Hand-written', title: 'A 44-parameter genome written by hand' },
      { key: 'wave', label: 'Wave example', title: 'A random sigmoid founder that makes square target waves at b = 2' }
    ], function (k) {
      roll.src = k; srcPills.set(k);
      if (k === 'designed' || k === 'wave') {
        roll.batch = null;
        setAct('sigmoid'); setShape('single'); setB(1);
        runFixed();
      }
      syncRollButtons();
    }, 'xavier');
    var actSw = (function () {
      var g = h('div', { class: 'switch', role: 'group', 'aria-label': 'Activation' });
      var items = [['sigmoid', 'sigmoid'], ['tanh', 'tanh']];
      var bs = items.map(function (it) {
        var b = h('button', { type: 'button', 'aria-pressed': String(it[0] === roll.act), text: it[1] });
        b.addEventListener('click', function () { setAct(it[0]); });
        g.appendChild(b);
        return b;
      });
      actHost.appendChild(g);
      return { set: function (k) { bs.forEach(function (x, j) { x.setAttribute('aria-pressed', String(items[j][0] === k)); }); } };
    })();
    function setAct(k) { roll.act = k; actSw.set(k); }
    var shapePills = kit.pills(shapeHost, SHAPES.map(function (k) {
      return { key: k, label: { single: 'one', disc1: 'plus', disc2: 'disc', soup: 'soup' }[k], title: SHAPE_NAME[k] };
    }), function (k) { setShape(k); }, roll.shape);
    function setShape(k) { roll.shape = k; shapePills.set(k); }
    var drawSw = (function () {
      var g = h('div', { class: 'switch', role: 'group', 'aria-label': 'Budget and seed for new founders' });
      var items = [['search', 'random b and seed'], ['mine', 'these settings']];
      var bs = items.map(function (it) {
        var b = h('button', { type: 'button', 'aria-pressed': String(it[0] === roll.draw), text: it[1],
          title: it[0] === 'search' ? 'Each new founder gets a budget and a seed drawn uniformly, as in the offline search' : 'Each new founder uses the budget and seed set here' });
        b.addEventListener('click', function () { roll.draw = it[0]; bs.forEach(function (x, j) { x.setAttribute('aria-pressed', String(items[j][0] === it[0])); }); });
        g.appendChild(b);
        return b;
      });
      drawHost.appendChild(g);
    })();
    var updB = kit.slider(bSlider, bOut, function (v) { return bName(BUDGETS[v - 1]); }, function (v) { roll.bi = v - 1; });
    function setB(i) { roll.bi = i; bSlider.value = String(i + 1); updB(); }

    function startRun(fresh) {
      if (bOver.parentNode) bOver.parentNode.removeChild(bOver);
      var s = newSim(roll.act, BUDGETS[roll.bi]);
      roll.cells = shapeCells(roll.shape, kit.rng((roll.seed ^ 0x5bd1e995) >>> 0));
      placeSeed(s, roll.cells, roll.genome);
      roll.sim = s; roll.cls = LeniaClassifier(s, { T: 300 }); roll.res = null; roll.fresh = fresh;
      roll.phase = 'run';
      // what this run is, fixed while the controls may change; the name follows the genome (roll.gsrc), not the
      // Genome pill, so "Run again" after switching the pill still names the genome it runs
      var gs = roll.gsrc;
      roll.run = { act: roll.act, src: gs, b: BUDGETS[roll.bi], shape: roll.shape, seed: roll.seed,
        name: gs === 'designed' ? 'Hand-written' : gs === 'wave' ? 'Wave example' : 'Founder #' + roll.seed };
      setText(capRollName, roll.run.name);
      setText(rollSub, '');
      rollRender();
      syncRollButtons();
    }
    function newFounder() {
      if (roll.src !== 'xavier' && roll.src !== 'solo') { roll.src = 'xavier'; srcPills.set('xavier'); }
      roll.seed = (Math.random() * 1e9) >>> 0;
      var rng = kit.rng(roll.seed);
      roll.genome = roll.src === 'solo' ? screenedR(rng, roll.act) : xavierR(rng);
      roll.gsrc = roll.src;
      if (roll.draw === 'search') {
        setB((Math.random() * 13) | 0);
        setShape(SHAPES[(Math.random() * 4) | 0]);
      }
      startRun(true);
    }
    function runFixed() {
      roll.genome = roll.src === 'designed' ? DESIGNED : WAVE;
      roll.gsrc = roll.src;
      roll.seed = 0;
      startRun(false);
    }
    function finishRun() {
      var r = roll.res;
      if (roll.fresh) {
        var T = roll.tally[roll.run.act + '/' + roll.run.src];
        if (T) { T.n++; T[kindOf(r.cls)]++; drawBars(); }
      }
      var b = roll.run.b, sub = '';
      if (r.period && (r.cls === 'fills' || r.cls === 'periodic-spanning') && isFinite(b)) {
        sub = 'Period ' + r.period + ' against b + 2 = ' + (b + 2) + (r.period === b + 2 ? ': the budget sets the beat.' : '.');
      } else if (r.cls === 'glider') {
        sub = 'It moves (' + r.dr + ', ' + r.dc + ') every ' + r.period + ' generations: ' + axisSpeed(r) + ' cell per generation along its faster axis.';
      } else if (r.cls === 'extinct') sub = 'Every cell was dead by generation ' + r.tEnd + '.';
      if (roll.run.src === 'designed') {
        sub = 'Written by hand: one hidden unit weighs the cell itself and its left neighbour 0 and the other seven −5. ' +
          'From one founder cell it glides at every b ≥ 2 and at b = ∞ (move the slider, then Run again): one cell at b = 2, alternating one and two cells above. ' + sub;
      }
      if (roll.batch) {
        roll.batch.n++;
        if (r.cls === 'glider' || roll.batch.n >= BATCH_MAX) {
          sub = (r.cls === 'glider' ? 'Found after ' + roll.batch.n + ' founder' + (roll.batch.n > 1 ? 's' : '') + '. '
            : 'No glider in ' + roll.batch.n + ' founders. ') + sub;
          roll.batch = null;
          roll.phase = r.cls === 'extinct' ? 'idle' : 'show';
        } else {
          newFounder();
          return;
        }
      } else roll.phase = r.cls === 'extinct' ? 'idle' : 'show';
      setText(rollSub, sub);
      rollRender();
      syncRollButtons();
    }
    function rollSlice() {
      var t0 = performance.now(), cap = roll.batch ? 1e9 : SINGLE_CAP, k = 0;
      while (k < cap && !roll.res) {
        roll.sim.step();
        roll.res = roll.cls.tick();
        k++;
        if (performance.now() - t0 > SLICE_MS) break;
      }
      if (roll.res) finishRun();
      else rollRender(!kit.reduceMotion);
    }
    function stepRollShow() { roll.sim.step(); rollRender(); }
    function rollRender(paint) {
      var s = roll.sim;
      if (!s) return;
      if (paint !== false) paintGrid(cvRoll, s, null);
      var L = 0;
      for (var i = 0; i < s.N; i++) if (s.st[i] > s.alpha) L++;
      setText(RR.gen.b, String(s.gen));
      setText(RR.cells.b, String(L));
      var run = roll.run;
      setText(RR.seed.b, run.src === 'designed' ? 'hand-written' : run.src === 'wave' ? 'wave example' : '#' + run.seed);
      setText(capRollGen, run.act + ', b = ' + bName(run.b) + ', ' + SHAPE_NAME[run.shape]);
      var r = roll.res;
      setText(RR.cls.b, r ? (CLS[r.cls] || r.cls) : '…');
      setText(RR.period.b, r && r.period ? String(r.period) : '–');
      if (r && r.cls === 'glider') { S.clear(RR.heading.b); RR.heading.b.appendChild(headingNode(r.dr, r.dc, r.period)); }
      else setText(RR.heading.b, '–');
      var v;
      if (roll.batch) v = 'Founder ' + (roll.batch.n + 1) + ' of up to ' + BATCH_MAX + '…';
      else if (!r) v = 'Watching… ' + roll.cls.steps() + ' of 300';
      else v = describe(r);
      setText(rollVerdict, v);
    }
    function syncRollButtons() {
      bBatch.textContent = roll.batch ? 'Stop' : 'Roll until a glider';
      bAgain.disabled = !roll.genome || !!roll.batch;
      bRoll.disabled = !!roll.batch;
      var any = false, s = roll.sim;
      if (s && !roll.batch) for (var i = 0; i < s.N; i++) if (s.st[i] > s.alpha) { any = true; break; }
      bPoke.disabled = !any;
    }
    bRoll.addEventListener('click', function () { newFounder(); });
    bOver.addEventListener('click', function () { newFounder(); });
    bAgain.addEventListener('click', function () { if (roll.genome) startRun(false); });
    bBatch.addEventListener('click', function () {
      // Stop: the founder on show finishes as a single roll
      if (roll.batch) { roll.batch = null; syncRollButtons(); rollRender(); return; }
      roll.batch = { n: 0 };
      newFounder();
    });
    bPoke.addEventListener('click', function () {
      var s = roll.sim;
      if (!s) return;
      var run = roll.run;
      gal.selected = null; markSelected();
      benchLoad({ kind: 'roll', name: run.name, act: s.act, b: s.budget, genome: roll.genome, seed: roll.cells, snap: snapshot(s),
        title: run.name + ': ' + run.act + ', b = ' + bName(s.budget) + ', seed ' + SEED_PHRASE[run.shape] + ', from generation ' + s.gen + ' of your roll' }, 'reset');
      benchSec.scrollIntoView({ behavior: kit.reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });

    /* ---------------- charts ---------------- */

    function boxWidth(svg, lo, hi) {
      var w = svg.parentNode ? svg.parentNode.clientWidth : 0;
      return Math.round(Math.max(lo, Math.min(hi, w || hi)));
    }
    // stacked bars drawn at the box's own pixel width, so their text stays at the page's tick size
    function drawBars() {
      var svg = barSvg, W = boxWidth(svg, 290, 600), narrow = W < 470;
      var top = 6, L = narrow ? 0 : 124, R = narrow ? 64 : 76, iw = W - L - R;
      var lab = narrow ? 17 : 0, rowH = (narrow ? 50 : 46) + lab, H = top + ARMS.length * rowH;
      S.clear(svg);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      function bar(counts, n, y, hgt, who) {
        var x = L;
        KINDS.forEach(function (kd) {
          var c = counts[kd[0]] || 0;
          if (!c) return;
          var w = iw * c / n, x0 = x;
          var rect = svgEl('rect', { x: x0.toFixed(2), y: y, width: Math.max(1, w - 2).toFixed(2), height: hgt, rx: 1.5,
            fill: S.css(kd[2]), class: 'seg' });
          rect.addEventListener('pointerenter', function () {
            S.tipAt(barTip, svg, W, H, x0 + w / 2, y,
              '<b>' + who + '</b><div class="row"><i style="background:' + S.css(kd[2]) + '"></i>' + kd[1] + ': ' +
              comma(c) + ' of ' + comma(n) + ' (' + (100 * c / n).toFixed(1) + '%)</div>');
          });
          rect.addEventListener('pointerleave', function () { S.hideTip(barTip); });
          svg.appendChild(rect);
          x += w;
        });
      }
      ARMS.forEach(function (arm, k) {
        var y = top + k * rowH, off = D.counts[arm[0]], n = 0;
        KINDS.forEach(function (kd) { n += off[kd[0]]; });
        if (narrow) svg.appendChild(svgEl('text', { x: 0, y: y + 11, class: 'ticktext' }, arm[1]));
        else svg.appendChild(svgEl('text', { x: L - 8, y: y + 12, class: 'ticktext', 'text-anchor': 'end' }, arm[1]));
        y += lab;
        bar(off, n, y, 16, arm[1] + ', offline (' + comma(n) + ' runs)');
        svg.appendChild(svgEl('text', { x: L + iw + 6, y: y + 12, class: 'ticktext' }, (100 * off.glider / n).toFixed(1) + '% glide'));
        var T = roll.tally[arm[0]];
        if (T.n) {
          bar(T, T.n, y + 21, 9, arm[1] + ', your rolls');
          svg.appendChild(svgEl('text', { x: L + iw + 6, y: y + 29, class: 'ticktext' }, 'you ' + T.glider + '/' + T.n));
        } else {
          svg.appendChild(svgEl('text', { x: L, y: y + 31, class: 'ticktext', fill: S.css('--text-mute') }, 'your rolls: none yet'));
        }
      });
      svg.onpointerleave = function () { S.hideTip(barTip); };
      S.clear(barLegend);
      KINDS.forEach(function (kd) {
        var sw = h('i', { class: 'ln-swatch' });
        sw.style.background = S.css(kd[2]);
        barLegend.appendChild(h('span', {}, [sw, kd[1]]));
      });
    }
    function drawQd() {
      var w = boxWidth(qdSvg, 300, 600);
      kit.chart(qdSvg, {
        w: w, h: w < 470 ? 220 : 250, right: 82,
        x: { min: 0, max: 3000, label: 'evaluations', ticks: w < 470 ? 3 : 6 },
        y: { min: 0, max: 90, label: 'niches filled', ticks: 3, fmt: function (v) { return String(Math.round(v)); } },
        series: [
          { label: 'tanh, 83', colour: '--cyan', points: D.qdLog.tanh },
          { label: 'sigmoid, 61', colour: '--navy', points: D.qdLog.sigmoid }
        ],
        // after evaluation 500 most evaluations are mutants, but one in ten is still a random draw
        marks: [{ x: 500, label: 'mutants from here' }],
        tip: qdTip
      });
      S.clear(qdLegend);
      [['--cyan', 'tanh'], ['--navy', 'sigmoid']].forEach(function (it) {
        var sw = h('i', { class: 'ln-swatch' });
        sw.style.cssText = 'width:16px;height:3px;border-radius:2px;display:inline-block;background:' + S.css(it[0]);
        qdLegend.appendChild(h('span', {}, [sw, it[1]]));
      });
    }
    document.addEventListener('themechange', function () { drawBars(); drawQd(); });
    var resizeT = null, lastW = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        var w = barSvg.parentNode.clientWidth;
        if (w && w !== lastW) { lastW = w; drawBars(); drawQd(); }
      }, 150);
    });

    /* ---------------- start ---------------- */

    buildGallery();
    selectCreature(D.creatures[0]);
    drawBars();
    drawQd();
    syncRollButtons();
    setText(rollVerdict, 'Press “Roll a founder”.');

    /* One generation of every visible grid is a round. A round is worked off in slices of at most
       ROUND_MS per frame, so ten tiles plus the workbench never hold a frame for long; at "fast" the
       rounds simply run back to back. */
    var queue = [];
    function startRound() {
      queue = [];
      if (vis.gal) gal.tiles.forEach(function (t) { queue.push(t); });
      if (vis.bench && bench.sim) queue.push('bench');
      if (roll.phase === 'show' && vis.roll) queue.push('roll');
    }
    function frame(t) {
      // the roll gets the frame to itself while it is deciding (time-sliced); gallery and bench hold
      if (roll.phase === 'run') { rollSlice(); return; }
      if (!playing) return;
      if (!queue.length) { if (!tick(t)) return; startRound(); }
      var t0 = performance.now();
      while (queue.length && performance.now() - t0 < ROUND_MS) {
        var it = queue.shift();
        if (it === 'bench') stepBench(false);
        else if (it === 'roll') { if (roll.phase === 'show') stepRollShow(); }
        else if (it.live) stepTile(it);
      }
    }
    return {
      frame: frame,
      redraw: function () { drawBars(); drawQd(); gal.tiles.forEach(paintTile); benchRender(null, true); if (roll.sim) rollRender(); },
      hide: function () { S.hideTip(barTip); S.hideTip(qdTip); }
    };
  }
})();
