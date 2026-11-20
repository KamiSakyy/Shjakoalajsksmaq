import { audio } from './audio';

// Процедурное радио: три станции, полностью синтезированные в Web Audio.
// Схема: голоса → фильтр → сайд-чейн (приглушение под бочку) → master,
// плюс отдельная шина реверба и ленточная задержка для арпеджио.
// Планировщик с опережением на 0.24 с держит ритм стабильным даже при просадках FPS.

export type StationId = 'synth' | 'lofi' | 'dark' | 'off';

export const STATIONS: { id: StationId; name: string; bpm: number }[] = [
  { id: 'synth', name: 'Пасифик FM · Synthwave', bpm: 104 },
  { id: 'lofi', name: 'Бэйфронт · Lo-Fi', bpm: 82 },
  { id: 'dark', name: 'Аномалия · Dark Ambient', bpm: 64 },
  { id: 'off', name: 'Радио выключено', bpm: 0 },
];

// 8-тактовая петля: Am — F — C — G — Am — F — Dm — E
const SYNTH_CHORDS = [
  { bass: 55.0, tones: [220.0, 261.63, 329.63] },   // Am
  { bass: 43.65, tones: [174.61, 220.0, 261.63] },  // F
  { bass: 65.41, tones: [261.63, 329.63, 392.0] },  // C
  { bass: 49.0, tones: [196.0, 246.94, 293.66] },   // G
  { bass: 55.0, tones: [220.0, 261.63, 329.63] },   // Am
  { bass: 43.65, tones: [174.61, 220.0, 261.63] },  // F
  { bass: 36.71, tones: [146.83, 174.61, 220.0] },  // Dm
  { bass: 41.2, tones: [164.81, 207.65, 246.94] },  // E
];
const LOFI_CHORDS = [
  { bass: 43.65, tones: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
  { bass: 36.71, tones: [146.83, 174.61, 220.0, 277.18] }, // Dm7
  { bass: 49.0, tones: [196.0, 246.94, 293.66, 369.99] },  // G7
  { bass: 32.7, tones: [130.81, 164.81, 196.0, 246.94] },  // Cmaj7
  { bass: 43.65, tones: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
  { bass: 41.2, tones: [164.81, 196.0, 246.94, 311.13] },  // E7
  { bass: 36.71, tones: [146.83, 174.61, 220.0, 277.18] }, // Dm7
  { bass: 49.0, tones: [196.0, 246.94, 293.66, 329.63] },  // G6
];
const DARK_DRONES = [55.0, 46.25, 41.2, 49.0];

export class Radio {
  index = 0;
  private bus: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private duck: GainNode | null = null;
  private delaySend: GainNode | null = null;
  private vinyl: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private volume = 0.42;
  private running = false;
  /** 0 — спокойно, 1 — погоня/бой. Добавляет барабаны и напряжение. */
  intensity = 0;

  get station() { return STATIONS[this.index]; }

  private ensure(): GainNode | null {
    const ctx = audio.ctx;
    if (!ctx) return null;
    if (this.bus) return this.bus;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 9000;
    tone.Q.value = 0.4;
    const duck = ctx.createGain();
    duck.gain.value = 1;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 120;
    shelf.gain.value = 3.5;
    bus.connect(tone);
    tone.connect(duck);
    duck.connect(shelf);
    shelf.connect(audio.master);
    // шина реверба — мягкий «зал»
    const rev = ctx.createGain();
    rev.gain.value = 0.5;
    rev.connect(audio.reverb);
    tone.connect(rev);
    // ленточная задержка для арпеджио
    const send = ctx.createGain();
    send.gain.value = 0.5;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.26;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2600;
    send.connect(delay);
    delay.connect(dl);
    dl.connect(fb);
    fb.connect(delay);
    dl.connect(duck);
    // винил (только lo-fi)
    const crackle = ctx.createBufferSource();
    crackle.buffer = audio.noiseBuf;
    crackle.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 4200;
    band.Q.value = 0.7;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0;
    crackle.connect(band);
    band.connect(crackleGain);
    crackleGain.connect(duck);
    crackle.start();

    this.bus = bus;
    this.tone = tone;
    this.duck = duck;
    this.delaySend = send;
    this.vinyl = crackleGain;
    this.applyStationTone();
    return bus;
  }

  private applyStationTone() {
    const ctx = audio.ctx;
    if (!ctx || !this.tone) return;
    const id = this.station.id;
    const cutoff = id === 'lofi' ? 3200 : id === 'dark' ? 1800 : 11000;
    this.tone.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.4);
  }

  start() {
    const ctx = audio.ctx;
    const bus = this.ensure();
    if (!ctx || !bus) return;
    if (this.station.id === 'off') { this.stop(); return; }
    if (!this.running) {
      this.running = true;
      this.step = 0;
      this.nextTime = ctx.currentTime + 0.12;
      this.timer = setInterval(() => this.schedule(), 45);
    }
    this.applyStationTone();
    bus.gain.setTargetAtTime(this.station.id === 'dark' ? this.volume * 0.18 : this.volume * 0.24, ctx.currentTime, 0.5);
  }

  stop() {
    const ctx = audio.ctx;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    if (ctx && this.bus) this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  }

  cycle() {
    this.index = (this.index + 1) % STATIONS.length;
    if (this.station.id === 'off') this.stop();
    else this.start();
  }

  /** Переключить на конкретную станцию (например, «Аномалия» в зомби-режиме). */
  setStation(id: StationId) {
    const idx = STATIONS.findIndex((s) => s.id === id);
    if (idx < 0 || idx === this.index) return;
    this.index = idx;
    this.step = 0;
    if (id === 'off') this.stop(); else this.start();
  }

  setVolume(v: number) {
    this.volume = v;
    const ctx = audio.ctx;
    if (!ctx || !this.bus || !this.running) return;
    this.bus.gain.setTargetAtTime(this.station.id === 'dark' ? v * 0.18 : v * 0.24, ctx.currentTime, 0.4);
  }

  /** Резкое приглушение музыки — выстрел/взрыв не тонет в подложке. */
  punch(amount = 0.45) {
    const ctx = audio.ctx;
    if (!ctx || !this.duck) return;
    const now = ctx.currentTime;
    this.duck.gain.cancelScheduledValues(now);
    this.duck.gain.setValueAtTime(this.duck.gain.value, now);
    this.duck.gain.linearRampToValueAtTime(1 - amount, now + 0.03);
    this.duck.gain.linearRampToValueAtTime(1, now + 0.32);
  }

  private schedule() {
    const ctx = audio.ctx;
    const st = this.station;
    if (!ctx || st.id === 'off' || !this.running) return;
    const sixteenth = 60 / st.bpm / 4;
    if (this.vinyl) this.vinyl.gain.setTargetAtTime(st.id === 'lofi' ? 0.02 : 0, ctx.currentTime, 0.3);
    while (this.nextTime < ctx.currentTime + 0.24) {
      this.playStep(st.id, this.step, this.nextTime, sixteenth);
      this.step++;
      this.nextTime += sixteenth;
    }
  }

  private playStep(id: StationId, step: number, t: number, sixteenth: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 8;
    // человеческий «свинг»: нечётные шестнадцатые чуть позже
    const swing = (s % 2 === 1 ? sixteenth * 0.07 : 0) + (Math.random() - 0.5) * 0.004;
    const at = t + swing;
    const loud = 0.85 + Math.random() * 0.3;

    if (id === 'synth') {
      const c = SYNTH_CHORDS[bar];
      // бочка: синкопа на 0/6/8/11, в напряжённых местах — чаще
      if (s === 0 || s === 8 || s === 11 || (this.intensity > 0.5 && s === 4)) this.kick(at, 0.62 * loud);
      if (s === 4 || s === 12) this.snare(at, 0.24, 1900);
      if (s === 14 && bar % 2 === 1) this.snare(at + sixteenth * 0.5, 0.13, 2300);
      if (s % 2 === 0) this.hat(at, s % 4 === 2 ? 0.06 : 0.032, s % 4 === 2 ? 0.07 : 0.04);
      else if (this.intensity > 0.3) this.hat(at, 0.018, 0.03);
      // бас: восьмые с акцентом на первой
      if (s % 2 === 0) this.bass(c.bass, at, 0.19, s === 0 ? 0.13 : 0.09, 780);
      // пэд на каждый такт
      if (s === 0) this.pad(c.tones, at, sixteenth * 16 * 0.98, 0.032, 2600, 0.55);
      // арпеджио по аккордовым тонам + задержка
      const arp = [c.tones[0] * 2, c.tones[1] * 2, c.tones[2] * 2, c.tones[1] * 4];
      if (s % 2 === 1) this.lead(arp[(s >> 1) % 4], at, 0.12, 0.022, 2800);
      if (this.intensity > 0.55 && s === 3) this.lead(c.tones[2] * 2.5, at, 0.1, 0.016, 3400);
    } else if (id === 'lofi') {
      const c = LOFI_CHORDS[bar];
      if (s === 0 || s === 10) this.kick(at, 0.34 * loud);
      if (s === 4 || s === 12) this.snare(at, 0.13, 1300);
      if (s === 7) this.hat(at, 0.022, 0.05);       // «ленивый» хэт
      if (s === 0) this.pad(c.tones, at, sixteenth * 16, 0.03, 1500, 0.7);
      if (s === 2 || s === 6 || s === 10) this.lead(c.tones[1] * 2, at, 0.55, 0.018, 1500);
      if (s % 4 === 0) this.bass(c.bass, at, 0.5, 0.1, 320);
      if (bar % 4 === 3 && s === 14) this.lead(c.tones[3] * 2, t + sixteenth * 0.5, 0.4, 0.014, 1400);
    } else if (id === 'dark') {
      // гул, редкие металлические удары, диссонанс
      const drone = DARK_DRONES[bar % 4];
      if (s === 0) this.drone(drone, t, sixteenth * 16, 0.055);
      if (s === 0 || s === 9) this.taiko(t, s === 0 ? 0.4 : 0.24);
      if (s === 6 && Math.random() < 0.5) this.metal(t);
      if (s === 12) this.pad([drone * 1.5, drone * 1.5 * 1.059], t, sixteenth * 5, 0.014, 900, 0.85);
      if (this.intensity > 0.5 && s % 4 === 2) this.taiko(t, 0.12);
    }
  }

  // ── голоса ────────────────────────────────────────────────────────
  private ctxBus() {
    const ctx = audio.ctx;
    if (!ctx || !this.bus) return null;
    return { ctx, bus: this.bus };
  }

  private pad(freqs: number[], t: number, dur: number, gain: number, cutoff: number, wet: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff * 0.55, t);
    filter.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.45);
    filter.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.35);
    env.gain.linearRampToValueAtTime(gain * 0.8, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filter.connect(env);
    env.connect(bus);
    const rev = ctx.createGain();
    rev.gain.value = wet;
    env.connect(rev);
    if (audio.reverb) rev.connect(audio.reverb);
    for (const f of freqs) {
      for (const det of [-7, 0, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = det;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur + 0.1);
      }
    }
  }

  private bass(freq: number, t: number, dur: number, gain: number, cutoff: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq, t);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.35), t + dur);
    filter.Q.value = 6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.55;
    osc.connect(filter);
    sub.connect(subGain);
    subGain.connect(env);
    filter.connect(env);
    env.connect(bus);
    osc.start(t); osc.stop(t + dur + 0.05);
    sub.start(t); sub.stop(t + dur + 0.05);
  }

  private lead(freq: number, t: number, dur: number, gain: number, cutoff: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(env);
    env.connect(bus);
    if (this.delaySend) env.connect(this.delaySend);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  private drone(freq: number, t: number, dur: number, gain: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.linearRampToValueAtTime(680, t + dur * 0.6);
    filter.Q.value = 3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.9);
    env.gain.setValueAtTime(gain, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    filter.connect(env);
    env.connect(bus);
    for (const [f, type] of [[freq, 'sawtooth'], [freq * 1.005, 'sawtooth'], [freq * 0.5, 'sine']] as [number, OscillatorType][]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(t); osc.stop(t + dur + 0.1);
    }
  }

  private kick(t: number, gain: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(148, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(env); env.connect(bus);
    osc.start(t); osc.stop(t + 0.28);
    // щелчок атаки
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    const click = ctx.createGain();
    click.gain.setValueAtTime(gain * 0.22, t);
    click.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(hp); hp.connect(click); click.connect(bus);
    src.start(t, Math.random() * 0.4); src.stop(t + 0.04);
    // сайд-чейн
    this.duckPulse(t);
  }

  private snare(t: number, gain: number, freq: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = freq; band.Q.value = 0.9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    src.connect(band); band.connect(env); env.connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.21);
    // корпус
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(186, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    const be = ctx.createGain();
    be.gain.setValueAtTime(gain * 0.7, t);
    be.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    body.connect(be); be.connect(bus);
    body.start(t); body.stop(t + 0.14);
  }

  private taiko(t: number, gain: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    osc.connect(env); env.connect(bus);
    osc.start(t); osc.stop(t + 0.8);
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700;
    const ne = ctx.createGain();
    ne.gain.setValueAtTime(gain * 0.45, t);
    ne.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    src.connect(lp); lp.connect(ne); ne.connect(bus);
    src.start(t, Math.random() * 0.4); src.stop(t + 0.22);
  }

  private metal(t: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2800 + Math.random() * 2600;
    band.Q.value = 14;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.05, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(band); band.connect(env); env.connect(bus);
    if (audio.reverb) env.connect(audio.reverb);
    src.start(t, Math.random() * 0.5); src.stop(t + 1);
  }

  private hat(t: number, gain: number, dur: number) {
    const c = this.ctxBus();
    if (!c) return;
    const { ctx, bus } = c;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuf;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass'; high.frequency.value = 7400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(high); high.connect(env); env.connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  private duckPulse(t: number) {
    const ctx = audio.ctx;
    if (!ctx || !this.duck) return;
    const g = this.duck.gain;
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(0.55, t + 0.012);
    g.linearRampToValueAtTime(1, t + 0.16);
  }
}
