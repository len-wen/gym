// Gym 2.0 – persönliche Fitness-App (PWA)
// Alle Daten liegen lokal im Browser (localStorage) des Geräts.

const KEY = 'gym2-data-v1';
const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm';

// ---------- Hilfsfunktionen ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDate = s => { const d = parseYmd(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
const fmtDateLong = s => parseYmd(s).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const num = (x, digits = 1) => (x == null || isNaN(x)) ? '–' : Number(x).toLocaleString('de-DE', { maximumFractionDigits: digits });
const parseNum = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const roundTo = (x, step) => +(Math.round(x / step) * step).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const exKey = name => name.trim().toLowerCase();
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const mondayOf = s => { const d = parseYmd(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); };
const mmss = sec => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;
const dur = sec => { const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min`; };

// ---------- Standard-Trainingsplan ----------
// kind: barbell | machine | dumbbell | bodyweight   inc: Gewichtssprung in kg
const ex = (name, kind, inc, repMin = 6, repMax = 8) => ({ id: uid(), name, kind, inc, repMin, repMax });
const DEFAULT_PLAN = [
  { id: 'upperA', name: 'Upper A', exercises: [
    ex('Bankdrücken', 'barbell', 2.5), ex('Breites Rudern', 'machine', 2.5), ex('Schulterpresse', 'machine', 2.5),
    ex('Breites Latziehen', 'machine', 2.5), ex('Seitheben', 'dumbbell', 1), ex('Trizeps', 'machine', 2.5),
    ex('Preacher Curls', 'machine', 2.5)] },
  { id: 'upperB', name: 'Upper B', exercises: [
    ex('Klimmzüge', 'bodyweight', 2.5), ex('Schrägbankdrücken', 'dumbbell', 2), ex('Enges Rudern', 'machine', 2.5),
    ex('Butterfly', 'machine', 2.5), ex('Seitheben', 'dumbbell', 1), ex('Biceps', 'dumbbell', 1),
    ex('Trizeps', 'machine', 2.5)] },
  { id: 'lower', name: 'Lower', exercises: [
    ex('Beinbeuger', 'machine', 2.5), ex('Beinpresse', 'machine', 5), ex('Adduktoren', 'machine', 2.5),
    ex('Beinstrecker', 'machine', 2.5), ex('Waden', 'machine', 5), ex('Bauch', 'machine', 2.5)] },
];
const KIND_LABEL = { barbell: 'Langhantel', machine: 'Maschine/Kabel', dumbbell: 'Kurzhantel', bodyweight: 'Körpergewicht' };
const kgLabel = kind => kind === 'dumbbell' ? 'kg/Hand' : kind === 'bodyweight' ? '+kg' : 'kg';

// ---------- Zustand ----------
function defaultState() {
  return {
    settings: {
      bodyweight: 75.6, restSec: 150, warmRestSec: 90,
      kcalGoal: 2500, proteinGoal: 150, carbGoal: 320, fatGoal: 70,
      maxHr: null, claudeKey: '', claudeModel: 'claude-opus-5-5',
    },
    plan: DEFAULT_PLAN,
    workouts: [], active: null,
    bodyweightLog: [{ date: today(), kg: 75.6 }],
    strava: {}, activities: [], food: [], timer: null,
  };
}
let state;
function load() {
  const base = defaultState();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    state = raw ? { ...base, ...raw, settings: { ...base.settings, ...raw.settings } } : base;
  } catch { state = base; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); }
}

function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function openModal(html) { $('#modal-card').innerHTML = html; $('#modal').classList.remove('hidden'); return $('#modal-card'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal-card').innerHTML = ''; if (closeModal.onClose) { closeModal.onClose(); closeModal.onClose = null; } }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- Charts ----------
let charts = [];
function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; }
function makeChart(canvas, config) {
  if (!window.Chart || !canvas) return;
  Chart.defaults.color = '#9aa1b1';
  Chart.defaults.borderColor = '#2e3340';
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, sans-serif';
  config.options = { responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: (config.data.datasets || []).length > 1, labels: { boxWidth: 12 } } }, ...config.options };
  charts.push(new Chart(canvas, config));
}
const BLUE = '#4f8cff', GREEN = '#34c77b', ORANGE = '#f5a524';

// ---------- Trainingslogik ----------
function allPlanExercises() {
  const map = new Map();
  state.plan.forEach(d => d.exercises.forEach(e => { if (!map.has(exKey(e.name))) map.set(exKey(e.name), e); }));
  return map;
}
function findExConfig(name) { return allPlanExercises().get(exKey(name)); }

// Liste aller Einheiten einer Übung: [{date, sets:[{kg,reps}]}] – nur Arbeitssätze, chronologisch
function history(name) {
  const k = exKey(name), out = [];
  [...state.workouts].sort((a, b) => a.date.localeCompare(b.date)).forEach(w => {
    w.entries.forEach(en => {
      if (exKey(en.name) !== k) return;
      const sets = en.sets.filter(s => s.w === 'work' && s.reps > 0).map(s => ({ kg: s.kg || 0, reps: s.reps }));
      if (sets.length) out.push({ date: w.date, sets });
    });
  });
  return out;
}
const e1rm = (kg, reps) => kg * (1 + reps / 30); // Epley-Formel
function sessionBest(sess, kind) {
  const bw = kind === 'bodyweight' ? (state.settings.bodyweight || 0) : 0;
  return Math.max(...sess.sets.map(s => e1rm(s.kg + bw, s.reps)));
}
const topKg = sess => Math.max(...sess.sets.map(s => s.kg));

// Empfehlung nach "doppelter Progression"
function recommend(cfg) {
  const h = history(cfg.name);
  const { repMin, repMax, inc, kind } = cfg;
  if (!h.length) {
    return { type: 'new', kg: null, text: `Erstes Mal: Wähle ein Gewicht, mit dem du ${repMin}–${repMax} saubere Wdh. schaffst.` };
  }
  const last = h[h.length - 1];
  const kg = topKg(last);
  const work = last.sets.filter(s => s.kg === kg);
  const repsStr = last.sets.map(s => s.reps).join('/');
  const allTop = work.every(s => s.reps >= repMax);
  const anyBelow = work.some(s => s.reps < repMin);

  if (allTop) {
    const next = roundTo(kg + inc, 0.25);
    const what = kind === 'bodyweight' && kg === 0 ? `Nimm ${num(inc)} kg Zusatzgewicht` : `Erhöhe auf ${num(next)} ${kgLabel(kind)}`;
    return { type: 'up', kg: next, text: `⬆️ ${what}! Letztes Mal ${num(kg)} kg × ${repsStr} – obere Grenze (${repMax}) geschafft.` };
  }
  if (anyBelow) {
    const prev = h[h.length - 2];
    if (prev && topKg(prev) === kg && prev.sets.filter(s => s.kg === kg).some(s => s.reps < repMin)) {
      const down = Math.max(0, roundTo(kg * 0.9, inc));
      return { type: 'down', kg: down, text: `⬇️ Zweimal unter ${repMin} Wdh. mit ${num(kg)} kg. Geh auf ${num(down)} kg runter und arbeite dich wieder hoch.` };
    }
    return { type: 'hold', kg, text: `Letztes Mal ${num(kg)} kg × ${repsStr} – knapp unter ${repMin}. Gleiches Gewicht, nochmal versuchen.` };
  }
  // Stagnation: 3 Einheiten gleiches Gewicht ohne mehr Gesamt-Wdh.
  if (h.length >= 3) {
    const l3 = h.slice(-3);
    const same = l3.every(s => topKg(s) === kg);
    const tot = l3.map(s => s.sets.reduce((a, b) => a + b.reps, 0));
    if (same && tot[2] <= tot[0]) {
      return { type: 'stall', kg, text: `⚠️ Seit 3 Einheiten kein Fortschritt bei ${num(kg)} kg. Prüfe Schlaf/Essen, oder mach eine leichtere Woche (~10 % weniger) und steigere dann neu.` };
    }
  }
  return { type: 'hold', kg, text: `Bleib bei ${num(kg)} ${kgLabel(kind)}. Letztes Mal ${repsStr} – Ziel: mehr Wdh., bis du ${repMax}/${repMax} schaffst.` };
}

// ---------- Timer ----------
let actx;
function unlockAudio() {
  try {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
    if (actx.state === 'suspended') actx.resume();
  } catch { /* egal */ }
}
document.addEventListener('touchend', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);
function beep() {
  if (!actx) return;
  const t0 = actx.currentTime;
  [0, 0.35, 0.7].forEach((d, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = i === 2 ? 1320 : 880; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.25);
    o.connect(g).connect(actx.destination); o.start(t0 + d); o.stop(t0 + d + 0.3);
  });
}
const Timer = {
  start(sec, label) { state.timer = { end: Date.now() + sec * 1000, label, beeped: false }; save(); this.tick(); },
  adjust(d) {
    if (!state.timer) return;
    state.timer.end = Math.max(Date.now(), state.timer.end + d * 1000);
    if (state.timer.end > Date.now()) state.timer.beeped = false;
    save(); this.tick();
  },
  stop() { state.timer = null; save(); this.tick(); },
  tick() {
    const el = $('#timer');
    if (!state.timer) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const rem = (state.timer.end - Date.now()) / 1000;
    if (rem > 0) {
      el.classList.remove('finished');
      $('#timer-label').textContent = state.timer.label || 'Pause';
      $('#timer-time').textContent = mmss(Math.ceil(rem));
    } else {
      el.classList.add('finished');
      $('#timer-label').textContent = 'Pause vorbei – nächster Satz! 💪';
      $('#timer-time').textContent = '+' + mmss(-rem);
      if (!state.timer.beeped) { state.timer.beeped = true; save(); beep(); }
      if (-rem > 120) this.stop();
    }
  },
};
setInterval(() => Timer.tick(), 250);
$('#timer').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  if (b.dataset.t === 'stop') Timer.stop(); else Timer.adjust(+b.dataset.t);
});

// Bildschirm während des Trainings anlassen (wenn unterstützt)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nicht unterstützt */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { Timer.tick(); if (state.active) keepAwake(true); } });

// ---------- Navigation ----------
let tab = 'training';
const TITLES = { training: 'Training', progress: 'Fortschritt', cardio: 'Ausdauer', food: 'Ernährung', settings: 'Mehr' };
$$('.tabbar button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
function render() {
  destroyCharts();
  // #view ersetzen, damit keine alten Event-Listener hängen bleiben
  const old = $('#view'), fresh = old.cloneNode(false); old.replaceWith(fresh);
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#title').textContent = TITLES[tab];
  ({ training: renderTraining, progress: renderProgress, cardio: renderCardio, food: renderFood, settings: renderSettings })[tab]();
}

// =====================================================================
// TRAINING
// =====================================================================
function renderTraining() {
  if (state.active) return renderWorkout();
  const v = $('#view');
  const lastDone = id => { const w = [...state.workouts].reverse().find(w => w.dayId === id); return w ? w.date : null; };
  const suggested = [...state.plan].sort((a, b) => (lastDone(a.id) || '0').localeCompare(lastDone(b.id) || '0'))[0];
  const weekStart = mondayOf(today());
  const thisWeek = state.workouts.filter(w => w.date >= weekStart).length;

  v.innerHTML = `
    <div class="card">
      <div class="muted">Diese Woche: ${thisWeek} / 3 Gym-Einheiten</div>
      <h2 class="mt">Nächstes Training: ${esc(suggested.name)}</h2>
      <button class="btn primary block" data-start="${suggested.id}">▶ ${esc(suggested.name)} starten</button>
    </div>
    ${state.plan.map(d => `
      <div class="card">
        <div class="row spread">
          <h3>${esc(d.name)}</h3>
          <span class="muted small">${lastDone(d.id) ? 'zuletzt ' + fmtDate(lastDone(d.id)) : 'noch nie'}</span>
        </div>
        <div class="muted small">${d.exercises.map(e => esc(e.name)).join(' · ')}</div>
        <button class="btn block mt" data-start="${d.id}">Starten</button>
      </div>`).join('')}
    <p class="muted small">Pro Übung: 1 Aufwärmsatz + 2 Arbeitssätze, Ziel ${state.plan[0].exercises[0].repMin}–${state.plan[0].exercises[0].repMax} Wdh. Übungen & Gewichtssprünge änderst du unter „Mehr“.</p>`;
  $$('[data-start]', v).forEach(b => b.addEventListener('click', () => startWorkout(b.dataset.start)));
}

function startWorkout(dayId) {
  const day = state.plan.find(d => d.id === dayId);
  state.active = {
    id: uid(), dayId, dayName: day.name, started: Date.now(),
    entries: day.exercises.map(e => {
      const r = recommend(e);
      const kg = r.kg;
      const warm = kg != null ? Math.max(0, roundTo(kg * 0.6, e.inc)) : null;
      return { name: e.name, kind: e.kind, sets: [
        { w: 'warm', kg: warm, reps: null, done: false },
        { w: 'work', kg, reps: null, done: false },
        { w: 'work', kg, reps: null, done: false },
      ] };
    }),
  };
  save(); keepAwake(true); render();
}

function lastSummary(name) {
  const h = history(name); if (!h.length) return '';
  const l = h[h.length - 1];
  return `Letztes Mal (${fmtDate(l.date)}): ${l.sets.map(s => `${num(s.kg)}×${s.reps}`).join(', ')}`;
}

function renderWorkout() {
  const a = state.active, v = $('#view');
  const mins = Math.round((Date.now() - a.started) / 60000);
  v.innerHTML = `
    <div class="card">
      <div class="row spread">
        <div><h2 style="margin:0">${esc(a.dayName)}</h2><div class="muted small">läuft seit ${mins} min</div></div>
        <button class="btn sm danger" id="w-cancel">Abbrechen</button>
      </div>
    </div>
    ${a.entries.map((en, i) => {
      const cfg = findExConfig(en.name) || { repMin: 6, repMax: 8, inc: 2.5, kind: en.kind, name: en.name };
      const r = recommend(cfg);
      const prevSets = history(en.name).slice(-1)[0]?.sets || [];
      let wi = 0;
      return `
      <div class="card" data-e="${i}">
        <div class="ex-head"><div class="ex-name">${esc(en.name)}</div>
          <div class="muted small">${cfg.repMin}–${cfg.repMax} Wdh · +${num(cfg.inc)} kg</div></div>
        <div class="last">${lastSummary(en.name)}</div>
        <div class="reco ${r.type}">${esc(r.text)}</div>
        <div class="set-head"><div>Satz</div><div>${kgLabel(en.kind)}</div><div>Wdh</div><div>✓</div></div>
        ${en.sets.map((s, j) => {
          const label = s.w === 'warm' ? 'Aufw.' : `Satz ${++wi}`;
          const ph = s.w === 'warm' ? '10' : (prevSets[wi - 1]?.reps ?? `${cfg.repMin}-${cfg.repMax}`);
          return `<div class="set ${s.done ? 'is-done' : ''}" data-s="${j}">
            <div class="tag">${label}</div>
            <input inputmode="decimal" data-f="kg" value="${s.kg ?? ''}" placeholder="kg">
            <input inputmode="numeric" data-f="reps" value="${s.reps ?? ''}" placeholder="${ph}">
            <button class="done">${s.done ? '✓' : ''}</button>
          </div>`;
        }).join('')}
        <div class="row mt"><button class="btn sm" data-add="${i}">+ Satz</button></div>
      </div>`;
    }).join('')}
    <button class="btn good block" id="w-finish">✔ Training beenden & speichern</button>`;

  v.addEventListener('input', onWorkoutInput);
  $$('.done', v).forEach(b => b.addEventListener('click', onSetDone));
  $$('[data-add]', v).forEach(b => b.addEventListener('click', () => {
    const en = a.entries[+b.dataset.add]; const lastSet = en.sets[en.sets.length - 1];
    en.sets.push({ w: 'work', kg: lastSet.kg, reps: null, done: false }); save(); render();
  }));
  $('#w-cancel').addEventListener('click', () => {
    if (confirm('Training wirklich verwerfen? Eingaben gehen verloren.')) { state.active = null; state.timer = null; save(); keepAwake(false); render(); }
  });
  $('#w-finish').addEventListener('click', finishWorkout);
}
function onWorkoutInput(e) {
  const inp = e.target.closest('input[data-f]'); if (!inp || !state.active) return;
  const i = +inp.closest('[data-e]').dataset.e, j = +inp.closest('[data-s]').dataset.s;
  state.active.entries[i].sets[j][inp.dataset.f] = parseNum(inp.value);
  save();
}
function onSetDone(e) {
  const row = e.target.closest('[data-s]'), card = e.target.closest('[data-e]');
  const i = +card.dataset.e, j = +row.dataset.s;
  const s = state.active.entries[i].sets[j];
  if (!s.done && !(s.reps > 0)) { toast('Bitte erst die Wiederholungen eintragen'); $('input[data-f="reps"]', row).focus(); return; }
  s.done = !s.done;
  row.classList.toggle('is-done', s.done);
  e.target.textContent = s.done ? '✓' : '';
  if (s.done) {
    const warm = s.w === 'warm';
    Timer.start(warm ? state.settings.warmRestSec : state.settings.restSec, warm ? 'Pause nach Aufwärmsatz' : 'Satzpause');
  }
  save();
}
function finishWorkout() {
  const a = state.active;
  const entries = a.entries.map(en => ({ name: en.name, kind: en.kind, sets: en.sets.filter(s => s.reps > 0).map(s => ({ w: s.w, kg: s.kg || 0, reps: s.reps })) }))
    .filter(en => en.sets.length);
  if (!entries.length) { toast('Noch keine Sätze eingetragen'); return; }
  // Rekorde prüfen (vor dem Speichern)
  const prs = [];
  entries.forEach(en => {
    const h = history(en.name); if (!h.length) return;
    const cfgKind = en.kind;
    const before = Math.max(...h.map(s => sessionBest(s, cfgKind)));
    const work = en.sets.filter(s => s.w === 'work'); if (!work.length) return;
    const now = sessionBest({ sets: work }, cfgKind);
    if (now > before + 0.01) prs.push(en.name);
  });
  state.workouts.push({ id: a.id, date: ymd(new Date(a.started)), dayId: a.dayId, dayName: a.dayName, durMin: Math.round((Date.now() - a.started) / 60000), entries });
  state.active = null; state.timer = null; save(); keepAwake(false);
  openModal(`<h2>Stark! 💪</h2>
    <p>${esc(a.dayName)} gespeichert – ${entries.length} Übungen, ${entries.reduce((t, e) => t + e.sets.length, 0)} Sätze.</p>
    ${prs.length ? `<p>🏆 Neuer Rekord (geschätztes Maximum) bei: <b>${prs.map(esc).join(', ')}</b></p>` : ''}
    <button class="btn primary block">OK</button>`);
  $('#modal-card button').addEventListener('click', closeModal);
  render();
}

// =====================================================================
// FORTSCHRITT
// =====================================================================
let progressEx = null;
function renderProgress() {
  const v = $('#view');
  const names = [...allPlanExercises().values()].map(e => e.name);
  state.workouts.forEach(w => w.entries.forEach(e => { if (!names.some(n => exKey(n) === exKey(e.name))) names.push(e.name); }));
  if (!progressEx || !names.includes(progressEx)) progressEx = names[0];
  const cfg = findExConfig(progressEx) || { name: progressEx, repMin: 6, repMax: 8, inc: 2.5, kind: 'machine' };
  const h = history(progressEx);
  const r = recommend(cfg);

  // Trainings pro Woche (letzte 8 Wochen)
  const weeks = []; let m = mondayOf(today());
  for (let i = 7; i >= 0; i--) weeks.push(addDays(m, -7 * i));
  const perWeek = weeks.map(ws => state.workouts.filter(w => w.date >= ws && w.date < addDays(ws, 7)).length);

  const bw = [...state.bodyweightLog].sort((a, b) => a.date.localeCompare(b.date));

  v.innerHTML = `
    <div class="card">
      <label>Übung</label>
      <select id="p-ex">${names.map(n => `<option ${n === progressEx ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <div class="reco ${r.type}">${esc(r.text)}</div>
      ${h.length ? `
        <div class="stats mt">
          <div class="stat"><div class="v">${num(topKg(h[h.length - 1]))}</div><div class="l">aktuell kg</div></div>
          <div class="stat"><div class="v">${num(Math.max(...h.map(s => sessionBest(s, cfg.kind))), 0)}</div><div class="l">bestes geschätztes Max (kg)</div></div>
          <div class="stat"><div class="v">${h.length}</div><div class="l">Einheiten</div></div>
        </div>
        <div class="chart-wrap mt"><canvas id="c-ex"></canvas></div>
        <div class="mt">${h.slice(-8).reverse().map(s => `<div class="list-item"><span>${fmtDate(s.date)}</span><span class="muted">${s.sets.map(x => `${num(x.kg)}×${x.reps}`).join(', ')}</span></div>`).join('')}</div>
        <p class="muted small">„Geschätztes Max“ = was du theoretisch 1× schaffen würdest (Epley-Formel). Steigt diese Linie, wirst du stärker.</p>`
      : '<p class="muted">Noch keine Daten – trainiere diese Übung, dann erscheint hier der Verlauf.</p>'}
    </div>

    <div class="card">
      <h3>Körpergewicht</h3>
      <div class="row"><input id="bw-in" inputmode="decimal" placeholder="kg" value="${state.settings.bodyweight ?? ''}"><button class="btn primary" id="bw-save">Eintragen</button></div>
      ${bw.length > 1 ? '<div class="chart-wrap mt"><canvas id="c-bw"></canvas></div>' : ''}
    </div>

    <div class="card">
      <h3>Gym-Einheiten pro Woche</h3>
      <div class="chart-wrap" style="height:160px"><canvas id="c-week"></canvas></div>
    </div>

    <div class="card">
      <h3>Verlauf</h3>
      ${state.workouts.length ? [...state.workouts].reverse().slice(0, 20).map(w => `
        <div class="list-item" data-w="${w.id}" style="cursor:pointer">
          <span>${fmtDate(w.date)} · ${esc(w.dayName)}</span><span class="muted">${w.durMin} min ›</span></div>`).join('')
      : '<p class="muted">Noch keine Trainings gespeichert.</p>'}
    </div>`;

  $('#p-ex').addEventListener('change', e => { progressEx = e.target.value; render(); });
  $('#bw-save').addEventListener('click', () => {
    const kg = parseNum($('#bw-in').value); if (!kg) return;
    state.bodyweightLog = state.bodyweightLog.filter(x => x.date !== today()).concat({ date: today(), kg });
    state.settings.bodyweight = kg; save(); toast('Gewicht gespeichert'); render();
  });
  $$('[data-w]', v).forEach(el => el.addEventListener('click', () => showWorkout(el.dataset.w)));

  if (h.length) makeChart($('#c-ex'), { type: 'line', data: {
    labels: h.map(s => fmtDate(s.date)),
    datasets: [
      { label: 'Geschätztes Max', data: h.map(s => +sessionBest(s, cfg.kind).toFixed(1)), borderColor: BLUE, backgroundColor: BLUE, tension: .3 },
      { label: 'Arbeitsgewicht', data: h.map(topKg), borderColor: GREEN, backgroundColor: GREEN, tension: .3 },
    ] } });
  if (bw.length > 1) makeChart($('#c-bw'), { type: 'line', data: { labels: bw.map(x => fmtDate(x.date)),
    datasets: [{ label: 'kg', data: bw.map(x => x.kg), borderColor: ORANGE, backgroundColor: ORANGE, tension: .3 }] } });
  makeChart($('#c-week'), { type: 'bar', data: { labels: weeks.map(fmtDate), datasets: [{ label: 'Einheiten', data: perWeek, backgroundColor: BLUE, borderRadius: 6 }] },
    options: { scales: { y: { beginAtZero: true, suggestedMax: 3, ticks: { stepSize: 1 } } } } });
}
function showWorkout(id) {
  const w = state.workouts.find(x => x.id === id); if (!w) return;
  const card = openModal(`<h2>${esc(w.dayName)}</h2><div class="muted">${fmtDateLong(w.date)} · ${w.durMin} min</div>
    ${w.entries.map(en => `<div class="list-item"><span>${esc(en.name)}</span><span class="muted">${en.sets.map(s => `${s.w === 'warm' ? '(' : ''}${num(s.kg)}×${s.reps}${s.w === 'warm' ? ')' : ''}`).join(', ')}</span></div>`).join('')}
    <div class="row mt"><button class="btn danger grow" id="wd-del">Löschen</button><button class="btn primary grow" id="wd-ok">Schließen</button></div>`);
  $('#wd-ok', card).addEventListener('click', closeModal);
  $('#wd-del', card).addEventListener('click', () => {
    if (!confirm('Dieses Training löschen?')) return;
    state.workouts = state.workouts.filter(x => x.id !== id); save(); closeModal(); render();
  });
}

// =====================================================================
// AUSDAUER (Strava)
// =====================================================================
const SPORTS = {
  run: { label: 'Laufen', types: ['Run', 'TrailRun', 'VirtualRun'], icon: '🏃' },
  ride: { label: 'Rad', types: ['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide'], icon: '🚴' },
  swim: { label: 'Schwimmen', types: ['Swim'], icon: '🏊' },
};
const sportOf = a => Object.keys(SPORTS).find(k => SPORTS[k].types.includes(a.sport)) || 'other';
let cardioSport = 'run';

function stravaRedirectUri() { return location.origin + location.pathname; }
async function stravaTokenRequest(params) {
  const s = state.strava;
  const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST',
    body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, ...params }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message || 'Strava-Anmeldung fehlgeschlagen');
  s.access = j.access_token; s.refresh = j.refresh_token; s.expiresAt = j.expires_at;
  if (j.athlete) s.athlete = [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' ');
  save();
}
async function stravaAccess() {
  const s = state.strava;
  if (!s.refresh) throw new Error('Strava ist nicht verbunden');
  if (!s.access || s.expiresAt * 1000 < Date.now() + 60000) await stravaTokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh });
  return s.access;
}
async function stravaExchange(code) {
  await stravaTokenRequest({ grant_type: 'authorization_code', code });
  toast('Strava verbunden ✔'); await stravaSync();
}
async function stravaSync() {
  const token = await stravaAccess();
  const latest = state.activities.reduce((m, a) => Math.max(m, a.ts), 0);
  const after = latest ? Math.floor(latest / 1000) - 3 * 86400 : Math.floor(Date.now() / 1000) - 400 * 86400;
  const got = [];
  for (let page = 1; page <= 15; page++) {
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Strava-Abruf fehlgeschlagen (' + r.status + ')');
    const list = await r.json(); got.push(...list);
    if (list.length < 100) break;
  }
  const map = new Map(state.activities.map(a => [a.id, a]));
  got.forEach(a => map.set(a.id, {
    id: a.id, name: a.name, sport: a.sport_type || a.type,
    date: (a.start_date_local || a.start_date).slice(0, 16), ts: Date.parse(a.start_date),
    dist: a.distance || 0, time: a.moving_time || 0, elev: a.total_elevation_gain || 0,
    hr: a.average_heartrate || null, maxhr: a.max_heartrate || null,
  }));
  state.activities = [...map.values()].sort((a, b) => b.ts - a.ts);
  state.strava.lastSync = Date.now(); save();
  toast(`${got.length} Aktivitäten geladen`);
  if (tab === 'cardio') render();
}

