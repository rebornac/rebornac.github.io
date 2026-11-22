import { dbGet, dbSet, exportAllData, importAllData } from './db.js';
import {
  roundQuarter, formatWeight, estimate1RM, calcDayVolume, estimateCalories,
  summarizeExerciseSets, getPreviousExerciseLog, detectSessionPRs,
  getExerciseProgressSeries, formatShortDate, formatTimeRange,
  getCurrentWeekActivity, formatSecondsClock, formatRestBadge, calcPlates,
  kgToUnit, unitToKg
} from './domain.js';
import { renderExerciseThumb, renderAnatomyFrontSVG, renderAnatomyBackSVG } from './muscle-map.js';
import { startRestTimer, adjustRestTimer, stopRestTimer, startWorkoutClock, stopWorkoutClock, setScreenWakeLock, startHoldTimer, stopHoldTimer } from './timer.js';

const QUOTES = [
  'Continue, transforme sua vida para melhor! 🔥',
  'Consistência constrói força todos os dias. 💪',
  'Mais uma série bem feita, mais perto do topo. ⚡',
  'Técnica limpa hoje, recorde pessoal amanhã. 🏆'
];

const MUSCLE_GROUPS = [
  'Todos', 'Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps',
  'Quadríceps', 'Posteriores', 'Glúteos', 'Panturrilha', 'Abdômen',
  'Antebraço', 'Lombar', 'Mobilidade', 'Cardio/Potência'
];

const EQUIPMENTS = [
  'Todos', 'Máquina', 'Barra', 'Halteres', 'Polia', 'Smith',
  'Kettlebell', 'Peso Corporal', 'Elástico', 'Acessórios'
];

let CATALOG = [];
let PLANS_SEED = null;
let EXERCISE_MEDIA = {};
let state = null;
let currentTab = 'plan';
let exFilters = { query: '', muscle: 'Todos', equipment: 'Todos', sort: 'popularity' };
let progressChartMetric = 'maxWeight';
let progressSelectedExId = null;
let sheetDismissHandler = null;

// DOM refs
const mainView = document.getElementById('main-view');
const modalRoot = document.getElementById('modal-root');
const toastContainer = document.getElementById('toast-container');
const activeBar = document.getElementById('active-workout-bar');
const restPill = document.getElementById('rest-timer-pill');

function uid(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 2900);
}

function getAllExercises() {
  return [...CATALOG, ...(state.customExercises || [])];
}

function getExerciseById(id) {
  return getAllExercises().find((e) => e.id === id) || {
    id, name: 'Exercício', muscle: 'Peito', secondaryMuscles: [], equipment: 'Máquina', unilateral: false, instructions: ''
  };
}

function getActivePlan() {
  return state.plans.find((p) => p.id === state.activePlanId) || state.plans[0];
}

function getActiveDay() {
  const plan = getActivePlan();
  if (!plan.days.length) return null;
  const idx = Math.min(state.activeDayIndex, plan.days.length - 1);
  return plan.days[idx];
}

async function saveState() {
  await dbSet('appState', state);
}

function buildSeedState(plansData) {
  const planCopy = structuredClone(plansData.defaultPlan);

  return {
    plans: [planCopy],
    activePlanId: planCopy.id,
    activeDayIndex: 0,
    activeWorkout: null,
    history: [],
    cardioLogs: [],
    favorites: ['supino-reto-com-barra', 'crucifixo-peitoral-na-maquina', 'agachamento-livre'],
    favoriteWorkouts: [],
    customExercises: [],
    settings: {
      userName: 'Atleta ForjaFit',
      bodyWeightKg: 82,
      unit: 'kg',
      defaultRestSeconds: 90,
      weeklyGoal: 4,
      soundEnabled: true,
      vibrateEnabled: true
    }
  };
}

// ======================= ACTIVE WORKOUT ENGINE =======================

function updateActiveWorkoutBar() {
  const aw = state.activeWorkout;
  // Backups from v1.0 have no keepScreenOn: treated as enabled
  setScreenWakeLock(Boolean(aw) && state.settings.keepScreenOn !== false);
  if (!aw) {
    activeBar.classList.add('hidden');
    stopWorkoutClock();
    return;
  }
  activeBar.classList.remove('hidden');
  document.getElementById('awb-title').textContent = aw.title;

  let doneSets = 0;
  let totalSets = 0;
  for (const ex of aw.exercises) {
    for (const s of ex.sets) {
      totalSets++;
      if (s.completed) doneSets++;
    }
  }
  const vol = calcDayVolume(aw.exercises, true);
  document.getElementById('awb-sets').textContent = `${doneSets}/${totalSets} séries`;
  document.getElementById('awb-vol').textContent = `${vol.toLocaleString('pt-BR')} kg`;

  startWorkoutClock(aw.startedAt, (sec) => {
    document.getElementById('awb-clock').textContent = formatSecondsClock(sec);
  });
}

function startWorkoutSession(sourceDay, planName, isQuick = false) {
  if (state.activeWorkout) {
    showToast('Já existe um treino em andamento!');
    return;
  }
  state.activeWorkout = {
    id: uid('aw'),
    planName,
    dayId: isQuick ? null : sourceDay.id,
    dayLabel: sourceDay.label || 'RÁPIDO',
    title: sourceDay.title || 'Treino Ativo',
    startedAt: Date.now(),
    exercises: structuredClone(sourceDay.exercises).map((ex) => ({
      ...ex,
      sets: ex.sets.map((s) => ({ ...s, completed: false }))
    }))
  };
  saveState();
  updateActiveWorkoutBar();
  currentTab = 'plan';
  syncNavActive();
  renderCurrentTab();
  showToast('Treino iniciado! Marque cada série concluída.');
}

function triggerRestForSeconds(seconds) {
  restPill.classList.remove('hidden');
  startRestTimer(seconds || state.settings.defaultRestSeconds, {
    sound: state.settings.soundEnabled,
    vibrate: state.settings.vibrateEnabled,
    onTick: (rem) => {
      document.getElementById('rtp-time').textContent = formatSecondsClock(rem);
    },
    onComplete: () => {
      restPill.classList.add('hidden');
      showToast('Descanso finalizado! Próxima série! 💪');
    }
  });
}

function finishActiveWorkout() {
  const aw = state.activeWorkout;
  if (!aw) return;
  if (stopHoldTimer() !== null) closeSheet();
  const durationMin = Math.max(1, Math.round((Date.now() - aw.startedAt) / 60000));
  const completedCount = aw.exercises.reduce((a, e) => a + e.sets.filter((s) => s.completed).length, 0);

  if (completedCount === 0) {
    if (!confirm('Nenhuma série foi marcada como concluída. Deseja encerrar sem salvar?')) return;
    cancelActiveWorkout();
    return;
  }

  const volumeKg = calcDayVolume(aw.exercises, true);
  const calories = estimateCalories(durationMin, state.settings.bodyWeightKg, volumeKg);
  const prsList = detectSessionPRs(state.history, aw.exercises);

  const sessionRecord = {
    id: uid('sess'),
    planName: aw.planName,
    dayLabel: aw.dayLabel,
    dayTitle: aw.title,
    completedAt: new Date().toISOString(),
    durationMin,
    calories,
    volumeKg,
    prs: prsList.length,
    prDetails: prsList,
    exercises: aw.exercises
  };

  state.history.push(sessionRecord);

  // Update corresponding plan day weights/reps & completion badge
  if (aw.dayId) {
    const plan = getActivePlan();
    const day = plan.days.find((d) => d.id === aw.dayId);
    if (day) {
      day.completed = true;
      day.lastCompletedAt = sessionRecord.completedAt;
      day.lastDurationMin = durationMin;
      day.lastCalories = calories;
      day.lastVolume = volumeKg;
      day.lastPRs = prsList.length;
      // Persist latest weights/reps back to plan template
      day.exercises = aw.exercises.map((ex) => ({
        ...ex,
        sets: ex.sets.map(({ completed, ...rest }) => rest)
      }));
    }
  }

  state.activeWorkout = null;
  stopRestTimer();
  restPill.classList.add('hidden');
  updateActiveWorkoutBar();
  saveState();
  renderCurrentTab();
  openWorkoutSummaryModal(sessionRecord);
}

function cancelActiveWorkout() {
  if (stopHoldTimer() !== null) closeSheet();
  state.activeWorkout = null;
  stopRestTimer();
  restPill.classList.add('hidden');
  updateActiveWorkoutBar();
  saveState();
  renderCurrentTab();
  showToast('Treino cancelado.');
}

// ======================= RENDERERS: 5 TABS =======================

function renderCurrentTab() {
  if (currentTab === 'plan') renderPlanTab();
  else if (currentTab === 'workouts') renderWorkoutsTab();
  else if (currentTab === 'progress') renderProgressTab();
  else if (currentTab === 'exercises') renderExercisesTab();
  else if (currentTab === 'profile') renderProfileTab();
}

