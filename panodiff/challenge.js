/* ==========================================================
   PanoDiff "Real or synthetic?" challenge (section 1).

   - Pool: window.PDS_CHALLENGE (assets/data/challenge.js), 150 real
     DENTEX radiographs and 150 synthetic ones from ten generators.
     A test of n images draws n/2 of each, keeping every stratum's share
     of the pool (largest-remainder rounding), so all lengths see the
     same mix.
   - Storage: Cloud Firestore (project panodiff-42e4a), no sign-in.
     challenge_sessions/{id}      every session, private, saved as it goes
     challenge_leaderboard/{id}   public, one entry per finished session
     challenge_secrets/{id}       SHA-256(id + ":" + delete code), never readable
     challenge_deletions/{id}     written in the same batch as a delete
     The security rules (firestore.rules, deployed separately) check that an
     entry matches its finished session and that a delete carries the code.
   - Score: 100 * (correct + 5) / (images + 10), i.e. the posterior mean of
     the accuracy under a Beta(5, 5) prior (explained in the page).
   - Icons: Lucide (ISC licence), inlined.
   ========================================================== */

const C = window.PDS_CHALLENGE;
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LIMIT = 12000;          // ms each radiograph stays visible, as in the study
const BLOCK = 50;             // images between breaks
const EST_S = 10;             // planning estimate, seconds per image
const PRIOR = 10;             // Beta(5, 5): ten imaginary answers at chance
const NAME_RE = /^[A-Za-z0-9À-ÖØ-öø-ÿ ._'-]{1,24}$/;

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

/* ---------------------------------------------------------------- icons */
const ICONS = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  zoom: '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  contrast: '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
  invert: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  flask: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  medal: '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
};
function icon(name) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
}
function paintIcons(root) {
  $$('[data-icon]', root).forEach(e => {
    if (e.dataset.painted !== e.dataset.icon) { e.innerHTML = icon(e.dataset.icon); e.dataset.painted = e.dataset.icon; }
  });
}

/* ---------------------------------------------------------------- helpers */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => b ? 100 * a / b : 0;
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const scoreOf = (correct, n) => 100 * (correct + PRIOR / 2) / (n + PRIOR);
const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const minutes = s => Math.max(1, Math.round(s / 60));
function median(a) { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function randomId(n) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', v = crypto.getRandomValues(new Uint8Array(n));
  let s = ''; for (let i = 0; i < n; i++) s += A[v[i] % 62]; return s;
}
async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
}
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function ago(d) {
  if (!d) return 'just now';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'; if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const LS_KEY = 'panodiff-challenge';
function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
function lsSet(o) { try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) { /* private mode */ } }

/* ---------------------------------------------------------------- pool */
const POOL = (() => {
  const k = new TextEncoder().encode('panodiff-sr-2026');
  const b = Uint8Array.from(atob(C.pool), c => c.charCodeAt(0));
  for (let i = 0; i < b.length; i++) b[i] ^= k[i % k.length];
  return JSON.parse(new TextDecoder().decode(b));
})();
const STRATA = {};
POOL.forEach(p => { (STRATA[p.s] = STRATA[p.s] || []).push(p); });

// n/2 synthetic and n/2 real, each stratum at its pool share (largest remainder), then shuffled
function draw(n, seed) {
  const rnd = mulberry32(seed), out = [];
  [1, 0].forEach(truth => {
    const keys = Object.keys(STRATA).filter(k => STRATA[k][0].t === truth).sort();
    const total = keys.reduce((a, k) => a + STRATA[k].length, 0), want = n / 2;
    const q = keys.map(k => ({ k, exact: STRATA[k].length * want / total }));
    q.forEach(x => { x.n = Math.floor(x.exact); });
    let left = want - q.reduce((a, x) => a + x.n, 0);
    q.slice().sort((a, b) => (b.exact - b.n) - (a.exact - a.n) || a.k.localeCompare(b.k)).forEach(x => { if (left > 0) { x.n++; left--; } });
    q.forEach(x => { out.push(...shuffle(STRATA[x.k].slice(), rnd).slice(0, x.n)); });
  });
  return shuffle(out, rnd);
}

/* ---------------------------------------------------------------- Firestore */
let storeP = null;
function store() {
  if (!storeP) {
    storeP = Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-firestore.js')])
      .then(([app, fs]) => ({ fs, db: fs.getFirestore(app.initializeApp(C.firebase, 'panodiff-challenge')) }))
      .catch(e => { storeP = null; throw e; });
  }
  return storeP;
}

