import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNNEL_H, LOCS, LocId, rand } from './config';
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
export function ringGeo(r0: number, r1: number, s = 20) {
  const k = `rg${r0}|${r1}|${s}`;
  let g = geos.get(k); if (!g) { g = new THREE.RingGeometry(r0, r1, s); geos.set(k, g); } return g;
}
export function circleGeo(r: number, s = 12) {
  const k = `ci${r}|${s}`;
  let g = geos.get(k); if (!g) { g = new THREE.CircleGeometry(r, s); geos.set(k, g); } return g;
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

export function cachedMat(key: string, create: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) { m = create(); mats.set(key, m); }
  return m;
}

/** Матовые поверхности используют быстрый MeshLambertMaterial, блестящие/металлические — MeshStandardMaterial */
export function std(color: number, e = 0, ei = 0, rough = 0.9, metal = 0.02, flat = true): THREE.Material {
  const useLambert = metal <= 0.1 && rough >= 0.55;
  const k = `${useLambert ? 'lm' : 'st'}${color}|${e}|${ei}|${rough}|${metal}|${flat ? 1 : 0}`;
  let m = mats.get(k);
  if (!m) {
    if (useLambert) {
      m = new THREE.MeshLambertMaterial({
        color, emissive: e, emissiveIntensity: ei, flatShading: flat,
      });
    } else {
      m = new THREE.MeshStandardMaterial({
        color, emissive: e, emissiveIntensity: ei, roughness: rough, metalness: metal, flatShading: flat,
      });
    }
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

export function sprite(color: number, scale: number, opacity = 0.85, unique = false) {
  const sm = unique
    ? new THREE.SpriteMaterial({
        map: glowTex(), color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    : (cachedMat(`sp|${color}|${opacity}`, () => new THREE.SpriteMaterial({
        map: glowTex(), color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })) as THREE.SpriteMaterial);
  const s = new THREE.Sprite(sm);
  s.scale.setScalar(scale);
  return s;
}

// ── Объединение статических мешей (Bake + Vertex Colors) ───────
const bakedMats = new Map<string, THREE.Material>();
const prefabCache = new Map<string, THREE.Group>();

interface Bucket {
  mat: THREE.Material;
  geoms: THREE.BufferGeometry[];
}

function getMergedMat(m: THREE.Material): { key: string; mat: THREE.Material; bakeColor: THREE.Color | null } {
  const anyM = m as THREE.MeshStandardMaterial & THREE.MeshLambertMaterial & THREE.MeshBasicMaterial;
  if (anyM.map || anyM.emissiveMap) {
    return { key: `T|${m.uuid}`, mat: m, bakeColor: null };
  }
  const sd = m.side;
  const tr = m.transparent ? 1 : 0;
  const op = m.opacity;
  const dw = m.depthWrite ? 1 : 0;

  if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
    const key = `B|${tr}|${op}|${sd}|${dw}`;
    let bm = bakedMats.get(key);
    if (!bm) {
      bm = new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, transparent: !!tr, opacity: op, side: sd, depthWrite: !!dw,
      });
      bakedMats.set(key, bm);
    }
    return { key, mat: bm, bakeColor: anyM.color };
  }

  if ((m as THREE.MeshLambertMaterial).isMeshLambertMaterial) {
    const e = anyM.emissive.getHex();
    const ei = anyM.emissiveIntensity;
    const fl = anyM.flatShading ? 1 : 0;
    const key = `L|${e}|${ei}|${fl}|${tr}|${op}|${sd}`;
    let lm = bakedMats.get(key);
    if (!lm) {
      lm = new THREE.MeshLambertMaterial({
        color: 0xffffff, vertexColors: true, emissive: e, emissiveIntensity: ei,
        flatShading: !!fl, transparent: !!tr, opacity: op, side: sd,
      });
      bakedMats.set(key, lm);
    }
    return { key, mat: lm, bakeColor: anyM.color };
  }

  const e = anyM.emissive ? anyM.emissive.getHex() : 0;
  const ei = anyM.emissiveIntensity ?? 0;
  const r = anyM.roughness ?? 0.5;
  const ml = anyM.metalness ?? 0;
  const fl = anyM.flatShading ? 1 : 0;
  const key = `S|${e}|${ei}|${r}|${ml}|${fl}|${tr}|${op}|${sd}`;
  let sm = bakedMats.get(key);
  if (!sm) {
    sm = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, emissive: e, emissiveIntensity: ei,
      roughness: r, metalness: ml, flatShading: !!fl, transparent: !!tr, opacity: op, side: sd,
    });
    bakedMats.set(key, sm);
  }
  return { key, mat: sm, bakeColor: anyM.color };
}

function flipWinding(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position');
  const norm = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const swapAttr = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, itemSize: number) => {
    if (!attr) return;
    const a = attr.array as Float32Array;
    for (let i = 0; i < pos.count; i += 3) {
      const i1 = (i + 1) * itemSize;
      const i2 = (i + 2) * itemSize;
      for (let k = 0; k < itemSize; k++) {
        const tmp = a[i1 + k];
        a[i1 + k] = a[i2 + k];
        a[i2 + k] = tmp;
      }
    }
  };
  swapAttr(pos, 3);
  swapAttr(norm, 3);
  swapAttr(uv, 2);
}

/** Объединяет статические дочерние Mesh в минимальное число draw-call'ов с общими материалами */
export function bakeGroup(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const buckets = new Map<string, Bucket>();
  const sprites: THREE.Sprite[] = [];

  src.traverse((obj) => {
    if ((obj as THREE.Sprite).isSprite) {
      const sp = new THREE.Sprite((obj as THREE.Sprite).material);
      obj.getWorldPosition(sp.position);
      obj.getWorldScale(sp.scale);
      sprites.push(sp);
      return;
    }
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const { key, mat, bakeColor } = getMergedMat(mesh.material);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { mat, geoms: [] }; buckets.set(key, bucket); }

    const raw = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    // Оставляем только стандартные атрибуты, чтобы mergeGeometries никогда не падал
    for (const attrName of Object.keys(raw.attributes)) {
      if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
        raw.deleteAttribute(attrName);
      }
    }
    if (!raw.getAttribute('normal')) raw.computeVertexNormals();
    const pos = raw.getAttribute('position');
    if (!raw.getAttribute('uv')) {
      raw.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
    }
    raw.applyMatrix4(mesh.matrixWorld);
    if (mesh.matrixWorld.determinant() < 0) flipWinding(raw);

    if (bakeColor) {
      const colors = new Float32Array(pos.count * 3);
      const r = bakeColor.r, g = bakeColor.g, b = bakeColor.b;
      for (let i = 0; i < pos.count; i++) {
        const o = i * 3;
        colors[o] = r; colors[o + 1] = g; colors[o + 2] = b;
      }
      raw.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    bucket.geoms.push(raw);
  });

  const out = new THREE.Group();
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geoms, false);
    for (const g of bucket.geoms) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      out.add(new THREE.Mesh(merged, bucket.mat));
    }
  }
  for (const sp of sprites) out.add(sp);
  return out;
}

function cachedPrefab(key: string, build: () => THREE.Group): THREE.Group {
  let tmpl = prefabCache.get(key);
  if (!tmpl) {
    tmpl = bakeGroup(build());
    prefabCache.set(key, tmpl);
  }
  return tmpl.clone();
}

// ── ТРАНСПОРТ ─────────────────────────────────────────────────
export interface TrainScheme { body: number; roof: number; stripe: number; win: number; kind?: string; }

