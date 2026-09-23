/* ==========================================================
   PanoDiff-SR project page
   Sources for every number:
   - PDS_DATA.observer.tally / .roc / .pr  computed from the raw
     quiz submission log (6 observers x 200 images); the tallies
     reproduce the paper's Table 5 and the AUC/AP values match
     the published figures.
   - every other block is transcribed from a numbered table of
     the manuscript and the table is named in the page.
   The forward-diffusion canvas is labelled an illustration: the
   schedules are the real ones, the image is a real radiograph,
   but the noise is drawn here rather than replayed from a run.
   ========================================================== */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';
  var D = window.PDS_DATA;
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
  // Tooltips need the svg's own viewBox height, so pass it explicitly.
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
  // '#rrggbb' -> 'rgba(r, g, b, a)'. Used where a translucent fill is needed
  // from a CSS custom property, which cannot be alpha-adjusted directly.
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
  }

  var LEVELS = ['DR', 'PR', 'U', 'PF', 'DF'];
  // How the six observers actually answered one image. Counts are exact:
  // "unsure" is its own category here rather than being split in half.
  function verdicts(r) {
    var v = { real: 0, fake: 0, unsure: 0, n: 0 };
    for (var u in r) {
      var c = r[u]; v.n++;
      if (c === 'U') v.unsure++;
      else if (c === 'DR' || c === 'PR') v.real++;
      else v.fake++;
    }
    return v;
  }
  function phrase(n, total, what) {
    if (n === 0) return 'none of the ' + total + ' ' + what;
    if (n === total) return 'all ' + total + ' ' + what;
    return n + ' of ' + total + ' ' + what;
  }
  var LEVEL_NAME = { DR: 'definitely real', PR: 'probably real', U: 'unsure', PF: 'probably fake', DF: 'definitely fake' };

  /* ---------------- theme ---------------- */

  $('#themeToggle').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { }
    document.dispatchEvent(new CustomEvent('themechange'));
  });

  /* ---------------- nav highlight ---------------- */

  if ('IntersectionObserver' in window) {
    var navLinks = $$('#topnav a');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $$('section[id]').forEach(function (s) { io.observe(s); });
  }

  /* ---------------- lightbox ---------------- */

  var lb = $('#lightbox'), lbImg = $('#lightboxImg');
  function zoom(src, alt) { lbImg.src = src; lbImg.alt = alt || ''; lb.classList.add('on'); }
  lb.addEventListener('click', function () { lb.classList.remove('on'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('on'); });
  $$('figure.fig img').forEach(function (im) {
    im.addEventListener('click', function () { zoom(im.src, im.alt); });
  });

  /* ---------------- hero strip ---------------- */

  (function () {
    var root = $('#heroStrip'), btn = $('#heroPlay');
    var pool = D.hero.map(function (h) { return { src: 'assets/img/' + h.file, r: h.r }; })
      .concat(D.confusion.filter(function (c) { return c.cat === 'FN'; })
        .map(function (c) { return { src: 'assets/confusion/' + c.file, r: c.r }; }));
    // three slots, each cycling through the pool at an offset
    var slots = [0, 1, 2].map(function (i) {
      var fig = document.createElement('figure');
      fig.innerHTML = '<div class="frame"><img alt="A synthetic panoramic radiograph generated by PanoDiff-SR"></div>' +
        '<figcaption><span></span><span class="sub"></span></figcaption>';
      root.appendChild(fig);
      return { img: fig.querySelector('img'), lab: fig.querySelector('figcaption span'), sub: fig.querySelector('.sub'), k: i };
    });
    pool.forEach(function (p) { new Image().src = p.src; });
    function paint(s) {
      var p = pool[s.k % pool.length];
      s.img.src = p.src;
      var v = verdicts(p.r || {});
      s.lab.textContent = 'Synthetic';
      s.sub.textContent = v.n ? phrase(v.real, v.n, 'dentists called it real') : 'PanoDiff-SR';
    }
    slots.forEach(paint);
    var timer = null;
    function tick() { slots.forEach(function (s) { s.k += 3; paint(s); }); }
    function start() { if (!timer) { timer = setInterval(tick, 4200); btn.textContent = 'Pause'; } }
    function stop() { clearInterval(timer); timer = null; btn.textContent = 'Play'; }
    btn.addEventListener('click', function () { timer ? stop() : start(); });
    if (reduceMotion) stop(); else start();
  })();

  /* ---------------- 1. the quiz ---------------- */

  (function () {
    var frame = $('#quizFrame'), img = $('#quizImg'), counter = $('#quizCounter');
    var verdict = $('#quizVerdict'), detail = $('#quizDetail'), obsBox = $('#quizObs');
    var bReal = $('#btnReal'), bSyn = $('#btnSynth'), bNext = $('#btnNext'), bReset = $('#btnReset');
    var youOut = $('#quizYou'), seenOut = $('#quizSeen'), bYou = $('#bYou'), bYouV = $('#bYouV');
    var timerBar = $('#quizTimer'), modeNote = $('#quizModeNote');
    var order = D.quiz.map(function (_, i) { return i; });
    var at = 0, right = 0, seen = 0, answered = false;
    var timed = false, countdown = null;
    var LIMIT = 12000;   // the observers saw each radiograph for twelve seconds

    function stopClock() {
      if (countdown) { clearTimeout(countdown); countdown = null; }
      timerBar.hidden = true;
      timerBar.style.transition = 'none';
      timerBar.style.width = '100%';
      frame.classList.remove('expired');
    }
    function startClock() {
      stopClock();
      if (!timed) return;
      timerBar.hidden = false;
      // force a reflow so the transition runs from a full bar every time
      void timerBar.offsetWidth;
      timerBar.style.transition = 'width ' + (LIMIT / 1000) + 's linear';
      timerBar.style.width = '0%';
      countdown = setTimeout(function () {
        if (!answered) frame.classList.add('expired');
        timerBar.hidden = true;
      }, LIMIT);
    }

    $('#bDent').style.width = '68.5%';
    $('#bGan').style.width = '78.2%';
    $('#bChance').style.width = '50%';

    D.quiz.forEach(function (q) { new Image().src = 'assets/quiz/' + q.id + '.jpg'; });

    function shuffle() {
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1)), t = order[i]; order[i] = order[j]; order[j] = t;
      }
    }
    function show() {
      var q = D.quiz[order[at]];
      img.src = 'assets/quiz/' + q.id + '.jpg';
      counter.textContent = (at + 1) + ' / ' + order.length;
      frame.classList.remove('answered');
      answered = false;
      bReal.disabled = bSyn.disabled = false;
      bNext.hidden = true;
      obsBox.innerHTML = '<p class="note">Answer first &mdash; the responses appear here.</p>';
      startClock();
    }
    function answer(guess) {
      if (answered) return;
      answered = true;
      if (countdown) { clearTimeout(countdown); countdown = null; }
      timerBar.hidden = true;
      var q = D.quiz[order[at]];
      var ok = guess === q.label;
      seen++; if (ok) right++;
      verdict.textContent = ok ? 'Correct' : 'Wrong';
      verdict.className = 'qbig ' + (ok ? 'hit' : 'miss');
      var v = verdicts(q.r);
      var parts = [];
      if (v.real) parts.push(v.real + ' called it real');
      if (v.fake) parts.push(v.fake + ' called it fake');
      if (v.unsure) parts.push(v.unsure + (v.unsure === 1 ? ' was unsure' : ' were unsure'));
      detail.innerHTML = 'This radiograph is <b>' + (q.label === 'real' ? 'real' : 'synthetic') +
        '</b>. Of the six dentists, ' + parts.join(', ') + '.';
      frame.classList.add('answered');
      bReal.disabled = bSyn.disabled = true;
      var last = at >= order.length - 1;
      bNext.hidden = last;

      // per-observer chips
      var rows = D.observer.names.map(function (u) {
        var code = q.r[u];
        if (!code) return '';
        var cls = code === 'U' ? 'un'
          : ((code === 'DF' || code === 'PF') === (q.label === 'fake') ? 'ok' : 'no');
        return '<div class="obsrow"><b>' + u + '</b><span><span class="chip ' + cls + '">' +
          LEVEL_NAME[code] + '</span></span></div>';
      }).join('');
      obsBox.innerHTML = rows +
        '<p class="note" style="margin-top:6px">Teal: that observer got this image right. Rose: wrong. ' +
        'Grey: they would not commit.</p>' +
        (last ? '<p class="note"><b>That was the last of the ' + order.length +
          '.</b> Start over to reshuffle them.</p>' : '');
      score();
    }
    function score() {
      seenOut.textContent = seen;
      if (!seen) { youOut.textContent = '–'; bYou.style.width = '0'; bYouV.textContent = '–'; return; }
      var pct = 100 * right / seen;
      youOut.textContent = fmt(pct, 0) + '%';
      bYou.style.width = pct + '%';
      bYouV.textContent = fmt(pct, 1) + '% (' + right + '/' + seen + ')';
    }
    function next() { if (at < order.length - 1) { at++; show(); } }

    bReal.addEventListener('click', function () { answer('real'); });
    bSyn.addEventListener('click', function () { answer('fake'); });
    bNext.addEventListener('click', next);
    bReset.addEventListener('click', function () { at = 0; right = 0; seen = 0; stopClock(); shuffle(); show(); score(); });
    document.addEventListener('keydown', function (e) {
      var r = frame.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;   // only while the panel is on screen
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); answer('real'); }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); answer('fake'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); answered ? next() : null; }
    });
    group($('#quizMode'), 'data-mode', function (v) {
      timed = v === 'timed';
      modeNote.textContent = timed
        ? 'The radiograph blurs after twelve seconds and you answer from memory, as the observers did.'
        : 'No limit. The observers had twelve seconds, including about two of loading.';
      if (!answered) startClock(); else stopClock();
    });
    modeNote.textContent = 'No limit. The observers had twelve seconds, including about two of loading.';
    shuffle(); show(); score();
  })();

  /* ---------------- 2. pipeline stages ---------------- */

  var STAGES = [
    {
      name: 'Pool and prepare', img: 'tsne_sources.png',
      cap: 'Five source datasets in ResNet-50 feature space. They separate, and the model is trained on the mixture.',
      body: '7243 radiograph files (5653 distinct radiographs) from five public datasets, each cropped by the same fixed margin to remove letterboxing and burned-in markers, then resized to 1024 &times; 512 with Lanczos.',
      log: 'process_data.py'
    },
    {
      name: 'Add noise — the forward process', img: 'pd_forward.png',
      cap: 'Noise is added to x₀ over 1000 steps on a cosine β-schedule until nothing but noise is left.',
      body: 'No learning happens here. A real radiograph is destroyed on a fixed schedule, and the pixel statistics converge on 0.5 because the image at t = 1000 is pure noise. Training pairs are drawn from anywhere along this trajectory.',
      log: 'T = 1000, cosine β-schedule'
    },
    {
      name: 'Train the denoiser — the reverse process', img: 'pd_reverse.png',
      cap: 'The U-Net (flame) learns to predict the noise in xₜ; below, the frozen network used step by step for comparison.',
      body: 'A 34.0 M-parameter U-Net with self-attention is trained with an L₁ loss to predict the noise contained in a noisy image. 110 epochs, batch size 4, one GPU, 17.7 hours, with an exponential moving average of the weights kept alongside.',
      log: '34.0 M params · 110 epochs · 17.7 h'
    },
    {
      name: 'Sample — generate a seed', img: 'pd_generation.png',
      cap: 'From noise, the frozen U-Net predicts and removes noise, noise is added back, and the loop repeats.',
      body: 'DDIM sampling for 250 inference steps produces a complete 256 &times; 128 panoramic radiograph in 6.84 s. This is where the anatomy is decided — everything downstream only adds detail.',
      log: '250 DDIM steps · 6.84 s / image'
    },
    {
      name: 'Upscale — super-resolution', img: 'sr_ablation.jpg',
      cap: 'The same crops restored five ways, from bicubic on the left to the ground truth on the right.',
      body: 'A HAT transformer, pre-trained on natural images and fine-tuned for 400,000 iterations on radiograph pairs with pixel, perceptual and adversarial losses, takes the seed to 1024 &times; 512 in one forward pass, in 0.31 s.',
      log: '20.8 M params · 400k iter · 0.31 s / image'
    },
    {
      name: 'Evaluate', img: 'piecharts.png',
      cap: 'Every decision of all six observers, split by correctness and certainty.',
      body: 'Distribution metrics (t-SNE, FID, KID, precision and recall, Inception score), a time-limited observer study with six dentists, inter-observer agreement, a ViT trained to separate real from synthetic, a MedSAM probe that has never seen either set, and direct high-resolution baselines.',
      log: '7243 × 4 image sets · 6 observers × 200 images'
    }
  ];

  (function () {
    var list = $('#stageList'), im = $('#stageImg'), cap = $('#stageCap');
    STAGES.forEach(function (s, i) {
      var li = document.createElement('li');
      li.innerHTML = '<b>' + s.name + '</b><span class="log">' + s.log + '</span>';
      li.addEventListener('click', function () { select(i); });
      list.appendChild(li);
    });
    function select(i) {
      $$('li', list).forEach(function (n, k) { n.setAttribute('aria-current', k === i); });
      im.src = 'assets/img/' + STAGES[i].img;
      im.alt = STAGES[i].cap;
      cap.innerHTML = '<b>' + STAGES[i].name + '.</b> ' + STAGES[i].body;
    }
    im.addEventListener('click', function () { zoom(im.src, im.alt); });
    select(3);
  })();

  /* ---------------- 2b. efficiency table ---------------- */

  (function () {
    var tb = $('#effTable tbody');
    D.efficiency.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td>';
      tb.appendChild(tr);
    });
  })();

  /* ---------------- 3. dataset table ---------------- */

  (function () {
    var tb = $('#dsTable tbody');
    D.datasets.forEach(function (d, i) {
      var tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.innerHTML = '<td><b>' + d.abbr + '</b></td><td>' + (d.nlabel || d.n.toLocaleString()) + '</td><td>' +
        d.country + '</td><td class="mono" style="font-size:12.5px">' + d.res + '</td>';
      tr.addEventListener('click', function () { select(i); });
      tb.appendChild(tr);
    });
    function select(i) {
      var d = D.datasets[i];
      $$('tr', tb).forEach(function (r, k) { r.classList.toggle('ours', k === i); });
      $('#dsKicker').textContent = d.abbr;
      $('#dsVerdict').textContent = d.full;
      $('#dsBody').innerHTML = d.note + ' Released as ' + d.fmt + ' in ' + d.year +
        ', available via ' + d.avail + '. <a href="' + d.url + '" target="_blank" rel="noopener">Source &rarr;</a>';
      $('#dsMeta').textContent = (d.nlabel || d.n.toLocaleString()) + ' images, native ' + d.res +
        ', all resized to 1024 × 512 for training.';
    }
    select(1);
  })();

  /* ---------------- 4. forward diffusion canvas ---------------- */

  (function () {
    var cv = $('#fwdCanvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    var W = cv.width, H = cv.height, N = W * H;
    var range = $('#fwdT'), out = $('#oFwdT'), play = $('#fwdPlay');
    var base = null, sched = 'cosine', timer = null;

    // deterministic gaussian noise, so dragging does not make the image flicker
    var seed = 20250915;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var g = new Float32Array(N * 3);
    for (var i = 0; i < N * 3; i += 2) {
      var u = Math.max(rnd(), 1e-9), v = rnd();
      var r = Math.sqrt(-2 * Math.log(u));
      g[i] = r * Math.cos(2 * Math.PI * v);
      if (i + 1 < N * 3) g[i + 1] = r * Math.sin(2 * Math.PI * v);
    }

    // alpha-bar for both schedules, T = 1000
    var T = 1000;
    var AB = { cosine: new Float64Array(T + 1), linear: new Float64Array(T + 1) };
    (function () {
      var s = 0.008, f0 = Math.pow(Math.cos((s / (1 + s)) * Math.PI / 2), 2);
      for (var t = 0; t <= T; t++) {
        AB.cosine[t] = Math.pow(Math.cos(((t / T + s) / (1 + s)) * Math.PI / 2), 2) / f0;
      }
      var acc = 1;
      AB.linear[0] = 1;
      for (var k = 1; k <= T; k++) {
        var beta = 1e-4 + (0.02 - 1e-4) * (k - 1) / (T - 1);
        acc *= (1 - beta);
        AB.linear[k] = acc;
      }
    })();

    // the demo runs on a real radiograph: the first one in the quiz set labelled real
    var realIdx = 0;
    for (var q = 0; q < D.quiz.length; q++) { if (D.quiz[q].label === 'real') { realIdx = q; break; } }
    var src = new Image();
    src.onload = function () {
      ctx.drawImage(src, 0, 0, W, H);
      base = ctx.getImageData(0, 0, W, H);
      draw();
    };
    src.src = 'assets/quiz/' + D.quiz[realIdx].id + '.jpg';

    function draw() {
      if (!base) return;
      var t = +range.value;
      var ab = AB[sched][Math.min(T, Math.max(0, t))];
      var a = Math.sqrt(ab), b = Math.sqrt(1 - ab);
      var im = ctx.createImageData(W, H), s = base.data, o = im.data;
      for (var p = 0, k = 0; p < N * 4; p += 4, k += 3) {
        for (var c = 0; c < 3; c++) {
          var x0 = (s[p + c] / 255) * 2 - 1;
          var val = a * x0 + b * g[k + c];
          o[p + c] = Math.max(0, Math.min(255, ((val + 1) / 2) * 255));
        }
        o[p + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      out.textContent = t;
      $('#fwdAlpha').textContent = fmt(a, 3);
      $('#fwdNoise').textContent = fmt(b, 3);
      $('#fwdAlphaBar').style.width = (a * 100) + '%';
      $('#fwdNoiseBar').style.width = (b * 100) + '%';
      var note;
      if (t === 0) note = 'The radiograph as recorded. This is what the network is trained to reach.';
      else if (a > 0.9) note = 'Barely touched. Most of the schedule’s work happens later than people expect.';
      else if (a > 0.6) note = 'Texture is going first: trabecular bone, then the periodontal ligament space.';
      else if (a > 0.3) note = 'The arch is still legible. A denoiser trained here has real structure to hold on to.';
      else if (a > 0.08) note = 'Only the broadest shape survives. This is where a single-step estimate stops being adequate.';
      else note = 'Pure noise. Sampling starts here and walks the whole trajectory back.';
      $('#fwdNote').textContent = note + ' (' + sched + ' schedule)';
    }
    range.addEventListener('input', draw);
    group($('#fwdSched'), 'data-sched', function (v) { sched = v; draw(); });
    play.addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; play.textContent = 'Run the schedule'; return; }
      play.textContent = 'Stop';
      if (+range.value >= T) range.value = 0;
      timer = setInterval(function () {
        var t = +range.value + 20;
        if (t > T) { t = T; clearInterval(timer); timer = null; play.textContent = 'Run the schedule'; }
        range.value = t; draw();
      }, 60);
    });
  })();

  /* ---------------- 4b. epoch progression ---------------- */

  (function () {
    var grid = $('#epochGrid'), range = $('#epochRange'), out = $('#oEpoch');
    var now = $('#epochNow'), note = $('#epochNote'), play = $('#epochPlay');
    var NOTES = [
      'The coarse structure is already there: a full arch, two tooth rows, a mandible. What is missing is firmness — crowns are soft and roots fade into the surrounding bone.',
      'Crown outlines harden and the occlusal line straightens. Radiopaque restorations begin to read as discrete bodies rather than bright smears.',
      'Roots separate more cleanly from the trabecular background, and contrast across the arch becomes more even.',
      'The maxilla and the sinus outlines settle. Fewer regions are left as undifferentiated grey.',
      'Fine texture: trabecular bone in the ramus and the inferior border of the mandible.',
      'The checkpoint behind every synthetic radiograph on this page. The step from 99 is small — most of the visible gain is already in.'
    ];
    D.epochs.forEach(function (e) {
      D.seeds.forEach(function (s) { new Image().src = 'assets/epochs/e' + e + '_s' + s + '.jpg'; });
    });
    var imgs = D.seeds.map(function (s) {
      var im = document.createElement('img');
      im.alt = 'A radiograph generated from a fixed seed at the selected epoch';
      im.addEventListener('click', function () { zoom(im.src, im.alt); });
      grid.appendChild(im);
      return im;
    });
    function show(i) {
      var e = D.epochs[i];
      imgs.forEach(function (im, k) { im.src = 'assets/epochs/e' + e + '_s' + D.seeds[k] + '.jpg'; });
      now.textContent = 'Epoch ' + e;
      note.textContent = NOTES[i];
      out.textContent = e;
    }
    range.addEventListener('input', function () { show(+range.value); });
    var timer = null;
    play.addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; play.textContent = 'Play'; return; }
      play.textContent = 'Pause';
      timer = setInterval(function () {
        var i = (+range.value + 1) % D.epochs.length;
        range.value = i; show(i);
      }, 1300);
    });
    show(0);
  })();

  /* ---------------- 4c. diffusion ablation scatter ---------------- */

  (function () {
    var svg = $('#diffSvg'), tip = $('#diffTip');
    var W = 860, H = 340, L = 62, R = 24, T = 16, B = 46;
    var GRP = { ema: '--diff', steps: '--sr', sched: '--gan' };
    function draw() {
      clear(svg);
      var maxF = 130, maxS = 8;
      var X = function (v) { return L + (W - L - R) * v / maxS; };
      var Y = function (v) { return H - B - (H - B - T) * v / maxF; };
      [0, 25, 50, 75, 100, 125].forEach(function (v) {
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 8, y: Y(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v));
      });
      [0, 2, 4, 6, 8].forEach(function (v) {
        svg.appendChild(el('text', { x: X(v), y: H - B + 18, class: 'ticktext', 'text-anchor': 'middle' }, v));
      });
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: H - B, class: 'axisline' }));
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 6, class: 'ticktext', 'text-anchor': 'middle' }, 'seconds per image, batch 8'));
      svg.appendChild(el('text', { x: 14, y: T + (H - T - B) / 2, class: 'ticktext', 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (T + (H - T - B) / 2) + ')' }, 'FID (1000 vs 1000 LR)'));

      // link the sampler-budget points so the trade-off reads as a curve
      var steps = D.diffAblation.filter(function (d) { return d.grp === 'steps' || d.name.indexOf('250 DDIM steps (ours)') > -1; })
        .sort(function (a, b) { return a.s - b.s; });
      svg.appendChild(el('polyline', {
        points: steps.map(function (d) { return X(d.s) + ',' + Y(d.fid); }).join(' '),
        fill: 'none', stroke: css('--sr'), 'stroke-width': 1.6, 'stroke-dasharray': '4 3', opacity: .7
      }));

      D.diffAblation.forEach(function (d) {
        var ours = d.name.indexOf('(ours)') > -1;
        var c = css(GRP[d.grp]);
        var dot = el('circle', {
          cx: X(d.s), cy: Y(d.fid), r: ours ? 9 : 6.5, fill: c,
          stroke: css('--bg-sunk'), 'stroke-width': ours ? 3 : 2, style: 'cursor:pointer'
        });
        dot.addEventListener('mouseenter', function () {
          tipAt(tip, svg, W, H, X(d.s), Y(d.fid) - 12,
            '<b>' + d.name + '</b><div class="row"><i style="background:' + c + '"></i>FID ' + fmt(d.fid, 1) +
            ' &middot; IS ' + fmt(d.is, 2) + ' &middot; ' + fmt(d.s, 2) + ' s</div>');
        });
        dot.addEventListener('mouseleave', function () { hideTip(tip); });
        svg.appendChild(dot);
        if (ours) {
          svg.appendChild(el('text', { x: X(d.s) - 14, y: Y(d.fid) - 14, class: 'serieslabel', 'text-anchor': 'end' }, 'ours'));
        }
      });
      // label the two schedule points, the finding worth seeing without hovering
      D.diffAblation.filter(function (d) { return d.grp === 'sched'; }).forEach(function (d) {
        var lin = d.name.indexOf('Linear') > -1;
        svg.appendChild(el('text', {
          x: X(d.s) + (lin ? 12 : 12), y: Y(d.fid) + (lin ? 4 : 4),
          class: 'serieslabel', fill: css('--text-soft')
        }, lin ? 'linear, 30 ep' : 'cosine, 30 ep'));
      });
    }
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 4d. LR galleries ---------------- */

  (function () {
    function fill(root, list, label) {
      list.forEach(function (f) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<img loading="lazy" decoding="async" src="assets/lr/' + f + '" alt="A 256 by 128 sample from ' + label + '">';
        b.addEventListener('click', function () { zoom('assets/lr/' + f, label + ' sample'); });
        root.appendChild(b);
      });
    }
    fill($('#galPd'), D.lr.diffusion, 'PanoDiff');
    fill($('#galGan'), D.lr.gan, 'FastGAN');
  })();

  /* ---------------- 5. LR / HR comparison slider ---------------- */

  (function () {
    var box = $('#srCompare'), over = $('#srOver'), handle = $('#srHandle');
    var hi = $('#srHi'), lo = $('#srLo'), thumbs = $('#srThumbs');
    var at = 0;
    D.srpairs.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', i === 0);
      b.innerHTML = '<img loading="lazy" decoding="async" src="assets/sr/' + p.id + '_hr.jpg" alt="Generated radiograph ' + (i + 1) + '">';
      b.addEventListener('click', function () {
        at = i;
        $$('button', thumbs).forEach(function (o, k) { o.setAttribute('aria-pressed', k === i); });
        hi.src = 'assets/sr/' + p.id + '_hr.jpg';
        lo.src = 'assets/sr/' + p.id + '_lr.jpg';
      });
      thumbs.appendChild(b);
    });
    function setPct(pct) {
      pct = Math.max(0, Math.min(100, pct));
      over.style.width = pct + '%';
      handle.style.left = pct + '%';
      handle.setAttribute('aria-valuenow', Math.round(pct));
      lo.style.width = box.clientWidth + 'px';
    }
    function fromEvent(e) {
      var r = box.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      setPct(100 * x / r.width);
    }
    var dragging = false;
    box.addEventListener('pointerdown', function (e) { dragging = true; box.setPointerCapture(e.pointerId); fromEvent(e); });
    box.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e); });
    box.addEventListener('pointerup', function () { dragging = false; });
    handle.addEventListener('keydown', function (e) {
      var cur = parseFloat(handle.style.left) || 50;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setPct(cur - 4); }
      if (e.key === 'ArrowRight') { e.preventDefault(); setPct(cur + 4); }
    });
    window.addEventListener('resize', function () { setPct(parseFloat(handle.style.left) || 50); });
    hi.addEventListener('load', function () { setPct(parseFloat(handle.style.left) || 50); });
    setPct(50);
  })();

  /* ---------------- 5b. SR ablation bars ---------------- */

  (function () {
    var root = $('#srBars'), metric = 'lpips';
    var META = {
      lpips: { lo: 0.10, hi: 0.46, better: 'low', d: 3, name: 'LPIPS' },
      psnr: { lo: 29, hi: 37, better: 'high', d: 2, name: 'PSNR (dB)' },
      ssim: { lo: 0.74, hi: 0.90, better: 'high', d: 3, name: 'SSIM' }
    };
    function draw() {
      clear(root);
      var m = META[metric];
      var vals = D.srAblation.map(function (r) { return r[metric]; });
      var best = m.better === 'low' ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
      D.srAblation.forEach(function (r) {
        var v = r[metric];
        var frac = (v - m.lo) / (m.hi - m.lo);
        var color = r.grp === 'ours' ? css('--diff') : r.grp === 'base' ? css('--gan') : css('--sr');
        var d = document.createElement('div');
        d.className = 'barrow';
        d.innerHTML =
          '<div class="barlabel"><span>' + r.name + (v === best ? ' &nbsp;<b>best</b>' : '') +
          '</span><span class="barval">' + fmt(v, m.d) + '</span></div>' +
          '<div class="bartrack"><div class="barfill" style="width:' +
          Math.max(2, Math.min(100, frac * 100)) + '%;background:' + color + '"></div></div>';
        root.appendChild(d);
      });
      var p = document.createElement('p');
      p.className = 'note';
      p.style.marginTop = '8px';
      p.innerHTML = m.better === 'low'
        ? 'Lower is better. Bars are scaled over ' + m.lo + '&ndash;' + m.hi + '.'
        : 'Higher is better. Bars are scaled over ' + m.lo + '&ndash;' + m.hi + '.';
      root.appendChild(p);
    }
    group($('#srMetric'), 'data-m', function (v) { metric = v; draw(); });
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 5c. SwinIR table ---------------- */

  (function () {
    var tb = $('#swinTable tbody');
    var bestP = Math.max.apply(null, D.swinir.map(function (r) { return r.psnr; }));
    var bestS = Math.max.apply(null, D.swinir.map(function (r) { return r.ssim; }));
    var bestL = Math.min.apply(null, D.swinir.map(function (r) { return r.lpips; }));
    D.swinir.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.name.indexOf('HAT-SR') === 0) tr.className = 'ours';
      tr.innerHTML = '<td>' + r.name + '</td>' +
        '<td class="' + (r.psnr === bestP ? 'best' : '') + '">' + fmt(r.psnr, 2) + '</td>' +
        '<td class="' + (r.ssim === bestS ? 'best' : '') + '">' + fmt(r.ssim, 3) + '</td>' +
        '<td class="' + (r.lpips === bestL ? 'best' : '') + '">' + fmt(r.lpips, 3) + '</td>';
      tb.appendChild(tr);
    });
  })();

  /* ---------------- 5d. SR arms ---------------- */

  (function () {
    var img = $('#armImg'), thumbs = $('#armThumbs'), arm = 'DIFFHATSR', row = 0;
    var INFO = {
      DIFFHATSR: ['Diffusion + HAT-SR', 'The pipeline of this paper, and the closest of the four arms to real high-resolution radiographs on every measure: FID 40.5, KID 40.8, precision 0.56 and recall 0.29.'],
      DIFFSWINIR: ['Diffusion + SwinIR', 'The same seeds through SwinIR, fine-tuned on the same radiographs. FID rises to 94.4. SwinIR returns something close to a smooth enlargement of its input: it keeps about 4% of the high-frequency energy of real radiographs, against about 80% for HAT-SR. Its Inception score (2.89) is nonetheless the highest of the four.'],
      GANHATSR: ['FastGAN + HAT-SR', 'A GAN seed carried by the same super-resolution model. FID 102.3. The upscaler cannot repair anatomy the seed did not have, and recall stays below 1%.'],
      GANSWINIR: ['FastGAN + SwinIR', 'Both weaker halves together: FID 109.7, the furthest arm from the real radiographs. It sits 54.8 FID from FastGAN + HAT-SR, so the choice of upscaler matters less for GAN seeds, which limit what either upscaler can recover.']
    };
    D.srarms.forEach(function (r, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', i === 0);
      b.innerHTML = '<img loading="lazy" decoding="async" src="assets/sr/' + r[arm] + '" alt="Sample ' + (i + 1) + '">';
      b.addEventListener('click', function () { row = i; paint(); });
      thumbs.appendChild(b);
    });
    function paint() {
      img.src = 'assets/sr/' + D.srarms[row][arm];
      $$('button', thumbs).forEach(function (b, i) {
        b.setAttribute('aria-pressed', i === row);
        b.querySelector('img').src = 'assets/sr/' + D.srarms[i][arm];
      });
      $('#armKicker').textContent = INFO[arm][0];
      $('#armBody').textContent = INFO[arm][1];
    }
    group($('#armSwitch'), 'data-arm', function (v) { arm = v; paint(); });
    img.addEventListener('click', function () { zoom(img.src, INFO[arm][0]); });
    paint();
  })();

  /* ---------------- 5e. Figure 18 magnifier ---------------- */
  /* One lens position, mirrored across the seed, HAT-SR and SwinIR panels, so the same anatomy is
     compared at the same place. The lens paints the full-resolution 1024x512 image as its background. */

  (function () {
    var grid = $('#loupeGrid');
    if (!grid) return;
    var N = 5, gen = 'diff', seed = 0, z = 3, fx = 0.5, fy = 0.5;
    var stages = $$('.loupe-stage', grid);
    var seedBox = $('#loupeSeed');
    for (var i = 0; i < N; i++) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('data-seed', i); b.setAttribute('aria-pressed', i === 0);
      b.textContent = String(i + 1);
      b.title = i < 3 ? 'Sample ' + (i + 1) + ' (a column of Figure 18)' : 'Sample ' + (i + 1);
      seedBox.appendChild(b);
    }
    function src(arm) { return 'assets/zoom/' + gen + seed + '_' + arm + '.jpg'; }
    function load() {
      stages.forEach(function (st) {
        var url = src(st.getAttribute('data-arm'));
        st.querySelector('img').src = url;
        st.querySelector('.lens').style.backgroundImage = 'url("' + url + '")';
      });
      place();
    }
    function place() {
      stages.forEach(function (st) {
        var w = st.clientWidth, h = st.clientHeight, lens = st.querySelector('.lens');
        if (!w || !h) return;
        var d = Math.max(90, Math.round(h * 0.62));
        var x = fx * w, y = fy * h;
        lens.style.width = d + 'px'; lens.style.height = d + 'px';
        lens.style.transform = 'translate(' + (x - d / 2) + 'px,' + (y - d / 2) + 'px)';
        lens.style.backgroundSize = (w * z) + 'px ' + (h * z) + 'px';
        lens.style.backgroundPosition = (d / 2 - x * z) + 'px ' + (d / 2 - y * z) + 'px';
      });
    }
    function at(e, st) {
      var r = st.getBoundingClientRect();
      fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      grid.classList.add('on');
      place();
    }
    stages.forEach(function (st) {
      st.addEventListener('pointermove', function (e) { at(e, st); });
      st.addEventListener('pointerdown', function (e) { at(e, st); });
      st.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') grid.classList.remove('on'); });
      st.addEventListener('focus', function () { grid.classList.add('on'); place(); });
      st.addEventListener('blur', function () { grid.classList.remove('on'); });
      st.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 0.1 : 0.025;
        var k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!k) return;
        e.preventDefault();
        fx = Math.min(1, Math.max(0, fx + k[0])); fy = Math.min(1, Math.max(0, fy + k[1]));
        grid.classList.add('on'); place();
      });
    });
    group($('#loupeGen'), 'data-gen', function (v) { gen = v; load(); });
    group(seedBox, 'data-seed', function (v) { seed = +v; load(); });
    group($('#loupeZoom'), 'data-z', function (v) { z = +v; place(); });
    window.addEventListener('resize', place);
    load();
  })();

  /* ---------------- 6. FID chart ---------------- */

  (function () {
    var svg = $('#fidSvg'), tip = $('#fidTip');
    var W = 860, H = 460, L = 168, R = 46, T = 10, B = 34;
    var GROUPS = [
      { key: 'self', label: 'Self-comparison', c: '--text-mute', note: 'The same distribution against itself — the floor of the metric.' },
      { key: 'realfake', label: 'Real vs. synthetic', c: '--synth', note: 'What this paper set out to measure.' },
      { key: 'realreal', label: 'Real device vs. real device', c: '--real', note: 'Two genuine datasets from different machines.' },
      { key: 'hrlr', label: 'High vs. low resolution', c: '--sr', note: 'The cost of resolution itself, within one source.' }
    ];
    function draw() {
      clear(svg);
      var rows = [];
      GROUPS.forEach(function (g) {
        rows.push({ head: g.label });
        D.fid[g.key].forEach(function (r) { rows.push({ name: r[0], v: r[1], c: g.c, note: g.note, grp: g.label }); });
      });
      var maxV = 120;
      var X = function (v) { return L + (W - L - R) * v / maxV; };
      var rh = (H - T - B) / rows.length;
      [0, 20, 40, 60, 80, 100, 120].forEach(function (v) {
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, class: v ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: X(v), y: H - B + 17, class: 'ticktext', 'text-anchor': 'middle' }, v));
      });
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 4, class: 'ticktext', 'text-anchor': 'middle' }, 'FID — lower is more similar'));
      rows.forEach(function (r, i) {
        var y = T + rh * i;
        if (r.head) {
          svg.appendChild(el('text', { x: 4, y: y + rh * 0.78, class: 'serieslabel', fill: css('--text-soft') }, r.head));
          return;
        }
        var c = css(r.c);
        svg.appendChild(el('text', { x: L - 8, y: y + rh * 0.76, class: 'ticktext', 'text-anchor': 'end' }, r.name));
        var bar = el('rect', { x: L, y: y + rh * 0.18, width: Math.max(1, X(r.v) - L), height: rh * 0.64, fill: c, style: 'cursor:pointer' });
        bar.addEventListener('mouseenter', function () {
          tipAt(tip, svg, W, H, X(r.v), y + rh * 0.1, '<b>' + r.name + ' &middot; FID ' + fmt(r.v, 1) + '</b><div class="row">' + r.note + '</div>');
        });
        bar.addEventListener('mouseleave', function () { hideTip(tip); });
        svg.appendChild(bar);
        svg.appendChild(el('text', { x: X(r.v) + 6, y: y + rh * 0.76, class: 'ticktext', fill: css('--text') }, fmt(r.v, 1)));
      });
      // marker on the headline comparison
      var idx = -1;
      rows.forEach(function (r, k) { if (r.name === 'HRGT-HRPD') idx = k; });
      if (idx > -1) {
        var yy = T + rh * idx;
        svg.appendChild(el('rect', { x: L - 3, y: yy + rh * 0.1, width: X(40.5) - L + 6, height: rh * 0.8, fill: 'none', stroke: css('--synth'), 'stroke-width': 1.6, 'stroke-dasharray': '3 3' }));
      }
    }
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 6b. inception score bars ---------------- */

  (function () {
    var root = $('#isBars'), view = 'main';
    var NOTES = {
      main: 'Pure Gaussian noise scores 1.05, which is the floor. Low-resolution PanoDiff (2.98) scores above real low-resolution data (2.90); high-resolution PanoDiff (2.38) scores below real (2.68). Inception score never looks at the real distribution, so read these as diversity and classifiability, not fidelity.',
      sources: 'The five real source datasets span 2.63 to 2.94 among themselves. Any synthetic set has to be read against that spread rather than against a single number.',
      arms: 'Ten arms, ranked. With both upscalers fine-tuned on the same radiographs, SwinIR scores higher than HAT-SR in every pairing, and PanoDiff + SwinIR (2.89) even scores above real high-resolution radiographs (2.68), although its images are the smoothest in the comparison. A score above that of real radiographs is the clearest sign that IS does not measure radiographic realism; the arms are compared on FID, KID, precision and recall in the table below instead.'
    };
    function bar(name, mean, sd, c, best) {
      var lo = 1.0, hi = 3.1;
      var d = document.createElement('div');
      d.className = 'barrow';
      d.innerHTML =
        '<div class="barlabel"><span>' + name + (best ? ' &nbsp;<b>highest</b>' : '') + '</span>' +
        '<span class="barval">' + fmt(mean, 3) + ' <span style="font-weight:400;color:var(--text-mute)">± ' + fmt(sd, 3) + '</span></span></div>' +
        '<div class="bartrack"><div class="barfill" style="width:' +
        Math.max(2, 100 * (mean - lo) / (hi - lo)) + '%;background:' + c + '"></div></div>';
      return d;
    }
    function draw() {
      clear(root);
      var rows;
      if (view === 'main') {
        rows = D.iscore.main.map(function (r) {
          var c = r[0] === 'Gaussian noise' ? css('--text-mute') : r[0].indexOf('PD') > -1 ? css('--synth') : css('--real');
          return [r[0], r[1], r[2], c];
        });
      } else if (view === 'sources') {
        rows = D.iscore.sources.map(function (r) { return [r[0], r[1], r[2], css('--real')]; });
      } else {
        rows = D.iscore.arms.slice().sort(function (a, b) { return b[1] - a[1]; }).map(function (r) {
          return [r[0], r[1], r[2], r[3] === 'real' ? css('--real') : r[3] === 'gan' ? css('--gan') : css('--synth')];
        });
      }
      var top = Math.max.apply(null, rows.map(function (r) { return r[1]; }));
      rows.forEach(function (r) { root.appendChild(bar(r[0], r[1], r[2], r[3], r[1] === top)); });
      $('#isNote').innerHTML = NOTES[view];
    }
    group($('#isSwitch'), 'data-v', function (v) { view = v; draw(); });
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 7. observer stacks ---------------- */

  (function () {
    var root = $('#obsStacks');
    var COLOR = { DR: '--real', PR: '--real', U: '--text-mute', PF: '--synth', DF: '--synth' };
    var ALPHA = { DR: 1, PR: .5, U: .75, PF: .5, DF: 1 };
    var BODY = {
      EC1: 'Used the midpoint more than anyone: 48 of 200 responses were unsure. That is an experienced clinician stating plainly that a quarter of the images gave no evidence either way.',
      EC2: 'Used the midpoint only three times in each class: a committed reader who almost always chose a side. Also holds the single lowest agreement in the whole table, κ = 0.18 with EP1.',
      EC3: 'Called almost nothing definitely real — zero definitely-real responses on either class. The highest recall of the six at 0.80, bought with a high false-positive rate.',
      EP1: 'An unusual signature: 83 of 100 synthetic images landed on probably fake and only 4 on definitely fake. Confident about direction, never about magnitude.',
      EP2: 'The best reader of the six on every metric — precision 0.78, recall 0.81, accuracy 0.79 — and never used the midpoint at all.',
      EP3: 'Agrees with EC3 more closely than any other pair on the page (κ = 0.43), and the two also used the scale most alike. Weighted κ is measured against each rater’s own marginals, so response style moves it independently of skill.'
    };
    D.observer.names.forEach(function (u, i) {
      var t = D.observer.tally[u];
      var d = document.createElement('div');
      d.className = 'obsblock';
      d.style.cursor = 'pointer';
      d.style.margin = '0 0 14px';
      d.innerHTML = '<div class="barlabel"><span><b>' + u + '</b> &middot; ' +
        (u.indexOf('EC') === 0 ? 'early career' : 'experienced') +
        '</span><span class="barval">accuracy ' + fmt(D.observer.metrics[u][2] * 100, 0) + '%</span></div>';
      ['Fake', 'Real'].forEach(function (cls) {
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="stack">' + LEVELS.map(function (L) {
          return '<i style="width:' + t[cls][L] + '%;background:' + css(COLOR[L]) + ';opacity:' + ALPHA[L] + '" title="' +
            t[cls][L] + ' ' + LEVEL_NAME[L] + '"></i>';
        }).join('') + '</div>' +
          '<div class="stacklab"><span>' + (cls === 'Fake' ? '100 synthetic' : '100 real') + '</span><span>' +
          LEVELS.map(function (L) { return t[cls][L]; }).join(' · ') + '</span></div>';
        d.appendChild(wrap);
      });
      d.addEventListener('click', function () { select(i); });
      root.appendChild(d);
    });
    function select(i) {
      var u = D.observer.names[i], m = D.observer.metrics[u], t = D.observer.tally[u];
      $$('.obsblock', root).forEach(function (n, k) { n.style.opacity = k === i ? 1 : .55; });
      $('#obsKicker').textContent = u + (u.indexOf('EC') === 0 ? ' — early-career dentist' : ' — experienced dentist');
      $('#obsVerdict').textContent = fmt(m[2] * 100, 0) + '% accurate';
      $('#obsBody').textContent = BODY[u];
      var unsure = t.Fake.U + t.Real.U;
      $('#obsMetrics').innerHTML =
        ['Precision', 'Recall', 'Accuracy'].map(function (lab, k) {
          return '<div class="barrow"><div class="barlabel"><span>' + lab + '</span><span class="barval">' +
            fmt(m[k], 2) + '</span></div><div class="bartrack"><div class="barfill" style="width:' +
            (m[k] * 100) + '%;background:var(--diff)"></div></div></div>';
        }).join('') +
        '<p class="note" style="margin-top:8px">' + unsure + ' of 200 responses were unsure, and AUC over the ' +
        'graded scale was ' + fmt(D.observer.roc[u].auc, 2) + '.</p>';
    }
    select(4);
  })();

  /* ---------------- 7b. conventions ---------------- */

  (function () {
    var root = $('#convBars');
    D.observer.conventions.forEach(function (c, i) {
      var d = document.createElement('div');
      d.className = 'barrow';
      d.style.cursor = 'pointer';
      d.innerHTML = '<div class="barlabel"><span>' + c.name + (c.used ? ' &nbsp;<b>used in the paper</b>' : '') +
        '</span><span class="barval">' + fmt(c.acc, 1) + '%</span></div>' +
        '<div class="bartrack"><div class="barfill" style="width:' + c.acc + '%;background:' +
        (c.used ? css('--diff') : c.id === 'drop' ? css('--warn') : css('--gan')) + '"></div>' +
        '<div class="barfill ghost" style="width:78.2%"></div></div>';
      d.addEventListener('click', function () { select(i); });
      root.appendChild(d);
    });
    var note = document.createElement('p');
    note.className = 'note';
    note.style.marginTop = '6px';
    note.innerHTML = 'The dashed outline on every bar is 78.2%, the accuracy readers reached against ' +
      'StyleGAN2-ADA radiographs (Schoenhof et al., 2024) &mdash; the benchmark this paper’s central claim ' +
      'rests on being below.';
    root.appendChild(note);
    function select(i) {
      var c = D.observer.conventions[i];
      $$('.barrow', root).forEach(function (n, k) { n.style.opacity = k === i ? 1 : .55; });
      $('#convKicker').textContent = c.name;
      $('#convBody').textContent = c.note;
    }
    select(0);
  })();

  /* ---------------- 7c. ROC / PR curves ---------------- */

  (function () {
    var svg = $('#rocSvg'), tip = $('#rocTip'), legend = $('#rocLegend');
    var W = 860, H = 400, L = 62, R = 200, T = 14, B = 44;
    var kind = 'roc';
    var shown = { EC: true, EP: true };
    var COL = { EC1: '--sr', EC2: '--warn', EC3: '--gan', EP1: '--diff', EP2: '--real', EP3: '--synth' };
    var NOTE = {
      roc: 'The experienced group averages AUC 0.87 against 0.79 for the early-career group. With three readers per group that gap does not reach significance and the paper says so; it is consistent within this sample, not an established effect of seniority.',
      pr: 'Average precision runs 0.69 to 0.89. Chance is 0.5, because the quiz held exactly 100 real and 100 synthetic radiographs per observer.'
    };
    function draw() {
      clear(svg);
      clear(legend);
      var X = function (v) { return L + (W - L - R) * v; };
      var Y = function (v) { return H - B - (H - B - T) * (kind === 'roc' ? v : (v - 0.45) / 0.55); };
      [0, .2, .4, .6, .8, 1].forEach(function (v) {
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, class: v ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: X(v), y: H - B + 17, class: 'ticktext', 'text-anchor': 'middle' }, v.toFixed(1)));
      });
      var yticks = kind === 'roc' ? [0, .2, .4, .6, .8, 1] : [.5, .6, .7, .8, .9, 1];
      yticks.forEach(function (v) {
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'gridline' }));
        svg.appendChild(el('text', { x: L - 8, y: Y(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v.toFixed(1)));
      });
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: H - B, class: 'axisline' }));
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 4, class: 'ticktext', 'text-anchor': 'middle' },
        kind === 'roc' ? 'false positive rate' : 'recall'));
      svg.appendChild(el('text', { x: 14, y: T + (H - T - B) / 2, class: 'ticktext', 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (T + (H - T - B) / 2) + ')' },
        kind === 'roc' ? 'true positive rate' : 'precision'));

      // chance
      if (kind === 'roc') {
        svg.appendChild(el('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), stroke: css('--text-mute'), 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
      } else {
        svg.appendChild(el('line', { x1: X(0), y1: Y(0.5), x2: X(1), y2: Y(0.5), stroke: css('--text-mute'), 'stroke-width': 1.4, 'stroke-dasharray': '5 4' }));
      }

      D.observer.names.forEach(function (u) {
        var grp = u.slice(0, 2);
        if (!shown[grp]) return;
        var c = D.observer[kind][u];
        var pts = c.x.map(function (x, i) {
          var y = Math.max(kind === 'roc' ? 0 : 0.45, c.y[i]);
          return X(x) + ',' + Y(y);
        }).join(' ');
        var line = el('polyline', {
          points: pts, fill: 'none', stroke: css(COL[u]), 'stroke-width': 2.6,
          'stroke-linejoin': 'round', opacity: .85, style: 'cursor:pointer'
        });
        var val = kind === 'roc' ? c.auc : c.ap;
        line.addEventListener('mouseenter', function () {
          line.setAttribute('stroke-width', 4.4); line.setAttribute('opacity', 1);
          var mid = Math.floor(c.x.length / 2);
          tipAt(tip, svg, W, H, X(c.x[mid]), Y(Math.max(kind === 'roc' ? 0 : 0.45, c.y[mid])) - 10,
            '<b>' + u + '</b><div class="row"><i style="background:' + css(COL[u]) + '"></i>' +
            (kind === 'roc' ? 'AUC ' : 'AP ') + fmt(val, 2) + '</div>');
        });
        line.addEventListener('mouseleave', function () {
          line.setAttribute('stroke-width', 2.6); line.setAttribute('opacity', .85); hideTip(tip);
        });
        svg.appendChild(line);
      });

      // right-hand key
      var ly = T + 10;
      ['EC', 'EP'].forEach(function (grp) {
        svg.appendChild(el('text', { x: W - R + 14, y: ly, class: 'serieslabel', fill: css('--text-soft') },
          grp === 'EC' ? 'Early career' : 'Experienced'));
        ly += 20;
        D.observer.names.filter(function (u) { return u.indexOf(grp) === 0; }).forEach(function (u) {
          var v = kind === 'roc' ? D.observer.roc[u].auc : D.observer.pr[u].ap;
          svg.appendChild(el('line', { x1: W - R + 14, x2: W - R + 34, y1: ly - 4, y2: ly - 4, stroke: css(COL[u]), 'stroke-width': 3, opacity: shown[grp] ? 1 : .3 }));
          svg.appendChild(el('text', { x: W - R + 40, y: ly, class: 'ticktext', opacity: shown[grp] ? 1 : .4 }, u + '  ' + fmt(v, 2)));
          ly += 19;
        });
        var avg = D.observer.names.filter(function (u) { return u.indexOf(grp) === 0; })
          .reduce(function (a, u) { return a + (kind === 'roc' ? D.observer.roc[u].auc : D.observer.pr[u].ap); }, 0) / 3;
        svg.appendChild(el('text', { x: W - R + 14, y: ly, class: 'ticktext', fill: css('--text'), 'font-weight': '700' },
          'mean ' + fmt(avg, 2)));
        ly += 26;
      });

      ['EC', 'EP'].forEach(function (grp) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', shown[grp]);
        b.innerHTML = '<i class="swatch line" style="background:' + css(grp === 'EC' ? '--sr' : '--diff') + '"></i>' +
          (grp === 'EC' ? 'Early-career dentists' : 'Experienced dentists');
        b.addEventListener('click', function () { shown[grp] = !shown[grp]; draw(); });
        legend.appendChild(b);
      });
      var s = document.createElement('span');
      s.innerHTML = '<i class="swatch line" style="background:var(--text-mute)"></i>chance';
      legend.appendChild(s);
      $('#rocNote').textContent = NOTE[kind];
    }
    group($('#curveSwitch'), 'data-c', function (v) { kind = v; draw(); });
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 7d. kappa heatmap ---------------- */

  (function () {
    var thead = $('#kappaTable thead'), tbody = $('#kappaTable tbody');
    var names = D.observer.names, K = D.observer.kappa;
    thead.innerHTML = '<tr><th></th>' + names.map(function (n) { return '<th style="text-align:center">' + n + '</th>'; }).join('') + '</tr>';
    function paint() {
      clear(tbody);
      names.forEach(function (rn, i) {
        var tr = document.createElement('tr');
        var cells = names.map(function (cn, j) {
          var v = K[i][j];
          if (i === j) return '<td class="cell" style="color:var(--text-mute)">&mdash;</td>';
          var t = Math.max(0, Math.min(1, (v - 0.15) / 0.30));
          var bgc = rgba(css('--diff'), t * 0.78);
          return '<td class="cell' + (t > .72 ? ' lightink' : '') + '" style="background:' + bgc + '" title="' +
            rn + ' vs ' + cn + '">' + v.toFixed(2) + '</td>';
        }).join('');
        tr.innerHTML = '<th style="text-align:left">' + rn + '</th>' + cells;
        tbody.appendChild(tr);
      });
    }
    document.addEventListener('themechange', paint);
    paint();
  })();

  /* ---------------- 7e. confusion examples ---------------- */

  (function () {
    var pair = $('#confPair'), cat = 'TP', cert = 'fc';
    var INFO = {
      TP: ['True positive', 'Synthetic, and correctly called fake',
        'The images the pipeline did not get away with. What gives them away is usually global rather than local: an arch that does not close cleanly, or texture that is too uniform across the mandible.'],
      FN: ['False negative', 'Synthetic, but called real',
        'The interesting cell. These are radiographs a practising dentist accepted as a patient’s image under time pressure. The radiographs cycling at the top of this page are drawn from this cell and from the paper’s own selection of examples that fooled most observers.'],
      TN: ['True negative', 'Real, and correctly called real',
        'The control. Note that observers were not uniformly confident even here — the partially-certain examples are genuine radiographs that a clinician hesitated over.'],
      FP: ['False positive', 'Real, but called fake',
        'Real radiographs that observers rejected. These matter as much as the false negatives: they show the observers were not simply accepting everything, and they set the floor on how high accuracy could have gone.']
    };
    function paint() {
      clear(pair);
      D.confusion.filter(function (c) { return c.cat === cat && c.cert === cert; }).forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.style.cursor = 'zoom-in';
        b.setAttribute('aria-pressed', 'false');
        b.innerHTML = '<img loading="lazy" decoding="async" src="assets/confusion/' + c.file + '" alt="' + INFO[cat][1] + '">';
        b.addEventListener('click', function () { zoom('assets/confusion/' + c.file, INFO[cat][1]); });
        pair.appendChild(b);
      });
      $('#confKicker').textContent = INFO[cat][0] + (cert === 'fc' ? ' · fully certain' : ' · partially certain');
      $('#confVerdict').textContent = INFO[cat][1];
      $('#confBody').textContent = INFO[cat][2] +
        (cert === 'pc' ? ' These two were chosen from the responses where the observer indicated only partial certainty.' : '');
    }
    group($('#confCat'), 'data-cat', function (v) { cat = v; paint(); });
    group($('#confCert'), 'data-cert', function (v) { cert = v; paint(); });
    paint();
  })();

  /* ---------------- 8. attention viewer ---------------- */

  (function () {
    var img = $('#camImg'), map = $('#camMap'), grid = $('#camGrid');
    var mix = $('#camMix'), out = $('#oMix'), at = 0;
    function pad(i) { return (i < 10 ? '0' : '') + i; }
    D.attn.forEach(function (a, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = (a.cls === 'real' ? 'real' : 'syn') + (a.ok ? '' : ' err');
      b.setAttribute('aria-pressed', i === 0);
      b.title = a.cls + ', C = ' + a.c.toFixed(3) + (a.ok ? '' : ' — misclassified');
      b.innerHTML = '<img loading="lazy" decoding="async" src="assets/img/attn_' + pad(a.i) + '_img.jpg" alt="' + a.cls + ' radiograph, C = ' + a.c.toFixed(3) + '">';
      b.addEventListener('click', function () { select(i); });
      grid.appendChild(b);
    });
    function select(i) {
      at = i;
      var a = D.attn[i];
      $$('button', grid).forEach(function (b, k) { b.setAttribute('aria-pressed', k === i); });
      img.src = 'assets/img/attn_' + pad(a.i) + '_img.jpg';
      map.src = 'assets/img/attn_' + pad(a.i) + '_cam.jpg';
      $('#camKicker').textContent = a.cls === 'real' ? 'A real radiograph' : 'A synthetic radiograph';
      $('#camVerdict').innerHTML = 'C = ' + a.c.toFixed(3) +
        ' &middot; <span style="color:var(--' + (a.ok ? 'real' : 'warn') + ')">' +
        (a.ok ? 'classified correctly' : 'misclassified') + '</span>';
      $('#camBody').textContent = a.ok
        ? (a.cls === 'real'
          ? 'The classifier is confident this is real. Attention lands in scattered hot spots, several of them on tooth crowns but many on the image border.'
          : 'The classifier is confident this is synthetic, and it is right. Over the full test set it reaches 97.5% — whatever cue it uses, it is reliable and it is not one a person is using at twelve seconds.')
        : 'One of four the classifier got wrong, and all four are synthetic radiographs it read as real. These are the images where PanoDiff-SR is at its most convincing, to a machine as well as to a clinician.';
    }
    mix.addEventListener('input', function () {
      map.style.opacity = mix.value / 100;
      out.textContent = mix.value + '%';
    });
    select(0);
  })();

  /* ---------------- 8b. attention statistics ---------------- */

  (function () {
    var root = $('#attnBars');
    D.attnStats.forEach(function (s) {
      var scale = s.name.indexOf('entropy') > -1 ? { lo: 5.9, hi: 6.2 } : { lo: 0, hi: 0.5 };
      function w(v) { return Math.max(1, Math.min(100, 100 * (v - scale.lo) / (scale.hi - scale.lo))); }
      var d = document.createElement('div');
      d.style.margin = '0 0 16px';
      d.innerHTML =
        '<div class="barlabel" style="font-size:14px"><span><b>' + s.name + '</b></span>' +
        '<span class="barval" style="font-weight:400;color:var(--text-soft)">effect ' +
        (s.eff > 0 ? '+' : '') + fmt(s.eff, 3) + ' &middot; p ' + s.p + '</span></div>' +
        ['real', 'syn'].map(function (k) {
          var v = s[k], sd = s[k === 'real' ? 'rsd' : 'ssd'];
          return '<div class="barrow" style="margin:4px 0"><div class="barlabel"><span>' +
            (k === 'real' ? 'real' : 'synthetic') + '</span><span class="barval">' + fmt(v, 4) +
            ' <span style="font-weight:400;color:var(--text-mute)">± ' + fmt(sd, 4) + '</span></span></div>' +
            '<div class="bartrack"><div class="barfill" style="width:' + w(v) + '%;background:' +
            css(k === 'real' ? '--real' : '--synth') + '"></div></div></div>';
        }).join('');
      root.appendChild(d);
    });
  })();

  /* ---------------- 6c. Table 9: distance, fidelity and coverage per arm ---------------- */

  (function () {
    var tb = $('#armsTable tbody');
    if (!tb) return;
    var rows = D.arms.toReal;
    ['lr', 'hr', 'real'].forEach(function (res) {
      var grp = rows.filter(function (r) { return r.res === res; });
      if (!grp.length) return;
      var scale = res === 'real';          // real inputs give the scale; no bold there
      var bF = Math.min.apply(null, grp.map(function (r) { return r.fid; }));
      var bK = Math.min.apply(null, grp.map(function (r) { return r.kid; }));
      var bP = Math.max.apply(null, grp.map(function (r) { return r.p; }));
      var bR = Math.max.apply(null, grp.map(function (r) { return r.r; }));
      var h = document.createElement('tr');
      h.innerHTML = '<td colspan="5" class="note" style="text-align:left;font-style:italic">' +
        (res === 'lr' ? 'Low resolution (256 × 128), against the 7243 real LR radiographs'
         : res === 'hr' ? 'Full resolution (1024 × 512), against the 7243 real HR radiographs'
         : 'For scale: the same upscalers on the real low-resolution images') + '</td>';
      tb.appendChild(h);
      grp.forEach(function (r) {
        var tr = document.createElement('tr');
        if (r.ours) tr.className = 'ours';
        var b = function (hit) { return hit && !scale ? 'best' : ''; };
        tr.innerHTML = '<td style="text-align:left">' + r.b + '</td>' +
          '<td class="' + b(r.fid === bF) + '">' + fmt(r.fid, 1) + '</td>' +
          '<td class="' + b(r.kid === bK) + '">' + fmt(r.kid, 1) + ' <span class="note">± ' + fmt(r.kidsd, 1) + '</span></td>' +
          '<td class="' + b(r.p === bP) + '">' + fmt(r.p, 3) + '</td>' +
          '<td class="' + b(r.r === bR) + '">' + fmt(r.r, 3) + '</td>';
        tb.appendChild(tr);
      });
    });
  })();

  /* ---------------- 8c. Table 7: MedSAM probe ---------------- */

  (function () {
    var tb = $('#medsamTable tbody');
    if (!tb) return;
    D.medsam.forEach(function (r) {
      var tr = document.createElement('tr');
      var big = Math.abs(parseFloat(r.r.replace('−', '-'))) >= 0.3;
      tr.innerHTML = '<td style="text-align:left"><b>' + r.prompt + '</b></td><td style="text-align:left">' + r.m + '</td>' +
        '<td>' + r.real + '</td><td>' + r.syn + '</td>' +
        '<td' + (big ? ' style="color:var(--warn);font-weight:700"' : '') + '>' + r.r + '</td>' +
        '<td>' + (r.p || '') + '</td><td>' + r.dev + '</td>';
      tb.appendChild(tr);
    });
  })();

  /* ---------------- 9. direct-HR scatter ---------------- */

  (function () {
    var svg = $('#hrSvg'), tip = $('#hrTip');
    var W = 860, H = 380, L = 66, R = 24, T = 16, B = 46;
    function famColor(m) {
      if (m.res.indexOf('+ SR') > -1) return m.ours ? css('--sr') : css('--gan');
      return m.family.indexOf('GAN') > -1 ? css('--gan') : css('--diff');
    }
    function draw() {
      clear(svg);
      var X = function (v) { return L + (W - L - R) * (v - 74) / 28; };       // ViT detect 74 .. 102
      var Y = function (v) { return H - B - (H - B - T) * v / 230; };          // FID 0 .. 230
      [0, 50, 100, 150, 200].forEach(function (v) {
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 8, y: Y(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v));
      });
      [76, 80, 84, 88, 92, 96, 100].forEach(function (v) {
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, class: 'gridline' }));
        svg.appendChild(el('text', { x: X(v), y: H - B + 18, class: 'ticktext', 'text-anchor': 'middle' }, v));
      });
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: H - B, class: 'axisline' }));
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 6, class: 'ticktext', 'text-anchor': 'middle' },
        'ViT real-vs-synthetic accuracy (%) — lower means harder to detect'));
      svg.appendChild(el('text', { x: 14, y: T + (H - T - B) / 2, class: 'ticktext', 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (T + (H - T - B) / 2) + ')' }, 'FID against 7243 real HR'));

      D.directhr.forEach(function (m) {
        var c = famColor(m);
        var r = m.cost ? 6 + Math.sqrt(m.cost) * 0.55 : 8;
        var g = el('g', {});
        g.appendChild(el('circle', {
          cx: X(m.vit), cy: Y(m.fid), r: r, fill: 'none', stroke: c,
          'stroke-width': 1.6, 'stroke-dasharray': m.cost ? '3 3' : '0', opacity: .75
        }));
        var dot = el('circle', {
          cx: X(m.vit), cy: Y(m.fid), r: m.ours ? 7 : 5.5, fill: c,
          stroke: css('--bg-sunk'), 'stroke-width': 2, style: 'cursor:pointer'
        });
        dot.addEventListener('mouseenter', function () {
          tipAt(tip, svg, W, H, X(m.vit), Y(m.fid) - 12,
            '<b>' + m.name + '</b><div class="row"><i style="background:' + c + '"></i>' + m.family +
            ' at ' + m.res + '</div><div class="row">FID ' + fmt(m.fid, 2) + ' &middot; IS ' + fmt(m.is, 2) +
            ' &middot; ViT ' + fmt(m.vit, 1) + '%</div><div class="row">Precision ' + fmt(m.prec, 1) + '% &middot; recall ' + fmt(m.rec, 1) + '%' + (m.cost ? ' &middot; ' + m.cost + ' acc.-h' : '') + '</div>');
        });
        dot.addEventListener('mouseleave', function () { hideTip(tip); });
        g.appendChild(dot);
        var short = m.name.split(' (')[0];
        var below = m.name.indexOf('LDM') === 0 || m.name.indexOf('ADM') === 0;
        g.appendChild(el('text', {
          x: X(m.vit), y: Y(m.fid) + (below ? r + 16 : -r - 8),
          class: 'serieslabel', 'text-anchor': 'middle',
          fill: m.ours ? css('--text') : css('--text-soft')
        }, short));
        svg.appendChild(g);
      });
    }
    document.addEventListener('themechange', draw);
    draw();

    var tb = $('#hrTable tbody');
    var bestF = Math.min.apply(null, D.directhr.map(function (m) { return m.fid; }));
    var bestV = Math.min.apply(null, D.directhr.map(function (m) { return m.vit; }));
    var bestP = Math.max.apply(null, D.directhr.map(function (m) { return m.prec; }));
    var bestR = Math.max.apply(null, D.directhr.map(function (m) { return m.rec; }));
    D.directhr.forEach(function (m) {
      var tr = document.createElement('tr');
      if (m.ours) tr.className = 'ours';
      tr.innerHTML = '<td>' + m.name + '</td><td style="text-align:left">' + m.family + '</td>' +
        '<td class="' + (m.fid === bestF ? 'best' : '') + '">' + fmt(m.fid, 2) + '</td>' +
        '<td>' + fmt(m.is, 2) + '</td>' +
        '<td class="' + (m.prec === bestP ? 'best' : '') + '">' + fmt(m.prec, 1) + '</td>' +
        '<td class="' + (m.rec === bestR ? 'best' : '') + '">' + fmt(m.rec, 1) + '</td>' +
        '<td class="' + (m.vit === bestV ? 'best' : '') + '">' + fmt(m.vit, 1) + '</td>' +
        '<td>' + (m.cost ? m.cost + (m.dag ? '<sup>†</sup>' : '') : '—') + '</td>';
      tb.appendChild(tr);
    });
  })();

  /* ---------------- 9b. anatomy table ---------------- */

  (function () {
    var thead = $('#anatTable thead'), tbody = $('#anatTable tbody');
    var cols = D.anatomy.cols;
    thead.innerHTML = '<tr><th>Measure</th>' + cols.map(function (c, i) {
      return '<th' + (i === 0 ? ' style="color:var(--real)"' : '') + '>' + c + '</th>';
    }).join('') + '</tr>';
    D.anatomy.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      // distance from the real column, so "closest to real" is visible without arithmetic
      var ref = r.v[0];
      var devs = r.v.map(function (v) { return Math.abs(v - ref) / Math.abs(ref); });
      var bestIdx = 1 + devs.slice(1).indexOf(Math.min.apply(null, devs.slice(1)));
      tr.innerHTML = '<td>' + r.name + '</td>' + r.v.map(function (v, i) {
        var d = v >= 10 ? 1 : 3;
        return '<td class="' + (i === bestIdx ? 'best' : '') + '"' + (i === 0 ? ' style="color:var(--real)"' : '') + '>' +
          fmt(v, d) + '<span class="sig">' + r.sig[i] + '</span></td>';
      }).join('');
      tbody.appendChild(tr);
    });
    var tr = document.createElement('tr');
    var best = Math.min.apply(null, D.anatomy.outside.slice(1));
    tr.innerHTML = '<td><b>Outside real range</b></td>' + D.anatomy.outside.map(function (v, i) {
      return '<td class="' + (i > 0 && v === best ? 'best' : '') + '"' + (i === 0 ? ' style="color:var(--real)"' : '') +
        '>' + fmt(v, 1) + '%</td>';
    }).join('');
    tbody.appendChild(tr);
  })();

  /* ---------------- 9c. device bars ---------------- */

  (function () {
    var svg = $('#devSvg'), tip = $('#devTip');
    var W = 860, H = 300, L = 92, R = 40, T = 14, B = 40;
    function draw() {
      clear(svg);
      var maxV = 130;
      var X = function (v) { return L + (W - L - R) * v / maxV; };
      var rh = (H - T - B) / D.device.length;
      [0, 25, 50, 75, 100, 125].forEach(function (v) {
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, class: v ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: X(v), y: H - B + 17, class: 'ticktext', 'text-anchor': 'middle' }, v));
      });
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 4, class: 'ticktext', 'text-anchor': 'middle' }, 'FID at matched n = 500, mean of five draws'));
      D.device.forEach(function (d, i) {
        var y = T + rh * i;
        svg.appendChild(el('text', { x: L - 10, y: y + rh * 0.56, class: 'serieslabel', 'text-anchor': 'end' }, d.src));
        [['syn', 'sd1', '--synth', 'to the synthetic set'], ['real', 'sd2', '--real', 'to the pooled real corpus']]
          .forEach(function (spec, k) {
            var v = d[spec[0]], sd = d[spec[1]], c = css(spec[2]);
            var by = y + rh * (0.16 + k * 0.36), bh = rh * 0.3;
            var bar = el('rect', { x: L, y: by, width: Math.max(1, X(v) - L), height: bh, fill: c, style: 'cursor:pointer' });
            bar.addEventListener('mouseenter', function () {
              tipAt(tip, svg, W, H, X(v), by, '<b>' + d.src + ' → ' + spec[3] + '</b><div class="row">FID ' +
                fmt(v, 1) + ' ± ' + fmt(sd, 1) + ' at n = ' + Math.min(500, d.n) + ', source holds ' + d.n.toLocaleString() + ' images</div>');
            });
            bar.addEventListener('mouseleave', function () { hideTip(tip); });
            svg.appendChild(bar);
            // sd whisker
            svg.appendChild(el('line', { x1: X(v - sd), x2: X(v + sd), y1: by + bh / 2, y2: by + bh / 2, stroke: css('--bg-sunk'), 'stroke-width': 1.6 }));
            svg.appendChild(el('text', { x: X(v) + 6, y: by + bh - 2, class: 'ticktext', fill: css('--text') }, fmt(v, 1)));
          });
      });
    }
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 11. repo tree ---------------- */

  (function () {
    var list = $('#treeList');
    D.tree.forEach(function (t, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', i === 0);
      b.innerHTML = t.path + '<span>' + t.size + '</span>';
      b.addEventListener('click', function () { select(i); });
      li.appendChild(b);
      list.appendChild(li);
    });
    function select(i) {
      $$('button', list).forEach(function (b, k) { b.setAttribute('aria-pressed', k === i); });
      $('#treeKicker').textContent = D.tree[i].path;
      $('#treeBody').innerHTML = D.tree[i].body;
      $('#treeCmd').textContent = D.tree[i].cmd;
    }
    select(0);
  })();

  /* ---------------- bibtex ---------------- */

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

})();