/* ---------------------------------------------------------------- DOM */
const el = {
  setup: $('#chSetup'), run: $('#chRun'), done: $('#chDone'),
  name: $('#chName'), nameHelp: $('#chNameHelp'), code: $('#chCode'), lengths: $('#chLengths'), fs: $('#chFs'), fsRow: $('#chFsRow'),
  start: $('#chStart'), startNote: $('#chStartNote'),
  idx: $('#chIdx'), n: $('#chN'), block: $('#chBlock'), elapsed: $('#chElapsed'), left: $('#chLeft'), fsBtn: $('#chFsBtn'),
  keysBtn: $('#chKeysBtn'), keys: $('#chKeys'), keysClose: $('#chKeysClose'), progress: $('#chProgress'), pfill: $('#chPfill'),
  stage: $('#chStage'), img: $('#chImg'), lens: $('#chLens'), cdRing: $('#chCdRing'), cdNum: $('#chCdNum'), bar: $('#chBar'), loading: $('#chLoading'),
  tLens: $('#tLens'), tZoom: $('#tZoom'), tZoomV: $('#tZoomV'), tBright: $('#tBright'), tContrast: $('#tContrast'), tInvert: $('#tInvert'), tReset: $('#tReset'),
  real: $('#chReal'), synth: $('#chSynth'), save: $('#chSave'),
  brk: $('#chBreak'), brkTitle: $('#chBreakTitle'), brkNote: $('#chBreakNote'), cont: $('#chContinue'),
  rScore: $('#rScore'), rScoreNote: $('#rScoreNote'), rAcc: $('#rAcc'), rSens: $('#rSens'), rSpec: $('#rSpec'), rRank: $('#rRank'), rRankLab: $('#rRankLab'),
  rStatus: $('#rStatus'), rModels: $('#rModels tbody'), rStudy: $('#rStudy'), rGrid: $('#rGrid'), rAgain: $('#rAgain'), rShare: $('#rShare'), rRetry: $('#rRetry'),
  lbLive: $('#lbLive'), lbInfoBtn: $('#lbInfoBtn'), lbInfo: $('#lbInfo'), lbBody: $('#lbTable tbody'),
  delName: $('#delName'), delCode: $('#delCode'), delBtn: $('#delBtn'), delMsg: $('#delMsg'),
};
paintIcons(document);

function view(which) {
  [el.setup, el.run, el.done].forEach(v => { v.hidden = v !== which; });
}

/* ---------------------------------------------------------------- setup */
let chosenN = 50;
const LS0 = lsGet();
if (LS0.lastName) el.name.value = LS0.lastName;
$$('[data-est]').forEach(s => {
  const n = +s.dataset.est, br = n / BLOCK - 1;
  s.textContent = 'about ' + minutes(n * EST_S) + ' min' + (br > 0 ? ' + ' + br + ' break' + (br > 1 ? 's' : '') : '');
});
$$('button', el.lengths).forEach(b => b.addEventListener('click', () => {
  $$('button', el.lengths).forEach(o => o.setAttribute('aria-checked', o === b));
  chosenN = +b.dataset.n; validate();
}));
el.lengths.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const bs = $$('button', el.lengths), i = bs.findIndex(b => +b.dataset.n === chosenN);
  const j = (i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length; bs[j].click(); bs[j].focus(); e.preventDefault();
});
function cleanName() { return el.name.value.replace(/\s+/g, ' ').trim(); }
function validate() {
  const v = cleanName(), ok = NAME_RE.test(v) && /[A-Za-z0-9À-ÿ]/.test(v);
  const code = el.code.value.trim(), codeOk = !code || (code.length >= 4 && code.length <= 32);
  el.name.classList.toggle('bad', !!v && !ok);
  el.nameHelp.classList.toggle('bad', !!v && !ok);
  el.code.classList.toggle('bad', !codeOk);
  el.start.disabled = !(ok && codeOk);
  el.startNote.textContent = !v ? 'Enter a name to start.' : !ok ? 'That name has characters we cannot store.'
    : !codeOk ? 'A delete code needs 4 to 32 characters.' : chosenN + ' images, about ' + minutes(chosenN * EST_S) + ' minutes. Good luck.';
  return ok && codeOk;
}
el.name.addEventListener('input', validate);
el.code.addEventListener('input', validate);
el.name.addEventListener('keydown', e => { if (e.key === 'Enter' && validate()) startTest(); });
el.start.addEventListener('click', () => { if (validate()) startTest(); });
validate();

/* ---------------------------------------------------------------- full screen */
const fsApi = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
function setFs(on) {
  if (fsApi) {
    try {
      if (on && fsElement() !== el.run) {
        const p = (el.run.requestFullscreen || el.run.webkitRequestFullscreen).call(el.run);
        if (p && p.catch) p.catch(() => applyFs(true));      // refused: fall back to the in-page viewer
      } else if (!on && fsElement()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else if (!on) applyFs(false);
    } catch (e) { applyFs(on); }
  } else applyFs(on);                                          // e.g. iPhone: fill the window instead
}
function applyFs(on) {
  el.run.classList.toggle('fs', on);
  document.documentElement.style.overflow = on && !fsElement() ? 'hidden' : '';
  el.fsBtn.querySelector('.ico').dataset.icon = on ? 'minimize' : 'maximize'; paintIcons(el.fsBtn);
  el.fsBtn.title = on ? 'Leave full screen (F)' : 'Full screen (F)';
  if (on && S.running) { S.fsUsed = true; S.tools.fs = (S.tools.fs || 0) + 1; }
  hideLens();
}
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => applyFs(fsElement() === el.run)));
if (!fsApi) { $('.fhelp', el.fsRow).textContent = '(this browser has no true full screen, so the test fills the window instead; bigger image, magnifier and window/level tools)'; }
el.fsBtn.addEventListener('click', () => setFs(!el.run.classList.contains('fs')));