export function getTrainBounds(len: number, loc: LocId): { zOff: number; half: number; top: number; zFront: number } {
  switch (loc) {
    case 'ice':
      return { zOff: 0.33, half: len / 2 + 1.03, top: 2.60, zFront: len / 2 + 1.36 };
    case 'sunny':
      return { zOff: 0.95, half: len / 2 + 0.95, top: 2.69, zFront: len / 2 + 1.90 };
    case 'castle':
      return { zOff: 0.95, half: len / 2 + 0.95, top: 2.75, zFront: len / 2 + 1.90 };
    case 'pugs':
      return { zOff: 0.605, half: len / 2 + 0.605, top: 2.58, zFront: len / 2 + 1.21 };
    case 'canyon':
      return { zOff: 0.425, half: len / 2 + 0.425, top: 2.75, zFront: len / 2 + 0.85 };
    case 'metro':
    default:
      return { zOff: 0.56, half: len / 2 + 0.56, top: 2.95, zFront: len / 2 + 1.12 };
  }
}

/** Ледяные санки / бобслей */
export function makeSlede(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.25, 0.55); // металлический блеск
  // корпус — обтекаемый, высотой под крышу 2.60
  g.add(M(boxGeo(2.0, 2.0, len), bodyMat, 0, 1.22, 0));
  // нос — скошен
  g.add(M(boxGeo(2.0, 1.75, 1.4), bodyMat, 0, 1.15, len / 2 + 0.5));
  // полозья — два рельса из металла под корпусом
  const runnerMat = std(0xccd8e0, 0, 0, 0.15, 0.85);
  g.add(M(boxGeo(0.18, 0.14, len + 1.4), runnerMat, -0.72, 0.16, 0));
  g.add(M(boxGeo(0.18, 0.14, len + 1.4), runnerMat, 0.72, 0.16, 0));
  // ледяной бортик — голубое стекло
  const iceMat = cachedMat(`sledeIce|${s.stripe}`, () => new THREE.MeshLambertMaterial({
    color: s.stripe, emissive: s.stripe, emissiveIntensity: 0.22, transparent: true, opacity: 0.82,
  }));
  g.add(M(boxGeo(2.1, 0.34, len * 0.94), iceMat, 0, 2.34, 0));
  // крыша плоская (для прыжков)
  g.add(M(boxGeo(1.9, 0.2, len * 0.96), std(s.roof, 0, 0, 0.35, 0.5), 0, 2.5, 0));
  // ледяные кристаллы-декор сверху
  for (let i = 0; i < Math.floor(len / 5); i++) {
    const cx = ((i * 7) % 3 - 1) * 0.42;
    const c = M(coneGeo(0.12, 0.32, 5), std(0xa8deff, 0x00e5ff, 0.35, 0.3, 0.1), cx, 2.66, -len / 2 + 2 + i * 5);
    g.add(c);
  }
  // передняя часть — рог
  g.add(M(boxGeo(2.05, 1.5, 0.9), bodyMat, 0, 1.0, len / 2 + 0.7));
  g.add(M(boxGeo(0.36, 0.36, 0.36), runnerMat, 0, 1.0, len / 2 + 1.18));
  // фары — синие
  const fl1 = sprite(0x00e5ff, 1.2, 0.9); fl1.position.set(-0.52, 1.0, len / 2 + 1.2); g.add(fl1);
  const fl2 = sprite(0x00e5ff, 1.2, 0.9); fl2.position.set(0.52, 1.0, len / 2 + 1.2); g.add(fl2);
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
    g.add(M(cylGeo(0.42, 0.42, 0.28, 12), wm, -1.26, 0.46, z));
    g.add(M(cylGeo(0.42, 0.42, 0.28, 12), wm, 1.26, 0.46, z));
    g.add(M(cylGeo(0.22, 0.22, 0.32, 8), std(0xd0d8e0, 0, 0, 0.25, 0.8), -1.26, 0.46, z));
    g.add(M(cylGeo(0.22, 0.22, 0.32, 8), std(0xd0d8e0, 0, 0, 0.25, 0.8), 1.26, 0.46, z));
  }
  // окна боковые
  const winMat = std(0x7ecbf0, s.win, 0.2, 0.25, 0.2);
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
  g.add(M(boxGeo(2.3, 2.2, len), stoneM, 0, 1.4, 0));
  for (let i = 0; i < Math.ceil(len / 3); i++) {
    g.add(M(boxGeo(0.6, 0.55, 0.55), std(s.roof, 0, 0, 0.9), -0.75, 2.78, -len / 2 + 1.5 + i * 3));
    g.add(M(boxGeo(0.6, 0.55, 0.55), std(s.roof, 0, 0, 0.9), 0.75, 2.78, -len / 2 + 1.5 + i * 3));
  }
  g.add(M(boxGeo(2.1, 0.2, len * 0.97), goldM, 0, 2.62, 0));
  g.add(M(boxGeo(2.32, 0.18, len * 0.92), goldM, 0, 2.1, 0));
  for (const z of [-len / 2 + 2, len / 2 - 2]) {
    const wm = std(0x4a2c08, 0, 0, 0.9, 0.15);
    const rim = std(0xd9a520, 0xffc93c, 0.1, 0.4, 0.7);
    g.add(M(cylGeo(0.7, 0.72, 0.38, 12), wm, -1.28, 0.7, z));
    g.add(M(cylGeo(0.7, 0.72, 0.38, 12), wm, 1.28, 0.7, z));
    g.add(M(cylGeo(0.42, 0.42, 0.42, 8), rim, -1.28, 0.7, z));
    g.add(M(cylGeo(0.42, 0.42, 0.42, 8), rim, 1.28, 0.7, z));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(M(boxGeo(0.08, 0.7, 0.08), rim, -1.28 + Math.cos(a) * 0.32, 0.7 + Math.sin(a) * 0.32, z));
    }
  }
  // пасть дракона спереди (смотрит на +Z)
  const head = new THREE.Group();
  head.position.set(0, 1.55, len / 2 + 1.2);
  head.add(M(boxGeo(1.6, 1.0, 1.4), stoneM, 0, 0, 0));
  head.add(M(boxGeo(1.7, 0.35, 1.2), std(s.roof, 0, 0, 0.85), 0, -0.42, 0.08));
  head.add(M(boxGeo(0.42, 0.26, 0.1), std(0xffe14d, 0xffe14d, 0.4, 0.5), -0.4, 0.2, 0.72));
  head.add(M(boxGeo(0.42, 0.26, 0.1), std(0xffe14d, 0xffe14d, 0.4, 0.5), 0.4, 0.2, 0.72));
  const fire = sprite(0xff6b00, 2.2, 0.9); fire.position.set(0, 0, 0.9); head.add(fire);
  g.add(head);
  return g;
}

