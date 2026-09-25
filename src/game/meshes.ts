import * as THREE from 'three';
import { TUNNEL_H, LOCS, LocId, rand, pick } from './config';
import { glowTex, hazardTex, windowsTex, stripesTex, signTex } from './textures';

// ── Кэш геометрий ──────────────────────────────────────────────
const geos = new Map<string, THREE.BufferGeometry>();
export function boxGeo(w: number, h: number, d: number) {
  const k = `b${w}|${h}|${d}`;
  let g = geos.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); geos.set(k, g); } return g;
}
export function cylGeo(rt: number, rb: number, h: number, s = 10) {
  const k = `c${rt}|${rb}|${h}|${s}`;
  let g = geos.get(k); if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, s); geos.set(k, g); } return g;
}
export function coneGeo(r: number, h: number, s = 8) {
  const k = `k${r}|${h}|${s}`;
  let g = geos.get(k); if (!g) { g = new THREE.ConeGeometry(r, h, s); geos.set(k, g); } return g;
}
export function sphGeo(r: number, w = 10, h = 8) {
  const k = `s${r}|${w}|${h}`;
  let g = geos.get(k); if (!g) { g = new THREE.SphereGeometry(r, w, h); geos.set(k, g); } return g;
}
export function icoGeo(r: number, d = 0) {
  const k = `i${r}|${d}`;
  let g = geos.get(k); if (!g) { g = new THREE.IcosahedronGeometry(r, d); geos.set(k, g); } return g;
}
export function octGeo(r: number) {
  const k = `o${r}`;
  let g = geos.get(k); if (!g) { g = new THREE.OctahedronGeometry(r); geos.set(k, g); } return g;
}
export function torGeo(r: number, t: number) {
  const k = `t${r}|${t}`;
  let g = geos.get(k); if (!g) { g = new THREE.TorusGeometry(r, t, 6, 16); geos.set(k, g); } return g;
}
let vaseGeoCache: THREE.BufferGeometry | null = null;
export function vaseGeo() {
  if (vaseGeoCache) return vaseGeoCache;
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [[0.02, 0], [0.2, 0.02], [0.3, 0.14], [0.24, 0.45], [0.15, 0.66], [0.26, 0.82], [0.24, 0.94], [0.16, 1.0]];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  vaseGeoCache = new THREE.LatheGeometry(pts, 10);
  return vaseGeoCache;
}
export function planeGeo(w: number, h: number) {
  const k = `p${w}|${h}`;
  let g = geos.get(k); if (!g) { g = new THREE.PlaneGeometry(w, h); geos.set(k, g); } return g;
}

// ── Кэш материалов ─────────────────────────────────────────────
const mats = new Map<string, THREE.Material>();
export function std(color: number, e = 0, ei = 0, rough = 0.9, metal = 0.02, flat = true): THREE.MeshStandardMaterial {
  const k = `st${color}|${e}|${ei}|${rough}|${metal}|${flat}`;
  let m = mats.get(k) as THREE.MeshStandardMaterial;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, emissive: e, emissiveIntensity: ei, roughness: rough, metalness: metal, flatShading: flat,
    });
    mats.set(k, m);
  }
  return m;
}
export function lam(color: number): THREE.MeshBasicMaterial {
  const k = `la${color}`;
  let m = mats.get(k) as THREE.MeshBasicMaterial;
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); mats.set(k, m); }
  return m;
}

export function M(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  return mesh;
}

export function sprite(color: number, scale: number, opacity = 0.85) {
  const sm = new THREE.SpriteMaterial({
    map: glowTex(), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const s = new THREE.Sprite(sm);
  s.scale.setScalar(scale);
  return s;
}

// ── ТРАНСПОРТ ─────────────────────────────────────────────────
export interface TrainScheme { body: number; roof: number; stripe: number; win: number; kind?: string; }

/** Ледяные санки / бобслей */
export function makeSlede(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.25, 0.55); // металлический блеск
  // корпус — обтекаемый
  const hull = M(boxGeo(2.0, 1.35, len), bodyMat, 0, 0.85, 0);
  hull.scale.set(1, 1, 1);
  g.add(hull);
  // нос — скошен
  g.add(M(boxGeo(2.0, 1.35, 1.4), bodyMat, 0, 1.02, len / 2 + 0.5));
  // полозья — два рельса из металла под корпусом
  const runnerMat = std(0xccd8e0, 0, 0, 0.15, 0.85);
  g.add(M(boxGeo(0.18, 0.12, len + 1.4), runnerMat, -0.72, 0.16, 0));
  g.add(M(boxGeo(0.18, 0.12, len + 1.4), runnerMat, 0.72, 0.16, 0));
  // ледяной бортик — голубое стекло
  const iceMat = new THREE.MeshStandardMaterial({ color: s.stripe, emissive: s.stripe, emissiveIntensity: 0.22, roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.82 });
  g.add(M(boxGeo(2.1, 0.28, len * 0.94), iceMat, 0, 1.54, 0));
  // крыша плоская (для прыжков)
  g.add(M(boxGeo(1.9, 0.18, len * 0.96), std(s.roof, 0, 0, 0.35, 0.5), 0, 1.6, 0));
  // ледяные кристаллы-декор сверху
  for (let i = 0; i < Math.floor(len / 5); i++) {
    const c = M(new THREE.ConeGeometry(0.12, 0.35, 5), std(0xa8deff, 0x00e5ff, 0.35, 0.3, 0.1), rand(-0.5, 0.5), 1.76, -len / 2 + 2 + i * 5);
    g.add(c);
  }
  // передняя часть — рог
  g.add(M(boxGeo(2.05, 1.35, 0.9), bodyMat, 0, 0.85, len / 2 + 0.7));
  g.add(M(boxGeo(0.36, 0.36, 0.36), runnerMat, 0, 0.85, len / 2 + 1.18));
  // фары — синие
  const fl1 = sprite(0x00e5ff, 1.2, 0.9); fl1.position.set(-0.52, 0.85, len / 2 + 1.2); g.add(fl1);
  const fl2 = sprite(0x00e5ff, 1.2, 0.9); fl2.position.set(0.52, 0.85, len / 2 + 1.2); g.add(fl2);
  return g;
}

/** Фургон (солнечная локация) */
export function makeVan(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.65, 0.15);
  // кузов
  g.add(M(boxGeo(2.3, 2.1, len), bodyMat, 0, 1.45, 0));
  // крыша — слегка скруглённый гребень
  g.add(M(boxGeo(2.2, 0.22, len * 0.97), std(s.roof, 0, 0, 0.7), 0, 2.58, 0));
  // яркая полоска
  g.add(M(boxGeo(2.32, 0.18, len * 0.94), lam(s.stripe), 0, 2.0, 0));
  // колёса-блоки по бокам
  for (let i = 0; i < Math.floor(len / 4); i++) {
    const z = -len / 2 + 2 + i * 4;
    const wm = std(0x3a3f48, 0, 0, 0.9, 0.4);
    g.add(M(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12), wm, -1.26, 0.46, z));
    g.add(M(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12), wm, 1.26, 0.46, z));
    // ободы
    g.add(M(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8), std(0xd0d8e0, 0, 0, 0.25, 0.8), -1.26, 0.46, z));
    g.add(M(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8), std(0xd0d8e0, 0, 0, 0.25, 0.8), 1.26, 0.46, z));
  }
  // окна боковые
  const winMat = new THREE.MeshStandardMaterial({ color: 0x7ecbf0, emissive: s.win, emissiveIntensity: 0.2, roughness: 0.15, metalness: 0.2 });
  const wl = M(planeGeo(len * 0.7, 0.9), winMat, -1.17, 1.7, 0); wl.rotation.y = -Math.PI / 2; g.add(wl);
  const wr = M(planeGeo(len * 0.7, 0.9), winMat, 1.17, 1.7, 0); wr.rotation.y = Math.PI / 2; g.add(wr);
  // кабина
  g.add(M(boxGeo(2.32, 2.1, 2.0), bodyMat, 0, 1.45, len / 2 + 0.9));
  g.add(M(boxGeo(1.9, 1.0, 0.16), winMat, 0, 2.0, len / 2 + 1.86));
  const hf1 = sprite(0xffe8a0, 1.4, 0.9); hf1.position.set(-0.6, 0.8, len / 2 + 2.0); g.add(hf1);
  const hf2 = sprite(0xffe8a0, 1.4, 0.9); hf2.position.set(0.6, 0.8, len / 2 + 2.0); g.add(hf2);
  return g;
}

