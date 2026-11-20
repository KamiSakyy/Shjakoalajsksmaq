export const BLOCK = 78;
export const ROAD_W = 17;
export const WALK_W = 3.4;
export const GRID = 6;
export const BOUNDS = BLOCK * GRID;
// Берег начинается за последней улицей: Ocean Drive, променад и пляж.
export const COAST = BOUNDS + 44;
export const START = { x: 2.8, z: 24 };
export const CITY_SEED = 20260518;

export interface Point { x: number; z: number }
export type LandmarkKind = 'plaza' | 'park' | 'garage' | 'station' | 'coast' | 'market' | 'hospital' | 'fire' | 'bank' | 'hotel' | 'diner' | 'stadium' | 'marina' | 'college' | 'gas' | 'beach' | 'ocean' | 'island' | 'pier';
export interface Landmark extends Point { id: LandmarkKind; name: string; district: string; description: string }
export interface Footprint extends Point { w: number; d: number; h: number; color: number; tower: boolean }
type ParcelKind = 'buildings' | 'park' | 'plaza' | 'garage' | 'station' | 'hospital' | 'fire' | 'bank' | 'hotel' | 'diner' | 'stadium' | 'marina' | 'college' | 'gas';
interface Parcel extends Point { kind: ParcelKind; buildings: Footprint[] }

export const LANDMARKS: readonly Landmark[] = [
  { id: 'plaza', name: 'Площадь Пасифик', district: 'Центр', x: 0, z: 39, description: 'Фонтан, широкие тротуары и главный бульвар.' },
  { id: 'park', name: 'Парк Сансет', district: 'Сансет', x: -78, z: 39, description: 'Тенистые аллеи, баскетбольная площадка и пруд.' },
  { id: 'garage', name: 'Мастерская Уэстсайд', district: 'Уэстсайд', x: -116, z: 0, description: 'Ремонт машины и заправка. Нажми «Ремонт», когда стоишь рядом.' },
  { id: 'coast', name: 'Морской пирс', district: 'Бэйфронт', x: COAST - 6, z: 107, description: 'Набережная, смотровая площадка и пирс в залив.' },
  { id: 'beach', name: 'Пляж Саут-Бич', district: 'Саут-Бич', x: COAST + 62, z: 60, description: 'Белый песок, спасательные вышки и бирюзовая вода.' },
  { id: 'ocean', name: 'Ocean Drive', district: 'Саут-Бич', x: COAST - 34, z: 40, description: 'Арт-деко отели, неон и пальмы вдоль пляжа.' },
  { id: 'station', name: 'Патрульный участок', district: 'Северный центр', x: 42, z: -78, description: 'Полицейский участок и маршруты пеших патрулей.' },
  { id: 'market', name: 'Рыночная улица', district: 'Олд-Таун', x: -178, z: 78, description: 'Старые кирпичные кварталы и небольшие магазины.' },
  { id: 'hospital', name: 'Городская больница', district: 'Северный центр', x: -140, z: -120, description: 'Приёмное отделение, скорая помощь и аптечный вход.' },
  { id: 'fire', name: 'Пожарная часть №4', district: 'Уэстсайд', x: -240, z: -60, description: 'Пожарные расчёты выезжают на возгорания в городе.' },
  { id: 'bank', name: 'Банк Пасифик', district: 'Пасифик-центр', x: 60, z: 120, description: 'Каменный фасад, колонны и охраняемый вход.' },
  { id: 'hotel', name: 'Отель «Марина»', district: 'Бэйфронт', x: 300, z: 220, description: 'Высотный отель у побережья с яркой вывеской.' },
  { id: 'diner', name: 'Закусочная «Орион»', district: 'Южный Пасифик', x: -40, z: 220, description: 'Классическая придорожная закусочная с неоновой вывеской.' },
  { id: 'stadium', name: 'Стадион «Пасифик»', district: 'Южный Пасифик', x: -300, z: 260, description: 'Трибуны, прожекторы и большая парковка.' },
  { id: 'marina', name: 'Марина', district: 'Бэйфронт', x: 400, z: 40, description: 'Причалы, лодки и набережная для прогулок.' },
  { id: 'college', name: 'Городской колледж', district: 'Даунтаун', x: -280, z: -240, description: 'Кампус с корпусами, внутренним двором и библиотекой.' },
  { id: 'gas', name: 'Заправка «24»', district: 'Пасифик-центр', x: 140, z: 40, description: 'Топливо, магазин и яркая колонная вывеска.' },
];

const SPECIALS: Partial<Record<string, ParcelKind>> = {
  '0,0': 'plaza', '-2,-1': 'garage', '0,-2': 'station', '-2,-4': 'hospital', '-3,-1': 'fire',
  '1,1': 'bank', '3,3': 'hotel', '-1,3': 'diner', '-4,4': 'stadium', '5,1': 'marina',
  '-4,-4': 'college', '2,1': 'gas',
};
export function districtAt(p: Point) {
  if (p.x > COAST + 4) return p.x > 700 ? 'Залив' : 'Пляж';
  if (p.x > BOUNDS - 24) return 'Саут-Бич';
  if (p.x > BOUNDS - 70) return 'Бэйфронт';
  if (p.z < -BOUNDS * 0.52) return p.x < -90 ? 'Даунтаун' : 'Северный центр';
  if (p.x < -BOUNDS * 0.48) return p.z > 60 ? 'Олд-Таун' : 'Уэстсайд';
  if (p.x < -30 && p.z > 66) return 'Сансет';
  if (p.z > BOUNDS * 0.55) return 'Южный Пасифик';
  return 'Пасифик-центр';
}

function seedRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function createPlan() {
  const random = seedRandom(CITY_SEED);
  const range = (a: number, b: number) => a + (b - a) * random();
  const city: Parcel[] = [];
  for (let i = -GRID; i < GRID; i++) for (let j = -GRID; j < GRID; j++) {
    const x = (i + 0.5) * BLOCK, z = (j + 0.5) * BLOCK;
    let kind: ParcelKind = SPECIALS[`${i},${j}`] ?? 'buildings';
    if (kind === 'buildings' && ((i % 4 === 2 && j % 3 === 1) || (i % 5 === 0 && j % 4 === 2) || ((i === -1 || i === 2) && (j === 0 || j === 2)))) kind = 'park';
    const buildings: Footprint[] = [];
    if (kind !== 'plaza' && kind !== 'park') {
      const downtown = z < -110 && x > -330 && x < 150;
      const special = !['buildings', 'garage', 'station'].includes(kind);
      const count = special ? 1 : kind === 'garage' || kind === 'station' ? 1 : random() < 0.72 ? 2 : 1;
      const tower = downtown && random() < 0.76;
      const colors = tower ? [0x8d9da0, 0x9faeac, 0xb4a89b, 0x778e9e, 0xa29d91] : x < -80 ?
        [0xbc8e75, 0xbb9c82, 0xceb5a0, 0xa3907e, 0xd0bbaa] : [0xc4bcaa, 0xa0a9a0, 0xb8ada3, 0xc9b6a4, 0x9e9182];
      for (let k = 0; k < count; k++) {
        const w = count === 1 ? range(special ? 33 : 29, 45) : range(19, 24), d = range(24, 47);
        const h = kind === 'garage' ? 5.6 : kind === 'station' ? 9.0 : kind === 'hospital' ? 19.5 : kind === 'fire' ? 8.4 :
          kind === 'college' ? 14.4 : kind === 'stadium' ? 18.8 : kind === 'hotel' ? 42 : tower ? range(29, 74) : 4.1 + 3.3 * Math.floor(range(1, 4));
        buildings.push({ x: x + (count === 1 ? 0 : k === 0 ? -13.5 : 13.5), z: z + (special || kind === 'garage' || kind === 'station' ? 4 : range(-5, 5)),
          w, d, h, tower, color: colors[Math.floor(random() * colors.length)] });
      }
    }
    city.push({ x, z, kind, buildings });
  }
  return city;
}

export const CITY_PLAN = createPlan();
export const BUILDINGS = CITY_PLAN.flatMap(p => p.buildings);
export const ROAD_LINES = Array.from({ length: GRID * 2 + 1 }, (_, i) => (i - GRID) * BLOCK);

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
export function streetPoint(p: Point): Point {
  const x = clamp(p.x, -BOUNDS, BOUNDS), z = clamp(p.z, -BOUNDS, BOUNDS);
  const gx = Math.round(x / BLOCK) * BLOCK, gz = Math.round(z / BLOCK) * BLOCK;
  return Math.abs(x - gx) < Math.abs(z - gz) ? { x: gx, z } : { x, z: gz };
}

export function locationName(p: Point) {
  return LANDMARKS.find(l => distance(l, p) < 8)?.name ?? districtAt(p);
}

// The start and end can be anywhere on a street segment, not only at a junction.
export function cityRoute(start: Point, goal: Point): Point[] {
  const a = streetPoint(start), b = streetPoint(goal);
  const junctions = (p: Point) => p.x % BLOCK === 0 ? [
    { x: p.x, z: Math.floor(p.z / BLOCK) * BLOCK }, { x: p.x, z: Math.ceil(p.z / BLOCK) * BLOCK },
  ] : [
    { x: Math.floor(p.x / BLOCK) * BLOCK, z: p.z }, { x: Math.ceil(p.x / BLOCK) * BLOCK, z: p.z },
  ];
  let cost = Infinity;
  let best: Point[] = [];
  const propose = (points: Point[]) => {
    const path = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 0.05);
    let score = path.reduce((total, p, i) => i ? total + distance(path[i - 1], p) : total, 0);
    for (let i = 1; i < path.length - 1; i++) {
      const p = path[i - 1], q = path[i], r = path[i + 1];
      const cross = (q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x);
      if (Math.abs(cross) > 0.2) score += 6;
      else score += 0.05;
    }
    if (score < cost) { cost = score; best = path; }
  };
  if (a.x === b.x && a.x % BLOCK === 0 || a.z === b.z && a.z % BLOCK === 0) propose([a, b]);
  for (const p of junctions(a)) for (const q of junctions(b)) {
    propose([a, p, { x: q.x, z: p.z }, q, b]);
    propose([a, p, { x: p.x, z: q.z }, q, b]);
  }
  const line = distance(start, a) > 1 ? [start, ...best] : best;
  return line;
}

export const routeDistance = (line: readonly Point[]) => line.reduce((total, p, i) => i ? total + distance(p, line[i - 1]) : total, 0);
export const formatDistance = (m: number) => m < 1000 ? `${Math.round(m / 5) * 5} м` : `${(m / 1000).toFixed(1).replace('.', ',')} км`;