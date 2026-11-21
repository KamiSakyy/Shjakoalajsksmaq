import * as THREE from 'three';
import type { Textures } from './materials';

/**
 * Арсенал топоров.
 *
 * Десять разных инструментов с собственной геометрией и физикой: короткий
 * туристический топорик летает быстрее всех, но почти не рубит кость; бардиш
 * достаёт с полутора метров и режет как гильотина; кувалда-колун не режет, а
 * ломает. Характеристики реальные — они попадают в момент инерции, длину
 * выборки лезвия, порог отсечения и расход сил.
 */

export type AxeShape = 'bearded' | 'flat' | 'double' | 'bardiche' | 'maul' | 'exec' | 'tactical' | 'rescue';

export interface AxeSpec {
  id: string;
  name: string;
  short: string;
  desc: string;
  shape: AxeShape;
  /** Длина рукояти, м. */
  L: number;
  headMass: number;
  handleMass: number;
  /** Габариты лезвия: ширина (по Z) и высота (по Y). */
  bladeW: number;
  bladeH: number;
  headDepth: number;
  steel: number;
  handleColor: number;
  /** Множители боевых характеристик. */
  damage: number;
  cut: number;
  speed: number;
  stamina: number;
  stuck: number;
  pierce: number;
  /** Мощь 1..10 — для карточки в телефоне. */
  power: number;
}

/**
 * Что делает конкретная форма головы. Это не «урон», а характер разруба:
 * палач снимает голову с одного захода, кувалда ломает кость и не режет
 * конечности, бардиш перерубает торс, топорик отлично снимает кисти и стопы.
 */
export interface SeverProfile {
  head: number;
  limb: number;
  torso: number;
  /** Насколько удар «дробит», а не режет: больше мяса, меньше ровного реза. */
  crush: number;
  /** Множитель количества брызг и силы артериального фонтана. */
  spray: number;
}

export const SEVER_PROFILE: Record<AxeShape, SeverProfile> = {
  rescue:    { head: 1.0,  limb: 1.0,  torso: 0.95, crush: 1.1,  spray: 1.0 },
  flat:      { head: 0.85, limb: 1.2,  torso: 0.7,  crush: 1.0,  spray: 0.95 },
  bearded:   { head: 1.15, limb: 1.05, torso: 1.05, crush: 1.0,  spray: 1.1 },
  double:    { head: 1.2,  limb: 1.1,  torso: 1.0,  crush: 0.9,  spray: 1.15 },
  bardiche:  { head: 1.35, limb: 1.15, torso: 1.25, crush: 0.85, spray: 1.3 },
  maul:      { head: 1.3,  limb: 0.55, torso: 1.4,  crush: 1.8,  spray: 0.6 },
  exec:      { head: 1.5,  limb: 0.9,  torso: 1.0,  crush: 0.7,  spray: 1.4 },
  tactical:  { head: 0.95, limb: 1.25, torso: 0.8,  crush: 1.05, spray: 1.0 },
};

export function severProfile(spec: AxeSpec): SeverProfile {
  return SEVER_PROFILE[spec.shape];
}

