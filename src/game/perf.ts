/**
 * Мобильная оптимизация и адаптивное качество.
 *
 * Игра сама определяет класс устройства (Android/Adreno/Mali, iPhone, десктоп),
 * выбирает бюджет кадра и затем плавно подстраивает разрешение рендера так,
 * чтобы удерживать 60/30 FPS без потери деталей сцены — падает только
 * внутреннее разрешение и вторичные эффекты, а геометрия, свет и шейдеры
 * остаются на месте.
 */

export type Quality = 'auto' | 'low' | 'high' | 'ultra';

export interface DeviceInfo {
  mobile: boolean;
  touch: boolean;
  cores: number;
  memory: number;
  dpr: number;
  gpu: string;
  apple: boolean;
  adreno: boolean;
  mali: boolean;
  software: boolean;
  webgl2: boolean;
}

export interface GfxBudget {
  tier: 'low' | 'high' | 'ultra';
  label: string;
  /** базовый pixel ratio (до адаптивного множителя) */
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  shadowRadius: number;
  bloom: boolean;
  bloomScale: number;
  bloomStrength: number;
  grade: boolean;
  waterSegments: number;
  waterShaderDetail: 0 | 1 | 2;
  particleScale: number;
  npcTarget: number;
  carTarget: number;
  drawDistance: number;
  anisotropy: number;
  canvasTexSize: number;
  skidMarks: number;
  farView: number;
  antialias: boolean;
  fogDensity: number;
  trafficLights: boolean;
  maxDolls: number;
}

const isTouch = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
const ua = () => (typeof navigator !== 'undefined' ? navigator.userAgent : '');
const lowPowerUA = () => /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua());

let cached: DeviceInfo | null = null;