function paceStr(sport, a) {
  if (!a.dist || !a.time) return '–';
  if (sport === 'run') return mmss(a.time / (a.dist / 1000)) + ' /km';
  if (sport === 'swim') return mmss(a.time / (a.dist / 100)) + ' /100m';
  return num(a.dist / 1000 / (a.time / 3600)) + ' km/h';
}
// Wert für Tempo-Diagramm: Lauf/Schwimm = Sekunden, Rad = km/h
function paceVal(sport, a) {
  if (!a.dist || !a.time) return null;
  if (sport === 'run') return a.time / (a.dist / 1000);
  if (sport === 'swim') return a.time / (a.dist / 100);
  return a.dist / 1000 / (a.time / 3600);
}

function cardioTips(sport, acts) {
  const tips = [], t = today();
  const km = a => a.dist / 1000;
  const inRange = (from, to) => acts.filter(a => a.date.slice(0, 10) >= from && a.date.slice(0, 10) < to);
  const ws = mondayOf(t);
  const thisWeek = inRange(ws, addDays(ws, 7)).reduce((s, a) => s + km(a), 0);
  const prev4 = [1, 2, 3, 4].map(i => inRange(addDays(ws, -7 * i), addDays(ws, -7 * (i - 1))).reduce((s, a) => s + km(a), 0));
  const avg4 = prev4.reduce((a, b) => a + b, 0) / 4;
  const lastAct = acts[0];
  const unit = sport === 'swim' ? 'm' : 'km';
  const fmtD = x => sport === 'swim' ? num(x * 1000, 0) : num(x);

  if (!acts.length) return [`Noch keine ${SPORTS[sport].label}-Einheiten gefunden.`];
  const since = daysBetween(lastAct.date.slice(0, 10), t);
  if (since >= 7) tips.push(`⏰ Letzte Einheit vor ${since} Tagen. Steig locker wieder ein – kürzer und ruhiger als zuletzt.`);

  if (avg4 > 0) {
    if (thisWeek > avg4 * 1.1) tips.push(`⚠️ Diese Woche schon ${fmtD(thisWeek)} ${unit} – mehr als 10 % über deinem 4‑Wochen-Schnitt (${fmtD(avg4)} ${unit}). Nicht weiter steigern, sonst steigt das Verletzungsrisiko.`);
    else tips.push(`🎯 Wochenziel: ca. ${fmtD(avg4 * 1.1)} ${unit} (Schnitt ${fmtD(avg4)} + 10 %). Diese Woche bisher ${fmtD(thisWeek)} ${unit}.`);
    if (prev4.filter(x => x > 0).length >= 3 && prev4[0] > avg4 * 1.2 && prev4[1] > avg4 * 0.9) tips.push('😴 Du hast die letzten Wochen gut gesteigert. Plane jede 3.–4. Woche eine leichtere Woche (~30 % weniger) ein.');
  }

  // Tempo-Trend (letzte 28 Tage vs. 28–56 Tage)
  const recent = inRange(addDays(t, -28), addDays(t, 1)), older = inRange(addDays(t, -56), addDays(t, -28));
  const avgPace = arr => { const d = arr.reduce((s, a) => s + a.dist, 0), tm = arr.reduce((s, a) => s + a.time, 0); return d && tm ? paceVal(sport, { dist: d, time: tm }) : null; };
  const pR = avgPace(recent), pO = avgPace(older);
  if (pR && pO && recent.length >= 2 && older.length >= 2) {
    const better = sport === 'ride' ? pR > pO : pR < pO;
    const diff = Math.abs(pR - pO);
    const diffStr = sport === 'ride' ? `${num(diff)} km/h` : `${Math.round(diff)} s ${sport === 'run' ? '/km' : '/100m'}`;
    tips.push(better ? `📈 Du bist schneller geworden: ${diffStr} besser als im Monat davor.` : `📉 Tempo ${diffStr} langsamer als im Monat davor – oft Müdigkeit oder Hitze. Achte auf Erholung.`);
  }

  if (sport === 'run') {
    const week = inRange(addDays(t, -6), addDays(t, 1));
    const wkKm = week.reduce((s, a) => s + km(a), 0);
    const longest = Math.max(0, ...week.map(km));
    if (week.length >= 2 && longest > wkKm * 0.5) tips.push('📏 Dein längster Lauf ist mehr als die Hälfte deines Wochenumfangs. Verteile die Kilometer gleichmäßiger.');
    const mx = state.settings.maxHr;
    const withHr = recent.filter(a => a.hr);
    if (mx && withHr.length >= 3) {
      const easy = withHr.filter(a => a.hr < mx * 0.8).length / withHr.length;
      if (easy < 0.7) tips.push(`❤️ Nur ${Math.round(easy * 100)} % deiner Läufe waren locker (Puls unter ${Math.round(mx * 0.8)}). Faustregel 80/20: ca. 80 % locker, 20 % intensiv – so wirst du langfristig schneller.`);
      else tips.push(`❤️ ${Math.round(easy * 100)} % deiner Läufe waren locker – gut! Ein Intervall- oder Tempolauf pro Woche bringt zusätzlich Speed.`);
    } else if (!mx && withHr.length) tips.push('❤️ Trag unter „Mehr“ deine maximale Herzfrequenz ein, dann bekommst du Tipps zur Intensität.');
    tips.push('🦵 Harte oder lange Läufe möglichst nicht am Tag vor deinem Lower-Tag – sonst leiden beide Einheiten.');
  }
  if (sport === 'ride') {
    const longest = Math.max(0, ...recent.map(km));
    if (recent.length >= 2) tips.push(`🚴 Längste Fahrt im letzten Monat: ${num(longest)} km. Eine längere, lockere Ausfahrt pro Woche (~${num(longest * 1.1)} km) verbessert die Grundlagenausdauer.`);
  }
  if (sport === 'swim') {
    const perWeek = recent.length / 4;
    if (perWeek < 1) tips.push('🏊 Weniger als 1× pro Woche geschwommen. Für Fortschritt sind 2 Einheiten pro Woche ideal – Technik braucht Regelmäßigkeit.');
    tips.push('💡 Tipp: Mit Technikübungen (z. B. Abschlagschwimmen, Beinschlag mit Brett) sinkt dein Tempo pro 100 m oft schneller als durch reines Kilometersammeln.');
  }
  return tips;
}