/* ---------------------------------------------------------------- test state */
const S = { running: false };
let rafId = 0, hudTimer = 0;

function startTest() {
  const name = cleanName(), typed = el.code.value.trim();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  Object.assign(S, {
    running: true, sid: randomId(24), name, n: chosenN, seed, items: draw(chosenN, seed), idx: 0, answers: [],
    correct: 0, cr: 0, cs: 0, breaks: [], tools: {}, fsUsed: false, onBreak: false, accepting: false,
    acc: 0, from: 0, created: false, finished: false, code: typed || randomId(12), codeTyped: !!typed, chain: Promise.resolve(), cur: {},
  });
  const ls = lsGet(); ls.lastName = name; lsSet(ls);
  el.n.textContent = S.n; el.pfill.style.width = '0%';
  $$('.brk', el.progress).forEach(b => b.remove());
  for (let k = BLOCK; k < S.n; k += BLOCK) {
    const m = document.createElement('span'); m.className = 'brk'; m.style.left = pct(k, S.n) + '%'; m.dataset.at = k;
    m.innerHTML = '<span class="ico" data-icon="coffee"></span>'; m.title = 'Break after image ' + k; el.progress.appendChild(m);
  }
  paintIcons(el.progress);
  resetView();
  view(el.run);
  if (el.fs.checked) setFs(true);
  el.run.scrollIntoView({ block: 'start', behavior: 'smooth' });
  resume(); showItem(0);
  hudTimer = setInterval(hud, 500);
  sync('started');
}
function activeMs() { return S.acc + (S.from ? performance.now() - S.from : 0); }
function resume() { if (!S.from) S.from = performance.now(); }
function pause() { if (S.from) { S.acc += performance.now() - S.from; S.from = 0; } }

function hud() {
  if (!S.items) return;
  const done = S.answers.length, a = activeMs();
  el.idx.textContent = Math.min(done + 1, S.n);
  const blocks = Math.ceil(S.n / BLOCK); el.block.textContent = 'Block ' + Math.min(Math.floor(done / BLOCK) + 1, blocks) + ' of ' + blocks;
  el.elapsed.textContent = mmss(a);
  const per = done >= 5 ? a / done : EST_S * 1000, left = (S.n - done) * per;
  el.left.textContent = done >= S.n ? 'done' : '~' + (left < 60000 ? '<1' : Math.round(left / 60000)) + ' min left';
  el.pfill.style.width = pct(done, S.n) + '%';
  $$('.brk', el.progress).forEach(b => b.classList.toggle('done', done >= +b.dataset.at));
}

function showItem(i) {
  const it = S.items[i];
  S.accepting = false; S.cur = { lens: false, hid: false };
  el.stage.classList.remove('expired');
  el.loading.hidden = false;
  cancelAnimationFrame(rafId);
  el.bar.style.transform = 'scaleX(1)'; el.cdRing.style.strokeDashoffset = 0; el.cdNum.textContent = LIMIT / 1000;
  el.img.onload = () => {
    el.loading.hidden = true; S.shownAt = performance.now(); S.accepting = true;
    el.real.disabled = el.synth.disabled = false;
    rafId = requestAnimationFrame(tick);
  };
  el.img.onerror = () => { el.loading.textContent = 'Could not load this image. Check your connection; it will retry.'; setTimeout(() => { el.img.src = src + '?r=' + Date.now(); }, 2500); };
  const src = 'assets/challenge/' + it.id + '.jpg';
  el.real.disabled = el.synth.disabled = true;
  el.img.src = src;
  for (let k = 1; k <= 3 && i + k < S.n; k++) new Image().src = 'assets/challenge/' + S.items[i + k].id + '.jpg';
  hud();
}
function tick() {
  const left = Math.max(0, LIMIT - (performance.now() - S.shownAt)), f = left / LIMIT;
  el.bar.style.transform = 'scaleX(' + f + ')';
  el.cdRing.style.strokeDashoffset = (97.4 * (1 - f)).toFixed(2);
  el.cdNum.textContent = Math.ceil(left / 1000);
  if (left <= 0) { el.stage.classList.add('expired'); hideLens(); return; }
  rafId = requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && S.running && !S.onBreak) S.cur.hid = true; });

function answer(a) {
  if (!S.running || !S.accepting || S.onBreak || !el.keys.hidden) return;
  const rt = performance.now() - S.shownAt;
  if (rt < 250) return;                                  // guard against double clicks
  S.accepting = false; cancelAnimationFrame(rafId);
  const it = S.items[S.idx], truth = it.t ? 's' : 'r', ok = a === truth;
  let fl = '';
  if (rt > LIMIT) fl += 't';
  if (S.cur.lens) fl += 'z';
  if (+el.tBright.value !== 100 || +el.tContrast.value !== 100) fl += 'w';
  if (el.tInvert.getAttribute('aria-pressed') === 'true') fl += 'i';
  if (el.run.classList.contains('fs')) fl += 'f';
  if (S.cur.hid) fl += 'h';
  S.answers.push({ id: it.id, a, rt: Math.round(rt), fl });
  if (ok) { S.correct++; if (it.t) S.cs++; else S.cr++; }
  const btn = a === 'r' ? el.real : el.synth;
  btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 160);
  S.idx++;
  hud();
  if (S.idx === S.n) return finish();
  if (S.idx % BLOCK === 0) return startBreak();      // the break saves progress
  if (S.idx % 10 === 0) sync('in_progress');
  showItem(S.idx);
}
el.real.addEventListener('click', () => answer('r'));
el.synth.addEventListener('click', () => answer('s'));

