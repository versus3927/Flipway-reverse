import * as THREE from 'three';
import {
  CHUNK, GEN_AHEAD, LANES, CASTLE_LANES, CASTLE_SHIFT, TUNNEL_H,
  LocId, LOCS, LOC_LIST, MoveMode, rand, irand, pick, shuffle,
} from './config';
import * as MX from './meshes';
import { cobbleTex } from './textures';

export interface Collider {
  x: number; z: number; w: number; half: number;
  /** Смещение центра коллайдера по Z относительно z (для поездов с несимметричным носом) */
  zOff?: number;
  y0: number; y1: number;
  obj?: THREE.Object3D | null;
  vx?: number; vz?: number;
  /** На крышу можно запрыгнуть (поезда) */
  rideable?: boolean;
  /** Высота крыши для приземления */
  top?: number;
}
export interface CoinRef { x: number; y: number; z: number; rotY: number; taken: boolean; }
export interface GameEvent { z: number; type: 'loc' | 'preCastle' | 'mode' | 'exitCastle'; loc?: LocId; mode?: MoveMode; }

interface Chunk { node: THREE.Group; z0: number; }
interface Extra { obj: THREE.Object3D; z0: number; }
interface VisMover { obj: THREE.Object3D; vz: number; }
interface Segment { zTop: number; zBot: number; loc: LocId; }

const TRAIN_SCHEMES: Record<string, MX.TrainScheme> = {
  metro:  { body: 0xeef2f7, roof: 0xc3ccd8, stripe: 0x1ab6e0, win: 0xdff2ff },
  canyon: { body: 0x8c6438, roof: 0x644820, stripe: 0xf4511e, win: 0xfff0d0, kind: 'minecart' },
  ice:    { body: 0xdcf0ff, roof: 0xa4cee2, stripe: 0x00b8d4, win: 0xf2fbff, kind: 'slede' },
  pugs:   { body: 0xf7d0e8, roof: 0xe0a8cc, stripe: 0xf0578f, win: 0xfff4de, kind: 'pugcart' },
  castle: { body: 0x8a7868, roof: 0x6b5c4c, stripe: 0xd9a520, win: 0xfff2c0, kind: 'chariot' },
  sunny:  { body: 0xffe6c4, roof: 0xff7043, stripe: 0x29b6f6, win: 0xfff6e0, kind: 'van' },
};
const FLOOR_H: Record<string, number> = { metro: 1.16, canyon: 1.15, ice: 1.3, pugs: 0.8, sunny: 1.1 };
const FLOOR_HALF: Record<string, number> = { metro: 0.35, canyon: 0.55, ice: 0.55, pugs: 0.6, sunny: 0.55 };

/** Барьер для кувырка: низ 1.3 → выше роста, но кувырок (0.78) проходит. Верх барьера 4.5 */
const ROLLBAR_Y0 = 1.3;
const ROLLBAR_Y1 = 4.5;
/** Высота крыши стандартного поезда */
export const TRAIN_TOP = 2.95;

const MAX_COINS = 380;
const groundCache = new Map<LocId, THREE.Group>();

export class World {
  root = new THREE.Group();
  colliders: Collider[] = [];
  coins: CoinRef[] = [];
  diff = 0;
  genAhead = GEN_AHEAD;
  shadows = false;

  private chunks: Chunk[] = [];
  private extras: Extra[] = [];
  private animated: { obj: THREE.Object3D; z0: number }[] = [];
  private visMovers: VisMover[] = [];
  private events: GameEvent[] = [];
  private segments: Segment[] = [];

  private coinMesh!: THREE.InstancedMesh;
  private coinMat4 = new THREE.Matrix4();

  // ── мопсы, бегущие рядом с игроком ──
  private pugPack: { obj: THREE.Group; lane: number; off: number; phase: number; side: number }[] = [];
  private packOn = false;
  // ── огненные снаряды драконов ──
  fireballs: { obj: THREE.Group; x: number; y: number; z: number; vz: number; vx: number; vy: number; warn?: THREE.Mesh }[] = [];

  private genLoc: LocId = 'metro';
  private nextLoc: LocId = 'canyon';
  private segLeft = 540;
  private genZ = 6;
  private bag: LocId[] = [];
  private palaceIdx = 0;
  private safeChunks = 2;

  constructor(private scene: THREE.Scene) {
    scene.add(this.root);
    this.initCoinsMesh();
    this.reset();
  }

  private initCoinsMesh() {
    const { geometry, material } = MX.getCoinMeshData();
    this.coinMesh = new THREE.InstancedMesh(geometry, material, MAX_COINS);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    this.coinMesh.visible = false;
    this.root.add(this.coinMesh);
  }

  reset() {
    this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.initCoinsMesh();
    this.colliders = []; this.coins = []; this.chunks = [];
    this.extras = []; this.animated = []; this.visMovers = []; this.events = [];
    this.pugPack = []; this.packOn = false;
    this.fireballs = [];
    this.boss = null; this.bossLunge = 0;
    this.genLoc = 'metro';
    this.bag = shuffle(LOC_LIST.filter((l) => l !== 'metro'));
    this.nextLoc = this.bag.pop()!;
    this.segLeft = 540;
    this.genZ = 6;
    this.segments = [{ zTop: 120, zBot: 6 - 540, loc: 'metro' }];
    this.palaceIdx = 0;
    this.safeChunks = 2;
    this.diff = 0;
  }

