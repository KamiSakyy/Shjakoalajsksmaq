/**
 * Детерминированный мир.
 *
 * Раньше декорации (пальмы, вывески, окна, крыши, мусор) раскидывались через
 * Math.random(), поэтому каждый запуск давал новый город, а два игрока в онлайне
 * видели разные улицы. Теперь у мира есть фиксированное зерно: любой клиент
 * строит ровно тот же город, вплоть до последнего кондиционера на крыше.
 *
 * Потоки (streams) нужны, чтобы правка одного генератора не сдвигала остальные:
 * у каждого своё зерно, производное от общего.
 */

export const WORLD_SEED = 0x5ead_2026;

/** mulberry32 — быстрый и стабильный PRNG, одинаковый во всех браузерах. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Стабильный хэш строки — для имён потоков. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type WorldStream =
  | 'city' | 'textures' | 'props' | 'palms' | 'street' | 'landmarks'
  | 'miami' | 'ocean' | 'roofs' | 'materials' | 'district' | 'skyline';

type Rng = () => number;

const streams = new Map<WorldStream, Rng>();

/** Поток зерна: каждый вызов продолжает свою последовательность. */
export function worldRng(stream: WorldStream): Rng {
  let rng = streams.get(stream);
  if (!rng) {
    rng = mulberry32((WORLD_SEED ^ hashString(stream)) >>> 0);
    streams.set(stream, rng);
  }
  return rng;
}

/** Сброс потоков: нужен только тестам и повторной сборке мира. */
export function resetWorldStreams() { streams.clear(); }

export const range = (rng: Rng, a: number, b: number) => a + rng() * (b - a);
export const int = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
export const chance = (rng: Rng, p: number) => rng() < p;
export function pick<T>(rng: Rng, list: readonly T[]): T { return list[Math.floor(rng() * list.length) % list.length]; }
export const sign = (rng: Rng) => (rng() < 0.5 ? -1 : 1);

/** Короткие обёртки для генераторов мира. */
export const cityRand = (a = 0, b = 1) => range(worldRng('city'), a, b);
export const propsRand = (a = 0, b = 1) => range(worldRng('props'), a, b);
export const palmsRand = (a = 0, b = 1) => range(worldRng('palms'), a, b);
export const streetRand = (a = 0, b = 1) => range(worldRng('street'), a, b);
export const textureRand = () => worldRng('textures')();
export const miamiRand = (a = 0, b = 1) => range(worldRng('miami'), a, b);
export const roofRand = (a = 0, b = 1) => range(worldRng('roofs'), a, b);
export const matRand = (a = 0, b = 1) => range(worldRng('materials'), a, b);

/**
 * Подпись мира: хэш из зерна и ключевых параметров. Клиенты сверяют её при
 * подключении — если подписи разошлись, игра честно скажет, что версии разные.
 */
export function worldSignature(extra: Record<string, number | string> = {}): string {
  const base = `seed:${WORLD_SEED}|`;
  const tail = Object.keys(extra).sort().map(k => `${k}=${extra[k]}`).join('&');
  const h = hashString(base + tail).toString(16).padStart(8, '0');
  return h.slice(0, 8);
}
