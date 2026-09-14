/* ==========================================================
   Brain2VLM project page
   Every number below comes from the paper or from the plotted
   data shipped in assets/data/data.js (subj01 unless noted).
   ========================================================== */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ---------------- theme ---------------- */

  var themeBtn = $('#themeToggle');
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { }
    document.dispatchEvent(new CustomEvent('themechange'));
  });

  /* ---------------- stimuli ---------------- */

  var COCO = [
    'teddy bear', 'giraffe', 'tv, mouse, keyboard, cup, book, chair', 'vase', 'cow',
    'clock', 'airplane', 'cat, bench', 'traffic light, car, clock', 'person, skis',
    'person, train, traffic light, bench, handbag', 'person, surfboard',
    'person, baseball bat', 'sheep'
  ];
  var N = COCO.length;
  var pad = function (i) { return (i < 10 ? '0' : '') + i; };
  var tile = function (kind, i) { return 'assets/tiles/' + kind + '_' + pad(i) + '.jpg'; };

  /* ---------------- hero triptych ---------------- */

  var heroGt = $('#heroGt'), heroLin = $('#heroLin'), heroMlp = $('#heroMlp');
  var heroDots = $('#heroDots'), heroPlay = $('#heroPlay');
  var heroIdx = 1, heroTimer = null;

  // Pre-load so the cycle never shows a blank frame.
  for (var p = 0; p < N; p++) {
    ['gt', 'lin', 'mlp'].forEach(function (k) { var im = new Image(); im.src = tile(k, p); });
  }

  for (var d = 0; d < N; d++) {
    (function (i) {
      var b = document.createElement('button');
      b.className = 'dot';
      b.type = 'button';
      b.setAttribute('aria-label', 'Stimulus ' + (i + 1) + ': ' + COCO[i]);
      b.addEventListener('click', function () { stopHero(); setHero(i); });
      heroDots.appendChild(b);
    })(d);
  }

  function setHero(i) {
    heroIdx = (i + N) % N;
    heroGt.src = tile('gt', heroIdx);
    heroLin.src = tile('lin', heroIdx);
    heroMlp.src = tile('mlp', heroIdx);
    $$('.dot', heroDots).forEach(function (b, k) {
      b.setAttribute('aria-current', k === heroIdx ? 'true' : 'false');
    });
  }

  function startHero() {
    if (heroTimer) return;
    heroTimer = setInterval(function () { setHero(heroIdx + 1); }, 2600);
    heroPlay.textContent = 'Pause';
  }
  function stopHero() {
    clearInterval(heroTimer); heroTimer = null;
    heroPlay.textContent = 'Play';
  }
  heroPlay.addEventListener('click', function () { heroTimer ? stopHero() : startHero(); });

  setHero(1);
  if (reduceMotion) { heroPlay.textContent = 'Play'; } else { startHero(); }

  /* ---------------- hierarchy explorer ---------------- */

  var STREAM = {
    early: {
      kicker: 'Early visual cortex, V1 to V3',
      verdict: 'Almost linear already.',
      body: 'Ridge regression gets most of the way to the diffusion latent. Adding depth and nonlinearity ' +
        'to the decoder helps a little, and then stops helping. Structure is close to a linear readout of ' +
        'early cortex.',
      ridge: 0.2385, mlp: 0.3002, delta: '+0.06',
      scale: 'Best MLP here came from the width sweep, at 512 hidden units.'
    },
    ventral: {
      kicker: 'Ventral visual cortex, V4, LO and PHC',
      verdict: 'Nonlinear, by a wide margin.',
      body: 'Ridge barely reaches 0.30 correlation with the CLIP embedding. The same voxels, read through ' +
        'a residual MLP, reach 0.78. Meaning is not a linear projection of higher visual cortex.',
      ridge: 0.3035, mlp: 0.7819, delta: '+0.48',
      scale: 'Best MLP here came from the depth sweep, at 6 residual blocks.'
    }
  };
  var BARMAX = 0.85;
  var stream = 'early';

  function setStream(s) {
    stream = s;
    var d = STREAM[s];
    $('#btnEarly').setAttribute('aria-pressed', s === 'early');
    $('#btnVentral').setAttribute('aria-pressed', s === 'ventral');

    $$('.roi').forEach(function (g) {
      g.classList.toggle('on-early', s === 'early' && g.dataset.stream === 'early');
      g.classList.toggle('on-ventral', s === 'ventral' && g.dataset.stream === 'ventral');
    });
    $('#flowEarly').classList.toggle('live', s === 'early');
    $('#flowVentral').classList.toggle('live', s === 'ventral');
    $('#boxZ').classList.toggle('dim', s !== 'early');
    $('#boxC').classList.toggle('dim', s !== 'ventral');

    $('#roKicker').textContent = d.kicker;
    $('#roVerdict').textContent = d.verdict;
    $('#roBody').textContent = d.body;
    $('#roDelta').textContent = d.delta;
    $('#roScale').textContent = d.scale;
    $('#valRidge').textContent = d.ridge.toFixed(3);
    $('#valMlp').textContent = d.mlp.toFixed(3);
    $('#barRidge').style.width = (100 * d.ridge / BARMAX) + '%';
    $('#barMlp').style.width = (100 * d.mlp / BARMAX) + '%';
  }

  $('#btnEarly').addEventListener('click', function () { setStream('early'); });
  $('#btnVentral').addEventListener('click', function () { setStream('ventral'); });
  $$('.roi').forEach(function (g) {
    g.addEventListener('click', function () { setStream(g.dataset.stream); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStream(g.dataset.stream); }
    });
  });
  setStream('early');

  /* ---------------- pipeline stepper ---------------- */

  var STEPS = [
    {
      name: 'A photograph on a screen',
      body: 'Each of the four participants viewed roughly 10,000 natural photographs from MS COCO over 30 to 40 ' +
        'scanning sessions. 982 images were shown to everyone, and those are held out for testing.',
      trained: 'Not trained.'
    },
    {
      name: 'The scanner records voxels',
      body: 'Single-trial beta weights from a 7T scan, restricted to visual cortex: V1 to V3 for the structural ' +
        'target, V4, LO and PHC for the semantic one. One vector of voxel values per image the person looked at.',
      trained: 'Not trained.'
    },
    {
      name: 'A decoder maps voxels to latents',
      body: 'This is the only trained component. Either ridge regression, a single matrix, or our residual MLP: ' +
        'input projection to 2048 units, N residual blocks of linear, GELU, LayerNorm and dropout, linear output. ' +
        'Mean squared error against the true latent.',
      trained: 'Trained. Everything else is frozen.'
    },
    {
      name: 'Two predicted latents come out',
      body: 'z-hat, a 4 by 40 by 40 tensor that the diffusion autoencoder can turn into a coarse picture, and ' +
        'c-hat, a 768-dimensional CLIP vector that says what the scene is about.',
      trained: 'Not trained.'
    },
    {
      name: 'A frozen generator paints it',
      body: 'The autoencoder decodes z-hat to a coarse image, noise is added back through the forward diffusion ' +
        'process, and a U-Net denoises it while attending to c-hat. Stable Diffusion v1.4, unmodified, no ' +
        'fine-tuning at any point.',
      trained: 'Not trained.'
    }
  ];
  var step = 0;

  // voxel strip inside stage 2
  (function () {
    var g = $('#voxels');
    if (!g) return;
    var ns = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 13; i++) {
      var r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', 204 + i * 10);
      r.setAttribute('y', 92);
      r.setAttribute('width', 8);
      r.setAttribute('height', 30);
      r.setAttribute('fill', 'var(--zc)');
      r.setAttribute('opacity', (0.2 + 0.75 * Math.abs(Math.sin(i * 1.7))).toFixed(2));
      g.appendChild(r);
    }
  })();

  function setStep(i) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    $$('.stage').forEach(function (g) {
      var on = +g.dataset.step === step;
      g.classList.toggle('active', on);
      g.classList.toggle('dim', !on);
    });
    $('#stepName').textContent = STEPS[step].name;
    $('#stepBody').textContent = STEPS[step].body;
    $('#stepTrained').textContent = STEPS[step].trained;
    $('#pipeCount').textContent = 'Stage ' + (step + 1) + ' of ' + STEPS.length;
    $('#stepPrev').disabled = step === 0;
    $('#stepNext').textContent = step === STEPS.length - 1 ? 'Start again' : 'Next stage';
  }
  $('#stepPrev').addEventListener('click', function () { setStep(step - 1); });
  $('#stepNext').addEventListener('click', function () {
    setStep(step === STEPS.length - 1 ? 0 : step + 1);
  });
  $$('.stage').forEach(function (g) {
    g.addEventListener('click', function () { setStep(+g.dataset.step); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(+g.dataset.step); }
    });
  });
  setStep(0);

  /* ---------------- reconstruction explorer ---------------- */

  var thumbs = $('#thumbs'), sel = 1;

  for (var t = 0; t < N; t++) {
    (function (i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', i === sel);
      b.setAttribute('aria-label', COCO[i]);
      b.innerHTML = '<img src="' + tile('gt', i) + '" alt="' + COCO[i] + '">';
      b.addEventListener('click', function () { pick(i); });
      thumbs.appendChild(b);
    })(t);
  }

  function pick(i) {
    sel = (i + N) % N;
    $('#seenImg').src = tile('gt', sel);
    $('#cmpLin').src = tile('lin', sel);
    $('#cmpMlp').src = tile('mlp', sel);
    $('#cocoLine').innerHTML = 'Objects in this photo: <b>' + COCO[sel] + '</b>';
    $$('button', thumbs).forEach(function (b, k) {
      b.setAttribute('aria-pressed', k === sel);
    });
  }
  pick(1);

  // wipe comparison
  var compare = $('#compare'), over = $('#cmpOver'), handle = $('#cmpHandle');
  var dragging = false;

  function setWipe(pct) {
    pct = Math.max(0, Math.min(100, pct));
    over.style.width = pct + '%';
    handle.style.left = pct + '%';
    handle.setAttribute('aria-valuenow', Math.round(pct));
  }
  function fromEvent(e) {
    var r = compare.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    setWipe(100 * x / r.width);
  }
  compare.addEventListener('pointerdown', function (e) {
    dragging = true; compare.setPointerCapture(e.pointerId); fromEvent(e);
  });
  compare.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e); });
  compare.addEventListener('pointerup', function () { dragging = false; });
  compare.addEventListener('pointercancel', function () { dragging = false; });
  handle.addEventListener('keydown', function (e) {
    var now = +handle.getAttribute('aria-valuenow');
    if (e.key === 'ArrowLeft') { setWipe(now - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setWipe(now + 5); e.preventDefault(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target === handle) return;
    var box = $('#reconstructions').getBoundingClientRect();
    if (box.top > window.innerHeight || box.bottom < 0) return;
    if (e.key === 'ArrowRight') pick(sel + 1);
    if (e.key === 'ArrowLeft') pick(sel - 1);
  });
  setWipe(50);

  /* ---------------- ablation chart ---------------- */

  var ablTarget = 'c', ablKind = 'depth';
  var ablSvg = $('#ablSvg'), ablTip = $('#ablTip');
  var NS = 'http://www.w3.org/2000/svg';

  var ABL_NOTE = {
    'c-depth': 'Depth matters for meaning: zero blocks already beats ridge by a wide margin, and six blocks is best. ' +
      'The ridge baseline is the flat line near 0.30.',
    'c-width': 'Width barely matters once you are past 512 units. The nonlinearity is doing the work, not the parameter count.',
    'c-frac': 'Still climbing at 100% of NSD. More scanning time would still buy semantic accuracy.',
    'z-depth': 'Extra blocks make the structural target slightly worse. A plain projection is close to the best you can do.',
    'z-width': 'A flat line a little above ridge. Nothing about early cortex to diffusion latent needs capacity.',
    'z-frac': 'Data helps here too, but the whole range spans about 0.10 correlation, against 0.48 for the semantic target.'
  };

  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function drawAblation() {
    var d = window.B2V_ABLATION[ablTarget][ablKind];
    var W = 760, H = 340, L = 62, R = 22, T = 22, B = 58;
    var innerW = W - L - R, innerH = H - T - B;

    // y range covers both curve and baseline, with headroom
    var vals = d.y.map(function (v, i) { return v + d.err[i]; })
      .concat(d.y.map(function (v, i) { return v - d.err[i]; }))
      .concat([d.ridge]);
    var lo = Math.max(0, Math.min.apply(null, vals) - 0.06);
    var hi = Math.min(1, Math.max.apply(null, vals) + 0.06);

    var X = function (i) { return L + (d.x.length === 1 ? innerW / 2 : innerW * i / (d.x.length - 1)); };
    var Y = function (v) { return T + innerH * (1 - (v - lo) / (hi - lo)); };

    while (ablSvg.firstChild) ablSvg.removeChild(ablSvg.firstChild);

    // grid + y ticks
    var steps = 5;
    for (var s = 0; s <= steps; s++) {
      var v = lo + (hi - lo) * s / steps;
      var y = Y(v);
      ablSvg.appendChild(el('line', { x1: L, x2: L + innerW, y1: y, y2: y, class: 'gridline' }));
      ablSvg.appendChild(el('text', { x: L - 10, y: y + 4, class: 'ticktext', 'text-anchor': 'end' }, v.toFixed(2)));
    }
    ablSvg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: T + innerH, class: 'axisline' }));
    ablSvg.appendChild(el('line', { x1: L, x2: L + innerW, y1: T + innerH, y2: T + innerH, class: 'axisline' }));

    // x ticks
    d.x.forEach(function (xv, i) {
      ablSvg.appendChild(el('text',
        { x: X(i), y: T + innerH + 22, class: 'ticktext', 'text-anchor': 'middle' },
        ablKind === 'frac' ? Math.round(xv * 100) + '%' : String(xv)));
    });
    ablSvg.appendChild(el('text',
      { x: L + innerW / 2, y: H - 12, class: 'ticktext', 'text-anchor': 'middle' },
      ablKind === 'frac' ? 'fraction of the training trials used' : d.xlabel));
    ablSvg.appendChild(el('text',
      { x: 14, y: T + innerH / 2, class: 'ticktext', 'text-anchor': 'middle',
        transform: 'rotate(-90 14 ' + (T + innerH / 2) + ')' },
      'correlation with the true latent'));

    // ridge baseline
    ablSvg.appendChild(el('line', {
      x1: L, x2: L + innerW, y1: Y(d.ridge), y2: Y(d.ridge),
      stroke: css('--linear'), 'stroke-width': 2, 'stroke-dasharray': '7 5'
    }));
    ablSvg.appendChild(el('text', {
      x: L + innerW - 4, y: Y(d.ridge) - 8, class: 'serieslabel',
      fill: css('--linear'), 'text-anchor': 'end'
    }, 'ridge  ' + d.ridge.toFixed(3)));

    // error bars
    d.y.forEach(function (yv, i) {
      var e = d.err[i];
      ablSvg.appendChild(el('line', {
        x1: X(i), x2: X(i), y1: Y(yv - e), y2: Y(yv + e),
        stroke: css('--ours'), class: 'errbar', opacity: .55
      }));
    });

    // curve
    var path = d.y.map(function (yv, i) { return (i ? 'L' : 'M') + X(i) + ',' + Y(yv); }).join(' ');
    ablSvg.appendChild(el('path', { d: path, fill: 'none', stroke: css('--ours'), 'stroke-width': 2.6 }));

    // points
    d.y.forEach(function (yv, i) {
      var c = el('circle', { cx: X(i), cy: Y(yv), r: 6, fill: css('--ours'), class: 'pt' });
      c.addEventListener('mouseenter', function () {
        var box = ablSvg.getBoundingClientRect();
        var wrap = ablSvg.parentNode.getBoundingClientRect();
        ablTip.textContent = (ablKind === 'frac' ? Math.round(d.x[i] * 100) + '% of trials' : d.xlabel.split(' ')[1] + ' ' + d.x[i]) +
          '  \u2014  ' + yv.toFixed(4) + ' \u00b1 ' + d.err[i].toFixed(4);
        ablTip.style.left = (box.left - wrap.left + X(i) * box.width / W) + 'px';
        ablTip.style.top = (box.top - wrap.top + Y(yv) * box.height / H) + 'px';
        ablTip.classList.add('on');
      });
      c.addEventListener('mouseleave', function () { ablTip.classList.remove('on'); });
      ablSvg.appendChild(c);
    });

    ablSvg.appendChild(el('text', {
      x: L + 8, y: T + 16, class: 'serieslabel', fill: css('--ours')
    }, ablTarget === 'c' ? 'residual MLP, CLIP c' : 'residual MLP, diffusion z'));

    $('#ablNote').textContent = ABL_NOTE[ablTarget + '-' + ablKind];
  }

  $$('[data-target]').forEach(function (b) {
    b.addEventListener('click', function () {
      ablTarget = b.dataset.target;
      $$('[data-target]').forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
      drawAblation();
    });
  });
  $$('[data-abl]').forEach(function (b) {
    b.addEventListener('click', function () {
      ablKind = b.dataset.abl;
      $$('[data-abl]').forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
      drawAblation();
    });
  });
  drawAblation();

  /* ---------------- PCA scatter ---------------- */

  var pcaSpace = 'c';
  var pcaOn = { gt: true, linear: true, mlp: true };
  var cv = $('#pcaCanvas');

  var PCA_NOTE = {
    c: 'The linear predictions form their own cluster, far from the true CLIP embeddings. The MLP predictions ' +
      'sit inside the true cloud: MMD falls from 0.359 to 0.042, about eight and a half times closer.',
    z: 'All three clouds already overlap. The MLP shifts the spread slightly and MMD gets marginally worse, ' +
      '0.121 to 0.133, which is the distribution drift that shows up later as unchanged texture.'
  };

  function drawPCA() {
    var data = window.B2V_PCA[pcaSpace];
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var wCss = cv.clientWidth || 900;
    var hCss = Math.round(wCss * 0.5);
    cv.width = wCss * dpr; cv.height = hCss * dpr;
    cv.style.height = hCss + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, wCss, hCss);

    var sets = ['gt', 'linear', 'mlp'];
    var all = [];
    sets.forEach(function (s) { if (pcaOn[s]) all = all.concat(data[s]); });
    if (!all.length) all = data.gt;

    var xs = all.map(function (p) { return p[0]; });
    var ys = all.map(function (p) { return p[1]; });
    var pad = 26;
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var sx = (wCss - 2 * pad) / (maxX - minX || 1);
    var sy = (hCss - 2 * pad) / (maxY - minY || 1);
    var sc = Math.min(sx, sy);
    var cx = (wCss - sc * (maxX + minX)) / 2;
    var cy = (hCss + sc * (maxY + minY)) / 2;

    // axes crosshair
    ctx.strokeStyle = css('--rule');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, cy); ctx.lineTo(wCss - pad, cy);
    ctx.moveTo(cx, pad); ctx.lineTo(cx, hCss - pad);
    ctx.stroke();

    var colors = { gt: css('--gt'), linear: css('--linear'), mlp: css('--ours') };
    var style = { gt: { r: 3.0, a: 0.30 }, linear: { r: 1.9, a: 0.50 }, mlp: { r: 1.9, a: 0.50 } };
    ['gt', 'linear', 'mlp'].forEach(function (s) {
      if (!pcaOn[s]) return;
      ctx.fillStyle = colors[s];
      ctx.globalAlpha = style[s].a;
      data[s].forEach(function (p) {
        ctx.beginPath();
        ctx.arc(cx + p[0] * sc, cy - p[1] * sc, style[s].r, 0, 6.2832);
        ctx.fill();
      });
    });
    ctx.globalAlpha = 1;

    ctx.fillStyle = css('--text-soft');
    ctx.font = '12px Lato, sans-serif';
    ctx.fillText('PC 1', wCss - pad - 30, cy - 8);
    ctx.fillText('PC 2', Math.min(Math.max(cx + 8, pad), wCss - pad - 34), pad + 2);
    ctx.fillText(pcaSpace === 'c' ? 'CLIP embedding c, 982 test images'
      : 'diffusion latent z, 982 test images', pad, 16);

    $('#pcaNote').textContent = PCA_NOTE[pcaSpace];
  }

  $$('[data-pca]').forEach(function (b) {
    b.addEventListener('click', function () {
      pcaSpace = b.dataset.pca;
      $$('[data-pca]').forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
      drawPCA();
    });
  });
  $$('#pcaLegend button').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.set;
      pcaOn[k] = !pcaOn[k];
      b.setAttribute('aria-pressed', pcaOn[k]);
      drawPCA();
    });
  });

  /* ---------------- per-subject metrics ---------------- */

  var SUBJ = {
    subj01: { PixCorr: [0.3160, 0.3360], SSIM: [0.2420, 0.3070], LPIPS: [0.7220, 0.6960], CLIP: [0.6640, 0.8540] },
    subj02: { PixCorr: [0.2684, 0.2764], SSIM: [0.2364, 0.3033], LPIPS: [0.7338, 0.7213], CLIP: [0.6563, 0.8468] },
    subj05: { PixCorr: [0.2129, 0.2233], SSIM: [0.2263, 0.3104], LPIPS: [0.7402, 0.7238], CLIP: [0.6715, 0.8619] },
    subj07: { PixCorr: [0.2013, 0.2025], SSIM: [0.2219, 0.2992], LPIPS: [0.7416, 0.7511], CLIP: [0.6532, 0.8183] }
  };
  var METRIC_INFO = {
    PixCorr: ['Pixel correlation', 'higher is better'],
    SSIM: ['Structural similarity', 'higher is better'],
    LPIPS: ['Perceptual distance', 'lower is better'],
    CLIP: ['CLIP semantic similarity', 'higher is better']
  };

  function drawSubject(s) {
    var host = $('#metricBars');
    host.innerHTML = '';
    Object.keys(METRIC_INFO).forEach(function (m) {
      var v = SUBJ[s][m];
      var lower = m === 'LPIPS';
      var better = lower ? v[1] < v[0] : v[1] > v[0];
      var diff = (v[1] - v[0]);
      var wrap = document.createElement('div');
      wrap.className = 'barrow';
      wrap.innerHTML =
        '<div class="barlabel"><span>' + METRIC_INFO[m][0] + ', ' + METRIC_INFO[m][1] + '</span>' +
        '<span class="barval" style="color:' + (better ? 'var(--ours)' : 'var(--text-soft)') + '">' +
        (diff >= 0 ? '+' : '\u2212') + Math.abs(diff).toFixed(4) + '</span></div>' +
        '<div class="bartrack"><div class="barfill ridge" style="width:' + (100 * v[0]) + '%"></div></div>' +
        '<div class="bartrack" style="margin-top:3px"><div class="barfill mlp" style="width:' + (100 * v[1]) + '%"></div></div>' +
        '<div class="barlabel" style="font-size:12px"><span>ridge ' + v[0].toFixed(4) +
        '</span><span>Brain2VLM ' + v[1].toFixed(4) + '</span></div>';
      host.appendChild(wrap);
    });
  }
  $$('#subjSwitch button').forEach(function (b) {
    b.addEventListener('click', function () {
      $$('#subjSwitch button').forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
      drawSubject(b.dataset.subj);
    });
  });
  drawSubject('subj01');

  /* ---------------- figure lightbox ---------------- */

  var lb = $('#lightbox'), lbImg = $('#lightboxImg');
  $$('figure.fig img').forEach(function (im) {
    im.addEventListener('click', function () {
      lbImg.src = im.src; lbImg.alt = im.alt; lb.classList.add('on');
    });
  });
  lb.addEventListener('click', function () { lb.classList.remove('on'); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') lb.classList.remove('on');
  });

  /* ---------------- bibtex ---------------- */

  $('#copyBib').addEventListener('click', function () {
    var txt = $('#bibtex').textContent;
    var done = function () {
      $('#copiedMsg').classList.add('on');
      setTimeout(function () { $('#copiedMsg').classList.remove('on'); }, 1600);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(done, done);
    } else {
      var ta = document.createElement('textarea');
      ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta); done();
    }
  });

  /* ---------------- redraw on theme change and resize ---------------- */

  function redraw() { drawAblation(); drawPCA(); }
  document.addEventListener('themechange', redraw);
  var rt;
  window.addEventListener('resize', function () {
    clearTimeout(rt); rt = setTimeout(redraw, 150);
  });
  drawPCA();

})();
