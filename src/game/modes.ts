/** Три режима мира. Поведение отличается всем: населением, полицией, ИИ, атмосферой. */
export type GameMode = 'peace' | 'normal' | 'zombie';

export interface SpawnWeight { variant: 'normal' | 'runner' | 'brute' | 'jumper' | 'bloodsucker' | 'civil' | 'stalker' | 'bandit'; w: number }

export interface ModeDef {
  id: GameMode;
  name: string;
  short: string;
  desc: string;
  /** Есть ли заражённые. */
  zombies: boolean;
  /** Гоняется ли полиция за игроком. */
  police: boolean;
  /** Сопротивляются ли люди (убегают, дают сдачи). */
  resist: boolean;
  /** Множитель преступлений (0 — полиции нет вовсе). */
  crimeScale: number;
  zombieMix: SpawnWeight[];
  humanMix: SpawnWeight[];
  /** Целевое число NPC, которых держит игра. */
  population: number;
  /** Скорость роста заражённых вокруг игрока (для зомби-режима). */
  ambient: number;
  hint: string;
}

const pick = (mix: SpawnWeight[]): SpawnWeight['variant'] => {
  if (!mix.length) return 'civil';
  let total = 0;
  for (const m of mix) total += m.w;
  let r = Math.random() * total;
  for (const m of mix) { r -= m.w; if (r <= 0) return m.variant; }
  return mix[0].variant;
};

export { pick as pickVariant };

export const MODES: Record<GameMode, ModeDef> = {
  peace: {
    id: 'peace',
    name: 'Мирный режим',
    short: 'Мирный',
    desc: 'В городе только люди. Полиция за тобой не гоняется, никто не сопротивляется — гуляй, покупай, убивай спокойно.',
    zombies: false,
    police: false,
    resist: false,
    crimeScale: 0,
    zombieMix: [],
    humanMix: [{ variant: 'civil', w: 1 }],
    population: 26,
    ambient: 0,
    hint: 'Мирный режим: полиция не реагирует, люди не убегают. Убивай без последствий.',
  },
  normal: {
    id: 'normal',
    name: 'Обычный режим',
    short: 'Обычный',
    desc: 'Классическая GTA: живой город, полиция, розыск, случайные драки. Никакой фантастики.',
    zombies: false,
    police: true,
    resist: true,
    crimeScale: 1,
    zombieMix: [],
    humanMix: [{ variant: 'civil', w: 0.9 }, { variant: 'bandit', w: 0.1 }],
    population: 30,
    ambient: 0,
    hint: 'Обычный режим: как в GTA — полиция ищет, люди дают сдачи и убегают.',
  },
  zombie: {
    id: 'zombie',
    name: 'Зомби-апокалипсис',
    short: 'Апокалипсис',
    desc: 'Город пал. Ходоки, бегуны, прыгуны и кровососы против людей-сталкеров и группировок — по духу «Зова Припяти».',
    zombies: true,
    police: false,
    resist: true,
    crimeScale: 0,
    zombieMix: [
      { variant: 'normal', w: 0.42 },
      { variant: 'runner', w: 0.24 },
      { variant: 'jumper', w: 0.16 },
      { variant: 'bloodsucker', w: 0.11 },
      { variant: 'brute', w: 0.07 },
    ],
    humanMix: [
      { variant: 'stalker', w: 0.42 },
      { variant: 'bandit', w: 0.34 },
      { variant: 'civil', w: 0.24 },
    ],
    population: 40,
    ambient: 0.55,
    hint: 'Зомби-апокалипсис: сталкеры отбиваются от заражённых, бандиты стреляют во всех.',
  },
};

export const MODE_ORDER: GameMode[] = ['peace', 'normal', 'zombie'];
