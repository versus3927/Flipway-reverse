import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LOCS, LocId, TUNNEL_H, css, rand } from './config';
import { World } from './world';
import { Player } from './player';
import { Particles, SpeedStreaks } from './particles';
import { SFX } from './audio';
import { Input, InputAction } from './input';

export interface HudData { dist: number; coins: number; speed: number; best: number; onTrain: boolean; }
export interface GameCallbacks {
  hud(d: HudData): void;
  banner(title: string, sub: string, color: string): void;
  state(s: 'menu' | 'play' | 'dead'): void;
  warn(kind: 'train' | 'dragon' | 'fire' | null): void;
  loc(l: LocId): void;
  over(r: { dist: number; coins: number; score: number; best: number; isRecord: boolean }): void;
  pauseChange(p: boolean): void;
  /** Запущено окно «на грани»: t секунд до безопасности (0 — снято) */
  graze(t: number): void;
}

const lerpC = (a: THREE.Color, b: THREE.Color, k: number) => {
  a.r += (b.r - a.r) * k; a.g += (b.g - a.g) * k; a.b += (b.b - a.b) * k;
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private hemi: THREE.HemisphereLight;
  private dir: THREE.DirectionalLight;
  private point: THREE.PointLight;
  private rim: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private heroLight: THREE.PointLight;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private lowSpec: boolean;

  private world: World;
  private player: Player;
  private particles: Particles;
  private streaks: SpeedStreaks;
  private sfx = new SFX();
  private input: Input;
  private cb: GameCallbacks;

  private state: 'menu' | 'play' | 'dying' | 'dead' = 'menu';
  private paused = false;
  private pz = 0;
  private speed = 0;
  private dist = 0;
  private coinCount = 0;
  private elapsed = 0;
  private best = 0;
  private oncT = 6;
  private curLoc: LocId = 'metro';
  private shake = 0;
  private timeScale = 1;
  private dieTimer = 0;
  private nextMile = 500;
  // ── система задеваний ──
  private grazeWindow = 0;   // сколько секунд ещё «на грани» (20 → 0)
  private invulnT = 0;       // неуязвимость сразу после задевания
  private fireT = 3;         // таймер огненных атак дракона
  private hudT = 0;
  private last = 0;
  private raf = 0;
  private t = 0;
  private camFov = 62;
  private camRotZ = 0; // угол переворота камеры

  // цветовые цели для плавного перехода локаций
  private tgt = {
    bg: new THREE.Color(LOCS.metro.bg),
    fog: new THREE.Color(LOCS.metro.fog),
    fogNear: LOCS.metro.fogNear,
    fogFar: LOCS.metro.fogFar,
    hemiSky: new THREE.Color(LOCS.metro.hemiSky),
    hemiGround: new THREE.Color(LOCS.metro.hemiGround),
    sun: new THREE.Color(LOCS.metro.sunColor),
  };

  constructor(private mount: HTMLElement, cb: GameCallbacks) {
    this.cb = cb;
    // качество: слабые/мобильные устройства — без теней, лёгкий bloom
    const isTouch = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency ?? 4;
    this.lowSpec = isTouch || cores <= 4;

    // на мобильных антиалиас не нужен (высокий DPI итак сглаживает), экономим GPU
    this.renderer = new THREE.WebGLRenderer({ antialias: !this.lowSpec, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(mount.clientWidth, mount.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    if (!this.lowSpec) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    mount.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(LOCS.metro.bg);
    this.scene.fog = new THREE.Fog(LOCS.metro.fog, LOCS.metro.fogNear, LOCS.metro.fogFar);

    this.camera = new THREE.PerspectiveCamera(62, mount.clientWidth / mount.clientHeight, 0.1, 420);
    this.camera.position.set(0, 3.1, 8.6);

    this.hemi = new THREE.HemisphereLight(LOCS.metro.hemiSky, LOCS.metro.hemiGround, LOCS.metro.hemiInt);
    this.scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(LOCS.metro.sunColor, LOCS.metro.sunInt);
    this.dir.position.set(8, 16, 6);
    if (!this.lowSpec) {
      this.dir.castShadow = true;
      this.dir.shadow.mapSize.set(1024, 1024);
      const sc = this.dir.shadow.camera as THREE.OrthographicCamera;
      sc.left = -13; sc.right = 13; sc.top = 16; sc.bottom = -13;
      sc.near = 1; sc.far = 62;
      this.dir.shadow.bias = -0.0022;
      this.dir.shadow.normalBias = 0.03;
      this.scene.add(this.dir.target);
    }
    this.scene.add(this.dir);

    // мягкий заполняющий свет — тени остаются читаемыми
    this.ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(this.ambient);

    // контровой свет — объём и красивый силуэт
    this.rim = new THREE.DirectionalLight(0x8fdcff, 0.7);
    this.rim.position.set(-10, 7, -14);
    this.scene.add(this.rim);

    this.point = new THREE.PointLight(LOCS.metro.accent2, 22, 30, 2);
    this.scene.add(this.point);

    // персональная подсветка героя
    this.heroLight = new THREE.PointLight(0xffffff, 9, 9, 2);
    this.scene.add(this.heroLight);

    this.world = new World(this.scene);
    this.world.shadows = !this.lowSpec;
    this.player = new Player(this.scene);
    if (!this.lowSpec) {
      this.player.group.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
    }
    this.particles = new Particles(this.scene);
    this.streaks = new SpeedStreaks(this.scene);

    // ── постобработка: bloom для неона и солнца ──
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      this.lowSpec ? 0.55 : 0.8,  // сила
      0.85,                        // радиус
      this.lowSpec ? 0.35 : 0.24   // порог
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.applyPerfProfile();
    this.best = Number(localStorage.getItem('gr_best') || 0);

    this.input = new Input(this.renderer.domElement, (a) => this.onAction(a));
    window.addEventListener('resize', this.onResize);

    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ─────────────────────────── публичное ───────────────────────────
  start() {
    this.sfx.ensure();
    this.sfx.startMusic();
    this.sfx.uiClick();
    this.world.reset();
    this.player.reset();
    this.pz = 0;
    this.dist = 0;
    this.coinCount = 0;
    this.elapsed = 0;
    this.speed = 22; // Быстрее со старта! (было 15)
    this.oncT = 6.5;
    this.shake = 0;
    this.timeScale = 1;
    this.nextMile = 500;
    this.grazeWindow = 0;
    this.invulnT = 0;
    this.fireT = 3.5;
    this.cb.graze(0);
    this.world.setPugPack(false);
    this.world.setBossDragon(false);
    this.world.clearFire();
    this.curLoc = 'metro';
    this.snapColors(LOCS.metro);
    this.state = 'play';
    this.paused = false;
    this.cb.state('play');
    this.cb.loc('metro');
    this.cb.banner('НЕОН-СИТИ', 'Погнали! Уворачивайся от поездов', css(LOCS.metro.accent));
    this.cb.hud({ dist: 0, coins: 0, speed: 54, best: this.best, onTrain: false });
  }

  toMenu() {
    this.world.setPugPack(false);
    this.world.setBossDragon(false);
    this.world.reset();
    this.player.reset();
    this.pz = 0;
    this.state = 'menu';
    this.paused = false;
    this.timeScale = 1;
    this.curLoc = 'metro';
    this.snapColors(LOCS.metro);
    this.cb.state('menu');
  }

  togglePause() {
    if (this.state !== 'play' && this.state !== 'dying') return;
    this.paused = !this.paused;
    this.cb.pauseChange(this.paused);
    if (this.sfx) {
      if (this.paused) (this.sfx as unknown as { ctx?: AudioContext }).ctx?.suspend();
      else (this.sfx as unknown as { ctx?: AudioContext }).ctx?.resume();
    }
  }

  pauseIfPlaying() {
    if (this.state === 'play' && !this.paused) this.togglePause();
  }

  suspendAudio() {
    (this.sfx as unknown as { ctx?: AudioContext }).ctx?.suspend();
  }

  resumeAudio() {
    // звук возобновляется, если только не стоит на паузе в игре
    if (!this.paused) (this.sfx as unknown as { ctx?: AudioContext }).ctx?.resume();
  }

  setMuted(m: boolean) {
    this.sfx.ensure();
    this.sfx.setMuted(m);
  }

  /** Оптимизация для слабых телефонов.
   *  Разрешение НЕ снижается — убираем тени, bloom, декоративные частицы, спрайты скорости. */
  setOptimizationMode(on: boolean) {
    this.lowSpec = on;
    this.applyPerfProfile();
  }

  private applyPerfProfile() {
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, 2));

    // тени — самый тяжёлый элемент
    this.renderer.shadowMap.enabled = !this.lowSpec;
    this.world.shadows = !this.lowSpec;
    this.dir.castShadow = !this.lowSpec;

    // bloom — полностью отключаем проход на слабых (экономит целый рендер-пасс)
    this.bloom.strength = this.lowSpec ? 0.0 : 0.14;
    this.bloom.radius = this.lowSpec ? 0.0 : 0.85;
    this.bloom.threshold = this.lowSpec ? 999 : 0.9; // порог 999 = ничего не светится

    // лишние источники света — отключаем
    this.heroLight.intensity = this.lowSpec ? 0 : 9;
    this.rim.intensity = this.lowSpec ? 0 : 0.4;
    this.point.intensity = this.lowSpec ? 0 : 3;

    // тени на объектах
    this.player.group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = !this.lowSpec;
      m.receiveShadow = !this.lowSpec;
    });

    // частицы — значительно меньше
    this.particles.lowSpec = this.lowSpec;

    // туман ближе — меньше объектов рендерится
    if (this.lowSpec) {
      const fog = this.scene.fog as THREE.Fog;
      fog.near = Math.min(fog.near, 35);
      fog.far = Math.min(fog.far, 140);
    }

    // антиалиасинг нельзя переключить в runtime, но PixelRatio остаётся максимальным
    this.setTargets(LOCS[this.curLoc]);
    this.onResize();
  }

  /** Действие с экранных кнопок */
  doAction(a: InputAction) { this.onAction(a); }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.sfx.stopMusic();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }

  // ─────────────────────────── ввод ───────────────────────────
  private onAction(a: InputAction) {
    this.sfx.ensure();
    if (a === 'pause') { this.togglePause(); return; }
    if (this.state !== 'play' || this.paused) return;
    if (a === 'left' || a === 'right') {
      const dir = a === 'left' ? -1 : 1;
      // проверяем: нет ли препятствия/поезда вплотную сбоку?
      let blocked = false;
      if (this.state === 'play') {
        const pb = this.player.bounds();
        for (const c of this.world.colliders) {
          const dzc = c.z - this.pz;
          if (Math.abs(dzc) > c.half + 0.5) continue;
          // объект сбоку в нужном направлении
          const sideGap = Math.abs(c.x - pb.x) - c.w / 2 - 0.34;
          if (sideGap < 1.2 && sideGap > -0.3 && Math.sign(c.x - pb.x) === dir) {
            // перекрытие по Y — действительно на нашей высоте
            if (c.y1 > pb.y0 + 0.1 && c.y0 < pb.y1 - 0.1) {
              // едем на крыше — не блокировать
              if (c.rideable && c.top !== undefined && pb.y0 >= (c.top ?? 0) - 0.55) continue;
              // ОТСКОК от борта — звёздочки, но не переходим на ту дорожку
              blocked = true;
              this.graze(c.x, pb);
              this.sfx.bump();
              this.shake = Math.max(this.shake, 0.5);
              this.particles.spawn(
                (c.x + pb.x) / 2, this.player.feetY() + 0.8, this.pz,
                LOCS[this.curLoc].accent2, 12, 2.4, 1.8, 0.5
              );
              break;
            }
          }
        }
      }
      if (!blocked && this.player.tryLane(dir)) {
        this.sfx.laneTick();
        this.particles.spawn(this.player.x, 0.15, this.pz, 0x9fdcff, 4, 1.6, 1.2, 0.4);
      }
    } else if (a === 'action') {
      const r = this.player.primary();
      if (r === 'flip') {
        this.sfx.whoosh();
        this.particles.spawn(this.player.x, this.player.feetY() + 0.2, this.pz, 0x22e0ff, 8, 2.4, 2, 0.5);
      } else if (r === 'jump') {
        this.sfx.jumpS();
        this.particles.spawn(this.player.x, 0.1, this.pz, 0xffe9a8, 6, 2, 1.4, 0.4);
      }
    } else if (a === 'up') {
      // ПРЫЖОК — работает везде, им же запрыгиваем на поезда
      if (this.player.jump()) {
        this.sfx.jumpS();
        this.particles.spawn(this.player.x, this.player.feetY() + 0.1, this.pz, 0xffe9a8, 8, 2.2, 1.6, 0.45);
      }
    } else if (a === 'down') {
      // КУВЫРОК — проехать под барьером
      if (this.player.roll()) {
        this.sfx.whoosh();
        const fy = this.player.feetY();
        this.particles.spawn(this.player.x, fy + 0.15, this.pz, 0xffffff, 9, 2.6, 1.1, 0.45);
        this.particles.spawn(this.player.x, fy + 0.15, this.pz, LOCS[this.curLoc].accent2, 6, 2.2, 1.4, 0.5);
        this.shake = Math.max(this.shake, 0.22);
      }
    }
  }

  // ─────────────────────────── цикл ───────────────────────────
  private tick(now: number) {
    let dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.paused) { this.composer.render(); return; }
    this.t += dt;
    const t = this.t;

    if (this.state === 'dying') {
      this.timeScale += (0.22 - this.timeScale) * Math.min(1, dt * 8);
      this.dieTimer += dt;
    } else {
      this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 4);
    }
    dt *= this.timeScale;

    const playing = this.state === 'play' || this.state === 'dying';
    const diff = Math.min(1, this.elapsed / 100 + this.dist / 7000);

    if (playing) {
      if (this.state === 'play') {
        this.elapsed += dt;
        // окно «на грани» после лёгкого задевания
        if (this.invulnT > 0) this.invulnT = Math.max(0, this.invulnT - dt);
        if (this.grazeWindow > 0) {
          this.grazeWindow = Math.max(0, this.grazeWindow - dt);
          if (this.grazeWindow === 0) {
            this.sfx.safe();
            this.cb.graze(0);
            this.cb.banner('ПРОНЕСЛО!', 'Ты снова в полной форме', '#4ade80');
          }
        }
        this.world.diff = diff;
        this.speed = Math.min(38, 15 + this.elapsed * 0.14 + this.dist * 0.0012);
        this.dist += this.speed * dt;
        this.pz -= this.speed * dt;
      }

      // перебазировка координат
      if (this.pz < -15000) {
        const dz = -this.pz;
        this.pz = 0;
        this.world.shift(dz);
        this.particles.shift(dz);
        this.camera.position.z += dz;
      }

      if (this.state === 'play') this.player.group.position.z = this.pz;
      if (this.state === 'play' && this.player.justLanded) {
        this.sfx.land();
        this.particles.spawn(this.player.x, this.player.feetY() + 0.1, this.pz, 0xffffff, 6, 2, 1, 0.35);
      }
      this.player.justLanded = false;

      // встречные поезда / драконы
      this.oncT -= dt;
      if (this.oncT <= 0) {
        const kind = this.world.spawnOncoming(this.pz - 280, this.speed, this.curLoc);
        if (kind === 'train') { this.sfx.horn(); this.cb.warn('train'); }
        else { this.sfx.roar(); this.cb.warn('dragon'); }
        this.oncT = rand(5.0, 8.0) - diff * 2.2;
      }

      // ── дракон плюётся огнём (только на его локации) ──
      if (this.curLoc === 'castle') {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          const salvo = Math.random() < 0.35 + diff * 0.3 ? 2 : 1;
          const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
          for (let i = 0; i < salvo; i++) {
            this.world.spawnFireball(this.pz, lanes[i], Math.random() < 0.6);
          }
          this.world.bossAttack();
          this.sfx.fire();
          this.cb.warn('fire');
          this.fireT = rand(3.4, 5.6) - diff * 1.4;
        }
      }

      // события мира
      for (const ev of this.world.pollEvents(this.pz)) {
        if (ev.type === 'loc' && ev.loc) {
          this.curLoc = ev.loc;
          // стая мопсов бежит рядом только на их улице
          this.world.setPugPack(ev.loc === 'pugs');
          this.world.setBossDragon(ev.loc === 'castle');
          if (ev.loc !== 'castle') this.world.clearFire();
          else this.fireT = 3.5;
          const cfg = LOCS[ev.loc];
          this.cb.banner(cfg.name, cfg.sub, css(cfg.accent));
          this.cb.loc(ev.loc);
          this.sfx.setRoot(cfg.musicRoot);
          this.sfx.milestone();
          this.setTargets(cfg);
        } else if (ev.type === 'preCastle') {
          this.player.setLaneSet('castle');
          this.cb.banner('ШИПЫ И ЛЕСТНИЦА!', 'Главные дорожки закрыты — поднимайся на красную лестницу', '#ffb300');
          this.sfx.milestone();
        } else if (ev.type === 'mode' && ev.mode === 'jump') {
          this.player.setMode('jump');
          this.player.forceLand();
        } else if (ev.type === 'exitCastle') {
          this.player.setLaneSet('std');
          this.player.setMode('flip');
          setTimeout(() => {
            if (this.state === 'play') {
              this.cb.banner('ПОТОЛОК СНОВА ДОСТУПЕН', 'Улица замка заканчивается — назад, на основную дорогу', '#ffffff');
            }
          }, 1600);
        }
      }

      // столкновения + поиск опоры (крыши поездов)
      if (this.state === 'play') {
        const pb = this.player.bounds();
        let support = 0;
        for (const c of this.world.colliders) {
          const dzc = c.z - this.pz;
          const overZ = dzc >= -c.half - 0.35 && dzc <= c.half + 0.35;
          const overX = Math.abs(c.x - pb.x) <= c.w / 2 + 0.34;
          // падаем с потолка сальтом — крыша ловит нас заранее
          const dropping = this.player.droppingToFloor;
          const tol = dropping ? 99 : 0.55;
          // крыша поезда как платформа
          if (c.rideable && c.top !== undefined && overX && overZ) {
            if (dropping || pb.y0 >= c.top - tol) support = Math.max(support, c.top);
          }
          if (!overZ || !overX) continue;
          if (c.y1 <= pb.y0 + 0.05 || c.y0 >= pb.y1 - 0.05) continue;
          // едем по крыше или приземляемся на неё — это не столкновение
          if (c.rideable && c.top !== undefined && (dropping || pb.y0 >= c.top - tol)) continue;
          
          // РАЗДЕЛЕНИЕ ПРЕПЯТСТВИЙ:
          // Если мы на потолке (flipT > 0.5), то препятствия у пола (c.y1 < 3.2) нас не трогают.
          // Если мы на полу (flipT < 0.5), то препятствия у потолка (c.y0 > 3.2) нас не трогают.
          const onCeiling = this.player.flipT > 0.5;
          if (onCeiling && c.y1 < 3.2) continue; // летим над ними
          if (!onCeiling && c.y0 > 3.2) continue; // бежим под ними
          
          // перепрыгнули: если ноги игрока выше верха препятствия — пропускаем
          if (pb.y0 > c.y1 - 0.12 && !onCeiling) continue;
          if (this.invulnT > 0) continue;

          // ── определяем тип удара: боковой или лобовой ──
          const ovX = (c.w / 2 + 0.34) - Math.abs(c.x - pb.x);
          const ovZ = (c.half + 0.35) - Math.abs(dzc);
          // боковой удар: X-перекрытие мало, Z-перекрытие велико → врезались боком
          const sideHit = ovX < 0.65 && ovZ > 0.5;
          const headOn = (c.vz ?? 0) > 11;

          // ── ВЫТОЛКНУТЬ из объекта (никогда не заходим внутрь) ──
          const pushDir = Math.sign(pb.x - c.x);
          const pushDist = ovX + 0.08;
          this.player.x += pushDir * pushDist;
          this.player.group.position.x = this.player.x;

          if (sideHit && !headOn) {
            // БОКОВОЙ УДАР — всегда только звёздочки, откинуть назад на дорожку
            this.graze(c.x, pb);
            // вернуть игрока на прошлую дорожку
            const lanes = this.player.laneSet === 'castle'
              ? [this.player.targetX() - 2.3, this.player.targetX(), this.player.targetX() + 2.3]
              : undefined;
            void lanes;
            this.player.tryLane(-pushDir as -1 | 1); // отскочить обратно
          } else if (!headOn && ovX < 0.4) {
            // лёгкий лобовой — задевание
            this.graze(c.x, pb);
          } else {
            // ФАТАЛЬНЫЙ лобовой удар
            this.crash(pushDir);
          }
          break;
        }
        // ── попадание огненного шара ──
        for (const f of this.world.fireballs) {
          const dzf = f.z - this.pz;
          if (Math.abs(dzf) > 1.0) continue;
          if (Math.abs(f.x - pb.x) > 0.95) continue;
          if (f.y < pb.y0 - 0.85 || f.y > pb.y1 + 0.85) continue;
          if (this.invulnT > 0) continue;
          this.sfx.burn();
          this.particles.spawn(f.x, f.y, f.z, 0xff6b00, 20, 4, 3, 0.8);
          this.particles.spawn(f.x, f.y, f.z, 0xffd166, 12, 3.2, 3.5, 0.7);
          this.world.clearFire();
          // огонь тоже щадит при первом касании
          if (this.grazeWindow > 0) this.crash(Math.sign(pb.x - f.x));
          else this.graze(f.x, pb);
          break;
        }

        this.player.setPlatform(support);
        if (this.player.justBoarded) {
          this.sfx.land();
          this.shake = Math.max(this.shake, 0.32);
          this.particles.spawn(this.player.x, this.player.baseY + 0.1, this.pz, 0xffffff, 12, 3.0, 1.8, 0.55);
          this.particles.spawn(this.player.x, this.player.baseY + 0.1, this.pz, LOCS[this.curLoc].accent2, 8, 2.4, 2.0, 0.5);
          this.cb.banner('НА КРЫШЕ ПОЕЗДА!', 'Держись — и уходи, пока состав не ушёл', css(LOCS[this.curLoc].accent2));
        }
        // монетки
        for (const cn of this.world.coins) {
          if (cn.taken) continue;
          const dzc = cn.z - this.pz;
          if (Math.abs(dzc) > 0.95) continue;
          if (Math.abs(cn.x - pb.x) > 0.8) continue;
          if (cn.y < pb.y0 - 0.95 || cn.y > pb.y1 + 0.95) continue;
          cn.taken = true;
          cn.obj.visible = false;
          this.coinCount++;
          this.sfx.coin();
          this.particles.spawn(cn.x, cn.y, cn.z, 0xffd166, 7, 2.2, 2.4, 0.5);
        }
      }

      // милы
      if (this.dist >= this.nextMile) {
        this.sfx.milestone();
        this.particles.spawn(this.player.x, 2, this.pz - 2, 0x22e0ff, 16, 4, 4, 0.9);
        if (this.nextMile % 1000 === 0) {
          this.cb.banner(`${this.nextMile} МЕТРОВ!`, 'Отличный темп — не сбавляй', css(LOCS[this.curLoc].accent));
        }
        this.nextMile += 500;
      }
    }

    // мир и игрок обновляются всегда (в меню — фоновая сцена)
    if (!this.paused) {
      this.world.update(dt, this.pz, t, this.speed);
      this.player.update(dt, this.state === 'menu' ? 2.5 : this.speed, t);
      this.particles.update(dt);
      this.streaks.update(dt, this.pz, this.state === 'play' ? this.speed : 0, TUNNEL_H);
    }

    // камера
    this.updateCamera(dt, t);

    // свет следует за игроком
    this.point.position.set(this.player.x * 0.6, 4.4, this.pz - 4);
    const castle = this.curLoc === 'castle';
    const lx = castle ? -6.9 : 0;
    this.dir.position.set(lx + 9, 19, this.pz + 6);
    if (this.dir.castShadow) {
      this.dir.target.position.set(lx, 0.5, this.pz - 12);
      this.dir.target.updateMatrixWorld();
    }
    this.rim.position.set(lx - 11, 8, this.pz - 22);
    this.heroLight.position.set(this.player.x, this.player.feetY() + 1.2, this.pz + 1.1);
    this.heroLight.intensity = this.state === 'menu' ? 6 : 9;

    // плавная смена палитры
    const k = Math.min(1, dt * 2.2);
    lerpC(this.scene.background as THREE.Color, this.tgt.bg, k);
    const fog = this.scene.fog as THREE.Fog;
    lerpC(fog.color, this.tgt.fog, k);
    fog.near += (this.tgt.fogNear - fog.near) * k;
    fog.far += (this.tgt.fogFar - fog.far) * k;
    lerpC(this.hemi.color, this.tgt.hemiSky, k);
    lerpC(this.hemi.groundColor, this.tgt.hemiGround, k);
    lerpC(this.dir.color, this.tgt.sun, k);

    // HUD с троттлингом
    if (playing) {
      this.hudT -= dt;
      if (this.hudT <= 0) {
        this.hudT = 0.1;
        this.cb.hud({
          dist: Math.floor(this.dist),
          coins: this.coinCount,
          speed: Math.round(this.speed * 3.6),
          best: this.best,
          onTrain: this.player.onTrain,
        });
      }
    }

    // смерть → экран поражения
    if (this.state === 'dying' && this.dieTimer > 1.2) {
      this.state = 'dead';
      const score = Math.floor(this.dist) + this.coinCount * 25;
      const isRecord = score > this.best;
      if (isRecord) {
        this.best = score;
        localStorage.setItem('gr_best', String(score));
      }
      this.cb.over({ dist: Math.floor(this.dist), coins: this.coinCount, score, best: this.best, isRecord });
      this.cb.state('dead');
    }

    this.composer.render();
  }

  /** Лёгкое задевание: тряска, звёздочки и 20 секунд «на грани» */
  private graze(cx: number, pb: { x: number; y0: number; y1: number }) {
    if (this.grazeWindow > 0) {
      // второй раз за 20 секунд — насмерть, отскок в сторону от препятствия
      const bounceDir = Math.sign(pb.x - cx);
      this.crash(bounceDir);
      return;
    }
    this.grazeWindow = 20;
    this.invulnT = 1.5;
    this.player.stun(2.4);
    this.sfx.bump();
    this.shake = Math.max(this.shake, 0.85);
    this.speed = Math.max(11, this.speed * 0.72);
    const hy = (pb.y0 + pb.y1) / 2;
    this.particles.spawn((cx + pb.x) / 2, hy, this.pz, 0xffd93b, 14, 3.2, 2.6, 0.6);
    this.particles.spawn((cx + pb.x) / 2, hy, this.pz, 0xffffff, 8, 2.6, 2.2, 0.5);
    this.cb.banner('ЗАДЕЛ!', 'Ещё одно касание за 20 секунд — и всё', '#ffd93b');
    this.cb.graze(20);
  }

  private crash(bounceDir = 0) {
    if (this.state !== 'play') return;
    this.state = 'dying';
    this.dieTimer = 0;
    this.player.crash(bounceDir);
    this.sfx.crash();
    this.shake = 1.6;
    this.cb.warn(null);
    const fy = this.player.feetY();
    this.particles.spawn(this.player.x, fy + 0.8, this.pz, 0xff3040, 28, 5.5, 4.5, 0.9);
    this.particles.spawn(this.player.x, fy + 0.8, this.pz, 0xffb300, 16, 4.5, 5.5, 0.8);
    this.particles.spawn(this.player.x, fy + 0.4, this.pz, 0xffffff, 10, 3.5, 3, 0.6);
  }

  private updateCamera(dt: number, t: number) {
    const cam = this.camera;
    if (this.state === 'menu') {
      cam.position.set(Math.sin(t * 0.13) * 1.5, 3.05 + Math.sin(t * 0.17) * 0.25, 8.4);
      cam.lookAt(0, 1.7, -10);
      if (Math.abs(cam.fov - 58) > 0.1) { cam.fov = 58; cam.updateProjectionMatrix(); }
      return;
    }
    const px = this.player.x;
    const flip = this.player.flipT;
    const castle = this.curLoc === 'castle';
    
    // Камера следует за персонажем. При flip=1 (потолок) высота меняется на 14.
    const baseCamY = flip > 0.5 ? TUNNEL_H - 3.5 : 3.5;
    const targY = (castle ? 4.2 : baseCamY) + (this.player.baseY * 0.6);
    
    const k = 1 - Math.pow(0.0001, dt);
    cam.position.x += (px * 0.6 - cam.position.x) * k;
    cam.position.y += (targY - cam.position.y) * k;
    
    const pz = this.state === 'play' ? this.pz : this.player.group.position.z;
    cam.position.z = pz + 9.5; // Чуть дальше для обзора

    this.shake = Math.max(0, this.shake - dt * 2.0);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.3;
    }

    // Полный поворот камеры на 180 (более агрессивный)
    const targetRotZ = flip * Math.PI;
    this.camRotZ += (targetRotZ - this.camRotZ) * Math.min(1, dt * 8);
    cam.rotation.z = this.camRotZ;

    const lookY = flip > 0.5 ? TUNNEL_H - 1.8 : 1.8;
    cam.lookAt(px * 0.8, lookY + this.player.baseY * 0.5, pz - 12);
    cam.rotation.z = this.camRotZ;

    const targetFov = 62 + Math.min(16, Math.max(0, (this.speed - 15) * 0.5));
    this.camFov += (targetFov - this.camFov) * Math.min(1, dt * 3);
    if (Math.abs(cam.fov - this.camFov) > 0.1) {
      cam.fov = this.camFov;
      cam.updateProjectionMatrix();
    }
  }

  private setTargets(cfg: (typeof LOCS)[LocId]) {
    this.tgt.bg.setHex(cfg.bg);
    this.tgt.fog.setHex(cfg.fog);
    this.tgt.fogNear = cfg.fogNear;
    this.tgt.fogFar = cfg.fogFar;
    this.tgt.hemiSky.setHex(cfg.hemiSky);
    this.tgt.hemiGround.setHex(cfg.hemiGround);
    this.tgt.sun.setHex(cfg.sunColor);
    this.hemi.intensity += (cfg.hemiInt - this.hemi.intensity) * 0.5;
    this.dir.intensity += (cfg.sunInt - this.dir.intensity) * 0.5;
    this.point.color.setHex(cfg.accent2);
    this.rim.color.setHex(cfg.accent2);
    // светло, но контрастно: без пересвета, чтобы всё было чётко видно
    const mul = this.lowSpec ? 0.7 : 1;
    this.bloom.strength = 0.14 * mul;
    this.bloom.threshold = 0.9;
    this.renderer.toneMappingExposure = 0.94;
    this.ambient.intensity = 0.3;
    this.ambient.color.setHex(cfg.hemiSky);
    this.point.intensity = 3;
    this.rim.intensity = 0.4;
  }

  private snapColors(cfg: (typeof LOCS)[LocId]) {
    this.setTargets(cfg);
    (this.scene.background as THREE.Color).copy(this.tgt.bg);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.tgt.fog);
    fog.near = cfg.fogNear; fog.far = cfg.fogFar;
    this.hemi.color.copy(this.tgt.hemiSky);
    this.hemi.groundColor.copy(this.tgt.hemiGround);
    this.hemi.intensity = cfg.hemiInt;
    this.dir.color.copy(this.tgt.sun);
    this.dir.intensity = cfg.sunInt;
  }

  private onResize = () => {
    const w = this.mount.clientWidth, h = this.mount.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
