export function roundQuarter(val) {
  return Math.max(0, Math.round(Number(val || 0) * 4) / 4);
}

const KG_TO_LB = 2.20462;

export function kgToUnit(kg, unit = 'kg') {
  return unit === 'lb' ? kg * KG_TO_LB : kg;
}

export function unitToKg(value, unit = 'kg') {
  return unit === 'lb' ? value / KG_TO_LB : value;
}

export function formatWeight(kg, unit = 'kg') {
  const val = kgToUnit(kg, unit);
  const rounded = Math.round(val * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2).replace(/0$/, '');
}

export function estimate1RM(weightKg, reps) {
  const w = Number(weightKg) || 0;
  const r = Number(reps) || 0;
  if (w <= 0 || r <= 0) return 0;
  if (r === 1) return Math.round(w * 10) / 10;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

export const PLATE_SIZES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

// Plates for EACH side of the bar. `remainderKg` is the part of the target
// that the available plates cannot reach.
export function calcPlates(targetKg, barKg = 20) {
  const target = Number(targetKg) || 0;
  const bar = Number(barKg) || 0;
  if (target < bar) return { plates: [], loadedKg: bar, remainderKg: 0, belowBar: true };

  let perSide = (target - bar) / 2;
  const plates = [];
  for (const size of PLATE_SIZES_KG) {
    const count = Math.floor(perSide / size);
    if (count > 0) {
      plates.push({ size, count });
      perSide -= count * size;
    }
  }
  const loadedKg = target - perSide * 2;
  return { plates, loadedKg, remainderKg: target - loadedKg, belowBar: false };
}

// Unilateral: weight and reps describe one side, so both sides are counted.
export function calcSetVolume(set, unilateral = false) {
  if (!set || set.type === 'warmup' || set.durationSec) return 0; // timed sets have no reps volume
  const w = Number(set.weight) || 0;
  const r = Number(set.reps) || 0;
  return Math.round(w * r * (unilateral ? 2 : 1));
}

export function calcExerciseVolume(exEntry, onlyCompleted = false) {
  return (exEntry.sets || []).reduce((acc, s) => {
    if (onlyCompleted && !s.completed) return acc;
    return acc + calcSetVolume(s, exEntry.unilateral);
  }, 0);
}

export function calcDayVolume(exercises, onlyCompleted = false) {
  return (exercises || []).reduce((acc, ex) => acc + calcExerciseVolume(ex, onlyCompleted), 0);
}

export function estimateCalories(durationMin, bodyWeightKg = 80, volumeKg = 0) {
  const mins = Math.max(1, Number(durationMin) || 1);
  // Strength training MET ~5.0 + small bonus from volume density
  const baseKcal = (5.0 * bodyWeightKg * (mins / 60));
  const volBonus = Math.min(180, volumeKg * 0.015);
  return Math.round(baseKcal + volBonus);
}

export function summarizeExerciseSets(exEntry, unit = 'kg') {
  const sets = exEntry.sets || [];
  if (!sets.length) return '0 sets';
  const working = sets.filter((s) => s.type !== 'warmup');
  const ref = working[0] || sets[0];
  const wStr = ref.weight > 0 ? `${formatWeight(ref.weight, unit)} ${unit === 'lb' ? 'Lb' : 'Kg'}` : 'Peso Corporal';
  const effort = ref.durationSec ? formatRestBadge(ref.durationSec) : `${ref.reps} reps`;
  return `${sets.length} sets • ${effort} • ${wStr}`;
}

export function getPreviousExerciseLog(history, exerciseId) {
  for (let i = history.length - 1; i >= 0; i--) {
    const session = history[i];
    const found = (session.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (found && found.sets && found.sets.length) {
      return {
        date: session.completedAt,
        sets: found.sets
      };
    }
  }
  return null;
}

export function detectSessionPRs(history, sessionExercises) {
  // Compute best weight & best 1RM prior to this session
  const bestByEx = {};
  for (const sess of history) {
    for (const ex of sess.exercises || []) {
      for (const s of ex.sets || []) {
        if (s.type === 'warmup' || !s.completed) continue;
        const cur = bestByEx[ex.exerciseId] || { maxWeight: 0, max1RM: 0, maxDuration: 0 };
        if (s.durationSec) {
          if (s.durationSec > cur.maxDuration) cur.maxDuration = s.durationSec;
        } else {
          const w = Number(s.weight) || 0;
          const rm = estimate1RM(w, s.reps);
          if (w > cur.maxWeight) cur.maxWeight = w;
          if (rm > cur.max1RM) cur.max1RM = rm;
        }
        bestByEx[ex.exerciseId] = cur;
      }
    }
  }

  const prs = [];
  for (const ex of sessionExercises) {
    // The first log of an exercise is its baseline, not a record
    const prev = bestByEx[ex.exerciseId];
    if (!prev) continue;
    let sessionMaxW = 0;
    let sessionMax1RM = 0;
    let sessionMaxDuration = 0;
    for (const s of ex.sets || []) {
      if (s.type === 'warmup' || !s.completed) continue;
      if (s.durationSec) {
        if (s.durationSec > sessionMaxDuration) sessionMaxDuration = s.durationSec;
        continue;
      }
      const w = Number(s.weight) || 0;
      const rm = estimate1RM(w, s.reps);
      if (w > sessionMaxW) sessionMaxW = w;
      if (rm > sessionMax1RM) sessionMax1RM = rm;
    }
    const weightPR = sessionMaxW > 0 && (sessionMaxW > prev.maxWeight || sessionMax1RM > prev.max1RM);
    // A timed PR needs a previous timed log to beat
    const durationPR = prev.maxDuration > 0 && sessionMaxDuration > prev.maxDuration;
    if (weightPR || durationPR) {
      prs.push({
        exerciseId: ex.exerciseId,
        maxWeight: sessionMaxW,
        est1RM: sessionMax1RM,
        maxDurationSec: sessionMaxDuration,
        date: new Date().toISOString()
      });
    }
  }
  return prs;
}

export function getExerciseProgressSeries(history, exerciseId) {
  const points = [];
  for (const sess of history) {
    const ex = (sess.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const validSets = (ex.sets || []).filter((s) => s.type !== 'warmup' && (s.completed !== false));
    if (!validSets.length) continue;
    const maxWeight = Math.max(...validSets.map((s) => Number(s.weight) || 0));
    const max1RM = Math.max(...validSets.map((s) => (s.durationSec ? 0 : estimate1RM(s.weight, s.reps))));
    const maxDuration = Math.max(...validSets.map((s) => Number(s.durationSec) || 0));
    const volume = validSets.reduce((acc, s) => acc + calcSetVolume(s, ex.unilateral), 0);
    points.push({
      date: sess.completedAt,
      label: formatShortDate(sess.completedAt),
      maxWeight,
      max1RM,
      maxDuration,
      volume
    });
  }
  return points;
}

export function formatShortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
}

export function formatTimeRange(iso, durationMin = 45) {
  if (!iso) return 'Pronto para iniciar';
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return '';
  const start = new Date(end.getTime() - durationMin * 60000);
  const hhmm = (dt) => `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${formatShortDate(iso)} / ${hhmm(start)}-${hhmm(end)}`;
}

export function getCurrentWeekActivity(history, cardioLogs) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun..6=Sat
  const sunday = new Date(now);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(now.getDate() - dayOfWeek);

  const activeDays = new Set();
  const allDates = [
    ...(history || []).map((h) => h.completedAt),
    ...(cardioLogs || []).map((c) => c.date)
  ];

  for (const iso of allDates) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    activeDays.add(key);
  }

  const labels = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  return labels.map((label, idx) => {
    const dt = new Date(sunday);
    dt.setDate(sunday.getDate() + idx);
    const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    return {
      label,
      dayNum: dt.getDate(),
      done: activeDays.has(key),
      isToday: key === todayKey
    };
  });
}

export function formatSecondsClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatRestBadge(seconds) {
  const s = Number(seconds) || 90;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}