function renderCardio() {
  const v = $('#view'), s = state.strava;
  if (!s.refresh) {
    v.innerHTML = `<div class="card"><h2>Strava verbinden</h2>
      <p>Deine Garmin-Uhr lädt Läufe, Radfahrten und Schwimmeinheiten automatisch zu Strava hoch. Diese App holt sie sich von dort.</p>
      <p class="muted small">Einmalige Einrichtung unter <b>Mehr → Strava</b>. Die Anleitung steht dort.</p>
      <button class="btn primary block" id="go-set">Zur Einrichtung</button></div>`;
    $('#go-set').addEventListener('click', () => { tab = 'settings'; render(); setTimeout(() => $('#strava-sec')?.scrollIntoView(), 50); });
    return;
  }
  const acts = state.activities.filter(a => sportOf(a) === cardioSport);
  const t = today(), ws = mondayOf(t);
  const km = a => a.dist / 1000;
  const sum = arr => arr.reduce((x, a) => x + km(a), 0);
  const inRange = (from, to) => acts.filter(a => a.date.slice(0, 10) >= from && a.date.slice(0, 10) < to);
  const weekKm = sum(inRange(ws, addDays(ws, 7)));
  const monthKm = sum(inRange(t.slice(0, 8) + '01', addDays(t, 1)));
  const yearKm = sum(inRange(t.slice(0, 4) + '-01-01', addDays(t, 1)));
  const weeks = []; for (let i = 11; i >= 0; i--) weeks.push(addDays(ws, -7 * i));
  const perWeek = weeks.map(w => { const x = sum(inRange(w, addDays(w, 7))); return cardioSport === 'swim' ? Math.round(x * 1000) : +x.toFixed(1); });
  const paceActs = acts.filter(a => a.dist > 0).slice(0, 25).reverse();
  const isSwim = cardioSport === 'swim';
  const dist = x => isSwim ? num(x * 1000, 0) + ' m' : num(x) + ' km';

  v.innerHTML = `
    <div class="chips">${Object.entries(SPORTS).map(([k, sp]) => `<button class="chip ${k === cardioSport ? 'active' : ''}" data-sp="${k}">${sp.icon} ${sp.label}</button>`).join('')}</div>
    <div class="card mt">
      <div class="stats">
        <div class="stat"><div class="v">${dist(weekKm)}</div><div class="l">diese Woche</div></div>
        <div class="stat"><div class="v">${dist(monthKm)}</div><div class="l">diesen Monat</div></div>
        <div class="stat"><div class="v">${dist(yearKm)}</div><div class="l">dieses Jahr</div></div>
      </div>
    </div>
    <div class="card"><h3>💡 Empfehlungen</h3>${cardioTips(cardioSport, acts).map(x => `<div class="tip">${esc(x)}</div>`).join('')}</div>
    <div class="card"><h3>Umfang pro Woche (${isSwim ? 'm' : 'km'})</h3><div class="chart-wrap" style="height:180px"><canvas id="c-vol"></canvas></div></div>
    ${paceActs.length > 1 ? `<div class="card"><h3>Tempo-Verlauf (${cardioSport === 'run' ? 'min/km – niedriger ist schneller' : cardioSport === 'swim' ? 'min/100 m – niedriger ist schneller' : 'km/h'})</h3><div class="chart-wrap" style="height:180px"><canvas id="c-pace"></canvas></div></div>` : ''}
    <div class="card"><h3>Letzte Einheiten</h3>
      ${acts.slice(0, 15).map(a => `<div class="list-item"><div class="grow"><div>${esc(a.name)}</div><div class="muted small">${fmtDate(a.date)} · ${dur(a.time)}${a.hr ? ` · ❤️ ${Math.round(a.hr)}` : ''}</div></div>
        <div style="text-align:right"><div>${dist(km(a))}</div><div class="muted small">${paceStr(cardioSport, a)}</div></div></div>`).join('') || '<p class="muted">Keine Einheiten.</p>'}
    </div>
    <button class="btn block" id="c-sync">🔄 Mit Strava synchronisieren</button>
    <p class="muted small" style="text-align:center">Zuletzt: ${s.lastSync ? new Date(s.lastSync).toLocaleString('de-DE') : 'nie'}</p>`;

  $$('[data-sp]', v).forEach(b => b.addEventListener('click', () => { cardioSport = b.dataset.sp; render(); }));
  $('#c-sync').addEventListener('click', async e => { e.target.disabled = true; e.target.textContent = 'Lade…'; try { await stravaSync(); } catch (err) { toast(err.message, 4000); } render(); });
  makeChart($('#c-vol'), { type: 'bar', data: { labels: weeks.map(fmtDate), datasets: [{ label: isSwim ? 'm' : 'km', data: perWeek, backgroundColor: BLUE, borderRadius: 6 }] },
    options: { scales: { y: { beginAtZero: true } } } });
  if (paceActs.length > 1) {
    const secs = cardioSport !== 'ride';
    makeChart($('#c-pace'), { type: 'line', data: { labels: paceActs.map(a => fmtDate(a.date)),
      datasets: [{ label: 'Tempo', data: paceActs.map(a => +paceVal(cardioSport, a).toFixed(1)), borderColor: GREEN, backgroundColor: GREEN, tension: .3 }] },
      options: { scales: { y: { reverse: secs, ticks: { callback: v => secs ? mmss(v) : v } } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => secs ? mmss(c.raw) : num(c.raw) + ' km/h' } } } } });
  }
  // automatisch synchronisieren, wenn letzte Synchronisierung > 1 h her
  if (!s.lastSync || Date.now() - s.lastSync > 3600000) stravaSync().catch(() => {});
}