/** Огненная колесница / бронедракон (замок) */
export function makeChariot(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const stoneM = std(s.body, 0, 0, 0.9);
  const goldM = std(0xd9a520, 0xffc93c, 0.15, 0.4, 0.6);
  // каменный корпус
  g.add(M(boxGeo(2.3, 2.2, len), stoneM, 0, 1.4, 0));
  // зубцы наверху
  for (let i = 0; i < Math.ceil(len / 3); i++) {
    g.add(M(boxGeo(0.6, 0.55, 0.55), std(s.roof, 0, 0, 0.9), -0.75, 2.78, -len / 2 + 1.5 + i * 3));
    g.add(M(boxGeo(0.6, 0.55, 0.55), std(s.roof, 0, 0, 0.9), 0.75, 2.78, -len / 2 + 1.5 + i * 3));
  }
  // крыша (для запрыгивания)
  g.add(M(boxGeo(2.1, 0.2, len * 0.97), goldM, 0, 2.62, 0));
  // золотая полоса
  g.add(M(boxGeo(2.32, 0.18, len * 0.92), goldM, 0, 2.1, 0));
  // колёса-бочки огромные
  for (const z of [-len / 2 + 2, len / 2 - 2]) {
    const wm = std(0x4a2c08, 0, 0, 0.9, 0.15);
    const rim = std(0xd9a520, 0xffc93c, 0.1, 0.4, 0.7);
    g.add(M(new THREE.CylinderGeometry(0.7, 0.72, 0.38, 12), wm, -1.28, 0.7, z));
    g.add(M(new THREE.CylinderGeometry(0.7, 0.72, 0.38, 12), wm, 1.28, 0.7, z));
    g.add(M(new THREE.CylinderGeometry(0.42, 0.42, 0.42, 8), rim, -1.28, 0.7, z));
    g.add(M(new THREE.CylinderGeometry(0.42, 0.42, 0.42, 8), rim, 1.28, 0.7, z));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(M(boxGeo(0.08, 0.7, 0.08), rim, -1.28 + Math.cos(a) * 0.32, 0.7 + Math.sin(a) * 0.32, z));
    }
  }
  // пасть дракона спереди
  const head = new THREE.Group();
  head.position.set(0, 1.55, len / 2 + 1.2);
  head.add(M(boxGeo(1.6, 1.0, 1.4), stoneM, 0, 0, 0));
  head.add(M(boxGeo(1.7, 0.35, 1.2), std(s.roof, 0, 0, 0.85), 0, -0.42, 0.08));
  head.add(M(boxGeo(0.42, 0.26, 0.1), std(0xffe14d, 0xffe14d, 0.4, 0.5), -0.4, 0.2, -0.72));
  head.add(M(boxGeo(0.42, 0.26, 0.1), std(0xffe14d, 0xffe14d, 0.4, 0.5), 0.4, 0.2, -0.72));
  const fire = sprite(0xff6b00, 2.2, 0.9); fire.position.set(0, 0, -0.9); head.add(fire);
  g.add(head);
  return g;
}

/** Мопс-мобиль (телега с мопсами) */
export function makePugCart(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.75);
  // корпус украшен
  g.add(M(boxGeo(2.2, 2.0, len), bodyMat, 0, 1.35, 0));
  // крыша плоская
  g.add(M(boxGeo(2.1, 0.2, len * 0.96), std(s.roof, 0, 0, 0.7), 0, 2.47, 0));
  // флажки
  const cols = [0xff6b9d, 0xffd166, 0x8be9fd];
  for (let i = 0; i < Math.floor(len / 3.5); i++) {
    const c = M(new THREE.ConeGeometry(0.2, 0.45, 4), std(cols[i % 3], cols[i % 3], 0.18, 0.9), rand(-0.6, 0.6), 2.74, -len / 2 + 1.5 + i * 3.5);
    c.rotation.x = Math.PI;
    g.add(c);
  }
  // лента
  g.add(M(boxGeo(2.24, 0.16, len * 0.92), lam(s.stripe), 0, 1.8, 0));
  // иллюминаторы-окна — круглые
  for (let i = 0; i < Math.floor(len / 4); i++) {
    const z = -len / 2 + 2 + i * 4;
    const wm = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, emissive: s.win, emissiveIntensity: 0.2, roughness: 0.15 });
    const pw1 = M(new THREE.CircleGeometry(0.35, 12), wm, -1.12, 1.5, z); pw1.rotation.y = -Math.PI / 2; g.add(pw1);
    const pw2 = M(new THREE.CircleGeometry(0.35, 12), wm, 1.12, 1.5, z); pw2.rotation.y = Math.PI / 2; g.add(pw2);
  }
  // морда
  g.add(M(boxGeo(2.24, 2.0, 1.2), bodyMat, 0, 1.35, len / 2 + 0.5));
  g.add(M(boxGeo(1.1, 0.7, 0.14), std(0x3a2c22, 0, 0, 0.9), 0, 1.35, len / 2 + 1.14));
  const fl1 = sprite(0xffd166, 1.3, 0.9); fl1.position.set(-0.55, 0.85, len / 2 + 1.2); g.add(fl1);
  const fl2 = sprite(0xffd166, 1.3, 0.9); fl2.position.set(0.55, 0.85, len / 2 + 1.2); g.add(fl2);
  return g;
}

/** Горный вагон (каньон) */
export function makeMineCart(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const wood = std(s.body, 0, 0, 0.9);
  const metal = std(s.roof, 0, 0, 0.5, 0.45);
  // корпус-ящик деревянный
  g.add(M(boxGeo(2.1, 2.3, len), wood, 0, 1.35, 0));
  // железные полосы поперёк
  for (let i = 0; i < Math.ceil(len / 3.5); i++) {
    g.add(M(boxGeo(2.16, 0.16, 0.2), metal, 0, 1.2 + i * 0.6, -len / 2 + 0.8 + i * 3.5));
  }
  // крыша — брёвна
  g.add(M(boxGeo(2.05, 0.25, len * 0.96), wood, 0, 2.58, 0));
  for (let i = 0; i < Math.floor(len / 2.5); i++) {
    g.add(M(boxGeo(2.1, 0.18, 0.18), metal, 0, 2.73, -len / 2 + 1 + i * 2.5));
  }
  // большие стальные колёса
  for (const z of [-len / 2 + 2, len / 2 - 2]) {
    const wm = std(0x4a3a28, 0, 0, 0.9);
    const rim = std(0x8a7460, 0, 0, 0.6, 0.35);
    g.add(M(new THREE.CylinderGeometry(0.52, 0.54, 0.3, 10), wm, -1.18, 0.56, z));
    g.add(M(new THREE.CylinderGeometry(0.52, 0.54, 0.3, 10), wm, 1.18, 0.56, z));
    g.add(M(new THREE.CylinderGeometry(0.28, 0.28, 0.36, 8), rim, -1.18, 0.56, z));
    g.add(M(new THREE.CylinderGeometry(0.28, 0.28, 0.36, 8), rim, 1.18, 0.56, z));
  }
  // полоса акцентная
  g.add(M(boxGeo(2.16, 0.16, len * 0.9), lam(s.stripe), 0, 2.42, 0));
  // фонарь спереди
  const fl = sprite(0xffe8a0, 1.4, 0.85); fl.position.set(0, 1.5, len / 2 + 0.8); g.add(fl);
  g.add(M(boxGeo(2.12, 2.3, 0.9), wood, 0, 1.35, len / 2 + 0.4));
  return g;
}

export function makeTrain(len: number, s: TrainScheme): THREE.Group {
  if (s.kind === 'slede') return makeSlede(len, s);
  if (s.kind === 'van') return makeVan(len, s);
  if (s.kind === 'chariot') return makeChariot(len, s);
  if (s.kind === 'pugcart') return makePugCart(len, s);
  if (s.kind === 'minecart') return makeMineCart(len, s);
  return makeTrainDefault(len, s);
}

export function makeTrainDefault(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.55, 0.2);
  g.add(M(boxGeo(2.1, 2.5, len), bodyMat, 0, 1.45, 0));
  // плоская крыша — по ней можно бежать
  g.add(M(boxGeo(2.0, 0.3, len * 0.97), std(s.roof, 0, 0, 0.7, 0.2), 0, 2.8, 0));
  // бортики крыши
  g.add(M(boxGeo(0.1, 0.16, len * 0.97), std(s.stripe, s.stripe, 0.12, 0.6), -0.98, 3.0, 0));
  g.add(M(boxGeo(0.1, 0.16, len * 0.97), std(s.stripe, s.stripe, 0.12, 0.6), 0.98, 3.0, 0));
  // вентиляция на крыше
  for (let i = 0; i < Math.floor(len / 5); i++) {
    g.add(M(boxGeo(0.7, 0.14, 0.7), std(0xb9c2cc, 0, 0, 0.6, 0.35), 0, 3.02, -len / 2 + 3 + i * 5));
  }
  g.add(M(boxGeo(2.02, 0.62, len * 0.94), std(0x4a5260, 0, 0, 0.8), 0, 0.42, 0));
  // светящаяся полоса
  g.add(M(boxGeo(2.14, 0.2, len * 0.9), lam(s.stripe), 0, 2.35, 0));
  // окна — эмиссивная текстура
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4dd, emissive: s.win, emissiveIntensity: 0.32,
    emissiveMap: windowsTex('#8fb8d4', '#ffffff', Math.max(3, Math.floor(len / 3)), 1),
    roughness: 0.25, metalness: 0.1,
  });
  winMat.emissiveMap!.repeat.set(1, 1);
  const wl = M(planeGeo(len * 0.86, 0.62), winMat, -1.06, 1.85, 0); wl.rotation.y = -Math.PI / 2;
  const wr = M(planeGeo(len * 0.86, 0.62), winMat, 1.06, 1.85, 0); wr.rotation.y = Math.PI / 2;
  g.add(wl, wr);
  // морда (смотрит на игрока, т.е. +z)
  g.add(M(boxGeo(2.05, 2.3, 1.1), bodyMat, 0, 1.4, len / 2 + 0.5));
  g.add(M(boxGeo(1.7, 0.7, 0.12), new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x9fd8ff, emissiveIntensity: 0.8, roughness: 0.3 }), 0, 2.2, len / 2 + 1.06));
  const h1 = sprite(0xfff2c0, 1.5, 0.95); h1.position.set(-0.62, 1.0, len / 2 + 1.1);
  const h2 = sprite(0xfff2c0, 1.5, 0.95); h2.position.set(0.62, 1.0, len / 2 + 1.1);
  g.add(h1, h2);
  const red = M(boxGeo(0.18, 0.18, 0.06), lam(0xff3040), 0, 1.0, len / 2 + 1.08);
  g.add(red);
  return g;
}