export const AXES: AxeSpec[] = [
  {
    id: 'rescue', name: 'Аварийный топор', short: 'АВАРИЙНЫЙ', shape: 'rescue',
    desc: 'Компактный, с гардом и гвоздодёром в обухе. Универсальный стартовый инструмент: быстрый, ровный, без сюрпризов.',
    L: 0.68, headMass: 1.25, handleMass: 0.75, bladeW: 0.2, bladeH: 0.2, headDepth: 0.032,
    steel: 0x8e949b, handleColor: 0x6b3f2a,
    damage: 1, cut: 1, speed: 1, stamina: 1, stuck: 1, pierce: 1, power: 4,
  },
  {
    id: 'hatchet', name: 'Туристический топорик', short: 'ТОПОРИК', shape: 'flat',
    desc: 'Полметра дерева и полкило стали. Летает в руке быстрее любого другого, но череп им не расколешь — только вскроешь.',
    L: 0.44, headMass: 0.62, handleMass: 0.34, bladeW: 0.135, bladeH: 0.145, headDepth: 0.026,
    steel: 0x9aa1a8, handleColor: 0x8a6a44,
    damage: 0.62, cut: 0.86, speed: 1.55, stamina: 0.55, stuck: 0.7, pierce: 0.9, power: 2,
  },
  {
    id: 'fire', name: 'Пожарный топор', short: 'ПОЖАРНЫЙ', shape: 'bearded',
    desc: 'Кованая голова с бородой, длинная рукоять, шип в обухе. Пробивает двери, черепа и броню — с одинаковым равнодушием.',
    L: 0.88, headMass: 1.95, handleMass: 1.0, bladeW: 0.235, bladeH: 0.24, headDepth: 0.036,
    steel: 0xa8362c, handleColor: 0x53382a,
    damage: 1.22, cut: 1.18, speed: 0.88, stamina: 1.12, stuck: 1.1, pierce: 1.35, power: 7,
  },
  {
    id: 'viking', name: 'Бородатый викинг', short: 'ВИКИНГ', shape: 'bearded',
    desc: 'Длинная борода лезвия работает как крюк: режет на замахе и вытягивает куски на себя. Классика, которой полтора тысячелетия.',
    L: 0.8, headMass: 1.6, handleMass: 0.85, bladeW: 0.26, bladeH: 0.29, headDepth: 0.03,
    steel: 0x8f9298, handleColor: 0x53331f,
    damage: 1.1, cut: 1.34, speed: 0.98, stamina: 0.95, stuck: 1.15, pierce: 1.0, power: 6,
  },
  {
    id: 'tactical', name: 'Тактический томогавк', short: 'ТОМОГАВК', shape: 'tactical',
    desc: 'Сталь, композит, острый шип напротив лезвия. Лёгкий и злой: входит в кость и не вязнет.',
    L: 0.56, headMass: 0.85, handleMass: 0.4, bladeW: 0.18, bladeH: 0.15, headDepth: 0.024,
    steel: 0x3c4148, handleColor: 0x22262b,
    damage: 0.92, cut: 1.08, speed: 1.32, stamina: 0.72, stuck: 0.55, pierce: 1.3, power: 5,
  },
  {
    id: 'double', name: 'Двулезвийный', short: 'ДВУЛЕЗВИЙНЫЙ', shape: 'double',
    desc: 'Два лезвия — вдвое больше шансов поймать цель на любом замахе. Тяжёлая голова закручивает корпус.',
    L: 0.94, headMass: 2.15, handleMass: 1.05, bladeW: 0.34, bladeH: 0.24, headDepth: 0.04,
    steel: 0x9da3aa, handleColor: 0x4a2f20,
    damage: 1.28, cut: 1.42, speed: 0.82, stamina: 1.18, stuck: 1.2, pierce: 1.05, power: 8,
  },
  {
    id: 'bardiche', name: 'Бардиш', short: 'БАРДИШ', shape: 'bardiche',
    desc: 'Полтора метра древка и полумесяц лезвия. Достаёт тех, кто считал, что отошёл на безопасное расстояние.',
    L: 1.42, headMass: 2.6, handleMass: 1.4, bladeW: 0.42, bladeH: 0.34, headDepth: 0.036,
    steel: 0x969ba1, handleColor: 0x5b4028,
    damage: 1.45, cut: 1.62, speed: 0.62, stamina: 1.4, stuck: 1.35, pierce: 0.95, power: 9,
  },
  {
    id: 'splitting', name: 'Колун', short: 'КОЛУН', shape: 'bearded',
    desc: 'Клин, а не лезвие. Не режет — раскалывает по волокну, как полено. Кость ломается с сухим треском.',
    L: 0.86, headMass: 2.35, handleMass: 1.0, bladeW: 0.22, bladeH: 0.22, headDepth: 0.055,
    steel: 0x7d838a, handleColor: 0x6d4a2c,
    damage: 1.35, cut: 0.94, speed: 0.78, stamina: 1.25, stuck: 1.5, pierce: 1.15, power: 7,
  },
  {
    id: 'maul', name: 'Кувалда-колун', short: 'КУВАЛДА', shape: 'maul',
    desc: 'Тупая сталь на длинной ручке. Почти не режет, зато ломает рёбра и сбивает с ног одним движением.',
    L: 1.05, headMass: 3.6, handleMass: 1.5, bladeW: 0.2, bladeH: 0.26, headDepth: 0.09,
    steel: 0x5f646a, handleColor: 0x6a6a5a,
    damage: 1.75, cut: 0.42, speed: 0.6, stamina: 1.55, stuck: 0.6, pierce: 0.5, power: 8,
  },
  {
    id: 'exec', name: 'Топор палача', short: 'ПАЛАЧ', shape: 'exec',
    desc: 'Четырнадцать фунтов чистой ненависти. Один замах — и голова не успевает упасть до замедления времени.',
    L: 1.12, headMass: 4.2, handleMass: 1.7, bladeW: 0.46, bladeH: 0.36, headDepth: 0.05,
    steel: 0x6b7076, handleColor: 0x2c211a,
    damage: 1.85, cut: 1.95, speed: 0.5, stamina: 1.7, stuck: 1.45, pierce: 1.2, power: 10,
  },
];

