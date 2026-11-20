import type { CarKind } from './vehicle';

export type ShopKind = 'vehicle' | 'weapon' | 'ammo' | 'upgrade' | 'med';

export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  desc: string;
  price: number;
  glyph: string;
  /** Покупается один раз (владение / тюнинг). */
  once?: boolean;
  carKind?: CarKind;
  paint?: number;
  weapon?: 'pistol' | 'shotgun';
  amount?: number;
}

export const SHOP: ShopItem[] = [
  // ── транспорт ──────────────────────────────────────────────────────
  { id: 'v_sedan', kind: 'vehicle', name: 'Седан «Biscayne»', desc: 'Надёжная городская машина. 4 места, багажник, неприметная.', price: 9800, glyph: '🚗', once: true, carKind: 'sedan' },
  { id: 'v_van', kind: 'vehicle', name: 'Фургон «Haulmaster»', desc: 'Тяжёлый и медленный, зато переживает перестрелку.', price: 14500, glyph: '🚚', once: true, carKind: 'van' },
  { id: 'v_sport', kind: 'vehicle', name: 'Спорткар «Vice GT»', desc: '58 м/с по прямой. Полиция остаётся позади.', price: 42000, glyph: '🏎', once: true, carKind: 'sport', paint: 0xd8322a },
  { id: 'v_moto', kind: 'vehicle', name: 'Мотоцикл «Neon Fang»', desc: 'Быстрый, юркий, проходит между машинами. Падать больно.', price: 18500, glyph: '🏍', once: true, carKind: 'moto', paint: 0x2ad0c8 },
  { id: 'v_moto_pro', kind: 'vehicle', name: 'Спортбайк «Sting»', desc: '63 м/с. Разгон как удар током.', price: 36000, glyph: '🏍', once: true, carKind: 'moto', paint: 0xf05a1e },

  // ── оружие ─────────────────────────────────────────────────────────
  { id: 'w_shotgun', kind: 'weapon', name: 'Дробовик «Sawed-off»', desc: 'Восемь картечин. В упор снимает голову с плеч.', price: 3200, glyph: '🔫', once: true, weapon: 'shotgun' },
  { id: 'a_pistol', kind: 'ammo', name: 'Патроны 9×19 — 60 шт', desc: 'Стандартный боекомплект для пистолета.', price: 180, glyph: '▮', weapon: 'pistol', amount: 60 },
  { id: 'a_shells', kind: 'ammo', name: 'Картечь 12К — 24 шт', desc: 'Для дробовика. Не экономь.', price: 220, glyph: '▮', weapon: 'shotgun', amount: 24 },

  // ── тюнинг ─────────────────────────────────────────────────────────
  { id: 'u_suppressor', kind: 'upgrade', name: 'Глушитель', desc: 'Выстрелы почти не слышно: полиция не приезжает на шум.', price: 2600, glyph: '◍', once: true },
  { id: 'u_extmag', kind: 'upgrade', name: 'Расширенный магазин', desc: '+9 патронов в пистолете, быстрее перезарядка.', price: 1400, glyph: '▤', once: true },
  { id: 'u_heavy', kind: 'upgrade', name: 'Тяжёлые патроны', desc: '+35% урона, пуля пробивает тело насквозь.', price: 3400, glyph: '▲', once: true },
  { id: 'u_laser', kind: 'upgrade', name: 'Лазерный целеуказатель', desc: 'Разброс меньше вдвое, прицеливание быстрее.', price: 1900, glyph: '✦', once: true },
  { id: 'u_recoil', kind: 'upgrade', name: 'Демпфер отдачи', desc: 'Ствол не уводит вверх, очередь ложится кучно.', price: 2300, glyph: '≡', once: true },
  { id: 'u_buckshot', kind: 'upgrade', name: 'Крупная дробь', desc: 'Дробовик бьёт дальше и отрывает конечности чаще.', price: 2100, glyph: '❖', once: true },
  { id: 'u_armor2', kind: 'upgrade', name: 'Бронежилет Mk II', desc: 'Максимум брони 100 → 160.', price: 5000, glyph: '⛨', once: true },

  // ── расходники ─────────────────────────────────────────────────────
  { id: 'm_medkit', kind: 'med', name: 'Аптечка', desc: 'Полное восстановление здоровья в бою.', price: 240, glyph: '✚', amount: 1 },
  { id: 'm_armor', kind: 'med', name: 'Бронепластина', desc: '+45 брони сразу.', price: 380, glyph: '⛨', amount: 45 },
];

export const SHOP_BY_ID = new Map(SHOP.map((i) => [i.id, i]));

export const SHOP_SECTIONS: { kind: ShopKind; title: string }[] = [
  { kind: 'vehicle', title: 'Транспорт' },
  { kind: 'weapon', title: 'Оружие' },
  { kind: 'ammo', title: 'Патроны' },
  { kind: 'upgrade', title: 'Тюнинг' },
  { kind: 'med', title: 'Расходники' },
];