/* ---------------------------------------------------------------- breaks */
function startBreak() {
  pause(); S.onBreak = true; S.breakFrom = performance.now(); hideLens();
  const k = S.idx / BLOCK, m = Math.ceil(S.n / BLOCK), left = S.n - S.idx;
  el.brkTitle.textContent = 'Block ' + k + ' of ' + m + ' done';
  const per = activeMs() / S.idx;
  el.brkNote.textContent = left + ' images to go, about ' + minutes(left * per / 1000) + ' min at your pace. Your answers so far are saved.';
  el.brk.hidden = false; el.cont.focus();
  sync('in_progress');
}
function endBreak() {
  if (!S.onBreak) return;
  S.breaks.push({ after: S.idx, ms: Math.round(performance.now() - S.breakFrom) });
  S.onBreak = false; el.brk.hidden = true; resume(); showItem(S.idx);
}
el.cont.addEventListener('click', endBreak);

/* ---------------------------------------------------------------- viewing tools */
let lensOn = false, zoom = 2.5;
function applyFilter() {
  const inv = el.tInvert.getAttribute('aria-pressed') === 'true';
  const f = 'brightness(' + el.tBright.value + '%) contrast(' + el.tContrast.value + '%)' + (inv ? ' invert(1)' : '');
  el.img.style.filter = f; el.lens.style.filter = f;
}
function useTool(k) { if (S.running) S.tools[k] = (S.tools[k] || 0) + 1; }
function setLens(on) {
  lensOn = on; el.tLens.setAttribute('aria-pressed', on); el.stage.classList.toggle('lensing', on);
  if (!on) hideLens(); else useTool('lens');
}
function hideLens() { el.lens.hidden = true; }
function setZoom(z) { zoom = Math.min(5, Math.max(1.5, z)); el.tZoom.value = zoom; el.tZoomV.textContent = zoom + '×'; }
function moveLens(e) {
  if (!lensOn || el.stage.classList.contains('expired') || !el.img.naturalWidth) return hideLens();
  const r = el.img.getBoundingClientRect();
  // the image is letterboxed by object-fit: contain; work out the drawn box
  const ar = el.img.naturalWidth / el.img.naturalHeight;
  let w = r.width, h = r.width / ar;
  if (h > r.height) { h = r.height; w = h * ar; }
  const ox = r.left + (r.width - w) / 2, oy = r.top + (r.height - h) / 2, x = e.clientX - ox, y = e.clientY - oy;
  if (x < 0 || y < 0 || x > w || y > h) return hideLens();
  el.lens.hidden = false;
  const sr = el.stage.getBoundingClientRect(), L = el.lens.offsetWidth || 190;
  el.lens.style.left = (e.clientX - sr.left) + 'px'; el.lens.style.top = (e.clientY - sr.top) + 'px';
  el.lens.style.backgroundImage = 'url("' + el.img.src + '")';
  el.lens.style.backgroundSize = (w * zoom) + 'px ' + (h * zoom) + 'px';
  el.lens.style.backgroundPosition = (L / 2 - x * zoom) + 'px ' + (L / 2 - y * zoom) + 'px';
  S.cur.lens = true;
}
el.stage.addEventListener('pointermove', moveLens);
el.stage.addEventListener('pointerdown', e => { if (lensOn) { el.stage.setPointerCapture && el.stage.setPointerCapture(e.pointerId); moveLens(e); } });
el.stage.addEventListener('pointerleave', hideLens);
el.stage.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') hideLens(); });
el.tLens.addEventListener('click', () => setLens(!lensOn));
el.tZoom.addEventListener('input', () => { setZoom(+el.tZoom.value); useTool('zoom'); });
[el.tBright, el.tContrast].forEach(s => s.addEventListener('input', () => { applyFilter(); useTool('window'); }));
el.tInvert.addEventListener('click', () => { el.tInvert.setAttribute('aria-pressed', el.tInvert.getAttribute('aria-pressed') !== 'true'); applyFilter(); useTool('invert'); });
el.tReset.addEventListener('click', () => { el.tBright.value = 100; el.tContrast.value = 100; el.tInvert.setAttribute('aria-pressed', false); applyFilter(); });
function resetView() { el.tBright.value = 100; el.tContrast.value = 100; el.tInvert.setAttribute('aria-pressed', false); setLens(false); setZoom(2.5); applyFilter(); el.keys.hidden = true; el.brk.hidden = true; }
function toggleKeys(open) { el.keys.hidden = open === undefined ? !el.keys.hidden : !open; if (!el.keys.hidden) el.keysClose.focus(); }
el.keysBtn.addEventListener('click', () => toggleKeys());
el.keysClose.addEventListener('click', () => toggleKeys(false));