// ── Препятствия: ПОЛ (низкие, обходятся сальтом/прыжком) ─────
export function makeFloorObstacle(loc: LocId): THREE.Group {
  const g = new THREE.Group();
  if (loc === 'metro') {
    const haz = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.7 });
    g.add(M(boxGeo(1.9, 0.3, 0.2), haz, 0, 0.98, 0));
    g.add(M(boxGeo(0.16, 1.0, 0.16), std(0x9aa4b2, 0, 0, 0.6, 0.3), -0.78, 0.5, 0));
    g.add(M(boxGeo(0.16, 1.0, 0.16), std(0x9aa4b2, 0, 0, 0.6, 0.3), 0.78, 0.5, 0));
    g.add(M(boxGeo(2.0, 0.08, 0.26), std(0xef4e8c, 0xef4e8c, 0.15, 0.7), 0, 1.18, 0));
  } else if (loc === 'canyon') {
    const rock = std(0x8a4f2c, 0, 0, 1, 0, true);
    const b1 = M(icoGeo(0.7), rock, 0, 0.55, 0); b1.scale.set(1.5, 0.95, 0.9); b1.rotation.set(0.4, 0.7, 0.2);
    const b2 = M(icoGeo(0.45), std(0x9d5c33, 0, 0, 1), -0.55, 0.35, 0.25); b2.rotation.set(1, 0.3, 0.5);
    const b3 = M(icoGeo(0.4), std(0x74401f, 0, 0, 1), 0.6, 0.3, -0.2); b3.rotation.set(0.2, 1.2, 0.9);
    g.add(b1, b2, b3);
  } else if (loc === 'ice') {
    const ice = std(0xbfeaff, 0x66d9ff, 0.35, 0.25, 0.05, true);
    const c1 = M(coneGeo(0.34, 1.35, 6), ice, -0.42, 0.67, 0.1);
    const c2 = M(coneGeo(0.28, 1.1, 6), ice, 0.3, 0.55, -0.15);
    const c3 = M(coneGeo(0.22, 0.9, 6), ice, 0.62, 0.45, 0.3);
    const c4 = M(coneGeo(0.3, 1.28, 6), ice, 0, 0.64, 0.32);
    g.add(c1, c2, c3, c4, M(boxGeo(1.9, 0.16, 1.0), std(0x9fd3e8, 0, 0, 0.4), 0, 0.08, 0));
  } else if (loc === 'pugs') {
    // Валяющиеся мопсы на коврике
    g.add(M(boxGeo(1.9, 0.08, 1.15), std(0xd94f8a, 0xff6b9d, 0.25, 0.9), 0, 0.04, 0));
    const p1 = makePug(); p1.scale.setScalar(0.85); p1.position.set(-0.42, 0.06, 0); p1.rotation.z = Math.PI / 2 * 0.9; p1.rotation.y = 0.5;
    const p2 = makePug(); p2.scale.setScalar(0.75); p2.position.set(0.48, 0.06, 0.1); p2.rotation.z = -Math.PI / 2 * 0.85; p2.rotation.y = -0.8;
    g.add(p1, p2);
  } else {
    // sunny — уличное кафе / клумба
    if (Math.random() < 0.5) {
      g.add(M(cylGeo(0.62, 0.7, 0.55, 10), std(0xe6ddc9, 0, 0, 0.9), 0, 0.28, 0));
      g.add(M(sphGeo(0.42, 8, 6), std(0x4f9440, 0, 0, 0.95), 0, 0.72, 0));
      g.add(M(sphGeo(0.1, 6, 5), std(0xff6f91, 0xff6f91, 0.2, 0.9), 0.24, 0.85, 0.1));
      g.add(M(sphGeo(0.09, 6, 5), std(0xffd166, 0xffd166, 0.2, 0.9), -0.22, 0.8, -0.1));
      g.add(M(cylGeo(0.55, 0.62, 0.5, 10), std(0xe6ddc9, 0, 0, 0.9), 0.95, 0.25, 0.1));
      g.add(M(sphGeo(0.36, 8, 6), std(0x3fa14a, 0, 0, 0.95), 0.95, 0.62, 0.1));
      g.add(M(cylGeo(0.5, 0.56, 0.45, 10), std(0xe6ddc9, 0, 0, 0.9), -0.92, 0.22, -0.05));
      g.add(M(sphGeo(0.33, 8, 6), std(0x3fa14a, 0, 0, 0.95), -0.92, 0.56, -0.05));
    } else {
      g.add(M(cylGeo(0.06, 0.07, 0.75, 8), std(0x3a4453, 0, 0, 0.6, 0.4), 0, 0.37, 0));
      g.add(M(cylGeo(0.55, 0.55, 0.07, 14), std(0xf6f2e8, 0, 0, 0.7), 0, 0.76, 0));
      g.add(M(cylGeo(0.35, 0.3, 0.06, 12), std(0x3a4453), 0, 0.04, 0));
      for (const sx of [-0.85, 0.85]) {
        g.add(M(boxGeo(0.42, 0.07, 0.42), std(0xff7043, 0, 0, 0.85), sx, 0.44, 0));
        g.add(M(boxGeo(0.4, 0.5, 0.07), std(0xff7043, 0, 0, 0.85), sx, 0.7, -0.18));
        for (const sz of [-0.15, 0.15]) {
          g.add(M(cylGeo(0.03, 0.03, 0.44, 5), std(0x3a4453), sx - 0.15, 0.22, sz));
          g.add(M(cylGeo(0.03, 0.03, 0.44, 5), std(0x3a4453), sx + 0.15, 0.22, sz));
        }
      }
    }
  }
  return g;
}

// ── Препятствия: ПОТОЛОК ───────────────────────────────────────
export function makeCeilObstacle(loc: LocId): THREE.Group {
  const g = new THREE.Group();
  const H = TUNNEL_H;
  if (loc === 'metro') {
    g.add(M(boxGeo(0.08, 1.0, 0.08), std(0xb6bec9), 0, H - 0.5, 0));
    g.add(M(boxGeo(1.75, 0.85, 1.35), std(0xdfe5ec, 0, 0, 0.6, 0.2), 0, H - 1.35, 0));
    g.add(M(boxGeo(1.79, 0.14, 1.39), std(0xef4e8c, 0xef4e8c, 0.18, 0.7), 0, H - 0.95, 0));
    g.add(M(boxGeo(1.6, 0.1, 1.2), std(0xfff6e0, 0xfff6e0, 0.5, 0.4), 0, H - 1.8, 0));
  } else if (loc === 'canyon') {
    const rock = std(0x7a4526, 0, 0, 1);
    const c1 = M(coneGeo(0.5, 1.9, 6), rock, -0.5, H - 0.95, 0); c1.rotation.x = Math.PI;
    const c2 = M(coneGeo(0.42, 1.5, 6), rock, 0.35, H - 0.75, 0.2); c2.rotation.x = Math.PI;
    const c3 = M(coneGeo(0.36, 1.7, 6), rock, 0.7, H - 0.85, -0.3); c3.rotation.x = Math.PI;
    g.add(c1, c2, c3);
  } else if (loc === 'ice') {
    const ice = std(0xa8dcff, 0x66d9ff, 0.5, 0.3);
    const c1 = M(coneGeo(0.4, 1.9, 6), ice, -0.42, H - 0.95, 0); c1.rotation.x = Math.PI;
    const c2 = M(coneGeo(0.32, 1.5, 6), ice, 0.3, H - 0.75, 0.15); c2.rotation.x = Math.PI;
    const c3 = M(coneGeo(0.26, 1.25, 6), ice, 0.66, H - 0.62, -0.25); c3.rotation.x = Math.PI;
    g.add(c1, c2, c3);
  } else if (loc === 'sunny') {
    // подвесные кашпо с цветами
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.66;
      g.add(M(cylGeo(0.015, 0.015, 0.95, 4), std(0x8d94a0), x, H - 0.48, 0));
      g.add(M(cylGeo(0.3, 0.22, 0.34, 10), std(0xdfa06a, 0, 0, 0.9), x, H - 1.12, 0));
      g.add(M(sphGeo(0.32, 8, 6), std(0x4f9440, 0, 0, 0.95), x, H - 1.42, 0));
      g.add(M(sphGeo(0.11, 6, 5), std(0xff6f91, 0xff6f91, 0.2, 0.9), x + 0.16, H - 1.55, 0.1));
      g.add(M(sphGeo(0.1, 6, 5), std(0xffd166, 0xffd166, 0.2, 0.9), x - 0.14, H - 1.6, -0.08));
      g.add(M(sphGeo(0.09, 6, 5), std(0xffffff, 0xffffff, 0.15, 0.9), x, H - 1.68, 0.12));
    }
    g.add(M(boxGeo(2.1, 0.1, 0.12), std(0xf5f7fa, 0, 0, 0.6, 0.3), 0, H - 0.06, 0));
  } else if (loc === 'pugs') {
    // Шарики с мордами мопсов:)
    const cols = [0xffd166, 0xff6b9d, 0x8be9fd];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.62;
      g.add(M(cylGeo(0.015, 0.015, 1.1, 4), lam(0x555), x, H - 0.55, 0));
      const b = M(sphGeo(0.34, 10, 8), std(cols[i], cols[i], 0.25, 0.6, 0, false), x, H - 1.42, 0);
      g.add(b);
      g.add(M(boxGeo(0.2, 0.1, 0.08), std(0x3a2c22), x, H - 1.45, -0.3));
      g.add(M(boxGeo(0.1, 0.06, 0.05), std(0x1d1611), x - 0.07, H - 1.34, -0.31));
      g.add(M(boxGeo(0.1, 0.06, 0.05), std(0x1d1611), x + 0.07, H - 1.34, -0.31));
    }
  }
  return g;
}

