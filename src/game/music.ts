import { audio } from './audio';

// Procedural radio: every track is synthesized in Web Audio, so nothing is licensed or streamed.
// Stations are scheduled in 16th notes with a look-ahead, which keeps the rhythm steady
// even when the browser is busy rendering the city.

export type StationId = 'synth' | 'lofi' | 'off';
export const STATIONS: { id: StationId; name: string; bpm: number }[] = [
  { id: 'synth', name: 'Пасифик FM · Synthwave', bpm: 104 },
  { id: 'lofi', name: 'Бэйфронт · Lo-Fi', bpm: 82 },
  { id: 'off', name: 'Радио выключено', bpm: 0 },
];

// Chords for a four bar loop. Each entry: bass note and the chord tones.
const SYNTH_CHORDS = [
  { bass: 55, tones: [220, 261.63, 329.63] },    // Am
  { bass: 43.65, tones: [174.61, 220, 261.63] }, // F
  { bass: 65.41, tones: [261.63, 329.63, 392] }, // C
  { bass: 49, tones: [196, 246.94, 293.66] },    // G
];
const LOFI_CHORDS = [
  { bass: 43.65, tones: [174.61, 220, 261.63, 329.63] }, // Fmaj7
  { bass: 36.71, tones: [146.83, 174.61, 220, 277.18] }, // Dm7
  { bass: 49, tones: [196, 246.94, 293.66, 369.99] },    // G7
  { bass: 32.7, tones: [130.81, 164.81, 196, 246.94] },  // Cmaj7
];

export class Radio {
  index = 0;
  private bus: GainNode | null = null;
  private vinyl: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private volume = 0.42;
  private running = false;

  get station() { return STATIONS[this.index]; }

  private ensure(): GainNode | null {
    const ctx = audio.ctx;
    if (!ctx) return null;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      this.bus.connect(audio.master);
      // Vinyl crackle, audible only on the lo-fi station.
      const crackle = ctx.createBufferSource();
      crackle.buffer = audio.noiseBuf; crackle.loop = true;
      const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 4200; band.Q.value = 0.7;
      this.vinyl = ctx.createGain(); this.vinyl.gain.value = 0;
      crackle.connect(band); band.connect(this.vinyl); this.vinyl.connect(this.bus);
      crackle.start();
    }
    return this.bus;
  }

  start() {
    const ctx = audio.ctx;
    const bus = this.ensure();
    if (!ctx || !bus) return;
    if (this.station.id === 'off') { this.stop(); return; }
    if (!this.running) {
      this.running = true;
      this.nextTime = ctx.currentTime + 0.15;
      this.timer = setInterval(() => this.schedule(), 50);
    }
    bus.gain.setTargetAtTime(this.volume * 0.22, ctx.currentTime, 0.35);
  }

  stop() {
    const ctx = audio.ctx;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    if (ctx && this.bus) this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  }

  cycle() {
    this.index = (this.index + 1) % STATIONS.length;
    if (this.station.id === 'off') this.stop();
    else this.start();
  }

  setVolume(v: number) {
    if (Math.abs(v - this.volume) < 0.01) return;
    this.volume = v;
    const ctx = audio.ctx;
    if (ctx && this.bus && this.running) this.bus.gain.setTargetAtTime(this.volume * 0.22, ctx.currentTime, 0.4);
  }

  private schedule() {
    const ctx = audio.ctx;
    const st = this.station;
    if (!ctx || st.id === 'off' || !this.running) return;
    const sixteenth = 60 / st.bpm / 4;
    if (this.vinyl) this.vinyl.gain.setTargetAtTime(st.id === 'lofi' ? 0.018 : 0, ctx.currentTime, 0.3);
    while (this.nextTime < ctx.currentTime + 0.22) {
      this.playStep(st.id, this.step, this.nextTime, sixteenth * 16);
      this.step++;
      this.nextTime += sixteenth;
    }
  }

  private playStep(id: StationId, step: number, t: number, barSeconds: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    if (id === 'synth') {
      const c = SYNTH_CHORDS[bar];
      if (s === 0 || s === 8 || s === 10) this.kick(t, 0.5);
      if (s === 4 || s === 12) this.snare(t, 0.22, 1900);
      if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.05 : 0.025);
      if (s % 2 === 0) this.tone(c.bass, t, 0.2, 'sawtooth', 0.085, 700);
      if (s === 0) c.tones.forEach((f, i) => this.tone(f, t + i * 0.008, barSeconds, 'triangle', 0.03, 2400));
      const arp = [c.tones[0] * 2, c.tones[1] * 2, c.tones[2] * 2, c.tones[1] * 4];
      if (s % 2 === 1) this.tone(arp[(s >> 1) % 4], t, 0.11, 'square', 0.02, 2600);
    } else if (id === 'lofi') {
      const c = LOFI_CHORDS[bar];
      if (s === 0 || s === 10) this.kick(t, 0.3);
      if (s === 4 || s === 12) this.snare(t, 0.12, 1400);
      if (s === 0) c.tones.forEach((f, i) => this.tone(f, t + i * 0.014, barSeconds, 'triangle', 0.028, 1700));
      if (s === 2 || s === 6 || s === 10) this.tone(c.tones[1] * 2, t, 0.5, 'sine', 0.016, 1500);
      if (s % 4 === 0) this.tone(c.bass, t, 0.5, 'sine', 0.09, 380);
    }
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff: number) {
    const ctx = audio.ctx; const bus = this.bus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter); filter.connect(env); env.connect(bus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  private kick(t: number, gain: number) {
    const ctx = audio.ctx; const bus = this.bus;
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(env); env.connect(bus);
    osc.start(t); osc.stop(t + 0.22);
  }

  private snare(t: number, gain: number, freq: number) {
    const ctx = audio.ctx; const bus = this.bus;
    if (!ctx || !bus) return;
    const src = ctx.createBufferSource(); src.buffer = audio.noiseBuf;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = freq; band.Q.value = 0.9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(band); band.connect(env); env.connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.2);
  }

  private hat(t: number, gain: number) {
    const ctx = audio.ctx; const bus = this.bus;
    if (!ctx || !bus) return;
    const src = ctx.createBufferSource(); src.buffer = audio.noiseBuf;
    const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 7200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t); env.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(high); high.connect(env); env.connect(bus);
    src.start(t, Math.random() * 0.5); src.stop(t + 0.06);
  }
}