document.addEventListener('keydown', e => {
  if (el.run.hidden || !S.running) return;
  const k = e.key, tag = e.target.tagName;
  if (tag === 'INPUT' && e.target.type !== 'range') return;
  if (!el.keys.hidden) { if (k === 'Escape' || k === '?' || k === 'Enter') { toggleKeys(false); e.preventDefault(); } return; }
  if (S.onBreak) { if (k === 'Enter' || k === ' ') { endBreak(); e.preventDefault(); } return; }
  const map = { r: 'r', R: 'r', ArrowLeft: 'r', s: 's', S: 's', ArrowRight: 's' };
  if (map[k]) { e.preventDefault(); if (tag === 'INPUT') e.target.blur(); return answer(map[k]); }
  if (k === 'f' || k === 'F') { e.preventDefault(); setFs(!el.run.classList.contains('fs')); }
  else if (k === 'z' || k === 'Z') { e.preventDefault(); setLens(!lensOn); }
  else if (k === '+' || k === '=') { e.preventDefault(); setZoom(zoom + .5); }
  else if (k === '-' || k === '_') { e.preventDefault(); setZoom(zoom - .5); }
  else if (k === 'i' || k === 'I') { e.preventDefault(); el.tInvert.click(); }
  else if (k === '0') { e.preventDefault(); el.tReset.click(); }
  else if (k === '?') { e.preventDefault(); toggleKeys(true); }
});
window.addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('pagehide', () => { if (S.running && S.answers.length) sync('abandoned'); });

/* ---------------------------------------------------------------- saving */
function clientInfo() {
  return {
    w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio || 1,
    touch: 'ontouchstart' in window, fsApi, lang: (navigator.language || '').slice(0, 12),
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '').slice(0, 40), ua: navigator.userAgent.slice(0, 160),
  };
}
function sessionFields(fs, status) {
  return {
    v: 1, name: S.name, n: S.n, status, answered: S.answers.length, correct: S.correct, correctReal: S.cr, correctSynth: S.cs,
    answers: S.answers.map(x => x.id + ':' + x.a + ':' + x.rt + ':' + x.fl), activeMs: Math.round(activeMs()),
    tools: S.tools, breaks: S.breaks, fullscreenUsed: S.fsUsed, updatedAt: fs.serverTimestamp(),
  };
}
// Writes are chained so that they reach the server in order; a failed write is retried by the next one.
function sync(status) {
  const run = S;
  S.chain = S.chain.then(async () => {
    const { fs, db } = await store();
    const ref = fs.doc(db, 'challenge_sessions', run.sid);
    if (!run.created) {
      await fs.setDoc(ref, Object.assign(sessionFields(fs, status), { items: run.items.map(x => x.id), client: clientInfo(), startedAt: fs.serverTimestamp() }));
      run.created = true;
    } else {
      await fs.updateDoc(ref, sessionFields(fs, status));
    }
    if (status !== 'completed') el.save.textContent = 'Progress saved (' + run.answers.length + ' answers).';
  }).catch(err => { el.save.textContent = 'Could not save progress yet (' + (err.code || 'offline') + '); retrying later.'; throw err; });
  S.chain = S.chain.catch(() => {});
  return S.chain;
}
async function postEntry() {
  const { fs, db } = await store();
  // the session must be marked complete on the server before the entry, which the rules check against it
  await new Promise((resolve, reject) => {
    S.chain = S.chain.then(async () => {
      const ref = fs.doc(db, 'challenge_sessions', S.sid);
      if (!S.created) {
        await fs.setDoc(ref, Object.assign(sessionFields(fs, 'completed'), { items: S.items.map(x => x.id), client: clientInfo(), startedAt: fs.serverTimestamp(), finishedAt: fs.serverTimestamp() }));
        S.created = true;
      } else {
        await fs.updateDoc(ref, Object.assign(sessionFields(fs, 'completed'), { finishedAt: fs.serverTimestamp() }));
      }
    }).then(resolve, reject);
    S.chain = S.chain.catch(() => {});
  });
  const b = fs.writeBatch(db), name = S.name;
  b.set(fs.doc(db, 'challenge_leaderboard', S.sid), {
    v: 1, name, nameLower: name.toLowerCase(), n: S.n, correct: S.correct, correctReal: S.cr, correctSynth: S.cs,
    score: scoreOf(S.correct, S.n), medianMs: Math.round(median(S.answers.map(x => x.rt))), fullscreen: S.fsUsed,
    createdAt: fs.serverTimestamp(),
  });
  b.set(fs.doc(db, 'challenge_secrets', S.sid), { codeHash: await sha256hex(S.sid + ':' + S.code) });
  await b.commit();
  const ls = lsGet(); ls.entries = ls.entries || {}; ls.entries[S.sid] = { code: S.code, name }; lsSet(ls);
}

