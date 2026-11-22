const PRIMARY_COLOR = '#32ff00';
const SECONDARY_COLOR = 'rgba(50, 255, 0, 0.42)';
const BASE_COLOR = '#244147';
const OUTLINE_COLOR = '#385c64';

function getMuscleFill(target, primary, secondaries = []) {
  if (primary === target) return PRIMARY_COLOR;
  if (secondaries.includes(target)) return SECONDARY_COLOR;
  return BASE_COLOR;
}

export function renderAnatomyFrontSVG(primary, secondaries = [], size = 120) {
  const c = (m) => getMuscleFill(m, primary, secondaries);
  return `
  <svg viewBox="0 0 100 170" width="${size}" height="${Math.round(size * 1.45)}" xmlns="http://www.w3.org/2000/svg" aria-label="Mapa frontal">
    <!-- Head & Neck -->
    <circle cx="50" cy="15" r="9.5" fill="${BASE_COLOR}" stroke="${OUTLINE_COLOR}" stroke-width="1.2"/>
    <rect x="45.5" y="24" width="9" height="7" rx="3" fill="${BASE_COLOR}"/>
    <!-- Shoulders -->
    <ellipse cx="29" cy="40" rx="8.5" ry="7.5" fill="${c('Ombros')}"/>
    <ellipse cx="71" cy="40" rx="8.5" ry="7.5" fill="${c('Ombros')}"/>
    <!-- Chest -->
    <path d="M34 34 Q49 32 49 48 Q40 52 33 45 Z" fill="${c('Peito')}"/>
    <path d="M66 34 Q51 32 51 48 Q60 52 67 45 Z" fill="${c('Peito')}"/>
    <!-- Abs -->
    <rect x="41" y="51" width="18" height="28" rx="5" fill="${c('Abdômen')}"/>
    <!-- Biceps -->
    <rect x="19" y="47" width="8.5" height="22" rx="4" fill="${c('Bíceps')}"/>
    <rect x="72.5" y="47" width="8.5" height="22" rx="4" fill="${c('Bíceps')}"/>
    <!-- Forearms -->
    <rect x="16" y="71" width="7.5" height="23" rx="3.5" fill="${c('Antebraço')}"/>
    <rect x="76.5" y="71" width="7.5" height="23" rx="3.5" fill="${c('Antebraço')}"/>
    <!-- Pelvis -->
    <path d="M36 80 L64 80 L58 94 L42 94 Z" fill="${BASE_COLOR}"/>
    <!-- Quads -->
    <path d="M35 92 L48 94 L46 130 L34 128 Z" fill="${c('Quadríceps')}"/>
    <path d="M65 92 L52 94 L54 130 L66 128 Z" fill="${c('Quadríceps')}"/>
    <!-- Lower legs -->
    <path d="M35 133 L45 133 L43 162 L36 162 Z" fill="${c('Panturrilha')}"/>
    <path d="M55 133 L65 133 L64 162 L57 162 Z" fill="${c('Panturrilha')}"/>
  </svg>`;
}

export function renderAnatomyBackSVG(primary, secondaries = [], size = 120) {
  const c = (m) => getMuscleFill(m, primary, secondaries);
  return `
  <svg viewBox="0 0 100 170" width="${size}" height="${Math.round(size * 1.45)}" xmlns="http://www.w3.org/2000/svg" aria-label="Mapa posterior">
    <!-- Head -->
    <circle cx="50" cy="15" r="9.5" fill="${BASE_COLOR}" stroke="${OUTLINE_COLOR}" stroke-width="1.2"/>
    <!-- Rear Delts -->
    <ellipse cx="29" cy="40" rx="8.5" ry="7.5" fill="${c('Ombros')}"/>
    <ellipse cx="71" cy="40" rx="8.5" ry="7.5" fill="${c('Ombros')}"/>
    <!-- Upper & Mid Back (Lats / Traps) -->
    <path d="M34 32 L66 32 L62 63 L38 63 Z" fill="${c('Costas')}"/>
    <!-- Lower Back -->
    <rect x="40" y="64" width="20" height="14" rx="4" fill="${c('Lombar')}"/>
    <!-- Triceps -->
    <rect x="19" y="47" width="8.5" height="22" rx="4" fill="${c('Tríceps')}"/>
    <rect x="72.5" y="47" width="8.5" height="22" rx="4" fill="${c('Tríceps')}"/>
    <!-- Forearms -->
    <rect x="16" y="71" width="7.5" height="23" rx="3.5" fill="${c('Antebraço')}"/>
    <rect x="76.5" y="71" width="7.5" height="23" rx="3.5" fill="${c('Antebraço')}"/>
    <!-- Glutes -->
    <ellipse cx="42" cy="88" rx="9" ry="9" fill="${c('Glúteos')}"/>
    <ellipse cx="58" cy="88" rx="9" ry="9" fill="${c('Glúteos')}"/>
    <!-- Hamstrings -->
    <path d="M34 97 L48 97 L46 130 L35 129 Z" fill="${c('Posteriores')}"/>
    <path d="M52 97 L66 97 L65 129 L54 130 Z" fill="${c('Posteriores')}"/>
    <!-- Calves -->
    <ellipse cx="40" cy="147" rx="5.5" ry="13" fill="${c('Panturrilha')}"/>
    <ellipse cx="60" cy="147" rx="5.5" ry="13" fill="${c('Panturrilha')}"/>
  </svg>`;
}