/** Мопс-мобиль (телега с мопсами) */
export function makePugCart(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.75);
  g.add(M(boxGeo(2.2, 2.0, len), bodyMat, 0, 1.35, 0));
  g.add(M(boxGeo(2.1, 0.2, len * 0.96), std(s.roof, 0, 0, 0.7), 0, 2.47, 0));
  const cols = [0xff6b9d, 0xffd166, 0x8be9fd];
  for (let i = 0; i < Math.floor(len / 3.5); i++) {
    const cx = ((i * 5) % 3 - 1) * 0.45;
    const c = M(coneGeo(0.2, 0.45, 4), std(cols[i % 3], cols[i % 3], 0.18, 0.9), cx, 2.74, -len / 2 + 1.5 + i * 3.5);
    c.rotation.x = Math.PI;
    g.add(c);
  }
  g.add(M(boxGeo(2.24, 0.16, len * 0.92), lam(s.stripe), 0, 1.8, 0));
  const wm = std(0xcfe6f2, s.win, 0.2, 0.25, 0.2);
  for (let i = 0; i < Math.floor(len / 4); i++) {
    const z = -len / 2 + 2 + i * 4;
    const pw1 = M(circleGeo(0.35, 12), wm, -1.12, 1.5, z); pw1.rotation.y = -Math.PI / 2; g.add(pw1);
    const pw2 = M(circleGeo(0.35, 12), wm, 1.12, 1.5, z); pw2.rotation.y = Math.PI / 2; g.add(pw2);
  }
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
  g.add(M(boxGeo(2.1, 2.3, len), wood, 0, 1.35, 0));
  for (let i = 0; i < Math.ceil(len / 3.5); i++) {
    g.add(M(boxGeo(2.16, 2.32, 0.2), metal, 0, 1.35, -len / 2 + 0.8 + i * 3.5));
  }
  g.add(M(boxGeo(2.05, 0.25, len * 0.96), wood, 0, 2.58, 0));
  for (let i = 0; i < Math.floor(len / 2.5); i++) {
    g.add(M(boxGeo(2.1, 0.18, 0.18), metal, 0, 2.73, -len / 2 + 1 + i * 2.5));
  }
  for (const z of [-len / 2 + 2, len / 2 - 2]) {
    const wm = std(0x4a3a28, 0, 0, 0.9);
    const rim = std(0x8a7460, 0, 0, 0.6, 0.35);
    g.add(M(cylGeo(0.52, 0.54, 0.3, 10), wm, -1.18, 0.56, z));
    g.add(M(cylGeo(0.52, 0.54, 0.3, 10), wm, 1.18, 0.56, z));
    g.add(M(cylGeo(0.28, 0.28, 0.36, 8), rim, -1.18, 0.56, z));
    g.add(M(cylGeo(0.28, 0.28, 0.36, 8), rim, 1.18, 0.56, z));
  }
  g.add(M(boxGeo(2.16, 0.16, len * 0.9), lam(s.stripe), 0, 2.42, 0));
  const fl = sprite(0xffe8a0, 1.4, 0.85); fl.position.set(0, 1.5, len / 2 + 0.8); g.add(fl);
  g.add(M(boxGeo(2.12, 2.3, 0.9), wood, 0, 1.35, len / 2 + 0.4));
  return g;
}

export function makeTrain(len: number, s: TrainScheme): THREE.Group {
  const qLen = Math.round(len);
  const key = `tr|${s.kind ?? 'def'}|${s.body}|${s.stripe}|${qLen}`;
  return cachedPrefab(key, () => {
    if (s.kind === 'slede') return makeSlede(qLen, s);
    if (s.kind === 'van') return makeVan(qLen, s);
    if (s.kind === 'chariot') return makeChariot(qLen, s);
    if (s.kind === 'pugcart') return makePugCart(qLen, s);
    if (s.kind === 'minecart') return makeMineCart(qLen, s);
    return makeTrainDefault(qLen, s);
  });
}

export function makeTrainDefault(len: number, s: TrainScheme): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = std(s.body, 0, 0, 0.55, 0.2);
  g.add(M(boxGeo(2.1, 2.5, len), bodyMat, 0, 1.45, 0));
  g.add(M(boxGeo(2.0, 0.3, len * 0.97), std(s.roof, 0, 0, 0.7, 0.2), 0, 2.8, 0));
  g.add(M(boxGeo(0.1, 0.16, len * 0.97), std(s.stripe, s.stripe, 0.12, 0.6), -0.98, 3.0, 0));
  g.add(M(boxGeo(0.1, 0.16, len * 0.97), std(s.stripe, s.stripe, 0.12, 0.6), 0.98, 3.0, 0));
  for (let i = 0; i < Math.floor(len / 5); i++) {
    g.add(M(boxGeo(0.7, 0.14, 0.7), std(0xb9c2cc, 0, 0, 0.6, 0.35), 0, 3.02, -len / 2 + 3 + i * 5));
  }
  g.add(M(boxGeo(2.02, 0.62, len * 0.94), std(0x4a5260, 0, 0, 0.8), 0, 0.42, 0));
  g.add(M(boxGeo(2.14, 0.2, len * 0.9), lam(s.stripe), 0, 2.35, 0));
  const cols = Math.max(3, Math.floor(len / 3));
  const winMat = cachedMat(`trWin|${s.win}|${cols}`, () => new THREE.MeshLambertMaterial({
    color: 0x9fc4dd, emissive: s.win, emissiveIntensity: 0.32,
    emissiveMap: windowsTex('#8fb8d4', '#ffffff', cols, 1),
  }));
  const wl = M(planeGeo(len * 0.86, 0.62), winMat, -1.06, 1.85, 0); wl.rotation.y = -Math.PI / 2;
  const wr = M(planeGeo(len * 0.86, 0.62), winMat, 1.06, 1.85, 0); wr.rotation.y = Math.PI / 2;
  g.add(wl, wr);
  g.add(M(boxGeo(2.05, 2.3, 1.1), bodyMat, 0, 1.4, len / 2 + 0.5));
  g.add(M(boxGeo(1.7, 0.7, 0.12), std(0x0b1220, 0x9fd8ff, 0.8, 0.3), 0, 2.2, len / 2 + 1.06));
  const h1 = sprite(0xfff2c0, 1.5, 0.95); h1.position.set(-0.62, 1.0, len / 2 + 1.1);
  const h2 = sprite(0xfff2c0, 1.5, 0.95); h2.position.set(0.62, 1.0, len / 2 + 1.1);
  g.add(h1, h2);
  g.add(M(boxGeo(0.18, 0.18, 0.06), lam(0xff3040), 0, 1.0, len / 2 + 1.08));
  return g;
}

