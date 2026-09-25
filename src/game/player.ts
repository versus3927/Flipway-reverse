import * as THREE from 'three';
import { LANES, CASTLE_LANES, TUNNEL_H, PLAYER_H, MoveMode, easeInOut, easeOut } from './config';
import { boxGeo, sphGeo, cylGeo, M, std, lam, sprite } from './meshes';

export const ROLL_H = 0.78;     // высота хитбокса в кувырке
const ROLL_DUR = 0.62;

export class Player {
  group = new THREE.Group();   // мировая позиция
  rig = new THREE.Group();     // переворот гравитации
  pivot = new THREE.Group();   // пивот кувырка
  body = new THREE.Group();    // модель
  blob: THREE.Mesh;

  lane = 1;
  x = 0;
  private fromX = 0; private toX = 0; private laneT = 1; private laneDur = 0.16;

  mode: MoveMode = 'flip';
  laneSet: 'std' | 'castle' = 'std';

  flipT = 0;
  private flipFrom = 0; private flipTo = 0; private flipAnim = 1;
  flipping = false;
  onCeiling = false;

  private jumpT = 1;
  jumpY = 0;
  jumping = false;

  rolling = false;
  private rollT = 1;
  private rollQueued = false; // буфер кувырка

  /** Поверхность под ногами (0 — пол, 3.15 — крыша поезда) */
  platformY = 0;
  baseY = 0;
  private fallV = 0;
  onTrain = false;
  justBoarded = false;

  runPhase = 0;
  dead = false;
  private deadT = 0;
  private landPulse = 0;

  private armL: THREE.Group; private armR: THREE.Group;
  private legL: THREE.Group; private legR: THREE.Group;
  private headG: THREE.Group;
  private scarf: THREE.Mesh;
  private trail: THREE.Sprite;

  justFlipped = false; justLanded = false;

  // ── оглушение: звёздочки над головой ──
  private stars: THREE.Group;
  private starT = 0;
  stunned = false;