export function detectDevice(): DeviceInfo {
  if (cached) return cached;
  const nav = typeof navigator !== 'undefined' ? navigator : ({} as Navigator);
  const cores = nav.hardwareConcurrency || 4;
  const memory = (nav as Navigator & { deviceMemory?: number }).deviceMemory || 4;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  let gpu = '';
  let webgl2 = false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGL2RenderingContext | null;
    if (gl) {
      webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      if (!gpu) gpu = String(gl.getParameter(gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    }
  } catch {
    /* Скрытый WebGL — значит устройство очень слабое. */
  }
  const g = gpu.toLowerCase();
  const info: DeviceInfo = {
    mobile: lowPowerUA() || isTouch(),
    touch: isTouch(),
    cores,
    memory,
    dpr,
    gpu,
    apple: /apple|metal|a1[0-9]|m1|m2|m3/i.test(g),
    adreno: /adreno/i.test(g),
    mali: /mali/i.test(g),
    software: /swiftshader|llvmpipe|software/i.test(g),
    webgl2,
  };
  cached = info;
  return info;
}

export function budgetFor(quality: Quality, info = detectDevice()): GfxBudget {
  // «auto» — игровой профиль по железу: на телефоне держим красивую картинку,
  // но убираем всё, что стоит лишних миллисекунд в постобработке.
  const weak = !info.webgl2 || info.software || info.cores <= 4 || info.memory <= 3;
  const tier: 'low' | 'high' | 'ultra' =
    quality === 'auto' ? (weak ? 'low' : info.mobile ? 'high' : 'ultra') : quality;

  const base: GfxBudget = {
    tier,
    label: tier === 'low' ? 'Эконом' : tier === 'high' ? 'Мобильный' : 'Максимум',
    pixelRatio: info.mobile ? Math.min(info.dpr, 2.1) : Math.min(info.dpr, 2),
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 2.4,
    bloom: true,
    bloomScale: 0.55,
    bloomStrength: 0.2,
    grade: true,
    waterSegments: 128,
    waterShaderDetail: 2,
    particleScale: 1,
    npcTarget: 28,
    carTarget: 22,
    drawDistance: 520,
    anisotropy: 8,
    canvasTexSize: 512,
    skidMarks: 300,
    farView: 560,
    antialias: true,
    fogDensity: 0.0016,
    trafficLights: true,
    maxDolls: 6,
  };

  if (tier === 'high') {
    Object.assign(base, {
      pixelRatio: Math.min(info.dpr, 1.85),
      shadowMapSize: 1024,
      shadowRadius: 1.6,
      bloomScale: 0.42,
      bloomStrength: 0.19,
      waterSegments: 104,
      waterShaderDetail: info.mobile ? 1 : 2,
      particleScale: 0.8,
      npcTarget: 22,
      carTarget: 16,
      drawDistance: 400,
      anisotropy: 4,
      canvasTexSize: 384,
      skidMarks: 220,
      farView: 430,
      antialias: !info.mobile,
      fogDensity: 0.0021,
      maxDolls: 4,
    } satisfies Partial<GfxBudget>);
  }
  if (tier === 'low') {
    Object.assign(base, {
      pixelRatio: Math.min(info.dpr, 1.45),
      shadows: true,
      shadowMapSize: 512,
      shadowRadius: 0.8,
      bloom: false,
      bloomScale: 0.3,
      bloomStrength: 0,
      grade: false,
      waterSegments: 64,
      waterShaderDetail: 0,
      particleScale: 0.5,
      npcTarget: 14,
      carTarget: 10,
      drawDistance: 280,
      anisotropy: 2,
      canvasTexSize: 256,
      skidMarks: 120,
      farView: 300,
      antialias: false,
      fogDensity: 0.0032,
      trafficLights: false,
      maxDolls: 3,
    } satisfies Partial<GfxBudget>);
  }
  // Apple Silicon и свежие десктопные GPU тянут чуть больше.
  if (tier === 'ultra' && info.apple) base.pixelRatio = Math.min(info.dpr, 2);
  return base;
}

/**
 * Адаптивное разрешение: измеряет медиану кадра и меняет множитель DPR.
 * Понижает быстро (чтобы не было «слайд-шоу»), повышает медленно и только
 * когда запас стабильный.
 */
export class AdaptiveResolution {
  private samples: number[] = [];
  private scale = 1;
  private cooldown = 1.2;
  private stable = 0;
  enabled = true;
  min = 0.56;
  max = 1;
  /** множитель к базовому pixelRatio */
  get value() { return this.scale; }

  reset() { this.samples.length = 0; this.scale = 1; this.cooldown = 1.2; this.stable = 0; }

  update(frameMs: number, dt: number): number | null {
    if (!this.enabled) return null;
    this.samples.push(frameMs);
    if (this.samples.length > 24) this.samples.shift();
    this.cooldown -= dt;
    if (this.samples.length < 12) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const target = 1000 / 55;
    const slow = 1000 / 40;
    let next: number | null = null;
    if (median > slow) {
      this.scale = Math.max(this.min, this.scale - (median > 40 ? 0.14 : 0.07));
      this.stable = 0;
      next = this.scale;
      this.samples.length = 0;
      this.cooldown = 0.65;
    } else if (median < target && this.cooldown <= 0) {
      this.stable++;
      if (this.stable > 2) {
        this.scale = Math.min(this.max, this.scale + 0.05);
        this.stable = 0;
        next = this.scale;
        this.samples.length = 0;
        this.cooldown = 1.4;
      }
    } else if (median >= target) {
      this.stable = 0;
    }
    return next;
  }
}

/** Мягкий бюджет на количество активных объектов: держим сцену живой, но в кадре. */
export const clampCount = (n: number, target: number) => Math.max(0, Math.min(n, target));

export const qualityLabel = (q: Quality, b: GfxBudget) =>
  q === 'auto' ? `Авто · ${b.label}` : q === 'low' ? 'Экономия' : q === 'high' ? 'Высокое' : 'Ультра';