  locAt(z: number): LocId {
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      if (z <= s.zTop && z >= s.zBot) return s.loc;
    }
    return this.genLoc;
  }

  // ──────────────────────────── update ────────────────────────────
  update(dt: number, pz: number, t: number, speed = 0) {
    this.updatePugPack(dt, pz, t, speed);
    this.updateFireballs(dt, pz, t);
    this.updateBoss(dt, pz, t);
    // генерация вперёд
    while (this.genZ > pz - this.genAhead) this.genChunk();
    // переработка чанков
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (c.z0 > pz + 30) {
        this.root.remove(c.node);
        this.chunks.splice(i, 1);
      }
    }
    for (let i = this.extras.length - 1; i >= 0; i--) {
      if (this.extras[i].z0 > pz + 40) {
        this.root.remove(this.extras[i].obj);
        this.extras.splice(i, 1);
      }
    }
    for (let i = this.segments.length - 1; i >= 0; i--) {
      if (this.segments[i].zBot > pz + 120) this.segments.splice(i, 1);
    }
    // анимации статиков
    for (let i = this.animated.length - 1; i >= 0; i--) {
      const a = this.animated[i];
      if (a.z0 > pz + 35) { this.animated.splice(i, 1); continue; }
      a.obj.userData.tick?.(t, dt);
    }
    // визуальные движущиеся (побочные поезда, драконы на фоне)
    for (let i = this.visMovers.length - 1; i >= 0; i--) {
      const v = this.visMovers[i];
      v.obj.position.z += v.vz * dt;
      v.obj.userData.tick?.(t, dt);
      if (v.obj.position.z > pz + 45 || v.obj.position.z < pz - this.genAhead - 100) {
        this.root.remove(v.obj);
        this.visMovers.splice(i, 1);
      }
    }
    // движущиеся опасности (встречки, поезда)
    for (let i = this.colliders.length - 1; i >= 0; i--) {
      const c = this.colliders[i];
      if (c.obj && (c.vx || c.vz)) {
        c.z += (c.vz ?? 0) * dt;
        c.x += (c.vx ?? 0) * dt;
        c.obj.position.z = c.z;
        c.obj.position.x = c.x;
        c.obj.userData.tick?.(t, dt);
        if (c.vx && Math.abs(c.x) > 14) {
          this.root.remove(c.obj);
          this.colliders.splice(i, 1);
          continue;
        }
      }
      const cz = c.z + (c.zOff ?? 0);
      if (cz - c.half > pz + 30) {
        if (c.obj) this.root.remove(c.obj);
        this.colliders.splice(i, 1);
      }
    }
    // монетки — обновляем 1 InstancedMesh за 1 draw-call
    let activeCoins = 0;
    const m = this.coinMat4;
    const e = m.elements;
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const cn = this.coins[i];
      if (cn.z > pz + 18 || cn.taken) { this.coins.splice(i, 1); continue; }
      cn.rotY += dt * 3.2;
      if (activeCoins < MAX_COINS) {
        const c = Math.cos(cn.rotY);
        const s = Math.sin(cn.rotY);
        e[0] = c;  e[4] = 0; e[8] = s;   e[12] = cn.x;
        e[1] = 0;  e[5] = 1; e[9] = 0;   e[13] = cn.y;
        e[2] = -s; e[6] = 0; e[10] = c;  e[14] = cn.z;
        e[3] = 0;  e[7] = 0; e[11] = 0;  e[15] = 1;
        this.coinMesh.setMatrixAt(activeCoins, m);
        activeCoins++;
      }
    }
    this.coinMesh.count = activeCoins;
    this.coinMesh.visible = activeCoins > 0;
    if (activeCoins > 0) this.coinMesh.instanceMatrix.needsUpdate = true;
  }

  // ═══ СТАЯ МОПСОВ, БЕГУЩАЯ РЯДОМ С ИГРОКОМ ═══
  setPugPack(on: boolean) {
    if (on === this.packOn) return;
    this.packOn = on;
    if (!on) {
      for (const p of this.pugPack) this.root.remove(p.obj);
      this.pugPack = [];
      return;
    }
    const slots = [
      { lane: 0, off: -3.5, side: 0 }, { lane: 2, off: -2.2, side: 0 },
      { lane: 0, off: 4.5, side: 0 }, { lane: 2, off: 5.2, side: 0 },
      { lane: 1, off: 7.0, side: 0 }, { lane: 1, off: -6.0, side: 0 },
      { lane: 0, off: 0.5, side: -1 }, { lane: 2, off: 1.2, side: 1 },
    ];
    for (const s of slots) {
      const pug = MX.makePug();
      pug.scale.setScalar(rand(0.72, 1.0));
      this.markShadow(pug);
      this.root.add(pug);
      this.pugPack.push({ obj: pug, lane: s.lane, off: s.off, phase: Math.random() * 9, side: s.side });
    }
  }

  private updatePugPack(dt: number, pz: number, t: number, speed: number) {
    if (!this.packOn) return;
    for (const p of this.pugPack) {
      if (Math.random() < dt * 0.35) p.lane = irand(0, 2);
      const targetX = p.side !== 0
        ? p.side * 4.5
        : LANES[p.lane] + Math.sin(t * 1.3 + p.phase) * 0.35;
      p.obj.position.x += (targetX - p.obj.position.x) * Math.min(1, dt * 3.2);
      const targetZ = pz + p.off + Math.sin(t * 0.9 + p.phase) * 1.4;
      p.obj.position.z += (targetZ - p.obj.position.z) * Math.min(1, dt * 2.6);
      const gallop = Math.abs(Math.sin(t * (7 + speed * 0.12) + p.phase));
      p.obj.position.y = gallop * 0.24;
      p.obj.rotation.z = Math.sin(t * 6 + p.phase) * 0.09;
      p.obj.rotation.y = Math.sin(t * 1.1 + p.phase) * 0.14;
      p.obj.userData.tick?.(t, dt);
      if (p.side !== 0) p.obj.rotation.y = (p.side > 0 ? -1 : 1) * Math.PI / 2 * 0.55;
    }
  }

  // ═══ ДРАКОН-ПРЕСЛЕДОВАТЕЛЬ ═══
  private boss: THREE.Group | null = null;
  private bossLunge = 0;

  setBossDragon(on: boolean) {
    if (on && !this.boss) {
      const d = MX.makeDragon(0xc62828, 1.5);
      d.rotation.y = Math.PI;
      this.markShadow(d);
      this.root.add(d);
      this.boss = d;
    } else if (!on && this.boss) {
      this.root.remove(this.boss);
      this.boss = null;
    }
  }

  /** Анимация броска при выдохе огня */
  bossAttack() { this.bossLunge = 1; }

  private updateBoss(dt: number, pz: number, t: number) {
    if (!this.boss) return;
    const d = this.boss;
    if (this.bossLunge > 0) this.bossLunge = Math.max(0, this.bossLunge - dt * 1.6);
    const lunge = Math.sin(this.bossLunge * Math.PI) * 4;
    const tx = CASTLE_SHIFT + Math.sin(t * 0.55) * 4.5;
    const ty = 7.2 + Math.sin(t * 0.8) * 1.3 - lunge * 0.5;
    const tz = pz - 34 + lunge * 7 + Math.sin(t * 0.4) * 5;
    d.position.x += (tx - d.position.x) * Math.min(1, dt * 2.2);
    d.position.y += (ty - d.position.y) * Math.min(1, dt * 2.2);
    d.position.z += (tz - d.position.z) * Math.min(1, dt * 2.6);
    d.rotation.z = Math.cos(t * 0.55) * 0.3;
    d.rotation.x = -this.bossLunge * 0.3;
    d.userData.tick?.(t, dt);
  }

  // ═══ ОГНЕННЫЕ АТАКИ ДРАКОНОВ ═══
  spawnFireball(pz: number, lane: number, fromSky: boolean): void {
    const targetX = CASTLE_LANES[lane];
    const fb = MX.makeFireball();
    const startZ = pz - rand(58, 78);
    const startY = fromSky ? rand(7.5, 10) : rand(1.6, 2.3);
    const startX = fromSky ? targetX + rand(-2.5, 2.5) : targetX;
    fb.position.set(startX, startY, startZ);
    this.root.add(fb);
    const travel = 2.1;
    const vz = (pz - startZ) / travel + 18;
    const vy = fromSky ? (1.4 - startY) / travel : rand(-0.1, 0.1);
    const vx = (targetX - startX) / travel;
    const warn = MX.makeFireWarn();
    warn.position.set(targetX, 0.06, pz - 26);
    this.root.add(warn);
    this.animated.push({ obj: warn, z0: pz });
    this.fireballs.push({ obj: fb, x: startX, y: startY, z: startZ, vz, vx, vy, warn });
  }

  private updateFireballs(dt: number, pz: number, t: number) {
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.z += f.vz * dt;
      f.x += f.vx * dt;
      f.y = Math.max(0.75, f.y + f.vy * dt);
      f.obj.position.set(f.x, f.y, f.z);
      f.obj.userData.tick?.(t, dt);
      if (f.warn) {
        f.warn.position.set(f.x, 0.06, Math.min(pz + 4, f.z + 14));
        f.warn.userData.tick?.(t, dt);
      }
      if (f.z > pz + 14) {
        this.root.remove(f.obj);
        if (f.warn) this.root.remove(f.warn);
        this.fireballs.splice(i, 1);
      }
    }
  }

  clearFire() {
    for (const f of this.fireballs) {
      this.root.remove(f.obj);
      if (f.warn) this.root.remove(f.warn);
    }
    this.fireballs = [];
  }

  pollEvents(pz: number): GameEvent[] {
    const fired: GameEvent[] = [];
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (pz <= this.events[i].z) {
        fired.unshift(this.events[i]);
        this.events.splice(i, 1);
      }
    }
    return fired;
  }

  /** Перебазировка координат, чтобы не уплыть по точности float */
  shift(dz: number) {
    this.genZ += dz;
    for (const c of this.chunks) { c.z0 += dz; c.node.position.z += dz; }
    for (const e of this.extras) { e.z0 += dz; e.obj.position.z += dz; }
    for (const a of this.animated) a.z0 += dz;
    for (const v of this.visMovers) v.obj.position.z += dz;
    for (const c of this.colliders) {
      c.z += dz;
      if (c.obj) c.obj.position.z += dz;
    }
    for (const cn of this.coins) cn.z += dz;
    for (const e of this.events) e.z += dz;
    for (const s of this.segments) { s.zTop += dz; s.zBot += dz; }
    for (const p of this.pugPack) p.obj.position.z += dz;
    for (const f of this.fireballs) { f.z += dz; f.obj.position.z += dz; if (f.warn) f.warn.position.z += dz; }
    if (this.boss) this.boss.position.z += dz;
  }

  // ──────────────────────────── чанки ────────────────────────────
  private genChunk() {
    if (this.segLeft <= 0) this.startSegment(this.genZ);
    const loc = this.genLoc;
    const z0 = this.genZ;
    const node = new THREE.Group();
    node.position.z = z0;
    this.buildGround(node, loc);
    this.buildDecor(node, loc, z0);

    // За 90м до замка очищаем тоннельные препятствия, чтобы игрок спокойно съехал по лестнице
    const preCastleClear = loc !== 'castle' && this.nextLoc === 'castle' && this.segLeft <= 90;
    if (loc === 'castle') this.buildCastleHazards(node, z0);
    else if (!preCastleClear) this.buildTunnelHazards(node, z0, loc);

    this.root.add(node);
    this.chunks.push({ node, z0 });
    this.genZ -= CHUNK;
    this.segLeft -= CHUNK;
    if (this.safeChunks > 0) this.safeChunks--;
  }

  private startSegment(zB: number) {
    const prev = this.genLoc;
    const next = this.nextLoc;
    if (this.bag.length === 0) {
      this.bag = shuffle(LOC_LIST.filter((l) => l !== next));
    }
    this.nextLoc = this.bag.pop()!;
    this.genLoc = next;
    this.segLeft = CHUNK * irand(15, 22);
    this.segments.push({ zTop: zB, zBot: zB - this.segLeft, loc: next });

    const cfg = LOCS[next];
    const gate = MX.makeGate(
      next === 'castle' ? CASTLE_LANES[0] - 1.4 : -5.4,
      next === 'castle' ? CASTLE_LANES[2] + 1.4 : 5.4,
      cfg.accent
    );
    gate.position.z = zB;
    this.root.add(gate);
    this.extras.push({ obj: gate, z0: zB });

    this.events.push({ z: zB, type: 'loc', loc: next });

    if (next === 'castle') {
      this.events.push({ z: zB + 85, type: 'preCastle' });

      // ── ШИПЫ на основных 3 дорожках (не заходят на CASTLE_LANES[2] = -4.6) ──
      for (const zz of [zB + 52, zB + 30, zB + 8]) {
        const sp = MX.makeSpikeField(6.4, 20);
        sp.position.set(0.4, 0, zz);
        this.markShadow(sp);
        this.root.add(sp);
        this.extras.push({ obj: sp, z0: zz });
        this.colliders.push({ x: 0.4, z: zz - 10, w: 6.4, half: 10, y0: 0, y1: 1.2 });
      }

      // ── ВЫСОКАЯ СТЕНА (меш и коллайдер строго совпадают: x=[-3.0, +6.4], z=[zB, zB-75]) ──
      const wallBlock = MX.M(
        MX.boxGeo(9.4, 7.5, 75),
        MX.std(0xa09484, 0, 0, 0.95),
        1.7, 3.75, zB - 37.5
      );
      this.root.add(wallBlock);
      this.extras.push({ obj: wallBlock, z0: zB });
      this.colliders.push({ x: 1.7, z: zB - 37.5, w: 9.4, half: 37.5, y0: 0, y1: 7.5 });

      // ── КРАСНАЯ ЛЕСТНИЦА ──
      const stair = MX.makeCastleStairway();
      stair.position.set(0, 0, zB + 68);
      this.root.add(stair);
      this.extras.push({ obj: stair, z0: zB + 68 });

      for (const zz of [zB + 74, zB + 60, zB + 46]) {
        for (const lx of LANES) {
          const ar = MX.makeArrow('left', LOCS.castle.accent);
          ar.position.set(lx, 0.07, zz);
          this.root.add(ar);
          this.extras.push({ obj: ar, z0: zz });
        }
      }

      this.events.push({ z: zB, type: 'mode', mode: 'jump' });
    }
    if (prev === 'castle') {
      this.safeChunks = Math.max(this.safeChunks, 3);
      this.events.push({ z: zB, type: 'exitCastle' });
      for (const zz of [zB - 4, zB - 20, zB - 36]) {
        for (const lx of CASTLE_LANES) {
          const ar = MX.makeArrow('right', 0xffffff);
          ar.position.set(lx, 0.07, zz);
          this.root.add(ar);
          this.extras.push({ obj: ar, z0: zz });
        }
      }
      const bar = MX.makeBarricade(7.9);
      bar.position.set(-6.9, 0, zB - 56);
      this.markShadow(bar);
      this.root.add(bar);
      this.extras.push({ obj: bar, z0: zB - 56 });
      this.colliders.push({ x: -6.9, z: zB - 56, w: 8.2, half: 0.5, y0: 0, y1: 6.6 });
    }
  }

  // ──────────────────────────── земля (кэшированная) ────────────
  private buildGround(node: THREE.Group, loc: LocId) {
    let tmpl = groundCache.get(loc);
    if (!tmpl) {
      const cfg = LOCS[loc];
      const isCastle = loc === 'castle';
      const raw = new THREE.Group();

      const mkFloor = (y: number, isCeil: boolean) => {
        const g = MX.M(MX.planeGeo(32, CHUNK), MX.std(isCeil ? cfg.ceiling : cfg.ground, 0, 0, 0.9), 0, y, -CHUNK / 2);
        g.rotation.x = isCeil ? Math.PI / 2 : -Math.PI / 2;
        raw.add(g);

        const glowMat = MX.std(cfg.laneGlow, cfg.laneGlow, 0.2, 0.6);
        raw.add(MX.M(MX.boxGeo(0.12, 0.04, CHUNK), glowMat, -1.15, y + (isCeil ? -0.02 : 0.02), -CHUNK / 2));
        raw.add(MX.M(MX.boxGeo(0.12, 0.04, CHUNK), glowMat, 1.15, y + (isCeil ? -0.02 : 0.02), -CHUNK / 2));

        if (!isCastle) {
          raw.add(MX.M(MX.boxGeo(0.5, 0.3, CHUNK), MX.std(cfg.ground2), -5.2, y + (isCeil ? -0.15 : 0.15), -CHUNK / 2));
          raw.add(MX.M(MX.boxGeo(0.5, 0.3, CHUNK), MX.std(cfg.ground2), 5.2, y + (isCeil ? -0.15 : 0.15), -CHUNK / 2));
        }
      };

      if (isCastle) {
        const cob = MX.cachedMat('castleCobble', () => new THREE.MeshLambertMaterial({
          map: cobbleTex('#a89f8c', '#7d7462', 2, 8),
        }));
        const st = MX.M(MX.planeGeo(7.7, CHUNK), cob, -6.975, 0, -CHUNK / 2);
        st.rotation.x = -Math.PI / 2;
        raw.add(st);
        raw.add(MX.M(MX.boxGeo(0.1, 0.03, CHUNK), MX.lam(cfg.laneGlow), -8.05, 0.02, -CHUNK / 2));
        raw.add(MX.M(MX.boxGeo(0.1, 0.03, CHUNK), MX.lam(cfg.laneGlow), -5.75, 0.02, -CHUNK / 2));
      } else {
        mkFloor(0, false);
        if (cfg.hasCeiling) mkFloor(TUNNEL_H, true);
      }
      tmpl = MX.bakeGroup(raw);
      groundCache.set(loc, tmpl);
    }
    const g = tmpl.clone();
    if (this.shadows) {
      for (const ch of g.children) {
        const m = ch as THREE.Mesh;
        if (m.isMesh) m.receiveShadow = true;
      }
    }
    node.add(g);
  }

  // ──────────────────────────── декор ────────────────────────────
  private trackAnim(obj: THREE.Object3D, z0: number) {
    if (obj.userData.tick) this.animated.push({ obj, z0 });
  }

  private buildDecor(node: THREE.Group, loc: LocId, z0: number) {
    const cfg = LOCS[loc];
    switch (loc) {
      case 'metro': {
        for (const s of [-1, 1]) {
          const b = MX.makeBuilding(s, cfg.accent);
          b.position.set(s * 8.6, 0, -14);
          node.add(b);
          for (const zz of [-7.5, -22.5]) {
            const p = MX.makePillar(cfg.accent2);
            p.position.set(s * 5.7, 0, zz);
            node.add(p);
          }
        }
        for (const zz of [-7.5, -22.5]) {
          const beam = MX.M(MX.boxGeo(11.4, 0.32, 0.7), MX.std(0xe8edf3, 0, 0, 0.7), 0, TUNNEL_H - 0.18, zz);
          node.add(beam);
        }
        node.add(MX.makeSkylight(CHUNK));
        for (let i = 0; i < 2; i++) {
          const sh = MX.makeSunShaft();
          sh.position.set(rand(-4, 4), sh.position.y, -rand(4, 26));
          node.add(sh);
        }
        const lt = MX.makeCeilLight(0xfff6e0);
        lt.position.set(0, TUNNEL_H - 0.45, -15);
        node.add(lt);
        if (Math.random() < 0.16) {
          const s = Math.random() < 0.5 ? -1 : 1;
          const tr = MX.makeTrain(16, TRAIN_SCHEMES.metro);
          tr.position.set(s * 9.2, 0, z0 - 15);
          this.root.add(tr);
          this.visMovers.push({ obj: tr, vz: rand(26, 40) });
        }
        break;
      }
      case 'canyon': {
        for (const s of [-1, 1]) {
          const r = MX.makeRockWall();
          r.position.set(s * rand(9.2, 10.4), 0, -15);
          node.add(r);
        }
        const side = pick([-1, 1]);
        const hd = MX.makeHoodoo();
        hd.position.set(side * 6.7, 0, -rand(6, 24));
        node.add(hd);
        if (Math.random() < 0.4) {
          const c = MX.makeCactus();
          c.position.set(-side * 6.2, 0, -rand(4, 26));
          node.add(c);
        }
        for (let i = 0; i < 2; i++) {
          const rock = MX.M(MX.coneGeo(0.7, 1.7, 6), MX.std(0x6e3a1f, 0, 0, 1), pick([-1, 1]) * rand(3.6, 5.2), TUNNEL_H - 0.6, -rand(4, 26));
          rock.rotation.x = Math.PI;
          node.add(rock);
        }
        node.add(MX.M(MX.boxGeo(24, 1.2, CHUNK * 0.7), MX.std(0x5e3018, 0, 0, 1), 0, TUNNEL_H + 0.7, -CHUNK / 2));
        break;
      }
      case 'ice': {
        for (const s of [-1, 1]) {
          node.add(MX.M(MX.boxGeo(4, 8, 26), MX.std(0xc8e6f5, 0, 0, 0.6, 0.05), s * 9.4, 3.6, -14));
          for (const zz of [-9, -21]) {
            const cr = MX.makeCrystalCluster();
            cr.position.set(s * 5.9, 0, zz + rand(-2, 2));
            node.add(cr);
          }
        }
        for (let i = 0; i < 3; i++) {
          const ic = MX.makeIcicle();
          ic.position.set(rand(-5, 5) > 0 ? rand(3.4, 5.2) : rand(-5.2, -3.4), TUNNEL_H - 0.5, -rand(3, 27));
          node.add(ic);
        }
        break;
      }
      case 'pugs': {
        for (const s of [-1, 1]) {
          const sf = MX.makeStorefront(s, cfg.accent);
          sf.position.set(s * 7.0, 0, -14);
          node.add(sf);
        }
        for (const zz of [-7.5, -22.5]) {
          for (const lx of [-1.15, 1.15]) {
            const ln = MX.makeLantern();
            ln.position.set(lx, TUNNEL_H - 0.75, zz);
            node.add(ln);
            this.trackAnim(ln, z0);
          }
        }
        const bn = MX.makeBunting();
        bn.position.set(0, TUNNEL_H - 0.55, -15);
        node.add(bn);
        if (Math.random() < 0.3) {
          const s = pick([-1, 1]);
          const p = MX.makePug();
          p.position.set(s * 5.5, 0, -rand(5, 25));
          p.rotation.y = rand(-0.6, 0.6) + (s > 0 ? -Math.PI / 2 : Math.PI / 2);
          node.add(p);
          this.trackAnim(p, z0);
        }
        break;
      }
      case 'sunny': {
        for (const s of [-1, 1]) {
          const b = MX.makeSunnyBuilding(s);
          b.position.set(s * 7.2, 0, -14);
          node.add(b);
        }
        node.add(MX.makeGlassRoof(CHUNK));
        for (let i = 0; i < 2; i++) {
          const sh = MX.makeSunShaft();
          sh.position.set(rand(-4, 4), sh.position.y, -rand(3, 27));
          node.add(sh);
        }
        for (const s of [-1, 1]) {
          if (Math.random() < 0.75) {
            const pl = MX.makePalm();
            pl.position.set(s * rand(4.3, 5.2), 0, -rand(3, 27));
            pl.scale.setScalar(rand(0.85, 1.15));
            node.add(pl);
          }
          const lp = MX.makeStreetLamp();
          lp.position.set(s * 4.7, 0, -rand(6, 24));
          lp.rotation.y = s > 0 ? Math.PI : 0;
          node.add(lp);
          if (Math.random() < 0.5) {
            const bh = MX.makeBench();
            bh.position.set(s * 4.4, 0, -rand(4, 26));
            bh.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
            node.add(bh);
          }
        }
        if (Math.random() < 0.28) {
          const f = MX.makeFountain();
          f.position.set(pick([-1, 1]) * 5.4, 0, -rand(8, 22));
          node.add(f);
          this.trackAnim(f, z0);
        }
        break;
      }
      case 'castle': {
        const wallR = MX.M(MX.boxGeo(15, 12, CHUNK + 2), MX.std(0xa09484, 0, 0, 0.95), 4.5, 5.5, -CHUNK / 2);
        node.add(wallR);
        for (let i = 0; i < Math.floor(CHUNK / 5); i++) {
          node.add(MX.M(MX.boxGeo(1.2, 1.0, 1.4), MX.std(0xa09484, 0, 0, 0.95), -2.2, 12, -1.5 - i * 5));
        }
        const rail = MX.makeRailingRow(CHUNK);
        rail.position.set(-10.55, 0, 0);
        node.add(rail);
        const moat = MX.makeMoat(CHUNK);
        moat.position.set(-14, 0, 0);
        node.add(moat);
        for (const ch of moat.children) this.trackAnim(ch, z0);
        node.add(MX.M(MX.boxGeo(1.4, 0.8, CHUNK), MX.std(0x8a8271), -17.9, 0.4, -CHUNK / 2));
        const variants: ('keep' | 'tower' | 'wall')[] = ['wall', 'keep', 'wall', 'tower'];
        const pv = variants[this.palaceIdx % variants.length];
        this.palaceIdx++;
        const pal = MX.makePalace(pv);
        pal.position.set(-22, 0, -CHUNK / 2);
        node.add(pal);
        if (Math.random() < 0.5) {
          const tr = MX.makeTree();
          tr.position.set(rand(5.6, 9.6), 0, -rand(4, 26));
          tr.scale.setScalar(rand(0.8, 1.3));
          node.add(tr);
        }
        if (Math.random() < 0.35) {
          const b = MX.makeBush();
          b.position.set(rand(5.4, 9.4), 0, -rand(4, 26));
          node.add(b);
        }
        if (Math.random() < 0.4) {
          const cl = MX.makeCloud();
          cl.position.set(rand(-32, 8), rand(11, 17), -rand(5, 25));
          cl.scale.setScalar(rand(1.4, 2.4));
          node.add(cl);
          this.trackAnim(cl, z0);
        }
        if (Math.random() < 0.55) {
          const cols = [0x57a04a, 0x8a5bd6, 0xc63b2f, 0x3d6ea8];
          const d = MX.makeDragon(pick(cols), rand(0.7, 1.05));
          const baseX = rand(-22, 6);
          const baseY = rand(8, 13.5);
          const ph = rand(0, 6);
          d.position.set(baseX, baseY, z0 - rand(5, 25));
          const inner = d.userData.tick as (t: number, dt: number) => void;
          d.userData.tick = (t: number, dt: number) => {
            inner(t, dt);
            d.position.x = baseX + Math.sin(t * 0.35 + ph) * 8;
            d.position.y = baseY + Math.sin(t * 0.6 + ph) * 1.6;
            d.rotation.z = Math.cos(t * 0.35 + ph) * 0.25;
          };
          this.root.add(d);
          this.visMovers.push({ obj: d, vz: -rand(3, 7) });
        }
        break;
      }
    }
  }

  // ──────────────────────────── туннельные препятствия ──────────
  private addStaticCol(x: number, z: number, w: number, half: number, y0: number, y1: number) {
    this.colliders.push({ x, z, w, half, y0, y1 });
  }

  /** Включить тени у геймплейного объекта (если включены в рендерере) */
  markShadow(o: THREE.Object3D) {
    if (!this.shadows) return;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }

  /** Проверяет, свободен ли участок на дорожке и не перекроются ли все 3 полосы сразу */
  private canPlaceTunnelOb(lane: number, zCenter: number, half: number, onCeil: boolean): boolean {
    const x = LANES[lane];
    let blockedCount = 0;
    const blockedLanes = new Set<number>();

    for (const c of this.colliders) {
      const cz = c.z + (c.zOff ?? 0);
      if (Math.abs(cz - zCenter) > c.half + half + 1.4) continue;
      // Совпадает ли по высоте с текущей поверхностью (пол / потолок)
      const sameSurface = onCeil ? c.y1 > TUNNEL_H - 3.2 : c.y0 < 3.2;
      if (!sameSurface) continue;
      if (Math.abs(c.x - x) < 1.0) return false;
      for (let li = 0; li < LANES.length; li++) {
        if (Math.abs(c.x - LANES[li]) < 1.0) blockedLanes.add(li);
      }
    }
    blockedCount = blockedLanes.size;
    return blockedCount < 2;
  }

  /** Поезд на дорожке: точные габариты, без наложения на блок/стену и без вылета за границу биома */
  private addTrainStatic(z0: number, loc: LocId, lz: number, lane: number) {
    const x = LANES[lane];
    const z = z0 - lz;
    const len = pick([10, 12, 13]);
    const b = MX.getTrainBounds(len, loc);
    if (!this.canPlaceTunnelOb(lane, z + b.zOff, b.half, false)) return;

    let vz = 0;
    const canMove = this.segLeft > 90 && this.nextLoc !== 'castle' && Math.random() >= 0.45;
    if (canMove) {
      // Движущийся поезд едет в +Z (навстречу игроку): проверяем, что путь спереди на этой полосе чист
      const pathBlocked = this.colliders.some((c) => {
        if (Math.abs(c.x - x) >= 1.0 || c.y0 >= 3.2) return false;
        const cz = c.z + (c.zOff ?? 0);
        return cz >= z - 15 && cz <= z + 55;
      });
      if (!pathBlocked) {
        vz = rand(2.5, 5.5) + this.diff * 3.5;
      }
    }

    const tr = MX.makeTrain(len, TRAIN_SCHEMES[loc]);
    tr.position.set(x, 0, z);
    if (vz === 0) {
      const chock = MX.M(MX.boxGeo(2.3, 0.22, 0.5), MX.std(0xf0a800, 0xf0a800, 0.2, 0.7), 0, 0.12, b.zFront + 0.35);
      tr.add(chock);
    }
    this.markShadow(tr);
    this.root.add(tr);
    this.colliders.push({
      x, z, zOff: b.zOff, w: 2.25, half: b.half, y0: 0, y1: b.top,
      obj: tr, vz, rideable: true, top: b.top,
    });
  }

  /** Барьер, под которым нужно прокатиться кувырком (строго ограниченный по высоте) */
  private addRollBar(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number, onCeil = false) {
    const z = z0 - lz;
    if (!this.canPlaceTunnelOb(lane, z, 0.5, onCeil)) return;
    const o = MX.makeRollBar(loc, onCeil);
    o.position.set(LANES[lane], 0, -lz);
    this.markShadow(o);
    node.add(o);
    const y0 = onCeil ? TUNNEL_H - ROLLBAR_Y1 : ROLLBAR_Y0;
    const y1 = onCeil ? TUNNEL_H - ROLLBAR_Y0 : ROLLBAR_Y1;
    this.addStaticCol(LANES[lane], z, 2.1, 0.45, y0, y1);
  }

  private addFloorOb(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const z = z0 - lz;
    const half = FLOOR_HALF[loc] ?? 0.55;
    if (!this.canPlaceTunnelOb(lane, z, half, false)) return;
    const o = MX.makeFloorObstacle(loc);
    o.position.set(LANES[lane], 0, -lz);
    this.markShadow(o);
    node.add(o);
    this.addStaticCol(LANES[lane], z, 2.0, half, 0, FLOOR_H[loc] ?? 1.15);
  }

  private addCeilOb(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const z = z0 - lz;
    if (!this.canPlaceTunnelOb(lane, z, 0.7, true)) return;
    const o = MX.makeCeilObstacle(loc);
    o.position.set(LANES[lane], 0, -lz);
    this.markShadow(o);
    node.add(o);
    this.addStaticCol(LANES[lane], z, 1.95, 0.7, TUNNEL_H - 1.72, TUNNEL_H + 0.2);
  }

  private addBlock(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const z = z0 - lz;
    if (!this.canPlaceTunnelOb(lane, z, 0.65, false) || !this.canPlaceTunnelOb(lane, z, 0.65, true)) return;
    const o = MX.makeBlock(loc);
    o.position.set(LANES[lane], 0, -lz);
    this.markShadow(o);
    node.add(o);
    this.addStaticCol(LANES[lane], z, 2.05, 0.65, 0, TUNNEL_H);
  }

  private addCoinLine(x: number, y: number, z0: number, lz: number, n = 6, dz = 1.35) {
    for (let i = 0; i < n; i++) {
      const lzI = lz - ((n - 1) / 2) * dz + i * dz;
      this.coins.push({ x, y, z: z0 + lzI, rotY: i * 0.4, taken: false });
    }
  }

  private buildTunnelHazards(node: THREE.Group, z0: number, loc: LocId) {
    if (this.safeChunks > 0) return;
    const cfg = LOCS[loc];

    if (Math.random() < 0.1) {
      this.addCoinLine(0, 1.2, z0, -15, 10, 2);
      if (cfg.hasCeiling) this.addCoinLine(0, TUNNEL_H - 1.2, z0, -15, 10, 2);
      return;
    }

    const nSlices = this.diff > 0.4 ? 2 : 1;
    const poses = [7, 21];

    for (let s = 0; s < nSlices; s++) {
      const lz = poses[s];
      const lanes = shuffle([0, 1, 2]);
      const side = (cfg.hasCeiling && Math.random() < 0.5) ? irand(0, 2) : 0;

      if (side === 0 || side === 2) {
        const type = pick(['train', 'bar', 'roll', 'block']);
        if (type === 'train') this.addTrainStatic(z0, loc, lz, lanes[0]);
        else if (type === 'bar') this.addFloorOb(node, z0, loc, lz, lanes[0]);
        else if (type === 'roll') this.addRollBar(node, z0, loc, lz, lanes[0], false);
        else this.addBlock(node, z0, loc, lz, lanes[0]);
        this.addCoinLine(LANES[lanes[1]], 1.0, z0, -lz, 5, 1.8);
      }

      if (side === 1 || side === 2) {
        if (cfg.hasCeiling) {
          const type = pick(['train', 'bar', 'roll']);
          const lane = side === 2 ? lanes[2] : lanes[0];
          if (type === 'train') this.addTrainCeil(z0, loc, lz + 2, lane);
          else if (type === 'bar') this.addCeilOb(node, z0, loc, lz, lane);
          else this.addRollBar(node, z0, loc, lz, lane, true);
          this.addCoinLine(LANES[side === 2 ? lanes[1] : lanes[2]], TUNNEL_H - 1.0, z0, -lz, 5, 1.8);
        }
      }
    }
  }

  private addTrainCeil(z0: number, loc: LocId, lz: number, lane: number) {
    const len = pick([10, 12]);
    const b = MX.getTrainBounds(len, loc);
    const x = LANES[lane];
    const z = z0 - lz;
    if (!this.canPlaceTunnelOb(lane, z + b.zOff, b.half, true)) return;
    const tr = MX.makeTrain(len, TRAIN_SCHEMES[loc]);
    tr.position.set(x, TUNNEL_H, z);
    tr.rotation.z = Math.PI;
    this.markShadow(tr);
    this.root.add(tr);
    this.colliders.push({
      x, z, zOff: b.zOff, w: 2.25, half: b.half, y0: TUNNEL_H - b.top, y1: TUNNEL_H,
      obj: tr, vz: 0,
    });
  }

  // ──────────────────────────── замок: препятствия ──────────────
  private addCastleCoinArc(x: number, z0: number, lz: number) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const lzI = lz - 3 + k * 6;
      const y = 0.9 + Math.sin(Math.PI * k) * 1.65;
      this.coins.push({ x, y, z: z0 + lzI, rotY: i * 0.4, taken: false });
    }
  }

  private buildCastleHazards(node: THREE.Group, z0: number) {
    // Правая стена: точное совпадение с мешем wallR (x=4.5, w=15 → [-3.0, +12.0])
    this.addStaticCol(4.5, z0 - CHUNK / 2, 15, CHUNK / 2, 0, 12);
    if (this.safeChunks > 0) return;

    const nSlices = this.diff > 0.45 && Math.random() < 0.5 ? 2 : 1;
    const poses = shuffle([7, 19.5]);
    for (let s = 0; s < nSlices; s++) {
      const lz = poses[s];
      const lanes = shuffle([0, 1, 2]);
      const nOb = Math.random() < 0.55 ? 1 : 2;
      for (let i = 0; i < nOb; i++) {
        const lane = lanes[i];
        const kind = pick(['bush', 'vase', 'rail'] as const);
        const x = CASTLE_LANES[lane];
        let o: THREE.Group; let h: number;
        if (kind === 'bush') { o = MX.makeBush(); h = 1.08; }
        else if (kind === 'vase') { o = MX.makeVase(); h = 1.32; }
        else { o = MX.makeRailOb(); h = 1.05; }
        o.position.set(x, 0, -lz + (i === 1 ? 1.4 : 0));
        this.markShadow(o);
        node.add(o);
        this.addStaticCol(x, z0 - lz + (i === 1 ? 1.4 : 0), kind === 'rail' ? 2.1 : 1.4, 0.55, 0, h);
        if (i === 0 && Math.random() < 0.6) this.addCastleCoinArc(x, z0, -lz);
      }
      if (Math.random() < 0.55) {
        const freeLane = lanes[nOb];
        this.addCoinLine(CASTLE_LANES[freeLane], 1.0, z0, -lz, 5, 1.7);
      }
    }
  }

  // ──────────────────────────── встречные ───────────────────────
  spawnOncoming(zStart: number, speed: number): 'train' | 'dragon' | null {
    const loc = this.locAt(zStart);
    // Не спавним встречку поперёк смены локации (особенно около замка)
    if (loc !== this.locAt(zStart + 110) || loc !== this.locAt(zStart - 60)) return null;

    const lane = irand(0, 2);
    if (loc === 'castle') {
      const d = MX.makeDragon(0xc62828, 1.35);
      d.rotation.y = Math.PI;
      const x = CASTLE_LANES[lane];
      const y = 1.75;
      d.position.set(x, y, zStart);
      const fire = MX.sprite(0xff7a1a, 1.6, 0.85, true);
      fire.position.set(0, 0.7, -2.4);
      d.add(fire);
      const inner = d.userData.tick as (t: number, dt: number) => void;
      d.userData.tick = (t: number, dt: number) => {
        inner(t, dt);
        d.position.y = y + Math.sin(t * 3.1) * 0.22;
        (fire.material as THREE.SpriteMaterial).opacity = 0.5 + Math.abs(Math.sin(t * 9)) * 0.5;
      };
      this.markShadow(d);
      this.root.add(d);
      this.colliders.push({
        x, z: zStart, w: 2.5, half: 2.7, y0: 0.8, y1: 2.95,
        obj: d, vz: speed * 0.55 + 13,
      });
      return 'dragon';
    }
    const len = 15;
    const b = MX.getTrainBounds(len, loc);
    const tr = MX.makeTrain(len, TRAIN_SCHEMES[loc]);
    const x = LANES[lane];
    tr.position.set(x, 0, zStart);
    this.markShadow(tr);
    this.root.add(tr);
    this.colliders.push({
      x, z: zStart, zOff: b.zOff, w: 2.25, half: b.half, y0: 0, y1: b.top,
      obj: tr, vz: speed * 0.5 + 15,
      rideable: true, top: b.top,
    });
    return 'train';
  }
}