/* ---------------------------------------------------------------- results */
let lastResult = null;
function finish() {
  S.running = false; S.finished = true; pause(); clearInterval(hudTimer); cancelAnimationFrame(rafId);
  if (el.run.classList.contains('fs')) setFs(false);
  view(el.done);
  const n = S.n, h = n / 2, sc = scoreOf(S.correct, n);
  lastResult = { name: S.name, n, correct: S.correct, score: sc, sid: S.sid };
  el.rScore.textContent = f1(sc);
  el.rScoreNote.textContent = '= 100 × (' + S.correct + ' + 5) / (' + n + ' + 10)';
  el.rAcc.textContent = f1(pct(S.correct, n)) + '%';
  el.rSens.textContent = f1(pct(S.cs, h)) + '%';
  el.rSpec.textContent = f1(pct(S.cr, h)) + '%';
  el.rRank.textContent = '…'; el.rRankLab.textContent = 'rank';
  bars();
  models();
  review('all');
  $('#rReview').open = false;
  el.done.scrollIntoView({ block: 'start', behavior: 'smooth' });
  submit();
}
function bars() {
  const n = S.n, you = pct(S.correct, n);
  const byId = new Map(S.items.map(x => [x.id, x]));
  let det = 0; S.items.forEach(x => { if ((x.p >= 0.5 ? 1 : 0) === x.t) det++; });
  const detPct = pct(det, n);
  $('#rbYou').style.width = you + '%'; $('#rbYouV').textContent = f1(you) + '% (' + S.correct + '/' + n + ')';
  $('#rbDet').style.width = detPct + '%'; $('#rbDetV').textContent = f1(detPct) + '%';
  $('#rbDent').style.width = '68.5%'; $('#rbChance').style.width = '50%';
  // images that were also in the paper's study: you against the six dentists on exactly those images
  const st = S.answers.filter(x => byId.get(x.id).d);
  if (st.length) {
    let me = 0, dent = 0;
    st.forEach(x => {
      const it = byId.get(x.id); if ((x.a === 's') === !!it.t) me++;
      for (const c of it.d) dent += c === 'u' ? .5 : ((c === 'f' || c === 'F') === !!it.t ? 1 : 0);
    });
    el.rStudy.innerHTML = '<b>' + st.length + '</b> of your images were also in the paper’s study. On those, you scored <b>' +
      f1(pct(me, st.length)) + '%</b> and the six dentists <b>' + f1(100 * dent / (6 * st.length)) + '%</b> (unsure counted as half).';
  } else el.rStudy.textContent = '';
}
function models() {
  const rows = {};
  S.answers.forEach(x => {
    const it = POOL.find(p => p.id === x.id), r = rows[it.m] = rows[it.m] || { shown: 0, real: 0 };
    r.shown++; if (x.a === 'r') r.real++;
  });
  const keys = Object.keys(rows).sort((a, b) => (a === 'dentex') - (b === 'dentex') || rows[b].real / rows[b].shown - rows[a].real / rows[a].shown);
  el.rModels.innerHTML = keys.map(k => {
    const m = C.models[k], r = rows[k], real = k === 'dentex';
    return '<tr' + (real ? ' class="grouphead"' : '') + '><td>' + esc(m.name) + ' <span class="note">(' + esc(m.family) + ')</span></td><td>' + r.shown +
      '</td><td>' + r.real + ' <span class="note">(' + Math.round(pct(r.real, r.shown)) + '%)</span></td></tr>';
  }).join('');
}
let revFilter = 'all';
function review(filter) {
  revFilter = filter;
  const byId = new Map(POOL.map(p => [p.id, p]));
  el.rGrid.innerHTML = S.answers.map((x, i) => {
    const it = byId.get(x.id), truth = it.t ? 's' : 'r', ok = x.a === truth, m = C.models[it.m];
    if (filter === 'wrong' && ok) return ''; if (filter === 'synthetic' && !it.t) return ''; if (filter === 'real' && it.t) return '';
    const dv = it.d ? [...it.d].filter(c => c === 'r' || c === 'R').length : null;
    return '<div class="rev ' + (ok ? 'ok' : 'no') + '" data-i="' + i + '" tabindex="0" role="button" aria-label="Enlarge image ' + (i + 1) + '">' +
      '<img loading="lazy" src="assets/challenge/' + it.id + '.jpg" alt="">' +
      '<div class="rv"><span class="tag ' + (ok ? 'ok' : 'no') + '"><span class="ico" data-icon="' + (ok ? 'check' : 'x') + '"></span>#' + (i + 1) + ' ' +
      (it.t ? 'Synthetic' : 'Real') + '</span> &middot; ' + esc(m.name) + '<br>You: <b>' + (x.a === 'r' ? 'real' : 'synthetic') + '</b> in ' + f1(x.rt / 1000) + ' s' +
      (x.fl.includes('t') ? ' (after the image vanished)' : '') +
      (dv !== null ? '<br>' + dv + ' of 6 dentists said real' : '') +
      '<br>Detector: ' + Math.round(100 * it.p) + '% sure it is synthetic</div></div>';
  }).join('') || '<p class="note">Nothing here — no mistakes in this group.</p>';
  paintIcons(el.rGrid);
}
$$('.revfilter button').forEach(b => b.addEventListener('click', () => {
  $$('.revfilter button').forEach(o => o.setAttribute('aria-pressed', o === b)); review(b.dataset.rf);
}));
let lightbox = null;
function openLightbox(i) {
  const x = S.answers[i], it = POOL.find(p => p.id === x.id), m = C.models[it.m];
  if (!lightbox) {
    lightbox = document.createElement('div'); lightbox.className = 'chbox'; lightbox.hidden = true;
    lightbox.innerHTML = '<button type="button" class="iconbtn" aria-label="Close"><span class="ico" data-icon="x"></span></button><figure><img alt=""><figcaption></figcaption></figure>';
    document.body.appendChild(lightbox); paintIcons(lightbox);
    lightbox.addEventListener('click', e => { if (e.target === lightbox || e.target.closest('.iconbtn')) lightbox.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && lightbox && !lightbox.hidden) lightbox.hidden = true; });
  }
  $('img', lightbox).src = 'assets/challenge/' + it.id + '.jpg';
  $('figcaption', lightbox).textContent = '#' + (i + 1) + ' — ' + (it.t ? 'synthetic, ' : 'real, ') + m.name + '. ' + m.about +
    ' You answered ' + (x.a === 'r' ? 'real' : 'synthetic') + '.';
  lightbox.hidden = false;
}
el.rGrid.addEventListener('click', e => { const c = e.target.closest('.rev'); if (c) openLightbox(+c.dataset.i); });
el.rGrid.addEventListener('keydown', e => { const c = e.target.closest('.rev'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openLightbox(+c.dataset.i); } });