// Rückkehr von Strava nach der Anmeldung
async function handleStravaCallback() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return;
  history.replaceState(null, '', location.pathname);
  if (p.get('error')) { toast('Strava-Zugriff abgelehnt'); return; }
  const code = p.get('code');
  if (state.strava.clientId && state.strava.clientSecret) {
    try { await stravaExchange(code); tab = 'cardio'; render(); } catch (e) { toast(e.message, 5000); }
  } else {
    // Wir sind vermutlich im Safari-Fenster statt in der Home-Bildschirm-App gelandet
    const card = openModal(`<h2>Fast geschafft!</h2>
      <p>Kopiere diesen Code, öffne die App vom Home-Bildschirm und füge ihn unter <b>Mehr → Strava → Code einfügen</b> ein:</p>
      <pre class="code">${esc(code)}</pre>
      <button class="btn primary block" id="cp">Code kopieren</button>`);
    $('#cp', card).addEventListener('click', async () => { try { await navigator.clipboard.writeText(code); toast('Kopiert ✔'); } catch { toast('Bitte manuell markieren & kopieren'); } });
  }
}

// =====================================================================
// ERNÄHRUNG
// =====================================================================
let foodDate = null;
function renderFood() {
  foodDate = foodDate || today();
  const v = $('#view'), g = state.settings;
  const items = state.food.filter(f => f.date === foodDate);
  const tot = items.reduce((a, f) => ({ kcal: a.kcal + (f.kcal || 0), p: a.p + (f.p || 0), c: a.c + (f.c || 0), f: a.f + (f.f || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
  const bar = (label, val, goal, unit) => `<div class="row spread small"><span>${label}</span><span class="muted">${num(val, 0)} / ${num(goal, 0)} ${unit}</span></div>
    <div class="bar ${val > goal ? 'over' : ''}"><div style="width:${Math.min(100, goal ? val / goal * 100 : 0)}%"></div></div>`;
  // Schnell-Hinzufügen: zuletzt gegessene Lebensmittel
  const recent = []; const seen = new Set();
  [...state.food].reverse().forEach(f => { if (!seen.has(f.name) && recent.length < 8) { seen.add(f.name); recent.push(f); } });

  v.innerHTML = `
    <div class="row spread card">
      <button class="btn sm" id="f-prev">‹</button>
      <b>${foodDate === today() ? 'Heute' : fmtDateLong(foodDate)}</b>
      <button class="btn sm" id="f-next" ${foodDate >= today() ? 'disabled' : ''}>›</button>
    </div>
    <div class="card">
      <div class="row spread"><h2 style="margin:0">${num(tot.kcal, 0)} kcal</h2><span class="muted">noch ${num(Math.max(0, g.kcalGoal - tot.kcal), 0)}</span></div>
      <div class="mt">${bar('Kalorien', tot.kcal, g.kcalGoal, 'kcal')}${bar('Eiweiß', tot.p, g.proteinGoal, 'g')}${bar('Kohlenhydrate', tot.c, g.carbGoal, 'g')}${bar('Fett', tot.f, g.fatGoal, 'g')}</div>
    </div>
    <div class="row">
      <button class="btn primary grow" id="f-photo">📷 Foto</button>
      <button class="btn primary grow" id="f-scan">▦ Barcode</button>
      <button class="btn grow" id="f-man">✎ Manuell</button>
    </div>
    <input type="file" accept="image/*" id="f-file" class="hidden">
    <div class="card mt"><h3>Einträge</h3>
      ${items.length ? items.map(f => `<div class="list-item"><div class="grow"><div>${esc(f.name)}</div>
        <div class="muted small">${f.time || ''} · E ${num(f.p, 0)} g · K ${num(f.c, 0)} g · F ${num(f.f, 0)} g</div></div>
        <div class="row"><b>${num(f.kcal, 0)}</b><button class="icon-btn" data-del="${f.id}">🗑</button></div></div>`).join('')
      : '<p class="muted">Noch nichts eingetragen.</p>'}
    </div>
    ${recent.length ? `<div class="card"><h3>Schnell nochmal</h3><div class="chips" style="flex-wrap:wrap">${recent.map((f, i) => `<button class="chip" data-re="${i}">${esc(f.name)} · ${num(f.kcal, 0)}</button>`).join('')}</div></div>` : ''}`;

  $('#f-prev').addEventListener('click', () => { foodDate = addDays(foodDate, -1); render(); });
  $('#f-next').addEventListener('click', () => { foodDate = addDays(foodDate, 1); render(); });
  $('#f-photo').addEventListener('click', () => {
    if (!g.claudeKey) { toast('Bitte zuerst unter „Mehr“ deinen Claude-API-Schlüssel eintragen', 4000); return; }
    $('#f-file').click();
  });
  $('#f-file').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) photoFlow(file); });
  $('#f-scan').addEventListener('click', scanFlow);
  $('#f-man').addEventListener('click', () => foodEditor([{ name: '', grams: null, kcal: null, protein: null, carbs: null, fat: null }], 'manuell'));
  $$('[data-del]', v).forEach(b => b.addEventListener('click', () => { state.food = state.food.filter(f => f.id !== b.dataset.del); save(); render(); }));
  $$('[data-re]', v).forEach(b => b.addEventListener('click', () => {
    const f = recent[+b.dataset.re]; addFood([{ name: f.name, kcal: f.kcal, protein: f.p, carbs: f.c, fat: f.f }], f.src); toast('Hinzugefügt ✔');
  }));
}
function addFood(list, src) {
  const now = new Date();
  list.forEach(it => state.food.push({ id: uid(), date: foodDate || today(), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    name: it.name || 'Essen', kcal: +it.kcal || 0, p: +it.protein || 0, c: +it.carbs || 0, f: +it.fat || 0, src }));
  save(); render();
}
// Bearbeitbare Liste vor dem Speichern
function foodEditor(items, src, note = '') {
  const rows = () => items.map((it, i) => `<div class="card" style="padding:10px" data-i="${i}">
      <div class="row"><input data-k="name" value="${esc(it.name)}" placeholder="Name"><button class="icon-btn" data-rm="${i}">✕</button></div>
      <div class="row mt">
        <div class="grow"><label>kcal</label><input inputmode="decimal" data-k="kcal" value="${it.kcal ?? ''}"></div>
        <div class="grow"><label>Eiweiß g</label><input inputmode="decimal" data-k="protein" value="${it.protein ?? ''}"></div>
        <div class="grow"><label>KH g</label><input inputmode="decimal" data-k="carbs" value="${it.carbs ?? ''}"></div>
        <div class="grow"><label>Fett g</label><input inputmode="decimal" data-k="fat" value="${it.fat ?? ''}"></div>
      </div></div>`).join('');
  const card = openModal(`<h2>Prüfen & speichern</h2>${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    <div id="fe-rows">${rows()}</div>
    <div class="row mt"><button class="btn grow" id="fe-cancel">Abbrechen</button><button class="btn primary grow" id="fe-save">Speichern</button></div>`);
  card.addEventListener('input', e => {
    const inp = e.target.closest('[data-k]'); if (!inp) return;
    const i = +inp.closest('[data-i]').dataset.i, k = inp.dataset.k;
    items[i][k] = k === 'name' ? inp.value : parseNum(inp.value);
  });
  card.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]'); if (!rm) return;
    items.splice(+rm.dataset.rm, 1); $('#fe-rows', card).innerHTML = rows();
  });
  $('#fe-cancel', card).addEventListener('click', closeModal);
  $('#fe-save', card).addEventListener('click', () => {
    const valid = items.filter(it => it.name || it.kcal);
    if (!valid.length) { toast('Nichts zu speichern'); return; }
    closeModal(); addFood(valid, src); toast('Gespeichert ✔');
  });
}

