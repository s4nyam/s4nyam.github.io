/* Interactive t-SNE of every generative arm (paper Figure 16). Data: assets/data/tsne.js (window.PDS_TSNE),
   written by manuscript/figure-sources/make_tsne_interactive.py. Faint dots: 600 images per model; filled dots:
   50 images per model whose radiograph is shown when the dot is pointed at (or tapped). */
(function () {
  var D = window.PDS_TSNE, root = document.getElementById('tsneExplore');
  if (!D || !root) return;
  var canvas = document.getElementById('tsneCanvas'), ctx = canvas.getContext('2d');
  var img = document.getElementById('tsneImg'), cap = document.getElementById('tsneCap');
  var legend = document.getElementById('tsneLegend'), sw = document.getElementById('tsnePanel');
  var panel = D.panels.length - 1, hidden = {}, hover = null, pts = [], W = 0, H = 0, PAD = 14;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function layout() {
    var p = D.panels[panel], w = canvas.parentNode.clientWidth;
    var aspect = Math.min(0.92, Math.max(0.55, p.aspect));
    W = w; H = Math.round(w * aspect);
    var r = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * r); canvas.height = Math.round(H * r);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }

  function xy(c) {            // data are 0..1000 on the longer axis
    var p = D.panels[panel], s = Math.min((W - 2 * PAD) / 1000, (H - 2 * PAD) / (1000 * p.aspect));
    var ox = (W - 1000 * s) / 2, oy = (H - 1000 * p.aspect * s) / 2;
    return [ox + c[0] * s, H - (oy + c[1] * s)];
  }

  function draw() {
    var p = D.panels[panel], bg = css('--bg-sunk') || '#f4f4f8', ink = css('--text') || '#16181f';
    ctx.clearRect(0, 0, W, H);
    pts = [];
    // background clouds, real first, PanoDiff last (on top), as in the printed figure
    var order = [p.arms[0]].concat(p.arms.slice(2), [p.arms[1]]);
    order.forEach(function (a) {
      if (hidden[a.key]) return;
      ctx.fillStyle = a.color; ctx.globalAlpha = 0.28;
      a.back.forEach(function (c) { var q = xy(c); ctx.beginPath(); ctx.arc(q[0], q[1], 1.7, 0, 6.2832); ctx.fill(); });
    });
    ctx.globalAlpha = 1;
    order.forEach(function (a) {
      if (hidden[a.key]) return;
      a.show.forEach(function (c, i) {
        var q = xy(c);
        ctx.beginPath(); ctx.arc(q[0], q[1], W < 520 ? 3.2 : 4.2, 0, 6.2832);
        ctx.fillStyle = a.color; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = bg; ctx.stroke();
        pts.push({ x: q[0], y: q[1], arm: a, i: i });
      });
      var m = xy(a.centroid);              // centroid cross
      ctx.lineWidth = 3.2; ctx.strokeStyle = ink; cross(m); ctx.lineWidth = 1.8; ctx.strokeStyle = a.color; cross(m);
    });
    if (hover) {
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 8, 0, 6.2832);
      ctx.lineWidth = 2.2; ctx.strokeStyle = ink; ctx.stroke();
    }
  }
  function cross(m) {
    ctx.beginPath(); ctx.moveTo(m[0] - 5, m[1] - 5); ctx.lineTo(m[0] + 5, m[1] + 5);
    ctx.moveTo(m[0] + 5, m[1] - 5); ctx.lineTo(m[0] - 5, m[1] + 5); ctx.stroke();
  }

  function pick(ev) {
    var r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, best = null, bd = 14 * 14;
    pts.forEach(function (p) { var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y); if (d < bd) { bd = d; best = p; } });
    return best;
  }
  function show(p) {
    if (!p) return;
    hover = p; draw();
    img.src = 'assets/tsne/' + p.arm.key + '/' + (p.i < 10 ? '0' : '') + p.i + '.jpg';
    img.alt = p.arm.label + ', sample ' + (p.i + 1);
    img.classList.toggle('lowres', !!p.arm.lowres);
    cap.innerHTML = '<span class="swatch dot" style="background:' + p.arm.color + '"></span> <b>' + p.arm.label +
      '</b> &middot; sample ' + (p.i + 1) + ' of 50' + (p.arm.lowres ? ' &middot; 256&times;128, shown enlarged' : '');
  }
  canvas.addEventListener('pointermove', function (ev) { var p = pick(ev); if (p && p !== hover) show(p); });
  canvas.addEventListener('pointerdown', function (ev) { show(pick(ev)); });

  function buildLegend() {
    legend.innerHTML = '';
    D.panels[panel].arms.forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('aria-pressed', hidden[a.key] ? 'false' : 'true');
      b.innerHTML = '<span class="swatch dot" style="background:' + a.color + '"></span>' + a.label;
      b.addEventListener('click', function () {
        hidden[a.key] = !hidden[a.key]; b.setAttribute('aria-pressed', hidden[a.key] ? 'false' : 'true');
        if (hover && hover.arm.key === a.key) hover = null;
        draw();
      });
      legend.appendChild(b);
    });
  }
  function setPanel(k) {
    panel = k; hover = null;
    Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(+b.getAttribute('data-panel') === k));
    });
    buildLegend(); layout(); draw();
    var p = D.panels[panel]; show(pts.filter(function (q) { return q.arm.key === p.arms[1].key; })[0]);   // a PanoDiff sample
  }
  Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () { setPanel(+b.getAttribute('data-panel')); });
  });
  var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { layout(); draw(); }, 120); });
  new MutationObserver(function () { draw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setPanel(panel);
})();
