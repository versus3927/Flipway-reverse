/** Процедурный звук: эффекты + генеративная музыка (WebAudio) */
export class SFX {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private muted = false;
  private musicOn = false;
  private step = 0;
  private nextT = 0;
  private schedTimer: number | null = null;
  private root = 55;
  private hatBuf: AudioBuffer | null = null;
  private hatFilter: BiquadFilterNode | null = null;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    this.hatBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.hatBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.hatFilter = this.ctx.createBiquadFilter();
    this.hatFilter.type = 'highpass';
    this.hatFilter.frequency.value = 7000;
    this.hatFilter.connect(this.musicGain);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0, dest?: AudioNode) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, fc: number, delay = 0, q = 1) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = fc; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  uiClick() { this.ensure(); this.tone(880, 660, 0.07, 'square', 0.12); }
  laneTick() { this.tone(340, 300, 0.05, 'triangle', 0.1); }
  whoosh() { this.noise(0.28, 0.5, 1400, 0, 0.6); this.tone(220, 660, 0.24, 'sine', 0.08); }
  land() { this.noise(0.1, 0.4, 500); this.tone(180, 70, 0.12, 'sine', 0.25); }
  jumpS() { this.tone(300, 620, 0.16, 'sine', 0.16); }
  coin() { this.tone(988, 988, 0.07, 'square', 0.09); this.tone(1319, 1319, 0.1, 'square', 0.09, 0.07); }
  crash() {
    this.noise(0.55, 0.8, 420, 0, 0.5);
    this.tone(160, 40, 0.5, 'sawtooth', 0.4);
    this.tone(70, 30, 0.6, 'sine', 0.5, 0.02);
  }
  horn() {
    this.tone(233, 233, 0.32, 'sawtooth', 0.22);
    this.tone(311, 311, 0.32, 'sawtooth', 0.2);
    this.tone(233, 233, 0.42, 'sawtooth', 0.24, 0.42);
    this.tone(311, 311, 0.42, 'sawtooth', 0.2, 0.42);
  }
  roar() {
    this.tone(140, 55, 0.75, 'sawtooth', 0.35);
    this.noise(0.7, 0.5, 300, 0.05, 0.7);
    this.tone(90, 45, 0.6, 'square', 0.2, 0.1);
  }
  milestone() { this.tone(523, 523, 0.09, 'square', 0.1); this.tone(784, 784, 0.16, 'square', 0.1, 0.09); }
  /** Глухой удар вскользь + «звёздочки» */
  bump() {
    this.noise(0.22, 0.55, 700, 0, 0.8);
    this.tone(210, 90, 0.26, 'sine', 0.3);
    this.tone(1200, 780, 0.1, 'triangle', 0.09, 0.05);
    this.tone(900, 1500, 0.12, 'triangle', 0.07, 0.14);
    this.tone(1500, 900, 0.14, 'triangle', 0.06, 0.26);
  }
  /** Сигнал, что опасность миновала */
  safe() { this.tone(660, 990, 0.14, 'triangle', 0.09); this.tone(990, 1320, 0.18, 'triangle', 0.07, 0.12); }
  /** Плевок огнём */
  fire() {
    this.noise(0.5, 0.6, 2200, 0, 0.4);
    this.tone(320, 90, 0.42, 'sawtooth', 0.22);
    this.tone(700, 180, 0.3, 'triangle', 0.14, 0.04);
  }
  /** Огонь прошёл мимо / попал */
  burn() {
    this.noise(0.4, 0.75, 1400, 0, 0.5);
    this.tone(180, 60, 0.45, 'sawtooth', 0.3);
  }

  setRoot(f: number) { this.root = f; }

  startMusic() {
    this.ensure();
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.schedTimer = window.setInterval(() => this.schedule(), 90);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.schedTimer !== null) { clearInterval(this.schedTimer); this.schedTimer = null; }
  }

  private schedule() {
    if (!this.ctx || !this.musicOn || this.ctx.state !== 'running') return;
    if (this.muted) { this.nextT = this.ctx.currentTime + 0.1; return; }
    const STEP = 60 / 132 / 2; // восьмые при 132 BPM
    while (this.nextT < this.ctx.currentTime + 0.28) {
      const s = this.step % 32;
      const bar = Math.floor(this.step / 32) % 4;
      const delay = Math.max(0, this.nextT - this.ctx.currentTime);
      const r = this.root * (bar === 3 ? 1.335 : bar === 2 ? 1.19 : 1);
      // бас
      if (s % 4 === 0) this.tone(r * 2, r * 2, 0.16, 'sawtooth', 0.16, delay, this.musicGain);
      if (s % 8 === 4) this.tone(r * 1.5 * 2, r * 1.5 * 2, 0.14, 'sawtooth', 0.13, delay, this.musicGain);
      if (s % 8 === 6) this.tone(r * 2, r * 2.66, 0.1, 'sawtooth', 0.1, delay, this.musicGain);
      // хэты (переиспользуемый буфер)
      if (s % 2 === 0 && this.hatBuf && this.hatFilter) {
        const t = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = this.hatBuf;
        const g = this.ctx.createGain();
        g.gain.value = s % 8 === 4 ? 0.09 : 0.05;
        src.connect(g).connect(this.hatFilter);
        src.start(t);
      }
      // пэд раз в такт
      if (s === 0) {
        this.tone(r * 4, r * 4, 1.6, 'triangle', 0.05, delay, this.musicGain);
        this.tone(r * 6, r * 6, 1.6, 'triangle', 0.035, delay, this.musicGain);
        this.tone(r * 2.66 * 2, r * 2.66 * 2, 1.6, 'triangle', 0.03, delay, this.musicGain);
      }
      this.step++;
      this.nextT += STEP;
    }
  }
}
