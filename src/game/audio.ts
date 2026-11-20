// Процедурный синтез всех звуков через Web Audio.
// Слои: основной удар + вторичный материал + debris + room reverb.

export type Material = 'flesh' | 'bone' | 'wood' | 'stone' | 'blunt';

export class AudioSys {
  ctx: AudioContext | null = null;
  master!: GainNode;
  dry!: GainNode;
  reverb!: ConvolverNode;
  reverbGain!: GainNode;
  noiseBuf!: AudioBuffer;
  windGain?: GainNode;
  windFilter?: BiquadFilterNode;
  heartTimer = 0;
  private engOsc: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engGain: GainNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private sirenOsc: OscillatorNode | null = null;
  private sirenLfo: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private streetNoise: { gain: GainNode; pan: StereoPannerNode; filter: BiquadFilterNode } | null = null;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    // импульсная характеристика «лес ночью / открытое пространство»
    const irLen = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 400 ? i / 400 : 1);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    const nLen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;

    this.startWind();
  }

  /** Размещение источника по панораме: -1 слева, 1 справа. */
  private place(node: AudioNode, pan: number, wet: number) {
    if (!this.ctx || Math.abs(pan) < 0.03) { this.out(node, wet); return; }
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    this.out(p, wet);
  }

  private out(node: AudioNode, wet = 0.5) {
    node.connect(this.dry);
    if (wet > 0) {
      const g = this.ctx!.createGain();
      g.gain.value = wet;
      node.connect(g);
      g.connect(this.reverb);
    }
  }

  private noise(opts: {
    dur: number;
    type?: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
    gain: number;
    attack?: number;
    wet?: number;
    delay?: number;
  }) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f);
    f.connect(g);
    this.out(g, opts.wet ?? 0.5);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  private tone(opts: {
    freq: number;
    freqEnd?: number;
    dur: number;
    type?: OscillatorType;
    gain: number;
    attack?: number;
    wet?: number;
    delay?: number;
  }) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + opts.dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.003;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    o.connect(g);
    this.out(g, opts.wet ?? 0.4);
    o.start(t0);
    o.stop(t0 + opts.dur + 0.05);
  }

  // Свист рассекаемого воздуха — громкость и высота зависят от скорости лезвия
  whoosh(speed01: number) {
    if (!this.ctx) return;
    const s = Math.min(1, Math.max(0, speed01));
    if (s < 0.12) return;
    this.noise({ dur: 0.18 + 0.2 * s, freq: 300 + 500 * s, freqEnd: 900 + 1600 * s, q: 1.4, gain: 0.08 + 0.42 * s, attack: 0.04, wet: 0.3 });
    this.noise({ dur: 0.25, freq: 120 + 200 * s, type: 'lowpass', gain: 0.05 + 0.1 * s, attack: 0.06, wet: 0.1 });
  }

  impact(mat: Material, e01: number, depth = 0.5) {
    if (!this.ctx) return;
    const e = Math.min(1, Math.max(0.05, e01));
    switch (mat) {
      case 'flesh':
        // глухой удар корпуса
        this.tone({ freq: 140, freqEnd: 45, dur: 0.22, gain: 0.7 * e, type: 'sine' });
        // мокрый разрыв
        this.noise({ dur: 0.14 + 0.1 * depth, freq: 900, freqEnd: 250, q: 0.8, gain: 0.55 * e, attack: 0.002 });
        this.noise({ dur: 0.3, freq: 2600, freqEnd: 600, q: 2, gain: 0.18 * e * depth, attack: 0.01, delay: 0.02 });
        // брызги
        for (let i = 0; i < 3; i++)
          this.noise({ dur: 0.05, freq: 3000 + Math.random() * 2000, q: 3, gain: 0.07 * e, delay: 0.03 + Math.random() * 0.12, wet: 0.2 });
        break;
      case 'bone':
        this.tone({ freq: 220, freqEnd: 60, dur: 0.16, gain: 0.6 * e });
        this.noise({ dur: 0.06, freq: 2500, freqEnd: 1200, type: 'highpass', gain: 0.6 * e, attack: 0.001 });
        for (let i = 0; i < 4; i++)
          this.noise({ dur: 0.02 + Math.random() * 0.02, freq: 1800 + Math.random() * 2500, q: 6, gain: 0.35 * e, delay: 0.005 + i * 0.012 + Math.random() * 0.01, attack: 0.001 });
        this.noise({ dur: 0.2, freq: 700, freqEnd: 200, q: 1, gain: 0.3 * e, delay: 0.03 });
        break;
      case 'wood':
        // «тук» — резонанс ствола
        this.tone({ freq: 380, freqEnd: 180, dur: 0.09, gain: 0.5 * e, type: 'triangle' });
        this.noise({ dur: 0.08, freq: 1400, freqEnd: 500, q: 1.2, gain: 0.7 * e, attack: 0.001 });
        this.tone({ freq: 95, freqEnd: 50, dur: 0.25, gain: 0.5 * e });
        // щепа
        for (let i = 0; i < 3; i++)
          this.noise({ dur: 0.03, freq: 2500 + Math.random() * 3000, q: 5, gain: 0.12 * e, delay: 0.02 + Math.random() * 0.1, wet: 0.3 });
        break;
      case 'stone': {
        // металлический звон — негармонические партиалы
        const parts = [1850, 2900, 4300, 6100];
        parts.forEach((f, i) =>
          this.tone({ freq: f * (0.97 + Math.random() * 0.06), dur: 0.5 - i * 0.08, gain: (0.25 - i * 0.04) * e, type: 'sine', attack: 0.001, wet: 0.6 })
        );
        this.noise({ dur: 0.05, freq: 5000, type: 'highpass', gain: 0.6 * e, attack: 0.001 });
        this.tone({ freq: 160, freqEnd: 60, dur: 0.15, gain: 0.5 * e });
        // вибрация рукояти
        this.tone({ freq: 55, dur: 0.35, gain: 0.25 * e, type: 'square', attack: 0.01, wet: 0.1 });
        break;
      }
      case 'blunt':
        this.tone({ freq: 120, freqEnd: 50, dur: 0.18, gain: 0.5 * e });
        this.noise({ dur: 0.08, freq: 600, freqEnd: 200, type: 'lowpass', gain: 0.4 * e });
        break;
    }
  }

  stuck(mat: Material) {
    if (!this.ctx) return;
    if (mat === 'wood') this.tone({ freq: 240, freqEnd: 120, dur: 0.25, gain: 0.25, type: 'sawtooth', attack: 0.02 });
    else this.noise({ dur: 0.3, freq: 500, freqEnd: 150, q: 3, gain: 0.3, attack: 0.03 });
  }

  // рывок при выдёргивании
  yank(mat: Material, progress: number) {
    if (!this.ctx) return;
    if (mat === 'wood') {
      this.tone({ freq: 180 + progress * 120, freqEnd: 90, dur: 0.14, gain: 0.35, type: 'sawtooth', attack: 0.01 });
      this.noise({ dur: 0.12, freq: 900, freqEnd: 300, q: 2, gain: 0.25 });
    } else {
      this.noise({ dur: 0.16, freq: 400 + progress * 400, freqEnd: 180, q: 1.5, gain: 0.4, attack: 0.01 });
      this.noise({ dur: 0.08, freq: 2000, q: 3, gain: 0.12, delay: 0.04 });
    }
    this.tone({ freq: 70, freqEnd: 40, dur: 0.1, gain: 0.3 });
  }

  pullOut(mat: Material) {
    if (!this.ctx) return;
    if (mat === 'wood') {
      this.tone({ freq: 300, freqEnd: 140, dur: 0.12, gain: 0.4, type: 'sawtooth', attack: 0.005 });
      this.noise({ dur: 0.1, freq: 1200, freqEnd: 400, q: 1, gain: 0.3 });
    } else {
      // мокрый «чпок»
      this.noise({ dur: 0.18, freq: 300, freqEnd: 1800, q: 2, gain: 0.5, attack: 0.01 });
      this.tone({ freq: 90, freqEnd: 220, dur: 0.08, gain: 0.3 });
      for (let i = 0; i < 3; i++) this.noise({ dur: 0.05, freq: 3500, q: 3, gain: 0.08, delay: 0.05 + Math.random() * 0.1 });
    }
  }

  zombieGroan(dist01: number) {
    if (!this.ctx) return;
    const g = 0.35 * (1 - dist01);
    if (g < 0.02) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 70 + Math.random() * 60;
    o.frequency.setValueAtTime(base, t0);
    o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.4), t0 + 0.8);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5 + Math.random() * 4;
    const lfoG = ctx.createGain();
    lfoG.gain.value = base * 0.08;
    lfo.connect(lfoG);
    lfoG.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t0);
    f.frequency.linearRampToValueAtTime(900, t0 + 0.3);
    f.frequency.linearRampToValueAtTime(300, t0 + 1.0);
    f.Q.value = 3;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(g, t0 + 0.15);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    o.connect(f);
    f.connect(gn);
    this.out(gn, 0.7);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + 1.1);
    lfo.stop(t0 + 1.1);
  }

  zombieBite() {
    if (!this.ctx) return;
    this.noise({ dur: 0.12, freq: 1500, freqEnd: 400, q: 1, gain: 0.5 });
    this.tone({ freq: 200, freqEnd: 80, dur: 0.15, gain: 0.4 });
  }

  playerHurt() {
    if (!this.ctx) return;
    this.tone({ freq: 160, freqEnd: 90, dur: 0.3, gain: 0.5, type: 'triangle' });
    this.noise({ dur: 0.25, freq: 800, freqEnd: 200, q: 1, gain: 0.3 });
  }

  heartbeat() {
    if (!this.ctx) return;
    this.tone({ freq: 60, freqEnd: 35, dur: 0.12, gain: 0.5, wet: 0 });
    this.tone({ freq: 55, freqEnd: 30, dur: 0.14, gain: 0.4, wet: 0, delay: 0.16 });
  }

  footstep(surface: 'concrete' | 'asphalt' | 'grass' | 'sand' | 'water' | 'metal' | 'wood' = 'concrete') {
    if (!this.ctx) return;
    const v = 0.9 + Math.random() * 0.2;
    const body = { dur: 0.09, freq: 300 + Math.random() * 150, freqEnd: 120, type: 'lowpass' as BiquadFilterType, gain: 0.2 * v, attack: 0.004, wet: 0.2 };
    switch (surface) {
      case 'grass':
        this.noise({ ...body, gain: 0.13, freq: 900, freqEnd: 500, type: 'bandpass', q: 0.8 });
        this.noise({ dur: 0.06, freq: 3400, q: 0.6, gain: 0.05, wet: 0.1 });
        break;
      case 'sand':
        this.noise({ ...body, freq: 1600, freqEnd: 900, gain: 0.09, type: 'bandpass', q: 0.5, wet: 0.1 });
        break;
      case 'water':
        this.noise({ ...body, freq: 700, freqEnd: 2200, gain: 0.2, type: 'bandpass', q: 0.4, wet: 0.3 });
        this.noise({ dur: 0.14, freq: 2400, freqEnd: 500, q: 0.7, gain: 0.08, delay: 0.02, wet: 0.3 });
        break;
      case 'metal':
        this.noise({ ...body, freq: 1400, freqEnd: 700, gain: 0.16, q: 1.6 });
        this.tone({ freq: 1500 + Math.random() * 500, freqEnd: 900, dur: 0.16, gain: 0.05, type: 'triangle', wet: 0.3 });
        break;
      case 'wood':
        this.noise({ ...body, freq: 620, freqEnd: 220, gain: 0.2, q: 1.2 });
        this.tone({ freq: 190, freqEnd: 120, dur: 0.09, gain: 0.07, type: 'triangle', wet: 0.15 });
        break;
      case 'asphalt':
        this.noise({ ...body, gain: 0.19, freq: 380, freqEnd: 150 });
        this.noise({ dur: 0.05, freq: 2600, q: 1.4, gain: 0.045, wet: 0.1 });
        break;
      default:
        this.noise(body);
        this.noise({ dur: 0.05, freq: 1800, q: 1, gain: 0.05, wet: 0.1 });
        break;
    }
  }

  sharpen() {
    if (!this.ctx) return;
    this.noise({ dur: 0.28, freq: 3500, freqEnd: 5500, q: 2.5, gain: 0.22, attack: 0.05 });
    this.tone({ freq: 2400, freqEnd: 2900, dur: 0.25, gain: 0.04, attack: 0.05 });
  }

  debris() {
    if (!this.ctx) return;
    this.noise({ dur: 0.04, freq: 2500 + Math.random() * 2000, q: 4, gain: 0.08, delay: 0.2 + Math.random() * 0.4 });
  }

  bodyFall() {
    if (!this.ctx) return;
    this.tone({ freq: 90, freqEnd: 35, dur: 0.3, gain: 0.6 });
    this.noise({ dur: 0.2, freq: 500, freqEnd: 150, type: 'lowpass', gain: 0.4 });
  }

  treeCrack() {
    if (!this.ctx) return;
    for (let i = 0; i < 6; i++)
      this.noise({ dur: 0.05 + Math.random() * 0.08, freq: 400 + Math.random() * 900, q: 4, gain: 0.5, delay: i * 0.12 + Math.random() * 0.08 });
    this.tone({ freq: 120, freqEnd: 40, dur: 0.6, gain: 0.5, type: 'triangle', delay: 0.5 });
  }

  treeFall() {
    if (!this.ctx) return;
    this.tone({ freq: 70, freqEnd: 25, dur: 0.8, gain: 0.9 });
    this.noise({ dur: 0.7, freq: 600, freqEnd: 100, type: 'lowpass', gain: 0.7 });
    for (let i = 0; i < 6; i++) this.noise({ dur: 0.05, freq: 1500 + Math.random() * 2000, q: 3, gain: 0.12, delay: Math.random() * 0.5 });
  }

  // ---------------- пистолет ----------------
  gunshot(power = 1, pan = 0, dist = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // дистанция: далёкий выстрел глуше и тише
    const far = Math.max(0, Math.min(1, dist / 60));
    power *= 1 - far * 0.55;
    // ударная волна — низкий «бум»
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.9 * power, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    o.connect(g);
    this.place(g, pan, 0.55);
    o.start(t0);
    o.stop(t0 + 0.25);
    // «крэк» — резкий шум
    this.noise({ dur: 0.06, freq: 3200, freqEnd: 900, type: 'highpass', gain: 0.8 * power, attack: 0.0005, wet: 0.35 });
    this.noise({ dur: 0.22, freq: 700, freqEnd: 180, q: 0.7, gain: 0.6 * power, attack: 0.001, wet: 0.8 });
    // металлический звон ствола
    this.tone({ freq: 2400, freqEnd: 1600, dur: 0.22, gain: 0.1 * power, type: 'sine', wet: 0.7 });
    // хвост в застройке — отражения от домов
    this.noise({ dur: 0.85, freq: 520, freqEnd: 150, type: 'lowpass', q: 0.6, gain: 0.16 * power, attack: 0.06, wet: 1, delay: 0.05 });
    // механика: затвор отходит и возвращается
    this.noise({ dur: 0.03, freq: 1800, freqEnd: 900, q: 5, gain: 0.12 * power, attack: 0.0008, wet: 0.1, delay: 0.028 });
    this.noise({ dur: 0.025, freq: 2600, freqEnd: 1400, q: 6, gain: 0.08 * power, attack: 0.0008, wet: 0.1, delay: 0.062 });
  }

  /** Выстрел с глушителем: только щелчок и глухой хлопок. */
  silenced() {
    if (!this.ctx) return;
    this.noise({ dur: 0.05, freq: 1400, freqEnd: 400, q: 2, gain: 0.16, attack: 0.0008, wet: 0.2 });
    this.tone({ freq: 180, freqEnd: 70, dur: 0.1, gain: 0.22, type: 'sine', wet: 0.2 });
    this.noise({ dur: 0.05, freq: 2400, q: 6, gain: 0.06, attack: 0.001, wet: 0.1, delay: 0.05 });
  }

  /** Пуля проходит рядом: сверхзвуковой щелчок и свист. */
  whizz() {
    if (!this.ctx) return;
    this.noise({ dur: 0.09, freq: 5200, freqEnd: 1600, type: 'highpass', gain: 0.22, attack: 0.001, wet: 0.3 });
    this.tone({ freq: 1900, freqEnd: 380, dur: 0.24, gain: 0.06, type: 'sine', wet: 0.4 });
  }

  /** Гильза падает на асфальт. */
  casing() {
    if (!this.ctx) return;
    for (let i = 0; i < 2; i++) {
      this.tone({ freq: 4200 + Math.random() * 1600, freqEnd: 2600, dur: 0.07, gain: 0.05, type: 'triangle', wet: 0.35, delay: 0.12 + i * 0.11 });
    }
  }

  /** Разбитое стекло: звонкая россыпь осколков. */
  glassBreak() {
    if (!this.ctx) return;
    this.noise({ dur: 0.32, freq: 4200, freqEnd: 1200, type: 'highpass', q: 0.8, gain: 0.3, attack: 0.001, wet: 0.6 });
    for (let i = 0; i < 5; i++) {
      this.tone({ freq: 3200 + Math.random() * 3400, freqEnd: 1800, dur: 0.16, gain: 0.05, type: 'triangle', wet: 0.6, delay: Math.random() * 0.3 });
    }
  }

  dryFire() {
    if (!this.ctx) return;
    this.noise({ dur: 0.04, freq: 2200, freqEnd: 1200, q: 4, gain: 0.3, attack: 0.001, wet: 0.15 });
  }

  slideClack() {
    if (!this.ctx) return;
    this.noise({ dur: 0.05, freq: 1400, freqEnd: 500, q: 3, gain: 0.28, attack: 0.001, wet: 0.2 });
    this.tone({ freq: 220, freqEnd: 120, dur: 0.05, gain: 0.16, type: 'square', wet: 0.1 });
  }

  magClick() {
    if (!this.ctx) return;
    this.noise({ dur: 0.05, freq: 900, freqEnd: 400, q: 5, gain: 0.3, attack: 0.001, wet: 0.15 });
  }

  shellDrop() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++)
      this.noise({ dur: 0.04, freq: 2600 + Math.random() * 2200, q: 8, gain: 0.1, delay: 0.35 + i * 0.16, wet: 0.4 });
  }

  ricochet() {
    if (!this.ctx) return;
    this.tone({ freq: 2600 + Math.random() * 1200, freqEnd: 600, dur: 0.25, gain: 0.16, type: 'sawtooth', wet: 0.6 });
  }

  engineStart() {
    if (!this.ctx) return;
    this.stopEngine();
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 45;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 22;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.3);
    o.connect(f); o2.connect(f); f.connect(g);
    g.connect(this.master);
    o.start(); o2.start();
    this.engOsc = o; this.engOsc2 = o2; this.engGain = g; this.engFilter = f;
  }

  engineSet(speed01: number) {
    if (!this.ctx || !this.engOsc) return;
    const base = 42 + speed01 * 130;
    this.engOsc.frequency.setTargetAtTime(base, this.ctx.currentTime, 0.12);
    this.engOsc2!.frequency.setTargetAtTime(base * 0.5, this.ctx.currentTime, 0.12);
    this.engFilter!.frequency.setTargetAtTime(260 + speed01 * 700, this.ctx.currentTime, 0.15);
  }

  stopEngine() {
    if (!this.ctx || !this.engOsc) return;
    try {
      this.engGain!.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
      this.engOsc!.stop(this.ctx.currentTime + 0.35);
      this.engOsc2!.stop(this.ctx.currentTime + 0.35);
    } catch { /* ignore */ }
    this.engOsc = null; this.engOsc2 = null; this.engGain = null; this.engFilter = null;
  }

  // ---------- сирена полиции ----------
  startSiren() {
    if (!this.ctx || this.sirenOsc) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.7;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.6);
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(); lfo.start();
    this.sirenOsc = o; this.sirenLfo = lfo; this.sirenGain = g;
  }

  stopSiren() {
    if (!this.ctx || !this.sirenOsc) return;
    try {
      this.sirenGain!.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.3);
      this.sirenOsc!.stop(this.ctx.currentTime + 0.35);
      this.sirenLfo!.stop(this.ctx.currentTime + 0.35);
    } catch { /* ignore */ }
    this.sirenOsc = null; this.sirenLfo = null; this.sirenGain = null;
  }

  setSirenVolume(v: number) {
    if (!this.ctx || !this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(Math.max(0.0001, v * 0.09), this.ctx.currentTime, 0.2);
  }

  /** Раскат грома: низкий шум с длинным хвостом. */
  thunder() {
    if (!this.ctx) return;
    this.noise({ dur: 2.6, type: 'lowpass', freq: 420, freqEnd: 120, q: 0.6, gain: 0.42, attack: 0.18, wet: 0.7 });
    this.noise({ dur: 1.1, type: 'lowpass', freq: 900, freqEnd: 200, q: 0.8, gain: 0.18, attack: 0.02, wet: 0.4, delay: 0.05 });
  }

  explosion() {
    if (!this.ctx) return;
    this.tone({ freq: 105, freqEnd: 26, dur: 0.85, gain: 1.15, type: 'sine', attack: 0.002, wet: 0.9 });
    this.noise({ dur: 0.65, freq: 1200, freqEnd: 180, q: 0.55, gain: 0.95, attack: 0.002, wet: 0.9 });
    this.noise({ dur: 0.26, freq: 4400, freqEnd: 900, type: 'highpass', gain: 0.7, attack: 0.001, wet: 0.6 });
    for (let i = 0; i < 5; i++) this.noise({ dur: 0.08 + Math.random() * 0.1, freq: 2400 + Math.random() * 1700, q: 4, gain: 0.22, delay: 0.12 + Math.random() * 0.5, wet: 0.8 });
  }

  fireCrackle() {
    if (!this.ctx) return;
    this.noise({ dur: 0.1 + Math.random() * 0.16, freq: 1400 + Math.random() * 1400, q: 1.1, gain: 0.12 + Math.random() * 0.1, wet: 0.35 });
    this.tone({ freq: 95 + Math.random() * 80, freqEnd: 48, dur: 0.13, gain: 0.09, type: 'triangle', wet: 0.2 });
  }

  horn() {
    if (!this.ctx) return;
    this.tone({ freq: 420, freqEnd: 380, dur: 0.35, gain: 0.22, type: 'square', wet: 0.4 });
    this.tone({ freq: 315, freqEnd: 290, dur: 0.35, gain: 0.18, type: 'square', wet: 0.4 });
  }

  trafficBed(volume: number, position: number, speed: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.streetNoise) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuf; noise.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 360;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      noise.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.master);
      noise.start(); this.streetNoise = { gain, pan, filter };
    }
    const { gain, pan, filter } = this.streetNoise;
    gain.gain.setTargetAtTime(volume * 0.16, ctx.currentTime, 0.19);
    pan.pan.setTargetAtTime(position * 0.65, ctx.currentTime, 0.22);
    filter.frequency.setTargetAtTime(190 + 800 * speed, ctx.currentTime, 0.25);
  }

  // ---------- дождь ----------
  setRain(v: number) {
    if (!this.ctx) return;
    if (!this.rainSrc) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      this.rainSrc = src; this.rainGain = g;
    }
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(Math.max(0.0001, v * 0.11), this.ctx.currentTime, 0.5);
  }

  private startWind() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.045;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(f.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.13;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.02;
    lfo2.connect(lg2);
    lg2.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
    lfo.start();
    lfo2.start();
    this.windGain = g;
    this.windFilter = f;
  }
}

export const audio = new AudioSys();
