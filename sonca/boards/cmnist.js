/* ==========================================================
   Section 9, board "cmnist": Colored MNIST, where colour lies.

   Uses the engine, data and sample grid of boards/mnist.js
   (SONCA.mnistShared), which loads first.

   THE RULE IS MODIFIED, as on the MNIST board: the clamped-alpha
   frame of the research scripts (see the header of mnist.js). The
   one addition is how colour enters: the colour sets the clamped
   alpha of the ink, 1.0 for red and 0.6 for green (both above the
   0.5 liveness threshold), so every cell reads the colour in its
   own neighbourhood. The rule "evolved with colour removed" sees
   all ink at alpha 1.0. Labels follow IRM's Colored MNIST recipe
   (Arjovsky et al. 2019): y = (digit < 5), flipped for 25% of
   digits; the colour equals y except for a fraction e of digits.
   Unlike IRM, digits are full 28 x 28 and colour is one alpha level,
   not two colour channels.
   ========================================================== */

(function () {
  'use strict';

  var S = window.SONCA;
  if (!S || !S.board) return;

  S.board('cmnist', function (root, kit) {
    var live = root.querySelector('.boardlive');
    var M = S.mnistShared;
    if (!M) {
      live.appendChild(document.createTextNode('This board needs boards/mnist.js.'));
      return {};
    }
    var msg = M.h('p', { class: 'note', text: 'Loading 200 coloured test digits and the evolved rules…' });
    live.appendChild(msg);
    var ui = null;
    M.loadData(kit, function (err, D) {
      if (err) { msg.textContent = 'The board’s data (boards/data/mnist.js) could not be loaded.'; return; }
      live.removeChild(msg);
      ui = build(live, kit, M, D, root);
    });
    return {
      frame: function (t) { if (ui) ui.frame(t); },
      show: function () { if (ui) ui.redraw(); }
    };
  });

  function build(host, kit, M, D, root) {
    M.addStyle();
    var h = M.h, btn = M.btn, pct = M.pct, W = M.W, N = M.N, T_MAX = M.T_MAX, T_SCORE = M.T_SCORE;
    var NAMES = ['≥ 5', '< 5'];   // class 1 = label 1 = "digit below 5" (after label noise)
    var CM = D.cm.digits, INKS = D.digits;

    var state = {
      colouring: 'train', rule: 'colour', idx: 0, swapped: false,
      sim: null, t: 0, playing: !kit.reduceMotion, tiles: {}, queue: []
    };

    function colourOf(k, own) {
      var d = CM[k], c = state.colouring === 'train' ? d.colTrain : d.colTest;
      return own && state.swapped ? 1 - c : c;
    }
    // the clamped alpha of the ink: red 1.0, green 0.6; colour removed: 1.0
    function alphaFor(col) { return state.rule === 'colour' ? (col ? 1.0 : 0.6) : 1.0; }
    function spec() { return { K: 2, genome: D.cm[state.rule].genome }; }

    /* ---------- markup ---------- */

    var colHost = h('div', { class: 'switch', role: 'group', 'aria-label': 'Choose the colouring' });
    var pillHost = h('div', { role: 'group', 'aria-label': 'Choose the rule' });
    var rows = h('div', { class: 'presetrows' }, [
      h('span', { class: 'ctl-label', text: 'Colours' }), h('div', {}, [colHost]),
      h('span', { class: 'ctl-label', text: 'Rule' }), pillHost
    ]);
    var note = h('p', { class: 'note presetnote', 'aria-live': 'polite' });

    var cvDigit = h('canvas', { class: 'cv', width: 28, height: 28, 'aria-label': 'The digit as the cells see it, ink tinted by its colour' });
    var cvVote = h('canvas', { class: 'cv', width: 28, height: 28, 'aria-label': 'Each living cell coloured by its current vote' });
    var cvChem = h('canvas', { class: 'cv', width: 28, height: 28, 'aria-label': 'The chemistry of each living cell, the only state the agents write' });
    var capDigit = h('em'), capVote = h('em', { text: 'step 0' });
    var cvrow = h('div', { class: 'cvrow mn-c3' }, [
      h('figure', { class: 'cvfig' }, [cvDigit, h('figcaption', {}, [h('span', { text: 'Digit' }), capDigit])]),
      h('figure', { class: 'cvfig' }, [cvChem, h('figcaption', {}, [h('span', { text: 'Chemistry' }), h('em', { text: 'what cells write' })])]),
      h('figure', { class: 'cvfig' }, [cvVote, h('figcaption', {}, [h('span', { text: 'Votes' }), capVote])])
    ]);
    var bNext = btn('Next digit'), bSwap = btn('Swap this digit’s colour');
    var digitCtl = h('div', { class: 'controls', style: 'margin:12px 0 0' }, [bNext, bSwap]);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Share of the living cells voting each class, step by step');
    var tip = h('div', { class: 'tip' });
    var legendHost = h('div', { class: 'legend' });

    function rn(label) { var b = h('b', { text: '–' }); return { el: h('div', {}, [b, label]), b: b }; }
    var R = {
      step: rn('step'), living: rn('living cells'), now: rn('vote now'), agree: rn('cells agreeing'),
      ans: rn('answer at step 30'), label: rn('label (noisy)'), digit: rn('true digit'), colour: rn('ink colour')
    };
    var readnum = h('div', { class: 'readnum' }, [R.step.el, R.living.el, R.now.el, R.agree.el, R.ans.el, R.label.el, R.digit.el, R.colour.el]);
    var verdict = h('p', { class: 'verdict na', 'aria-live': 'polite', text: '–' });
    var sub = h('p', { class: 'mn-sub' });
    var bPlay = btn(state.playing ? 'Pause' : 'Play', 'btn primary'), bStep = btn('Step'), bRestart = btn('Restart');

    var bAll = btn('Run all 200');
    var tally = h('span', { class: 'mn-tally', 'aria-live': 'polite' });
    var cvTiles = h('canvas', { class: 'mn-tiles', 'aria-label': 'The 200 sample digits grouped by ink colour; click one to load it' });
    var table = h('table', { class: 'data mn-ct' });
    var tableNote = h('p', { class: 'mn-sub', 'aria-live': 'polite' });
    var tileNote = h('p', { class: 'note', style: 'margin:4px 0 0' });

    host.appendChild(rows);
    host.appendChild(note);
    host.appendChild(h('div', { class: 'lab' }, [
      h('div', {}, [cvrow, digitCtl, h('div', { class: 'chartbox' }, [svg, tip]), legendHost]),
      h('div', { class: 'readout' }, [readnum, verdict, sub, h('div', { class: 'controls' }, [bPlay, bStep, bRestart])])
    ]));
    host.appendChild(h('p', { class: 'note', style: 'margin:10px 0 0',
      text: 'A modified rule, as on the MNIST board: α is clamped to the ink as a read-only input (red 1.0, green 0.6; all 1.0 with colour removed), the agents write only chemistry, '
        + 'and nothing is inherited, mutated or budgeted while a digit is read. The answer is the majority of the cells’ votes (chemistry above or below 0.5) at step 30.' }));
    host.appendChild(h('div', { class: 'mn-samples' }, [
      h('div', { class: 'controls' }, [h('span', { class: 'kicker', text: 'The 200 sample digits, by ink colour' }), bAll, tally]),
      h('div', { class: 'two' }, [
        h('div', {}, [cvTiles, tileNote]),
        h('div', {}, [table, tableNote])
      ])
    ]));

    /* ---------- controls ---------- */

    var colBtns = [['train', 'training colours'], ['test', 'flipped colours (test)']].map(function (o) {
      var b = h('button', { type: 'button', 'aria-pressed': String(state.colouring === o[0]), text: o[1] });
      b.addEventListener('click', function () {
        state.colouring = o[0];
        colBtns.forEach(function (x, j) { x.setAttribute('aria-pressed', String(j === (o[0] === 'train' ? 0 : 1))); });
        changed();
      });
      colHost.appendChild(b);
      return b;
    });
    var pills = kit.pills(pillHost, [
      { key: 'colour', label: 'evolved on coloured digits' },
      { key: 'grayscale', label: 'evolved with colour removed' }
    ], function (key) { state.rule = key; pills.set(key); changed(); }, state.rule);

    function agreeCount() {
      var n = 0;
      CM.forEach(function (d) { if (colourOf(d.k, false) === d.y) n++; });
      return n;
    }
    function noteText() {
      var a = agreeCount();
      var col = state.colouring === 'train'
        ? 'Training colours (e = 0.15, between the two training environments): the colour agrees with the label on ' + a + ' of these 200 digits.'
        : 'Flipped colours (e = 0.9, the test environment): the colour agrees with the label on only ' + a + ' of these 200 digits.';
      var rule = state.rule === 'colour'
        ? 'Evolved on coloured digits (CMA-ES, seed 1): 84.8% on the 8,000 training digits; on the 2,000 test digits 85.55% with training colours and 10.45% with flipped colours. '
          + 'Answering with the colour alone scores 84.8%, 85.5% and 10.4%.'
        : 'Evolved with colour removed (CMA-ES, seed 1), all ink at α = 1.0: 52.55% on the 2,000 test digits; three runs 52.4% (51.4–53.3%), '
          + 'against 50.5% for always giving one answer and 75% for a perfect reader of the digit. It is nearly constant, answering “≥ 5” for most digits.';
      return rule + ' ' + col;
    }

    /* ---------- the current digit ---------- */

    function load(k, keepSwap) {
      state.idx = k;
      if (!keepSwap) state.swapped = false;
      grid.setCurrent(state.swapped ? -1 : k);
      restart(true);
    }
    function pickNext() {
      var k;
      do { k = (Math.random() * CM.length) | 0; } while (k === state.idx);
      load(k);
    }
    function restart(autoplay) {
      state.sim = M.simulate(spec(), INKS[state.idx].ink, alphaFor(colourOf(state.idx, true)), T_MAX);
      state.t = 0;
      if (autoplay) setPlaying(!kit.reduceMotion || state.playing);
      render();
    }
    function setPlaying(on) {
      state.playing = on;
      if (on && state.t >= T_MAX) state.t = 0;
      bPlay.textContent = on ? 'Pause' : state.t >= T_MAX ? 'Replay' : 'Play';
    }
    function advance() {
      if (state.t >= T_MAX) return;
      state.t++;
      if (state.t === T_SCORE && !state.swapped && !state.tiles[state.idx]) { store(state.idx, state.sim); summarise(); }
      if (state.t >= T_MAX) setPlaying(false);
      render();
    }
    var tick = kit.every(100), tickAll = kit.every(16);
    function frame(t) {
      if (state.queue.length && tickAll(t)) {
        var k = kit.reduceMotion ? state.queue.length : 3;
        while (k-- > 0 && state.queue.length) runTile(state.queue.shift());
        summarise();
      }
      if (state.playing && tick(t)) advance();
    }

    /* ---------- drawing ---------- */

    var RGB2 = M.classRGB(2), VOID = M.VOID, RED = M.rgbOf(M.COL.red), GREEN = M.rgbOf(M.COL.green), GREY = M.rgbOf(M.COL.ink);
    var cmap = new Int8Array(N), chem = new Float64Array(N);
    function inkRGB(col) { return state.rule === 'colour' ? (col ? RED : GREEN) : GREY; }

    function render() {
      var sim = state.sim, t = state.t, d = CM[state.idx], col = colourOf(state.idx, true), ink = INKS[state.idx].ink, c0 = inkRGB(col);
      kit.draw(cvDigit, W, W, function (i, rgb) {
        var c = ink[i] ? c0 : VOID;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      });
      M.paintChem(kit, cvChem, sim, t, chem);
      M.classMap(sim, t, cmap);
      kit.draw(cvVote, W, W, function (i, rgb) {
        var k = cmap[i], c = k >= 0 ? RGB2[k] : VOID;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      });
      capDigit.textContent = state.rule === 'colour' ? (col ? 'red ink, α = 1.0' : 'green ink, α = 0.6') : 'colour removed, α = 1.0';
      capVote.textContent = 'step ' + t;

      var cen = sim.cen, v = M.voteAt(cen, t), ans = t >= T_SCORE ? M.voteAt(cen, T_SCORE) : null, clean = d.digit < 5 ? 1 : 0;
      R.step.b.textContent = t + ' / ' + T_MAX;
      R.living.b.textContent = String(cen.living);
      R.now.b.textContent = NAMES[v.vote];
      R.agree.b.textContent = pct(v.share, 0);
      R.ans.b.textContent = ans ? NAMES[ans.vote] : '…';
      R.label.b.textContent = NAMES[d.y] + (d.y !== clean ? ' (flipped)' : '');
      R.digit.b.textContent = String(d.digit);
      R.colour.b.textContent = state.rule === 'colour' ? (col ? 'red' : 'green') + (state.swapped ? ' (swapped)' : '') : 'none';
      R.colour.el.lastChild.textContent = state.rule === 'colour' ? 'ink colour' : 'ink colour (' + (col ? 'red' : 'green') + ' in the data)';

      if (!ans) { verdict.textContent = state.playing ? 'Running…' : 'Paused before step 30'; verdict.className = 'verdict na'; sub.textContent = ''; }
      else {
        var ok = ans.vote === d.y;
        verdict.textContent = ok ? 'Right' : 'Wrong'; verdict.className = 'verdict ' + (ok ? 'ok' : 'bad');
        sub.textContent = state.rule === 'colour'
          ? (ans.vote === col ? 'The answer is the colour: red says “< 5”, green says “≥ 5”.' : 'The answer goes against the colour.')
          : 'Colour removed: the answer cannot follow it.';
      }
      M.drawChart(kit, svg, tip, sim, t, NAMES);
      if (!state.playing) bPlay.textContent = t >= T_MAX ? 'Replay' : 'Play';
    }

    /* ---------- the 200 samples ---------- */

    var tileCls = {};
    function store(k, sim) {
      var out = new Int8Array(N), ans = M.voteAt(sim.cen, T_SCORE);
      M.classMap(sim, T_SCORE, out);
      tileCls[k] = out;
      state.tiles[k] = { vote: ans.vote, ok: ans.vote === CM[k].y, col: colourOf(k, false) };
      grid.draw(k);
    }
    function runTile(k) {
      if (state.tiles[k]) return;
      store(k, M.simulate(spec(), INKS[k].ink, alphaFor(colourOf(k, false)), T_SCORE));
    }
    var grid = M.TileGrid(cvTiles, kit, {
      pixel: function (k, i, rgb) {
        var c;
        if (state.tiles[k]) { var m = tileCls[k][i]; c = m >= 0 ? RGB2[m] : VOID; }
        else if (INKS[k].ink[i]) { var b = inkRGB(colourOf(k, false)); c = [b[0] * 0.8, b[1] * 0.8, b[2] * 0.8]; }
        else c = VOID;
        rgb[0] = c[0]; rgb[1] = c[1]; rgb[2] = c[2];
      },
      mark: function (k) { var r = state.tiles[k]; return r && !r.ok ? kit.css('--gcvp') : null; },
      pick: function (k) { load(k); }
    });
    function layoutGrid() {
      var red = [], green = [];
      CM.forEach(function (d) { (colourOf(d.k, false) ? red : green).push(d.k); });
      grid.layout([
        { label: (state.rule === 'colour' ? 'red ink' : 'red in the data') + ' · ' + red.length, items: red },
        { label: (state.rule === 'colour' ? 'green ink' : 'green in the data') + ' · ' + green.length, items: green }
      ], 'blocks');
      grid.setCurrent(state.swapped ? -1 : state.idx);
    }

    // a live cross-table: votes by ink colour, and how many are right
    function summarise() {
      var c = { r: [0, 0, 0, 0], g: [0, 0, 0, 0] }, done = 0, ok = 0, same = 0;   // [votes <5, votes >=5, right, run]
      CM.forEach(function (d) {
        var r = state.tiles[d.k];
        if (!r) return;
        var x = r.col ? c.r : c.g;
        x[r.vote === 1 ? 0 : 1]++; if (r.ok) x[2]++; x[3]++;
        done++; if (r.ok) ok++; if (r.vote === r.col) same++;
      });
      var cell = function (v) { return h('td', { text: String(v) }); };
      var rowOf = function (label, a, b, all) { return h('tr', {}, [h('td', { text: label }), cell(a), cell(b), cell(all)]); };
      table.innerHTML = '';
      var tail = state.rule === 'colour' ? ' ink' : ' in data';
      table.appendChild(h('thead', {}, [h('tr', {}, [h('th', { text: done ? 'after step 30' : 'not run yet' }), h('th', { text: 'red' + tail }), h('th', { text: 'green' + tail }), h('th', { text: 'all' })])]));
      table.appendChild(h('tbody', {}, [
        rowOf('votes “< 5”', c.r[0], c.g[0], c.r[0] + c.g[0]),
        rowOf('votes “≥ 5”', c.r[1], c.g[1], c.r[1] + c.g[1]),
        rowOf('right', c.r[2] + ' of ' + c.r[3], c.g[2] + ' of ' + c.g[3], ok + ' of ' + done)
      ]));
      var agree = agreeCount();
      bAll.disabled = state.queue.length > 0 || done === 200;
      if (!done) {
        tally.textContent = 'Not run yet: play a digit past step 30, or run all 200.';
        tableNote.textContent = 'Answering with the colour alone would be right on ' + agree + ' of 200 under these colours.';
        return;
      }
      tally.innerHTML = '<b>' + ok + ' of ' + done + '</b> right (' + pct(ok / done, 1) + ')' + (done < 200 ? ', ' + done + ' of 200 run' : '') + '.';
      var maj = Math.max(c.r[0] + c.g[0], c.r[1] + c.g[1]);
      tableNote.textContent = (state.rule === 'colour'
        ? 'The answer equals the colour on ' + same + ' of ' + done + ' digits run. '
        : 'The commoner answer covers ' + maj + ' of ' + done + ' digits run. ')
        + 'The colour alone would be right on ' + agree + ' of 200.';
    }
    function tileNoteText() {
      return 'Click a digit to load it. After a run each cell shows its vote at step 30, and a red frame marks a wrong answer against the noisy label. '
        + 'These 200 embedded test digits are a sample; the measured figures are on 8,000 training and 2,000 test digits.';
    }
    bAll.addEventListener('click', function () {
      state.queue = CM.map(function (d) { return d.k; }).filter(function (k) { return !state.tiles[k]; });
      if (state.queue.length) bAll.disabled = true;
    });

    /* ---------- wiring ---------- */

    function changed() {
      state.tiles = {}; tileCls = {}; state.queue = []; bAll.disabled = false;
      state.swapped = false;
      note.textContent = noteText();
      M.legend(legendHost, 2, NAMES);
      layoutGrid();
      restart(true);
      summarise();
      tileNote.textContent = tileNoteText();
      bSwap.disabled = state.rule !== 'colour';
    }
    bNext.addEventListener('click', pickNext);
    bSwap.addEventListener('click', function () {
      state.swapped = !state.swapped;
      grid.setCurrent(state.swapped ? -1 : state.idx);
      restart(true);
    });
    bPlay.addEventListener('click', function () { setPlaying(!state.playing); render(); });
    bStep.addEventListener('click', function () { setPlaying(false); advance(); });
    bRestart.addEventListener('click', function () { state.t = 0; render(); });

    document.addEventListener('themechange', function () { render(); grid.drawAll(); summarise(); });
    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (root.hidden) return; grid.resize(); render(); }, 150);
    });

    // start on a digit whose colour agrees with its label under training colours
    var start = 0;
    for (var k = 0; k < CM.length; k++) if (CM[k].digit === 2 && CM[k].colTrain === CM[k].y && CM[k].y === 1) { start = k; break; }
    state.idx = start;
    changed();

    return {
      frame: frame,
      redraw: function () { grid.resize(); render(); }
    };
  }
})();