// ── Препятствия: ПОЛ (низкие, обходятся сальтом/прыжком) ─────
export function makeFloorObstacle(loc: LocId): THREE.Group {
  const variant = loc === 'sunny' ? (Math.random() < 0.5 ? 0 : 1) : 0;
  return cachedPrefab(`floorOb|${loc}|${variant}`, () => {
    const g = new THREE.Group();
    if (loc === 'metro') {
      const haz = cachedMat('hazFloor', () => new THREE.MeshLambertMaterial({ map: hazardTex() }));
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
      g.add(M(boxGeo(1.9, 0.08, 1.15), std(0xd94f8a, 0xff6b9d, 0.25, 0.9), 0, 0.04, 0));
      const p1 = makePug(); p1.scale.setScalar(0.85); p1.position.set(-0.42, 0.06, 0); p1.rotation.z = Math.PI / 2 * 0.9; p1.rotation.y = 0.5;
      const p2 = makePug(); p2.scale.setScalar(0.75); p2.position.set(0.48, 0.06, 0.1); p2.rotation.z = -Math.PI / 2 * 0.85; p2.rotation.y = -0.8;
      g.add(p1, p2);
    } else {
      if (variant === 0) {
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
  });
}

// ── Препятствия: ПОТОЛОК ───────────────────────────────────────
export function makeCeilObstacle(loc: LocId): THREE.Group {
  return cachedPrefab(`ceilOb|${loc}`, () => {
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
      const cols = [0xffd166, 0xff6b9d, 0x8be9fd];
      for (let i = 0; i < 3; i++) {
        const x = (i - 1) * 0.62;
        g.add(M(cylGeo(0.015, 0.015, 1.1, 4), lam(0x555), x, H - 0.55, 0));
        g.add(M(sphGeo(0.34, 10, 8), std(cols[i], cols[i], 0.25, 0.6, 0, false), x, H - 1.42, 0));
        g.add(M(boxGeo(0.2, 0.1, 0.08), std(0x3a2c22), x, H - 1.45, -0.3));
        g.add(M(boxGeo(0.1, 0.06, 0.05), std(0x1d1611), x - 0.07, H - 1.34, -0.31));
        g.add(M(boxGeo(0.1, 0.06, 0.05), std(0x1d1611), x + 0.07, H - 1.34, -0.31));
      }
    }
    return g;
  });
}

/** БАРЬЕР ДЛЯ КУВЫРКА — проезжаем под ним (низ на 1.3, верх 4.5) */
export function makeRollBar(loc: LocId, onCeiling = false): THREE.Group {
  const s = onCeiling ? -1 : 1;
  const base = onCeiling ? TUNNEL_H : 0;
  const g = cachedPrefab(`rollBar|${loc}|${onCeiling ? 1 : 0}`, () => {
    const fg = new THREE.Group();
    const cfg = LOCS[loc];
    const haz = cachedMat('hazRoll', () => new THREE.MeshLambertMaterial({
      map: hazardTex(3, 1), emissive: 0xf7c948, emissiveIntensity: 0.22,
    }));
    fg.add(M(boxGeo(2.1, 0.5, 0.36), haz, 0, base + s * 1.62, 0));
    fg.add(M(boxGeo(2.1, 0.34, 0.3), std(0x1c2230, 0, 0, 0.6, 0.35), 0, base + s * 2.15, 0));
    fg.add(M(boxGeo(2.14, 0.1, 0.4), lam(cfg.accent2), 0, base + s * 1.35, 0));
    for (let i = 0; i < 4; i++) {
      fg.add(M(boxGeo(0.12, 1.9, 0.12), std(0x2a3346, 0, 0, 0.7, 0.3), -0.8 + i * 0.53, base + s * 3.3, 0));
    }
    fg.add(M(boxGeo(2.15, 0.26, 0.3), std(0x1c2230, 0, 0, 0.6, 0.35), 0, base + s * 4.35, 0));
    fg.add(M(boxGeo(0.16, 1.4, 0.3), std(0x333c4f), -1.02, base + s * 0.7, 0));
    fg.add(M(boxGeo(0.16, 1.4, 0.3), std(0x333c4f), 1.02, base + s * 0.7, 0));
    return fg;
  });
  const sp = sprite(0xf7c948, 1.8, 0.55);
  sp.position.set(0, base + s * 1.62, 0.3);
  g.add(sp);
  return g;
}

/** Полноростовой блок — только смена дорожки */
export function makeBlock(loc: LocId): THREE.Group {
  return cachedPrefab(`block|${loc}`, () => {
    const g = new THREE.Group();
    const cfg = LOCS[loc];
    const haz = cachedMat(`hazBlk|${cfg.accent}`, () => new THREE.MeshLambertMaterial({
      map: hazardTex(1, 3), emissive: cfg.accent, emissiveIntensity: 0.1,
    }));
    g.add(M(boxGeo(2.0, TUNNEL_H, 1.2), haz, 0, TUNNEL_H / 2, 0));
    g.add(M(boxGeo(2.06, 0.18, 1.26), lam(cfg.accent2), 0, TUNNEL_H - 1.2, 0));
    g.add(M(boxGeo(2.06, 0.18, 1.26), lam(cfg.accent2), 0, 1.2, 0));
    return g;
  });
}

// ── Монетка (один запечённый меш + геометрия для InstancedMesh) ─
let coinGeoCache: THREE.BufferGeometry | null = null;
let coinMatCache: THREE.Material | null = null;

export function getCoinMeshData(): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  if (!coinGeoCache || !coinMatCache) {
    const tmp = new THREE.Group();
    const gold = std(0xf7c948, 0xffb300, 0.55, 0.3, 0.7, false);
    const c = M(cylGeo(0.3, 0.3, 0.07, 14), gold);
    c.rotation.x = Math.PI / 2;
    const rim = M(torGeo(0.3, 0.045), std(0xffe083, 0xffc93c, 0.55, 0.3, 0.7, false));
    tmp.add(c, rim);
    const baked = bakeGroup(tmp);
    const m = baked.children[0] as THREE.Mesh;
    coinGeoCache = m.geometry;
    coinMatCache = m.material as THREE.Material;
  }
  return { geometry: coinGeoCache, material: coinMatCache };
}

export function makeCoin(): THREE.Group {
  const { geometry, material } = getCoinMeshData();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometry, material));
  return g;
}

// ── ЗАМОК: препятствия ─────────────────────────────────────────
export function makeBush(): THREE.Group {
  return cachedPrefab('bush', () => {
    const g = new THREE.Group();
    const leaf = std(0x3d7a34, 0, 0, 0.95);
    const leaf2 = std(0x4f9440, 0, 0, 0.95);
    g.add(M(icoGeo(0.55, 0), leaf, -0.35, 0.5, 0));
    g.add(M(icoGeo(0.48, 0), leaf2, 0.35, 0.42, 0.1));
    g.add(M(icoGeo(0.42, 0), leaf, 0, 0.72, -0.15));
    g.add(M(sphGeo(0.07, 6, 5), lam(0xff8fb5), 0.3, 0.78, 0.15));
    g.add(M(sphGeo(0.06, 6, 5), lam(0xffe9a8), -0.25, 0.82, -0.05));
    return g;
  });
}

export function makeVase(): THREE.Group {
  return cachedPrefab('vase', () => {
    const g = new THREE.Group();
    g.add(M(vaseGeo(), std(0xb4653a, 0, 0, 0.75), 0, 0, 0));
    g.add(M(sphGeo(0.2, 8, 6), std(0x3d7a34), 0, 1.05, 0));
    g.add(M(sphGeo(0.08, 6, 5), lam(0xff6b9d), 0.12, 1.16, 0.08));
    g.add(M(sphGeo(0.07, 6, 5), lam(0xffd166), -0.1, 1.12, -0.06));
    return g;
  });
}