/** БАРЬЕР ДЛЯ КУВЫРКА — проезжаем под ним (низ на 1.3, верх до потолка-ниши) */
export function makeRollBar(loc: LocId, onCeiling = false): THREE.Group {
  const g = new THREE.Group();
  const cfg = LOCS[loc];
  const s = onCeiling ? -1 : 1;
  const base = onCeiling ? TUNNEL_H : 0;
  const hazMap = hazardTex().clone();
  hazMap.repeat.set(3, 1);
  hazMap.needsUpdate = true;
  const haz = new THREE.MeshStandardMaterial({ map: hazMap, roughness: 0.65, emissive: 0xf7c948, emissiveIntensity: 0.22 });
  // основная балка
  g.add(M(boxGeo(2.1, 0.5, 0.36), haz, 0, base + s * 1.62, 0));
  g.add(M(boxGeo(2.1, 0.34, 0.3), std(0x1c2230, 0, 0, 0.6, 0.35), 0, base + s * 2.15, 0));
  g.add(M(boxGeo(2.14, 0.1, 0.4), lam(cfg.accent2), 0, base + s * 1.35, 0));
  // «шторки» сверху до потолка, чтобы нельзя было перепрыгнуть
  for (let i = 0; i < 4; i++) {
    g.add(M(boxGeo(0.12, 1.9, 0.12), std(0x2a3346, 0, 0, 0.7, 0.3), -0.8 + i * 0.53, base + s * 3.3, 0));
  }
  g.add(M(boxGeo(2.15, 0.26, 0.3), std(0x1c2230, 0, 0, 0.6, 0.35), 0, base + s * 4.35, 0));
  // стойки
  g.add(M(boxGeo(0.16, 1.4, 0.3), std(0x333c4f), -1.02, base + s * 0.7, 0));
  g.add(M(boxGeo(0.16, 1.4, 0.3), std(0x333c4f), 1.02, base + s * 0.7, 0));
  // знак «пригнись»
  const sp = sprite(0xf7c948, 1.8, 0.5);
  sp.position.set(0, base + s * 1.62, 0.3);
  g.add(sp);
  const ph = Math.random() * 4;
  g.userData.tick = (t: number) => {
    (sp.material as THREE.SpriteMaterial).opacity = 0.3 + Math.abs(Math.sin(t * 4 + ph)) * 0.5;
  };
  return g;
}

/** Полноростовой блок — только смена дорожки */
export function makeBlock(loc: LocId): THREE.Group {
  const g = new THREE.Group();
  const cfg = LOCS[loc];
  const hazMap = hazardTex().clone();
  hazMap.repeat.set(1, 3);
  hazMap.needsUpdate = true;
  const haz = new THREE.MeshStandardMaterial({ map: hazMap, roughness: 0.75, emissive: cfg.accent, emissiveIntensity: 0.1 });
  g.add(M(boxGeo(2.0, TUNNEL_H, 1.2), haz, 0, TUNNEL_H / 2, 0));
  g.add(M(boxGeo(2.06, 0.18, 1.26), lam(cfg.accent2), 0, TUNNEL_H - 1.2, 0));
  g.add(M(boxGeo(2.06, 0.18, 1.26), lam(cfg.accent2), 0, 1.2, 0));
  return g;
}

// ── Монетка ────────────────────────────────────────────────────
export function makeCoin(): THREE.Group {
  const g = new THREE.Group();
  const gold = std(0xf7c948, 0xffb300, 0.55, 0.3, 0.7, false);
  const c = M(cylGeo(0.3, 0.3, 0.07, 16), gold);
  c.rotation.x = Math.PI / 2;
  const rim = M(torGeo(0.3, 0.045), std(0xffe083, 0xffc93c, 0.5, 0.35, 0.6, false));
  g.add(c, rim);
  return g;
}

// ── ЗАМОК: препятствия ─────────────────────────────────────────
export function makeBush(): THREE.Group {
  const g = new THREE.Group();
  const leaf = std(0x3d7a34, 0, 0, 0.95);
  const leaf2 = std(0x4f9440, 0, 0, 0.95);
  const b1 = M(icoGeo(0.55, 0), leaf, -0.35, 0.5, 0);
  const b2 = M(icoGeo(0.48, 0), leaf2, 0.35, 0.42, 0.1);
  const b3 = M(icoGeo(0.42, 0), leaf, 0, 0.72, -0.15);
  g.add(b1, b2, b3);
  const fl = M(sphGeo(0.07, 6, 5), lam(0xff8fb5), 0.3, 0.78, 0.15);
  const fl2 = M(sphGeo(0.06, 6, 5), lam(0xffe9a8), -0.25, 0.82, -0.05);
  g.add(fl, fl2);
  return g;
}

export function makeVase(): THREE.Group {
  const g = new THREE.Group();
  g.add(M(vaseGeo(), std(0xb4653a, 0, 0, 0.75), 0, 0, 0));
  g.add(M(sphGeo(0.2, 8, 6), std(0x3d7a34), 0, 1.05, 0));
  g.add(M(sphGeo(0.08, 6, 5), lam(0xff6b9d), 0.12, 1.16, 0.08));
  g.add(M(sphGeo(0.07, 6, 5), lam(0xffd166), -0.1, 1.12, -0.06));
  return g;
}

export function makeRailOb(): THREE.Group {
  const g = new THREE.Group();
  const white = std(0xe8ecf2, 0, 0, 0.5, 0.1);
  const gold = std(0xd9a520, 0xffc93c, 0.3, 0.4, 0.6);
  for (const x of [-0.85, 0, 0.85]) {
    g.add(M(cylGeo(0.05, 0.07, 1.0, 6), white, x, 0.5, 0));
    g.add(M(sphGeo(0.08, 6, 5), gold, x, 1.04, 0));
  }
  g.add(M(boxGeo(2.05, 0.09, 0.09), gold, 0, 0.98, 0));
  g.add(M(boxGeo(2.05, 0.06, 0.06), white, 0, 0.55, 0));
  return g;
}

// ── ДРАКОН ─────────────────────────────────────────────────────
let wingGeoCache: THREE.BufferGeometry | null = null;
function wingGeo() {
  if (wingGeoCache) return wingGeoCache;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.85, 0.45); s.lineTo(1.6, 0.3); s.lineTo(1.15, -0.02);
  s.lineTo(1.55, -0.55); s.lineTo(0.8, -0.35); s.lineTo(0.35, -0.52);
  s.lineTo(0, 0);
  wingGeoCache = new THREE.ShapeGeometry(s);
  return wingGeoCache;
}