export function renderEquipmentIconSVG(equipment) {
  const stroke = '#11262b';
  switch (equipment) {
    case 'Barra':
    case 'Smith':
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round">
        <line x1="6" y1="24" x2="42" y2="24"/>
        <rect x="9" y="13" width="5" height="22" rx="2" fill="#1d3c44"/>
        <rect x="34" y="13" width="5" height="22" rx="2" fill="#1d3c44"/>
        <rect x="4" y="17" width="4" height="14" rx="1.5" fill="#4f6c73"/>
        <rect x="40" y="17" width="4" height="14" rx="1.5" fill="#4f6c73"/>
      </svg>`;
    case 'Halteres':
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round">
        <g transform="rotate(-28 24 24)">
          <line x1="12" y1="24" x2="36" y2="24" stroke-width="3.5"/>
          <rect x="8" y="15" width="7" height="18" rx="2.5" fill="#1d3c44"/>
          <rect x="33" y="15" width="7" height="18" rx="2.5" fill="#1d3c44"/>
        </g>
      </svg>`;
    case 'Kettlebell':
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="2.8">
        <path d="M17 19V14a7 7 0 0 1 14 0v5" stroke-width="3.2"/>
        <circle cx="24" cy="30" r="12" fill="#1d3c44"/>
        <circle cx="24" cy="30" r="4" fill="#edf3f4" stroke="none"/>
      </svg>`;
    case 'Polia':
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round">
        <rect x="10" y="6" width="28" height="4" rx="2" fill="#1d3c44"/>
        <circle cx="24" cy="14" r="4" fill="#edf3f4"/>
        <line x1="24" y1="18" x2="24" y2="33"/>
        <path d="M16 33h16" stroke-width="3.6"/>
        <line x1="12" y1="10" x2="12" y2="42" stroke-opacity="0.4"/>
        <line x1="36" y1="10" x2="36" y2="42" stroke-opacity="0.4"/>
      </svg>`;
    case 'Máquina':
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="10" y="9" width="12" height="30" rx="2" fill="#2c5058"/>
        <line x1="10" y1="17" x2="22" y2="17" stroke="#edf3f4"/>
        <line x1="10" y1="24" x2="22" y2="24" stroke="#edf3f4"/>
        <line x1="10" y1="31" x2="22" y2="31" stroke="#edf3f4"/>
        <path d="M22 14h12v14h-6"/>
        <path d="M26 39h13"/>
        <path d="M31 28v11"/>
      </svg>`;
    case 'Elástico':
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="#1d3c44" stroke-width="3.5">
        <ellipse cx="24" cy="24" rx="15" ry="9" transform="rotate(-25 24 24)"/>
      </svg>`;
    default:
      return `<svg class="thumb-equip-svg" viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="2.8" stroke-linecap="round">
        <circle cx="24" cy="11" r="4.5" fill="#1d3c44"/>
        <path d="M14 21h20M24 16v13M24 29l-7 11M24 29l7 11"/>
      </svg>`;
  }
}

export function renderExerciseThumb(exercise) {
  const showBack = ['Costas', 'Tríceps', 'Glúteos', 'Posteriores', 'Lombar', 'Panturrilha'].includes(exercise.muscle);
  const miniSvg = showBack
    ? renderAnatomyBackSVG(exercise.muscle, exercise.secondaryMuscles, 24)
    : renderAnatomyFrontSVG(exercise.muscle, exercise.secondaryMuscles, 24);
  return `
    <div class="exercise-thumb">
      ${renderEquipmentIconSVG(exercise.equipment)}
      <div class="thumb-muscle-mini">${miniSvg}</div>
    </div>
  `;
}