// --- TAB 1: MEU PLANO ---
function renderPlanTab() {
  const plan = getActivePlan();
  const day = getActiveDay();
  const aw = state.activeWorkout;
  const displayExercises = aw ? aw.exercises : (day ? day.exercises : []);
  const unit = state.settings.unit;

  const isCompleted = !aw && day && day.completed;
  const estVol = aw ? calcDayVolume(aw.exercises, true) : (day?.lastVolume ?? calcDayVolume(displayExercises, false));
  const estDuration = day?.lastDurationMin || Math.max(30, displayExercises.length * 8);
  const estCal = day?.lastCalories || estimateCalories(estDuration, state.settings.bodyWeightKg, estVol);
  const prs = day?.lastPRs || 0;
  const quote = QUOTES[state.activeDayIndex % QUOTES.length];

  mainView.innerHTML = `
    <header class="top-header">
      <button class="brand-title-btn" id="btn-switch-plan">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M4 9v6"/><path d="M20 9v6"/><path d="M7 5v14"/><path d="M17 5v14"/><path d="M7 12h10"/></svg>
        <span>${escapeHtml(plan.name)}</span>
        <span style="font-size:13px;color:var(--text-secondary)">▾</span>
      </button>
      <div class="header-actions">
        <button class="icon-circle-btn" id="btn-add-ex-day" title="Adicionar exercício ao dia">＋</button>
        <button class="icon-circle-btn" id="btn-edit-plan-shortcut" title="Editar plano">⚙</button>
      </div>
    </header>

    ${!aw ? `
      <div class="day-pills">
        ${plan.days.map((d, idx) => `
          <button class="day-pill ${d.completed ? 'completed' : ''} ${idx === state.activeDayIndex ? 'active' : ''}" data-day-idx="${idx}">
            ${d.completed ? '✓ ' : ''}${escapeHtml(d.label)}
          </button>
        `).join('')}
        <button class="day-pill" id="btn-add-day">+ DIA</button>
      </div>
    ` : ''}

    <section class="hero-card">
      <div class="hero-top">
        <span>${aw ? 'SESSÃO EM ANDAMENTO' : (isCompleted ? formatTimeRange(day.lastCompletedAt, estDuration) : `${escapeHtml(day?.label || '')} • ${escapeHtml(day?.title || '')}`)}</span>
        <button class="dots-btn" id="btn-day-menu" title="Opções do dia">•••</button>
      </div>
      <h1 class="hero-quote">${aw ? escapeHtml(aw.title) : quote}</h1>
      <p class="hero-subtitle">${aw ? 'Toque em cada exercício para marcar séries e iniciar o descanso automático.' : escapeHtml(day?.title || 'Adicione exercícios para começar')}</p>

      <div class="hero-status-row">
        <span>${estDuration}min</span>
        <span class="status-badge">
          ${aw ? '<span class="accent-text">Ativo</span>' : (isCompleted ? 'Concluído! <span class="status-check">✓</span>' : '<span class="muted">Aguardando início</span>')}
        </span>
      </div>

      <div class="hero-metrics">
        <div>
          <div class="metric-val">${estCal}</div>
          <div class="metric-lbl">Calorias</div>
        </div>
        <div>
          <div class="metric-val">${estVol.toLocaleString('pt-BR')}</div>
          <div class="metric-lbl">Volume (kg)</div>
        </div>
        <div>
          <div class="metric-val">🏆 ${prs}</div>
          <div class="metric-lbl">Recordes</div>
        </div>
      </div>

      ${!aw ? `
        <div style="margin-top:16px">
          <button class="btn-primary" id="btn-start-day-workout">
            ${isCompleted ? 'REPETIR TREINO' : 'INICIAR TREINO'}
          </button>
        </div>
      ` : ''}
    </section>

    <div class="section-heading">
      <span class="section-label">${displayExercises.length} EXERCÍCIOS</span>
      <div style="display:flex;gap:8px">
        <button class="btn-ghost" id="btn-add-ex-day-2">+ Exercício</button>
      </div>
    </div>

    <div class="exercise-list">
      ${displayExercises.map((entry, idx) => {
        const ex = getExerciseById(entry.exerciseId);
        const doneSets = entry.sets.filter((s) => s.completed).length;
        const allDone = aw && entry.sets.length > 0 && doneSets === entry.sets.length;
        return `
          <div class="exercise-card ${allDone ? 'done-card' : ''}" data-open-ex-idx="${idx}">
            ${renderExerciseThumb(ex)}
            <div class="exercise-info">
              ${entry.optional ? '<span class="optional-tag">OPCIONAL</span>' : ''}
              <h3 class="exercise-name">${escapeHtml(ex.name)}</h3>
              <div class="exercise-meta">
                ${summarizeExerciseSets(entry, unit)}
                ${aw ? ` • <strong class="accent-text">${doneSets}/${entry.sets.length} feitas</strong>` : ''}
              </div>
            </div>
            <div class="exercise-card-right">
              <button class="dots-btn" data-open-ex-idx="${idx}" aria-label="Abrir exercício">⋮</button>
            </div>
          </div>
        `;
      }).join('')}
      ${!displayExercises.length ? `<div class="card-panel muted" style="text-align:center">Nenhum exercício neste dia ainda. Toque em <strong>+ Exercício</strong> para montar sua ficha.</div>` : ''}
    </div>
  `;

  // Bindings
  mainView.querySelectorAll('[data-day-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeDayIndex = Number(btn.dataset.dayIdx);
      saveState();
      renderPlanTab();
    });
  });

  document.getElementById('btn-switch-plan')?.addEventListener('click', openPlanSwitcherModal);
  document.getElementById('btn-edit-plan-shortcut')?.addEventListener('click', openPlanEditorModal);
  document.getElementById('btn-add-day')?.addEventListener('click', () => {
    const num = plan.days.length + 1;
    const title = prompt(`Nome do DIA ${num} (ex: Pernas, Push, Full Body):`, `Treino ${num}`);
    if (!title) return;
    plan.days.push({ id: uid('day'), label: `DIA ${num}`, title: title.trim(), completed: false, exercises: [] });
    state.activeDayIndex = plan.days.length - 1;
    saveState();
    renderPlanTab();
    showToast(`DIA ${num} adicionado ao plano.`);
  });

  document.getElementById('btn-day-menu')?.addEventListener('click', () => {
    if (!day || aw) return;
    openDayOptionsModal(day);
  });

  const openAddEx = () => openExercisePickerModal((chosen) => {
    const targetList = state.activeWorkout ? state.activeWorkout.exercises : day.exercises;
    targetList.push({
      exerciseId: chosen.id,
      restSeconds: state.settings.defaultRestSeconds,
      optional: false,
      unilateral: chosen.unilateral,
      note: '',
      sets: [
        { type: 'normal', reps: 10, weight: chosen.equipment === 'Peso Corporal' ? 0 : 20, completed: false },
        { type: 'normal', reps: 10, weight: chosen.equipment === 'Peso Corporal' ? 0 : 20, completed: false },
        { type: 'normal', reps: 10, weight: chosen.equipment === 'Peso Corporal' ? 0 : 20, completed: false }
      ]
    });
    saveState();
    updateActiveWorkoutBar();
    renderPlanTab();
    showToast(`${chosen.name} adicionado!`);
  });
  document.getElementById('btn-add-ex-day')?.addEventListener('click', openAddEx);
  document.getElementById('btn-add-ex-day-2')?.addEventListener('click', openAddEx);

  document.getElementById('btn-start-day-workout')?.addEventListener('click', () => {
    if (!day || !day.exercises.length) {
      showToast('Adicione pelo menos um exercício antes de iniciar.');
      return;
    }
    startWorkoutSession(day, plan.name, false);
  });

  mainView.querySelectorAll('[data-open-ex-idx]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(el.dataset.openExIdx);
      openExerciseDetailSheet(idx);
    });
  });
}

