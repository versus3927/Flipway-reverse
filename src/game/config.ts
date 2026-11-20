// ── Константы мира ─────────────────────────────────────────────
export const LANE_GAP = 2.3;
export const LANES = [-LANE_GAP, 0, LANE_GAP];
/** Сдвиг улицы у замка относительно основной дороги */
export const CASTLE_SHIFT = -6.9;
export const CASTLE_LANES = LANES.map((x) => x + CASTLE_SHIFT);
export const TUNNEL_H = 14.0; // Огромное пространство между мирами
export const CHUNK = 30; // длина чанка
export const GEN_AHEAD = 275; // как далеко вперёд генерировать (всегда дальше тумана и camera.far)
export const PLAYER_H = 1.5;
export const CAM_LERP = 0.08; // скорость следования камеры

export function detectLowSpecDefault(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const saved = localStorage.getItem('gr_low');
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch { /* ignore */ }
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Capacitor|wv/i.test(navigator.userAgent || '');
  const cores = navigator.hardwareConcurrency ?? 4;
  return coarse || touch || mobileUA || cores <= 4;
}

export type LocId = 'metro' | 'canyon' | 'ice' | 'pugs' | 'castle' | 'sunny';
export type MoveMode = 'flip' | 'jump';

export interface LocCfg {
  id: LocId;
  name: string;
  sub: string;
  bg: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  ground2: number;
  ceiling: number;
  laneGlow: number;
  accent: number;
  accent2: number;
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  sunColor: number;
  sunInt: number;
  sunPos: [number, number, number];
  hasCeiling: boolean;
  musicRoot: number; // Hz
}

export const LOCS: Record<LocId, LocCfg> = {
  metro: {
    id: 'metro', name: 'СВЕТЛЫЙ ВОКЗАЛ', sub: 'Дневная станция — берегись поездов',
    bg: 0xa9c7e4, fog: 0xbcd6ea, fogNear: 55, fogFar: 225,
    ground: 0x9aa3b0, ground2: 0x7d8694, ceiling: 0xc6d6e6,
    laneGlow: 0x1f7fbf, accent: 0xe03b7d, accent2: 0x0f9ec4,
    hemiSky: 0xe8f2ff, hemiGround: 0x79808c, hemiInt: 0.85,
    sunColor: 0xfff4de, sunInt: 1.5, sunPos: [8, 18, 6],
    hasCeiling: true, musicRoot: 55,
  },
  canyon: {
    id: 'canyon', name: 'АЛЫЙ КАНЬОН', sub: 'Полдень, пыль и товарняки',
    bg: 0xefbe86, fog: 0xe8ae74, fogNear: 62, fogFar: 240,
    ground: 0xc08a52, ground2: 0xa06f3f, ceiling: 0x96603a,
    laneGlow: 0xffe1a0, accent: 0xe8420f, accent2: 0xf0a800,
    hemiSky: 0xffe6c4, hemiGround: 0x94663d, hemiInt: 0.85,
    sunColor: 0xfff6e4, sunInt: 1.7, sunPos: [-12, 22, 8],
    hasCeiling: true, musicRoot: 49,
  },
  ice: {
    id: 'ice', name: 'ЛЕДЯНОЙ ГРОТ', sub: 'Сверкающий лёд: сосульки сверху и снизу',
    bg: 0xafd8ec, fog: 0x9fcfe6, fogNear: 55, fogFar: 225,
    ground: 0xafd4e8, ground2: 0x8ab6d0, ceiling: 0xa2cde2,
    laneGlow: 0x0b86ad, accent: 0x009bb3, accent2: 0x6446c8,
    hemiSky: 0xeaf7ff, hemiGround: 0x92b5c8, hemiInt: 0.9,
    sunColor: 0xeaf7ff, sunInt: 1.6, sunPos: [10, 20, 4],
    hasCeiling: true, musicRoot: 58.27,
  },
  pugs: {
    id: 'pugs', name: 'МОПС-СТРИТ', sub: 'Солнечная улица, где правят мопсы',
    bg: 0xefc2da, fog: 0xebbcd5, fogNear: 55, fogFar: 220,
    ground: 0xc6a7c3, ground2: 0xa888a6, ceiling: 0xe5c3da,
    laneGlow: 0xc23a80, accent: 0xe08700, accent2: 0xd93d78,
    hemiSky: 0xfdeaf5, hemiGround: 0xb195ad, hemiInt: 0.88,
    sunColor: 0xfff0e0, sunInt: 1.55, sunPos: [8, 18, 6],
    hasCeiling: true, musicRoot: 65.41,
  },
  castle: {
    id: 'castle', name: 'ЗАМОК ДРАКОНОВ', sub: 'Открытое небо: тап = прыжок. Уворачивайся от огня!',
    bg: 0x6ea4e2, fog: 0x94b8e0, fogNear: 60, fogFar: 235,
    ground: 0x968d7b, ground2: 0x7a7362, ceiling: 0,
    laneGlow: 0xf0d48a, accent: 0xe8a000, accent2: 0x3d94e8,
    hemiSky: 0xc4dcf5, hemiGround: 0x5e5646, hemiInt: 0.85,
    sunColor: 0xfff0cc, sunInt: 1.65, sunPos: [-16, 24, 10],
    hasCeiling: false, musicRoot: 61.74,
  },
  sunny: {
    id: 'sunny', name: 'СОЛНЕЧНЫЙ ПАССАЖ', sub: 'Светлая улица под стеклянной крышей',
    bg: 0x9dd0f0, fog: 0xb8dff2, fogNear: 62, fogFar: 240,
    ground: 0xcec8b8, ground2: 0xb0a998, ceiling: 0xafd8ee,
    laneGlow: 0x1a9cd0, accent: 0xe85c28, accent2: 0x1595d4,
    hemiSky: 0xeaf6ff, hemiGround: 0xa39b88, hemiInt: 0.9,
    sunColor: 0xfff2dc, sunInt: 1.7, sunPos: [10, 22, 8],
    hasCeiling: true, musicRoot: 65.41,
  },
};

export const LOC_LIST: LocId[] = ['metro', 'canyon', 'ice', 'pugs', 'castle', 'sunny'];

export const css = (h: number) => '#' + h.toString(16).padStart(6, '0');

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const irand = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 4); // более плавное торможение