// Bild verkleinern (spart Kosten & Zeit)
function resizeImage(file, max = 1024) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    img.onerror = () => rej(new Error('Bild konnte nicht gelesen werden'));
    img.src = URL.createObjectURL(file);
  });
}

async function photoFlow(file) {
  const card = openModal(`<h2>📷 Essen analysieren</h2>
    <label>Hinweis (optional)</label>
    <input id="ph-hint" placeholder="z. B. große Portion, mit Öl gebraten">
    <button class="btn primary block mt" id="ph-go">Analysieren</button>
    <p class="muted small" id="ph-status"></p>`);
  $('#ph-go', card).addEventListener('click', async () => {
    const btn = $('#ph-go', card); btn.disabled = true; btn.textContent = 'Analysiere… (ca. 10–30 s)';
    try {
      const b64 = await resizeImage(file);
      const result = await analyzeFoodPhoto(b64, $('#ph-hint', card).value.trim());
      closeModal();
      const items = (result.items || []).map(it => ({ name: it.grams ? `${it.name} (${Math.round(it.grams)} g)` : it.name,
        kcal: Math.round(it.kcal), protein: Math.round(it.protein), carbs: Math.round(it.carbs), fat: Math.round(it.fat) }));
      foodEditor(items.length ? items : [{ name: '', kcal: null }], 'foto',
        `Schätzung (Sicherheit: ${result.confidence || '?'}). ${result.note || ''} Werte kannst du anpassen.`);
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Nochmal versuchen';
      $('#ph-status', card).textContent = 'Fehler: ' + e.message;
    }
  });
}