// --- TAB 2: TREINOS ---
function renderWorkoutsTab() {
  const quickList = PLANS_SEED.quickWorkouts;
  const templates = PLANS_SEED.planTemplates;

  mainView.innerHTML = `
    <header class="top-header">
      <div class="brand-title-btn">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M4 9v6"/><path d="M20 9v6"/><path d="M7 5v14"/><path d="M17 5v14"/><path d="M7 12h10"/></svg>
        <span>Treinos</span>
      </div>
      <span class="muted" style="font-size:12px;font-weight:700">ForjaFit</span>
    </header>

    <div class="section-heading" style="margin-top:4px">
      <span class="section-label">RECURSOS PERSONALIZADOS</span>
    </div>

    <div class="feature-cards-grid">
      <button class="feature-tile" id="btn-log-cardio">
        <div class="feature-tile-icon" style="color:#f97316">🔥</div>
        <div class="feature-tile-title">Registrar cardio</div>
      </button>
      <button class="feature-tile" id="btn-quick-builder">
        <div class="feature-tile-icon" style="color:var(--accent)">⚡</div>
        <div class="feature-tile-title">Criar Treino Rápido</div>
      </button>
      <button class="feature-tile" id="btn-open-plan-editor">
        <div class="feature-tile-icon">☰</div>
        <div class="feature-tile-title">Meu Plano Atual</div>
      </button>
    </div>

    <div class="section-heading">
      <span class="section-label">TREINOS RÁPIDOS</span>
      <span class="muted" style="font-size:12px">${quickList.length} opções</span>
    </div>

    <div class="h-scroll-cards">
      ${quickList.map((qw) => {
        const isFav = state.favoriteWorkouts.includes(qw.id);
        return `
          <div class="workout-poster">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <span class="level-tag">${escapeHtml(qw.level)}</span>
              <button class="star-btn ${isFav ? 'fav' : ''}" data-fav-qw="${qw.id}" style="width:28px;height:28px">${isFav ? '★' : '☆'}</button>
            </div>
            <div>
              <h3 class="poster-title">${escapeHtml(qw.title)}</h3>
              <div class="poster-meta">${qw.durationMin} min • ${escapeHtml(qw.location)} • ${qw.exercises.length} exerc.</div>
            </div>
            <div style="margin-top:12px">
              <button class="btn-ghost" style="width:100%;justify-content:center;border-color:var(--accent-border)" data-start-qw="${qw.id}">▶ Iniciar treino</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="section-heading">
      <span class="section-label">PLANOS DE TREINO PRONTOS</span>
    </div>

    <div class="exercise-list">
      ${templates.map((tpl) => `
        <div class="card-panel" style="margin-bottom:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span class="level-tag" style="margin:0">${escapeHtml(tpl.level)} • ${tpl.daysPerWeek}x/semana</span>
            <span class="muted" style="font-size:12px">${escapeHtml(tpl.location)}</span>
          </div>
          <h3 style="margin:0 0 6px;font-size:16px">${escapeHtml(tpl.name)}</h3>
          <p class="muted" style="margin:0 0 12px;font-size:13px">${escapeHtml(tpl.description)}</p>
          <button class="btn-secondary" data-adopt-tpl="${tpl.id}">Adotar como Meu Plano</button>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('btn-log-cardio').addEventListener('click', openCardioModal);
  document.getElementById('btn-quick-builder').addEventListener('click', openQuickWorkoutGeneratorModal);
  document.getElementById('btn-open-plan-editor').addEventListener('click', openPlanEditorModal);

  mainView.querySelectorAll('[data-fav-qw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.favQw;
      if (state.favoriteWorkouts.includes(id)) {
        state.favoriteWorkouts = state.favoriteWorkouts.filter((x) => x !== id);
      } else {
        state.favoriteWorkouts.push(id);
      }
      saveState();
      renderWorkoutsTab();
    });
  });

  mainView.querySelectorAll('[data-start-qw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qw = quickList.find((x) => x.id === btn.dataset.startQw);
      if (qw) startWorkoutSession({ title: qw.title, label: 'RÁPIDO', exercises: qw.exercises }, 'Treino Rápido', true);
    });
  });

  mainView.querySelectorAll('[data-adopt-tpl]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tpl = templates.find((x) => x.id === btn.dataset.adoptTpl);
      if (!tpl) return;
      const cloned = {
        id: uid('plan'),
        name: tpl.name,
        level: tpl.level,
        location: tpl.location,
        days: structuredClone(tpl.days)
      };
      state.plans.push(cloned);
      state.activePlanId = cloned.id;
      state.activeDayIndex = 0;
      saveState();
      currentTab = 'plan';
      syncNavActive();
      renderCurrentTab();
      showToast(`Plano "${tpl.name}" ativado!`);
    });
  });
}

// --- TAB 3: PROGRESSO ---
function renderProgressTab() {
  const week = getCurrentWeekActivity(state.history, state.cardioLogs);
  const weekDoneCount = week.filter((d) => d.done).length;
  const totalSessions = state.history.length;
  const totalVol = state.history.reduce((a, s) => a + (s.volumeKg || 0), 0);
  const totalKcal = state.history.reduce((a, s) => a + (s.calories || 0), 0) +
    state.cardioLogs.reduce((a, c) => a + (c.calories || 0), 0);
  const totalPRs = state.history.reduce((a, s) => a + (s.prs || 0), 0);

  // Exercises that appear in history
  const histExIds = [];
  const seen = new Set();
  for (let i = state.history.length - 1; i >= 0; i--) {
    for (const ex of state.history[i].exercises || []) {
      if (!seen.has(ex.exerciseId)) {
        seen.add(ex.exerciseId);
        histExIds.push(ex.exerciseId);
      }
    }
  }
  if (!progressSelectedExId || !seen.has(progressSelectedExId)) {
    progressSelectedExId = histExIds[0] || null;
  }

  const series = progressSelectedExId ? getExerciseProgressSeries(state.history, progressSelectedExId) : [];
  const isTimedSeries = series.some((p) => p.maxDuration > 0);
  const chartMetric = isTimedSeries ? 'maxDuration' : progressChartMetric;

  mainView.innerHTML = `
    <header class="top-header">
      <div class="brand-title-btn">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6.5 6.5h11"/><path d="M6.5 17.5h11"/><path d="M4 9v6"/><path d="M20 9v6"/><path d="M7 5v14"/><path d="M17 5v14"/><path d="M7 12h10"/></svg>
        <span>Progresso semanal</span>
      </div>
      <span class="btn-ghost" style="border-color:var(--accent-border)">${weekDoneCount}/${state.settings.weeklyGoal} meta</span>
    </header>

    <div class="week-strip">
      ${week.map((w) => `
        <div class="week-day">
          <div class="week-circle ${w.done ? 'done' : ''} ${w.isToday ? 'today' : ''}">
            ${w.done ? '✓' : w.dayNum}
          </div>
          <span class="muted" style="font-size:11px;font-weight:700">${w.label}</span>
        </div>
      `).join('')}
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="section-label">TREINOS CONCLUÍDOS</div>
        <div class="kpi-num">${totalSessions}</div>
        <div class="muted" style="font-size:12px">+ ${state.cardioLogs.length} cardios</div>
      </div>
      <div class="kpi-card">
        <div class="section-label">VOLUME ACUMULADO</div>
        <div class="kpi-num">${(totalVol / 1000).toFixed(1)} t</div>
        <div class="muted" style="font-size:12px">${totalVol.toLocaleString('pt-BR')} kg</div>
      </div>
      <div class="kpi-card">
        <div class="section-label">CALORIAS ESTIMADAS</div>
        <div class="kpi-num">${totalKcal.toLocaleString('pt-BR')}</div>
        <div class="muted" style="font-size:12px">kcal totais</div>
      </div>
      <div class="kpi-card">
        <div class="section-label">RECORDES (PRs)</div>
        <div class="kpi-num" style="color:var(--gold)">🏆 ${totalPRs}</div>
        <div class="muted" style="font-size:12px">Cargas e 1RM</div>
      </div>
    </div>

    <section class="chart-card">
      <div class="section-heading" style="margin-top:0">
        <span class="section-label">EVOLUÇÃO POR EXERCÍCIO</span>
      </div>
      ${histExIds.length ? `
        <select class="chart-select" id="progress-ex-select">
          ${histExIds.map((id) => {
            const ex = getExerciseById(id);
            return `<option value="${id}" ${id === progressSelectedExId ? 'selected' : ''}>${escapeHtml(ex.name)}</option>`;
          }).join('')}
        </select>
        <div class="filter-strip" style="margin-bottom:10px">
          ${isTimedSeries ? '<span class="filter-pill active">Maior Tempo (seg)</span>' : `
            <button class="filter-pill ${chartMetric === 'maxWeight' ? 'active' : ''}" data-metric="maxWeight">Carga Máxima (kg)</button>
            <button class="filter-pill ${chartMetric === 'max1RM' ? 'active' : ''}" data-metric="max1RM">1RM Estimado (kg)</button>
            <button class="filter-pill ${chartMetric === 'volume' ? 'active' : ''}" data-metric="volume">Volume Sessão (kg)</button>
          `}
        </div>
        <div class="chart-canvas-wrap">
          ${renderProgressLineChartSVG(series, chartMetric)}
        </div>
      ` : `<p class="muted">Conclua seu primeiro treino para destravar gráficos de carga, volume e 1RM estimado.</p>`}
    </section>

    <div class="section-heading">
      <span class="section-label">HISTÓRICO RECENTE</span>
    </div>

    <div class="exercise-list">
      ${[...state.history].reverse().slice(0, 12).map((sess) => `
        <div class="card-panel" style="margin-bottom:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <strong>${escapeHtml(sess.dayLabel)} — ${escapeHtml(sess.dayTitle)}</strong>
            <span class="muted" style="font-size:12px">${formatShortDate(sess.completedAt)}</span>
          </div>
          <div class="muted" style="font-size:12.5px">
            ${sess.durationMin} min • ${sess.volumeKg.toLocaleString('pt-BR')} kg • ${sess.calories} kcal • 🏆 ${sess.prs} PRs
          </div>
        </div>
      `).join('')}
      ${state.cardioLogs.length ? `
        <div class="section-heading"><span class="section-label">CARDIOS REGISTRADOS</span></div>
        ${[...state.cardioLogs].reverse().slice(0, 8).map((c) => `
          <div class="card-panel" style="margin-bottom:0">
            <div style="display:flex;justify-content:space-between">
              <strong>🔥 ${escapeHtml(c.activity)}</strong>
              <span class="muted" style="font-size:12px">${formatShortDate(c.date)}</span>
            </div>
            <div class="muted" style="font-size:12.5px">${c.durationMin} min ${c.distanceKm ? `• ${c.distanceKm} km` : ''} • ${c.calories} kcal</div>
          </div>
        `).join('')}
      ` : ''}
    </div>
  `;

  document.getElementById('progress-ex-select')?.addEventListener('change', (e) => {
    progressSelectedExId = e.target.value;
    renderProgressTab();
  });

  mainView.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      progressChartMetric = btn.dataset.metric;
      renderProgressTab();
    });
  });
}

function renderProgressLineChartSVG(series, metric) {
  if (!series.length) {
    return `<div style="height:100%;display:flex;align-items:center;justify-content:center" class="muted">Sem pontos suficientes ainda.</div>`;
  }
  const w = 360;
  const h = 180;
  const padL = 42, padR = 16, padT = 20, padB = 30;
  const vals = series.map((p) => p[metric]);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = Math.max(1, maxV - minV);
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const coords = series.map((p, i) => {
    const x = series.length === 1 ? padL + plotW / 2 : padL + (i / (series.length - 1)) * plotW;
    const y = padT + plotH - ((p[metric] - minV) / range) * plotH * 0.8 - plotH * 0.1;
    return { x, y, val: p[metric], label: p.label };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(h - padB)} L ${coords[0].x.toFixed(1)} ${(h - padB)} Z`;

  return `
  <svg viewBox="0 0 ${w} ${h}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="forjaChartGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#32ff00" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="#32ff00" stop-opacity="0.0"/>
      </linearGradient>
    </defs>
    <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3 3"/>
    <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="rgba(255,255,255,0.14)"/>
    <text x="${padL - 6}" y="${padT + 4}" text-anchor="end" fill="#8ea9ae" font-size="10">${Math.round(maxV)}</text>
    <text x="${padL - 6}" y="${h - padB}" text-anchor="end" fill="#8ea9ae" font-size="10">${Math.round(minV)}</text>
    ${coords.length > 1 ? `<path d="${areaPath}" fill="url(#forjaChartGrad)"/>` : ''}
    ${coords.length > 1 ? `<path d="${linePath}" fill="none" stroke="#32ff00" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${coords.map((c) => `
      <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="#071416" stroke="#32ff00" stroke-width="2.5"/>
      <text x="${c.x.toFixed(1)}" y="${(c.y - 9).toFixed(1)}" text-anchor="middle" fill="#f2f7f7" font-size="10" font-weight="700">${c.val}</text>
      <text x="${c.x.toFixed(1)}" y="${h - 10}" text-anchor="middle" fill="#8ea9ae" font-size="9.5">${c.label}</text>
    `).join('')}
  </svg>`;
}

// --- TAB 4: EXERCÍCIOS ---
function renderExercisesTab() {
  const all = getAllExercises();
  const q = exFilters.query.trim().toLowerCase();

  let filtered = all.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q) && !e.muscle.toLowerCase().includes(q) && !e.equipment.toLowerCase().includes(q)) return false;
    if (exFilters.muscle !== 'Todos' && e.muscle !== exFilters.muscle) return false;
    if (exFilters.equipment !== 'Todos' && e.equipment !== exFilters.equipment) return false;
    if (exFilters.sort === 'favorites' && !state.favorites.includes(e.id)) return false;
    return true;
  });

  if (exFilters.sort === 'alpha') {
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  } else {
    filtered.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }

  const visibleSlice = filtered.slice(0, 120);

  mainView.innerHTML = `
    <div class="search-bar">
      <span class="muted">🔍</span>
      <input type="search" id="ex-search-input" placeholder="Pesquisar Exercícios..." value="${escapeHtml(exFilters.query)}" autocomplete="off" />
      ${exFilters.query ? `<button id="ex-search-clear" class="muted">✕</button>` : ''}
    </div>

    <div class="filter-strip">
      ${MUSCLE_GROUPS.map((m) => `
        <button class="filter-pill ${exFilters.muscle === m ? 'active' : ''}" data-f-muscle="${m}">${m}</button>
      `).join('')}
    </div>

    <div class="filter-strip">
      ${EQUIPMENTS.map((eq) => `
        <button class="filter-pill ${exFilters.equipment === eq ? 'active' : ''}" data-f-equip="${eq}">${eq}</button>
      `).join('')}
    </div>

    <div class="section-heading" style="margin-top:8px">
      <span class="muted" style="font-size:13px;font-weight:600">${filtered.length} exercícios</span>
      <div style="display:flex;gap:6px">
        <button class="btn-ghost" id="btn-cycle-sort">
          ${exFilters.sort === 'popularity' ? '⇅ Popularidade' : exFilters.sort === 'alpha' ? '⇅ A–Z' : '★ Favoritos'}
        </button>
        <button class="btn-ghost" id="btn-new-custom-ex" style="border-color:var(--accent-border)">+ Novo</button>
      </div>
    </div>

    <div class="exercise-list" id="catalog-list">
      ${visibleSlice.map((ex) => {
        const isFav = state.favorites.includes(ex.id);
        return `
          <div class="exercise-card" data-inspect-ex="${ex.id}">
            ${renderExerciseThumb(ex)}
            <div class="exercise-info">
              <h3 class="exercise-name">${escapeHtml(ex.name)}</h3>
              <div class="exercise-meta">${escapeHtml(ex.muscle)} • ${escapeHtml(ex.equipment)}${ex.unilateral ? ' • Unilateral' : ''}</div>
            </div>
            <button class="star-btn ${isFav ? 'fav' : ''}" data-fav-ex="${ex.id}" aria-label="Favoritar">${isFav ? '★' : '☆'}</button>
          </div>
        `;
      }).join('')}
      ${filtered.length > visibleSlice.length ? `<div class="muted" style="text-align:center;padding:10px;font-size:12.5px">Mostrando ${visibleSlice.length} de ${filtered.length}. Use a busca ou os filtros acima para refinar.</div>` : ''}
      ${!filtered.length ? `<div class="card-panel muted" style="text-align:center">Nenhum exercício encontrado com esses filtros.</div>` : ''}
    </div>
  `;

  const searchInput = document.getElementById('ex-search-input');
  searchInput.addEventListener('input', (e) => {
    exFilters.query = e.target.value;
    renderExercisesTab();
    const fresh = document.getElementById('ex-search-input');
    fresh.focus();
    fresh.setSelectionRange(fresh.value.length, fresh.value.length);
  });

  document.getElementById('ex-search-clear')?.addEventListener('click', () => {
    exFilters.query = '';
    renderExercisesTab();
  });

  mainView.querySelectorAll('[data-f-muscle]').forEach((b) => b.addEventListener('click', () => {
    exFilters.muscle = b.dataset.fMuscle;
    renderExercisesTab();
  }));

  mainView.querySelectorAll('[data-f-equip]').forEach((b) => b.addEventListener('click', () => {
    exFilters.equipment = b.dataset.fEquip;
    renderExercisesTab();
  }));

  document.getElementById('btn-cycle-sort').addEventListener('click', () => {
    const order = ['popularity', 'alpha', 'favorites'];
    exFilters.sort = order[(order.indexOf(exFilters.sort) + 1) % order.length];
    renderExercisesTab();
  });

  document.getElementById('btn-new-custom-ex').addEventListener('click', openCreateCustomExerciseModal);

  mainView.querySelectorAll('[data-fav-ex]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.favEx;
      if (state.favorites.includes(id)) state.favorites = state.favorites.filter((x) => x !== id);
      else state.favorites.push(id);
      saveState();
      renderExercisesTab();
    });
  });

  mainView.querySelectorAll('[data-inspect-ex]').forEach((card) => {
    card.addEventListener('click', () => openHowToModal(getExerciseById(card.dataset.inspectEx)));
  });
}

// --- TAB 5: PERFIL ---
function renderProfileTab() {
  const s = state.settings;
  mainView.innerHTML = `
    <header class="top-header">
      <div class="brand-title-btn">
        <span style="color:var(--accent)">⚡</span>
        <span>ForjaFit • Perfil</span>
      </div>
      <span class="muted" style="font-size:12px">v1.4 Offline</span>
    </header>

    <section class="card-panel">
      <div class="section-label" style="margin-bottom:12px">DADOS DO ATLETA</div>
      <div class="form-field">
        <label>Nome</label>
        <input class="text-input" id="set-name" value="${escapeHtml(s.userName)}" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-field">
          <label>Peso corporal (kg)</label>
          <input class="text-input" type="number" step="0.5" id="set-bw" value="${s.bodyWeightKg}" />
        </div>
        <div class="form-field">
          <label>Meta semanal (dias)</label>
          <input class="text-input" type="number" min="1" max="7" id="set-goal" value="${s.weeklyGoal}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-field">
          <label>Unidade de carga</label>
          <select class="select-input" id="set-unit">
            <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>Quilogramas (kg)</option>
            <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>Libras (lb)</option>
          </select>
        </div>
        <div class="form-field">
          <label>Descanso padrão (seg)</label>
          <input class="text-input" type="number" step="15" min="15" max="300" id="set-rest" value="${s.defaultRestSeconds}" />
        </div>
      </div>
      <button class="btn-primary" id="btn-save-profile" style="height:44px;margin-top:6px">SALVAR PREFERÊNCIAS</button>
    </section>

    <section class="card-panel">
      <div class="section-label" style="margin-bottom:8px">ALERTAS DO CRONÔMETRO</div>
      <div class="toggle-row">
        <span>Alerta sonoro ao fim do descanso</span>
        <button class="switch ${s.soundEnabled ? 'on' : ''}" id="tog-sound" aria-label="Som"></button>
      </div>
      <div class="toggle-row">
        <span>Vibração no celular</span>
        <button class="switch ${s.vibrateEnabled ? 'on' : ''}" id="tog-vibrate" aria-label="Vibração"></button>
      </div>
      <div class="toggle-row">
        <span>Manter tela acesa durante o treino</span>
        <button class="switch ${s.keepScreenOn !== false ? 'on' : ''}" id="tog-screen" aria-label="Manter tela acesa"></button>
      </div>
    </section>

    <section class="card-panel">
      <div class="section-label" style="margin-bottom:10px">BACKUP OFFLINE (JSON)</div>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">Seus treinos, planos, histórico e exercícios personalizados ficam salvos localmente no IndexedDB do celular. Exporte um backup antes de reinstalar o APK.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <button class="btn-secondary" id="btn-export-json">⬇ Exportar JSON</button>
        <label class="btn-secondary" style="cursor:pointer">
          ⬆ Importar JSON
          <input type="file" id="input-import-json" accept="application/json" style="display:none" />
        </label>
      </div>
      <button class="btn-ghost" id="btn-reset-demo" style="width:100%;justify-content:center;color:var(--danger);border-color:rgba(239,68,68,0.28)">Restaurar dados iniciais de fábrica</button>
    </section>

    <section class="card-panel">
      <div class="section-label" style="margin-bottom:8px">CRÉDITOS</div>
      <p class="muted" style="font-size:12.5px;margin:0">
        Exercise data by <a class="accent-text" href="https://repdb.co" target="_blank" rel="nofollow noopener">RepDB (repdb.co)</a>.
        Ilustrações usadas conforme a licença gratuita. Conteúdo informativo, não substitui orientação médica ou profissional.
      </p>
    </section>
  `;

  document.getElementById('btn-save-profile').addEventListener('click', () => {
    state.settings.userName = document.getElementById('set-name').value.trim() || 'Atleta ForjaFit';
    state.settings.bodyWeightKg = Math.max(30, Number(document.getElementById('set-bw').value) || 80);
    state.settings.weeklyGoal = Math.min(7, Math.max(1, Number(document.getElementById('set-goal').value) || 4));
    state.settings.unit = document.getElementById('set-unit').value;
    state.settings.defaultRestSeconds = Math.max(15, Number(document.getElementById('set-rest').value) || 90);
    saveState();
    showToast('Preferências salvas!');
  });

  document.getElementById('tog-sound').addEventListener('click', () => {
    state.settings.soundEnabled = !state.settings.soundEnabled;
    saveState();
    renderProfileTab();
  });

  document.getElementById('tog-vibrate').addEventListener('click', () => {
    state.settings.vibrateEnabled = !state.settings.vibrateEnabled;
    saveState();
    renderProfileTab();
  });

  document.getElementById('tog-screen').addEventListener('click', () => {
    state.settings.keepScreenOn = state.settings.keepScreenOn === false;
    saveState();
    setScreenWakeLock(Boolean(state.activeWorkout) && state.settings.keepScreenOn);
    renderProfileTab();
  });

  document.getElementById('btn-export-json').addEventListener('click', async () => {
    const json = await exportAllData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forjafit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup JSON exportado!');
  });

  document.getElementById('input-import-json').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      state = await importAllData(text);
      updateActiveWorkoutBar();
      renderCurrentTab();
      showToast('Backup restaurado com sucesso!');
    } catch (err) {
      showToast(err.message || 'Erro ao importar arquivo.');
    }
  });

  document.getElementById('btn-reset-demo').addEventListener('click', async () => {
    if (!confirm('Isso apagará todo o seu histórico, planos e exercícios personalizados e voltará ao plano inicial. Continuar?')) return;
    state = buildSeedState(PLANS_SEED);
    await saveState();
    updateActiveWorkoutBar();
    renderProfileTab();
    showToast('Dados iniciais restaurados.');
  });
}

// ======================= BOTTOM SHEETS & MODALS =======================

function openSheet(innerHtml, onMount) {
  sheetDismissHandler = null;
  const openBody = modalRoot.querySelector('.sheet-body');

  // A sheet already on screen only swaps its content: rebuilding the panel
  // would replay the opening animation and flash on every stepper tap.
  if (openBody) {
    const previousTitle = openBody.querySelector('.sheet-title')?.textContent;
    const previousScroll = openBody.scrollTop;
    openBody.innerHTML = innerHtml;
    const isSameSheet = previousTitle === openBody.querySelector('.sheet-title')?.textContent;
    openBody.scrollTop = isSameSheet ? previousScroll : 0;
  } else {
    armBackGuard();
    modalRoot.innerHTML = `
      <div class="sheet-backdrop" id="sheet-backdrop">
        <div class="sheet-panel" role="dialog" aria-modal="true">
          <div class="sheet-handle"></div>
          <div class="sheet-body">${innerHtml}</div>
        </div>
      </div>
    `;
    const backdrop = document.getElementById('sheet-backdrop');
    backdrop.addEventListener('click', (e) => {
      if (e.target !== backdrop) return;
      sheetDismissHandler?.();
      closeSheet();
    });
  }
  if (onMount) onMount();
}

function closeSheet() {
  sheetDismissHandler = null;
  modalRoot.innerHTML = '';
}

// --- EXERCISE DETAIL SHEET (faithful to reference 00:06-00:26) ---
function openExerciseDetailSheet(exIdx) {
  const aw = state.activeWorkout;
  const day = getActiveDay();
  const list = aw ? aw.exercises : day.exercises;
  const entry = list[exIdx];
  if (!entry) return;
  const ex = getExerciseById(entry.exerciseId);
  const unit = state.settings.unit;
  const prevLog = getPreviousExerciseLog(state.history, entry.exerciseId);

  const badgeText = (s, normalNum) => {
    if (s.type === 'warmup') return 'A';
    if (s.type === 'dropset') return 'D';
    if (s.type === 'failure') return 'F';
    return String(normalNum);
  };

  let normalCounter = 0;
  const rowsHtml = entry.sets.map((s, sIdx) => {
    if (s.type === 'normal' || !s.type) normalCounter++;
    const label = badgeText(s, normalCounter);
    const prevSet = prevLog?.sets?.[sIdx];
    return `
      <div class="set-row ${s.completed ? 'completed-row' : ''}">
        <button class="set-type-badge ${s.type || 'normal'}" data-set-type-idx="${sIdx}" title="Alterar tipo de série">${label}</button>
        ${entry.timed && aw && !s.completed
          ? `<button class="set-cell" data-hold-idx="${sIdx}" title="Iniciar cronômetro">▶ ${formatRestBadge(s.durationSec)}</button>`
          : `<button class="set-cell" data-edit-set-idx="${sIdx}">${entry.timed ? formatRestBadge(s.durationSec) : s.reps}</button>`}
        <button class="set-cell" data-edit-set-idx="${sIdx}">${formatWeight(s.weight, unit)}</button>
        <button class="set-check-btn ${s.completed ? 'checked' : ''}" data-toggle-done="${sIdx}" title="Concluir série">✓</button>
      </div>
      ${prevSet && prevSet.completed !== false ? `<div class="prev-hint">Último: ${prevSet.durationSec ? formatRestBadge(prevSet.durationSec) : `${prevSet.reps} reps`} × ${formatWeight(prevSet.weight, unit)} ${unit}</div>` : ''}
    `;
  }).join('');

  openSheet(`
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
      ${renderExerciseThumb(ex)}
      <div style="flex:1">
        <h2 class="sheet-title">${escapeHtml(ex.name)}</h2>
        <div class="muted" style="font-size:12px">${escapeHtml(ex.muscle)} • ${entry.unilateral ? 'Unilateral' : 'Bilateral'}</div>
      </div>
      <button class="icon-circle-btn" id="sheet-close-btn">✕</button>
    </div>

    <div class="action-chips">
      <button class="chip-btn" id="chip-howto">▶ COMO FAZER</button>
      <button class="chip-btn" id="chip-replace">⇄ SUBSTITUIR</button>
      <button class="chip-btn" id="chip-rest">⏱ ${formatRestBadge(entry.restSeconds)}</button>
      <button class="chip-btn" id="chip-timed">${entry.timed ? '# USAR REPS' : '⏲ USAR TEMPO'}</button>
      ${['Barra', 'Smith'].includes(ex.equipment) ? '<button class="chip-btn" id="chip-plates">🏋 ANILHAS</button>' : ''}
      ${exIdx > 0 ? '<button class="chip-btn" id="chip-move-up">↑ SUBIR</button>' : ''}
      ${exIdx < list.length - 1 ? '<button class="chip-btn" id="chip-move-down">↓ DESCER</button>' : ''}
      <button class="chip-btn" id="chip-optional">${entry.optional ? '★ OPCIONAL' : '☆ MARCAR OPCIONAL'}</button>
      <button class="chip-btn danger" id="chip-delete">🗑 EXCLUIR</button>
    </div>

    <input class="note-input" id="ex-note-input" placeholder="Adicionar nota..." value="${escapeHtml(entry.note || '')}" />

    <div class="sets-grid-head">
      <span>SET</span>
      <span>${entry.timed ? 'TEMPO' : 'REPS'}</span>
      <span>PESO (${unit.toUpperCase()})</span>
      <span>${aw ? 'FEITO' : 'OK'}</span>
    </div>

    ${rowsHtml}

    <button class="add-set-btn" id="btn-add-set">
      <span class="add-set-plus">＋</span>
      <span>ADICIONAR SET</span>
    </button>

    ${!aw ? `
      <button class="btn-primary" id="sheet-start-workout">INICIAR TREINO</button>
    ` : `
      <button class="btn-primary" id="sheet-done-viewing">VOLTAR AO TREINO</button>
    `}
  `, () => {
    document.getElementById('sheet-close-btn').addEventListener('click', closeSheet);
    document.getElementById('sheet-done-viewing')?.addEventListener('click', closeSheet);
    document.getElementById('sheet-start-workout')?.addEventListener('click', () => {
      closeSheet();
      startWorkoutSession(day, getActivePlan().name, false);
    });

    document.getElementById('ex-note-input').addEventListener('change', (e) => {
      entry.note = e.target.value;
      saveState();
    });

    document.getElementById('chip-howto').addEventListener('click', () => {
      openHowToModal(ex, () => openExerciseDetailSheet(exIdx));
    });

    document.getElementById('chip-replace').addEventListener('click', () => {
      openExercisePickerModal((chosen) => {
        entry.exerciseId = chosen.id;
        entry.unilateral = chosen.unilateral;
        saveState();
        renderPlanTab();
        openExerciseDetailSheet(exIdx);
        showToast(`Substituído por ${chosen.name}`);
      }, ex.muscle);
    });

    document.getElementById('chip-rest').addEventListener('click', () => {
      openRestDurationPicker(entry.restSeconds || 90, (sec) => {
        entry.restSeconds = sec;
        saveState();
        openExerciseDetailSheet(exIdx);
      });
    });

    document.getElementById('chip-timed').addEventListener('click', () => {
      entry.timed = !entry.timed;
      entry.sets.forEach((s) => {
        if (entry.timed) s.durationSec = s.durationSec || 30;
        else delete s.durationSec;
      });
      saveState();
      updateActiveWorkoutBar();
      renderPlanTab();
      openExerciseDetailSheet(exIdx);
    });

    modalRoot.querySelectorAll('[data-hold-idx]').forEach((btn) => {
      btn.addEventListener('click', () => openHoldTimerSheet(entry, Number(btn.dataset.holdIdx), exIdx));
    });

    document.getElementById('chip-plates')?.addEventListener('click', () => {
      const nextSet = entry.sets.find((s) => !s.completed) || entry.sets[0];
      openPlateCalculator(nextSet?.weight || 0, () => openExerciseDetailSheet(exIdx));
    });

    const moveExercise = (delta) => {
      const target = exIdx + delta;
      [list[exIdx], list[target]] = [list[target], list[exIdx]];
      saveState();
      renderPlanTab();
      openExerciseDetailSheet(target);
    };
    document.getElementById('chip-move-up')?.addEventListener('click', () => moveExercise(-1));
    document.getElementById('chip-move-down')?.addEventListener('click', () => moveExercise(1));

    document.getElementById('chip-optional').addEventListener('click', () => {
      entry.optional = !entry.optional;
      saveState();
      renderPlanTab();
      openExerciseDetailSheet(exIdx);
    });

    document.getElementById('chip-delete').addEventListener('click', () => {
      if (!confirm(`Remover "${ex.name}" deste treino?`)) return;
      list.splice(exIdx, 1);
      saveState();
      updateActiveWorkoutBar();
      closeSheet();
      renderPlanTab();
      showToast('Exercício removido.');
    });

    document.getElementById('btn-add-set').addEventListener('click', () => {
      const last = entry.sets[entry.sets.length - 1] || { type: 'normal', reps: 10, weight: 20 };
      entry.sets.push({
        type: 'normal',
        reps: last.reps,
        weight: last.weight,
        completed: false,
        ...(entry.timed ? { durationSec: last.durationSec || 30 } : {})
      });
      saveState();
      updateActiveWorkoutBar();
      renderPlanTab();
      openExerciseDetailSheet(exIdx);
    });

    // Set type badge click (Normal / Aquecimento / Dropset / Falha / Remover)
    modalRoot.querySelectorAll('[data-set-type-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sIdx = Number(btn.dataset.setTypeIdx);
        openSetTypeModal(entry, sIdx, exIdx);
      });
    });

    // Reps / Weight click -> Bilateral / Unilateral 0.25kg modal
    modalRoot.querySelectorAll('[data-edit-set-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sIdx = Number(btn.dataset.editSetIdx);
        openWeightRepsModal(entry, sIdx, exIdx);
      });
    });

    // Complete set check -> auto rest timer!
    modalRoot.querySelectorAll('[data-toggle-done]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sIdx = Number(btn.dataset.toggleDone);
        if (!state.activeWorkout) {
          showToast('Toque em INICIAR TREINO para marcar séries e ativar o cronômetro.');
          return;
        }
        entry.sets[sIdx].completed = !entry.sets[sIdx].completed;
        saveState();
        updateActiveWorkoutBar();
        renderPlanTab();
        if (entry.sets[sIdx].completed) {
          triggerRestForSeconds(entry.restSeconds || state.settings.defaultRestSeconds);
        }
        openExerciseDetailSheet(exIdx);
      });
    });
  });
}

// --- SET TYPE MODAL (matches reference 00:12) ---
function openSetTypeModal(entry, sIdx, exIdx) {
  const cur = entry.sets[sIdx]?.type || 'normal';
  const options = [
    { key: 'normal', badge: '1', cls: 'normal', title: 'SÉRIE NORMAL', desc: 'Série principal válida contabilizada no volume.' },
    { key: 'warmup', badge: 'A', cls: 'warmup', title: 'SÉRIE DE AQUECIMENTO', desc: 'Preparação articular/muscular (não entra no volume).' },
    { key: 'dropset', badge: 'D', cls: 'dropset', title: 'DROPSET', desc: 'Redução imediata de carga sem descanso.' },
    { key: 'failure', badge: 'F', cls: 'failure', title: 'SÉRIE ATÉ A FALHA', desc: 'Execução máxima até falha concêntrica técnica.' }
  ];

  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">Tipo de série</h2>
      <button class="icon-circle-btn" id="st-back">✕</button>
    </div>
    <div class="option-list">
      ${options.map((o) => `
        <button class="option-row ${cur === o.key ? 'active' : ''}" data-pick-type="${o.key}">
          <div class="option-left">
            <span class="set-type-badge ${o.cls}">${o.badge}</span>
            <div>
              <div style="font-weight:800;font-size:13px">${o.title}</div>
              <div class="muted" style="font-size:11.5px">${o.desc}</div>
            </div>
          </div>
        </button>
      `).join('')}
      <button class="option-row danger" id="btn-remove-set">
        <div class="option-left">
          <span class="set-type-badge" style="background:var(--danger-bg);color:var(--danger)">🗑</span>
          <strong style="font-size:13px">REMOVER SÉRIE</strong>
        </div>
        <span>›</span>
      </button>
    </div>
  `, () => {
    document.getElementById('st-back').addEventListener('click', () => openExerciseDetailSheet(exIdx));
    modalRoot.querySelectorAll('[data-pick-type]').forEach((b) => {
      b.addEventListener('click', () => {
        entry.sets[sIdx].type = b.dataset.pickType;
        saveState();
        renderPlanTab();
        openExerciseDetailSheet(exIdx);
      });
    });
    document.getElementById('btn-remove-set').addEventListener('click', () => {
      if (entry.sets.length <= 1) {
        showToast('O exercício precisa manter ao menos 1 série.');
        return;
      }
      entry.sets.splice(sIdx, 1);
      saveState();
      updateActiveWorkoutBar();
      renderPlanTab();
      openExerciseDetailSheet(exIdx);
    });
  });
}

// --- BILATERAL / UNILATERAL & 0.25 KG PICKER (matches reference 00:20-00:24) ---
function openWeightRepsModal(entry, sIdx, exIdx) {
  const ex = getExerciseById(entry.exerciseId);
  const set = entry.sets[sIdx];
  let tempReps = Number(set.reps) || 10;
  let tempDuration = Number(set.durationSec) || 30;
  let tempUnilateral = Boolean(entry.unilateral);
  const unit = state.settings.unit;
  // The picker works in the user's unit; storage is always kg
  let totalWeight = roundQuarter(kgToUnit(set.weight, unit));
  const initialDisplayWeight = totalWeight;
  let intKg = Math.floor(totalWeight);
  let fracKg = roundQuarter(totalWeight - intKg);

  function renderModal() {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title" style="font-size:15px">${escapeHtml(ex.name.toUpperCase())} (${sIdx + 1}/${entry.sets.length})</h2>
        <button class="icon-circle-btn" id="wr-close">✕</button>
      </div>

      <div class="segmented-control">
        <button class="seg-btn ${!tempUnilateral ? 'active' : ''}" id="seg-bilateral">BILATERAL 🏋️</button>
        <button class="seg-btn ${tempUnilateral ? 'active' : ''}" id="seg-unilateral">UNILATERAL 💪</button>
      </div>

      <p class="muted" style="font-size:12.5px;margin:0 0 8px">
        ${!tempUnilateral
          ? "Se a opção 'Bilateral' for selecionada, o peso será calculado como o total de ambos os lados do equipamento."
          : "Informe o peso e as repetições de um lado só. O volume do treino conta os dois lados (dobro)."}
      </p>

      <div class="picker-grid">
        ${entry.timed ? `
          <div class="picker-box">
            <div class="picker-label">TEMPO (SEG)</div>
            <div class="stepper-row">
              <button class="step-btn" id="dur-minus" aria-label="Diminuir 5 segundos">−</button>
              <input class="picker-input" type="number" id="dur-val" min="5" max="600" value="${tempDuration}" />
              <button class="step-btn" id="dur-plus" aria-label="Aumentar 5 segundos">＋</button>
            </div>
          </div>
        ` : `
          <div class="picker-box">
            <div class="picker-label">REPS</div>
            <div class="stepper-row">
              <button class="step-btn" id="reps-minus">−</button>
              <input class="picker-input" type="number" id="reps-val" min="1" max="200" value="${tempReps}" />
              <button class="step-btn" id="reps-plus">＋</button>
            </div>
          </div>
        `}

        <div class="picker-box">
          <div class="picker-label">PESO (${unit.toUpperCase()})</div>
          <div class="stepper-row">
            <button class="step-btn" id="kg-minus">−</button>
            <input class="picker-input" type="number" id="kg-int-val" min="0" max="1400" value="${intKg}" />
            <button class="step-btn" id="kg-plus">＋</button>
          </div>
          <div class="fraction-pills">
            ${[0, 0.25, 0.5, 0.75].map((f) => `
              <button class="frac-btn ${Math.abs(fracKg - f) < 0.01 ? 'active' : ''}" data-frac="${f}">.${String(Math.round(f * 100)).padStart(2, '0')}</button>
            `).join('')}
          </div>
        </div>
      </div>

      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-secondary);margin-bottom:14px">
        <input type="checkbox" id="apply-all-sets" style="width:16px;height:16px;accent-color:var(--accent)" />
        Aplicar este peso/reps às próximas séries deste exercício
      </label>

      <button class="btn-primary" id="btn-save-wr">SALVAR</button>
    `, () => {
      document.getElementById('wr-close').addEventListener('click', () => openExerciseDetailSheet(exIdx));
      document.getElementById('seg-bilateral').addEventListener('click', () => { tempUnilateral = false; renderModal(); });
      document.getElementById('seg-unilateral').addEventListener('click', () => { tempUnilateral = true; renderModal(); });

      document.getElementById('reps-minus')?.addEventListener('click', () => { tempReps = Math.max(1, tempReps - 1); renderModal(); });
      document.getElementById('reps-plus')?.addEventListener('click', () => { tempReps = Math.min(200, tempReps + 1); renderModal(); });
      document.getElementById('reps-val')?.addEventListener('change', (e) => { tempReps = Math.max(1, Number(e.target.value) || 1); });

      const clampDuration = (v) => Math.min(600, Math.max(5, Math.round(Number(v) || 30)));
      document.getElementById('dur-minus')?.addEventListener('click', () => { tempDuration = clampDuration(tempDuration - 5); renderModal(); });
      document.getElementById('dur-plus')?.addEventListener('click', () => { tempDuration = clampDuration(tempDuration + 5); renderModal(); });
      document.getElementById('dur-val')?.addEventListener('change', (e) => { tempDuration = clampDuration(e.target.value); });

      const maxDisplayWeight = unit === 'lb' ? 1400 : 600;
      document.getElementById('kg-minus').addEventListener('click', () => { intKg = Math.max(0, intKg - 1); renderModal(); });
      document.getElementById('kg-plus').addEventListener('click', () => { intKg = Math.min(maxDisplayWeight, intKg + 1); renderModal(); });
      document.getElementById('kg-int-val').addEventListener('change', (e) => { intKg = Math.max(0, Math.floor(Number(e.target.value) || 0)); });

      modalRoot.querySelectorAll('[data-frac]').forEach((btn) => {
        btn.addEventListener('click', () => { fracKg = Number(btn.dataset.frac); renderModal(); });
      });

      document.getElementById('btn-save-wr').addEventListener('click', () => {
        const repsInput = document.getElementById('reps-val');
        const durInput = document.getElementById('dur-val');
        const finalReps = repsInput ? Math.max(1, Number(repsInput.value) || tempReps) : set.reps;
        const finalDuration = durInput ? Math.min(600, Math.max(5, Math.round(Number(durInput.value) || tempDuration))) : null;
        const finalInt = Math.max(0, Math.floor(Number(document.getElementById('kg-int-val').value) || 0));
        const finalDisplayWeight = roundQuarter(finalInt + fracKg);
        // Keep the stored kg when untouched, so lb <-> kg rounding never drifts
        const finalWeight = finalDisplayWeight === initialDisplayWeight ? set.weight : unitToKg(finalDisplayWeight, unit);
        const applyAll = document.getElementById('apply-all-sets').checked;

        entry.unilateral = tempUnilateral;
        const targets = applyAll ? entry.sets.slice(sIdx) : [set];
        for (const target of targets) {
          target.reps = finalReps;
          target.weight = finalWeight;
          if (finalDuration) target.durationSec = finalDuration;
        }
        saveState();
        updateActiveWorkoutBar();
        renderPlanTab();
        openExerciseDetailSheet(exIdx);
      });
    });
  }
  renderModal();
}

function renderExerciseMedia(exerciseId) {
  const media = EXERCISE_MEDIA[exerciseId];
  if (!media) return '';
  return `
    <figure class="ex-media" id="ex-media">
      <div class="ex-media-frame ${media.files.length > 1 ? 'animated' : ''}">
        ${media.files.map((file) => `<img src="./assets/exercises/${escapeHtml(file)}" alt="Ilustração da execução" width="512" height="512" decoding="async" />`).join('')}
      </div>
      ${media.close ? '<figcaption>Ilustração de uma variação semelhante</figcaption>' : ''}
    </figure>
  `;
}

// --- HOW TO / ANATOMICAL MAP MODAL ---
function openHowToModal(ex, onBack = null) {
  const prev = getPreviousExerciseLog(state.history, ex.id);
  const best1RM = prev ? Math.max(...prev.sets.map((s) => (s.durationSec ? 0 : estimate1RM(s.weight, s.reps)))) : 0;

  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">${escapeHtml(ex.name)}</h2>
      <button class="icon-circle-btn" id="ht-close">✕</button>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="filter-pill active">${escapeHtml(ex.muscle)}</span>
      ${(ex.secondaryMuscles || []).map((m) => `<span class="filter-pill">${escapeHtml(m)}</span>`).join('')}
      <span class="filter-pill">🏷 ${escapeHtml(ex.equipment)}</span>
    </div>

    ${renderExerciseMedia(ex.id)}

    <div class="anatomy-pair">
      <div class="anatomy-col">
        ${renderAnatomyFrontSVG(ex.muscle, ex.secondaryMuscles, 94)}
        <span>Vista Frontal</span>
      </div>
      <div class="anatomy-col">
        ${renderAnatomyBackSVG(ex.muscle, ex.secondaryMuscles, 94)}
        <span>Vista Posterior</span>
      </div>
    </div>

    <div class="card-panel" style="margin-bottom:12px">
      <div class="section-label" style="margin-bottom:6px">EXECUÇÃO TÉCNICA</div>
      <p style="margin:0;font-size:13.5px;color:var(--text-primary)">${escapeHtml(ex.instructions || 'Mantenha controle postural e amplitude completa.')}</p>
    </div>

    ${best1RM > 0 ? `
      <div class="card-panel" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span class="muted" style="font-size:13px">1RM Estimado Recente</span>
        <strong class="accent-text" style="font-size:18px">${best1RM} kg</strong>
      </div>
    ` : ''}

    <button class="btn-secondary" id="ht-done">${onBack ? 'Voltar ao exercício' : 'Fechar'}</button>
  `, () => {
    const goBack = () => (onBack ? onBack() : closeSheet());
    // Image not available yet (first offline launch): fall back to the anatomy map
    document.querySelectorAll('#ex-media img').forEach((img) => {
      img.addEventListener('error', () => document.getElementById('ex-media')?.remove());
    });
    document.getElementById('ht-close').addEventListener('click', goBack);
    document.getElementById('ht-done').addEventListener('click', goBack);
  });
}

