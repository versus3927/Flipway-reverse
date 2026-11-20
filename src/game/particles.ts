import * as THREE from 'three';
import { glowTex } from './textures';

/** Пул частиц на Points — искры, пыль, конфетти */
export class Particles {
  points: THREE.Points;
  private cap = 200;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private ttl: Float32Array;
  private grav: Float32Array;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private tmp = new THREE.Color();
  private hasAlive = false;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.cap * 3);
    this.col = new Float32Array(this.cap * 3);
    this.vel = new Float32Array(this.cap * 3);
    this.life = new Float32Array(this.cap);
    this.ttl = new Float32Array(this.cap);
    this.grav = new Float32Array(this.cap);
    for (let i = 0; i < this.cap; i++) this.pos[i * 3 + 1] = -999;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    const mat = new THREE.PointsMaterial({
      size: 0.22, map: glowTex(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  lowSpec = false;

  spawn(x: number, y: number, z: number, color: number, n: number, spread = 2.4, up = 2, ttl = 0.7, grav = -6) {
    if (this.lowSpec) n = Math.max(2, Math.floor(n * 0.4));
    this.tmp.setHex(color);
    let placed = 0;
    for (let i = 0; i < this.cap && placed < n; i++) {
      if (this.life[i] > 0) continue;
      this.life[i] = this.ttl[i] = ttl * (0.6 + Math.random() * 0.7);
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = Math.random() * up;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      this.grav[i] = grav;
      const v = 0.7 + Math.random() * 0.5;
      this.col[i * 3] = this.tmp.r * v;
      this.col[i * 3 + 1] = this.tmp.g * v;
      this.col[i * 3 + 2] = this.tmp.b * v;
      placed++;
    }
    if (placed > 0) {
      this.hasAlive = true;
      this.points.visible = true;
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }

  update(dt: number) {
    if (!this.hasAlive) return;
    let alive = false;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      alive = true;
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.posAttr.needsUpdate = true;
    this.hasAlive = alive;
    if (!alive) this.points.visible = false;
  }

  shift(dz: number) {
    if (!this.hasAlive) return;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] > 0) this.pos[i * 3 + 2] += dz;
    }
    this.posAttr.needsUpdate = true;
  }
}

/** Полосы скорости по бокам при высокой скорости */
export class SpeedStreaks {
  private items: THREE.Mesh[] = [];
  private mat: THREE.MeshBasicMaterial;
  private geo: THREE.BoxGeometry;
  private active = false;
  disabled = false;

  constructor(scene: THREE.Scene) {
    this.geo = new THREE.BoxGeometry(0.05, 0.05, 3.4);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0x6fb5d8, transparent: true, opacity: 0.0,
      depthWrite: false,
    });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.visible = false;
      scene.add(m);
      this.items.push(m);
    }
  }

  update(dt: number, pz: number, speed: number, ceiling: number) {
    const should = !this.disabled && speed > 25;
    if (should !== this.active) {
      this.active = should;
      this.mat.opacity = should ? 0.22 : 0;
      for (const m of this.items) m.visible = should;
    }
    if (!should) return;
    for (const m of this.items) {
      m.position.z += (speed * 0.85 + 22) * dt;
      if (m.position.z > pz + 12 || !m.userData.live) {
        m.userData.live = true;
        m.position.z = pz - 60 - Math.random() * 70;
        const side = Math.random() < 0.5 ? -1 : 1;
        m.position.x = side * (2.8 + Math.random() * 3.4);
        m.position.y = 0.4 + Math.random() * (ceiling - 0.8);
      }
    }
  }
}