let anthropicClient = null, anthropicKeyUsed = null;
async function getAnthropic() {
  if (anthropicClient && anthropicKeyUsed === state.settings.claudeKey) return anthropicClient;
  const { default: Anthropic } = await import(ANTHROPIC_SDK_URL);
  anthropicClient = new Anthropic({ apiKey: state.settings.claudeKey, dangerouslyAllowBrowser: true });
  anthropicKeyUsed = state.settings.claudeKey;
  return anthropicClient;
}
const FOOD_PROMPT = `Du bist ein Ernährungsassistent. Analysiere das Foto einer Mahlzeit (oder einer Verpackung/Nährwerttabelle).
Schätze für jede erkennbare Komponente die Portionsgröße in Gramm sowie kcal, Eiweiß, Kohlenhydrate und Fett in Gramm für diese Portion.
Zeigt das Bild eine Nährwerttabelle, nutze deren Angaben (für eine übliche Portion, falls nicht anders angegeben).
Antworte ausschließlich mit JSON in genau diesem Format, ohne weiteren Text:
{"items":[{"name":"...","grams":0,"kcal":0,"protein":0,"carbs":0,"fat":0}],"confidence":"niedrig|mittel|hoch","note":"kurzer Hinweis auf Deutsch"}`;

async function analyzeFoodPhoto(b64, hint) {
  const client = await getAnthropic();
  const model = state.settings.claudeModel || 'claude-opus-5-5';
  const req = {
    model, max_tokens: 8000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
      { type: 'text', text: FOOD_PROMPT + (hint ? `\nHinweis vom Nutzer: ${hint}` : '') },
    ] }],
  };
  let resp;
  if (model === 'claude-haiku-4-5') {
    resp = await client.messages.create(req);
  } else {
    // Bei Opus/Sonnet: Tiefe niedrig halten (günstiger, reicht für Schätzungen) + automatische Ausweichlösung bei Ablehnung
    resp = await client.beta.messages.create({ ...req, output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  }
  if (resp.stop_reason === 'refusal') throw new Error('Das Bild wurde nicht analysiert. Versuch ein anderes Foto.');
  const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0) throw new Error('Keine verwertbare Antwort erhalten');
  return JSON.parse(text.slice(start, end + 1));
}