// --- ISOMETRIC HOLD TIMER ---
function openHoldTimerSheet(entry, sIdx, exIdx) {
  const set = entry.sets[sIdx];
  const ex = getExerciseById(entry.exerciseId);
  const target = Number(set.durationSec) || 30;

  stopRestTimer();
  restPill.classList.add('hidden');

  const finishHold = (seconds) => {
    set.durationSec = seconds;
    set.completed = true;
    saveState();
    updateActiveWorkoutBar();
    renderPlanTab();
    triggerRestForSeconds(entry.restSeconds || state.settings.defaultRestSeconds);
    openExerciseDetailSheet(exIdx);
  };

  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title" style="font-size:15px">${escapeHtml(ex.name.toUpperCase())} (${sIdx + 1}/${entry.sets.length})</h2>
      <button class="icon-circle-btn" id="hd-close" aria-label="Cancelar cronômetro">✕</button>
    </div>
    <div style="text-align:center;padding:18px 0 22px">
      <div class="section-label" id="hd-phase" aria-live="polite">PREPARE-SE</div>
      <div class="accent-text" id="hd-time" style="font-size:72px;font-weight:900;line-height:1.1;font-variant-numeric:tabular-nums">00:03</div>
      <div class="muted" style="font-size:13px">Meta: ${formatRestBadge(target)}</div>
    </div>
    <button class="btn-primary" id="hd-finish">CONCLUIR AGORA</button>
  `, () => {
    sheetDismissHandler = stopHoldTimer;
    document.getElementById('hd-close').addEventListener('click', () => {
      stopHoldTimer();
      openExerciseDetailSheet(exIdx);
    });
    document.getElementById('hd-finish').addEventListener('click', () => {
      const held = stopHoldTimer();
      if (!held) {
        showToast('O cronômetro ainda não começou.');
        openExerciseDetailSheet(exIdx);
        return;
      }
      finishHold(held);
    });

    startHoldTimer(target, {
      sound: state.settings.soundEnabled,
      vibrate: state.settings.vibrateEnabled,
      onTick: (remaining, phase) => {
        document.getElementById('hd-phase').textContent = phase === 'prep' ? 'PREPARE-SE' : 'SEGURE';
        document.getElementById('hd-time').textContent = formatSecondsClock(remaining);
      },
      onComplete: finishHold
    });
  });
}

// --- PLATE CALCULATOR ---
function openPlateCalculator(initialKg, onBack) {
  let targetKg = roundQuarter(initialKg);

  function renderCalc() {
    const barKg = state.settings.barWeightKg ?? 20;
    const result = calcPlates(targetKg, barKg);
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">Calculadora de anilhas</h2>
        <button class="icon-circle-btn" id="pc-close">✕</button>
      </div>

      <div class="picker-box" style="margin-bottom:12px">
        <div class="picker-label">PESO TOTAL (KG)</div>
        <div class="stepper-row">
          <button class="step-btn" id="pc-minus" aria-label="Diminuir 2,5 kg">−</button>
          <input class="picker-input" type="number" id="pc-target" min="0" max="600" step="0.25" value="${targetKg}" />
          <button class="step-btn" id="pc-plus" aria-label="Aumentar 2,5 kg">＋</button>
        </div>
      </div>

      <div class="section-label" style="margin-bottom:8px">PESO DA BARRA</div>
      <div class="segmented-control">
        ${[20, 15, 10].map((b) => `<button class="seg-btn ${barKg === b ? 'active' : ''}" data-bar="${b}">${b} kg</button>`).join('')}
      </div>

      <div class="card-panel" style="margin-bottom:14px">
        <div class="section-label" style="margin-bottom:8px">EM CADA LADO DA BARRA</div>
        ${result.belowBar ? `<p class="muted" style="margin:0">O peso é menor que a barra de ${formatWeight(barKg)} kg.</p>` : ''}
        ${!result.belowBar && !result.plates.length ? '<p class="muted" style="margin:0">Só a barra, sem anilhas.</p>' : ''}
        ${result.plates.map((p) => `
          <div class="toggle-row">
            <strong style="font-size:18px">${formatWeight(p.size)} kg</strong>
            <strong class="accent-text" style="font-size:18px">× ${p.count}</strong>
          </div>
        `).join('')}
        ${result.remainderKg > 0 ? `<p class="muted" style="margin:10px 0 0;font-size:12.5px">Com essas anilhas, o mais próximo é ${formatWeight(result.loadedKg)} kg (faltam ${formatWeight(result.remainderKg)} kg).</p>` : ''}
      </div>

      <button class="btn-secondary" id="pc-done">Voltar ao exercício</button>
    `, () => {
      document.getElementById('pc-close').addEventListener('click', onBack);
      document.getElementById('pc-done').addEventListener('click', onBack);
      document.getElementById('pc-minus').addEventListener('click', () => { targetKg = Math.max(0, targetKg - 2.5); renderCalc(); });
      document.getElementById('pc-plus').addEventListener('click', () => { targetKg = Math.min(600, targetKg + 2.5); renderCalc(); });
      document.getElementById('pc-target').addEventListener('change', (e) => {
        targetKg = Math.min(600, roundQuarter(e.target.value));
        renderCalc();
      });
      modalRoot.querySelectorAll('[data-bar]').forEach((b) => b.addEventListener('click', () => {
        state.settings.barWeightKg = Number(b.dataset.bar);
        saveState();
        renderCalc();
      }));
    });
  }
  renderCalc();
}