  constructor(scene: THREE.Scene) {
    // ═══ ЧИБИ-БОЕЦ (стиль Standoff 2) ═══
    const suit = std(0x2f3a4d, 0, 0, 0.85);        // тактический комбинезон
    const vestM = std(0x6d7a4f, 0, 0, 0.9);        // олива-жилет
    const dark = std(0x1a1f2b, 0, 0, 0.9);
    const glove = std(0x24303f, 0, 0, 0.85);
    const mask = std(0x171c26, 0, 0, 0.9);
    const skin = std(0xf0be95, 0, 0, 0.8);
    const orange = std(0xff7a29, 0xff5e00, 0.45, 0.6);

    // корпус — маленький (чиби-пропорции)
    const torso = M(boxGeo(0.5, 0.46, 0.32), suit, 0, 0.76, 0);
    this.body.add(torso);
    // тактический жилет с пластинами
    const vest = M(boxGeo(0.56, 0.4, 0.38), vestM, 0, 0.78, 0);
    this.body.add(vest);
    this.body.add(M(boxGeo(0.2, 0.14, 0.05), dark, -0.14, 0.7, 0.2));   // подсумки
    this.body.add(M(boxGeo(0.2, 0.14, 0.05), dark, 0.14, 0.7, 0.2));
    this.body.add(M(boxGeo(0.13, 0.1, 0.05), orange, 0, 0.9, 0.2));      // шеврон
    this.body.add(M(boxGeo(0.58, 0.07, 0.4), dark, 0, 0.6, 0));          // ремень
    this.body.add(M(boxGeo(0.1, 0.09, 0.04), orange, 0, 0.6, 0.21));     // пряжка
    // рюкзак-грави-модуль
    this.body.add(M(boxGeo(0.34, 0.34, 0.16), std(0x232c3b, 0, 0, 0.55, 0.35), 0, 0.8, -0.24));
    this.body.add(M(sphGeo(0.08, 8, 6), lam(0x3ddcff), 0, 0.88, -0.33));
    const gl = sprite(0x3ddcff, 0.7, 0.75); gl.position.set(0, 0.88, -0.34);
    this.body.add(gl);

    // ── БОЛЬШАЯ ГОЛОВА (чиби) ──
    this.headG = new THREE.Group();
    this.headG.position.set(0, 1.12, 0);
    const head = M(boxGeo(0.62, 0.58, 0.56), skin, 0, 0, 0);
    this.headG.add(head);
    // балаклава: закрывает низ лица и затылок
    this.headG.add(M(boxGeo(0.635, 0.26, 0.575), mask, 0, -0.16, 0));
    this.headG.add(M(boxGeo(0.635, 0.6, 0.2), mask, 0, 0.02, -0.19));
    this.headG.add(M(boxGeo(0.64, 0.18, 0.585), mask, 0, 0.23, 0));
    // тактические очки
    this.headG.add(M(boxGeo(0.66, 0.15, 0.06), std(0x0d1118, 0, 0, 0.4, 0.5), 0, 0.06, -0.28));
    const lensL = M(boxGeo(0.2, 0.11, 0.035), std(0x18e0ff, 0x18e0ff, 0.9, 0.2, 0.6), -0.14, 0.06, -0.31);
    const lensR = M(boxGeo(0.2, 0.11, 0.035), std(0x18e0ff, 0x18e0ff, 0.9, 0.2, 0.6), 0.14, 0.06, -0.31);
    this.headG.add(lensL, lensR);
    // кепка козырьком назад
    this.headG.add(M(boxGeo(0.66, 0.17, 0.6), std(0x33405a, 0, 0, 0.85), 0, 0.34, 0));
    this.headG.add(M(boxGeo(0.6, 0.05, 0.26), std(0x33405a, 0, 0, 0.85), 0, 0.29, 0.38));
    this.headG.add(M(boxGeo(0.12, 0.06, 0.03), orange, 0, 0.34, -0.31));
    // наушники-гарнитура
    this.headG.add(M(cylGeo(0.1, 0.1, 0.07, 8), dark, -0.33, 0.05, 0).rotateZ(Math.PI / 2));
    this.headG.add(M(cylGeo(0.1, 0.1, 0.07, 8), dark, 0.33, 0.05, 0).rotateZ(Math.PI / 2));
    this.body.add(this.headG);

    // шарф/платок развевается
    this.scarf = M(boxGeo(0.34, 0.5, 0.05), std(0xff7a29, 0xff5e00, 0.2, 0.9), 0, 0.72, -0.28);
    this.body.add(this.scarf);

    const mkLimb = (px: number, py: number, w: number, len: number, mat: THREE.Material, shoe: boolean) => {
      const g = new THREE.Group();
      g.position.set(px, py, 0);
      g.add(M(boxGeo(w, len, w), mat, 0, -len / 2 + 0.02, 0));
      if (shoe) {
        g.add(M(boxGeo(w + 0.05, 0.12, w + 0.16), std(0xf2f4f7, 0, 0, 0.55), 0, -len + 0.03, -0.04));
        g.add(M(boxGeo(w + 0.06, 0.04, w + 0.17), orange, 0, -len - 0.02, -0.04));
        g.add(M(boxGeo(w + 0.03, 0.11, w + 0.02), std(0x3a4658, 0, 0, 0.85), 0, -len * 0.55, 0.01)); // наколенник
      } else {
        g.add(M(boxGeo(w + 0.04, 0.14, w + 0.04), glove, 0, -len + 0.02, 0)); // перчатка
      }
      return g;
    };
    this.armL = mkLimb(-0.33, 0.94, 0.15, 0.44, suit, false);
    this.armR = mkLimb(0.33, 0.94, 0.15, 0.44, suit, false);
    this.legL = mkLimb(-0.14, 0.52, 0.18, 0.5, dark, true);
    this.legR = mkLimb(0.14, 0.52, 0.18, 0.5, dark, true);
    this.body.add(this.armL, this.armR, this.legL, this.legR);

    // ножны на бедре
    this.body.add(M(boxGeo(0.07, 0.24, 0.07), dark, 0.28, 0.5, 0.05));

    this.body.position.y = -0.45;
    this.pivot.position.y = 0.45;
    this.pivot.add(this.body);
    this.rig.add(this.pivot);
    this.group.add(this.rig);
    scene.add(this.group);

    // след скорости
    this.trail = sprite(0x3ddcff, 2.6, 0.0);
    this.group.add(this.trail);

    // ── звёздочки, кружащие над головой при оглушении ──
    this.stars = new THREE.Group();
    this.stars.visible = false;
    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 0.17 : 0.075;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) starShape.moveTo(px, py); else starShape.lineTo(px, py);
    }
    starShape.closePath();
    const starGeo = new THREE.ShapeGeometry(starShape);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xffd93b : 0xfff59d, side: THREE.DoubleSide,
        transparent: true, depthTest: false,
      });
      const s = new THREE.Mesh(starGeo, mat);
      s.renderOrder = 999;
      s.userData.idx = i;
      this.stars.add(s);
    }
    this.rig.add(this.stars);

    this.blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.36, depthWrite: false })
    );
    this.blob.rotation.x = -Math.PI / 2;
    scene.add(this.blob);
  }

  private lanesArr() { return this.laneSet === 'castle' ? CASTLE_LANES : LANES; }
  targetX() { return this.lanesArr()[this.lane]; }

  setLaneSet(s: 'std' | 'castle') {
    if (this.laneSet === s) return;
    this.laneSet = s;
    this.glideTo(this.targetX(), 1.15);
  }

  setMode(m: MoveMode) { this.mode = m; }

  private glideTo(x: number, dur: number) {
    this.fromX = this.x; this.toX = x; this.laneT = 0; this.laneDur = dur;
  }

  tryLane(dir: -1 | 1): boolean {
    if (this.dead) return false;
    const nl = Math.min(2, Math.max(0, this.lane + dir));
    if (nl === this.lane) return false;
    this.lane = nl;
    this.glideTo(this.targetX(), 0.28); // плавнее: было 0.17
    return true;
  }

  primary(): 'flip' | 'jump' | null {
    if (this.dead || this.rolling) return null;
    if (this.mode === 'flip') {
      // нельзя делать сальто, пока предыдущее не завершилось
      if (this.flipping) return null;
      this.flipFrom = this.flipT;
      this.flipTo = this.flipTo === 1 ? 0 : 1;
      this.flipAnim = 0;
      this.flipping = true;
      this.justFlipped = true;
      return 'flip';
    }
    return this.jump() ? 'jump' : null;
  }

  /** Обычный прыжок — работает на всех локациях */
  jump(): boolean {
    if (this.dead || this.rolling || this.flipping) return false;
    if (this.jumpT < 1) return false;
    this.jumpT = 0;
    this.jumping = true;
    return true;
  }

  /** Установить высоту опоры (крыша поезда / пол) */
  setPlatform(y: number) { this.platformY = y; }

  /** Идёт сальто с потолка вниз — в этот момент ищем опору заранее */
  get droppingToFloor() { return this.flipping && this.flipTo === 0; }

  /** Оглушение после лёгкого задевания — звёздочки над головой */
  stun(dur = 2.2) {
    this.starT = dur;
    this.stunned = true;
    this.stars.visible = true;
    this.landPulse = 1;
  }

  private updateStars(dt: number, t: number) {
    if (this.starT <= 0) return;
    this.starT -= dt;
    if (this.starT <= 0) {
      this.stars.visible = false;
      this.stunned = false;
      return;
    }
    const fade = Math.min(1, this.starT / 0.45);
    // звёздочки всегда над головой в мировой вертикали (компенсируем переворот)
    const flipped = this.flipT > 0.5;
    let starY = flipped ? -1.95 : 1.95;
    if (this.dead && this.landedDead) starY = 1.0; // ниже, так как сидит
    this.stars.position.set(0, starY, 0);
    this.stars.rotation.z = flipped ? Math.PI : 0;
    this.stars.children.forEach((s, i) => {
      const a = t * 4.2 + (i / 4) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.46, Math.sin(a * 2) * 0.1, Math.sin(a) * 0.3);
      s.rotation.z = t * 5 + i;
      const depth = (Math.sin(a) + 1) / 2;
      s.scale.setScalar(0.75 + depth * 0.45);
      (s as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = fade * (0.55 + depth * 0.45);
    });
  }

  /** Кувырок — проехать под барьером.
   *  Если в воздухе — запоминаем и делаем при приземлении. */
  roll(): boolean {
    if (this.dead || this.rolling || this.flipping) return false;
    if (this.jumpT < 1 || this.fallV > 0) {
      this.rollQueued = true;
      return true;
    }
    this.executeRoll();
    return true;
  }

  private executeRoll() {
    this.rolling = true;
    this.rollT = 0;
    this.rollQueued = false;
  }

  forceLand() {
    if (this.flipT > 0 || this.flipTo === 1 || this.flipping) {
      this.flipFrom = this.flipT;
      this.flipTo = 0;
      this.flipAnim = 0;
      this.flipping = true;
    }
  }

  bounds() {
    const feet = this.feetY();
    const k = this.flipT;
    const h = this.rolling ? ROLL_H : PLAYER_H;
    return { x: this.x, y0: feet - h * k, y1: feet + h * (1 - k) };
  }

  feetY() {
    const e = easeInOut(this.flipT);
    // На полу jumpY плюсует высоту. На потолке jumpY должен вычитать высоту (прыжок вниз к центру)
    const jumpDir = this.flipT > 0.5 ? -1 : 1;
    return this.baseY * (1 - e) + TUNNEL_H * e + (this.jumpY * jumpDir);
  }

  /** Обновление опоры: приземление на крышу поезда и падение с неё */
  private updateSupport(dt: number) {
    this.justBoarded = false;
    const airborne = this.jumpT < 1;
    const feet = this.feetY();
    const target = this.platformY;

    if (target > this.baseY + 0.02) {
      // при сальто с потолка опора подставляется сразу —
      // тогда ноги едут точно на крышу, а не сквозь корпус
      const snapOnFlip = this.droppingToFloor;
      if (snapOnFlip || feet <= target + 0.42 || (!airborne && !this.flipping)) {
        const wasLow = this.baseY < target - 0.5;
        this.baseY = target;
        this.fallV = 0;
        // пока мы ещё на потолке — опора просто «готовится», без фанфар
        if (wasLow && this.flipT < 0.5) {
          this.justBoarded = true;
          this.landPulse = 1;
          this.onTrain = target > 0.5;
        }
      }
    } else if (target < this.baseY - 0.02) {
      // опора исчезла — падаем
      this.fallV += 22 * dt;
      this.baseY = Math.max(target, this.baseY - this.fallV * dt);
      if (this.baseY <= target + 0.01) {
        this.baseY = target;
        this.fallV = 0;
        if (this.onTrain) { this.landPulse = 0.8; this.justLanded = true; }
        this.onTrain = false;
      }
    } else {
      this.fallV = 0;
      this.onTrain = this.baseY > 0.5 && this.flipT < 0.5;
    }
  }

  // ── физика отскока при смерти ──
  private bounceVY = 0;    // вертикальная скорость отскока
  private bounceVX = 0;    // боковой дрейф
  private bounceVZ = 0;    // отлёт назад
  private bounceY = 0;     // высота
  private landedDead = false;

  crash(bounceDir = 0) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.landedDead = false;
    // взлёт + отлёт назад + боковой дрейф
    this.bounceVY = 6.5 + Math.random() * 2;
    this.bounceVZ = 8.5 + Math.random() * 3.5;
    this.bounceVX = (bounceDir !== 0 ? bounceDir : (Math.random() < 0.5 ? 1 : -1)) * (1.2 + Math.random() * 1.5);
    this.bounceY = this.feetY();
    // включаем звёздочки
    this.stun(999);
  }

  reset() {
    this.dead = false; this.deadT = 0;
    this.lane = 1; this.x = 0; this.fromX = 0; this.toX = 0; this.laneT = 1;
    this.flipT = 0; this.flipTo = 0; this.flipAnim = 1; this.flipping = false; this.onCeiling = false;
    this.jumpT = 1; this.jumpY = 0; this.jumping = false;
    this.platformY = 0; this.baseY = 0; this.fallV = 0;
    this.onTrain = false; this.justBoarded = false;
    this.rolling = false; this.rollT = 1;
    this.starT = 0; this.stunned = false; this.stars.visible = false;
    this.laneSet = 'std'; this.mode = 'flip';
    this.rig.rotation.set(0, 0, 0);
    this.rig.position.y = 0;
    this.pivot.rotation.set(0, 0, 0);
    this.body.rotation.set(0.1, 0, 0);
    this.body.position.set(0, -0.45, 0);
    this.body.scale.set(1, 1, 1);
    this.group.position.set(0, 0, 0);
  }

  update(dt: number, speed: number, t: number) {
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / this.laneDur);
      this.x = this.fromX + (this.toX - this.fromX) * easeOut(this.laneT);
    }
    if (this.flipping) {
      this.flipAnim = Math.min(1, this.flipAnim + dt / 0.42);
      this.flipT = this.flipFrom + (this.flipTo - this.flipFrom) * easeInOut(this.flipAnim);
      if (this.flipAnim >= 1) {
        this.flipping = false;
        this.onCeiling = this.flipT > 0.5;
        this.landPulse = 1;
        this.justLanded = true;
      }
    }
    if (this.jumpT < 1) {
      this.jumpT = Math.min(1, this.jumpT + dt / 0.62);
      // высота 1.95 — НИЖЕ крыши поезда (2.95): перепрыгиваем препятствия,
      // но на состав попадаем только сальто с потолка
      this.jumpY = Math.sin(Math.PI * this.jumpT) * 1.95;
      if (this.jumpT >= 1) {
        this.jumpY = 0; this.landPulse = 1; this.justLanded = true; this.jumping = false;
        if (this.rollQueued) this.executeRoll(); // выполняем отложенный кувырок
      }
    }
    this.updateSupport(dt);
    if (this.justLanded && this.rollQueued) this.executeRoll();
    this.updateStars(dt, t);
    if (this.rolling) {
      this.rollT = Math.min(1, this.rollT + dt / ROLL_DUR);
      if (this.rollT >= 1) { this.rolling = false; this.landPulse = 0.7; }
    }

    // ── после смерти — физика отскока и приземление на попу ──
    if (this.dead) {
      this.deadT += dt;
      this.updateStars(dt, t);

      // физика полёта
      this.bounceVY -= 22 * dt;
      this.bounceY += this.bounceVY * dt;
      const groundY = this.baseY;

      if (this.bounceY <= groundY) {
        this.bounceY = groundY;
        if (this.bounceVY < -2.5) {
          this.bounceVY = Math.abs(this.bounceVY) * 0.25; // слабый отскок
        } else {
          this.bounceVY = 0;
          this.landedDead = true;
        }
      }

      if (!this.landedDead) {
        // летим назад и вбок
        this.group.position.z += this.bounceVZ * dt;
        this.group.position.x += this.bounceVX * dt;
        // кувыркаемся в воздухе
        this.rig.rotation.x -= dt * 10;
        this.rig.rotation.z += this.bounceVX * dt * 2;
      } else {
        // ПРИЗЕМЛИЛСЯ НА ПОПУ (сидит)
        this.rig.rotation.x += ((-Math.PI * 0.05) - this.rig.rotation.x) * Math.min(1, dt * 10);
        this.rig.rotation.z += (0 - this.rig.rotation.z) * Math.min(1, dt * 8);
        this.pivot.rotation.x += (0 - this.pivot.rotation.x) * Math.min(1, dt * 10);
        this.body.position.y += (-0.68 - this.body.position.y) * Math.min(1, dt * 10);
        // ноги вперёд (сидит)
        this.legL.rotation.x += (-1.4 - this.legL.rotation.x) * Math.min(1, dt * 12);
        this.legR.rotation.x += (-1.35 - this.legR.rotation.x) * Math.min(1, dt * 12);
        this.legL.rotation.y = 0.3; this.legR.rotation.y = -0.3;
        // руки бессильно в стороны
        this.armL.rotation.z += (0.8 - this.armL.rotation.z) * Math.min(1, dt * 8);
        this.armR.rotation.z += (-0.8 - this.armR.rotation.z) * Math.min(1, dt * 8);
        this.armL.rotation.x = this.armR.rotation.x = 0.4;
        // голова понуро опущена и шатается
        this.headG.rotation.x += (0.35 - this.headG.rotation.x) * Math.min(1, dt * 6);
        this.headG.rotation.y = Math.sin(t * 3.5) * 0.15;
      }

      this.rig.position.y = this.bounceY;
      this.blob.position.set(this.group.position.x, groundY + 0.02, this.group.position.z);
      this.blob.scale.setScalar(Math.max(0.01, 0.65 - Math.min(0.4, this.deadT * 0.2)));
      (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.3;
      (this.trail.material as THREE.SpriteMaterial).opacity = 0;
      return;
    }

    const feet = this.feetY();
    this.rig.position.y = feet;
    this.rig.rotation.z = easeInOut(this.flipT) * Math.PI;
    this.group.position.x = this.x;

    // ── кувырок: вращение вперёд, размер НЕ меняется ──
    if (this.rolling) {
      const p = this.rollT;
      const spin = -Math.PI * 2 * easeInOut(p);
      this.pivot.rotation.x = spin;
      this.body.scale.set(1, 1, 1);
      this.body.position.y = -0.45;
      this.legL.rotation.x = -1.5; this.legR.rotation.x = -1.4;
      this.armL.rotation.x = -2.2; this.armR.rotation.x = -2.1;
      this.headG.rotation.x = 0.4;
      this.body.rotation.x = 0;
    } else {
      this.pivot.rotation.x += (0 - this.pivot.rotation.x) * Math.min(1, dt * 14);
      this.headG.rotation.x += (0 - this.headG.rotation.x) * Math.min(1, dt * 12);
      const rate = 7 + speed * 0.42;
      this.runPhase += dt * rate;
      const p = this.runPhase;
      const amp = this.jumpT < 1 ? 0.35 : 0.95;
      this.legL.rotation.x = Math.sin(p) * amp;
      this.legR.rotation.x = Math.sin(p + Math.PI) * amp;
      this.armL.rotation.x = Math.sin(p + Math.PI) * amp * 0.8;
      this.armR.rotation.x = Math.sin(p) * amp * 0.8;
      this.armL.rotation.z = 0.24; this.armR.rotation.z = -0.24;
      this.body.rotation.x = 0.1 + Math.sin(p * 2) * 0.02;
      const bob = Math.abs(Math.sin(p)) * 0.06;
      const vx = this.laneT < 1 ? (this.toX - this.fromX) : 0;
      this.body.rotation.z = THREE.MathUtils.clamp(-vx * 0.18 * (1 - this.laneT), -0.42, 0.42);
      this.headG.rotation.y = Math.sin(t * 0.8) * 0.07;
      this.headG.rotation.z = Math.sin(p) * 0.04;
      // оглушён — шатает из стороны в сторону
      if (this.stunned) {
        this.body.rotation.z += Math.sin(t * 11) * 0.16;
        this.headG.rotation.z += Math.sin(t * 9) * 0.22;
        this.body.rotation.x += Math.sin(t * 7) * 0.05;
      }
      this.scarf.rotation.x = -0.5 - Math.sin(t * 9) * 0.22;
      this.scarf.position.z = -0.28 - Math.sin(t * 9) * 0.05;

      if (this.landPulse > 0) {
        this.landPulse = Math.max(0, this.landPulse - dt * 5);
        const s = 1 - Math.sin(this.landPulse * Math.PI) * 0.14;
        this.body.scale.set(1 / s, s, 1 / s);
        this.body.position.y = -0.45 + bob;
      } else {
        this.body.scale.set(1, 1, 1);
        this.body.position.y = -0.45 + bob;
      }
    }

    // след при большой скорости
    const tm = this.trail.material as THREE.SpriteMaterial;
    tm.opacity += ((speed > 26 ? 0.3 : 0) - tm.opacity) * Math.min(1, dt * 3);
    this.trail.position.set(0, feet + 0.7, 1.3);

    // тень — ложится на пол или на крышу поезда
    const surfY = this.flipT > 0.5 ? TUNNEL_H : this.baseY;
    this.blob.position.set(this.x, surfY + (this.flipT > 0.5 ? -0.02 : 0.03), this.group.position.z);
    this.blob.rotation.x = this.flipT > 0.5 ? Math.PI / 2 : -Math.PI / 2;
    const hAbove = Math.abs(feet - surfY);
    const sc = Math.max(0.35, 1 - hAbove * 0.18) * (this.rolling ? 1.15 : 1);
    this.blob.scale.setScalar(sc);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.36 * Math.min(1, sc);
  }
}