// Barcode-Scanner + Open Food Facts
function scanFlow() {
  const card = openModal(`<h2>▦ Barcode scannen</h2>
    <div id="reader"></div>
    <label>…oder Nummer eintippen</label>
    <div class="row"><input id="bc-in" inputmode="numeric" placeholder="z. B. 4008400402222"><button class="btn primary" id="bc-go">Suchen</button></div>
    <p class="muted small" id="bc-status">Kamera wird gestartet…</p>
    <button class="btn block mt" id="bc-close">Schließen</button>`);
  let scanner = null, handled = false;
  const stop = async () => { try { if (scanner) { await scanner.stop(); scanner.clear(); } } catch { } scanner = null; };
  closeModal.onClose = stop;
  const found = async code => {
    if (handled) return; handled = true; await stop();
    $('#bc-status', card).textContent = `Suche ${code}…`;
    try { await lookupBarcode(code); } catch (e) { handled = false; $('#bc-status', card).textContent = e.message; }
  };
  $('#bc-go', card).addEventListener('click', () => { const c = $('#bc-in', card).value.trim(); if (c) found(c); });
  $('#bc-close', card).addEventListener('click', closeModal);
  if (!window.Html5Qrcode) { $('#bc-status', card).textContent = 'Scanner nicht geladen (offline?). Tippe die Nummer ein.'; return; }
  scanner = new Html5Qrcode('reader', { verbose: false });
  scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, txt => found(txt), () => {})
    .then(() => $('#bc-status', card).textContent = 'Halte den Strichcode in den Rahmen.')
    .catch(() => $('#bc-status', card).textContent = 'Kamera nicht verfügbar – bitte Nummer eintippen.');
}
async function lookupBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_quantity`);
  const j = await r.json();
  if (!r.ok || j.status !== 1 || !j.product) throw new Error('Produkt nicht gefunden. Versuch es mit Foto oder manuell.');
  const p = j.product, n = p.nutriments || {};
  const per100 = { kcal: n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : 0), protein: n.proteins_100g || 0, carbs: n.carbohydrates_100g || 0, fat: n.fat_100g || 0 };
  const name = [p.product_name, p.brands].filter(Boolean).join(' – ') || code;
  const def = Math.round(p.serving_quantity || 100);
  closeModal();
  const card = openModal(`<h2>${esc(name)}</h2>
    <p class="muted small">Pro 100 g: ${num(per100.kcal, 0)} kcal · E ${num(per100.protein)} · KH ${num(per100.carbs)} · F ${num(per100.fat)}</p>
    <label>Menge (g oder ml)</label><input id="bc-g" inputmode="decimal" value="${def}">
    <p id="bc-calc"></p>
    <div class="row"><button class="btn grow" id="bc-x">Abbrechen</button><button class="btn primary grow" id="bc-save">Speichern</button></div>`);
  const calc = () => { const g = parseNum($('#bc-g', card).value) || 0, f = g / 100;
    return { name: `${name} (${g} g)`, kcal: Math.round(per100.kcal * f), protein: Math.round(per100.protein * f), carbs: Math.round(per100.carbs * f), fat: Math.round(per100.fat * f) }; };
  const upd = () => { const c = calc(); $('#bc-calc', card).innerHTML = `<b>${c.kcal} kcal</b> · E ${c.protein} g · KH ${c.carbs} g · F ${c.fat} g`; };
  upd(); $('#bc-g', card).addEventListener('input', upd);
  $('#bc-x', card).addEventListener('click', closeModal);
  $('#bc-save', card).addEventListener('click', () => { const c = calc(); closeModal(); addFood([c], 'barcode'); toast('Gespeichert ✔'); });
}

// =====================================================================
// EINSTELLUNGEN
// =====================================================================
function renderSettings() {
  const v = $('#view'), s = state.settings, st = state.strava;
  v.innerHTML = `
    <div class="card"><h2>Allgemein</h2>
      <div class="row"><div class="grow"><label>Körpergewicht (kg)</label><input id="s-bw" inputmode="decimal" value="${s.bodyweight ?? ''}"></div>
      <div class="grow"><label>Max. Herzfrequenz</label><input id="s-hr" inputmode="numeric" value="${s.maxHr ?? ''}" placeholder="optional"></div></div>
      <div class="row"><div class="grow"><label>Pause Arbeitssatz (Sek.)</label><input id="s-rest" inputmode="numeric" value="${s.restSec}"></div>
      <div class="grow"><label>Pause nach Aufwärmen (Sek.)</label><input id="s-wrest" inputmode="numeric" value="${s.warmRestSec}"></div></div>
    </div>

    <div class="card"><h2>Ernährungsziele</h2>
      <div class="row"><div class="grow"><label>kcal</label><input id="s-kcal" inputmode="numeric" value="${s.kcalGoal}"></div>
      <div class="grow"><label>Eiweiß g</label><input id="s-p" inputmode="numeric" value="${s.proteinGoal}"></div></div>
      <div class="row"><div class="grow"><label>Kohlenhydrate g</label><input id="s-c" inputmode="numeric" value="${s.carbGoal}"></div>
      <div class="grow"><label>Fett g</label><input id="s-f" inputmode="numeric" value="${s.fatGoal}"></div></div>
      <p class="muted small">Startwerte: ~2 g Eiweiß pro kg Körpergewicht, 2500 kcal als grobe Erhaltung. Anpassen, je nachdem ob du auf- oder abbauen willst.</p>
    </div>

    <div class="card"><h2>Trainingsplan</h2>
      <p class="muted small">Wdh-Bereich (min–max) und Gewichtssprung pro Übung. Bei 1,25-kg-Scheiben: Langhantel +2,5 kg (je Seite 1,25).</p>
      ${state.plan.map((d, di) => `
        <h3 class="mt">${esc(d.name)}</h3>
        <div class="ex-edit muted small"><div>Übung</div><div>min</div><div>max</div><div>+kg</div></div>
        ${d.exercises.map((e, ei) => `
          <div class="ex-edit" data-d="${di}" data-x="${ei}">
            <input data-k="name" value="${esc(e.name)}">
            <input data-k="repMin" inputmode="numeric" value="${e.repMin}">
            <input data-k="repMax" inputmode="numeric" value="${e.repMax}">
            <input data-k="inc" inputmode="decimal" value="${e.inc}">
          </div>
          <div class="row" data-d="${di}" data-x="${ei}" style="margin-top:4px">
            <select data-k="kind" style="padding:6px;font-size:14px">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="icon-btn" data-mv="-1">↑</button><button class="icon-btn" data-mv="1">↓</button><button class="icon-btn" data-rmx>🗑</button>
          </div>`).join('')}
        <button class="btn sm mt" data-addx="${di}">+ Übung</button>`).join('')}
    </div>

    <div class="card" id="strava-sec"><h2>Strava (Garmin)</h2>
      ${st.refresh ? `<p>✅ Verbunden${st.athlete ? ' als ' + esc(st.athlete) : ''}.</p>
        <div class="row"><button class="btn grow" id="st-sync">Jetzt synchronisieren</button><button class="btn danger grow" id="st-off">Trennen</button></div>`
      : `<details><summary><b>Anleitung (einmalig, ca. 5 Min.)</b></summary>
          <ol class="small">
            <li>Garmin Connect App → Einstellungen → Verbundene Apps → <b>Strava</b> verbinden (falls noch nicht).</li>
            <li>Am PC/Handy <b>strava.com/settings/api</b> öffnen und eine „API-Anwendung“ erstellen:
              Name z. B. „Gym 2.0“, Kategorie „Training“, Website: <code>${esc(location.origin)}</code>,
              <b>Autorisierungs-Callback-Domain:</b> <code>${esc(location.hostname)}</code></li>
            <li>Dort angezeigte <b>Client-ID</b> und <b>Client-Secret</b> hier eintragen und „Mit Strava verbinden“ tippen.</li>
          </ol></details>
        <label>Client-ID</label><input id="st-id" value="${esc(st.clientId || '')}" inputmode="numeric">
        <label>Client-Secret</label><input id="st-secret" value="${esc(st.clientSecret || '')}" autocomplete="off">
        <button class="btn primary block mt" id="st-connect">Mit Strava verbinden</button>
        <label>Code einfügen (nur falls nach der Anmeldung ein Code angezeigt wurde)</label>
        <div class="row"><input id="st-code" placeholder="Code"><button class="btn" id="st-code-go">OK</button></div>`}
    </div>

    <div class="card"><h2>Essens-Fotoanalyse (Claude)</h2>
      <p class="muted small">Für die Foto-Schätzung brauchst du einen API-Schlüssel von <b>console.anthropic.com</b> (Guthaben aufladen, z. B. 5 €). Der Schlüssel bleibt nur auf diesem Gerät.</p>
      <label>API-Schlüssel</label><input id="s-key" value="${esc(s.claudeKey)}" placeholder="sk-ant-…" autocomplete="off">
      <label>Modell</label>
      <select id="s-model">
        <option value="claude-opus-5-5" ${s.claudeModel === 'claude-opus-5-5' ? 'selected' : ''}>Claude Opus 5.5 – genaueste Schätzung (~2–3 ct/Foto)</option>
        <option value="claude-sonnet-5-5" ${s.claudeModel === 'claude-sonnet-5-5' ? 'selected' : ''}>Claude Sonnet 5.5 – gut & günstiger (~1 ct/Foto)</option>
        <option value="claude-haiku-4-5" ${s.claudeModel === 'claude-haiku-4-5' ? 'selected' : ''}>Claude Haiku 4.5 – am günstigsten (&lt;1 ct/Foto)</option>
      </select>
    </div>

    <div class="card"><h2>Datensicherung</h2>
      <p class="muted small">Deine Daten liegen nur auf diesem Gerät. Mach ab und zu ein Backup (z. B. in iCloud Drive speichern).</p>
      <div class="row"><button class="btn grow" id="b-exp">⬇ Backup exportieren</button><button class="btn grow" id="b-imp">⬆ Backup laden</button></div>
      <input type="file" id="b-file" accept="application/json,.json" class="hidden">
    </div>
    <p class="muted small" style="text-align:center">Gym 2.0 · Version 1.0</p>`;

  const bindNum = (id, key, isInt = false) => $(id).addEventListener('change', e => { const n = parseNum(e.target.value); s[key] = n == null ? null : (isInt ? Math.round(n) : n); save(); });
  $('#s-bw').addEventListener('change', e => { const kg = parseNum(e.target.value); if (!kg) return; s.bodyweight = kg;
    state.bodyweightLog = state.bodyweightLog.filter(x => x.date !== today()).concat({ date: today(), kg }); save(); });
  bindNum('#s-hr', 'maxHr', true); bindNum('#s-rest', 'restSec', true); bindNum('#s-wrest', 'warmRestSec', true);
  bindNum('#s-kcal', 'kcalGoal', true); bindNum('#s-p', 'proteinGoal', true); bindNum('#s-c', 'carbGoal', true); bindNum('#s-f', 'fatGoal', true);
  $('#s-key').addEventListener('change', e => { s.claudeKey = e.target.value.trim(); save(); toast('Gespeichert'); });
  $('#s-model').addEventListener('change', e => { s.claudeModel = e.target.value; save(); });

  // Plan-Editor
  v.addEventListener('change', e => {
    const inp = e.target.closest('[data-k]'); const holder = inp?.closest('[data-d]'); if (!holder || !inp.closest('.card')) return;
    const exo = state.plan[+holder.dataset.d]?.exercises[+holder.dataset.x]; if (!exo) return;
    const k = inp.dataset.k;
    exo[k] = (k === 'name' || k === 'kind') ? inp.value.trim() : (parseNum(inp.value) ?? exo[k]);
    save();
  });
  $$('[data-mv]', v).forEach(b => b.addEventListener('click', () => {
    const h = b.closest('[data-d]'), list = state.plan[+h.dataset.d].exercises, i = +h.dataset.x, j = i + +b.dataset.mv;
    if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; save(); render();
  }));
  $$('[data-rmx]', v).forEach(b => b.addEventListener('click', () => {
    const h = b.closest('[data-d]'), list = state.plan[+h.dataset.d].exercises;
    if (!confirm(`„${list[+h.dataset.x].name}“ aus dem Plan entfernen? (Verlauf bleibt erhalten)`)) return;
    list.splice(+h.dataset.x, 1); save(); render();
  }));
  $$('[data-addx]', v).forEach(b => b.addEventListener('click', () => {
    const name = prompt('Name der Übung:'); if (!name) return;
    state.plan[+b.dataset.addx].exercises.push(ex(name.trim(), 'machine', 2.5)); save(); render();
  }));

  // Strava
  if (st.refresh) {
    $('#st-sync').addEventListener('click', async () => { try { await stravaSync(); } catch (e) { toast(e.message, 4000); } });
    $('#st-off').addEventListener('click', () => { if (!confirm('Strava trennen? Geladene Aktivitäten werden gelöscht.')) return;
      state.strava = { clientId: st.clientId, clientSecret: st.clientSecret }; state.activities = []; save(); render(); });
  } else {
    const saveCreds = () => { st.clientId = $('#st-id').value.trim(); st.clientSecret = $('#st-secret').value.trim(); state.strava = st; save(); };
    $('#st-connect').addEventListener('click', () => {
      saveCreds(); if (!st.clientId || !st.clientSecret) { toast('Client-ID und Secret eintragen'); return; }
      location.href = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(st.clientId)}&redirect_uri=${encodeURIComponent(stravaRedirectUri())}&response_type=code&approval_prompt=auto&scope=read,activity:read_all`;
    });
    $('#st-code-go').addEventListener('click', async () => {
      saveCreds(); let code = $('#st-code').value.trim();
      const m = code.match(/[?&]code=([^&]+)/); if (m) code = m[1];
      if (!code) return;
      try { await stravaExchange(code); render(); } catch (e) { toast(e.message, 5000); }
    });
  }

  // Backup
  $('#b-exp').addEventListener('click', async () => {
    const data = { ...state, settings: { ...state.settings } };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `gym2-backup-${today()}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch { return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#b-imp').addEventListener('click', () => $('#b-file').click());
  $('#b-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.plan || !data.workouts) throw new Error('Keine gültige Backup-Datei');
      if (!confirm('Backup laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.')) return;
      state = { ...defaultState(), ...data }; save(); toast('Backup geladen ✔'); render();
    } catch (err) { toast(err.message, 4000); }
  });
}

// ---------- Start ----------
load();
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
Timer.tick();
if (state.active) keepAwake(true);
handleStravaCallback();