// --- REST DURATION PICKER ---
function openRestDurationPicker(currentSec, onSelect) {
  const presets = [30, 45, 60, 75, 90, 120, 150, 180];
  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">Tempo de descanso</h2>
      <button class="icon-circle-btn" id="rd-close">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${presets.map((p) => `
        <button class="btn-secondary" style="height:48px;${p === currentSec ? 'border-color:var(--accent);color:var(--accent)' : ''}" data-sec="${p}">
          ${formatRestBadge(p)}
        </button>
      `).join('')}
    </div>
  `, () => {
    document.getElementById('rd-close').addEventListener('click', closeSheet);
    modalRoot.querySelectorAll('[data-sec]').forEach((b) => {
      b.addEventListener('click', () => onSelect(Number(b.dataset.sec)));
    });
  });
}

// --- EXERCISE PICKER MODAL (Add or Replace) ---
function openExercisePickerModal(onPick, initialMuscle = 'Todos') {
  let q = '';
  let mFilter = initialMuscle;

  function renderPicker() {
    const all = getAllExercises();
    const matches = all.filter((e) => {
      if (mFilter !== 'Todos' && e.muscle !== mFilter) return false;
      if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    }).slice(0, 60);

    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">${initialMuscle !== 'Todos' ? `Substituir (${initialMuscle})` : 'Selecionar exercício'}</h2>
        <button class="icon-circle-btn" id="pk-close">✕</button>
      </div>
      <div class="search-bar">
        <span>🔍</span>
        <input id="pk-search" placeholder="Buscar exercício..." value="${escapeHtml(q)}" />
      </div>
      <div class="filter-strip">
        ${MUSCLE_GROUPS.map((m) => `<button class="filter-pill ${mFilter === m ? 'active' : ''}" data-pk-m="${m}">${m}</button>`).join('')}
      </div>
      <div class="exercise-list" style="margin-top:8px">
        ${matches.map((ex) => `
          <div class="exercise-card" data-pick-id="${ex.id}">
            ${renderExerciseThumb(ex)}
            <div class="exercise-info">
              <h3 class="exercise-name">${escapeHtml(ex.name)}</h3>
              <div class="exercise-meta">${escapeHtml(ex.muscle)} • ${escapeHtml(ex.equipment)}</div>
            </div>
            <span class="accent-text" style="font-weight:900;font-size:18px">＋</span>
          </div>
        `).join('')}
      </div>
    `, () => {
      document.getElementById('pk-close').addEventListener('click', closeSheet);
      const inp = document.getElementById('pk-search');
      inp.addEventListener('input', (e) => {
        q = e.target.value;
        renderPicker();
        const fresh = document.getElementById('pk-search');
        fresh.focus();
        fresh.setSelectionRange(fresh.value.length, fresh.value.length);
      });
      modalRoot.querySelectorAll('[data-pk-m]').forEach((b) => b.addEventListener('click', () => {
        mFilter = b.dataset.pkM;
        renderPicker();
      }));
      modalRoot.querySelectorAll('[data-pick-id]').forEach((card) => {
        card.addEventListener('click', () => {
          const chosen = getExerciseById(card.dataset.pickId);
          closeSheet();
          onPick(chosen);
        });
      });
    });
  }
  renderPicker();
}