function status(msg, cls) { el.rStatus.textContent = msg; el.rStatus.className = 'status' + (cls ? ' ' + cls : ''); }
async function submit() {
  el.rRetry.hidden = true;
  status('Saving your result to the leaderboard…');
  try {
    await postEntry();
    status(S.codeTyped ? 'Saved. You are on the leaderboard; your delete code is the one you chose.'
      : 'Saved. You are on the leaderboard. This browser keeps a delete code for the entry (code: ' + S.code + ').', 'ok');
    watchLeaderboard();
    rank();
  } catch (err) {
    status('Could not reach the leaderboard (' + (err.code || err.message || 'offline') + '). Your result is still here: press “Retry saving”.', 'err');
    el.rRetry.hidden = false; el.rRank.textContent = '–';
  }
}
el.rRetry.addEventListener('click', submit);
async function rank() {
  try {
    const { fs, db } = await store(), col = fs.collection(db, 'challenge_leaderboard');
    const [above, all] = await Promise.all([
      fs.getCountFromServer(fs.query(col, fs.where('score', '>', lastResult.score))),
      fs.getCountFromServer(col)]);
    el.rRank.textContent = '#' + (above.data().count + 1);
    el.rRankLab.textContent = 'of ' + all.data().count + ' entries';
  } catch (e) { el.rRank.textContent = '–'; }
}
el.rAgain.addEventListener('click', () => { view(el.setup); validate(); el.setup.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
el.rShare.addEventListener('click', async () => {
  const r = lastResult; if (!r) return;
  const t = 'I scored ' + f1(r.score) + ' (' + r.correct + '/' + r.n + ' correct) on the PanoDiff real-vs-synthetic radiograph challenge. Can you beat it? https://s4nyam.github.io/panodiff/#test';
  try { await navigator.clipboard.writeText(t); el.rShare.lastChild.textContent = 'Copied'; }
  catch (e) { window.prompt('Copy your result:', t); }
  setTimeout(() => { el.rShare.lastChild.textContent = 'Copy my result'; }, 2000);
});

/* ---------------------------------------------------------------- leaderboard */
let lbRows = [], lbUnsub = null, lbFirst = true;
function setLive(state, text) {
  el.lbLive.className = 'badge live ' + state;
  el.lbLive.innerHTML = '<span class="dot"></span>' + esc(text);
}
function lbSort(a, b) {
  return (b.score - a.score) || (b.n - a.n) || ((a.medianMs || 0) - (b.medianMs || 0)) ||
    ((a.createdAt ? a.createdAt.toMillis() : Infinity) - (b.createdAt ? b.createdAt.toMillis() : Infinity));
}
function renderLB(fresh) {
  const mine = (lsGet().entries) || {};
  if (!lbRows.length) { el.lbBody.innerHTML = '<tr><td colspan="9" class="note">No entries yet. Be the first.</td></tr>'; return; }
  let rank = 0, prev = null;
  el.lbBody.innerHTML = lbRows.map((r, i) => {
    const key = f1(r.score) + '|' + r.n + '|' + r.medianMs;
    if (key !== prev) { rank = i + 1; prev = key; }
    const h = r.n / 2, me = mine[r.id], cls = [me ? 'me' : '', fresh.has(r.id) ? 'fresh' : ''].join(' ').trim();
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + ' data-id="' + esc(r.id) + '"><td>' + (rank <= 3 ? '<span class="ico medal" data-icon="medal"></span>' : '') + rank +
      '</td><td>' + esc(r.name) + '</td><td class="sc">' + f1(r.score) + '</td><td>' + r.correct + '/' + r.n +
      '</td><td>' + Math.round(pct(r.correctSynth, h)) + '%</td><td>' + Math.round(pct(r.correctReal, h)) + '%</td><td>' + f1((r.medianMs || 0) / 1000) + ' s</td><td>' +
      ago(r.createdAt ? r.createdAt.toDate() : null) + '</td><td>' +
      (me ? '<button type="button" class="rm" title="Remove this entry (made in this browser)" aria-label="Remove this entry"><span class="ico" data-icon="trash"></span></button>' : '') + '</td></tr>';
  }).join('');
  paintIcons(el.lbBody);
}
async function watchLeaderboard() {
  if (lbUnsub) return;
  lbUnsub = true;
  try {
    const { fs, db } = await store();
    const q = fs.query(fs.collection(db, 'challenge_leaderboard'), fs.orderBy('score', 'desc'), fs.limit(50));
    lbUnsub = fs.onSnapshot(q, snap => {
      const fresh = new Set();
      if (!lbFirst) snap.docChanges().forEach(c => { if (c.type === 'added') fresh.add(c.doc.id); });
      lbFirst = false;
      lbRows = snap.docs.map(d => Object.assign({ id: d.id }, d.data())).sort(lbSort);
      setLive('on', 'Live · ' + lbRows.length + (lbRows.length === 50 ? '+ entries (top 50 shown)' : lbRows.length === 1 ? ' entry' : ' entries'));
      renderLB(fresh);
    }, err => { setLive('off', 'offline'); el.lbBody.innerHTML = '<tr><td colspan="9" class="note">The leaderboard could not be loaded (' + esc(err.code || 'error') + ').</td></tr>'; lbUnsub = null; });
  } catch (e) {
    lbUnsub = null; setLive('off', 'offline');
    el.lbBody.innerHTML = '<tr><td colspan="9" class="note">The leaderboard could not be reached. Check your connection or blockers; the test still works.</td></tr>';
  }
}
// load the live table only when it is about to scroll into view (saves reads for visitors who never look)
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); watchLeaderboard(); } }, { rootMargin: '600px' });
  io.observe($('#leaderboard'));
} else watchLeaderboard();
setInterval(() => { if (lbRows.length) renderLB(new Set()); }, 60000);   // keep "x min ago" fresh

