import * as THREE from 'three';
import {
  CHUNK, GEN_AHEAD, LANES, CASTLE_LANES, CASTLE_SHIFT, TUNNEL_H,
  LocId, LOCS, LOC_LIST, MoveMode, rand, irand, pick, shuffle,
} from './config';
import * as MX from './meshes';
import { cobbleTex } from './textures';

export interface Collider {
  x: number; z: number; w: number; half: number;
  y0: number; y1: number;
  obj?: THREE.Object3D | null;
  vx?: number; vz?: number;
  /** На крышу можно запрыгнуть (поезда) */
  rideable?: boolean;
  /** Высота крыши для приземления */
  top?: number;
}
export interface CoinRef { obj: THREE.Object3D; x: number; y: number; z: number; taken: boolean; }
export interface GameEvent { z: number; type: 'loc' | 'preCastle' | 'mode' | 'exitCastle'; loc?: LocId; mode?: MoveMode; }

interface Chunk { node: THREE.Group; z0: number; }
interface Extra { obj: THREE.Object3D; z0: number; }
interface VisMover { obj: THREE.Object3D; vz: number; }

const TRAIN_SCHEMES: Record<string, MX.TrainScheme> = {
  metro:  { body: 0xeef2f7, roof: 0xc3ccd8, stripe: 0x1ab6e0, win: 0xdff2ff }, // стандартный поезд
  canyon: { body: 0x8c6438, roof: 0x644820, stripe: 0xf4511e, win: 0xfff0d0, kind: 'minecart' }, // рудничный вагон
  ice:    { body: 0xdcf0ff, roof: 0xa4cee2, stripe: 0x00b8d4, win: 0xf2fbff, kind: 'slede' }, // ледяные санки
  pugs:   { body: 0xf7d0e8, roof: 0xe0a8cc, stripe: 0xf0578f, win: 0xfff4de, kind: 'pugcart' }, // мопс-мобиль
  castle: { body: 0x8a7868, roof: 0x6b5c4c, stripe: 0xd9a520, win: 0xfff2c0, kind: 'chariot' }, // колесница
  sunny:  { body: 0xffe6c4, roof: 0xff7043, stripe: 0x29b6f6, win: 0xfff6e0, kind: 'van' }, // фургон
};
const FLOOR_H: Record<string, number> = { metro: 1.16, canyon: 1.15, ice: 1.3, pugs: 0.8, sunny: 1.1 };

/** Барьер для кувырка: низ 1.28 → выше роста, но кувырок (0.78) проходит */
const ROLLBAR_Y0 = 1.3;
/** Высота крыши поезда — на неё можно запрыгнуть */
export const TRAIN_TOP = 2.95;

export class World {
  root = new THREE.Group();
  colliders: Collider[] = [];
  coins: CoinRef[] = [];
  diff = 0;

  private chunks: Chunk[] = [];
  private extras: Extra[] = [];
  private animated: { obj: THREE.Object3D; z0: number }[] = [];
  private visMovers: VisMover[] = [];
  private events: GameEvent[] = [];

  // ── мопсы, бегущие рядом с игроком ──
  private pugPack: { obj: THREE.Group; lane: number; off: number; phase: number; side: number }[] = [];
  private packOn = false;
  // ── огненные снаряды драконов ──
  fireballs: { obj: THREE.Group; x: number; y: number; z: number; vz: number; vx: number; vy: number; warn?: THREE.Mesh }[] = [];

  private genLoc: LocId = 'metro';
  private segLeft = 540;
  private genZ = 6;
  private bag: LocId[] = [];
  private palaceIdx = 0;
  private safeChunks = 2;

  constructor(private scene: THREE.Scene) {
    scene.add(this.root);
  }

  reset() {
    this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.colliders = []; this.coins = []; this.chunks = [];
    this.extras = []; this.animated = []; this.visMovers = []; this.events = [];
    this.pugPack = []; this.packOn = false;
    this.fireballs = [];
    this.boss = null; this.bossLunge = 0;
    this.genLoc = 'metro';
    this.segLeft = 540;
    this.genZ = 6;
    this.bag = [];
    this.palaceIdx = 0;
    this.safeChunks = 2;
    this.diff = 0;
  }

