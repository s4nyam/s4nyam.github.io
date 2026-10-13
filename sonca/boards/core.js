/* ==========================================================
   Section 9 — questions beyond the paper.

   core.js runs the question picker and a single animation loop.
   Each boards/<key>.js registers its board with

     SONCA.board('<key>', function (root, kit) {
       // build or bind the board inside root, the element with
       // data-board="<key>"; runs the first time the board is shown
       return { frame: function (t) {}, show: function () {}, hide: function () {} };
     });

   Every returned hook is optional. Only the board on show gets
   frames, and only while the section is on screen and the tab is
   visible, so seven live boards cost what one does.
   ========================================================== */

(function () {
  'use strict';

  var S = window.SONCA;
  var section = document.getElementById('questions');
  if (!S || !section) return;
  var $ = S.$, $$ = S.$$;

  var inits = {}, boards = {}, current = null, onScreen = false, near = false, raf = null;
  var VERSION = 1, requested = {};

  /* ---------------- the kit every board gets ---------------- */

  var kit = {
    S: S,
    $: $, $$: $$, css: S.css, el: S.el, clear: S.clear, fmt: S.fmt, rgba: S.rgba,
    magma: S.magma, reduceMotion: S.reduceMotion,

    // seeded uniform [0, 1) generator (mulberry32), for reproducible demos
    rng: function (seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },

    // load a board's embedded data the first time the board opens, so the
    // page itself does not pay for it; cb runs once the script has run
    load: function (src, cb) {
      var tag = document.createElement('script');
      tag.src = src;
      tag.onload = function () { cb(); };
      tag.onerror = function () { cb(new Error('could not load ' + src)); };
      document.body.appendChild(tag);
    },

    // returns a function of the frame time that is true at most every `ms`
    every: function (ms) {
      var last = -Infinity;
      return function (t) {
        if (t - last < ms) return false;
        last = t; return true;
      };
    },

    // paint a W x H grid onto a canvas; pixel(i, rgb) fills rgb[0..2]
    draw: function (cv, W, H, pixel) {
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      var ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
      var rgb = [0, 0, 0], n = W * H, i, o;
      for (i = 0; i < n; i++) {
        rgb[0] = rgb[1] = rgb[2] = 0;
        pixel(i, rgb);
        o = i * 4;
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },

    // a substrate grid in one of the page's four views: 'alpha' | 'chem' | 'ghc' | 'rwsp'
    paint: function (cv, sim, mode) { S.paint(cv, sim, mode); },

    // pointer painting on a canvas in grid coordinates: cb(row, col, phase, event),
    // phase 'down' | 'move' | 'up'
    pointer: function (cv, W, H, cb) {
      var on = false;
      function at(e, phase) {
        var r = cv.getBoundingClientRect();
        var row = Math.floor((e.clientY - r.top) / r.height * (typeof H === 'function' ? H() : H));
        var col = Math.floor((e.clientX - r.left) / r.width * (typeof W === 'function' ? W() : W));
        cb(row, col, phase, e);
      }
      cv.addEventListener('pointerdown', function (e) {
        on = true; cv.setPointerCapture(e.pointerId); at(e, 'down'); e.preventDefault();
      });
      cv.addEventListener('pointermove', function (e) { if (on) at(e, 'move'); });
      cv.addEventListener('pointerup', function (e) { if (on) { on = false; at(e, 'up'); } });
      cv.addEventListener('pointercancel', function () { on = false; });
    },

    // bind a range input and its <output>; cb(value) on every input event
    slider: function (input, output, fmtFn, cb) {
      function upd() {
        var v = parseFloat(input.value);
        if (output) output.textContent = fmtFn ? fmtFn(v) : v;
        if (cb) cb(v);
      }
      input.addEventListener('input', upd);
      if (output) output.textContent = fmtFn ? fmtFn(parseFloat(input.value)) : input.value;
      return upd;
    },

    // a row of pill buttons in the page's preset style; items [{key, label}],
    // onPick(key, item); returns { set(key) }
    pills: function (host, items, onPick, initial) {
      var btns = [];
      host.classList.add('presets');
      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = it.label;
        if (it.title) b.title = it.title;
        b.setAttribute('aria-pressed', String(it.key === initial));
        b.addEventListener('click', function () { set(it.key); onPick(it.key, it); });
        host.appendChild(b); btns.push(b);
      });
      function set(key) {
        btns.forEach(function (b, k) { b.setAttribute('aria-pressed', String(items[k].key === key)); });
      }
      return { set: set };
    },

    /* A line chart in the page's style.
       spec = {
         w, h,                      viewBox size (default 520 x 300)
         x: { min, max, label, ticks (count, default 5), fmt },
         y: { min, max, label, ticks (count, default 4), fmt },
         series: [{ label, colour: '--gep' (a CSS variable or a colour), points: [[x, y], ...],
                    width, dash, end: true (label at the line's end) }],
         marks: [{ x, label, colour }]   optional vertical marker lines
         tip: element                   optional .tip element for a hover readout
       } */
    chart: function (svg, spec) {
      var W = spec.w || 520, H = spec.h || 300, L = spec.left || 50, R = spec.right || 64, T = 14, B = 42;
      var iw = W - L - R, ih = H - T - B, el = S.el, css = S.css;
      var xs = spec.x, ys = spec.y;
      var X = function (v) { return L + iw * (v - xs.min) / ((xs.max - xs.min) || 1); };
      var Y = function (v) { return T + ih * (1 - (v - ys.min) / ((ys.max - ys.min) || 1)); };
      var colour = function (c) { return c && c.indexOf('--') === 0 ? css(c) : (c || css('--text')); };
      var fx = xs.fmt || function (v) { return Math.round(v).toLocaleString(); };
      var fy = ys.fmt || function (v) { return S.fmt(v, 2); };
      var i, k;
      S.clear(svg);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      var yt = ys.ticks || 4, xt = xs.ticks || 5;
      for (i = 0; i <= yt; i++) {
        var yv = ys.min + (ys.max - ys.min) * i / yt;
        svg.appendChild(el('line', { x1: L, x2: L + iw, y1: Y(yv), y2: Y(yv), class: i ? 'gridline' : 'axisline' }));
        svg.appendChild(el('text', { x: L - 8, y: Y(yv) + 4, class: 'ticktext', 'text-anchor': 'end' }, fy(yv)));
      }
      for (i = 0; i <= xt; i++) {
        var xv = xs.min + (xs.max - xs.min) * i / xt;
        svg.appendChild(el('text', { x: X(xv), y: T + ih + 18, class: 'ticktext', 'text-anchor': 'middle' }, fx(xv)));
      }
      svg.appendChild(el('line', { x1: L, x2: L, y1: T, y2: T + ih, class: 'axisline' }));
      if (xs.label) svg.appendChild(el('text', { x: L + iw / 2, y: H - 5, class: 'ticktext', 'text-anchor': 'middle' }, xs.label));
      if (ys.label) {
        svg.appendChild(el('text', {
          x: 12, y: T + ih / 2, class: 'ticktext', 'text-anchor': 'middle',
          transform: 'rotate(-90 12 ' + (T + ih / 2) + ')'
        }, ys.label));
      }
      (spec.marks || []).forEach(function (m) {
        svg.appendChild(el('line', {
          x1: X(m.x), x2: X(m.x), y1: T, y2: T + ih, stroke: colour(m.colour || '--text-mute'),
          'stroke-width': 1.2, 'stroke-dasharray': '4 4'
        }));
        if (m.label) svg.appendChild(el('text', { x: X(m.x) + 5, y: T + 11, class: 'ticktext' }, m.label));
      });
      var ends = [];
      (spec.series || []).forEach(function (s) {
        var d = '', pts = s.points || [];
        for (k = 0; k < pts.length; k++) {
          var p = pts[k];
          if (p[1] === null || p[1] === undefined || isNaN(p[1])) continue;
          var py = Math.max(T - 2, Math.min(T + ih + 2, Y(p[1])));
          d += (d ? 'L' : 'M') + S.fmt(X(p[0]), 1) + ',' + S.fmt(py, 1);
        }
        if (!d) return;
        var attrs = { d: d, fill: 'none', stroke: colour(s.colour), 'stroke-width': s.width || 2 };
        if (s.dash) attrs['stroke-dasharray'] = s.dash;
        if (s.dots) {
          pts.forEach(function (p) {
            svg.appendChild(el('circle', { cx: X(p[0]), cy: Y(p[1]), r: 3, fill: colour(s.colour) }));
          });
        }
        svg.appendChild(el('path', attrs));
        if (s.end !== false && s.label && pts.length) {
          ends.push({ y: Y(pts[pts.length - 1][1]), t: s.label, c: colour(s.colour) });
        }
      });
      ends.sort(function (a, b) { return a.y - b.y; });
      for (k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
      ends.forEach(function (e) {
        svg.appendChild(el('text', { x: L + iw + 7, y: e.y + 4, class: 'serieslabel', fill: e.c }, e.t));
      });
      if (spec.tip) hover(svg, spec, X, Y, W, H, L, iw, T);
    }
  };

  // hover readout for kit.chart: nearest point of each series to the pointer's x
  function hover(svg, spec, X, Y, W, H, L, iw, T) {
    var tip = spec.tip;
    svg.onpointermove = function (e) {
      var box = svg.getBoundingClientRect();
      var vx = (e.clientX - box.left) / box.width * W;
      if (vx < L - 4 || vx > L + iw + 4) { S.hideTip(tip); return; }
      var xv = spec.x.min + (vx - L) / iw * (spec.x.max - spec.x.min), rows = '', best = null;
      (spec.series || []).forEach(function (s) {
        var pts = s.points || [], j, bj = -1, bd = Infinity;
        for (j = 0; j < pts.length; j++) {
          var dd = Math.abs(pts[j][0] - xv);
          if (dd < bd && pts[j][1] !== null && pts[j][1] !== undefined) { bd = dd; bj = j; }
        }
        if (bj < 0) return;
        if (best === null) best = pts[bj][0];
        var c = s.colour && s.colour.indexOf('--') === 0 ? S.css(s.colour) : s.colour;
        rows += '<div class="row"><i style="background:' + c + '"></i>' + s.label + ' '
          + (spec.y.fmt ? spec.y.fmt(pts[bj][1]) : S.fmt(pts[bj][1], 3)) + '</div>';
      });
      if (best === null) { S.hideTip(tip); return; }
      S.tipAt(tip, svg, W, H, X(best), T,
        '<b>' + (spec.x.label || 'x') + ' ' + (spec.x.fmt ? spec.x.fmt(best) : best) + '</b>' + rows);
    };
    svg.onpointerleave = function () { S.hideTip(tip); };
  }

  /* ---------------- registry, picker and loop ---------------- */

  S.board = function (key, init) {
    inits[key] = init;
    if (current === key) open(key);
  };

  // a board's script loads the first time its tab is picked while the section
  // is near the screen, so the page does not pay for seven boards up front
  function need(key) {
    if (inits[key] || requested[key] || !near) return;
    requested[key] = true;
    kit.load('boards/' + key + '.js?v=' + VERSION, function (err) {
      if (!err) return;
      var live = $('[data-board="' + key + '"] .boardlive', section);
      if (live) live.innerHTML = '<p class="note">This board could not be loaded. Reload the page to try again.</p>';
    });
  }
  S.kit = kit;

  var pick = $('#qPick');
  var tabs = $$('[data-q]', pick);

  function open(key) {
    if (!boards[key] && inits[key]) {
      var root = $('[data-board="' + key + '"]', section);
      boards[key] = inits[key](root, kit) || {};
    }
    var b = boards[key];
    if (b && b.show) b.show();
    loop();
  }

  // user picks rewrite the hash so a board can be linked to; the initial pick does not
  function select(key, focus, quiet) {
    if (!$('[data-board="' + key + '"]', section)) return;
    if (current && current !== key && boards[current] && boards[current].hide) boards[current].hide();
    current = key;
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-q') === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('[data-board]', section).forEach(function (p) { p.hidden = p.getAttribute('data-board') !== key; });
    if (!quiet) { try { history.replaceState(null, '', '#q-' + key); } catch (e) { } }
    need(key);
    open(key);
  }

  tabs.forEach(function (t, k) {
    t.addEventListener('click', function () { select(t.getAttribute('data-q')); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      select(tabs[(k + d + tabs.length) % tabs.length].getAttribute('data-q'), true);
    });
  });
  // the verdict table's rows open their board
  $$('[data-open]', section).forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      select(a.getAttribute('data-open'));
      pick.scrollIntoView({ behavior: S.reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

  function frame(t) {
    raf = null;
    if (!onScreen || document.hidden) return;
    var b = boards[current];
    if (b && b.frame) b.frame(t);
    raf = requestAnimationFrame(frame);
  }
  function loop() { if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      onScreen = es[es.length - 1].isIntersecting;
      loop();
    }, { rootMargin: '120px 0px' }).observe(section);
    new IntersectionObserver(function (es) {
      near = es[es.length - 1].isIntersecting;
      if (near && current) need(current);
    }, { rootMargin: '900px 0px' }).observe(section);
  } else {
    onScreen = near = true;
  }
  document.addEventListener('visibilitychange', loop);

  // in-page links to #q-<key> open that board
  window.addEventListener('hashchange', function () {
    var m = /^#q-([a-z]+)$/.exec(location.hash);
    if (m) select(m[1], false, true);
  });

  var want = /^#q-([a-z]+)$/.exec(location.hash);
  select(want && $('[data-board="' + want[1] + '"]', section) ? want[1] : tabs[0].getAttribute('data-q'), false, true);

  // A deep link lands before the figures above have their height, so keep the
  // section at the top while the layout settles, until the visitor scrolls.
  if (want) {
    var stop = false, t0 = Date.now();
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) {
      window.addEventListener(ev, function () { stop = true; }, { once: true, passive: true });
    });
    (function settle() {
      if (stop || Date.now() - t0 > 5000) return;
      if (Math.abs(section.getBoundingClientRect().top - 56) > 4) section.scrollIntoView({ behavior: 'instant', block: 'start' });
      setTimeout(settle, 150);
    })();
  }
})();
