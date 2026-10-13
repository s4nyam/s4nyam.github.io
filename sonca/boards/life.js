/* ==========================================================
   Section 9 board: Game of Life — "Run a life-like CA".

   Three grids from the same start, step-locked:
     1. the exact rule, a plain B/S step on a 0/1 torus, at rule step k;
     2. the page's substrate (kit.S.NCA, the unmodified port of nca.py)
        with the rule genome, at substrate step k;
     3. the same substrate with the clock genome, at substrate step 2k
        (odd steps are the clock's "hold" steps and are shown too).
   Both substrate grids run at ip = 1, ppp = 0, budget = Infinity, and
   every live cell of the start is a founder (alpha = chem = 1, s.found)
   carrying the one genome: the conditions the clock genome was built
   and verified under. The ip and ppp switches let the visitor leave
   those conditions on purpose; the board says so when they do.

   One control changes the rule, and it is labelled as such: "no birth
   lag" (Life only) hands every genome-less cell of grid 2 the rule
   genome before each step — a port of makeSim(…, 'lagfree') in the
   research's dyn.js. With the other rules' genomes that control is not
   exact (their live alpha is unsaturated), so it is not offered there.

   Genomes and offline numbers: boards/data/life.js, built from the
   verified research export (board_life.json); genomes at 7 significant
   digits. The zoo's second Life entry (a = 148) is left out on purpose:
   Life runs with life.clock / life.naive (a = 661).
   ========================================================== */