el.lbInfoBtn.addEventListener('click', () => {
  const open = el.lbInfo.hidden; el.lbInfo.hidden = !open; el.lbInfoBtn.setAttribute('aria-expanded', open);
});

async function removeWithCode(id, code) {
  const { fs, db } = await store(), b = fs.writeBatch(db);
  b.set(fs.doc(db, 'challenge_deletions', id), { codeHash: await sha256hex(id + ':' + code), at: fs.serverTimestamp() });
  b.delete(fs.doc(db, 'challenge_leaderboard', id));
  b.delete(fs.doc(db, 'challenge_secrets', id));
  await b.commit();
  const ls = lsGet(); if (ls.entries) { delete ls.entries[id]; lsSet(ls); }
}
el.lbBody.addEventListener('click', async e => {
  const b = e.target.closest('.rm'); if (!b) return;
  const id = b.closest('tr').dataset.id, ent = (lsGet().entries || {})[id];
  if (!ent || !window.confirm('Remove “' + ent.name + '” from the leaderboard? This cannot be undone.')) return;
  b.disabled = true;
  try { await removeWithCode(id, ent.code); } catch (err) { b.disabled = false; window.alert('Could not remove the entry (' + (err.code || 'error') + ').'); }
});
el.delBtn.addEventListener('click', async () => {
  const name = el.delName.value.replace(/\s+/g, ' ').trim(), code = el.delCode.value.trim();
  if (!name || !code) { el.delMsg.textContent = 'Enter both the name and the delete code.'; return; }
  el.delBtn.disabled = true; el.delMsg.textContent = 'Looking for entries named “' + name + '”…';
  try {
    const { fs, db } = await store();
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'challenge_leaderboard'), fs.where('nameLower', '==', name.toLowerCase()), fs.limit(50)));
    let removed = 0;
    for (const d of snap.docs) { try { await removeWithCode(d.id, code); removed++; } catch (err) { /* the code belongs to another entry */ } }
    el.delMsg.textContent = !snap.size ? 'No entry has that name.' : removed ? 'Removed ' + removed + ' entr' + (removed === 1 ? 'y' : 'ies') + '.'
      : 'Found ' + snap.size + ' entr' + (snap.size === 1 ? 'y' : 'ies') + ' with that name, but the code does not match.';
    if (removed) el.delCode.value = '';
  } catch (err) { el.delMsg.textContent = 'Could not reach the leaderboard (' + (err.code || 'offline') + ').'; }
  el.delBtn.disabled = false;
});

/* ---------------------------------------------------------------- how the images were chosen */
$('#howTable tbody').innerHTML = Object.keys(C.models).sort((a, b) => (a === 'dentex') - (b === 'dentex') || C.models[b].n - C.models[a].n)
  .map(k => { const m = C.models[k]; return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.family) + '</td><td>' + m.n + '</td><td>' + esc(m.about) + '</td></tr>'; }).join('');