export function makeDragon(color = 0xc63b2f, scaleV = 1): THREE.Group {
  const g = new THREE.Group();
  const skin = std(color, 0, 0, 0.8);
  const dark = std(new THREE.Color(color).multiplyScalar(0.6).getHex(), 0, 0, 0.85);
  const wingMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.85).getHex(), roughness: 0.85, side: THREE.DoubleSide, flatShading: true });

  const body = M(sphGeo(0.85, 10, 8), skin, 0, 0, 0);
  body.scale.set(0.72, 0.68, 1.6);
  g.add(body);
  // шипы на спине
  for (let i = 0; i < 4; i++) {
    g.add(M(coneGeo(0.11, 0.35, 4), dark, 0, 0.62, -0.5 + i * 0.42));
  }
  const neck = M(cylGeo(0.16, 0.3, 0.9, 6), skin, 0, 0.42, -1.2);
  neck.rotation.x = -0.9;
  g.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.78, -1.62);
  head.add(M(boxGeo(0.46, 0.4, 0.6), skin, 0, 0, 0));
  head.add(M(boxGeo(0.3, 0.22, 0.4), skin, 0, -0.05, -0.42));
  head.add(M(sphGeo(0.05, 6, 5), lam(0xffe14d), -0.16, 0.08, -0.26));
  head.add(M(sphGeo(0.05, 6, 5), lam(0xffe14d), 0.16, 0.08, -0.26));
  const h1 = M(coneGeo(0.07, 0.3, 4), dark, -0.14, 0.28, 0.14); h1.rotation.x = 0.5;
  const h2 = M(coneGeo(0.07, 0.3, 4), dark, 0.14, 0.28, 0.14); h2.rotation.x = 0.5;
  head.add(h1, h2);
  g.add(head);
  const tail = M(coneGeo(0.24, 1.6, 6), skin, 0, 0.1, 1.7);
  tail.rotation.x = Math.PI / 2;
  g.add(tail);
  // лапы
  g.add(M(cylGeo(0.08, 0.1, 0.4, 5), dark, -0.35, -0.55, -0.5));
  g.add(M(cylGeo(0.08, 0.1, 0.4, 5), dark, 0.35, -0.55, -0.5));
  // крылья
  const wl = new THREE.Group(); wl.position.set(0.3, 0.4, -0.2);
  const wlm = new THREE.Mesh(wingGeo(), wingMat); wlm.scale.setScalar(1.5); wl.add(wlm);
  const wr = new THREE.Group(); wr.position.set(-0.3, 0.4, -0.2);
  const wrm = new THREE.Mesh(wingGeo(), wingMat); wrm.scale.set(-1.5, 1.5, 1.5); wr.add(wrm);
  g.add(wl, wr);
  const phase = Math.random() * 10;
  g.userData.tick = (t: number) => {
    const f = 0.3 + Math.sin(t * 7 + phase) * 0.55;
    wl.rotation.z = f; wr.rotation.z = -f;
    head.rotation.y = Math.sin(t * 1.7 + phase) * 0.2;
  };
  g.scale.setScalar(scaleV);
  return g;
}

// ── ОГНЕННЫЙ СНАРЯД ДРАКОНА ────────────────────────────────────
export function makeFireball(): THREE.Group {
  const g = new THREE.Group();
  const core = M(sphGeo(0.34, 10, 8), std(0xfff3b0, 0xffe066, 1.3, 0.4), 0, 0, 0);
  const mid = M(sphGeo(0.52, 10, 8), std(0xff8c1a, 0xff6b00, 1.0, 0.6), 0, 0, 0);
  (mid.material as THREE.MeshStandardMaterial).transparent = true;
  (mid.material as THREE.MeshStandardMaterial).opacity = 0.75;
  g.add(mid, core);
  const halo = sprite(0xff7a1a, 2.6, 0.85);
  const halo2 = sprite(0xffd166, 1.7, 0.9);
  g.add(halo, halo2);
  // хвост пламени
  const tail: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const s = sprite(i % 2 ? 0xff5722 : 0xffa726, 1.5 - i * 0.22, 0.5 - i * 0.1);
    s.position.z = 0.55 + i * 0.5;
    g.add(s); tail.push(s);
  }
  const ph = Math.random() * 6;
  g.userData.tick = (t: number) => {
    const p = 1 + Math.sin(t * 22 + ph) * 0.14;
    core.scale.setScalar(p);
    mid.scale.setScalar(1 + Math.sin(t * 17 + ph) * 0.12);
    halo.scale.setScalar(2.6 * p);
    tail.forEach((s, i) => {
      s.scale.setScalar((1.5 - i * 0.22) * (0.8 + Math.sin(t * 19 + i) * 0.25));
    });
    g.rotation.z = t * 3;
  };
  return g;
}

/** Предупреждающая метка на земле — куда прилетит огонь */
export function makeFireWarn(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff4500, transparent: true, opacity: 0.55,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 20), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  const ph = Math.random() * 3;
  m.userData.tick = (t: number) => {
    mat.opacity = 0.35 + Math.abs(Math.sin(t * 7 + ph)) * 0.5;
    const s = 1 + Math.sin(t * 7 + ph) * 0.14;
    m.scale.set(s, s, s);
  };
  return m;
}

// ── МОПС ───────────────────────────────────────────────────────
export function makePug(): THREE.Group {
  const g = new THREE.Group();
  const tan = std(0xc9a06c, 0, 0, 0.95);
  const darkF = std(0x3a2c22, 0, 0, 0.95);
  g.add(M(boxGeo(0.56, 0.44, 0.82), tan, 0, 0.38, 0)); // тело
  const head = new THREE.Group();
  head.position.set(0, 0.62, -0.48);
  head.add(M(boxGeo(0.44, 0.4, 0.38), tan, 0, 0, 0));
  head.add(M(boxGeo(0.22, 0.16, 0.12), darkF, 0, -0.06, -0.22));
  head.add(M(sphGeo(0.045, 6, 5), lam(0x14100c), -0.12, 0.06, -0.19));
  head.add(M(sphGeo(0.045, 6, 5), lam(0x14100c), 0.12, 0.06, -0.19));
  const e1 = M(boxGeo(0.1, 0.14, 0.05), darkF, -0.16, 0.24, -0.02); e1.rotation.z = 0.35;
  const e2 = M(boxGeo(0.1, 0.14, 0.05), darkF, 0.16, 0.24, -0.02); e2.rotation.z = -0.35;
  head.add(e1, e2);
  g.add(head);
  for (const [x, z] of [[-0.18, -0.28], [0.18, -0.28], [-0.18, 0.28], [0.18, 0.28]] as const) {
    g.add(M(boxGeo(0.11, 0.24, 0.11), darkF, x, 0.12, z));
  }
  const tail = M(new THREE.TorusGeometry(0.09, 0.035, 5, 10, Math.PI * 1.6), tan, 0, 0.6, 0.42);
  tail.rotation.set(0.3, 0.4, 0);
  g.add(tail);
  const phase = Math.random() * 10;
  g.userData.tick = (t: number) => {
    g.position.y += 0; // позиция управляется снаружи
    const b = Math.abs(Math.sin(t * 6 + phase)) * 0.05;
    g.children[0].position.y = 0.38 + b;
    head.rotation.z = Math.sin(t * 5 + phase) * 0.08;
    tail.rotation.z = Math.sin(t * 9 + phase) * 0.4;
  };
  return g;
}

// ── Замок: вход, шипы, лестница ────────────────────────────────
export function makeSpikeField(w: number, len: number, color = 0x2b2d35): THREE.Group {
  const g = new THREE.Group();
  g.add(M(boxGeo(w, 0.14, len), std(color, 0, 0, 0.9), 0, 0.07, -len / 2));
  const spike = std(0x9ba3af, 0, 0, 0.5, 0.15);
  const rows = Math.max(6, Math.floor(len / 2));
  const cols = Math.max(6, Math.floor(w / 1.1));
  for (let rz = 0; rz < rows; rz++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = -w / 2 + 0.6 + cx * ((w - 1.2) / Math.max(1, cols - 1));
      const z = -0.8 - rz * ((len - 1.6) / Math.max(1, rows - 1));
      const s = M(coneGeo(0.18, 0.55, 5), spike, x, 0.35, z);
      g.add(s);
    }
  }
  return g;
}

/** Красная лестница/эстакада, уводящая с главной дороги на улицу замка */
export function makeCastleStairway(): THREE.Group {
  const g = new THREE.Group();
  const red = std(0xa12336, 0, 0, 0.85);
  const trim = std(0xd9a520, 0xffc93c, 0.1, 0.5, 0.5);
  const dark = std(0x4a2130, 0, 0, 0.9);
  // ступени идут диагонально влево и немного вверх (визуально)
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const x = -0.4 - t * 6.2;
    const y = 0.02 + t * 1.1;
    const z = -i * 2.2;
    g.add(M(boxGeo(3.2, 0.22, 2.4), red, x, y, z));
    g.add(M(boxGeo(3.3, 0.06, 2.5), trim, x, y + 0.14, z));
  }
  // верхняя площадка перед улицей замка
  g.add(M(boxGeo(5.2, 0.24, 5.4), dark, -6.75, 1.16, -18));
  g.add(M(boxGeo(5.4, 0.08, 5.6), trim, -6.75, 1.32, -18));
  // перила
  g.add(M(boxGeo(0.12, 0.9, 18.5), trim, -8.35, 0.8, -8.4));
  g.add(M(boxGeo(0.12, 0.9, 18.5), trim, -5.15, 0.8, -8.4));
  // стойки
  for (let i = 0; i < 8; i++) {
    const z = -i * 2.4;
    g.add(M(boxGeo(0.1, 0.8, 0.1), trim, -8.35, 0.48 + i * 0.13, z));
    g.add(M(boxGeo(0.1, 0.8, 0.1), trim, -5.15, 0.48 + i * 0.13, z));
  }
  return g;
}

