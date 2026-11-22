let restInterval = null;
let restEndsAt = 0;
let workoutInterval = null;
let workoutStartedAt = null;
let audioCtx = null;
let wakeLock = null;
let wakeLockWanted = false;
let holdInterval = null;
let holdStartsAt = 0;

function playBeep(enabled = true) {
  if (!enabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    [880, 1174].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.16);
      gain.gain.setValueAtTime(0.18, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.14);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.15);
    });
  } catch {
    // Audio playback blocked before interaction
  }
}

function triggerVibration(enabled = true) {
  if (!enabled) return;
  if ('vibrate' in navigator) {
    navigator.vibrate([160, 80, 160]);
  }
}

// The rest timer counts toward a fixed deadline, so it stays correct when
// Android throttles or suspends setInterval in the background.
function secondsUntilRestEnd() {
  return Math.ceil((restEndsAt - Date.now()) / 1000);
}

export function startRestTimer(seconds, { onTick, onComplete, sound = true, vibrate = true }) {
  stopRestTimer();
  restEndsAt = Date.now() + Math.max(5, Math.round(seconds)) * 1000;
  onTick(secondsUntilRestEnd());

  restInterval = setInterval(() => {
    const remaining = secondsUntilRestEnd();
    if (remaining <= 0) {
      stopRestTimer();
      playBeep(sound);
      triggerVibration(vibrate);
      onComplete();
    } else {
      onTick(remaining);
    }
  }, 250);
}

export function adjustRestTimer(deltaSeconds, onTick) {
  if (!restInterval) return;
  const remaining = Math.max(5, secondsUntilRestEnd() + deltaSeconds);
  restEndsAt = Date.now() + remaining * 1000;
  onTick(remaining);
}

export function stopRestTimer() {
  if (restInterval) {
    clearInterval(restInterval);
    restInterval = null;
  }
  restEndsAt = 0;
}

// Isometric hold: short preparation countdown, then the timed effort.
export function startHoldTimer(seconds, { prepSeconds = 3, onTick, onComplete, sound = true, vibrate = true }) {
  stopHoldTimer();
  const startsAt = Date.now() + prepSeconds * 1000;
  const endsAt = startsAt + seconds * 1000;
  holdStartsAt = startsAt;
  let holdBegan = false;

  const tick = () => {
    const now = Date.now();
    if (now < startsAt) {
      onTick(Math.ceil((startsAt - now) / 1000), 'prep');
      return;
    }
    if (!holdBegan) {
      holdBegan = true;
      playBeep(sound);
    }
    const remaining = Math.ceil((endsAt - now) / 1000);
    if (remaining <= 0) {
      stopHoldTimer();
      playBeep(sound);
      triggerVibration(vibrate);
      onComplete(seconds);
    } else {
      onTick(remaining, 'hold');
    }
  };
  holdInterval = setInterval(tick, 200);
  tick();
}

// Returns the seconds held so far, or null when no hold is running.
export function stopHoldTimer() {
  if (!holdInterval) return null;
  clearInterval(holdInterval);
  holdInterval = null;
  return Math.max(0, Math.floor((Date.now() - holdStartsAt) / 1000));
}

// Screen Wake Lock: the browser releases the lock whenever the page is hidden,
// so it is requested again when the app returns to the foreground.
async function acquireWakeLock() {
  if (!wakeLockWanted || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!wakeLockWanted) {
      lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    // Denied (e.g. battery saver): the workout continues without the lock
  }
}

document.addEventListener('visibilitychange', acquireWakeLock);

export function setScreenWakeLock(wanted) {
  wakeLockWanted = Boolean(wanted);
  if (wakeLockWanted) {
    acquireWakeLock();
  } else if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

export function startWorkoutClock(startedAtMs, onTick) {
  stopWorkoutClock();
  workoutStartedAt = startedAtMs || Date.now();
  const update = () => {
    const elapsedSec = Math.floor((Date.now() - workoutStartedAt) / 1000);
    onTick(elapsedSec);
  };
  update();
  workoutInterval = setInterval(update, 1000);
}

export function stopWorkoutClock() {
  if (workoutInterval) {
    clearInterval(workoutInterval);
    workoutInterval = null;
  }
  workoutStartedAt = null;
}