// --- CARDIO LOGGER MODAL ---
function openCardioModal() {
  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">🔥 Registrar cardio</h2>
      <button class="icon-circle-btn" id="cd-close">✕</button>
    </div>
    <div class="form-field">
      <label>Modalidade</label>
      <select class="select-input" id="cd-act">
        <option value="Corrida">Corrida</option>
        <option value="Caminhada / Trote">Caminhada / Trote</option>
        <option value="Bicicleta">Bicicleta</option>
        <option value="CrossFit / HIIT">CrossFit / HIIT</option>
        <option value="Escada / Elíptico">Escada / Elíptico</option>
        <option value="Remo">Remo</option>
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-field">
        <label>Duração (minutos)</label>
        <input class="text-input" type="number" id="cd-min" value="30" min="1" />
      </div>
      <div class="form-field">
        <label>Distância (km, opcional)</label>
        <input class="text-input" type="number" step="0.1" id="cd-km" placeholder="5.0" />
      </div>
    </div>
    <button class="btn-primary" id="cd-save">SALVAR CARDIO</button>
  `, () => {
    document.getElementById('cd-close').addEventListener('click', closeSheet);
    document.getElementById('cd-save').addEventListener('click', () => {
      const activity = document.getElementById('cd-act').value;
      const durationMin = Math.max(1, Number(document.getElementById('cd-min').value) || 20);
      const distanceKm = Number(document.getElementById('cd-km').value) || 0;
      const calories = Math.round(7.5 * state.settings.bodyWeightKg * (durationMin / 60));
      state.cardioLogs.push({ id: uid('cardio'), activity, durationMin, distanceKm, calories, date: new Date().toISOString() });
      saveState();
      closeSheet();
      showToast(`Cardio registrado: ${activity} (${calories} kcal)!`);
      if (currentTab === 'progress') renderProgressTab();
    });
  });
}

// --- QUICK WORKOUT GENERATOR MODAL ---
function openQuickWorkoutGeneratorModal() {
  const selectableMuscles = ['Peito', 'Costas', 'Ombros', 'Bíceps', 'Tríceps', 'Quadríceps', 'Posteriores', 'Glúteos', 'Abdômen'];
  const selected = new Set(['Peito', 'Tríceps']);

  function renderGen() {
    openSheet(`
      <div class="sheet-header">
        <h2 class="sheet-title">⚡ Criar Treino Rápido</h2>
        <button class="icon-circle-btn" id="qg-close">✕</button>
      </div>
      <div class="section-label" style="margin-bottom:8px">GRUPOS MUSCULARES</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
        ${selectableMuscles.map((m) => `
          <button class="filter-pill ${selected.has(m) ? 'active' : ''}" data-qg-m="${m}">${m}</button>
        `).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div class="form-field">
          <label>Quantidade de exercícios</label>
          <select class="select-input" id="qg-count">
            <option value="4">4 exercícios (~30 min)</option>
            <option value="6" selected>6 exercícios (~45 min)</option>
            <option value="8">8 exercícios (~60 min)</option>
          </select>
        </div>
        <div class="form-field">
          <label>Equipamento</label>
          <select class="select-input" id="qg-eq">
            <option value="Todos">Academia Completa</option>
            <option value="Halteres">Apenas Halteres</option>
            <option value="Máquina">Apenas Máquinas</option>
            <option value="Peso Corporal">Peso Corporal</option>
          </select>
        </div>
      </div>
      <button class="btn-primary" id="qg-go">GERAR E INICIAR TREINO</button>
    `, () => {
      document.getElementById('qg-close').addEventListener('click', closeSheet);
      modalRoot.querySelectorAll('[data-qg-m]').forEach((b) => b.addEventListener('click', () => {
        const m = b.dataset.qgM;
        if (selected.has(m)) selected.delete(m);
        else selected.add(m);
        renderGen();
      }));
      document.getElementById('qg-go').addEventListener('click', () => {
        if (!selected.size) { showToast('Selecione ao menos 1 grupo muscular.'); return; }
        const count = Number(document.getElementById('qg-count').value);
        const eq = document.getElementById('qg-eq').value;
        const pool = getAllExercises().filter((e) => selected.has(e.muscle) && (eq === 'Todos' || e.equipment === eq));
        if (!pool.length) { showToast('Nenhum exercício compatível com esse filtro.'); return; }

        // Balanced pick across chosen muscles
        const chosen = [];
        const groups = [...selected];
        let guard = 0;
        while (chosen.length < count && guard < 100) {
          const grp = groups[guard % groups.length];
          const candidates = pool.filter((e) => e.muscle === grp && !chosen.some((c) => c.id === e.id));
          if (candidates.length) {
            const pick = candidates[Math.floor(Math.random() * Math.min(8, candidates.length))];
            chosen.push(pick);
          }
          guard++;
        }
        const dayObj = {
          label: 'RÁPIDO',
          title: `Treino Rápido: ${groups.join(', ')}`,
          exercises: chosen.map((ex) => ({
            exerciseId: ex.id,
            restSeconds: state.settings.defaultRestSeconds,
            optional: false,
            unilateral: ex.unilateral,
            note: '',
            sets: [
              { type: 'normal', reps: 10, weight: ex.equipment === 'Peso Corporal' ? 0 : 20 },
              { type: 'normal', reps: 10, weight: ex.equipment === 'Peso Corporal' ? 0 : 20 },
              { type: 'normal', reps: 10, weight: ex.equipment === 'Peso Corporal' ? 0 : 20 }
            ]
          }))
        };
        closeSheet();
        startWorkoutSession(dayObj, 'Treino Rápido', true);
      });
    });
  }
  renderGen();
}

// --- CREATE CUSTOM EXERCISE MODAL ---
function openCreateCustomExerciseModal() {
  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">+ Novo Exercício</h2>
      <button class="icon-circle-btn" id="ce-close">✕</button>
    </div>
    <div class="form-field">
      <label>Nome do exercício</label>
      <input class="text-input" id="ce-name" placeholder="Ex: Supino Articulado Convergente" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-field">
        <label>Grupo Muscular</label>
        <select class="select-input" id="ce-muscle">
          ${MUSCLE_GROUPS.filter((m) => m !== 'Todos').map((m) => `<option value="${m}">${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label>Equipamento</label>
        <select class="select-input" id="ce-equip">
          ${EQUIPMENTS.filter((e) => e !== 'Todos').map((e) => `<option value="${e}">${e}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-field">
      <label>Instruções curtas (opcional)</label>
      <input class="text-input" id="ce-inst" placeholder="Dica técnica de execução..." />
    </div>
    <button class="btn-primary" id="ce-save">CADASTRAR EXERCÍCIO</button>
  `, () => {
    document.getElementById('ce-close').addEventListener('click', closeSheet);
    document.getElementById('ce-save').addEventListener('click', () => {
      const name = document.getElementById('ce-name').value.trim();
      if (!name) { showToast('Informe o nome do exercício.'); return; }
      const newEx = {
        id: uid('custom'),
        name,
        muscle: document.getElementById('ce-muscle').value,
        secondaryMuscles: [],
        equipment: document.getElementById('ce-equip').value,
        unilateral: name.toLowerCase().includes('unilateral'),
        popularity: 999,
        instructions: document.getElementById('ce-inst').value.trim() || 'Execute com postura firme e amplitude controlada.'
      };
      state.customExercises.push(newEx);
      saveState();
      closeSheet();
      renderExercisesTab();
      showToast(`${name} salvo no catálogo!`);
    });
  });
}

// --- PLAN SWITCHER, DAY OPTIONS, PLAN EDITOR & WORKOUT SUMMARY ---
function openPlanSwitcherModal() {
  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">Meus Planos</h2>
      <button class="icon-circle-btn" id="ps-close">✕</button>
    </div>
    <div class="option-list" style="margin-bottom:14px">
      ${state.plans.map((p) => `
        <button class="option-row ${p.id === state.activePlanId ? 'active' : ''}" data-sel-plan="${p.id}">
          <div>
            <strong>${escapeHtml(p.name)}</strong>
            <div class="muted" style="font-size:12px">${p.days.length} dias • ${escapeHtml(p.level || 'Personalizado')}</div>
          </div>
          ${p.id === state.activePlanId ? '<span class="accent-text">✓</span>' : ''}
        </button>
      `).join('')}
    </div>
    <button class="btn-secondary" id="btn-create-blank-plan">+ Criar Novo Plano do Zero</button>
  `, () => {
    document.getElementById('ps-close').addEventListener('click', closeSheet);
    modalRoot.querySelectorAll('[data-sel-plan]').forEach((b) => b.addEventListener('click', () => {
      state.activePlanId = b.dataset.selPlan;
      state.activeDayIndex = 0;
      saveState();
      closeSheet();
      renderPlanTab();
    }));
    document.getElementById('btn-create-blank-plan').addEventListener('click', () => {
      const name = prompt('Nome do novo plano (ex: Hipertrofia ABC):');
      if (!name) return;
      const np = {
        id: uid('plan'),
        name: name.trim(),
        level: 'Personalizado',
        location: 'Academia',
        days: [{ id: uid('day'), label: 'DIA 1', title: 'Treino A', completed: false, exercises: [] }]
      };
      state.plans.push(np);
      state.activePlanId = np.id;
      state.activeDayIndex = 0;
      saveState();
      closeSheet();
      renderPlanTab();
    });
  });
}

function openDayOptionsModal(day) {
  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">${escapeHtml(day.label)} — ${escapeHtml(day.title)}</h2>
      <button class="icon-circle-btn" id="do-close">✕</button>
    </div>
    <div class="option-list">
      <button class="option-row" id="do-rename"><strong>✎ Renomear dia</strong></button>
      <button class="option-row" id="do-toggle-done"><strong>${day.completed ? '↺ Desmarcar como concluído' : '✓ Marcar como concluído'}</strong></button>
      <button class="option-row danger" id="do-delete"><strong>🗑 Excluir este dia do plano</strong></button>
    </div>
  `, () => {
    const plan = getActivePlan();
    document.getElementById('do-close').addEventListener('click', closeSheet);
    document.getElementById('do-rename').addEventListener('click', () => {
      const t = prompt('Novo nome do dia:', day.title);
      if (t) { day.title = t.trim(); saveState(); closeSheet(); renderPlanTab(); }
    });
    document.getElementById('do-toggle-done').addEventListener('click', () => {
      day.completed = !day.completed;
      saveState();
      closeSheet();
      renderPlanTab();
    });
    document.getElementById('do-delete').addEventListener('click', () => {
      if (plan.days.length <= 1) { showToast('O plano precisa ter pelo menos 1 dia.'); return; }
      if (!confirm(`Excluir ${day.label}?`)) return;
      plan.days = plan.days.filter((d) => d.id !== day.id);
      plan.days.forEach((d, i) => { d.label = `DIA ${i + 1}`; });
      state.activeDayIndex = 0;
      saveState();
      closeSheet();
      renderPlanTab();
    });
  });
}

function openPlanEditorModal() {
  const plan = getActivePlan();
  openSheet(`
    <div class="sheet-header">
      <h2 class="sheet-title">Editar Plano Atual</h2>
      <button class="icon-circle-btn" id="pe-close">✕</button>
    </div>
    <div class="form-field">
      <label>Nome do plano</label>
      <input class="text-input" id="pe-name" value="${escapeHtml(plan.name)}" />
    </div>
    <div class="section-label" style="margin:12px 0 8px">DIAS DA DIVISÃO</div>
    <div class="option-list" style="margin-bottom:14px">
      ${plan.days.map((d, idx) => `
        <div class="option-row">
          <div>
            <strong>${escapeHtml(d.label)}: ${escapeHtml(d.title)}</strong>
            <div class="muted" style="font-size:12px">${d.exercises.length} exercícios</div>
          </div>
          <button class="btn-ghost" data-jump-day="${idx}">Abrir</button>
        </div>
      `).join('')}
    </div>
    <button class="btn-primary" id="pe-save">SALVAR NOME</button>
  `, () => {
    document.getElementById('pe-close').addEventListener('click', closeSheet);
    document.getElementById('pe-save').addEventListener('click', () => {
      plan.name = document.getElementById('pe-name').value.trim() || plan.name;
      saveState();
      closeSheet();
      renderCurrentTab();
      showToast('Plano atualizado!');
    });
    modalRoot.querySelectorAll('[data-jump-day]').forEach((b) => b.addEventListener('click', () => {
      state.activeDayIndex = Number(b.dataset.jumpDay);
      currentTab = 'plan';
      syncNavActive();
      closeSheet();
      renderCurrentTab();
    }));
  });
}

function openWorkoutSummaryModal(sess) {
  openSheet(`
    <div style="text-align:center;padding:8px 0 14px">
      <div style="font-size:44px;margin-bottom:6px">🏆</div>
      <h2 style="margin:0 0 6px;font-size:22px">Treino Concluído!</h2>
      <p class="muted" style="margin:0 0 18px">${escapeHtml(sess.dayTitle)}</p>
      <div class="hero-metrics" style="background:var(--bg-surface);padding:16px;border-radius:16px;margin-bottom:16px">
        <div>
          <div class="metric-val" style="justify-content:center">${sess.durationMin}m</div>
          <div class="metric-lbl">Duração</div>
        </div>
        <div>
          <div class="metric-val" style="justify-content:center">${sess.volumeKg.toLocaleString('pt-BR')}</div>
          <div class="metric-lbl">Volume (kg)</div>
        </div>
        <div>
          <div class="metric-val" style="justify-content:center;color:var(--gold)">${sess.prs}</div>
          <div class="metric-lbl">Novos PRs</div>
        </div>
      </div>
      <p class="muted" style="font-size:13px;margin-bottom:16px">Estimativa energética: <strong>${sess.calories} kcal</strong></p>
      <button class="btn-primary" id="sum-ok">SHOW DE BOLA!</button>
    </div>
  `, () => {
    document.getElementById('sum-ok').addEventListener('click', closeSheet);
  });
}

// ======================= NAVIGATION & BOOTSTRAP =======================

function syncNavActive() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
}

// Android back button: a guard history entry lets "back" close the open sheet
// or return to the main tab instead of leaving the app. It is only added from
// a user tap, because browsers skip entries pushed without a user gesture.
function armBackGuard() {
  if (!history.state?.forjaBackGuard) history.pushState({ forjaBackGuard: true }, '');
}

function handleBackButton() {
  if (modalRoot.querySelector('.sheet-backdrop')) {
    sheetDismissHandler?.();
    closeSheet();
    armBackGuard();
  } else if (currentTab !== 'plan') {
    currentTab = 'plan';
    syncNavActive();
    renderCurrentTab();
    window.scrollTo({ top: 0, behavior: 'instant' });
    armBackGuard();
  } else {
    showToast('Toque em voltar de novo para sair.');
  }
}

function bindGlobalControls() {
  window.addEventListener('popstate', handleBackButton);

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      armBackGuard();
      currentTab = btn.dataset.tab;
      syncNavActive();
      renderCurrentTab();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  });

  document.getElementById('btn-finish-workout').addEventListener('click', finishActiveWorkout);
  document.getElementById('btn-cancel-workout').addEventListener('click', () => {
    if (confirm('Cancelar o treino em andamento sem salvar?')) cancelActiveWorkout();
  });

  document.getElementById('rtp-minus').addEventListener('click', () => {
    adjustRestTimer(-15, (r) => { document.getElementById('rtp-time').textContent = formatSecondsClock(r); });
  });
  document.getElementById('rtp-plus').addEventListener('click', () => {
    adjustRestTimer(15, (r) => { document.getElementById('rtp-time').textContent = formatSecondsClock(r); });
  });
  document.getElementById('rtp-skip').addEventListener('click', () => {
    stopRestTimer();
    restPill.classList.add('hidden');
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    const isUpdate = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!isUpdate) return;
      // Never reload on its own: the user may be in the middle of a set
      if (state.activeWorkout || modalRoot.querySelector('.sheet-backdrop')) {
        showToast('Nova versão pronta. Ela entra na próxima vez que abrir o app.');
      } else {
        window.location.reload();
      }
    });
    // Called after async init, when the window "load" event has usually already fired
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.warn('SW registration skipped:', err);
    });
    // Downloads the illustrations in the background so they work at the gym
    navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'cache-media' }));
  }
}