  // ──────────────────────────── update ────────────────────────────
  update(dt: number, pz: number, t: number, speed = 0) {
    this.updatePugPack(dt, pz, t, speed);
    this.updateFireballs(dt, pz, t);
    this.updateBoss(dt, pz, t);
    // генерация вперёд
    while (this.genZ > pz - GEN_AHEAD) this.genChunk();
    // переработка чанков
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (c.z0 > pz + 55) {
        this.root.remove(c.node);
        this.chunks.splice(i, 1);
      }
    }
    for (let i = this.extras.length - 1; i >= 0; i--) {
      if (this.extras[i].z0 > pz + 70) {
        this.root.remove(this.extras[i].obj);
        this.extras.splice(i, 1);
      }
    }
    // анимации статиков
    for (let i = this.animated.length - 1; i >= 0; i--) {
      const a = this.animated[i];
      if (a.z0 > pz + 80) { this.animated.splice(i, 1); continue; }
      a.obj.userData.tick?.(t, dt);
    }
    // визуальные движущиеся (побочные поезда, драконы на фоне)
    for (let i = this.visMovers.length - 1; i >= 0; i--) {
      const v = this.visMovers[i];
      v.obj.position.z += v.vz * dt;
      v.obj.userData.tick?.(t, dt);
      if (v.obj.position.z > pz + 90 || v.obj.position.z < pz - GEN_AHEAD - 120) {
        this.root.remove(v.obj);
        this.visMovers.splice(i, 1);
      }
    }
    // движущиеся опасности (встречки, мопсы)
    for (let i = this.colliders.length - 1; i >= 0; i--) {
      const c = this.colliders[i];
      if (c.obj && (c.vx || c.vz)) {
        c.z += (c.vz ?? 0) * dt;
        c.x += (c.vx ?? 0) * dt;
        c.obj.position.z = c.z;
        c.obj.position.x = c.x;
        c.obj.userData.tick?.(t, dt);
        if (c.vx && Math.abs(c.x) > 14) { // мопс убежал за пределы
          this.root.remove(c.obj);
          this.colliders.splice(i, 1);
          continue;
        }
      }
      if (c.z > pz + 90) {
        if (c.obj) this.root.remove(c.obj);
        this.colliders.splice(i, 1);
      }
    }
    // монетки крутим
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const cn = this.coins[i];
      if (cn.z > pz + 25 || cn.taken) { this.coins.splice(i, 1); continue; }
      cn.obj.rotation.y += dt * 3.2;
    }
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
    // 6 мопсов: часть по бокам, часть позади и впереди по дорожкам
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
      // иногда перескакивают на соседнюю дорожку — «бегают везде»
      if (Math.random() < dt * 0.35) p.lane = irand(0, 2);
      const targetX = p.side !== 0
        ? p.side * rand(4.4, 4.6)
        : LANES[p.lane] + Math.sin(t * 1.3 + p.phase) * 0.35;
      p.obj.position.x += (targetX - p.obj.position.x) * Math.min(1, dt * 3.2);
      // держатся около игрока, слегка колеблясь по глубине
      const targetZ = pz + p.off + Math.sin(t * 0.9 + p.phase) * 1.4;
      p.obj.position.z += (targetZ - p.obj.position.z) * Math.min(1, dt * 2.6);
      // бег вприпрыжку
      const gallop = Math.abs(Math.sin(t * (7 + speed * 0.12) + p.phase));
      p.obj.position.y = gallop * 0.24;
      p.obj.rotation.z = Math.sin(t * 6 + p.phase) * 0.09;
      p.obj.rotation.y = Math.sin(t * 1.1 + p.phase) * 0.14;
      p.obj.userData.tick?.(t, dt);
      // следят за игроком
      if (p.side !== 0) p.obj.rotation.y = (p.side > 0 ? -1 : 1) * Math.PI / 2 * 0.55;
    }
  }

  // ═══ ДРАКОН-ПРЕСЛЕДОВАТЕЛЬ ═══
  private boss: THREE.Group | null = null;
  private bossLunge = 0;

  setBossDragon(on: boolean) {
    if (on && !this.boss) {
      const d = MX.makeDragon(0xc62828, 1.5);
      d.rotation.y = Math.PI; // мордой к игроку
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
    // кружит впереди над улицей замка
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
  /** Дракон в небе плюётся огнём по дорожке */
  spawnFireball(pz: number, lane: number, fromSky: boolean): void {
    const targetX = CASTLE_LANES[lane];
    const fb = MX.makeFireball();
    // летит либо сверху по диагонали, либо прямо в лоб
    const startZ = pz - rand(58, 78);
    const startY = fromSky ? rand(7.5, 10) : rand(1.6, 2.3);
    const startX = fromSky ? targetX + rand(-2.5, 2.5) : targetX;
    fb.position.set(startX, startY, startZ);
    this.root.add(fb);
    const travel = 2.1; // секунд до игрока
    const vz = (pz - startZ) / travel + 18;
    const vy = fromSky ? (1.4 - startY) / travel : rand(-0.1, 0.1);
    const vx = (targetX - startX) / travel;
    // метка на земле, куда прилетит
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

  /** Убрать все снаряды (при смене локации/смерти) */
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
    for (const c of this.colliders) c.z += dz;
    for (const cn of this.coins) cn.z += dz;
    for (const e of this.events) e.z += dz;
    for (const p of this.pugPack) p.obj.position.z += dz;
    for (const f of this.fireballs) { f.z += dz; f.obj.position.z += dz; if (f.warn) f.warn.position.z += dz; }
  }

  // ──────────────────────────── чанки ────────────────────────────
  private genChunk() {
    if (this.segLeft <= 0) this.startSegment(this.genZ);
    const loc = this.genLoc;
    const z0 = this.genZ;
    const node = new THREE.Group();
    node.position.z = z0;
    this.buildGround(node, loc);
    if (this.shadows) {
      node.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) m.receiveShadow = true; });
    }
    const groundCount = node.children.length;
    this.buildDecor(node, loc, z0);
    if (loc === 'castle') this.buildCastleHazards(node, z0);
    else this.buildTunnelHazards(node, z0, loc);
    if (this.shadows) {
      for (let i = groundCount; i < node.children.length; i++) this.markShadow(node.children[i]);
    }
    this.root.add(node);
    this.chunks.push({ node, z0 });
    this.genZ -= CHUNK;
    this.segLeft -= CHUNK;
    if (this.safeChunks > 0) this.safeChunks--;
  }

  private startSegment(zB: number) {
    const prev = this.genLoc;
    if (this.bag.length === 0) {
      this.bag = shuffle(LOC_LIST.filter((l) => l !== prev));
    }
    const next = this.bag.pop()!;
    this.genLoc = next;
    this.segLeft = CHUNK * irand(15, 22);
    const cfg = LOCS[next];

    // арка на границе
    const gate = MX.makeGate(next === 'castle' ? CASTLE_LANES[0] - 1.4 : -5.4, next === 'castle' ? CASTLE_LANES[2] + 1.4 : 5.4, cfg.accent);
    gate.position.z = zB;
    this.root.add(gate);
    this.extras.push({ obj: gate, z0: zB });

    this.events.push({ z: zB, type: 'loc', loc: next });

    if (next === 'castle') {
      this.events.push({ z: zB + 76, type: 'preCastle' });

      // ── ШИПЫ на основных 3 дорожках — смертельная стена ──
      // длинная полоса шипов, чтобы нельзя было пробежать по старым дорожкам
      for (const zz of [zB + 60, zB + 36, zB + 12]) {
        const sp = MX.makeSpikeField(8.2, 22);
        sp.position.set(0, 0, zz);
        this.root.add(sp);
        this.extras.push({ obj: sp, z0: zz });
        // коллайдер шипов — мгновенная смерть
        this.colliders.push({ x: 0, z: zz - 11, w: 8.4, half: 11, y0: 0, y1: 1.2 });
      }

      // ── ВЫСОКАЯ СТЕНА перекрывает обзор на старую дорогу ──
      const wallBlock = MX.M(MX.boxGeo(9.4, 7.5, 75), MX.std(0xa09484, 0, 0, 0.95), 0, 3.75, zB + 37.5 - 75);
      this.root.add(wallBlock);
      this.extras.push({ obj: wallBlock, z0: zB - 40 });
      this.colliders.push({ x: 0, z: zB, w: 9.4, half: 37.5, y0: 0, y1: 7.5 });

      // ── КРАСНАЯ ЛЕСТНИЦА наверх (визуальная + направляющие шевроны) ──
      const stair = MX.makeCastleStairway();
      stair.position.set(0, 0, zB + 68);
      this.root.add(stair);
      this.extras.push({ obj: stair, z0: zB + 68 });

      // шевроны — указывают на лестницу (влево)
      for (const zz of [zB + 72, zB + 56, zB + 42]) {
        for (const lx of LANES) {
          const ar = MX.makeArrow('left', LOCS.castle.accent);
          ar.position.set(lx, 0.07, zz);
          this.root.add(ar);
          this.extras.push({ obj: ar, z0: zz });
          this.animated.push({ obj: ar, z0: zz });
        }
      }

      this.events.push({ z: zB, type: 'mode', mode: 'jump' });
    }
    if (prev === 'castle') {
      // после замка — пара безопасных чанков, пока игрок возвращается на основную дорогу
      this.safeChunks = Math.max(this.safeChunks, 2);
      this.events.push({ z: zB, type: 'exitCastle' });
      for (const zz of [zB - 4, zB - 20, zB - 36]) {
        for (const lx of CASTLE_LANES) {
          const ar = MX.makeArrow('right', 0xffffff);
          ar.position.set(lx, 0.07, zz);
          this.root.add(ar);
          this.extras.push({ obj: ar, z0: zz });
          this.animated.push({ obj: ar, z0: zz });
        }
      }
      // баррикада на конце улицы через ~2 чанка
      const bar = MX.makeBarricade(7.9);
      bar.position.set(-6.9, 0, zB - 56);
      this.root.add(bar);
      this.extras.push({ obj: bar, z0: zB - 56 });
      this.animated.push({ obj: bar, z0: zB - 56 });
      this.colliders.push({ x: -6.9, z: zB - 56, w: 8.2, half: 0.5, y0: 0, y1: 6.6 });
    }
  }

  // ──────────────────────────── земля ────────────────────────────
  private buildGround(node: THREE.Group, loc: LocId) {
    const cfg = LOCS[loc];
    const isCastle = loc === 'castle';

    const mkFloor = (y: number, isCeil: boolean) => {
      const g = MX.M(MX.planeGeo(32, CHUNK), MX.std(isCeil ? cfg.ceiling : cfg.ground, 0, 0, 0.9), 0, y, -CHUNK / 2);
      g.rotation.x = isCeil ? Math.PI / 2 : -Math.PI / 2;
      node.add(g);
      
      // Направляющие
      const glowMat = MX.std(cfg.laneGlow, cfg.laneGlow, 0.2, 0.6);
      node.add(MX.M(MX.boxGeo(0.12, 0.04, CHUNK), glowMat, -1.15, y + (isCeil ? -0.02 : 0.02), -CHUNK / 2));
      node.add(MX.M(MX.boxGeo(0.12, 0.04, CHUNK), glowMat, 1.15, y + (isCeil ? -0.02 : 0.02), -CHUNK / 2));
      
      // Бордюры (только если не замок)
      if (!isCastle) {
        node.add(MX.M(MX.boxGeo(0.5, 0.3, CHUNK), MX.std(cfg.ground2), -5.2, y + (isCeil ? -0.15 : 0.15), -CHUNK / 2));
        node.add(MX.M(MX.boxGeo(0.5, 0.3, CHUNK), MX.std(cfg.ground2), 5.2, y + (isCeil ? -0.15 : 0.15), -CHUNK / 2));
      }
    };

    if (isCastle) {
      // Обычный пол замка
      const cob = new THREE.MeshStandardMaterial({ map: cobbleTex(), roughness: 0.9 });
      cob.map!.repeat.set(2, 8);
      const st = MX.M(MX.planeGeo(7.7, CHUNK), cob, -6.975, 0, -CHUNK / 2);
      st.rotation.x = -Math.PI / 2;
      node.add(st);
      node.add(MX.M(MX.boxGeo(0.1, 0.03, CHUNK), MX.lam(cfg.laneGlow), -8.05, 0.02, -CHUNK / 2));
      node.add(MX.M(MX.boxGeo(0.1, 0.03, CHUNK), MX.lam(cfg.laneGlow), -5.75, 0.02, -CHUNK / 2));
    } else {
      mkFloor(0, false); // Основной пол
      if (cfg.hasCeiling) mkFloor(TUNNEL_H, true); // Зеркальный пол сверху
    }
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
        // стеклянный световой фонарь в крыше вокзала
        const sky = MX.makeSkylight(CHUNK);
        node.add(sky);
        for (let i = 0; i < 2; i++) {
          const sh = MX.makeSunShaft();
          sh.position.set(rand(-4, 4), sh.position.y, -rand(4, 26));
          node.add(sh);
          this.trackAnim(sh, z0);
        }
        const lt = MX.makeCeilLight(0xfff6e0);
        lt.position.set(0, TUNNEL_H - 0.45, -15);
        node.add(lt);
        if (Math.random() < 0.18) {
          const s = Math.random() < 0.5 ? -1 : 1;
          const tr = MX.makeTrain(20, TRAIN_SCHEMES.metro);
          tr.position.set(s * 9.2, 0, -15);
          this.root.add(tr);
          this.visMovers.push({ obj: tr, vz: rand(26, 40) });
          tr.position.z = z0 - 15;
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
        // нависающие камни у потолка (по краям)
        for (let i = 0; i < 2; i++) {
          const rock = MX.M(MX.coneGeo(rand(0.5, 0.9), rand(1.2, 2.2), 6), MX.std(0x6e3a1f, 0, 0, 1), pick([-1, 1]) * rand(3.6, 5.2), TUNNEL_H - 0.6, -rand(4, 26));
          rock.rotation.x = Math.PI;
          node.add(rock);
        }
        const slab = MX.M(MX.boxGeo(24, 1.2, CHUNK * 0.7), MX.std(0x5e3018, 0, 0, 1), 0, TUNNEL_H + 0.7, -CHUNK / 2);
        node.add(slab);
        break;
      }
      case 'ice': {
        for (const s of [-1, 1]) {
          node.add(MX.M(MX.boxGeo(4, rand(7, 9), 26), MX.std(0xc8e6f5, 0, 0, 0.6, 0.05), s * 9.4, 3.6, -14));
          for (const zz of [-9, -21]) {
            const cr = MX.makeCrystalCluster();
            cr.position.set(s * 5.9, 0, zz + rand(-2, 2));
            this.trackAnim(cr, z0);
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
        // стеклянная крыша пассажа
        const roof = MX.makeGlassRoof(CHUNK);
        node.add(roof);
        // солнечные столбы света
        for (let i = 0; i < 2; i++) {
          const sh = MX.makeSunShaft();
          sh.position.set(rand(-4, 4), sh.position.y, -rand(3, 27));
          node.add(sh);
          this.trackAnim(sh, z0);
        }
        // пальмы, фонари, лавки
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
        // ГЛУХАЯ стена справа: делаем её шире и ставим ближе к центру, 
        // чтобы она гарантированно перекрывала старые дорожки при повороте камеры.
        const wallR = MX.M(MX.boxGeo(15, 12, CHUNK + 2), MX.std(0xa09484, 0, 0, 0.95), 4.5, 5.5, -CHUNK / 2);
        node.add(wallR);
        // бойницы-зубцы наверху
        for (let i = 0; i < Math.floor(CHUNK / 5); i++) {
          node.add(MX.M(MX.boxGeo(1.2, 1.0, 1.4), MX.std(0xa09484, 0, 0, 0.95), -2.2, 12, -1.5 - i * 5));
        }
        // поручни вдоль рва
        const rail = MX.makeRailingRow(CHUNK);
        rail.position.set(-10.55, 0, 0);
        node.add(rail);
        // ров с водой
        const moat = MX.makeMoat(CHUNK);
        moat.position.set(-14, 0, 0);
        node.add(moat);
        this.trackAnim(moat, z0);
        for (const ch of moat.children) this.trackAnim(ch, z0);
        // дальний берег
        node.add(MX.M(MX.boxGeo(1.4, 0.8, CHUNK), MX.std(0x8a8271), -17.9, 0.4, -CHUNK / 2));
        // дворец
        const variants: ('keep' | 'tower' | 'wall')[] = ['wall', 'keep', 'wall', 'tower'];
        const pv = variants[this.palaceIdx % variants.length];
        this.palaceIdx++;
        const pal = MX.makePalace(pv);
        pal.position.set(-22, 0, -CHUNK / 2);
        node.add(pal);
        // деревья и кусты на траве
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
        // облака
        if (Math.random() < 0.4) {
          const cl = MX.makeCloud();
          cl.position.set(rand(-32, 8), rand(11, 17), -rand(5, 25));
          cl.scale.setScalar(rand(1.4, 2.4));
          node.add(cl);
          this.trackAnim(cl, z0);
        }
        // драконы на фоне
        if (Math.random() < 0.62) {
          const cols = [0x57a04a, 0x8a5bd6, 0xc63b2f, 0x3d6ea8];
          const d = MX.makeDragon(pick(cols), rand(0.7, 1.05));
          const baseX = rand(-22, 6);
          const baseY = rand(8, 13.5);
          const ph = rand(0, 6);
          d.position.set(baseX, baseY, -rand(5, 55));
          const inner = d.userData.tick as (t: number, dt: number) => void;
          d.userData.tick = (t: number, dt: number) => {
            inner(t, dt);
            d.position.x = baseX + Math.sin(t * 0.35 + ph) * 8;
            d.position.y = baseY + Math.sin(t * 0.6 + ph) * 1.6;
            d.rotation.z = Math.cos(t * 0.35 + ph) * 0.25;
          };
          this.root.add(d);
          d.position.z = z0 - rand(5, 25);
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

  /** Включить тени у объекта (если включены в рендерере) */
  markShadow(o: THREE.Object3D) {
    if (!this.shadows) return;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }

  shadows = false;

  /** Поезд на дорожке — всегда стартует ЗА горизонтом, чтобы не появляться из стены */
  private addTrainStatic(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    void node;
    // Оптимизация: не спавним поезда слишком часто на слабых устройствах
    if (this.shadows === false && Math.random() < 0.3) return;

    const len = rand(12, 17);
    const tr = MX.makeTrain(len, TRAIN_SCHEMES[loc]);
    const x = LANES[lane];
    const r = Math.random();
    let vz: number;

    if (r < 0.34) {
      // СТОЯЧИЕ поезда — проверяем, нет ли тут уже коллайдера
      const z = z0 - lz;
      const alreadyOccupied = this.colliders.some(c => Math.abs(c.z - z) < 10 && Math.abs(c.x - x) < 1);
      if (alreadyOccupied) return;

      vz = 0;
      tr.position.set(x, 0, z);
      const chock = MX.M(MX.boxGeo(2.3, 0.22, 0.5), MX.std(0xf0a800, 0xf0a800, 0.2, 0.7), 0, 0.12, len / 2 + 1.5);
      tr.add(chock);
      this.markShadow(tr);
      this.root.add(tr);
      this.colliders.push({ x, z, w: 2.25, half: len / 2 + 1.25, y0: 0, y1: TRAIN_TOP, obj: tr, vz: 0, rideable: true, top: TRAIN_TOP });
      return;
    }

    // Движущиеся поезда — всегда за горизонтом
    if (r < 0.67) vz = rand(2.5, 5.0);
    else vz = rand(6.0, 10.0) + this.diff * 5;
    
    const startZ = z0 - GEN_AHEAD + 20;
    tr.position.set(x, 0, startZ);
    this.markShadow(tr);
    this.root.add(tr);
    this.colliders.push({
      x, z: startZ, w: 2.25, half: len / 2 + 1.25, y0: 0, y1: TRAIN_TOP,
      obj: tr, vz,
      rideable: true, top: TRAIN_TOP,
    });
  }

  /** Барьер, под которым нужно прокатиться кувырком */
  private addRollBar(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number, onCeil = false) {
    const o = MX.makeRollBar(loc, onCeil);
    o.position.set(LANES[lane], 0, -lz);
    node.add(o);
    this.trackAnim(o, z0);
    const y0 = onCeil ? 0 : ROLLBAR_Y0;
    const y1 = onCeil ? TUNNEL_H - ROLLBAR_Y0 : TUNNEL_H;
    this.addStaticCol(LANES[lane], z0 - lz, 2.1, 0.5, y0, y1);
  }

  private addFloorOb(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const o = MX.makeFloorObstacle(loc);
    o.position.set(LANES[lane], 0, -lz);
    node.add(o);
    this.addStaticCol(LANES[lane], z0 - lz, 2.0, 0.6, 0, FLOOR_H[loc] ?? 1.15);
  }

  private addCeilOb(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const o = MX.makeCeilObstacle(loc);
    o.position.set(LANES[lane], 0, -lz);
    node.add(o);
    // низ потолочного препятствия чуть выше, чтобы можно было проехать на крыше поезда
    this.addStaticCol(LANES[lane], z0 - lz, 1.95, 0.75, TUNNEL_H - 1.72, TUNNEL_H + 0.2);
  }

  private addBlock(node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const o = MX.makeBlock(loc);
    o.position.set(LANES[lane], 0, -lz);
    node.add(o);
    this.addStaticCol(LANES[lane], z0 - lz, 2.05, 0.65, 0, TUNNEL_H);
  }

  private addCoinLine(node: THREE.Group, x: number, y: number, z0: number, lz: number, n = 6, dz = 1.35) {
    for (let i = 0; i < n; i++) {
      const c = MX.makeCoin();
      const lzI = lz - ((n - 1) / 2) * dz + i * dz;
      c.position.set(x, y, lzI);
      c.rotation.y = Math.random();
      node.add(c);
      this.coins.push({ obj: c, x, y, z: z0 + lzI, taken: false });
    }
  }

  private buildTunnelHazards(node: THREE.Group, z0: number, loc: LocId) {
    if (this.safeChunks > 0) return;
    const cfg = LOCS[loc];

    // Бонусный чанк
    if (Math.random() < 0.1) {
      this.addCoinLine(node, 0, 1.2, z0, -15, 10, 2);
      if (cfg.hasCeiling) this.addCoinLine(node, 0, TUNNEL_H - 1.2, z0, -15, 10, 2);
      return;
    }

    const nSlices = this.diff > 0.4 ? 2 : 1;
    const poses = [7, 21];
    
    for (let s = 0; s < nSlices; s++) {
      const lz = poses[s];
      const lanes = shuffle([0, 1, 2]);
      
      // Рандомизируем сторону: 0 - пол, 1 - потолок, 2 - оба
      const side = (cfg.hasCeiling && Math.random() < 0.5) ? irand(0, 2) : 0;

      if (side === 0 || side === 2) {
        // Препятствия снизу
        const type = pick(['train', 'bar', 'roll', 'block']);
        if (type === 'train') this.addTrainStatic(node, z0, loc, lz, lanes[0]);
        else if (type === 'bar') this.addFloorOb(node, z0, loc, lz, lanes[0]);
        else if (type === 'roll') this.addRollBar(node, z0, loc, lz, lanes[0], false);
        else this.addBlock(node, z0, loc, lz, lanes[0]);
        this.addCoinLine(node, LANES[lanes[1]], 1.0, z0, -lz, 5, 1.8);
      }

      if (side === 1 || side === 2) {
        // Препятствия сверху
        if (cfg.hasCeiling) {
          const type = pick(['train', 'bar', 'roll']);
          const lane = side === 2 ? lanes[2] : lanes[0];
          if (type === 'train') this.addTrainCeil(node, z0, loc, lz + 2, lane);
          else if (type === 'bar') this.addCeilOb(node, z0, loc, lz, lane);
          else this.addRollBar(node, z0, loc, lz, lane, true);
          this.addCoinLine(node, LANES[side === 2 ? lanes[1] : lanes[2]], TUNNEL_H - 1.0, z0, -lz, 5, 1.8);
        }
      }
    }
  }

  private addTrainCeil(_node: THREE.Group, z0: number, loc: LocId, lz: number, lane: number) {
    const len = rand(10, 14);
    const tr = MX.makeTrain(len, TRAIN_SCHEMES[loc]);
    const x = LANES[lane];
    const z = z0 - lz;
    tr.position.set(x, TUNNEL_H, z);
    tr.rotation.z = Math.PI; // Переворачиваем поезд
    this.markShadow(tr);
    this.root.add(tr);
    this.colliders.push({
      x, z, w: 2.25, half: len / 2 + 1.25, y0: TUNNEL_H - TRAIN_TOP, y1: TUNNEL_H,
      obj: tr, vz: 0,
    });
  }

  // ──────────────────────────── замок: препятствия ──────────────
  private addCastleCoinArc(node: THREE.Group, x: number, z0: number, lz: number) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const c = MX.makeCoin();
      const lzI = lz - 3 + k * 6;
      const y = 0.9 + Math.sin(Math.PI * k) * 1.65;
      c.position.set(x, y, lzI);
      node.add(c);
      this.coins.push({ obj: c, x, y, z: z0 + lzI, taken: false });
    }
  }

  private buildCastleHazards(node: THREE.Group, z0: number) {
    // Правая стена: смещена еще сильнее, чтобы гарантированно закрыть старую дорогу
    this.addStaticCol(5.0, z0 - CHUNK / 2, 20, CHUNK / 2, 0, 12);
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
        node.add(o);
        this.addStaticCol(x, z0 - lz + (i === 1 ? 1.4 : 0), kind === 'rail' ? 2.1 : 1.4, 0.55, 0, h);
        if (i === 0 && Math.random() < 0.6) this.addCastleCoinArc(node, x, z0, -lz);
      }
      if (Math.random() < 0.55) {
        const freeLane = lanes[nOb];
        this.addCoinLine(node, CASTLE_LANES[freeLane], 1.0, z0, -lz, 5, 1.7);
      }
    }
  }

  // ──────────────────────────── встречные ───────────────────────
  spawnOncoming(zStart: number, speed: number, loc: LocId): 'train' | 'dragon' {
    const lane = irand(0, 2);
    if (loc === 'castle') {
      const d = MX.makeDragon(0xc62828, 1.35);
      d.rotation.y = Math.PI;
      const x = CASTLE_LANES[lane];
      const y = 1.75;
      d.position.set(x, y, zStart);
      // пламя из пасти
      const fire = MX.sprite(0xff7a1a, 1.6, 0.85);
      fire.position.set(0, 0.7, -2.4);
      d.add(fire);
      const inner = d.userData.tick as (t: number, dt: number) => void;
      d.userData.tick = (t: number, dt: number) => {
        inner(t, dt);
        d.position.y = y + Math.sin(t * 3.1) * 0.22;
        (fire.material as THREE.SpriteMaterial).opacity = 0.5 + Math.abs(Math.sin(t * 9)) * 0.5;
      };
      this.root.add(d);
      this.colliders.push({
        x, z: zStart, w: 2.5, half: 2.7, y0: 0.8, y1: 2.95,
        obj: d, vz: speed * 0.55 + 13,
      });
      return 'dragon';
    }
    const len = 15;
    const tr = MX.makeTrain(len, TRAIN_SCHEMES[loc]);
    const x = LANES[lane];
    tr.position.set(x, 0, zStart);
    this.markShadow(tr);
    this.root.add(tr);
    this.colliders.push({
      x, z: zStart, w: 2.25, half: len / 2 + 1.25, y0: 0, y1: TRAIN_TOP,
      obj: tr, vz: speed * 0.5 + 15,
      rideable: true, top: TRAIN_TOP,
    });
    return 'train';
  }
}