(function () {
  'use strict';
  if (!window.SONCA || !window.SONCA.board) return;

  window.SONCA.board('life', function (root, kit) {
    var S = kit.S;
    var host = root.querySelector('.boardlive');
    host.innerHTML = '<p class="note">Loading the board&hellip;</p>';
    var api = null;

    kit.load('boards/data/life.js?v=1', function (err) {
      var D = window.SONCA_DATA && window.SONCA_DATA.life;
      if (err || !D) {
        host.innerHTML = '<p class="note">The board&rsquo;s data could not be loaded. Reload the page to try again.</p>';
        return;
      }
      api = build(D);
    });

    return {
      frame: function (t) { if (api) api.frame(t); },
      show: function () { if (api) api.show(); }
    };

    /* ---------------------------------------------------------------- */

    function build(D) {
      var P = S.P, css = kit.css;

      /* ---------- small DOM helpers ---------- */
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
          var b = h('button', { type: 'button', html: it.label, 'aria-pressed': String(it.key === initial) });
          if (it.title) b.title = it.title;
          b.addEventListener('click', function () { set(it.key); onPick(it.key); });
          hostEl.appendChild(b);
          return b;
        });
        function set(key) { bs.forEach(function (b, i) { b.setAttribute('aria-pressed', String(items[i].key === key)); }); }
        return { set: set };
      }
      function setText(n, s) { if (n.textContent !== s) n.textContent = s; }
      function intFmt(v) { return Math.round(v).toLocaleString('en-GB'); }

      /* ---------- board-scoped styles (minimal) ---------- */
      var style = h('style', {
        text:
          '[data-board="life"] .lifecv{position:relative}' +
          '[data-board="life"] .lifetag{position:absolute;left:5px;right:5px;bottom:5px;pointer-events:none;font-size:11.5px;' +
          'line-height:1.3;color:#f4f2fa;background:rgba(11,12,16,.85);border:1px solid rgba(255,255,255,.2);' +
          'border-radius:3px;padding:3px 6px}' +
          '[data-board="life"] .lifetag[hidden]{display:none}' +
          '[data-board="life"] table.lifecmp{font-size:13px;margin:2px 0 6px}' +
          '[data-board="life"] table.lifecmp th,[data-board="life"] table.lifecmp td{padding:5px 6px}' +
          '[data-board="life"] table.lifecmp td:first-child{color:var(--text-soft)}' +
          '[data-board="life"] table.lifecmp td{font-variant-numeric:tabular-nums}' +
          '[data-board="life"] .lifekey{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:0}' +
          '[data-board="life"] .lifeset{display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;margin:10px 0 4px}' +
          '[data-board="life"] .lifeset .ctl-label{white-space:nowrap}' +
          '[data-board="life"] .lifeset > *{justify-self:start}' +
          '[data-board="life"] .lifeset .switch button{padding:4px 9px;font-size:13px}' +
          '[data-board="life"] .lifeoff{margin-top:22px;border-top:1px solid var(--rule);padding-top:10px}' +
          '[data-board="life"] .lifeoff ul{margin:6px 0;padding-left:18px;font-size:14px;color:var(--text-soft)}' +
          '[data-board="life"] .lifeoff li{margin:5px 0}' +
          '[data-board="life"] .lifeoff table.data{font-size:13.5px}' +
          '[data-board="life"] .lifeoff table.data td:nth-child(3){text-align:left;color:var(--text-soft);font-size:12.5px}' +
          '[data-board="life"] .lifeoff table.data th:nth-child(3){text-align:left}' +
          '[data-board="life"] .lifeview{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:10px}' +
          '[data-board="life"] .lifeview .legend{margin-top:0}' +
          '[data-board="life"] .lifeview .switch button{padding:4px 10px;font-size:13px}' +
          '[data-board="life"] .lifewarn{color:var(--gcvp);font-weight:700}' +
          '@media (max-width:560px){[data-board="life"] .lifeset{grid-template-columns:1fr;gap:4px}}'
      });

      /* ---------- colours of the grids (always drawn on the dark ground) ---------- */
      var C_DEAD = [11, 12, 16], C_BOTH = [252, 236, 180], C_SUB = [230, 70, 80], C_RULE = [70, 140, 240];
      function rgbCss(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

      /* ---------- rules and genomes ---------- */
      function digitsMask(s) { var m = 0; for (var i = 0; i < s.length; i++) m |= 1 << +s[i]; return m; }
      function maxAbs(g) { var m = 0; for (var i = 0; i < g.length; i++) m = Math.max(m, Math.abs(g[i])); return m; }
      function sig(x) { return 1 / (1 + Math.exp(-x)); }

      // The rule genome on all 512 neighbourhoods, computed the way NCA.step() computes a cell that already
      // holds the genome: live positions read alpha = 1; biases (g36, g37, g42) are zero in every genome
      // here and the rule genomes' chemistry weights are zero, so chemistry does not enter. Alive = squashed
      // output above 0.5 and still above it after the budget's one-decimal rounding. The all-dead
      // neighbourhood is dead (the liveness gate).
      function staticScore(g, B, Sm) {
        var ok = 0, x, m, k;
        for (x = 0; x < 512; x++) {
          var n = 0;
          for (m = 0; m < 9; m++) if (m !== 4 && (x >> m) & 1) n++;
          var want = ((x >> 4) & 1) ? (Sm >> n) & 1 : (B >> n) & 1, got = 0;
          if (x) {
            var o = g[42];
            for (k = 0; k < 2; k++) {
              var a = g[36 + k];
              for (m = 0; m < 9; m++) if ((x >> m) & 1) a += g[k * 18 + m];
              o += g[38 + k] * sig(a);
            }
            var s = Math.fround(sig(Math.fround(o)));
            got = s > 0.5 && Math.round(s * 10) / 10 > 0.5 ? 1 : 0;
          }
          if (got === want) ok++;
        }
        return ok;
      }

      var RULES = [{ key: 'life', name: 'Life', rule: D.life.rule, clock: D.life.clock, naive: D.life.naive, isLife: true }];
      D.zoo.forEach(function (z, i) {
        if (z.name === 'Life') return;           // the zoo's own Life entry (a = 148) is not used
        RULES.push({ key: 'z' + i, name: z.name, rule: z.rule, clock: z.clock, naive: z.naive });
      });
      RULES.forEach(function (r) {
        var m = /^B([0-8]*)\/S([0-8]*)$/.exec(r.rule);
        r.bD = m[1]; r.sD = m[2]; r.B = digitsMask(m[1]); r.S = digitsMask(m[2]);
        r.gClock = Float32Array.from(r.clock); r.gNaive = Float32Array.from(r.naive);
        r.maxClock = maxAbs(r.gClock); r.maxNaive = maxAbs(r.gNaive);
        r.score = null;                          // static 512-case check, computed on first use
      });
      function ruleBy(key) { for (var i = 0; i < RULES.length; i++) if (RULES[i].key === key) return RULES[i]; return RULES[0]; }
      function listDigits(d) {
        if (!d.length) return '';
        if (d.length === 1) return d;
        return d.slice(0, -1).split('').join(', ') + ' or ' + d.slice(-1);
      }
      function describe(r) {
        var b = r.bD.length ? 'born with ' + listDigits(r.bD) + ' neighbour' + (r.bD === '1' ? '' : 's') : 'never born';
        var s = r.sD.length ? 'survives with ' + listDigits(r.sD) : 'never survives a step';
        return b + ', ' + s;
      }

      /* ---------- starting patterns ---------- */
      var PATS = [
        { key: 'glider', label: 'Glider', W: 32, cells: D.patterns.glider, at: 0.25 },
        { key: 'blinker', label: 'Blinker', W: 16, cells: D.patterns.blinker, at: 0.5 },
        { key: 'rpent', label: 'R-pentomino', W: 64, cells: D.patterns.rpent, at: 0.5 },
        { key: 'soup50', label: '50% soup', W: 64, p: 0.5 },
        { key: 'soup15', label: '15% soup', W: 64, p: 0.15 },
        { key: 'draw', label: 'Draw your own', W: 32 }
      ];
      function patBy(key) { for (var i = 0; i < PATS.length; i++) if (PATS[i].key === key) return PATS[i]; return PATS[0]; }
      var soupSeed = { soup50: 21, soup15: 21 };
      function makeStart(p) {
        var W = p.W, a = new Uint8Array(W * W), k;
        if (p.cells) {
          var c = Math.round(W * p.at);
          p.cells.forEach(function (d) { a[((c + d[0] + W) % W) * W + ((c + d[1] + W) % W)] = 1; });
        } else if (p.p) {
          var r = kit.rng(soupSeed[p.key]);      // mulberry32, the research's soup generator
          for (k = 0; k < W * W; k++) a[k] = r() < p.p ? 1 : 0;
        }
        return a;
      }

      /* ---------- the exact rule ---------- */
      function ruleStep(a, W, B, Sm) {
        var b = new Uint8Array(W * W), i, j, di, dj;
        for (i = 0; i < W; i++) {
          for (j = 0; j < W; j++) {
            var n = 0;
            for (di = -1; di <= 1; di++) {
              var row = ((i + di + W) % W) * W;
              for (dj = -1; dj <= 1; dj++) {
                if (di || dj) n += a[row + (j + dj + W) % W];
              }
            }
            b[i * W + j] = a[i * W + j] ? (Sm >> n) & 1 : (B >> n) & 1;
          }
        }
        return b;
      }

      /* ---------- the substrate: two unmodified engines ---------- */
      // ip = 1, ppp = 0, budget = Infinity unless the visitor changes ip / ppp with the switches below.
      var s2 = S.NCA({ W: 32, init: 0, ip: 1, ppp: 0, budget: Infinity, act: 'sigmoid' });   // rule genome
      var s3 = S.NCA({ W: 32, init: 0, ip: 1, ppp: 0, budget: Infinity, act: 'sigmoid' });   // clock genome
      function seedSim(s, a0, W, g) {
        if (s.W !== W) s.resize(W);
        // every live cell of the start is a founder carrying the one genome: alpha = chem = 1
        s.seed(0, function (t) { for (var k = 0; k < W * W; k++) if (a0[k]) t.found(k, g); });
      }

      // MODIFIED RULE — the "no birth lag" control, ported from the research's dyn.js (makeSim, mode
      // 'lagfree'). Before every step of grid 2, every cell that holds no genome is handed the rule genome
      // (has = 1), so a dead cell computes its own next state from its current neighbourhood. nca.py has no
      // such step: there a dead cell must first inherit a genome from a living neighbour, and can come alive
      // only on the step after. Offered for Life only (life.naive, a = 661), where it is exact.
      function primeAll(s, g) {
        for (var q = 0; q < s.N; q++) if (!s.has[q]) { s.g.set(g, q * P); s.has[q] = 1; }
      }

      /* ---------- state ---------- */
      var st = {
        rule: RULES[0], pat: PATS[0], W: 32, a0: null, ex: null, k: 0,
        ip: 1, ppp: 0, lagFree: false, view: 'agree',
        playing: !kit.reduceMotion, speed: 10,
        miss2: -1, miss3: -1, h2: [], h3: [], m2: null, m3: null, nEx: 0, chem: 0, nLive3: 0,
        msg: ''
      };

      /* ---------- DOM ---------- */
      var host = root.querySelector('.boardlive');
      kit.clear(host);
      host.appendChild(style);

      var rulePills = h('div', { role: 'group', 'aria-label': 'Life-like rule' });
      var patPills = h('div', { role: 'group', 'aria-label': 'Starting pattern' });
      host.appendChild(h('div', { class: 'presetrows' }, [
        h('span', { class: 'ctl-label', text: 'Rule' }), rulePills,
        h('span', { class: 'ctl-label', text: 'Start from' }), patPills
      ]));
      var note = h('p', { class: 'note presetnote', 'aria-live': 'polite' });
      host.appendChild(note);

      var playBtn = btn(st.playing ? 'Pause' : 'Play', 'primary');
      var stepBtn = btn('Step');
      var halfBtn = btn('½ step');
      halfBtn.title = 'One substrate step of the clock grid: a hold step or a compute step';
      var resetBtn = btn('Reset');
      var speedIn = h('input', { type: 'range', id: 'lifeSpeed', min: '1', max: '60', step: '1', value: String(st.speed) });
      var speedOut = h('output', { for: 'lifeSpeed' });
      var speedBox = h('div', { class: 'slider', style: 'grid-template-columns:3.6em minmax(90px,1fr) 7.4em;margin:0;flex:1 1 260px;max-width:420px' }, [
        h('label', { for: 'lifeSpeed', text: 'speed' }), speedIn, speedOut
      ]);
      host.appendChild(h('div', { class: 'controls' }, [playBtn, stepBtn, halfBtn, resetBtn, speedBox]));

      function fig(label, aria, draw) {
        var cv = h('canvas', { class: 'cv' + (draw ? ' draw' : ''), width: 32, height: 32, role: 'img', 'aria-label': aria });
        var lab = h('span', { text: label }), em = h('em', { text: '' });
        var tag = h('div', { class: 'lifetag', hidden: '' });
        var f = h('figure', { class: 'cvfig' }, [h('div', { class: 'lifecv' }, [cv, tag]), h('figcaption', null, [lab, em])]);
        return { fig: f, cv: cv, lab: lab, em: em, tag: tag };
      }
      var F1 = fig('Exact rule', 'The exact rule, cell by cell. Click or drag to draw cells.', true);
      var F2 = fig('Rule genome', 'The substrate running the rule genome');
      var F3 = fig('Clock genome', 'The substrate running the clock genome');
      var legend = h('div', { class: 'legend' });
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Overlap of live cells with the exact rule, against rule step, for the two substrate grids');
      var tip = h('div', { class: 'tip' });
      var chartBox = h('div', { class: 'chartbox', style: 'margin-top:14px' }, [svg, tip]);
      var chartLegend = h('div', { class: 'legend', style: 'margin-top:4px' });

      // readouts
      function rn(cap) { var b = h('b', { text: '–' }), c = h('span', { text: cap }); return { node: h('div', null, [b, c]), b: b, c: c }; }
      var Rk = rn('rule step'), Rt = rn('clock grid’s substrate step'), Rn = rn('live cells, exact rule'), Rc = rn('chemistry of live clock cells');
      var readnum = h('div', { class: 'readnum' }, [Rk.node, Rt.node, Rn.node, Rc.node]);

      function keyDot(v) { var i = h('i', { class: 'lifekey', 'data-c': v }); return i; }
      var thRtxt = h('span', { text: 'Rule genome' });
      var thR = h('th', null, [keyDot('--warn'), thRtxt]);
      var thC = h('th', null, [keyDot('--clogv'), h('span', { text: 'Clock genome' })]);
      function trow(label) {
        var a = h('td', { text: '–' }), b = h('td', { text: '–' });
        return { tr: h('tr', null, [h('td', { text: label }), a, b]), a: a, b: b };
      }
      var Tn = trow('live cells'), Tj = trow('overlap (Jaccard)'), Ta = trow('cells agreeing'),
        Te = trow('first mismatch'), Tw = trow('largest |weight|');
      var cmpTable = h('table', { class: 'data lifecmp' }, [
        h('caption', { class: 'note', text: 'Against the exact rule, now' }),
        h('thead', null, [h('tr', null, [h('th', { text: '' }), thR, thC])]),
        h('tbody', null, [Tn.tr, Tj.tr, Ta.tr, Te.tr, Tw.tr])
      ]);
      var staticNote = h('p', { class: 'note', style: 'margin:10px 0 0' });

      var viewSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'How to colour the substrate grids' });
      var lagSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Birth lag on the rule-genome grid' });
      var lagNote = h('p', { class: 'note', style: 'margin:0', hidden: '' });
      var ipSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Inheritance probability ip' });
      var pppSw = h('div', { class: 'switch', role: 'group', 'aria-label': 'Mutation probability ppp' });
      var lagLabel = h('span', { class: 'ctl-label', text: 'Birth lag' });
      var lagCell = h('div', null, [lagSw, lagNote]);
      var setBox = h('div', { class: 'lifeset' }, [
        lagLabel, lagCell,
        h('span', { class: 'ctl-label', html: '<span class="mono">ip</span>' }), ipSw,
        h('span', { class: 'ctl-label', html: '<span class="mono">ppp</span>' }), pppSw
      ]);
      var setNote = h('p', { class: 'note', style: 'margin:6px 0 0' });

      host.appendChild(h('div', { class: 'lab' }, [
        h('div', null, [
          h('div', { class: 'cvrow' }, [F1.fig, F2.fig, F3.fig]),
          h('div', { class: 'lifeview' }, [h('span', { class: 'ctl-label', text: 'Colour by' }), viewSw, legend]),
          chartBox, chartLegend, staticNote
        ]),
        h('div', { class: 'readout' }, [readnum, cmpTable, setBox, setNote])
      ]));

      /* ---------- offline panel ---------- */
      // Numbers from the verified research digest (construct.js, repr.js, ratio_search.js, asis.js,
      // native.js, soupweights.js, clock*.js, zoo.js, dyn.js); none is recomputed here.
      var OFF = [
        ['Hand-built genome, sigmoid', '512', 'analytic construction'],
        ['Hand-built genome, tanh', '512', 'grid search'],
        ['CMA-ES from random starts, raw weights', '456', 'best of 3 seeds × 12 restarts, sigmoid and tanh'],
        ['CMA-ES, weights shared around the neighbourhood', '484', 'best of 3 × 12; tanh 476'],
        ['CMA-ES, scale-free five-parameter form', '512', 'in 3 of 48 restarts'],
        ['CMA-ES, three hidden units (a bigger agent)', '512', '3 of 3 seeds, sigmoid'],
        ['Random Xavier founders, as is', '395', 'best of 100,000; tanh 404'],
        ['Viability = correctness (modified rule)', '447', 'modal genome in 9 of 12 soup runs, 5,000 generations; best ever 451; no births'],
        ['Always dead', '372', 'baseline']
      ];
      var offRows = OFF.map(function (r) { return h('tr', null, [h('td', { text: r[0] }), h('td', { text: r[1] }), h('td', { text: r[2] })]); });
      host.appendChild(h('div', { class: 'lifeoff' }, [
        h('p', { class: 'kicker', style: 'margin:0 0 4px', text: 'Offline, measured with this page’s engine — not live' }),
        h('div', { class: 'two' }, [
          h('div', { class: 'tablewrap', style: 'margin-top:0' }, [h('table', { class: 'data' }, [
            h('caption', { class: 'note', html: 'Can the agent hold Life? Neighbourhood cases right, of 512. Two hidden units and zero biases unless stated.' }),
            h('thead', null, [h('tr', null, [h('th', { text: 'Genome or search' }), h('th', { text: 'Right' }), h('th', { text: 'How measured' })])]),
            h('tbody', null, offRows)
          ])]),
          h('div', null, [
            h('p', { class: 'kicker', style: 'margin:0', text: 'Dynamics, offline runs' }),
            h('ul', null, [
              h('li', { html: 'Rule genome: first mismatch at step 1 from every start tried except a still block. From 50% soups with seeds 21, 22 and 23 it holds 46, 57 and 43 cells after 200 steps; Life holds 292, 194 and 351. Try those seeds above.' }),
              h('li', { html: 'With the birth lag removed (a modified rule) the same genome is exact on 7 of 7 starts, for 60–200 steps.' }),
              h('li', { html: 'Clock genome: exact at half speed in 24 of 24 sigmoid runs, up to 500 Life steps, and 5 of 5 tanh runs, with <span class="mono">ip</span>&nbsp;=&nbsp;1, <span class="mono">ppp</span>&nbsp;=&nbsp;0, no lifespan limit and every founder carrying the genome at &alpha;&nbsp;=&nbsp;chem&nbsp;=&nbsp;1 (blinker and glider on a 32&nbsp;&times;&nbsp;32 torus, R-pentomino and 50% soups on 64&nbsp;&times;&nbsp;64).' }),
              h('li', { html: 'On 64&nbsp;&times;&nbsp;64 50% soups, <span class="mono">ip</span> 0.99, 0.9 and 0.5 broke the clock at Life step 1 (9 of 9 runs), and <span class="mono">ppp</span> from 10<sup>&minus;4</sup> to 0.1 broke it within 1&ndash;4 Life steps (12 of 12 runs); by Life step 300 the overlap was 0.016&ndash;0.059. Live, with other starts and other random draws, it can last a few steps longer.' }),
              h('li', { html: 'The other ten rules: each clock genome exact in 6 of 6 runs over 200 rule steps; without the clock, 0 of 6. For Coral and Vote, 3 of the 6 were 15% soups that die out under the rule itself.' })
            ])
          ])
        ])
      ]));

      /* ---------- controls ---------- */
      var rulePk = kit.pills(rulePills, RULES.map(function (r) { return { key: r.key, label: r.name, title: r.rule }; }), function (key) {
        var r = ruleBy(key);
        if (r === st.rule) return;
        st.rule = r;
        if (!r.isLife && st.lagFree) { st.lagFree = false; lagPk.set('off'); }
        st.msg = '';
        restart(st.a0);
        syncControls();
      }, 'life');

      var patPk = kit.pills(patPills, PATS.map(function (p) { return { key: p.key, label: p.label }; }), function (key) {
        var p = patBy(key);
        if (p === st.pat && p.p) soupSeed[p.key]++;              // a soup picked again: next seed
        st.pat = p;
        st.msg = '';
        if (p.key === 'draw') { setPlaying(false); st.msg = 'draw'; }
        restart(makeStart(p));
      }, 'glider');

      var viewPk = seg(viewSw, [
        { key: 'agree', label: 'agreement' }, { key: 'alpha', label: 'alpha' }, { key: 'chem', label: 'chemistry' }
      ], function (key) { st.view = key; st.acc = 0; drawLegend(); dirty = true; }, 'agree');

      var lagPk = seg(lagSw, [{ key: 'off', label: 'as in nca.py' }, { key: 'on', label: 'removed' }], function (key) {
        var on = key === 'on';
        if (on === st.lagFree) return;
        st.lagFree = on;
        st.msg = '';
        restart(st.a0);
      }, 'off');
      lagSw.querySelectorAll('button')[1].title = 'Modified rule: every cell is handed the genome before each step';

      var ipPk = seg(ipSw, [{ key: '1', label: '1' }, { key: '0.99', label: '0.99' }, { key: '0.9', label: '0.9' }, { key: '0.5', label: '0.5' }],
        function (key) { if (+key === st.ip) return; st.ip = +key; st.msg = ''; restart(st.a0); }, '1');
      var pppPk = seg(pppSw, [{ key: '0', label: '0' }, { key: '0.0001', label: '10<sup>−4</sup>' }, { key: '0.001', label: '10<sup>−3</sup>' },
        { key: '0.01', label: '0.01' }, { key: '0.1', label: '0.1' }],
        function (key) { if (+key === st.ppp) return; st.ppp = +key; st.msg = ''; restart(st.a0); }, '0');

      function setPlaying(on) {
        st.playing = on;
        playBtn.textContent = on ? 'Pause' : 'Play';
        st.acc = 0;
      }
      playBtn.addEventListener('click', function () { setPlaying(!st.playing); if (st.msg === 'draw') { st.msg = ''; dirty = true; } });
      stepBtn.addEventListener('click', function () { setPlaying(false); fullStep(); paint(); });
      halfBtn.addEventListener('click', function () { setPlaying(false); halfStep(); paint(); });
      resetBtn.addEventListener('click', function () { restart(st.a0); paint(); });
      kit.slider(speedIn, speedOut, function (v) { return v + ' rule steps/s'; }, function (v) { st.speed = v; });

      // draw on the exact-rule grid: every edit restarts all three grids from the edited state
      var paintVal = 1, drawBase = null;
      kit.pointer(F1.cv, function () { return st.W; }, function () { return st.W; }, function (row, col, phase) {
        if (phase === 'up') { drawBase = null; return; }
        if (row < 0 || col < 0 || row >= st.W || col >= st.W) return;
        var idx = row * st.W + col;
        if (phase === 'down') {
          setPlaying(false);
          drawBase = st.ex.slice();
          paintVal = drawBase[idx] ? 0 : 1;
          if (st.pat.key !== 'draw') { st.pat = patBy('draw'); patPk.set('draw'); }
          st.msg = 'drawn';
        }
        if (!drawBase || drawBase[idx] === paintVal) return;
        drawBase[idx] = paintVal;
        restart(drawBase.slice());
      });

      /* ---------- running ---------- */
      var dirty = true, chartDirty = true, lastChart = -1e9, prevT = null;
      st.acc = 0;

      function restart(a0) {
        st.a0 = a0;
        st.W = Math.round(Math.sqrt(a0.length));
        st.ex = a0.slice();
        st.k = 0;
        s2.ip = s3.ip = st.ip; s2.ppp = s3.ppp = st.ppp;
        seedSim(s2, a0, st.W, st.rule.gNaive);
        seedSim(s3, a0, st.W, st.rule.gClock);
        st.miss2 = st.miss3 = -1;
        st.h2 = []; st.h3 = [];
        measure(true);
        dirty = true; chartDirty = true;
        writeNote();
      }

      // one substrate step of the clock grid; on a compute step the rule and the rule-genome grid advance too
      function halfStep() {
        if (s3.gen % 2 === 0) {
          s3.step();                                      // hold step: substrate 2k -> 2k + 1
          measure(false);
        } else {
          s3.step();                                      // compute step: 2k + 1 -> 2k + 2
          st.ex = ruleStep(st.ex, st.W, st.rule.B, st.rule.S);
          if (st.lagFree) primeAll(s2, st.rule.gNaive);   // MODIFIED RULE, see primeAll
          s2.step();
          st.k++;
          measure(true);
        }
        dirty = true;
      }
      function fullStep() { if (s3.gen % 2 === 0) halfStep(); halfStep(); }

      function compare(s, ref) {
        var n = s.N, same = 0, inter = 0, uni = 0, live = 0, a = s.alpha, st0 = s.st, q;
        for (q = 0; q < n; q++) {
          var m = st0[q] > a ? 1 : 0, r = ref[q];
          live += m;
          if (m === r) same++;
          if (m && r) inter++;
          if (m || r) uni++;
        }
        return { same: same, n: n, live: live, jac: uni ? inter / uni : 1 };
      }
      function measure(ruleStepDone) {
        var ex = st.ex, q, n = 0;
        for (q = 0; q < ex.length; q++) n += ex[q];
        st.nEx = n;
        st.m2 = compare(s2, ex);
        st.m3 = compare(s3, ex);
        if (st.m2.same < st.m2.n && st.miss2 < 0) st.miss2 = st.k;
        if (st.m3.same < st.m3.n && st.miss3 < 0) st.miss3 = Math.floor(s3.gen / 2);
        var c = 0, nl = 0, N = s3.N;
        for (q = 0; q < N; q++) if (s3.st[q] > s3.alpha) { c += s3.st[N + q]; nl++; }
        st.chem = nl ? c / nl : NaN;
        st.nLive3 = nl;
        if (ruleStepDone) {
          st.h2.push([st.k, st.m2.jac]);
          st.h3.push([st.k, st.m3.jac]);
          if (st.h2.length > 4000) { st.h2 = halve(st.h2); st.h3 = halve(st.h3); }   // keep memory bounded on long runs
          chartDirty = true;
        }
      }

      function halve(pts) {
        var out = [], i;
        for (i = 0; i < pts.length; i += 2) out.push(pts[i]);
        if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
        return out;
      }

      /* ---------- painting ---------- */
      function paintExact() {
        var ex = st.ex;
        kit.draw(F1.cv, st.W, st.W, function (i, rgb) {
          var c = ex[i] ? C_BOTH : C_DEAD; rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
        });
      }
      function paintSub(cv, s) {
        if (st.view === 'agree') {
          var ex = st.ex, a = s.alpha, v = s.st;
          kit.draw(cv, st.W, st.W, function (i, rgb) {
            var m = v[i] > a, r = ex[i];
            var c = m && r ? C_BOTH : m ? C_SUB : r ? C_RULE : C_DEAD;
            rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
          });
        } else {
          kit.paint(cv, s, st.view === 'chem' ? 'chem' : 'alpha');
        }
      }
      function pct(m) {
        if (m.same === m.n) return '100%';
        var p = m.same / m.n * 100;
        return p > 99.9 ? '>99.9%' : p.toFixed(1) + '%';
      }
      function paint() {
        dirty = false;
        paintExact(); paintSub(F2.cv, s2); paintSub(F3.cv, s3);
        var t = s3.gen, hold = t % 2 === 1;
        setText(F1.em, 'step ' + st.k);
        setText(F2.lab, st.lagFree ? 'Rule genome, no lag' : 'Rule genome');
        setText(thRtxt, st.lagFree ? 'No lag (modified)' : 'Rule genome');
        setText(F2.em, (st.lagFree ? 'modified · ' : '') + 'step ' + st.k);
        setText(F3.em, 'step ' + t + (hold ? ' · hold' : ''));

        // tags over the canvases
        var tag3 = '', tag2 = '', tag1 = '';
        if (st.view === 'chem') {
          if (st.nLive3 > 0) {
            tag3 = hold ? 'Hold step · chemistry ' + fmtChem(st.chem) + ': black here, but the cells are alive (see alpha)'
              : 'Compute step · chemistry ' + fmtChem(st.chem);
          }
          if (s2.gen > 0) tag2 = 'No chemistry weights: chemistry stays at 0.5, drawn black.';
        }
        if (st.nEx === 0 && st.k === 0 && st.pat.key === 'draw') tag1 = 'Click or drag here to add cells.';
        showTag(F1.tag, tag1); showTag(F2.tag, tag2); showTag(F3.tag, tag3);

        // readouts
        setText(Rk.b, intFmt(st.k));
        setText(Rt.b, intFmt(t) + (hold ? ' · hold' : ''));
        setText(Rn.b, intFmt(st.nEx));
        setText(Rc.b, isNaN(st.chem) ? '–' : fmtChem(st.chem));
        setText(Rc.c, isNaN(st.chem) ? 'chemistry of live clock cells' : hold ? 'chemistry of live clock cells: compute next' : 'chemistry of live clock cells: hold next');
        setText(Tn.a, intFmt(st.m2.live)); setText(Tn.b, intFmt(st.m3.live));
        setText(Tj.a, st.m2.jac.toFixed(3)); setText(Tj.b, st.m3.jac.toFixed(3));
        setText(Ta.a, pct(st.m2)); setText(Ta.b, pct(st.m3));
        exactCell(Te.a, st.miss2); exactCell(Te.b, st.miss3);
        setText(Tw.a, fmtW(st.rule.maxNaive)); setText(Tw.b, fmtW(st.rule.maxClock));
      }
      function fmtChem(v) { return v < 0.005 ? (v === 0 ? '0' : '≈ 0') : v.toFixed(2); }
      function fmtW(v) { return v >= 100 ? v.toFixed(0) : v.toFixed(1); }
      function exactCell(td, miss) {
        var txt = miss < 0 ? 'none yet' : 'step ' + miss;
        setText(td, txt);
        td.style.color = miss < 0 ? '' : css('--gcvp');
      }
      function showTag(tagEl, txt) {
        if (!txt) { if (!tagEl.hidden) tagEl.hidden = true; return; }
        setText(tagEl, txt);
        if (tagEl.hidden) tagEl.hidden = false;
      }
      function writeNote() {
        var r = st.rule, p = st.pat, W = st.W, bits = [];
        bits.push('<b>' + r.name + '</b>' + (r.name === r.rule ? '' : ' (' + r.rule + ')') + ': ' + describe(r) + '.');
        var where = W + '&nbsp;&times;&nbsp;' + W + ' torus';
        if (p.p) bits.push(p.label + ', seed ' + soupSeed[p.key] + ' (pick it again for the next seed), ' + where + '.');
        else if (p.key === 'draw') bits.push(st.msg === 'drawn' ? 'Your pattern, ' + where + '. Every edit restarts all three grids from what is drawn.' : 'Click or drag on the exact-rule grid to add or remove cells, then press Play.');
        else bits.push(p.label + ', ' + where + '.');
        if (st.ip !== 1 || st.ppp !== 0) {
          bits.push('<span class="lifewarn">Settings changed to <span class="mono">ip</span>&nbsp;=&nbsp;' + st.ip + ', <span class="mono">ppp</span>&nbsp;=&nbsp;' + pppTxt(st.ppp) +
            '.</span> The clock was built for <span class="mono">ip</span>&nbsp;=&nbsp;1, <span class="mono">ppp</span>&nbsp;=&nbsp;0; with <span class="mono">ip</span>&nbsp;&lt;&nbsp;1 or <span class="mono">ppp</span>&nbsp;&gt;&nbsp;0 the substrate draws random numbers, so each run differs.');
        }
        if (st.lagFree) bits.push('Middle grid: <b>modified rule</b>, every cell is handed the genome before each step.');
        note.innerHTML = bits.join(' ');
        var M = function (x) { return '<span class="mono">' + x + '</span>'; };
        setNote.innerHTML = st.ip === 1 && st.ppp === 0
          ? 'Both substrate grids run ' + M('ip') + '&nbsp;=&nbsp;1, ' + M('ppp') + '&nbsp;=&nbsp;0 and no lifespan limit, with every founder carrying the genome, as the clock needs. Change ' + M('ip') + ' or ' + M('ppp') + ' to watch it break.'
          : 'Both substrate grids now run ' + M('ip') + '&nbsp;=&nbsp;' + st.ip + ', ' + M('ppp') + '&nbsp;=&nbsp;' + pppTxt(st.ppp) + '. Set them back to 1 and 0 to restore the conditions the clock was built for.';
      }
      function pppTxt(v) { return v === 0.0001 ? '10<sup>−4</sup>' : v === 0.001 ? '10<sup>−3</sup>' : String(v); }

      function syncControls() {
        var r = st.rule;
        if (r.score === null) r.score = staticScore(r.gNaive, r.B, r.S);
        staticNote.innerHTML = 'Checked here on all 512 neighbourhoods (live neighbours at &alpha;&nbsp;=&nbsp;1), the rule genome gives the rule&rsquo;s answer in <b>' +
          r.score + '</b>.' +
          (r.isLife ? ' What goes wrong in the middle grid is the birth lag, not the rule.' : '');
        lagSw.style.display = r.isLife ? '' : 'none';    // .switch sets display, so [hidden] alone is not enough
        lagNote.hidden = r.isLife;
        lagNote.textContent = 'Offered for Life only: with this rule’s genome the control is not exact.';
        writeNote();
      }

      /* ---------- legends and chart ---------- */
      function sw(rgb, label) {
        return h('span', null, [h('i', { class: 'swatch', style: 'background:' + rgbCss(rgb) + ';outline:1px solid var(--rule-strong)' }), label]);
      }
      function drawLegend() {
        kit.clear(legend);
        if (st.view === 'agree') {
          legend.appendChild(sw(C_BOTH, 'alive in both'));
          legend.appendChild(sw(C_SUB, 'alive in the substrate only'));
          legend.appendChild(sw(C_RULE, 'alive in the rule only'));
        } else if (st.view === 'alpha') {
          legend.appendChild(h('span', { text: 'Substrate grids drawn by alpha, brighter for higher values; dead cells black.' }));
        } else {
          legend.appendChild(h('span', { html: 'Substrate grids drawn by chemistry. Playing runs one substrate step every half second here, so the clock can be seen: chemistry high, then low.' }));
        }
      }
      function paintKeys() {
        host.querySelectorAll('i.lifekey[data-c]').forEach(function (i) { i.style.background = css(i.getAttribute('data-c')); });
      }
      function thin(pts) {
        if (pts.length <= 600) return pts;
        var out = [], stride = pts.length / 600, i;
        for (i = 0; i < 600; i++) out.push(pts[Math.floor(i * stride)]);
        out.push(pts[pts.length - 1]);
        return out;
      }
      // a round x-axis end at or above k, with a tick count that gives round tick values
      var XMAX = [[20, 4], [50, 5], [100, 5], [200, 4], [300, 3], [400, 4], [500, 5], [600, 3], [800, 4], [1000, 5],
        [1500, 3], [2000, 4], [3000, 3], [4000, 4], [5000, 5]];
      function niceX(k) {
        for (var i = 0; i < XMAX.length; i++) if (k <= XMAX[i][0]) return XMAX[i];
        return [Math.ceil(k / 5000) * 5000, 5];
      }
      function lineKey(colourVar, dash, label) {
        var c = css(colourVar);
        return h('span', null, [h('i', { class: 'swatch line', style: 'background:' + (dash ? 'repeating-linear-gradient(90deg,' + c + ' 0 5px,transparent 5px 8px)' : c) }), label]);
      }
      function drawChart() {
        chartDirty = false;
        var w = Math.max(300, Math.round(chartBox.clientWidth || 600));
        var narrow = w < 480, nx = niceX(st.k);
        var lab2 = st.lagFree ? 'rule genome, no birth lag' : 'rule genome';
        kit.chart(svg, {
          w: w, h: narrow ? 190 : 210, left: 60, right: 16,
          x: { min: 0, max: nx[0], label: 'rule step', ticks: nx[1] },
          y: { min: 0, max: 1, label: 'overlap (Jaccard)', ticks: 4 },
          series: [
            { label: lab2, colour: '--warn', points: thin(st.h2), width: 2, end: false },
            { label: 'clock genome', colour: '--clogv', points: thin(st.h3), width: 2, dash: '7 4', end: false }
          ],
          tip: tip
        });
        kit.clear(chartLegend);
        chartLegend.appendChild(lineKey('--warn', false, lab2));
        chartLegend.appendChild(lineKey('--clogv', true, 'clock genome'));
        chartLegend.appendChild(h('span', { text: 'Live: overlap of each grid’s live cells with the exact rule’s, every rule step (1 = identical).' }));
      }
      document.addEventListener('themechange', function () { paintKeys(); drawChart(); dirty = true; });
      if ('ResizeObserver' in window) {
        var lastW = 0;
        new ResizeObserver(function () {
          var w = Math.round(chartBox.clientWidth);
          if (w && Math.abs(w - lastW) > 4) { lastW = w; chartDirty = true; }
        }).observe(chartBox);
      }

      /* ---------- go ---------- */
      st.pat = PATS[0];
      restart(makeStart(st.pat));
      syncControls();
      drawLegend();
      paintKeys();
      paint();
      drawChart();

      return {
        frame: function (t) {
          if (prevT === null) prevT = t;
          var dt = Math.min(250, Math.max(0, t - prevT));
          prevT = t;
          if (st.playing) {
            // chemistry view: one substrate step every 500 ms, so the clock's hold steps can be seen
            // (and the grid does not flash faster than twice a second); otherwise whole rule steps
            // at most 3 steps, and no new step once ~12 ms of this frame are spent, so a slow machine
            // runs the grids slower instead of dropping frames; a backlog that cannot be met is dropped
            var slow = st.view === 'chem', interval = slow ? 500 : 1000 / st.speed, n = 0, t0 = performance.now();
            st.acc += dt;
            while (st.acc >= interval && n < 3) {
              st.acc -= interval; if (slow) halfStep(); else fullStep(); n++;
              if (performance.now() - t0 > 12) break;
            }
            if (st.acc >= interval) st.acc = 0;
          }
          if (dirty) paint();
          if (chartDirty && t - lastChart > 200) { lastChart = t; drawChart(); }
        },
        show: function () { prevT = null; paintKeys(); dirty = true; chartDirty = true; }
      };
    }
  });
})();
