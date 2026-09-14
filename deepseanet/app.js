/* ==========================================================
   DeepSeaNet project page
   Sources for every number:
   - PAPER.*      tables printed in the paper (arXiv 2306.06075v2)
   - REPO.*       logs committed in github.com/s4nyam/efficientdet-advml
   - DSN_DATA     per-epoch logs parsed by the build script (data.js)
   The water and UAP panels are labelled illustrations.
   ========================================================== */

(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = 'http://www.w3.org/2000/svg';
  var D = window.DSN_DATA;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function el(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fmt(v, d) { return v.toFixed(d === undefined ? 3 : d); }
  function group(root, attr, fn) {
    var btns = $$('button[' + attr + ']', root);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (o) { o.setAttribute('aria-pressed', o === b); });
        fn(b.getAttribute(attr), b);
      });
    });
  }
  function onKeyActivate(node, fn) {
    node.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
  }
  // Position a tooltip inside a .chartbox from SVG coordinates.
  function placeTip(tip, svg, vbW, vbH, x, y, html) {
    var box = svg.getBoundingClientRect(), wrap = svg.parentNode.getBoundingClientRect();
    tip.innerHTML = html;
    var px = box.left - wrap.left + x * box.width / vbW;
    var tw = tip.offsetWidth || 160;
    px = Math.max(tw / 2 + 4, Math.min(wrap.width - tw / 2 - 4, px));
    tip.style.left = px + 'px';
    tip.style.top = (box.top - wrap.top + y * box.height / vbH) + 'px';
    tip.classList.add('on');
  }

  var MODEL_VAR = { effdet: '--effdet', yolov5: '--yolov5', yolov8: '--yolov8', d2: '--d2', old: '--old' };
  var CLASSES = ['fish', 'small fish', 'crab', 'shrimp', 'jellyfish', 'starfish'];

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

  /* ---------------- hero ---------------- */

  var NPAIR = D.frames.pairs.length, NED = D.frames.effdet;
  var pad2 = function (i) { return (i < 10 ? '0' : '') + i; };
  var frame = function (kind, i) { return 'assets/frames/' + kind + '_' + pad2(i) + '.jpg'; };

  (function () {
    var i = 0, timer = null, btn = $('#heroPlay');
    for (var p = 0; p < NPAIR; p++) { new Image().src = frame('v5', p); new Image().src = frame('v8', p); }
    for (var q = 0; q < NED; q++) { new Image().src = frame('ed', q); }
    function show(k) {
      i = k;
      $('#heroEd').src = frame('ed', k % NED);
      $('#heroV5').src = frame('v5', k % NPAIR);
      $('#heroV8').src = frame('v8', k % NPAIR);
    }
    function start() { if (!timer) { timer = setInterval(function () { show(i + 1); }, 2800); btn.textContent = 'Pause'; } }
    function stop() { clearInterval(timer); timer = null; btn.textContent = 'Play'; }
    btn.addEventListener('click', function () { timer ? stop() : start(); });
    show(0);
    if (reduceMotion) stop(); else start();
  })();

  /* ---------------- 1. water playground ---------------- */

  (function () {
    var cv = $('#waterCanvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    var W = cv.width, H = cv.height, N = W * H;
    var cache = {}, current = 'crab', pending = false;
    var sliders = { turb: $('#wTurb'), snow: $('#wSnow'), light: $('#wLight'), noise: $('#wNoise'), enh: $('#wEnh') };
    var outs = { turb: $('#oTurb'), snow: $('#oSnow'), light: $('#oLight'), noise: $('#oNoise'), enh: $('#oEnh') };
    var PRESETS = {
      clear: { turb: 0, snow: 0, light: 0, noise: 0, enh: 70 },
      asis: { turb: 0, snow: 0, light: 0, noise: 0, enh: 0 },
      silt: { turb: 72, snow: 65, light: 15, noise: 12, enh: 0 },
      night: { turb: 25, snow: 10, light: 80, noise: 45, enh: 0 }
    };

    // deterministic noise so the picture does not flicker while dragging
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var gauss = new Float32Array(N);
    for (var g = 0; g < N; g++) {
      var u = rnd() || 1e-9, v = rnd();
      gauss[g] = Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * v);
    }
    var flakes = [];
    for (var f = 0; f < 420; f++) flakes.push({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 2.6, a: 0.25 + rnd() * 0.6 });
    var vign = new Float32Array(N);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var dx = (x - W * 0.45) / W, dy = (y - H * 0.18) / H;
      vign[y * W + x] = Math.min(1, (dx * dx + dy * dy) * 2.4);
    }

    function prepare(name, done) {
      if (cache[name]) return done(cache[name]);
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, W, H);
        var base = ctx.getImageData(0, 0, W, H).data.slice();
        // cheap blur: downsample then upsample
        var tmp = document.createElement('canvas'); tmp.width = W / 12; tmp.height = H / 12;
        var t = tmp.getContext('2d'); t.imageSmoothingEnabled = true; t.drawImage(img, 0, 0, tmp.width, tmp.height);
        ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, W, H);
        var blur = ctx.getImageData(0, 0, W, H).data.slice();
        // per-channel 1st and 99th percentile for the contrast stretch
        var lo = [], hi = [];
        for (var c = 0; c < 3; c++) {
          var hist = new Uint32Array(256);
          for (var i = c; i < base.length; i += 4) hist[base[i]]++;
          var acc = 0, l = 0, h = 255;
          for (var b = 0; b < 256; b++) { acc += hist[b]; if (acc > N * 0.01) { l = b; break; } }
          acc = 0;
          for (var b2 = 255; b2 >= 0; b2--) { acc += hist[b2]; if (acc > N * 0.01) { h = b2; break; } }
          lo.push(l); hi.push(Math.max(h, l + 1));
        }
        cache[name] = { base: base, blur: blur, lo: lo, hi: hi, rms: rmsContrast(base) };
        done(cache[name]);
      };
      img.src = 'assets/raw/' + name + '.jpg';
    }

    function rmsContrast(px) {
      var n = 0, s = 0, s2 = 0;
      for (var i = 0; i < px.length; i += 16) {
        var Y = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        s += Y; s2 += Y * Y; n++;
      }
      var m = s / n;
      return Math.sqrt(Math.max(0, s2 / n - m * m));
    }

    function val(k) { return +sliders[k].value / 100; }

    function render() {
      pending = false;
      prepare(current, function (d) {
        var t = val('turb'), sn = val('snow'), li = val('light'), no = val('noise'), en = val('enh');
        var out = ctx.createImageData(W, H), o = out.data, b = d.base, bl = d.blur;
        var water = [86, 118, 96];
        var mixT = 0.78 * t, blurT = 0.7 * t, sig = 42 * no;
        for (var p = 0, i = 0; p < N; p++, i += 4) {
          var fall = 1 - li * (0.25 + 0.75 * vign[p]);
          var nz = gauss[p] * sig;
          for (var c = 0; c < 3; c++) {
            var v = b[i + c];
            if (en > 0) v = v + en * (((v - d.lo[c]) * 255 / (d.hi[c] - d.lo[c])) - v);
            v = v + blurT * (bl[i + c] - v);
            v = v + mixT * (water[c] - v);
            v = v * fall + nz;
            o[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
          o[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        var count = Math.round(sn * flakes.length);
        for (var k = 0; k < count; k++) {
          var fl = flakes[k];
          ctx.beginPath();
          ctx.fillStyle = 'rgba(235,240,225,' + (fl.a * (0.5 + 0.5 * sn)).toFixed(3) + ')';
          ctx.arc(fl.x, fl.y, fl.r * (1 + t), 0, 6.2832);
          ctx.fill();
        }
        var rms = rmsContrast(ctx.getImageData(0, 0, W, H).data);
        var MAX = 0.32;
        $('#wContrast').textContent = fmt(rms, 3) + '  (' + (rms >= d.rms ? '+' : '−') + Math.abs(Math.round(100 * (rms / d.rms - 1))) + '% vs recorded)';
        $('#wContrastBar').style.width = Math.min(100, 100 * rms / MAX) + '%';
        $('#wContrastGhost').style.width = Math.min(100, 100 * d.rms / MAX) + '%';
      });
    }
    function schedule() { if (!pending) { pending = true; requestAnimationFrame(render); } }

    Object.keys(sliders).forEach(function (k) {
      sliders[k].addEventListener('input', function () {
        outs[k].textContent = sliders[k].value;
        $$('#waterPresets button').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        schedule();
      });
    });
    group($('#waterPresets'), 'data-preset', function (name) {
      var p = PRESETS[name];
      Object.keys(p).forEach(function (k) { sliders[k].value = p[k]; outs[k].textContent = p[k]; });
      schedule();
    });
    group($('#waterThumbs'), 'data-raw', function (name) { current = name; schedule(); });
    schedule();
  })();

  /* ---------------- 2. dataset counts ---------------- */

  (function () {
    var VIEWS = {
      v8: {
        kicker: 'Validation split of the Roboflow release, 2,000 frames',
        verdict: 'Crabs outnumber shrimp 19 to 1.',
        body: '5,465 boxes in 2,000 frames. Crabs and starfish dominate because they sit in view for long stretches; ' +
          'shrimp and jellyfish drift through only occasionally, so a detector sees few examples of them.',
        src: 'Instances column of the YOLOv8s validation log, 2_YOLO8_Experiment.',
        labels: CLASSES, values: [637, 1421, 1933, 101, 129, 1244]
      },
      v5: {
        kicker: 'Validation split built in the YOLOv5 notebook, 1,506 frames',
        verdict: 'A different split, the same imbalance.',
        body: '3,353 boxes. Small fish are the most common class here, and shrimp and jellyfish together still make up ' +
          'under 3% of all boxes.',
        src: 'Instances column of the YOLOv5s validation log, 1_YOLO5_Experiment.',
        labels: CLASSES, values: [318, 1124, 1097, 51, 48, 715]
      },
      paper: {
        kicker: 'Frames per video category, before and after cleaning',
        verdict: 'Each category keeps about 69% of its frames.',
        body: 'The paper counts frames by the folder their video came from. Frames with no annotation or no visibility were ' +
          'removed. Dashed outlines show the count before cleaning.',
        src: 'Paper, Figure 5 and Table 3.',
        labels: ['crab', 'fish-big', 'fish-school', 'fish-small', 'shrimp', 'jellyfish'],
        values: [1751, 2992, 927, 2268, 824, 1237], before: [2542, 4339, 1346, 3290, 1196, 1794]
      }
    };
    function draw(view) {
      var d = VIEWS[view], host = $('#classBars');
      var max = Math.max.apply(null, (d.before || d.values));
      var total = d.values.reduce(function (a, b) { return a + b; }, 0);
      host.innerHTML = '';
      d.labels.forEach(function (lab, i) {
        var row = document.createElement('div');
        row.className = 'barrow';
        var extra = d.before ? ' <span style="color:var(--text-mute)">of ' + d.before[i].toLocaleString() + '</span>'
          : ' <span style="color:var(--text-mute)">' + (100 * d.values[i] / total).toFixed(1) + '%</span>';
        row.innerHTML = '<div class="barlabel"><span><b>' + lab + '</b></span><span class="barval">' +
          d.values[i].toLocaleString() + extra + '</span></div>' +
          '<div class="bartrack"><div class="barfill"></div>' + (d.before ? '<div class="barfill ghost"></div>' : '') + '</div>';
        host.appendChild(row);
        requestAnimationFrame(function () {
          row.querySelector('.barfill').style.width = (100 * d.values[i] / max) + '%';
          if (d.before) row.querySelector('.ghost').style.width = (100 * d.before[i] / max) + '%';
        });
      });
      $('#classKicker').textContent = d.kicker;
      $('#classVerdict').textContent = d.verdict;
      $('#classBody').textContent = d.body;
      $('#classSrc').textContent = 'Source: ' + d.src;
    }
    group($('#classSwitch'), 'data-view', draw);
    draw('v8');
  })();

  /* ---------------- 2b. preprocessing steps + annotation formats ---------------- */

  (function () {
    var steps = $$('#prepSteps li');
    steps.forEach(function (li, i) {
      li.tabIndex = 0;
      var pick = function () { steps.forEach(function (o) { o.setAttribute('aria-current', o === li); }); };
      li.addEventListener('click', pick);
      onKeyActivate(li, pick);
    });

    var IW = 960, IH = 540;
    var box = { x1: 104, y1: 262, x2: 322, y2: 482 };
    var fmtName = 'yolo';
    var host = $('#annot'), bx = $('#annBox'), grip = $('#annGrip');

    function renderBox() {
      bx.style.left = (100 * box.x1 / IW) + '%';
      bx.style.top = (100 * box.y1 / IH) + '%';
      bx.style.width = (100 * (box.x2 - box.x1) / IW) + '%';
      bx.style.height = (100 * (box.y2 - box.y1) / IH) + '%';
      $('#annCx').style.top = (100 * (box.y1 + box.y2) / 2 / IH) + '%';
      $('#annCy').style.left = (100 * (box.x1 + box.x2) / 2 / IW) + '%';
      var x1 = Math.round(box.x1), y1 = Math.round(box.y1), x2 = Math.round(box.x2), y2 = Math.round(box.y2);
      var w = x2 - x1, h = y2 - y1, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      var out, note;
      if (fmtName === 'yolo') {
        out = '<span class="c"># class  x_center  y_center  width  height   (fractions of 960 x 540)</span>\n' +
          '<span class="k">2</span>  ' + fmt(cx / IW, 4) + '  ' + fmt(cy / IH, 4) + '  ' + fmt(w / IW, 4) + '  ' + fmt(h / IH, 4) + '\n\n' +
          '<span class="c"># the same box before normalisation, in pixels</span>\n' +
          '<span class="c"># 2  ' + cx.toFixed(1) + '  ' + cy.toFixed(1) + '  ' + w + '  ' + h + '</span>';
        note = 'One text file per frame, one line per box. Read by YOLOv5 (class ids 0–5, crab = 2) and YOLOv8.';
      } else if (fmtName === 'coco') {
        out = '{\n  <span class="k">"image_id"</span>: 1,\n  <span class="k">"category_id"</span>: 3,\n' +
          '  <span class="k">"bbox"</span>: [' + x1 + ', ' + y1 + ', ' + w + ', ' + h + '],   <span class="c">// x_min, y_min, width, height</span>\n' +
          '  <span class="k">"area"</span>: ' + (w * h) + ',\n  <span class="k">"iscrowd"</span>: 0\n}';
        note = 'One JSON file for the whole split. Read by Detectron2. Pixel units; the Roboflow export numbers classes from 1, so crab = 3.';
      } else {
        out = '&lt;object&gt;\n  &lt;name&gt;<span class="k">3</span>&lt;/name&gt;\n  &lt;bndbox&gt;\n' +
          '    &lt;xmin&gt;' + x1 + '&lt;/xmin&gt; &lt;ymin&gt;' + y1 + '&lt;/ymin&gt;\n' +
          '    &lt;xmax&gt;' + x2 + '&lt;/xmax&gt; &lt;ymax&gt;' + y2 + '&lt;/ymax&gt;\n  &lt;/bndbox&gt;\n&lt;/object&gt;';
        note = 'One XML file per frame. Read by TFLite Model Maker for EfficientDet-Lite0 through DataLoader.from_pascal_voc. Corner coordinates in pixels.';
      }
      $('#fmtOut').innerHTML = out;
      $('#fmtNote').textContent = note;
    }

    var drag = null;
    function toImg(e) {
      var r = host.getBoundingClientRect();
      return { x: (e.clientX - r.left) * IW / r.width, y: (e.clientY - r.top) * IH / r.height };
    }
    function down(kind) {
      return function (e) {
        e.preventDefault(); e.stopPropagation();
        var p = toImg(e);
        drag = { kind: kind, sx: p.x, sy: p.y, b: { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 } };
        host.setPointerCapture(e.pointerId);
      };
    }
    bx.addEventListener('pointerdown', down('move'));
    grip.addEventListener('pointerdown', down('size'));
    host.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = toImg(e), dx = p.x - drag.sx, dy = p.y - drag.sy, b = drag.b;
      if (drag.kind === 'move') {
        var w = b.x2 - b.x1, h = b.y2 - b.y1;
        box.x1 = Math.max(0, Math.min(IW - w, b.x1 + dx)); box.y1 = Math.max(0, Math.min(IH - h, b.y1 + dy));
        box.x2 = box.x1 + w; box.y2 = box.y1 + h;
      } else {
        box.x2 = Math.max(b.x1 + 16, Math.min(IW, b.x2 + dx));
        box.y2 = Math.max(b.y1 + 16, Math.min(IH, b.y2 + dy));
      }
      renderBox();
    });
    ['pointerup', 'pointercancel'].forEach(function (t) { host.addEventListener(t, function () { drag = null; }); });
    bx.tabIndex = 0;
    bx.setAttribute('role', 'application');
    bx.setAttribute('aria-label', 'Annotation box. Arrow keys move it, shift and arrows resize it.');
    bx.addEventListener('keydown', function (e) {
      var s = 8, dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -s; else if (e.key === 'ArrowRight') dx = s;
      else if (e.key === 'ArrowUp') dy = -s; else if (e.key === 'ArrowDown') dy = s; else return;
      e.preventDefault();
      if (e.shiftKey) { box.x2 = Math.max(box.x1 + 16, Math.min(IW, box.x2 + dx)); box.y2 = Math.max(box.y1 + 16, Math.min(IH, box.y2 + dy)); }
      else {
        var w = box.x2 - box.x1, h = box.y2 - box.y1;
        box.x1 = Math.max(0, Math.min(IW - w, box.x1 + dx)); box.y1 = Math.max(0, Math.min(IH - h, box.y1 + dy));
        box.x2 = box.x1 + w; box.y2 = box.y1 + h;
      }
      renderBox();
    });
    group($('#fmtSwitch'), 'data-fmt', function (f) { fmtName = f; renderBox(); });
    renderBox();
  })();

  /* ---------------- 3. pipeline stepper ---------------- */

  (function () {
    var STEPS = [
      { name: 'A frame goes in', change: 'Unchanged from EfficientDet.',
        body: 'Frames are stored at 960×540. Each toolkit resizes to its own input: 320×320 for EfficientDet-Lite0, 416 for ' +
          'YOLOv5s and 800 for YOLOv8s in the committed runs. The Roboflow release adds rotation, flip, crop and scale augmentation.' },
      { name: 'The backbone extracts features', change: 'Proposed: Swish activations in the MBConv blocks.',
        body: 'EfficientNet stacks MBConv blocks and scales depth, width and resolution together. It emits feature maps at five ' +
          'strides, P3 (1/8 of the frame) to P7 (1/128). Early maps hold edges, colour, fins and scales; late maps hold body shape.' },
      { name: 'The neck fuses scales', change: 'Proposed: BiSkFPN, with deconvolution maps and skip connections.',
        body: 'The neck mixes the five maps so that small animals get context from coarse levels and large animals get detail from ' +
          'fine ones. EfficientDet uses BiFPN: repeated top-down and bottom-up passes with learned fusion weights.' },
      { name: 'The head predicts', change: 'Proposed: a multi-focal-loss head trained on cls + α·box + β·L2.',
        body: 'Two small networks are shared across all levels. For every anchor box the class net scores six species and the box ' +
          'net regresses four offsets.' },
      { name: 'Boxes come out', change: 'Unchanged from EfficientDet.',
        body: 'Thousands of anchor predictions are filtered by confidence and merged by non-maximum suppression, leaving one box per ' +
          'animal with a class and a score.' }
    ];
    var step = 0;

    var bb = $('#bbBars');
    [52, 42, 32, 22, 14].forEach(function (h, i) {
      bb.appendChild(el('rect', { x: 216 + i * 26, y: 142 - h, width: 18, height: h, fill: 'var(--navy-soft)', opacity: (0.45 + i * 0.12).toFixed(2), rx: 2 }));
    });
    var nm = $('#neckMini');
    for (var c = 0; c < 3; c++) for (var r = 0; r < 4; r++) {
      nm.appendChild(el('circle', { cx: 420 + c * 50, cy: 106 + r * 17, r: 6, fill: c === 1 ? 'var(--d2)' : 'var(--cyan)', opacity: 0.85 }));
    }
    for (var r2 = 0; r2 < 3; r2++) {
      nm.appendChild(el('path', { d: 'M420,' + (106 + r2 * 17) + ' L470,' + (106 + (r2 + 1) * 17) + ' L520,' + (106 + r2 * 17), fill: 'none', stroke: 'var(--rule-strong)', 'stroke-width': 1.2 }));
    }

    function set(i) {
      step = Math.max(0, Math.min(STEPS.length - 1, i));
      $$('.stepper .stage').forEach(function (g) {
        var on = +g.dataset.step === step;
        g.classList.toggle('active', on); g.classList.toggle('dim', !on);
      });
      $('#stepName').textContent = STEPS[step].name;
      $('#stepBody').textContent = STEPS[step].body;
      $('#stepChange').textContent = STEPS[step].change;
      $('#pipeCount').textContent = 'Stage ' + (step + 1) + ' of ' + STEPS.length;
      $('#stepPrev').disabled = step === 0;
      $('#stepNext').textContent = step === STEPS.length - 1 ? 'Start again' : 'Next stage';
    }
    $('#stepPrev').addEventListener('click', function () { set(step - 1); });
    $('#stepNext').addEventListener('click', function () { set(step === STEPS.length - 1 ? 0 : step + 1); });
    $$('.stepper .stage').forEach(function (g) {
      g.addEventListener('click', function () { set(+g.dataset.step); });
      onKeyActivate(g, function () { set(+g.dataset.step); });
    });
    set(0);
  })();

  /* ---------------- 3b. neck explorer ---------------- */

  (function () {
    var svg = $('#neckSvg'), panel = $('#neckPanel');
    var LV = [7, 6, 5, 4, 3];
    var Y = function (l) { return 42 + (7 - l) * 70; };
    var COL = { in: 50, mid: 250, out: 450 };

    var TYPES = {
      in: { label: 'backbone input', fill: 'var(--panel)', stroke: 'var(--rule-strong)' },
      td: { label: 'top-down fusion', fill: 'var(--navy-soft)', stroke: 'var(--navy-soft)' },
      dc: { label: 'deconv + concat', fill: 'var(--d2)', stroke: 'var(--d2)' },
      out: { label: 'output', fill: 'var(--cyan)', stroke: 'var(--cyan)' }
    };
    var ETYPES = {
      lat: { label: 'same level', color: '--text-mute' },
      down: { label: 'top-down (upsample)', color: '--yolov8' },
      up: { label: 'bottom-up (downsample)', color: '--effdet' },
      skip: { label: 'skip connection', color: '--yolov5', dash: true }
    };

    function build(kind) {
      var nodes = [], edges = [];
      var N = function (id, type, col, l) { nodes.push({ id: id, type: type, x: COL[col], y: Y(l), l: l }); };
      var E = function (a, b, t) { edges.push({ a: a, b: b, t: t }); };
      LV.forEach(function (l) { N('in' + l, 'in', 'in', l); });
      if (kind === 'fpn') {
        LV.forEach(function (l) { N('out' + l, 'out', 'out', l); E('in' + l, 'out' + l, 'lat'); if (l < 7) E('out' + (l + 1), 'out' + l, 'down'); });
      } else if (kind === 'panet') {
        LV.forEach(function (l) { N('td' + l, 'td', 'mid', l); N('out' + l, 'out', 'out', l); });
        LV.forEach(function (l) {
          E('in' + l, 'td' + l, 'lat'); if (l < 7) E('td' + (l + 1), 'td' + l, 'down');
          E('td' + l, 'out' + l, 'lat'); if (l > 3) E('out' + (l - 1), 'out' + l, 'up');
        });
      } else if (kind === 'bifpn') {
        [6, 5, 4].forEach(function (l) { N('td' + l, 'td', 'mid', l); });
        LV.forEach(function (l) { N('out' + l, 'out', 'out', l); });
        E('in6', 'td6', 'lat'); E('in7', 'td6', 'down');
        E('in5', 'td5', 'lat'); E('td6', 'td5', 'down');
        E('in4', 'td4', 'lat'); E('td5', 'td4', 'down');
        E('in3', 'out3', 'lat'); E('td4', 'out3', 'down');
        [4, 5, 6].forEach(function (l) { E('in' + l, 'out' + l, 'skip'); E('td' + l, 'out' + l, 'lat'); E('out' + (l - 1), 'out' + l, 'up'); });
        E('in7', 'out7', 'skip'); E('out6', 'out7', 'up');
      } else {
        LV.forEach(function (l) { N('dc' + l, 'dc', 'mid', l); N('out' + l, 'out', 'out', l); });
        LV.forEach(function (l) {
          E('in' + l, 'dc' + l, 'lat');
          if (l < 7) E('dc' + (l + 1), 'dc' + l, 'down');
          if (l > 3 && l < 7) E('in' + (l - 1), 'dc' + l, 'skip');
          E('dc' + l, 'out' + l, 'lat');
        });
      }
      return { nodes: nodes, edges: edges };
    }

    var INFO = {
      fpn: { kicker: 'FPN · Lin et al., 2017', verdict: 'Top-down only.',
        body: 'Coarse, semantically strong maps are upsampled and added to finer ones. Information flows one way, so the P7 output never sees the detail in P3.',
        eq: 'out[l] = Conv( in[l] + Resize(out[l+1]) )' },
      panet: { kicker: 'PANet · Liu et al., 2018 · used in YOLOv5', verdict: 'Adds a way back up.',
        body: 'A second, bottom-up pass carries localisation detail from fine to coarse levels, so every output can draw on every input, at the cost of a whole extra column of nodes.',
        eq: 'td[l]  = Conv( in[l] + Resize(td[l+1]) )\nout[l] = Conv( td[l] + Resize(out[l-1]) )' },
      bifpn: { kicker: 'BiFPN · Tan, Pang and Le, 2020 · EfficientDet', verdict: 'Prune, shortcut, weigh.',
        body: 'Intermediate nodes with a single input are dropped, an extra edge joins each input directly to its output, and every fusion learns non-negative weights. The block is stacked several times.',
        eq: 'td[l]  = Conv( (w1·in[l] + w2·Resize(td[l+1])) / (w1 + w2 + ε) )\nout[l] = Conv( (w1·in[l] + w2·td[l] + w3·Resize(out[l-1]))\n               / (w1 + w2 + w3 + ε) )\nweights w ≥ 0 are learned per fusion node' },
      biskfpn: { kicker: 'BiSkFPN · proposed in the paper, Algorithm 4', verdict: 'Deconvolve, concatenate, skip.',
        body: 'Coarse maps are upsampled with learned deconvolutions and concatenated with the next finer level; a skip connection then adds the map from one level finer still. The paper argues this preserves low-level detail that murky water erodes, more cheaply than attention.',
        eq: 'F ← concat( P[n], deconv(P[n]) )\nfor i = n-1 down to 1:\n    F ← concat( P[i], deconv(F) )\n    F ← F + skip( P[i-1] )' }
    };

    var kind = 'bifpn', G = null;

    function pathFor(a, b) {
      if (a.x === b.x) {           // vertical edge in one column: bow it outwards
        var bow = a.x === COL.out ? 34 : -34;
        var my = (a.y + b.y) / 2;
        return 'M' + a.x + ',' + a.y + ' Q' + (a.x + bow) + ',' + my + ' ' + b.x + ',' + b.y;
      }
      if (a.y === b.y && Math.abs(a.x - b.x) > 250) {  // long same-level skip: arc over
        var mx = (a.x + b.x) / 2;
        return 'M' + a.x + ',' + a.y + ' Q' + mx + ',' + (a.y - 30) + ' ' + b.x + ',' + b.y;
      }
      return 'M' + a.x + ',' + a.y + ' L' + b.x + ',' + b.y;
    }

    function draw() {
      G = build(kind);
      clear(svg);
      var defs = el('defs');
      Object.keys(ETYPES).forEach(function (t) {
        var m = el('marker', { id: 'nk-' + t, viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
        m.appendChild(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(' + ETYPES[t].color + ')' }));
        defs.appendChild(m);
      });
      svg.appendChild(defs);
      LV.forEach(function (l) { svg.appendChild(el('text', { x: 6, y: Y(l) - 20, class: 'ticktext' }, 'P' + l + (l === 3 ? '  1/8' : l === 7 ? '  1/128' : ''))); });
      svg.appendChild(el('text', { x: COL.in, y: 350, class: 'ticktext', 'text-anchor': 'middle' }, 'from backbone'));
      svg.appendChild(el('text', { x: COL.out, y: 350, class: 'ticktext', 'text-anchor': 'middle' }, 'to head'));

      var byId = {};
      G.nodes.forEach(function (n) { byId[n.id] = n; });
      G.edges.forEach(function (e) {
        var a = byId[e.a], b = byId[e.b];
        // shorten the line so the arrow stops at the node rim
        var d = pathFor(a, b);
        var p = el('path', { d: d, class: 'nedge' + (ETYPES[e.t].dash ? ' skip' : ''), stroke: 'var(' + ETYPES[e.t].color + ')', 'marker-end': 'url(#nk-' + e.t + ')' });
        e.node = p;
        svg.appendChild(p);
      });
      // trim path ends by drawing nodes on top; offset arrow using stroke-dash trick is overkill, use node radius padding
      G.nodes.forEach(function (n) {
        var t = TYPES[n.type];
        var c = el('circle', { cx: n.x, cy: n.y, r: 15, fill: t.fill, stroke: t.stroke, class: 'nnode', tabindex: n.type === 'out' ? 0 : -1 });
        n.node = c;
        svg.appendChild(c);
        if (n.type === 'in' || n.type === 'out') svg.appendChild(el('text', { x: n.x, y: n.y + 4, class: 'nlabel', 'text-anchor': 'middle' }, n.l));
        if (n.type === 'out') {
          var go = function () { trace(n.id); };
          c.addEventListener('mouseenter', go); c.addEventListener('focus', go); c.addEventListener('click', go);
          c.addEventListener('mouseleave', untrace); c.addEventListener('blur', untrace);
        }
      });
      // pull edge ends back to the rim of the target node
      G.edges.forEach(function (e) {
        var p = e.node, len = p.getTotalLength();
        p.setAttribute('stroke-dasharray', (ETYPES[e.t].dash ? '5 4' : len) + '');
        if (!ETYPES[e.t].dash) { p.setAttribute('stroke-dasharray', (len - 17) + ' 1000'); }
        else {
          // rebuild a dashed pattern that ends before the rim
          var pat = [], acc = 0; while (acc + 9 < len - 17) { pat.push(5, 4); acc += 9; }
          pat.push(Math.max(0, len - 17 - acc), 1000);
          p.setAttribute('stroke-dasharray', pat.join(' '));
        }
      });

      var info = INFO[kind];
      var fusion = G.nodes.filter(function (n) { return n.type !== 'in'; }).length;
      $('#neckKicker').textContent = info.kicker + '  ·  ' + fusion + ' nodes, ' + G.edges.length + ' edges';
      $('#neckVerdict').textContent = info.verdict;
      $('#neckBody').textContent = info.body;
      $('#neckEq').textContent = info.eq;
      $('#neckTrace').textContent = 'Hover or tap a teal output node to trace which backbone levels reach it.';

      var used = {};
      G.nodes.forEach(function (n) { used[n.type] = 1; });
      G.edges.forEach(function (e) { used['e' + e.t] = 1; });
      var lg = $('#neckLegend');
      lg.innerHTML = '';
      Object.keys(TYPES).forEach(function (t) {
        if (!used[t]) return;
        lg.insertAdjacentHTML('beforeend', '<span><i class="swatch" style="border-radius:50%;background:' + TYPES[t].fill + ';border:2px solid ' + TYPES[t].stroke + '"></i>' + TYPES[t].label + '</span>');
      });
      Object.keys(ETYPES).forEach(function (t) {
        if (!used['e' + t]) return;
        lg.insertAdjacentHTML('beforeend', '<span><i class="swatch line" style="background:var(' + ETYPES[t].color + ')"></i>' + ETYPES[t].label + '</span>');
      });
    }

    function trace(id) {
      var lit = {}, litE = [];
      var stack = [id];
      while (stack.length) {
        var cur = stack.pop();
        if (lit[cur]) continue;
        lit[cur] = 1;
        G.edges.forEach(function (e) { if (e.b === cur) { litE.push(e); stack.push(e.a); } });
      }
      panel.classList.add('tracing');
      G.nodes.forEach(function (n) { n.node.classList.toggle('lit', !!lit[n.id]); });
      G.edges.forEach(function (e) { e.node.classList.toggle('lit', litE.indexOf(e) >= 0); });
      var levels = LV.filter(function (l) { return lit['in' + l]; }).sort();
      var hops = 0;
      $('#neckTrace').innerHTML = '<b>P' + id.replace('out', '') + ' output</b> draws on backbone level' + (levels.length > 1 ? 's ' : ' ') +
        levels.map(function (l) { return 'P' + l; }).join(', ') + ' through ' + litE.length + ' edges.';
    }
    function untrace() {
      panel.classList.remove('tracing');
      G.nodes.forEach(function (n) { n.node.classList.remove('lit'); });
      G.edges.forEach(function (e) { e.node.classList.remove('lit'); });
    }

    group($('#neckSwitch'), 'data-neck', function (k) { kind = k; draw(); });
    draw();
  })();

  /* ---------------- 3c. MBConv counter ---------------- */

  (function () {
    var ids = { C: '#mbC', O: '#mbOut', T: '#mbT', K: '#mbK' };
    function num(n) { return n.toLocaleString(); }
    function update() {
      var C = +$(ids.C).value, O = +$(ids.O).value, t = +$(ids.T).value, k = +$(ids.K).value;
      $('#oC').textContent = C; $('#oOut').textContent = O; $('#oT').textContent = t; $('#oK').textContent = k;
      var E = t * C;
      var plain = k * k * C * O;
      var wide = k * k * E * E;
      var expand = t > 1 ? C * E : 0, dw = k * k * E, proj = E * O;
      var mb = expand + dw + proj;
      var rows = [
        ['Plain ' + k + '×' + k + ' conv, ' + C + ' → ' + O, plain, 'var(--old)'],
        ['Plain ' + k + '×' + k + ' conv at the expanded width, ' + E + ' → ' + E, wide, 'var(--old)'],
        ['MBConv: expand ' + num(expand) + ' + depthwise ' + num(dw) + ' + project ' + num(proj), mb, 'var(--navy-soft)']
      ];
      var max = Math.max(plain, wide, mb);
      var host = $('#mbBars');
      host.innerHTML = '';
      rows.forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'barrow';
        d.innerHTML = '<div class="barlabel"><span>' + r[0] + '</span><span class="barval">' + num(r[1]) + '</span></div>' +
          '<div class="bartrack"><div class="barfill" style="width:' + Math.max(0.6, 100 * r[1] / max) + '%;background:' + r[2] + '"></div></div>';
        host.appendChild(d);
      });
      var vsWide = wide / mb, vsPlain = plain / mb;
      $('#mbNote').textContent = 'Weights only, no biases, batch norm or squeeze-and-excitation. MBConv works in a ' + E +
        '-channel space for ' + (vsWide >= 1 ? fmt(vsWide, 1) + '× fewer' : fmt(1 / vsWide, 1) + '× more') +
        ' weights than a plain conv of that width would need, and ' +
        (vsPlain >= 1 ? fmt(vsPlain, 1) + '× fewer' : fmt(1 / vsPlain, 1) + '× more') + ' than a plain ' + k + '×' + k +
        ' conv at the input width. The depthwise step is what keeps large kernels cheap.';
    }
    Object.keys(ids).forEach(function (k) { $(ids[k]).addEventListener('input', update); });
    update();
  })();

  /* ---------------- 3d. Swish vs ReLU ---------------- */

  (function () {
    var svg = $('#swSvg'), tip = $('#swTip');
    var W = 420, H = 260, L = 38, R = 14, T = 14, B = 30;
    var mode = 'f';
    var sig = function (z) { return 1 / (1 + Math.exp(-z)); };
    var relu = function (x) { return Math.max(0, x); };
    var drelu = function (x) { return x > 0 ? 1 : 0; };
    var swish = function (x, b) { return x * sig(b * x); };
    var dswish = function (x, b) { var s = sig(b * x); return s + b * x * s * (1 - s); };

    function draw() {
      var beta = +$('#swB').value;
      $('#oB').textContent = beta.toFixed(2);
      var x0 = -5, x1 = 5;
      var y0 = mode === 'f' ? -1 : -0.2, y1 = mode === 'f' ? 5 : 1.25;
      var X = function (x) { return L + (W - L - R) * (x - x0) / (x1 - x0); };
      var Yf = function (y) { return T + (H - T - B) * (1 - (y - y0) / (y1 - y0)); };
      clear(svg);
      var ticks = mode === 'f' ? [-1, 0, 1, 2, 3, 4, 5] : [0, 0.25, 0.5, 0.75, 1, 1.25];
      ticks.forEach(function (v) {
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: Yf(v), y2: Yf(v), class: v === 0 ? 'axisline' : 'gridline' }));
        svg.appendChild(el('text', { x: L - 6, y: Yf(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v));
      });
      [-4, -2, 0, 2, 4].forEach(function (v) {
        svg.appendChild(el('text', { x: X(v), y: H - 10, class: 'ticktext', 'text-anchor': 'middle' }, v));
      });
      svg.appendChild(el('line', { x1: X(0), x2: X(0), y1: T, y2: H - B, class: 'gridline' }));
      var fr = mode === 'f' ? relu : drelu;
      var fs = mode === 'f' ? function (x) { return swish(x, beta); } : function (x) { return dswish(x, beta); };
      function path(fn) {
        var d = '';
        for (var i = 0; i <= 200; i++) {
          var x = x0 + (x1 - x0) * i / 200, y = Math.max(y0 - 0.5, Math.min(y1 + 0.5, fn(x)));
          d += (i ? 'L' : 'M') + X(x).toFixed(1) + ',' + Yf(y).toFixed(1);
        }
        return d;
      }
      var clip = el('clipPath', { id: 'swClip' }); clip.appendChild(el('rect', { x: L, y: T, width: W - L - R, height: H - T - B }));
      var defs = el('defs'); defs.appendChild(clip); svg.appendChild(defs);
      var g = el('g', { 'clip-path': 'url(#swClip)' });
      g.appendChild(el('path', { d: path(fr), fill: 'none', stroke: css('--old'), 'stroke-width': 2 }));
      g.appendChild(el('path', { d: path(fs), fill: 'none', stroke: css('--effdet'), 'stroke-width': 2.4 }));
      svg.appendChild(g);
      if (mode === 'f') {
        svg.appendChild(el('text', { x: X(2.3), y: Yf(4.4), class: 'serieslabel', 'text-anchor': 'end' }, 'ReLU'));
        svg.appendChild(el('text', { x: X(-4.7), y: Yf(0.55), class: 'serieslabel' }, 'Swish, β = ' + beta.toFixed(2)));
      } else {
        svg.appendChild(el('text', { x: X(-4.7), y: Yf(0.08) - 6, class: 'serieslabel' }, 'ReLU′'));
        svg.appendChild(el('text', { x: X(-4.7), y: Yf(1.12), class: 'serieslabel' }, 'Swish′, β = ' + beta.toFixed(2)));
      }

      var cross = el('line', { class: 'crosshair', y1: T, y2: H - B, opacity: 0 });
      var dotR = el('circle', { r: 4, fill: css('--old'), opacity: 0 });
      var dotS = el('circle', { r: 4.5, fill: css('--effdet'), stroke: css('--panel'), 'stroke-width': 2, opacity: 0 });
      svg.appendChild(cross); svg.appendChild(dotR); svg.appendChild(dotS);
      var hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
      svg.appendChild(hit);
      function move(e) {
        var r = svg.getBoundingClientRect();
        var sx = (e.clientX - r.left) * W / r.width;
        var x = Math.max(x0, Math.min(x1, x0 + (sx - L) / (W - L - R) * (x1 - x0)));
        var yr = fr(x), ys = fs(x);
        cross.setAttribute('x1', X(x)); cross.setAttribute('x2', X(x)); cross.setAttribute('opacity', 1);
        dotR.setAttribute('cx', X(x)); dotR.setAttribute('cy', Yf(yr)); dotR.setAttribute('opacity', 1);
        dotS.setAttribute('cx', X(x)); dotS.setAttribute('cy', Yf(ys)); dotS.setAttribute('opacity', 1);
        placeTip(tip, svg, W, H, X(x), Math.min(Yf(ys), Yf(yr)),
          '<b>x = ' + x.toFixed(2) + '</b><div class="row"><i style="background:' + css('--old') + '"></i>ReLU' + (mode === 'd' ? '′' : '') + ' ' + yr.toFixed(3) +
          '</div><div class="row"><i style="background:' + css('--effdet') + '"></i>Swish' + (mode === 'd' ? '′' : '') + ' ' + ys.toFixed(3) + '</div>');
      }
      hit.addEventListener('pointermove', move);
      hit.addEventListener('pointerleave', function () {
        tip.classList.remove('on'); cross.setAttribute('opacity', 0); dotR.setAttribute('opacity', 0); dotS.setAttribute('opacity', 0);
      });

      // numeric note: where Swish bottoms out
      var minV = 0, minX = 0;
      for (var i = 0; i <= 2000; i++) { var xx = -10 + 10 * i / 2000, vv = swish(xx, beta); if (vv < minV) { minV = vv; minX = xx; } }
      $('#swNote').textContent = 'Swish(x) = x · σ(βx). With β = ' + beta.toFixed(2) + ' it reaches its minimum of ' + minV.toFixed(3) +
        ' at x = ' + minX.toFixed(2) + ', and its slope at x = −2 is ' + dswish(-2, beta).toFixed(3) + ' where ReLU\'s is 0. ' +
        'As β grows Swish approaches ReLU; as β shrinks it approaches the line x/2.';
    }
    group($('#swSwitch'), 'data-sw', function (m) { mode = m; draw(); });
    $('#swB').addEventListener('input', draw);
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 3e. loss decomposition (repository log) ---------------- */

  (function () {
    var svg = $('#lossSvg'), tip = $('#lossTip');
    var W = 860, H = 300, L = 54, R = 20, T = 16, B = 38;
    var Lg = D.effdetLoss, n = Lg.epoch.length;

    function draw() {
      var a = +$('#lossA').value;
      $('#oA').textContent = a;
      var reg = Lg.reg, cls = Lg.cls, box = Lg.box.map(function (v) { return v * a; });
      var tot = reg.map(function (v, i) { return v + cls[i] + box[i]; });
      var yMax = Math.max(0.5, Math.ceil(Math.max.apply(null, tot.slice(2)) * 5) / 5);
      var X = function (e) { return L + (W - L - R) * (e - 1) / (n - 1); };
      var Yv = function (v) { return T + (H - T - B) * (1 - Math.min(v, yMax) / yMax); };
      clear(svg);
      var steps = 5;
      for (var s = 0; s <= steps; s++) {
        var v = yMax * s / steps;
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: Yv(v), y2: Yv(v), class: s ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 8, y: Yv(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v.toFixed(2)));
      }
      [1, 50, 100, 150, 200, 250, 300, 350].forEach(function (e) {
        svg.appendChild(el('text', { x: X(e), y: H - 16, class: 'ticktext', 'text-anchor': 'middle' }, e));
      });
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 1, class: 'ticktext', 'text-anchor': 'middle' }, 'epoch'));
      svg.appendChild(el('text', { x: 12, y: T + (H - T - B) / 2, class: 'ticktext', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (T + (H - T - B) / 2) + ')' }, 'training loss'));

      function band(lower, upper, color) {
        var d = 'M' + X(1) + ',' + Yv(upper[0]);
        for (var i = 1; i < n; i++) d += 'L' + X(i + 1).toFixed(1) + ',' + Yv(upper[i]).toFixed(1);
        for (var j = n - 1; j >= 0; j--) d += 'L' + X(j + 1).toFixed(1) + ',' + Yv(lower[j]).toFixed(1);
        svg.appendChild(el('path', { d: d + 'Z', fill: color, opacity: 0.88 }));
        var top = 'M' + X(1) + ',' + Yv(upper[0]);
        for (var k = 1; k < n; k++) top += 'L' + X(k + 1).toFixed(1) + ',' + Yv(upper[k]).toFixed(1);
        svg.appendChild(el('path', { d: top, fill: 'none', stroke: css('--bg-sunk'), 'stroke-width': 1.5 }));
      }
      var zero = reg.map(function () { return 0; });
      var c1 = reg.map(function (v, i) { return v + cls[i]; });
      band(zero, reg, css('--old'));
      band(reg, c1, css('--effdet'));
      band(c1, tot, css('--yolov8'));
      if (tot[0] > yMax || tot[1] > yMax) {
        svg.appendChild(el('text', { x: X(4), y: T + 12, class: 'ticktext' }, 'epochs 1–2 run off the top (' + tot[0].toFixed(2) + ')'));
      }

      var cross = el('line', { class: 'crosshair', y1: T, y2: H - B, opacity: 0 });
      svg.appendChild(cross);
      var hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
      svg.appendChild(hit);
      hit.addEventListener('pointermove', function (e) {
        var r = svg.getBoundingClientRect();
        var sx = (e.clientX - r.left) * W / r.width;
        var i = Math.max(0, Math.min(n - 1, Math.round((sx - L) / (W - L - R) * (n - 1))));
        cross.setAttribute('x1', X(i + 1)); cross.setAttribute('x2', X(i + 1)); cross.setAttribute('opacity', 1);
        placeTip(tip, svg, W, H, X(i + 1), Yv(tot[i]),
          '<b>Epoch ' + (i + 1) + '</b> &nbsp;total ' + tot[i].toFixed(4) +
          '<div class="row"><i style="background:' + css('--yolov8') + '"></i>α·box ' + box[i].toFixed(4) + '</div>' +
          '<div class="row"><i style="background:' + css('--effdet') + '"></i>cls ' + cls[i].toFixed(4) + '</div>' +
          '<div class="row"><i style="background:' + css('--old') + '"></i>L2 ' + reg[i].toFixed(4) + '</div>' +
          '<div style="opacity:.75">learning rate ' + Lg.lr[i].toExponential(2) + '</div>');
      });
      hit.addEventListener('pointerleave', function () { tip.classList.remove('on'); cross.setAttribute('opacity', 0); });

      var last = n - 1, t = tot[last];
      var pct = function (v) { return Math.round(100 * v / t) + '%'; };
      $('#lossNote').textContent = 'At epoch 350 with α = ' + a + ': classification ' + pct(cls[last]) + ', box ' + pct(box[last]) +
        ', weight decay ' + pct(reg[last]) + ' of a total of ' + t.toFixed(3) + '. Classification loss fell ' +
        Math.round(cls[0] / cls[last]) + '× over training and box loss ' + Math.round(Lg.box[0] / Lg.box[last]) +
        '×, while the L2 term barely moved (' + reg[0].toFixed(3) + ' → ' + reg[last].toFixed(3) + '). ' +
        (a === 50 ? 'The stacked total at α = 50 equals the loss the log reports.' : 'The log itself was trained with α = 50; other values only reweight the recorded terms.');
    }
    $('#lossA').addEventListener('input', draw);
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 4. paper Table 5 ---------------- */

  var PAPER = {
    t5: [
      { name: 'YOLOv3', runs: [31.9, 30.2, 29.5, 32.5, 31.7], mean: 31.1, std: 1.1, sd: '1.1', c: 'old' },
      { name: 'YOLOv4', runs: [84.6, 83.8, 84.2, 85.2, 80.9], mean: 83.7, std: 1.4, sd: '1.4', c: 'old' },
      { name: 'YOLOv5', runs: [96.7, 98.0, 97.5, 98.5, 97.3], mean: 97.6, std: 0.61, sd: '0.61', c: 'yolov5' },
      { name: 'YOLOv8', runs: [98.0, 98.5, 98.3, 98.1, 98.2], mean: 98.2, std: 0.17, sd: '0.17', c: 'yolov8' },
      { name: 'Detectron2', runs: [94.5, 93.4, 94.8, 95.7, 97.8], mean: 95.2, std: 1.4, sd: '1.4', c: 'd2' },
      { name: 'Proposed EfficientDet', runs: [99.5, 98.7, 98.0, 97.0, 99.8], mean: 98.6, std: 1.0, sd: '1.0', c: 'effdet' }
    ],
    t6cols: ['crab', 'fish-big', 'fish-school', 'fish-small', 'shrimp', 'jellyfish'],
    t6: [
      { name: 'YOLOv3', v: [92.7, 89.9, 84.0, 62.3, 76.6, 82.0], c: 'old' },
      { name: 'YOLOv4', v: [93.1, 78.9, 88.2, 59.2, 73.2, 83.2], c: 'old' },
      { name: 'YOLOv5', v: [81.8, 56.3, 80.9, 66.9, 69.6, 93.3], c: 'yolov5' },
      { name: 'YOLOv8', v: [82.8, 63.2, 85.7, 69.5, 65.0, 97.4], c: 'yolov8' },
      { name: 'Detectron2', v: [28.1, 14.5, 8.6, 3.8, 26.1, 40.6], c: 'd2' },
      { name: 'Proposed EfficientDet', v: [89.5, 94.6, 87.2, 82.1, 79.9, 95.2], c: 'effdet' }
    ]
  };

  (function () {
    var svg = $('#t5Svg'), tip = $('#t5Tip');
    var W = 860, H = 300, L = 170, R = 110, T = 20, B = 34;
    var range = 'full';
    function draw() {
      var lo = range === 'full' ? 0 : 92, hi = 100;
      var rows = PAPER.t5, rh = (H - T - B) / rows.length;
      var X = function (v) { return L + (W - L - R) * (v - lo) / (hi - lo); };
      clear(svg);
      var ticks = range === 'full' ? [0, 20, 40, 60, 80, 100] : [92, 94, 96, 98, 100];
      ticks.forEach(function (v) {
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T - 6, y2: H - B, class: 'gridline' }));
        svg.appendChild(el('text', { x: X(v), y: H - B + 18, class: 'ticktext', 'text-anchor': 'middle' }, v));
      });
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 2, class: 'ticktext', 'text-anchor': 'middle' }, 'mAP, %'));
      rows.forEach(function (m, i) {
        var cy = T + rh * i + rh / 2, col = css(MODEL_VAR[m.c]);
        svg.appendChild(el('text', { x: L - 14, y: cy + 4, class: 'serieslabel', 'text-anchor': 'end' }, m.name));
        if (m.mean < lo) {
          svg.appendChild(el('text', { x: L + 4, y: cy + 4, class: 'ticktext' }, '◂ ' + m.mean.toFixed(1) + ', off this scale'));
          return;
        }
        var b1 = Math.max(lo, m.mean - m.std), b2 = Math.min(hi, m.mean + m.std);
        svg.appendChild(el('rect', { x: X(b1), y: cy - 11, width: Math.max(1, X(b2) - X(b1)), height: 22, fill: col, opacity: 0.16, rx: 4 }));
        svg.appendChild(el('line', { x1: X(m.mean), x2: X(m.mean), y1: cy - 13, y2: cy + 13, stroke: col, 'stroke-width': 2.5 }));
        m.runs.forEach(function (v, k) {
          var hollow = m.c === 'd2';
          var dot = el('circle', { cx: X(v), cy: cy + (k - 2) * 3, r: hollow ? 5 : 6, fill: hollow ? css('--bg-sunk') : col, stroke: hollow ? col : css('--bg-sunk'), 'stroke-width': hollow ? 2.5 : 2, style: 'cursor:pointer' });
          dot.addEventListener('mouseenter', function () {
            placeTip(tip, svg, W, H, X(v), cy - 10, '<b>' + m.name + '</b>, run ' + (k + 1) + ': ' + v.toFixed(1) + '% mAP');
          });
          dot.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
          svg.appendChild(dot);
        });
        svg.appendChild(el('text', { x: W - R + 12, y: cy + 4, class: 'ticktext' }, m.mean.toFixed(1) + ' ± ' + m.sd));
      });
      $('#t5Note').textContent = range === 'full'
        ? 'Shaded band: mean ± one standard deviation; vertical tick: mean. The four newer detectors all sit above 93%; YOLOv3 and YOLOv4 are the older baselines from the Brackish paper and follow-up work.'
        : 'Zoomed in, the proposed EfficientDet has the highest mean but also the widest spread among the leaders: its five runs range from 97.0 to 99.8, while YOLOv8’s range from 98.0 to 98.5.';
    }
    group($('#t5Switch'), 'data-range', function (r) { range = r; draw(); });
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 4b. paper Table 6 heatmap ---------------- */

  (function () {
    var table = $('#t6'), sortCol = -1;
    function draw() {
      var rows = PAPER.t6.slice();
      if (sortCol >= 0) rows.sort(function (a, b) {
        var va = sortCol === 6 ? mean(a.v) : a.v[sortCol], vb = sortCol === 6 ? mean(b.v) : b.v[sortCol];
        return vb - va;
      });
      var h = '<thead><tr><th>Model</th>';
      PAPER.t6cols.concat(['row mean']).forEach(function (c, i) {
        h += '<th style="text-align:center"><button type="button" data-col="' + i + '" aria-pressed="' + (sortCol === i) + '">' + c + (sortCol === i ? ' ▾' : '') + '</button></th>';
      });
      h += '</tr></thead><tbody>';
      rows.forEach(function (r) {
        h += '<tr><td><i class="mdot" style="background:var(' + MODEL_VAR[r.c] + ')"></i>' + r.name + '</td>';
        r.v.concat([mean(r.v)]).forEach(function (v, i) {
          var p = Math.round(v);
          h += '<td class="cell' + (p > 58 ? ' lightink' : '') + '" style="background:color-mix(in oklab, var(--navy-soft) ' + p + '%, var(--bg-sunk))' + (i === 6 ? ';border-left:2px solid var(--bg)' : '') + '">' + v.toFixed(1) + '</td>';
        });
        h += '</tr>';
      });
      table.innerHTML = h + '</tbody>';
      $$('button[data-col]', table).forEach(function (b) {
        b.addEventListener('click', function () { var c = +b.dataset.col; sortCol = sortCol === c ? -1 : c; draw(); });
      });
    }
    function mean(a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; }
    draw();
  })();

  /* ---------------- 5. training curves (repository logs) ---------------- */

  (function () {
    var svg = $('#curveSvg'), tip = $('#curveTip');
    var W = 860, H = 330, L = 52, R = 150, T = 16, B = 40;
    var metric = 'map50', on = { effdet: true, yolov5: true, yolov8: true };
    var NAMES = { effdet: 'EfficientDet-Lite0', yolov5: 'YOLOv5s', yolov8: 'YOLOv8s' };
    var LABEL = { map50: 'AP@0.5', map: 'AP@[.5:.95]', precision: 'precision', recall: 'recall' };

    function series(run) { var c = D.curves[run]; return c[metric] ? { x: c.epoch, y: c[metric] } : null; }

    function draw() {
      clear(svg);
      var X = function (e) { return L + (W - L - R) * e / 350; };
      var lo = metric === 'map' ? 0 : 0, hi = 1;
      var Yv = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
      for (var s = 0; s <= 5; s++) {
        var v = s / 5;
        svg.appendChild(el('line', { x1: L, x2: W - R, y1: Yv(v), y2: Yv(v), class: s ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 8, y: Yv(v) + 4, class: 'ticktext', 'text-anchor': 'end' }, v.toFixed(1)));
      }
      [0, 50, 100, 150, 200, 250, 300, 350].forEach(function (e) {
        svg.appendChild(el('text', { x: X(e), y: H - B + 18, class: 'ticktext', 'text-anchor': 'middle' }, e));
      });
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 4, class: 'ticktext', 'text-anchor': 'middle' }, 'epoch'));
      svg.appendChild(el('text', { x: 12, y: T + (H - T - B) / 2, class: 'ticktext', 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (T + (H - T - B) / 2) + ')' }, 'validation ' + LABEL[metric]));

      var labels = [];
      ['effdet', 'yolov5', 'yolov8'].forEach(function (run) {
        var sr = series(run);
        if (!sr || !on[run]) return;
        var col = css(MODEL_VAR[run]);
        var d = sr.x.map(function (e, i) { return (i ? 'L' : 'M') + X(e).toFixed(1) + ',' + Yv(sr.y[i]).toFixed(1); }).join('');
        svg.appendChild(el('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
        var li = sr.x.length - 1;
        svg.appendChild(el('circle', { cx: X(sr.x[li]), cy: Yv(sr.y[li]), r: 4, fill: col, stroke: css('--bg-sunk'), 'stroke-width': 2 }));
        labels.push({ run: run, y: Yv(sr.y[li]), x: X(sr.x[li]), v: sr.y[li] });
      });
      // direct labels at the right margin, de-overlapped
      labels.sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 16) labels[k].y = labels[k - 1].y + 16;
      labels.forEach(function (lb) {
        svg.appendChild(el('text', { x: W - R + 10, y: lb.y + 4, class: 'serieslabel' }, NAMES[lb.run] + '  ' + lb.v.toFixed(3)));
      });

      var cross = el('line', { class: 'crosshair', y1: T, y2: H - B, opacity: 0 });
      svg.appendChild(cross);
      var hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
      svg.appendChild(hit);
      hit.addEventListener('pointermove', function (e) {
        var r = svg.getBoundingClientRect();
        var ep = Math.max(1, Math.min(350, Math.round(((e.clientX - r.left) * W / r.width - L) / (W - L - R) * 350)));
        var html = '<b>Epoch ' + ep + '</b>', topY = H;
        ['effdet', 'yolov8', 'yolov5'].forEach(function (run) {
          var sr = series(run);
          if (!sr || !on[run]) return;
          var idx = -1, best = 1e9;
          sr.x.forEach(function (x, i) { var dd = Math.abs(x - ep); if (dd < best) { best = dd; idx = i; } });
          if (best > (run === 'effdet' ? 2.5 : 0.5)) return;
          topY = Math.min(topY, Yv(sr.y[idx]));
          html += '<div class="row"><i style="background:' + css(MODEL_VAR[run]) + '"></i>' + NAMES[run] + ' ' + sr.y[idx].toFixed(3) + (run === 'effdet' ? ' (epoch ' + sr.x[idx] + ')' : '') + '</div>';
        });
        cross.setAttribute('x1', X(ep)); cross.setAttribute('x2', X(ep)); cross.setAttribute('opacity', 1);
        placeTip(tip, svg, W, H, X(ep), topY === H ? T + 30 : topY, html);
      });
      hit.addEventListener('pointerleave', function () { tip.classList.remove('on'); cross.setAttribute('opacity', 0); });

      var note;
      if (metric === 'map50' || metric === 'map') {
        var thr = metric === 'map50' ? 0.85 : 0.55;
        var first = function (run) { var sr = series(run); for (var i = 0; i < sr.y.length; i++) if (sr.y[i] >= thr) return sr.x[i]; return null; };
        var best = function (run) { return Math.max.apply(null, series(run).y); };
        note = 'Epoch at which each run first reaches ' + thr + ': EfficientDet-Lite0 ' + first('effdet') + ', YOLOv5s ' + first('yolov5') +
          ', YOLOv8s ' + first('yolov8') + '. Best values: ' + best('effdet').toFixed(3) + ', ' + best('yolov5').toFixed(3) + ' and ' + best('yolov8').toFixed(3) +
          '. EfficientDet-Lite0 was evaluated every five epochs and swings widely until about epoch 270, where it settles; the YOLO runs stop at 100 epochs.';
      } else {
        note = 'Precision and recall were logged only by the Ultralytics runs. EfficientDet-Lite0 reports COCO average precision and recall instead.';
      }
      $('#curveNote').textContent = note;
    }
    group($('#curveSwitch'), 'data-metric', function (m) { metric = m; draw(); });
    $$('#curveLegend button').forEach(function (b) {
      b.addEventListener('click', function () { on[b.dataset.run] = !on[b.dataset.run]; b.setAttribute('aria-pressed', on[b.dataset.run]); draw(); });
    });
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 5b. per-class AP ---------------- */

  (function () {
    var svg = $('#pcSvg'), tip = $('#pcTip');
    var W = 860, H = 290, L = 110, R = 30, T = 14, B = 36;
    var REPO_PC = [
      { run: 'effdet', name: 'EfficientDet-Lite0 (test)', v: [0.807, 0.353, 0.569, 0.610, 0.432, 0.834] },
      { run: 'yolov5', name: 'YOLOv5s (val)', v: [0.818, 0.563, 0.809, 0.669, 0.696, 0.933] },
      { run: 'yolov8', name: 'YOLOv8s (val, 25-epoch notebook run)', v: [0.828, 0.635, 0.862, 0.704, 0.648, 0.976] },
      { run: 'd2', name: 'Detectron2 (test)', v: [0.288, 0.146, 0.086, 0.039, 0.257, 0.407] }
    ];
    function draw() {
      clear(svg);
      var X = function (v) { return L + (W - L - R) * v; };
      var rh = (H - T - B) / CLASSES.length;
      [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function (v) {
        svg.appendChild(el('line', { x1: X(v), x2: X(v), y1: T, y2: H - B, class: v ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: X(v), y: H - B + 18, class: 'ticktext', 'text-anchor': 'middle' }, v.toFixed(1)));
      });
      svg.appendChild(el('text', { x: L + (W - L - R) / 2, y: H - 2, class: 'ticktext', 'text-anchor': 'middle' }, 'AP@[.5:.95]'));
      CLASSES.forEach(function (cname, ci) {
        var cy = T + rh * ci + rh / 2;
        var vals = REPO_PC.map(function (m) { return m.v[ci]; });
        svg.appendChild(el('text', { x: L - 14, y: cy + 4, class: 'serieslabel', 'text-anchor': 'end' }, cname));
        svg.appendChild(el('line', { x1: X(Math.min.apply(null, vals)), x2: X(Math.max.apply(null, vals)), y1: cy, y2: cy, stroke: css('--rule-strong'), 'stroke-width': 2 }));
        REPO_PC.forEach(function (m, mi) {
          var hollow = m.run === 'd2';
          var dot = el('circle', { cx: X(m.v[ci]), cy: cy + (mi - 1.5) * 4, r: hollow ? 5.5 : 6.5, fill: hollow ? css('--bg-sunk') : css(MODEL_VAR[m.run]), stroke: hollow ? css(MODEL_VAR[m.run]) : css('--bg-sunk'), 'stroke-width': hollow ? 2.5 : 2, style: 'cursor:pointer' });
          dot.addEventListener('mouseenter', function () {
            placeTip(tip, svg, W, H, X(m.v[ci]), cy - 10, '<b>' + cname + '</b><div class="row"><i style="background:' + css(MODEL_VAR[m.run]) + '"></i>' + m.name + ' ' + m.v[ci].toFixed(3) + '</div>');
          });
          dot.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
          svg.appendChild(dot);
        });
      });
    }
    document.addEventListener('themechange', draw);
    draw();
  })();

  /* ---------------- 5c. detection explorer ---------------- */

  (function () {
    var thumbs = $('#detThumbs'), sel = 0;
    for (var i = 0; i < NPAIR; i++) {
      (function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-pressed', k === 0);
        b.setAttribute('aria-label', 'Test frame ' + D.frames.pairs[k]);
        b.innerHTML = '<img src="' + frame('v8', k) + '" alt="" loading="lazy">';
        b.addEventListener('click', function () { pick(k); });
        thumbs.appendChild(b);
      })(i);
    }
    var key = $('#classKey');
    CLASSES.forEach(function (c, i) { key.insertAdjacentHTML('beforeend', '<span>' + c + ' <b>' + i + '</b> | <b>' + (i + 1) + '</b></span>'); });
    key.insertAdjacentHTML('afterbegin', '<span style="grid-column:1/-1;font-weight:700">class &nbsp; YOLOv5 id | YOLOv8 id</span>');

    function pick(k) {
      sel = (k + NPAIR) % NPAIR;
      $('#cmpV5').src = frame('v5', sel);
      $('#cmpV8').src = frame('v8', sel);
      $$('button', thumbs).forEach(function (b, j) { b.setAttribute('aria-pressed', j === sel); });
      $('#detLine').textContent = 'Test frame ' + D.frames.pairs[sel] + ' (' + (sel + 1) + ' of ' + NPAIR +
        '). Left: YOLOv5s at 416 px, confidence ≥ 0.4. Right: YOLOv8s at 800 px, confidence ≥ 0.25.';
    }
    pick(0);

    var compare = $('#compare'), over = $('#cmpOver'), handle = $('#cmpHandle'), inner = $('#cmpV5'), dragging = false;
    function size() { inner.style.width = compare.clientWidth + 'px'; }
    function setWipe(p) {
      p = Math.max(0, Math.min(100, p));
      over.style.width = p + '%'; handle.style.left = p + '%'; handle.setAttribute('aria-valuenow', Math.round(p));
    }
    function fromEvent(e) { var r = compare.getBoundingClientRect(); setWipe(100 * (e.clientX - r.left) / r.width); }
    compare.addEventListener('pointerdown', function (e) { dragging = true; compare.setPointerCapture(e.pointerId); fromEvent(e); });
    compare.addEventListener('pointermove', function (e) { if (dragging) fromEvent(e); });
    compare.addEventListener('pointerup', function () { dragging = false; });
    compare.addEventListener('pointercancel', function () { dragging = false; });
    handle.addEventListener('keydown', function (e) {
      var now = +handle.getAttribute('aria-valuenow');
      if (e.key === 'ArrowLeft') { setWipe(now - 5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setWipe(now + 5); e.preventDefault(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.target === handle || /INPUT|TEXTAREA/.test(e.target.tagName) || e.target.closest && e.target.closest('#annot')) return;
      var box = $('#runs .det').getBoundingClientRect();
      if (box.top > window.innerHeight * 0.8 || box.bottom < window.innerHeight * 0.2) return;
      if (e.key === 'ArrowRight') pick(sel + 1);
      if (e.key === 'ArrowLeft') pick(sel - 1);
    });
    window.addEventListener('resize', size);
    size(); setWipe(50);

    var strip = $('#edStrip');
    for (var q = 0; q < NED; q++) {
      (function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Enlarge EfficientDet-Lite0 prediction ' + (k + 1));
        b.innerHTML = '<img src="' + frame('ed', k) + '" alt="EfficientDet-Lite0 prediction ' + (k + 1) + '" loading="lazy">';
        b.addEventListener('click', function () { openLightbox(frame('ed', k), 'EfficientDet-Lite0 prediction'); });
        strip.appendChild(b);
      })(q);
    }
  })();

  /* ---------------- 5d. diagnostics ---------------- */

  (function () {
    var run = 'v5', plot = 'confusion', img = $('#diagImg');
    function show() { img.src = 'assets/runs/' + run + '_' + plot + '.jpg'; img.alt = (run === 'v5' ? 'YOLOv5s ' : 'YOLOv8s ') + plot; }
    group($('#diagRun'), 'data-run', function (r) { run = r; show(); });
    group($('#diagPlot'), 'data-plot', function (p) { plot = p; show(); });
    img.addEventListener('click', function () { openLightbox(img.src, img.alt); });
  })();

  /* ---------------- 6. UAP illustration ---------------- */

  (function () {
    var cA = $('#uapA'), cB = $('#uapB'), cN = $('#uapN');
    var W = cA.width, H = cA.height, N = W * H;
    var imgs = {}, loaded = 0;
    // A fixed, image-agnostic pattern: signed product of oriented waves per channel, in the spirit of the
    // textures that optimised UAPs tend to form. Values are exactly -1 or +1.
    var delta = new Int8Array(N * 3);
    var P = [[0.11, 0.07, 0.4, 0.05, -0.13, 1.3], [0.06, 0.12, 2.1, 0.14, 0.04, 0.2], [0.09, -0.1, 1.1, 0.03, 0.15, 2.4]];
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) for (var c = 0; c < 3; c++) {
      var p = P[c];
      var s = Math.sin(p[0] * x + p[1] * y + p[2]) * Math.sin(p[3] * x + p[4] * y + p[5]) + 0.35 * Math.sin(0.021 * (x * x + y * y) * 0.02 + c);
      delta[(y * W + x) * 3 + c] = s >= 0 ? 1 : -1;
    }
    function load(name, key) {
      var im = new Image();
      im.onload = function () {
        var t = document.createElement('canvas'); t.width = W; t.height = H;
        var tc = t.getContext('2d'); tc.drawImage(im, 0, 0, W, H);
        imgs[key] = tc.getImageData(0, 0, W, H).data;
        if (++loaded === 2) draw();
      };
      im.src = 'assets/raw/' + name + '.jpg';
    }
    function paint(canvas, base, eps) {
      var ctx = canvas.getContext('2d'), out = ctx.createImageData(W, H), o = out.data, se = 0;
      for (var i = 0, p = 0; p < N; p++, i += 4) {
        for (var c = 0; c < 3; c++) {
          var v = base[i + c] + eps * delta[p * 3 + c];
          v = v < 0 ? 0 : v > 255 ? 255 : v;
          var d = v - base[i + c]; se += d * d;
          o[i + c] = v;
        }
        o[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return Math.sqrt(se / (N * 3));
    }
    function draw() {
      var eps = +$('#uapEps').value;
      $('#oEps').textContent = eps + '/255';
      var rmseA = paint(cA, imgs.a, eps);
      paint(cB, imgs.b, eps);
      var ctx = cN.getContext('2d'), out = ctx.createImageData(W, H), o = out.data;
      for (var i = 0, p = 0; p < N; p++, i += 4) {
        for (var c = 0; c < 3; c++) o[i + c] = eps === 0 ? 128 : 128 + 110 * delta[p * 3 + c];
        o[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      var psnr = rmseA > 0 ? 20 * Math.log10(255 / rmseA) : Infinity;
      $('#uapNote').textContent = eps === 0
        ? 'Strength 0: the frames are untouched.'
        : 'No pixel channel moves by more than ' + eps + ' of 255 levels (an L∞ budget of ' + (eps / 255).toFixed(3) + '). On the crab frame that is a PSNR of ' +
          psnr.toFixed(1) + ' dB. ' + (eps <= 10
            ? 'Budgets like this are typical in published attacks on natural photos, where texture hides the pattern. On flat, low-contrast underwater frames there is little texture to hide in, so even small budgets show.'
            : 'Well beyond the budgets usually used in published attacks, which tend to stay at or below 10/255.');
    }
    load('crab', 'a'); load('school', 'b');
    $('#uapEps').addEventListener('input', function () { if (loaded === 2) draw(); });
  })();

  /* ---------------- 6b. CAM viewer ---------------- */

  (function () {
    var state = { frame: 'crab', nb: 'hi', kind: 'cam' };
    var FILES = {
      hi: { crab: 'GradCAM++_EfficientDet_crab.ipynb', school: 'GradCAM++_EfficientDet_fish_school.ipynb', ckpt: 'best.pt', conf: '0.8' },
      lo: { crab: 'GradCAM++_and_saliency_maps_YOLOv8_crab.ipynb', school: 'GradCAM++_and_saliency_maps_YOLOv8_fish_school.ipynb', ckpt: 'best_yolov8.pt', conf: '0.2' }
    };
    var TEXT = {
      crab_hi: 'One crab box (class 2) survives the 0.8 threshold. The map is concentrated on the crab’s body and legs; the calibration board and the seabed stay cold.',
      crab_lo: 'At a 0.2 threshold a second, faint crab box appears on the seabed. The whole-image map is visually the same as notebook A’s for this frame.',
      school_hi: 'Five small-fish boxes (class 1) along the lower edge of the school pass the 0.8 threshold. The map lights the lower fish and ignores the board.',
      school_lo: 'A different fish-school frame. Only two boxes survive, and the whole-image map spreads over the seabed and the right edge rather than the fish: a CAM shows what drives the features, not whether the answer is right.'
    };
    var det = $('#camDet'), map = $('#camMap'), mix = $('#camMix');
    [['crab', 'hi'], ['crab', 'lo'], ['school', 'hi'], ['school', 'lo']].forEach(function (p) {
      ['det', 'cam', 'box'].forEach(function (k) { new Image().src = 'assets/cam/' + p[0] + '_' + p[1] + '_' + k + '.jpg'; });
    });
    function show() {
      var base = 'assets/cam/' + state.frame + '_' + state.nb + '_';
      det.src = base + 'det.jpg';
      map.src = base + state.kind + '.jpg';
      map.style.opacity = +mix.value / 100;
      $('#oMix').textContent = mix.value + '%';
      var f = FILES[state.nb];
      $('#camKicker').textContent = '5_GradCAM++/' + f[state.frame];
      $('#camBody').innerHTML = TEXT[state.frame + '_' + state.nb] +
        '<br><span class="note">Loads <code>' + f.ckpt + '</code> with <code>torch.hub.load(\'ultralytics/yolov5\', \'custom\', …)</code>, keeps boxes with confidence ≥ ' + f.conf +
        ', and runs EigenCAM on <code>model.model.model.model[-3]</code>.' + (state.kind === 'box' ? ' This view renormalises the map inside each box and zeroes it elsewhere.' : '') + '</span>';
    }
    group($('#camFrame'), 'data-frame', function (v) { state.frame = v; show(); });
    group($('#camNb'), 'data-nb', function (v) { state.nb = v; show(); });
    group($('#camKind'), 'data-kind', function (v) { state.kind = v; show(); });
    mix.addEventListener('input', show);
    show();
  })();

  /* ---------------- 8. repository map ---------------- */

  (function () {
    var TREE = [
      { path: '0_Dataset/', size: 'notebook', title: 'Download and clean the Brackish data',
        body: 'Dataset.ipynb (and the exported dataset.py) downloads the Kaggle release, extracts frames with ffmpeg, pairs them with YOLO label files, removes empty frames and normalises coordinates. Runs top to bottom on Colab.',
        cmd: '# in Google Colab\nRuntime → Run all   # 0_Dataset/Dataset.ipynb\n\n# key step\nffmpeg -i {video}.avi -vf scale=960:540 -sws_flags bicubic {video}-%04d.jpg' },
      { path: '1_YOLO5_Experiment/', size: 'run + weights', title: 'YOLOv5s',
        body: 'Builds its own 12,067 / 1,508 / 1,508 split and trains YOLOv5s for 100 epochs at 416 px. The runs folder holds curves, the confusion matrix, results.csv, best and last weights, and predictions on all 1,508 test frames.',
        cmd: 'python train.py --img 416 --batch 16 --epochs 100 \\\n  --weights yolov5s.pt --data data.yaml --cache\npython detect.py --weights runs/train/exp/weights/best.pt \\\n  --img 416 --conf 0.4 --source images/test' },
      { path: '2_YOLO8_Experiment/', size: 'run + weights', title: 'YOLOv8s',
        body: 'Pulls the Roboflow release (7,000 / 2,000 / 1,000) and trains YOLOv8s at 800 px with Ultralytics 8.0.20. Includes the train and val folders and predictions on the 1,000 test frames. Set ROBOFLOW_API_KEY before running.',
        cmd: 'pip install ultralytics==8.0.20 roboflow\nyolo task=detect mode=train model=yolov8s.pt \\\n  data=Brackish-1/data.yaml epochs=100 imgsz=800 plots=True\nyolo task=detect mode=val model=runs/detect/train/weights/best.pt \\\n  data=Brackish-1/data.yaml' },
      { path: '3_EfficientDet_Experiment/', size: 'TFLite model', title: 'EfficientDet-Lite0',
        body: 'Trains the efficientdet_lite0 specification of TFLite Model Maker for 350 epochs on AWS SageMaker, evaluates on the test split, exports model.tflite and saves ten example predictions. Earlier attempts live in older_versions/.',
        cmd: "spec = model_spec.get('efficientdet_lite0')\ntrain = object_detector.DataLoader.from_pascal_voc('train', 'train', CLASSES)\nmodel = object_detector.create(train, model_spec=spec, batch_size=64,\n    train_whole_model=True, validation_data=val, epochs=350)\nmodel.evaluate(test)\nmodel.export(export_dir='.')" },
      { path: '4_Detectron2/', size: 'notebook', title: 'Faster R-CNN with Detectron2',
        body: 'Registers the COCO-format Roboflow export and fine-tunes faster_rcnn_X_101_32x8d_FPN_3x for 300 iterations at batch 4, then evaluates with COCOEvaluator.',
        cmd: "cfg.merge_from_file(model_zoo.get_config_file(\n    'COCO-Detection/faster_rcnn_X_101_32x8d_FPN_3x.yaml'))\ncfg.SOLVER.IMS_PER_BATCH = 4\ncfg.SOLVER.BASE_LR = 0.001\ncfg.SOLVER.MAX_ITER = 300\ntrainer = CocoTrainer(cfg); trainer.train()" },
      { path: '5_GradCAM++/', size: '4 notebooks', title: 'Class activation maps',
        body: 'Four notebooks, two frames by two confidence thresholds. Each loads a YOLOv5-format checkpoint through torch.hub and renders EigenCAM heatmaps, whole-image and renormalised inside boxes.',
        cmd: "model = torch.hub.load('ultralytics/yolov5', 'custom', 'best.pt')\ntarget_layers = [model.model.model.model[-3]]\ncam = EigenCAM(model, target_layers, use_cuda=False)\ngrayscale_cam = cam(tensor)[0, :, :]" },
      { path: 'docs/', size: 'paper', title: 'Paper and supporting material',
        body: 'The arXiv version of the paper, the implementation notes submitted with the final report, the figures used in the README, and REPRODUCIBILITY.md with the numbers on this page.',
        cmd: 'docs/\n├─ DeepSeaNet_arXiv_2306.06075v2.pdf\n├─ implementation_details.pdf\n├─ REPRODUCIBILITY.md\n└─ figures/' },
      { path: 'scripts/', size: 'Python', title: 'Summarise the committed runs',
        body: 'summarize_runs.py reads results.csv files and notebook outputs and prints the AP table and per-class numbers shown in section 5, with no GPU and no dataset download.',
        cmd: 'python scripts/summarize_runs.py' }
    ];
    var list = $('#treeList');
    TREE.forEach(function (t, i) {
      var li = document.createElement('li');
      li.innerHTML = '<button type="button" aria-pressed="' + (i === 0) + '">' + t.path + '<span>' + t.size + '</span></button>';
      li.firstChild.addEventListener('click', function () { pick(i); });
      list.appendChild(li);
    });
    function pick(i) {
      $$('button', list).forEach(function (b, j) { b.setAttribute('aria-pressed', i === j); });
      $('#treeKicker').textContent = TREE[i].path;
      $('#treeBody').innerHTML = '<b>' + TREE[i].title + '.</b> ' + TREE[i].body;
      $('#treeCmd').textContent = TREE[i].cmd;
    }
    pick(0);
  })();

  /* ---------------- lightbox, figures, bibtex ---------------- */

  var lb = $('#lightbox'), lbImg = $('#lightboxImg');
  function openLightbox(src, alt) { lbImg.src = src; lbImg.alt = alt || ''; lb.classList.add('on'); }
  $$('figure.fig img').forEach(function (im) { im.addEventListener('click', function () { openLightbox(im.src, im.alt); }); });
  lb.addEventListener('click', function () { lb.classList.remove('on'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('on'); });

  $('#copyBib').addEventListener('click', function () {
    var txt = $('#bibtex').textContent;
    var done = function () { $('#copiedMsg').classList.add('on'); setTimeout(function () { $('#copiedMsg').classList.remove('on'); }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done);
    else {
      var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta); done();
    }
  });
})();