// ── Замок: стена на старой дороге ──────────────────────────────
export function makeCastleWall(len: number): THREE.Group {
  const g = new THREE.Group();
  const stone = std(0xb9b3a4, 0, 0, 0.95);
  g.add(M(boxGeo(8.6, 5.6, len), stone, 0, 2.8, -len / 2));
  g.add(M(boxGeo(8.8, 0.7, len), std(0x9d9688, 0, 0, 0.9), 0, 5.85, -len / 2));
  for (let i = 0; i < 5; i++) {
    g.add(M(boxGeo(1.1, 0.85, 1.4), stone, 0, 6.5, -2.4 - i * 6.2));
  }
  // красные знамёна
  for (let i = 0; i < 2; i++) {
    const b = M(planeGeo(1.4, 2.4), std(0xa12336, 0x701221, 0.15, 0.9), -4.33, 3.6, -8 - i * 14);
    b.rotation.y = -Math.PI / 2;
    const trim = M(planeGeo(1.4, 0.3), std(0xd9a520, 0xffc93c, 0.2, 0.5), -4.32, 2.55, -8 - i * 14);
    trim.rotation.y = -Math.PI / 2;
    g.add(b, trim);
  }
  const banner = M(planeGeo(1.4, 2.4), std(0xa12336, 0x701221, 0.15, 0.9), 4.33, 3.6, -15);
  banner.rotation.y = Math.PI / 2;
  g.add(banner);
  return g;
}

// ── Замок: дворец ──────────────────────────────────────────────
export function makePalace(variant: 'keep' | 'tower' | 'wall'): THREE.Group {
  const g = new THREE.Group();
  const white = std(0xeef1f5, 0, 0, 0.85);
  const roof = std(0x3f74d6, 0, 0, 0.7);
  const gold = std(0xd9a520, 0xffc93c, 0.35, 0.35, 0.7);
  const winMat = new THREE.MeshStandardMaterial({ color: 0x0c1420, emissive: 0xffd166, emissiveIntensity: 1.0, emissiveMap: windowsTex('#0c1420', '#ffd166', 3, 4), roughness: 0.5 });
  if (variant === 'keep') {
    g.add(M(boxGeo(7, 9, 9), white, 0, 4.5, 0));
    const roofM = M(coneGeo(5.4, 3.2, 4), roof, 0, 10.6, 0); roofM.rotation.y = Math.PI / 4; g.add(roofM);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(M(cylGeo(1.1, 1.3, 10.5, 8), white, sx * 3.9, 5.25, sz * 4.2));
      g.add(M(coneGeo(1.5, 2.8, 8), roof, sx * 3.9, 11.9, sz * 4.2));
      g.add(M(sphGeo(0.18, 6, 5), gold, sx * 3.9, 13.4, sz * 4.2));
    }
    // окна лицом к улице (+x)
    for (let iy = 0; iy < 3; iy++) for (let iz = 0; iz < 3; iz++) {
      const w = M(planeGeo(0.7, 1.0), winMat, 3.52, 2.4 + iy * 2.4, -2.6 + iz * 2.6);
      w.rotation.y = Math.PI / 2;
      g.add(w);
    }
    const gate = M(boxGeo(0.3, 2.4, 1.8), std(0x5e4632, 0, 0, 0.9), 3.52, 1.2, 0);
    g.add(gate);
  } else if (variant === 'tower') {
    g.add(M(cylGeo(1.7, 2.0, 12, 8), white, 0, 6, 0));
    g.add(M(coneGeo(2.3, 3.6, 8), roof, 0, 13.8, 0));
    g.add(M(sphGeo(0.24, 6, 5), gold, 0, 15.8, 0));
    for (let i = 0; i < 3; i++) {
      const w = M(planeGeo(0.6, 0.9), winMat, 1.72, 3 + i * 3, 0);
      w.rotation.y = Math.PI / 2;
      g.add(w);
    }
    g.add(M(boxGeo(3.4, 4.2, 18), white, 0.4, 2.1, 0));
    g.add(M(boxGeo(3.6, 0.6, 18.4), roof, 0.4, 4.4, 0));
  } else {
    // стена дворца с бойницами
    g.add(M(boxGeo(2.6, 4.4, 26), white, 0, 2.2, 0));
    g.add(M(boxGeo(2.8, 0.6, 26.4), std(0xd7dbe2, 0, 0, 0.9), 0, 4.7, 0));
    for (let i = 0; i < 5; i++) g.add(M(boxGeo(2.7, 0.8, 1.2), white, 0, 5.4, -10 + i * 5));
    for (let i = 0; i < 4; i++) {
      const w = M(planeGeo(0.5, 0.8), winMat, 1.32, 2.6, -9.5 + i * 6.3);
      w.rotation.y = Math.PI / 2;
      g.add(w);
    }
  }
  return g;
}

export function makeMoat(len: number): THREE.Group {
  const g = new THREE.Group();
  const water = new THREE.MeshStandardMaterial({ color: 0x1f6fc9, emissive: 0x2a86e8, emissiveIntensity: 0.25, roughness: 0.15, transparent: true, opacity: 0.92 });
  const w = M(planeGeo(6.4, len), water, 0, -0.18, -len / 2);
  w.rotation.x = -Math.PI / 2;
  g.add(w);
  for (let i = 0; i < 4; i++) {
    const s = sprite(0x9fd4ff, 0.5 + Math.random() * 0.4, 0.5);
    s.position.set(rand(-2.6, 2.6), 0.05, -rand(2, len - 2));
    const baseY = 0.05, ph = Math.random() * 7;
    s.userData.tick = (t: number) => { s.position.y = baseY + Math.sin(t * 2 + ph) * 0.06; };
    g.add(s);
  }
  return g;
}

export function makeRailingRow(len: number): THREE.Group {
  const g = new THREE.Group();
  const white = std(0xe8ecf2, 0, 0, 0.55, 0.1);
  const gold = std(0xd9a520, 0xffc93c, 0.25, 0.4, 0.6);
  g.add(M(boxGeo(0.1, 0.1, len), gold, 0, 0.98, -len / 2));
  g.add(M(boxGeo(0.07, 0.07, len), white, 0, 0.55, -len / 2));
  for (let i = 0; i <= Math.floor(len / 3); i++) {
    g.add(M(cylGeo(0.05, 0.07, 1.0, 6), white, 0, 0.5, -i * 3));
    if (i % 2 === 0) g.add(M(sphGeo(0.08, 6, 5), gold, 0, 1.05, -i * 3));
  }
  return g;
}

// ── Ворота-разделитель локаций ─────────────────────────────────
export function makeGate(x0: number, x1: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const mat = std(0x11141f, color, 0.5, 0.4, 0.4);
  g.add(M(boxGeo(0.7, TUNNEL_H, 0.8), mat, x0, TUNNEL_H / 2, 0));
  g.add(M(boxGeo(0.7, TUNNEL_H, 0.8), mat, x1, TUNNEL_H / 2, 0));
  g.add(M(boxGeo(w + 0.7, 0.6, 0.9), mat, cx, TUNNEL_H + 0.1, 0));
  g.add(M(boxGeo(w + 0.5, 0.14, 0.95), lam(color), cx, TUNNEL_H - 0.28, 0));
  for (const x of [x0, x1]) g.add(M(boxGeo(0.74, 0.14, 0.84), lam(color), x, TUNNEL_H * 0.55, 0));
  const s = sprite(color, 5, 0.4); s.position.set(cx, TUNNEL_H / 2, 0); g.add(s);
  return g;
}

/** Стрелка-шеврон на земле (указывает влево при dir='left', т.е. в -x) */
export function makeArrow(dir: 'left' | 'right', color: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const s = dir === 'left' ? 1 : -1;
  const a = M(boxGeo(1.25, 0.05, 0.32), m, -s * 0.05, 0, 0.28); a.rotation.y = -s * 0.885;
  const b = M(boxGeo(1.25, 0.05, 0.32), m, -s * 0.05, 0, -0.28); b.rotation.y = s * 0.885;
  g.add(a, b);
  const ph = Math.random() * 4;
  g.userData.tick = (t: number) => { m.opacity = 0.55 + Math.abs(Math.sin(t * 4 + ph)) * 0.45; };
  return g;
}

/** Баррикада на конце улицы замка */
export function makeBarricade(w: number): THREE.Group {
  const g = new THREE.Group();
  const hazMap = hazardTex().clone();
  hazMap.repeat.set(4, 1);
  hazMap.needsUpdate = true;
  const haz = new THREE.MeshStandardMaterial({ map: hazMap, roughness: 0.7, emissive: 0xff5722, emissiveIntensity: 0.18 });
  g.add(M(boxGeo(w, 0.5, 0.4), haz, 0, 1.5, 0));
  g.add(M(boxGeo(w, 0.5, 0.4), haz, 0, 2.3, 0));
  for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) {
    g.add(M(boxGeo(0.2, 2.6, 0.3), std(0x2a2f3d), x, 1.3, 0));
  }
  const s1 = sprite(0xff3040, 1.2, 0.9); s1.position.set(-w / 2 + 0.3, 2.85, 0);
  const s2 = sprite(0xff3040, 1.2, 0.9); s2.position.set(w / 2 - 0.3, 2.85, 0);
  const ph = Math.random() * 3;
  s1.userData.tick = (t: number) => { (s1.material as THREE.SpriteMaterial).opacity = 0.4 + Math.abs(Math.sin(t * 5 + ph)) * 0.6; };
  s2.userData.tick = (t: number) => { (s2.material as THREE.SpriteMaterial).opacity = 0.4 + Math.abs(Math.cos(t * 5 + ph)) * 0.6; };
  g.add(s1, s2);
  return g;
}