export const AXE_BY_ID = new Map(AXES.map((a) => [a.id, a]));
export const DEFAULT_AXE = 'rescue';

/** Контур головы в плоскости (z, y) относительно центра головы. */
export function headProfile(spec: AxeSpec): [number, number][] {
  const w = spec.bladeW, h = spec.bladeH;
  switch (spec.shape) {
    case 'flat':
      return [
        [0.02, h * 0.42], [0.02, -h * 0.42], [-w * 0.3, -h * 0.5],
        [-w * 0.62, -h * 0.46], [-w, -h * 0.12], [-w, h * 0.14], [-w * 0.6, h * 0.44], [-w * 0.28, h * 0.5],
      ];
    case 'bearded':
      return [
        [0.03, h * 0.4], [0.03, -h * 0.36], [-w * 0.22, -h * 0.5],
        [-w * 0.55, -h * 0.72], [-w, -h * 0.64], [-w * 1.02, h * 0.05], [-w * 0.78, h * 0.46], [-w * 0.3, h * 0.52],
      ];
    case 'double':
      return [
        [0.02, h * 0.3], [0.02, -h * 0.3], [-w * 0.5, -thumb(h)], [-w, -h * 0.1], [-w, h * 0.13], [-w * 0.52, h * 0.42],
      ];
    case 'bardiche':
      return [
        [0.03, h * 0.42], [0.03, -h * 0.3], [-w * 0.35, -h * 0.44], [-w * 0.72, -h * 0.5],
        [-w, -h * 0.3], [-w * 1.05, h * 0.16], [-w * 0.86, h * 0.5], [-w * 0.32, h * 0.56],
      ];
    case 'maul':
      return [[0.02, h * 0.5], [0.02, -h * 0.5], [-w, -h * 0.5], [-w, h * 0.5]];
    case 'exec':
      return [
        [0.03, h * 0.34], [0.03, -h * 0.34], [-w * 0.4, -h * 0.44], [-w * 0.82, -h * 0.34],
        [-w, h * 0.02], [-w * 0.8, h * 0.4], [-w * 0.36, h * 0.48],
      ];
    case 'tactical':
      return [
        [0.02, h * 0.36], [0.02, -h * 0.3], [-w * 0.42, -h * 0.42],
        [-w, -h * 0.16], [-w * 0.98, h * 0.18], [-w * 0.44, h * 0.42],
      ];
    case 'rescue':
    default:
      return [
        [0.03, h * 0.4], [0.03, -h * 0.4], [-w * 0.35, -h * 0.5],
        [-w * 0.82, -h * 0.44], [-w, -h * 0.05], [-w * 0.8, h * 0.42], [-w * 0.34, h * 0.5],
      ];
  }
}