export function makeRailOb(): THREE.Group {
  return cachedPrefab('railOb', () => {
    const g = new THREE.Group();
    const white = std(0xe8ecf2, 0, 0, 0.65, 0.05);
    const gold = std(0xd9a520, 0xffc93c, 0.3, 0.4, 0.6);
    for (const x of [-0.85, 0, 0.85]) {
      g.add(M(cylGeo(0.05, 0.07, 1.0, 6), white, x, 0.5, 0));
      g.add(M(sphGeo(0.08, 6, 5), gold, x, 1.04, 0));
    }
    g.add(M(boxGeo(2.05, 0.09, 0.09), gold, 0, 0.98, 0));
    g.add(M(boxGeo(2.05, 0.06, 0.06), white, 0, 0.55, 0));
    return g;
  });
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
  const darkCol = new THREE.Color(color).multiplyScalar(0.6).getHex();
  const dark = std(darkCol, 0, 0, 0.85);
  const wingCol = new THREE.Color(color).multiplyScalar(0.85).getHex();
  const wingMat = cachedMat(`wing|${wingCol}`, () => new THREE.MeshLambertMaterial({
    color: wingCol, side: THREE.DoubleSide, flatShading: true,
  }));

  const body = M(sphGeo(0.85, 10, 8), skin, 0, 0, 0);
  body.scale.set(0.72, 0.68, 1.6);
  g.add(body);
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
  g.add(M(cylGeo(0.08, 0.1, 0.4, 5), dark, -0.35, -0.55, -0.5));
  g.add(M(cylGeo(0.08, 0.1, 0.4, 5), dark, 0.35, -0.55, -0.5));
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
  const coreMat = cachedMat('fireCore', () => new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
  const midMat = cachedMat('fireMid', () => new THREE.MeshBasicMaterial({
    color: 0xff8c1a, transparent: true, opacity: 0.75,
  }));
  const core = M(sphGeo(0.34, 8, 6), coreMat, 0, 0, 0);
  const mid = M(sphGeo(0.52, 8, 6), midMat, 0, 0, 0);
  g.add(mid, core);
  const halo = sprite(0xff7a1a, 2.6, 0.85);
  const halo2 = sprite(0xffd166, 1.7, 0.9);
  g.add(halo, halo2);
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
  const mat = cachedMat('fireWarnMat', () => new THREE.MeshBasicMaterial({
    color: 0xff4500, transparent: true, opacity: 0.65,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  const m = new THREE.Mesh(ringGeo(0.55, 0.95, 20), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.06;
  const ph = Math.random() * 3;
  m.userData.tick = (t: number) => {
    const s = 1 + Math.sin(t * 8 + ph) * 0.16;
    m.scale.set(s, s, s);
  };
  return m;
}

// ── МОПС ───────────────────────────────────────────────────────
export function makePug(): THREE.Group {
  const g = new THREE.Group();
  const tan = std(0xc9a06c, 0, 0, 0.95);
  const darkF = std(0x3a2c22, 0, 0, 0.95);
  const torso = M(boxGeo(0.56, 0.44, 0.82), tan, 0, 0.38, 0);
  g.add(torso);
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
  const tail = M(torGeo(0.09, 0.035), tan, 0, 0.6, 0.42);
  tail.rotation.set(0.3, 0.4, 0);
  g.add(tail);
  const phase = Math.random() * 10;
  g.userData.tick = (t: number) => {
    const b = Math.abs(Math.sin(t * 6 + phase)) * 0.05;
    torso.position.y = 0.38 + b;
    head.rotation.z = Math.sin(t * 5 + phase) * 0.08;
    tail.rotation.z = Math.sin(t * 9 + phase) * 0.4;
  };
  return g;
}

// ── Замок: вход, шипы, лестница ────────────────────────────────
export function makeSpikeField(w: number, len: number, color = 0x2b2d35): THREE.Group {
  return cachedPrefab(`spikes|${w}|${len}|${color}`, () => {
    const g = new THREE.Group();
    g.add(M(boxGeo(w, 0.14, len), std(color, 0, 0, 0.9), 0, 0.07, -len / 2));
    const spike = std(0x9ba3af, 0, 0, 0.5, 0.15);
    const rows = Math.max(6, Math.floor(len / 2));
    const cols = Math.max(5, Math.floor(w / 1.1));
    for (let rz = 0; rz < rows; rz++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = -w / 2 + 0.6 + cx * ((w - 1.2) / Math.max(1, cols - 1));
        const z = -0.8 - rz * ((len - 1.6) / Math.max(1, rows - 1));
        g.add(M(coneGeo(0.18, 0.55, 5), spike, x, 0.35, z));
      }
    }
    return g;
  });
}

/** Красная лестница/эстакада, уводящая с главной дороги на улицу замка */
export function makeCastleStairway(): THREE.Group {
  return cachedPrefab('castleStair', () => {
    const g = new THREE.Group();
    const red = std(0xa12336, 0, 0, 0.85);
    const trim = std(0xd9a520, 0xffc93c, 0.1, 0.5, 0.5);
    const dark = std(0x4a2130, 0, 0, 0.9);
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const x = -0.4 - t * 6.2;
      const y = 0.02 + t * 1.1;
      const z = -i * 2.2;
      g.add(M(boxGeo(3.2, 0.22, 2.4), red, x, y, z));
      g.add(M(boxGeo(3.3, 0.06, 2.5), trim, x, y + 0.14, z));
    }
    g.add(M(boxGeo(5.2, 0.24, 5.4), dark, -6.75, 1.16, -18));
    g.add(M(boxGeo(5.4, 0.08, 5.6), trim, -6.75, 1.32, -18));
    g.add(M(boxGeo(0.12, 0.9, 18.5), trim, -8.35, 0.8, -8.4));
    g.add(M(boxGeo(0.12, 0.9, 18.5), trim, -5.15, 0.8, -8.4));
    for (let i = 0; i < 8; i++) {
      const z = -i * 2.4;
      g.add(M(boxGeo(0.1, 0.8, 0.1), trim, -8.35, 0.48 + i * 0.13, z));
      g.add(M(boxGeo(0.1, 0.8, 0.1), trim, -5.15, 0.48 + i * 0.13, z));
    }
    return g;
  });
}

// ── Замок: стена на старой дороге ──────────────────────────────
export function makeCastleWall(len: number): THREE.Group {
  return cachedPrefab(`castleWall|${len}`, () => {
    const g = new THREE.Group();
    const stone = std(0xb9b3a4, 0, 0, 0.95);
    g.add(M(boxGeo(8.6, 5.6, len), stone, 0, 2.8, -len / 2));
    g.add(M(boxGeo(8.8, 0.7, len), std(0x9d9688, 0, 0, 0.9), 0, 5.85, -len / 2));
    for (let i = 0; i < 5; i++) {
      g.add(M(boxGeo(1.1, 0.85, 1.4), stone, 0, 6.5, -2.4 - i * 6.2));
    }
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
  });
}

// ── Замок: дворец ──────────────────────────────────────────────
export function makePalace(variant: 'keep' | 'tower' | 'wall'): THREE.Group {
  return cachedPrefab(`palace|${variant}`, () => {
    const g = new THREE.Group();
    const white = std(0xeef1f5, 0, 0, 0.85);
    const roof = std(0x3f74d6, 0, 0, 0.7);
    const gold = std(0xd9a520, 0xffc93c, 0.35, 0.35, 0.7);
    const winMat = cachedMat('palWin', () => new THREE.MeshLambertMaterial({
      color: 0x0c1420, emissive: 0xffd166, emissiveIntensity: 1.0,
      emissiveMap: windowsTex('#0c1420', '#ffd166', 3, 4),
    }));
    if (variant === 'keep') {
      g.add(M(boxGeo(7, 9, 9), white, 0, 4.5, 0));
      const roofM = M(coneGeo(5.4, 3.2, 4), roof, 0, 10.6, 0); roofM.rotation.y = Math.PI / 4; g.add(roofM);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(M(cylGeo(1.1, 1.3, 10.5, 8), white, sx * 3.9, 5.25, sz * 4.2));
        g.add(M(coneGeo(1.5, 2.8, 8), roof, sx * 3.9, 11.9, sz * 4.2));
        g.add(M(sphGeo(0.18, 6, 5), gold, sx * 3.9, 13.4, sz * 4.2));
      }
      for (let iy = 0; iy < 3; iy++) for (let iz = 0; iz < 3; iz++) {
        const w = M(planeGeo(0.7, 1.0), winMat, 3.52, 2.4 + iy * 2.4, -2.6 + iz * 2.6);
        w.rotation.y = Math.PI / 2;
        g.add(w);
      }
      g.add(M(boxGeo(0.3, 2.4, 1.8), std(0x5e4632, 0, 0, 0.9), 3.52, 1.2, 0));
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
  });
}

export function makeMoat(len: number): THREE.Group {
  const g = new THREE.Group();
  const water = cachedMat('moatWater', () => new THREE.MeshLambertMaterial({
    color: 0x1f6fc9, emissive: 0x2a86e8, emissiveIntensity: 0.25, transparent: true, opacity: 0.92,
  }));
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
  return cachedPrefab(`railRow|${len}`, () => {
    const g = new THREE.Group();
    const white = std(0xe8ecf2, 0, 0, 0.65, 0.05);
    const gold = std(0xd9a520, 0xffc93c, 0.25, 0.4, 0.6);
    g.add(M(boxGeo(0.1, 0.1, len), gold, 0, 0.98, -len / 2));
    g.add(M(boxGeo(0.07, 0.07, len), white, 0, 0.55, -len / 2));
    for (let i = 0; i <= Math.floor(len / 3); i++) {
      g.add(M(cylGeo(0.05, 0.07, 1.0, 6), white, 0, 0.5, -i * 3));
      if (i % 2 === 0) g.add(M(sphGeo(0.08, 6, 5), gold, 0, 1.05, -i * 3));
    }
    return g;
  });
}

// ── Ворота-разделитель локаций ─────────────────────────────────
export function makeGate(x0: number, x1: number, color: number): THREE.Group {
  return cachedPrefab(`gate|${x0}|${x1}|${color}`, () => {
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
  });
}

/** Стрелка-шеврон на земле (указывает влево при dir='left', т.е. в -x) */
export function makeArrow(dir: 'left' | 'right', color: number): THREE.Group {
  return cachedPrefab(`arrow|${dir}|${color}`, () => {
    const g = new THREE.Group();
    const m = cachedMat(`arr|${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const s = dir === 'left' ? 1 : -1;
    const a = M(boxGeo(1.25, 0.05, 0.32), m, -s * 0.05, 0, 0.28); a.rotation.y = -s * 0.885;
    const b = M(boxGeo(1.25, 0.05, 0.32), m, -s * 0.05, 0, -0.28); b.rotation.y = s * 0.885;
    g.add(a, b);
    return g;
  });
}

/** Баррикада на конце улицы замка */
export function makeBarricade(w: number): THREE.Group {
  const g = cachedPrefab(`barricade|${w}`, () => {
    const fg = new THREE.Group();
    const haz = cachedMat('hazBar', () => new THREE.MeshLambertMaterial({
      map: hazardTex(4, 1), emissive: 0xff5722, emissiveIntensity: 0.18,
    }));
    fg.add(M(boxGeo(w, 0.5, 0.4), haz, 0, 1.5, 0));
    fg.add(M(boxGeo(w, 0.5, 0.4), haz, 0, 2.3, 0));
    for (const x of [-w / 2 + 0.3, 0, w / 2 - 0.3]) {
      fg.add(M(boxGeo(0.2, 2.6, 0.3), std(0x2a2f3d), x, 1.3, 0));
    }
    return fg;
  });
  const s1 = sprite(0xff3040, 1.2, 0.9); s1.position.set(-w / 2 + 0.3, 2.85, 0);
  const s2 = sprite(0xff3040, 1.2, 0.9); s2.position.set(w / 2 - 0.3, 2.85, 0);
  g.add(s1, s2);
  return g;
}

// ── Облака, деревья, кусты-декор ───────────────────────────────
export function makeCloud(): THREE.Group {
  const v = Math.floor(Math.random() * 4);
  const g = cachedPrefab(`cloud|${v}`, () => {
    const fg = new THREE.Group();
    const m = std(0xffffff, 0, 0, 1, 0, false);
    const n = 3 + (v % 3);
    for (let i = 0; i < n; i++) {
      const s = M(sphGeo(1.3 + ((i + v) % 3) * 0.35, 7, 5), m, i * 1.45, ((i + v) % 2) * 0.25, ((i * 2 + v) % 3 - 1) * 0.3);
      s.scale.y = 0.55;
      fg.add(s);
    }
    return fg;
  });
  const sp = rand(0.3, 0.8);
  g.userData.tick = (_t: number, dt: number) => { g.position.x += sp * dt; if (g.position.x > 30) g.position.x = -40; };
  return g;
}

export function makeTree(): THREE.Group {
  return cachedPrefab('tree', () => {
    const g = new THREE.Group();
    g.add(M(cylGeo(0.14, 0.2, 1.4, 6), std(0x6b4a2b), 0, 0.7, 0));
    const leaf = std(0x3d7a34, 0, 0, 0.95);
    g.add(M(sphGeo(0.8, 8, 6), leaf, 0, 1.8, 0));
    g.add(M(sphGeo(0.55, 8, 6), std(0x4f9440), 0.45, 1.45, 0.2));
    g.add(M(sphGeo(0.5, 8, 6), leaf, -0.4, 1.5, -0.15));
    return g;
  });
}

// ── МОПС-СТРИТ: витрины, фонарики, флажки ─────────────────────
const STORE_WALLS = [0xfff2f8, 0xffe9d9, 0xf3f0ff, 0xfdf6e3];
const STORE_WORDS = ['МОПС', 'PUG', 'ЛАПА', 'ВКУСНО', 'DOG'];

export function makeStorefront(side: number, accent: number): THREE.Group {
  void accent;
  const v = Math.floor(Math.random() * 4);
  return cachedPrefab(`store|${side}|${v}`, () => {
    const g = new THREE.Group();
    const h = 5.6 + v * 0.55;
    const wallCol = STORE_WALLS[v];
    g.add(M(boxGeo(3.4, h, 12), std(wallCol, 0, 0, 0.9), side * 1.7, h / 2, 0));
    const winMat = cachedMat('storeWin', () => new THREE.MeshLambertMaterial({
      color: 0xcfe6f2, emissive: 0xffffff, emissiveIntensity: 0.18,
      emissiveMap: windowsTex('#bfd9e8', '#ffffff', 4, 5),
    }));
    g.add(M(boxGeo(0.12, h * 0.6, 10), winMat, -side * 0.02, h * 0.5, 0));
    g.add(M(boxGeo(3.6, 0.4, 12.4), std(0xffffff, 0, 0, 0.7), side * 1.7, h + 0.15, 0));
    const awnMat = cachedMat('storeAwn', () => new THREE.MeshLambertMaterial({ map: stripesTex('#ff6b9d', '#f7e9f2') }));
    const awn = M(boxGeo(1.7, 0.16, 8), awnMat, -side * 0.4, 2.9, 0);
    awn.rotation.z = side * 0.28;
    g.add(awn);
    const word = STORE_WORDS[v % STORE_WORDS.length];
    const signCol = v % 2 === 0 ? '#ffd166' : '#ff6b9d';
    const signMat = cachedMat(`signM|${word}|${signCol}`, () => new THREE.MeshBasicMaterial({
      map: signTex(word, signCol), transparent: true, depthWrite: false,
    }));
    const sign = new THREE.Mesh(planeGeo(3.0, 1.1), signMat);
    sign.position.set(-side * 0.12, 3.9, (v - 1.5) * 1.4);
    sign.rotation.y = -side * Math.PI / 2;
    g.add(sign);
    return g;
  });
}

export function makeLantern(): THREE.Group {
  const g = cachedPrefab('lantern', () => {
    const fg = new THREE.Group();
    fg.add(M(cylGeo(0.02, 0.02, 0.8, 4), lam(0x111418), 0, 0.4, 0));
    fg.add(M(boxGeo(0.34, 0.42, 0.34), std(0xffb96b, 0xffa64d, 0.9, 0.6), 0, -0.2, 0));
    fg.add(M(boxGeo(0.4, 0.08, 0.4), lam(0x111418), 0, 0.05, 0));
    const s = sprite(0xffb96b, 1.3, 0.55); s.position.set(0, -0.2, 0); fg.add(s);
    return fg;
  });
  const ph = Math.random() * 6;
  g.userData.tick = (t: number) => { g.rotation.z = Math.sin(t * 1.4 + ph) * 0.08; };
  return g;
}

export function makeBunting(): THREE.Group {
  return cachedPrefab('bunting', () => {
    const g = new THREE.Group();
    const cols = [0xff6b9d, 0xffd166, 0x8be9fd, 0xb388ff, 0x7CFC9A];
    for (let i = 0; i < 9; i++) {
      const x = -5.2 + i * 1.3;
      const f = M(coneGeo(0.22, 0.5, 4), std(cols[i % cols.length], cols[i % cols.length], 0.2, 0.9), x, -Math.sin((i / 8) * Math.PI) * 0.35 - 0.25, 0);
      f.rotation.x = Math.PI;
      g.add(f);
    }
    return g;
  });
}

// ── Лёд: кристаллы, сосульки ───────────────────────────────────
export function makeCrystalCluster(): THREE.Group {
  const v = Math.floor(Math.random() * 3);
  return cachedPrefab(`cryst|${v}`, () => {
    const g = new THREE.Group();
    const m = std(0x66d9ff, 0x00e5ff, 0.7, 0.3);
    for (let i = 0; i < 3; i++) {
      const idx = (i + v) % 3;
      const c = M(octGeo(0.38 + idx * 0.12), m, (i - 1) * 0.55, 0.35 + idx * 0.2, (idx - 1) * 0.35);
      c.rotation.set(idx * 0.35, idx * 1.1, i * 0.4);
      g.add(c);
    }
    const s = sprite(0x00e5ff, 2.2, 0.3); s.position.y = 0.6; g.add(s);
    return g;
  });
}

export function makeIcicle(): THREE.Group {
  const v = Math.floor(Math.random() * 3);
  return cachedPrefab(`icicle|${v}`, () => {
    const g = new THREE.Group();
    const m = std(0xbfeaff, 0x66d9ff, 0.3, 0.35);
    const c = M(coneGeo(0.2, 1.0 + v * 0.4, 6), m, 0, 0, 0);
    c.rotation.x = Math.PI;
    g.add(c);
    return g;
  });
}

// ── Каньон: скалы, кактусы, hoodoo ─────────────────────────────
const ROCK_COLS = [0x8a4f2c, 0x9d5c33, 0x74401f];

export function makeRockWall(): THREE.Group {
  const v = Math.floor(Math.random() * 4);
  return cachedPrefab(`rockWall|${v}`, () => {
    const g = new THREE.Group();
    const n = 2 + (v % 2);
    for (let i = 0; i < n; i++) {
      const col = ROCK_COLS[(i + v) % ROCK_COLS.length];
      const r = M(boxGeo(2.8 + ((i + v) % 2), 5.5 + ((i * 2 + v) % 4), 7 + ((i + v) % 3) * 2), std(col, 0, 0, 1), (i - 0.5) * 0.8, 2.6 + (i % 2) * 0.8, (i - 0.5) * 9 - (v - 1.5) * 2);
      r.rotation.y = ((v + i) % 3 - 1) * 0.12;
      g.add(r);
    }
    return g;
  });
}

export function makeCactus(): THREE.Group {
  return cachedPrefab('cactus', () => {
    const g = new THREE.Group();
    const m = std(0x3f7d3a, 0, 0, 0.9);
    g.add(M(cylGeo(0.22, 0.26, 2.0, 7), m, 0, 1.0, 0));
    const a1 = M(cylGeo(0.13, 0.15, 0.8, 6), m, 0.42, 1.25, 0); a1.rotation.z = -0.5;
    const a2 = M(cylGeo(0.13, 0.15, 0.7, 6), m, -0.4, 0.9, 0); a2.rotation.z = 0.5;
    g.add(a1, a2);
    g.add(M(sphGeo(0.09, 6, 5), lam(0xff8fb5), 0, 2.05, 0));
    return g;
  });
}

export function makeHoodoo(): THREE.Group {
  const v = Math.floor(Math.random() * 3);
  return cachedPrefab(`hoodoo|${v}`, () => {
    const g = new THREE.Group();
    const h = 3.6 + v * 0.9;
    g.add(M(cylGeo(0.55, 0.95, h, 7), std(0x9d5c33, 0, 0, 1), 0, h / 2 - 0.1, 0));
    const top = M(icoGeo(0.9), std(0x74401f, 0, 0, 1), 0, h + 0.2, 0);
    top.scale.y = 0.6;
    g.add(top);
    return g;
  });
}

// ── Метро: панели, колонны, балки ─────────────────────────────
const METRO_WALLS = [0xf2f4f8, 0xe9edf3, 0xf6f0e6, 0xeaf1f6];

export function makeBuilding(side: number, accent: number): THREE.Group {
  const v = Math.floor(Math.random() * 4);
  return cachedPrefab(`metroBld|${side}|${accent}|${v}`, () => {
    const g = new THREE.Group();
    const h = 7.5 + v * 1.4;
    const wallCol = METRO_WALLS[v];
    g.add(M(boxGeo(3, h, 26), std(wallCol, 0, 0, 0.9), side * 1.5, h / 2, 0));
    const glassMat = cachedMat('metroGlass', () => new THREE.MeshLambertMaterial({
      color: 0xbfe0f2, emissive: 0xdff2ff, emissiveIntensity: 0.25,
      emissiveMap: windowsTex('#a8cfe4', '#ffffff', 5, 8, 2, 1),
    }));
    g.add(M(boxGeo(0.14, h * 0.72, 24), glassMat, -side * 0.04, h * 0.46, 0));
    for (let i = 0; i < 5; i++) {
      g.add(M(boxGeo(0.2, h * 0.75, 0.22), std(0xffffff, 0, 0, 0.6), -side * 0.06, h * 0.46, -10 + i * 5));
    }
    g.add(M(boxGeo(3.3, 0.5, 26), std(0xffffff, 0, 0, 0.7), side * 1.5, h + 0.2, 0));
    g.add(M(boxGeo(0.16, 1.3 + (v % 2) * 0.6, 2.2 + (v % 3) * 0.6), std(accent, accent, 0.18, 0.7), -side * 0.06, 3.3 + v * 0.6, (v - 1.5) * 4));
    return g;
  });
}

export function makePillar(accent: number): THREE.Group {
  return cachedPrefab(`pillar|${accent}`, () => {
    const g = new THREE.Group();
    g.add(M(cylGeo(0.3, 0.4, TUNNEL_H, 10), std(0xeef1f5, 0, 0, 0.75), 0, TUNNEL_H / 2, 0));
    g.add(M(cylGeo(0.44, 0.44, 0.3, 10), std(0xdfe4ea, 0, 0, 0.8), 0, 0.15, 0));
    g.add(M(cylGeo(0.44, 0.44, 0.3, 10), std(0xdfe4ea, 0, 0, 0.8), 0, TUNNEL_H - 0.15, 0));
    g.add(M(boxGeo(0.72, 0.1, 0.72), std(accent, accent, 0.15, 0.7), 0, 2.4, 0));
    return g;
  });
}

// ── СОЛНЕЧНЫЙ ПАССАЖ ──────────────────────────────────────────
const SUNNY_WALLS = [0xf7f1e4, 0xffe9d6, 0xf3e3ef, 0xe7f2f7];

export function makeSunnyBuilding(side: number): THREE.Group {
  const v = Math.floor(Math.random() * 4);
  return cachedPrefab(`sunnyBld|${side}|${v}`, () => {
    const g = new THREE.Group();
    const h = 7.6 + v * 0.7;
    const wall = std(SUNNY_WALLS[v], 0, 0, 0.9);
    g.add(M(boxGeo(3.4, h, 26), wall, side * 1.7, h / 2, 0));
    const winMat = std(0x8fd6f2, 0x6fc4e8, 0.35, 0.25, 0.4);
    for (let i = 0; i < 4; i++) {
      const z = -9 + i * 6;
      for (const y of [2.4, 5.0]) {
        g.add(M(boxGeo(0.12, 1.3, 1.5), winMat, -side * 0.02, y, z));
        g.add(M(boxGeo(0.26, 0.1, 1.8), std(0xffffff, 0, 0, 0.7), -side * 0.1, y - 0.72, z));
        for (let k = 0; k < 5; k++) {
          g.add(M(cylGeo(0.02, 0.02, 0.4, 4), std(0xd8dde4), -side * 0.16, y - 0.5, z - 0.7 + k * 0.35));
        }
        g.add(M(sphGeo(0.12, 6, 5), std(0xff6f91, 0xff6f91, 0.15, 0.9), -side * 0.16, y - 0.52, z + ((i + v) % 3 - 1) * 0.35));
      }
    }
    const awnMat = cachedMat('sunnyAwn', () => new THREE.MeshLambertMaterial({
      map: stripesTex('#ff7043', '#fff6e8'), side: THREE.DoubleSide,
    }));
    const awn = M(boxGeo(1.8, 0.14, 9), awnMat, -side * 0.6, 3.0, (v - 1.5) * 2.2);
    awn.rotation.z = side * 0.3;
    g.add(awn);
    return g;
  });
}

/** Стеклянная крыша-пассаж: лёгкий прозрачный материал без дорогого transmission-рендерпасса */
export function makeGlassRoof(len: number): THREE.Group {
  return cachedPrefab(`glassRoof|${len}`, () => {
    const g = new THREE.Group();
    const glass = cachedMat('glassRoofMat', () => new THREE.MeshLambertMaterial({
      color: 0xd9f2ff, emissive: 0x99d9f7, emissiveIntensity: 0.18,
      transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
    }));
    const p = M(planeGeo(12, len), glass, 0, TUNNEL_H, -len / 2);
    p.rotation.x = Math.PI / 2;
    g.add(p);
    const frame = std(0xf5f7fa, 0, 0, 0.6, 0.2);
    for (let i = 0; i <= len / 3; i++) {
      g.add(M(boxGeo(12, 0.16, 0.16), frame, 0, TUNNEL_H - 0.08, -i * 3));
    }
    g.add(M(boxGeo(0.2, 0.2, len), frame, -2.3, TUNNEL_H - 0.08, -len / 2));
    g.add(M(boxGeo(0.2, 0.2, len), frame, 2.3, TUNNEL_H - 0.08, -len / 2));
    return g;
  });
}

/** Застеклённый световой фонарь в потолке */
export function makeSkylight(len: number): THREE.Group {
  return cachedPrefab(`skylight|${len}`, () => {
    const g = new THREE.Group();
    const glass = cachedMat('skylightGlass', () => new THREE.MeshLambertMaterial({
      color: 0xeef6ff, emissive: 0xfff8e6, emissiveIntensity: 0.16,
      transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    }));
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
  });
}

/** Столбы солнечного света сквозь крышу */
export function makeSunShaft(): THREE.Mesh {
  const mat = cachedMat('sunShaftMat', () => new THREE.MeshBasicMaterial({
    color: 0xfff4d6, transparent: true, opacity: 0.055,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const m = new THREE.Mesh(cylGeo(0.9, 2.4, TUNNEL_H + 1, 8), mat);
  m.position.y = TUNNEL_H / 2;
  m.rotation.z = 0.16;
  return m;
}

export function makePalm(): THREE.Group {
  return cachedPrefab('palm', () => {
    const g = new THREE.Group();
    const trunk = std(0xa8865c, 0, 0, 0.95);
    for (let i = 0; i < 6; i++) {
      g.add(M(cylGeo(0.14 - i * 0.012, 0.17 - i * 0.012, 0.5, 7), trunk, Math.sin(i * 0.5) * 0.1, 0.25 + i * 0.48, 0));
    }
    const leaf = cachedMat('palmLeaf', () => new THREE.MeshLambertMaterial({
      color: 0x3fa14a, side: THREE.DoubleSide, flatShading: true,
    }));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const l = new THREE.Mesh(planeGeo(0.42, 2.0), leaf);
      l.position.set(Math.cos(a) * 0.78, 3.1, Math.sin(a) * 0.78);
      l.rotation.set(-1.0, -a, 0.25);
      g.add(l);
    }
    g.add(M(sphGeo(0.13, 6, 5), std(0xc98f3a), 0.2, 2.9, 0.1));
    return g;
  });
}

export function makeStreetLamp(): THREE.Group {
  return cachedPrefab('streetLamp', () => {
    const g = new THREE.Group();
    g.add(M(cylGeo(0.07, 0.11, 3.6, 8), std(0x3a4453, 0, 0, 0.6, 0.4), 0, 1.8, 0));
    g.add(M(boxGeo(0.1, 0.1, 0.7), std(0x3a4453), 0, 3.55, -0.3));
    g.add(M(sphGeo(0.22, 8, 6), std(0xfff6d6, 0xfff0b8, 1.4, 0.3), 0, 3.45, -0.6));
    const s = sprite(0xfff0b8, 2.0, 0.45); s.position.set(0, 3.45, -0.6);
    g.add(s);
    return g;
  });
}

export function makeBench(): THREE.Group {
  return cachedPrefab('bench', () => {
    const g = new THREE.Group();
    const wood = std(0xb5813f, 0, 0, 0.9);
    for (let i = 0; i < 3; i++) g.add(M(boxGeo(1.5, 0.08, 0.16), wood, 0, 0.45, -0.2 + i * 0.2));
    for (let i = 0; i < 3; i++) g.add(M(boxGeo(1.5, 0.16, 0.08), wood, 0, 0.62 + i * 0.2, 0.22));
    g.add(M(boxGeo(0.1, 0.45, 0.5), std(0x39424f, 0, 0, 0.6, 0.4), -0.62, 0.22, 0));
    g.add(M(boxGeo(0.1, 0.45, 0.5), std(0x39424f, 0, 0, 0.6, 0.4), 0.62, 0.22, 0));
    return g;
  });
}

export function makeFountain(): THREE.Group {
  const g = cachedPrefab('fountain', () => {
    const fg = new THREE.Group();
    const stone = std(0xe4dccb, 0, 0, 0.9);
    fg.add(M(cylGeo(1.5, 1.6, 0.5, 14), stone, 0, 0.25, 0));
    const water = cachedMat('fountWater', () => new THREE.MeshLambertMaterial({
      color: 0x53c1f0, emissive: 0x2f9fd6, emissiveIntensity: 0.3, transparent: true, opacity: 0.85,
    }));
    const w = M(planeGeo(2.6, 2.6), water, 0, 0.52, 0); w.rotation.x = -Math.PI / 2;
    fg.add(w);
    fg.add(M(cylGeo(0.18, 0.28, 1.1, 10), stone, 0, 1.0, 0));
    fg.add(M(cylGeo(0.75, 0.2, 0.2, 12), stone, 0, 1.55, 0));
    return fg;
  });
  const jet = sprite(0xd6f3ff, 1.7, 0.55); jet.position.set(0, 2.0, 0);
  g.add(jet);
  const ph = Math.random() * 5;
  g.userData.tick = (t: number) => { jet.position.y = 2.0 + Math.sin(t * 3 + ph) * 0.12; };
  return g;
}

export function makeCeilLight(color: number): THREE.Group {
  return cachedPrefab(`ceilLight|${color}`, () => {
    const g = new THREE.Group();
    g.add(M(boxGeo(4.6, 0.1, 0.44), std(0xfffdf5, color, 0.65, 0.4), 0, 0, 0));
    g.add(M(boxGeo(4.8, 0.12, 0.6), std(0xd8dee6, 0, 0, 0.6, 0.3), 0, 0.1, 0));
    const s = sprite(color, 2.2, 0.1); g.add(s);
    return g;
  });
}