// ── Облака, деревья, кусты-декор ───────────────────────────────
export function makeCloud(): THREE.Group {
  const g = new THREE.Group();
  const m = std(0xffffff, 0, 0, 1, 0, false);
  const n = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const s = M(sphGeo(rand(1.2, 2.4), 8, 6), m, i * rand(1.2, 1.9), rand(-0.3, 0.5), rand(-0.5, 0.5));
    s.scale.y = 0.55;
    g.add(s);
  }
  const sp = rand(0.3, 0.8);
  g.userData.tick = (_t: number, dt: number) => { g.position.x += sp * dt; if (g.position.x > 30) g.position.x = -40; };
  return g;
}

export function makeTree(): THREE.Group {
  const g = new THREE.Group();
  g.add(M(cylGeo(0.14, 0.2, 1.4, 6), std(0x6b4a2b), 0, 0.7, 0));
  const leaf = std(0x3d7a34, 0, 0, 0.95);
  g.add(M(sphGeo(0.8, 8, 6), leaf, 0, 1.8, 0));
  g.add(M(sphGeo(0.55, 8, 6), std(0x4f9440), 0.45, 1.45, 0.2));
  g.add(M(sphGeo(0.5, 8, 6), leaf, -0.4, 1.5, -0.15));
  return g;
}

// ── МОПС-СТРИТ: витрины, фонарики, флажки ─────────────────────
export function makeStorefront(side: number, accent: number): THREE.Group {
  const g = new THREE.Group();
  const h = rand(5.5, 7.5);
  // светлые пастельные домики
  const wallCol = pick([0xfff2f8, 0xffe9d9, 0xf3f0ff, 0xfdf6e3]);
  const b = M(boxGeo(3.4, h, 12), std(wallCol, 0, 0, 0.9), side * 1.7, h / 2, 0);
  g.add(b);
  const winMat = new THREE.MeshStandardMaterial({
    color: 0xcfe6f2, emissive: 0xffffff, emissiveIntensity: 0.18,
    emissiveMap: windowsTex('#bfd9e8', '#ffffff', 4, 5), roughness: 0.3, metalness: 0.05,
  });
  g.add(M(boxGeo(0.12, h * 0.6, 10), winMat, -side * 0.02, h * 0.5, 0));
  g.add(M(boxGeo(3.6, 0.4, 12.4), std(0xffffff, 0, 0, 0.7), side * 1.7, h + 0.15, 0));
  // тент
  const awnMat = new THREE.MeshStandardMaterial({ map: stripesTex('#ff6b9d', '#f7e9f2'), roughness: 0.8 });
  const awn = M(boxGeo(1.7, 0.16, 8), awnMat, -side * 0.4, 2.9, 0);
  awn.rotation.z = side * 0.28;
  g.add(awn);
  // вывеска
  const words = ['МОПС', 'PUG', 'ЛАПА', 'ВКУСНО', 'DOG'];
  const sign = new THREE.Mesh(planeGeo(3.0, 1.1), new THREE.MeshBasicMaterial({ map: signTex(pick(words), Math.random() < 0.5 ? '#ffd166' : '#ff6b9d'), transparent: true, depthWrite: false }));
  sign.position.set(-side * 0.12, 3.9, rand(-3, 3));
  sign.rotation.y = -side * Math.PI / 2;
  g.add(sign);
  void accent;
  return g;
}

export function makeLantern(): THREE.Group {
  const g = new THREE.Group();
  g.add(M(cylGeo(0.02, 0.02, 0.8, 4), lam(0x111418), 0, 0.4, 0));
  g.add(M(boxGeo(0.34, 0.42, 0.34), std(0xffb96b, 0xffa64d, 0.9, 0.6), 0, -0.2, 0));
  g.add(M(boxGeo(0.4, 0.08, 0.4), lam(0x111418), 0, 0.05, 0));
  const s = sprite(0xffb96b, 1.3, 0.55); s.position.set(0, -0.2, 0); g.add(s);
  const ph = Math.random() * 6;
  g.userData.tick = (t: number) => { g.rotation.z = Math.sin(t * 1.4 + ph) * 0.08; };
  return g;
}

export function makeBunting(): THREE.Group {
  const g = new THREE.Group();
  const cols = [0xff6b9d, 0xffd166, 0x8be9fd, 0xb388ff, 0x7CFC9A];
  for (let i = 0; i < 9; i++) {
    const x = -5.2 + i * 1.3;
    const f = M(coneGeo(0.22, 0.5, 4), std(cols[i % cols.length], cols[i % cols.length], 0.2, 0.9), x, -Math.sin((i / 8) * Math.PI) * 0.35 - 0.25, 0);
    f.rotation.x = Math.PI;
    g.add(f);
  }
  return g;
}

// ── Лёд: кристаллы, сосульки ───────────────────────────────────
export function makeCrystalCluster(): THREE.Group {
  const g = new THREE.Group();
  const m = std(0x66d9ff, 0x00e5ff, 0.7, 0.3);
  for (let i = 0; i < 3; i++) {
    const c = M(octGeo(rand(0.35, 0.7)), m, rand(-0.7, 0.7), rand(0.3, 0.8), rand(-0.5, 0.5));
    c.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1));
    g.add(c);
  }
  const s = sprite(0x00e5ff, 2.2, 0.3); s.position.y = 0.6; g.add(s);
  return g;
}

export function makeIcicle(): THREE.Group {
  const g = new THREE.Group();
  const m = std(0xbfeaff, 0x66d9ff, 0.3, 0.35);
  const c = M(coneGeo(0.2, rand(0.9, 1.9), 6), m, 0, 0, 0);
  c.rotation.x = Math.PI;
  g.add(c);
  return g;
}

// ── Каньон: скалы, кактусы, hoodoo ─────────────────────────────
export function makeRockWall(): THREE.Group {
  const g = new THREE.Group();
  const cols = [0x8a4f2c, 0x9d5c33, 0x74401f];
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const r = M(boxGeo(rand(2.5, 4), rand(5, 9.5), rand(6, 12)), std(pick(cols), 0, 0, 1), rand(-1, 1), rand(2, 3.6), rand(-10, 10));
    r.rotation.y = rand(-0.2, 0.2);
    g.add(r);
  }
  return g;
}

export function makeCactus(): THREE.Group {
  const g = new THREE.Group();
  const m = std(0x3f7d3a, 0, 0, 0.9);
  g.add(M(cylGeo(0.22, 0.26, 2.0, 7), m, 0, 1.0, 0));
  const a1 = M(cylGeo(0.13, 0.15, 0.8, 6), m, 0.42, 1.25, 0); a1.rotation.z = -0.5;
  const a2 = M(cylGeo(0.13, 0.15, 0.7, 6), m, -0.4, 0.9, 0); a2.rotation.z = 0.5;
  g.add(a1, a2);
  g.add(M(sphGeo(0.09, 6, 5), lam(0xff8fb5), 0, 2.05, 0));
  return g;
}

export function makeHoodoo(): THREE.Group {
  const g = new THREE.Group();
  g.add(M(cylGeo(0.55, 0.95, rand(3.5, 5.5), 7), std(0x9d5c33, 0, 0, 1), 0, 2.2, 0));
  const top = M(icoGeo(0.9), std(0x74401f, 0, 0, 1), 0, 4.9, 0);
  top.scale.y = 0.6;
  g.add(top);
  return g;
}

// ── Метро: панели, колонны, балки ─────────────────────────────
export function makeBuilding(side: number, accent: number): THREE.Group {
  const g = new THREE.Group();
  const h = rand(7, 12);
  // светлый вокзальный фасад: белый камень + большие витражные окна
  const wallCol = pick([0xf2f4f8, 0xe9edf3, 0xf6f0e6, 0xeaf1f6]);
  g.add(M(boxGeo(3, h, 26), std(wallCol, 0, 0, 0.9), side * 1.5, h / 2, 0));
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xbfe0f2, emissive: 0xdff2ff, emissiveIntensity: 0.25,
    emissiveMap: windowsTex('#a8cfe4', '#ffffff', 5, 8), roughness: 0.25, metalness: 0.1,
  });
  glassMat.emissiveMap!.repeat.set(2, 1);
  const glass = M(boxGeo(0.14, h * 0.72, 24), glassMat, -side * 0.04, h * 0.46, 0);
  g.add(glass);
  // белые рамы
  for (let i = 0; i < 5; i++) {
    g.add(M(boxGeo(0.2, h * 0.75, 0.22), std(0xffffff, 0, 0, 0.6), -side * 0.06, h * 0.46, -10 + i * 5));
  }
  g.add(M(boxGeo(3.3, 0.5, 26), std(0xffffff, 0, 0, 0.7), side * 1.5, h + 0.2, 0));
  // цветная вывеска (не светящаяся, просто яркая)
  const panel = M(boxGeo(0.16, rand(1.2, 2.2), rand(2, 3.6)), std(accent, accent, 0.18, 0.7), -side * 0.06, rand(3, 5.5), rand(-8, 8));
  g.add(panel);
  return g;
}