const thumb = (h: number) => h * 0.55;

/**
 * Собирает модель топора. Возвращает группу и точки кромки для коллайдера:
 * лезвие смотрит в −Z, рукоять идёт вдоль +Y от хвата.
 */
export function buildAxe(spec: AxeSpec, tex: Textures) {
  const root = new THREE.Group();
  const L = spec.L;

  const wood = new THREE.MeshStandardMaterial({ map: tex.handleWood, color: spec.handleColor, roughness: 0.82, metalness: 0 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x241d18, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ map: tex.metal, color: spec.steel, roughness: 0.42, metalness: 0.9 });
  const polish = new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.12, metalness: 1 });

  // рукоять
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.023, L, 12, 1), wood);
  handle.position.y = L / 2;
  handle.castShadow = true;
  root.add(handle);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), wood);
  knob.scale.set(1, 0.7, 1.1);
  root.add(knob);
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.0245, 0.027, 0.17, 12), grip);
  wrap.position.y = 0.15;
  root.add(wrap);
  // кольца обмотки
  for (let i = 0; i < 4; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0255, 0.0035, 4, 12), grip);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08 + i * 0.042;
    root.add(ring);
  }

  const headY = L - 0.03;
  const profile = headProfile(spec);
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i][0], profile[i][1]);
  shape.closePath();
  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: spec.headDepth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2,
  });
  headGeo.rotateY(-Math.PI / 2);
  headGeo.translate(spec.headDepth / 2, 0, 0);
  const head = new THREE.Mesh(headGeo, steel);
  head.position.y = headY;
  head.castShadow = true;
  root.add(head);

  // полированная кромка вдоль лезвия
  const edgeH = spec.bladeH * (spec.shape === 'bardiche' ? 0.92 : 0.8);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(spec.headDepth * 0.5, edgeH, 0.012), polish);
  edge.position.set(0, headY - spec.bladeH * 0.04, -spec.bladeW * 0.995);
  edge.rotation.x = spec.shape === 'bardiche' ? 0.24 : 0.1;
  root.add(edge);

  // обух / шип
  if (spec.shape === 'tactical' || spec.id === 'fire') {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.11, 6), steel);
    spike.rotation.x = -Math.PI / 2;
    spike.position.set(0, headY + 0.02, 0.1);
    root.add(spike);
  }
  if (spec.shape === 'rescue') {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.05, 0.1), steel);
    claw.position.set(0, headY + 0.03, 0.08);
    claw.rotation.x = 0.35;
    root.add(claw);
  }
  if (spec.shape === 'double') {
    // второе лезвие с обратной стороны
    const backGeo = headGeo.clone();
    backGeo.rotateY(Math.PI);
    const back = new THREE.Mesh(backGeo, steel);
    back.position.y = headY;
    back.castShadow = true;
    root.add(back);
    const backEdge = edge.clone();
    backEdge.position.z = spec.bladeW * 0.995;
    root.add(backEdge);
  }
  if (spec.shape === 'bardiche') {
    const langet = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), steel);
    langet.position.set(0, headY - 0.16, -0.02);
    root.add(langet);
  }
  if (spec.shape === 'maul') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 10), steel);
    band.position.y = headY + spec.bladeH * 0.5 + 0.02;
    root.add(band);
  }

  // кровь на лезвии
  const blood = new THREE.Mesh(
    new THREE.BoxGeometry(spec.headDepth * 1.4, spec.bladeH * 0.62, spec.bladeW * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x5a0410, roughness: 0.3, transparent: true, opacity: 0, depthWrite: false }),
  );
  blood.position.set(0, headY - spec.bladeH * 0.06, -spec.bladeW * 0.62);
  root.add(blood);

  return {
    root,
    blood,
    edge,
    headY,
    edgeZ: -spec.bladeW,
    edgeY0: headY - edgeH * 0.5,
    edgeY1: headY + edgeH * 0.5,
    tipY: headY + spec.bladeH * 0.5,
    tipZ: -spec.bladeW * 1.02,
  };
}