async function init() {
  try {
    const [exRes, plansRes] = await Promise.all([
      fetch('./data/exercises.json'),
      fetch('./data/plans.json')
    ]);
    CATALOG = await exRes.json();
    PLANS_SEED = await plansRes.json();
    // Illustrations are optional: the app keeps working with the anatomy map alone
    EXERCISE_MEDIA = await fetch('./data/exercise-media.json').then((r) => r.json()).catch(() => ({}));

    const saved = await dbGet('appState');
    if (saved && saved.plans && saved.plans.length) {
      state = saved;
    } else {
      state = buildSeedState(PLANS_SEED);
      await saveState();
    }

    bindGlobalControls();
    updateActiveWorkoutBar();
    renderCurrentTab();
    registerSW();
    // Asks Android not to evict the workout history when storage runs low
    navigator.storage?.persist?.().catch(() => {});
  } catch (err) {
    mainView.innerHTML = `<div class="card-panel"><h3>Erro ao carregar o ForjaFit</h3><p class="muted">Abra o projeto usando um servidor local (ex.: VS Code Live Server) ou GitHub Pages para permitir o carregamento dos módulos ES e arquivos JSON.</p><pre style="font-size:11px;overflow:auto">${escapeHtml(err.message)}</pre></div>`;
  }
}

init();