export function makePillar(accent: number): THREE.Group {
  const g = new THREE.Group();
  g.add(M(cylGeo(0.3, 0.4, TUNNEL_H, 10), std(0xeef1f5, 0, 0, 0.75), 0, TUNNEL_H / 2, 0));
  g.add(M(cylGeo(0.44, 0.44, 0.3, 10), std(0xdfe4ea, 0, 0, 0.8), 0, 0.15, 0));
  g.add(M(cylGeo(0.44, 0.44, 0.3, 10), std(0xdfe4ea, 0, 0, 0.8), 0, TUNNEL_H - 0.15, 0));
  g.add(M(boxGeo(0.72, 0.1, 0.72), std(accent, accent, 0.15, 0.7), 0, 2.4, 0));
  return g;
}

// ── СОЛНЕЧНЫЙ ПАССАЖ ──────────────────────────────────────────
export function makeSunnyBuilding(side: number): THREE.Group {
  const g = new THREE.Group();
  const h = rand(7.5, 10);
  const wall = std(pick([0xf7f1e4, 0xffe9d6, 0xf3e3ef, 0xe7f2f7]), 0, 0, 0.9);
  g.add(M(boxGeo(3.4, h, 26), wall, side * 1.7, h / 2, 0));
  // балконы и окна
  for (let i = 0; i < 4; i++) {
    const z = -9 + i * 6;
    for (const y of [2.4, 5.0]) {
      const win = M(boxGeo(0.12, 1.3, 1.5), std(0x8fd6f2, 0x6fc4e8, 0.35, 0.25, 0.4), -side * 0.02, y, z);
      g.add(win);
      g.add(M(boxGeo(0.26, 0.1, 1.8), std(0xffffff, 0, 0, 0.7), -side * 0.1, y - 0.72, z));
      for (let k = 0; k < 5; k++) {
        g.add(M(cylGeo(0.02, 0.02, 0.4, 4), std(0xd8dde4), -side * 0.16, y - 0.5, z - 0.7 + k * 0.35));
      }
      // цветы на балконе
      g.add(M(sphGeo(0.12, 6, 5), std(0xff6f91, 0xff6f91, 0.15, 0.9), -side * 0.16, y - 0.52, z + rand(-0.5, 0.5)));
    }
  }
  // полосатый тент над первым этажом
  const awnMat = new THREE.MeshStandardMaterial({ map: stripesTex('#ff7043', '#fff6e8'), roughness: 0.8, side: THREE.DoubleSide });
  const awn = M(boxGeo(1.8, 0.14, 9), awnMat, -side * 0.6, 3.0, rand(-4, 4));
  awn.rotation.z = side * 0.3;
  g.add(awn);
  return g;
}

/** Стеклянная крыша-пассаж: светлая, пропускает солнце */
export function makeGlassRoof(len: number): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xd9f2ff, transparent: true, opacity: 0.3, roughness: 0.05,
    metalness: 0, transmission: 0.6, side: THREE.DoubleSide,
  });
  const p = M(planeGeo(12, len), glass, 0, TUNNEL_H, -len / 2);
  p.rotation.x = Math.PI / 2;
  g.add(p);
  const frame = std(0xf5f7fa, 0, 0, 0.5, 0.3);
  for (let i = 0; i <= len / 3; i++) {
    g.add(M(boxGeo(12, 0.16, 0.16), frame, 0, TUNNEL_H - 0.08, -i * 3));
  }
  g.add(M(boxGeo(0.2, 0.2, len), frame, -2.3, TUNNEL_H - 0.08, -len / 2));
  g.add(M(boxGeo(0.2, 0.2, len), frame, 2.3, TUNNEL_H - 0.08, -len / 2));
  return g;
}

/** Застеклённый световой фонарь в потолке (даёт ощущение дневного света) */
export function makeSkylight(len: number): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({
    color: 0xeef6ff, emissive: 0xfff8e6, emissiveIntensity: 0.16,
    roughness: 0.2, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
  });
  const p = M(planeGeo(5.2, len - 1), glass, 0, TUNNEL_H - 0.04, -len / 2);
  p.rotation.x = Math.PI / 2;
  g.add(p);
  const frame = std(0xf2f5f9, 0, 0, 0.6, 0.2);
  for (let i = 0; i <= (len - 1) / 2.5; i++) {
    g.add(M(boxGeo(5.4, 0.14, 0.14), frame, 0, TUNNEL_H - 0.1, -0.5 - i * 2.5));
  }
  g.add(M(boxGeo(0.2, 0.2, len - 1), frame, -2.65, TUNNEL_H - 0.1, -len / 2));
  g.add(M(boxGeo(0.2, 0.2, len - 1), frame, 2.65, TUNNEL_H - 0.1, -len / 2));
  return g;
}

/** Столбы солнечного света сквозь крышу */
export function makeSunShaft(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff4d6, transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(cylGeo(0.9, 2.4, TUNNEL_H + 1, 8), mat);
  m.position.y = TUNNEL_H / 2;
  m.rotation.z = 0.16;
  const ph = Math.random() * 6;
  m.userData.tick = (t: number) => { mat.opacity = 0.05 + Math.sin(t * 0.8 + ph) * 0.02; };
  return m;
}

export function makePalm(): THREE.Group {
  const g = new THREE.Group();
  const trunk = std(0xa8865c, 0, 0, 0.95);
  for (let i = 0; i < 6; i++) {
    const seg = M(cylGeo(0.14 - i * 0.012, 0.17 - i * 0.012, 0.5, 7), trunk, Math.sin(i * 0.5) * 0.1, 0.25 + i * 0.48, 0);
    g.add(seg);
  }
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3fa14a, roughness: 0.85, side: THREE.DoubleSide, flatShading: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const l = new THREE.Mesh(planeGeo(0.42, 2.0), leaf);
    l.position.set(Math.cos(a) * 0.78, 3.1, Math.sin(a) * 0.78);
    l.rotation.set(-1.0, -a, 0.25);
    g.add(l);
  }
  g.add(M(sphGeo(0.13, 6, 5), std(0xc98f3a), 0.2, 2.9, 0.1));
  return g;
}

export function makeStreetLamp(): THREE.Group {
  const g = new THREE.Group();
  g.add(M(cylGeo(0.07, 0.11, 3.6, 8), std(0x3a4453, 0, 0, 0.6, 0.4), 0, 1.8, 0));
  g.add(M(boxGeo(0.1, 0.1, 0.7), std(0x3a4453), 0, 3.55, -0.3));
  g.add(M(sphGeo(0.22, 8, 6), std(0xfff6d6, 0xfff0b8, 1.4, 0.3), 0, 3.45, -0.6));
  const s = sprite(0xfff0b8, 2.0, 0.45); s.position.set(0, 3.45, -0.6);
  g.add(s);
  return g;
}

export function makeBench(): THREE.Group {
  const g = new THREE.Group();
  const wood = std(0xb5813f, 0, 0, 0.9);
  for (let i = 0; i < 3; i++) g.add(M(boxGeo(1.5, 0.08, 0.16), wood, 0, 0.45, -0.2 + i * 0.2));
  for (let i = 0; i < 3; i++) g.add(M(boxGeo(1.5, 0.16, 0.08), wood, 0, 0.62 + i * 0.2, 0.22));
  g.add(M(boxGeo(0.1, 0.45, 0.5), std(0x39424f, 0, 0, 0.6, 0.4), -0.62, 0.22, 0));
  g.add(M(boxGeo(0.1, 0.45, 0.5), std(0x39424f, 0, 0, 0.6, 0.4), 0.62, 0.22, 0));
  return g;
}

export function makeFountain(): THREE.Group {
  const g = new THREE.Group();
  const stone = std(0xe4dccb, 0, 0, 0.9);
  g.add(M(cylGeo(1.5, 1.6, 0.5, 14), stone, 0, 0.25, 0));
  const water = new THREE.MeshStandardMaterial({ color: 0x53c1f0, emissive: 0x2f9fd6, emissiveIntensity: 0.3, roughness: 0.1, transparent: true, opacity: 0.85 });
  const w = M(planeGeo(2.6, 2.6), water, 0, 0.52, 0); w.rotation.x = -Math.PI / 2;
  g.add(w);
  g.add(M(cylGeo(0.18, 0.28, 1.1, 10), stone, 0, 1.0, 0));
  g.add(M(cylGeo(0.75, 0.2, 0.2, 12), stone, 0, 1.55, 0));
  const jet = sprite(0xd6f3ff, 1.7, 0.55); jet.position.set(0, 2.0, 0);
  g.add(jet);
  const ph = Math.random() * 5;
  g.userData.tick = (t: number) => { jet.position.y = 2.0 + Math.sin(t * 3 + ph) * 0.12; };
  return g;
}

export function makeCeilLight(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(M(boxGeo(4.6, 0.1, 0.44), std(0xfffdf5, color, 0.65, 0.4), 0, 0, 0));
  g.add(M(boxGeo(4.8, 0.12, 0.6), std(0xd8dee6, 0, 0, 0.6, 0.3), 0, 0.1, 0));
  const s = sprite(color, 2.2, 0.1); g.add(s);
  return g;
}
