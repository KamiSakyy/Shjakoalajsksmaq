import * as THREE from 'three';
import { createCharacter, type CharacterRig } from './characters';

/**
 * Мио Такамия — полноценная 3D-модель.
 *
 * Основа берётся из общего рига персонажа (пропорции, скан головы, пальцы,
 * сгибы), но вся одежда, кожа, волосы и глаза заменяются на клонированные
 * материалы: белое с золотом платье, бледная кожа, серебряные волосы до пояса,
 * светящиеся золотые глаза. Общие материалы NPC при этом не портятся —
 * клонируются только материалы этой модели.
 */

export interface MioModel extends CharacterRig {
  /** Ленты за спиной. */
  ribbons: THREE.Object3D[];
  /** Пряди волос для анимации. */
  hairStrands: THREE.Object3D[];
  /** Слои юбки. */
  skirt: THREE.Object3D[];
  /** Крылья света, уже привязанные к спине. */
  wings: THREE.Object3D[];
  halo: THREE.Object3D;
  /** Золотые глаза (светятся). */
  eyes: THREE.Mesh[];
  /** Всё, что нужно прятать в виде от первого лица. */
  bodyOnly: THREE.Object3D[];
  update(state: { dt: number; time: number; speed: number; flying: boolean; vy: number }): void;
}

const DRESS = 0xf7f2e7;
const DRESS_DARK = 0xe8dfcd;
const GOLD = 0xe7c37a;
const SKIN = 0xf2e0d1;
const HAIR = 0xe2e7f0;

const SHIRT_COLORS = new Set([0x555e52, 0x8c7c68, 0x4b5c68, 0x77655b, 0x3d4141, 0x303f4d]);
const PANTS_COLORS = new Set([0x35424b, 0x4a4841, 0x393f42, 0x25313e]);
const LEATHER_COLORS = new Set([0x242526, 0x353333]);
const HAIR_COLORS = new Set([0x312b25, 0x483a2c, 0x595147]);
const SKIN_COLORS = new Set([0xc7a183, 0xaa7f60, 0xb8886b, 0xc4c2ae]);

/** Ткань платья: мягкие вертикальные складки как bump-карта. */
function foldTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x++) {
    const v = 128 + Math.sin(x * 0.55) * 26 + Math.sin(x * 0.19 + 1.7) * 16 + (Math.random() - 0.5) * 6;
    ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
    ctx.fillRect(x, 0, 1, 128);
  }
  for (let i = 0; i < 40; i++) {
    const y = Math.random() * 128;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, y, 128, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

let FOLDS: THREE.Texture | null = null;
const folds = () => (FOLDS ??= foldTexture());

function gold() {
  return new THREE.MeshStandardMaterial({
    color: GOLD, roughness: 0.28, metalness: 0.95, envMapIntensity: 1.1,
    emissive: 0x6a4c14, emissiveIntensity: 0.35,
  });
}

function white(cloth = true) {
  return new THREE.MeshStandardMaterial({
    color: DRESS, roughness: cloth ? 0.72 : 0.4, metalness: cloth ? 0.04 : 0.2,
    emissive: 0xfff2d8, emissiveIntensity: 0.06, side: THREE.DoubleSide,
    bumpMap: cloth ? folds() : null, bumpScale: cloth ? 0.006 : 0,
  });
}

function silverHair() {
  return new THREE.MeshStandardMaterial({
    color: HAIR, roughness: 0.36, metalness: 0.14,
    emissive: 0x39405a, emissiveIntensity: 0.28,
  });
}

function paleSkin() {
  return new THREE.MeshStandardMaterial({
    color: SKIN, roughness: 0.52, metalness: 0.02,
    emissive: 0x3a2418, emissiveIntensity: 0.08,
  });
}

/** Переназначаем материалы тела под Мио, клонируя их (чтобы не менять NPC). */
function restyle(rig: CharacterRig) {
  const cache = new Map<THREE.Material, THREE.Material>();
  const pick = (src: THREE.Material): THREE.Material => {
    if (cache.has(src)) return cache.get(src)!;
    const std = src as THREE.MeshStandardMaterial;
    const hex = std.color?.getHex() ?? 0;
    let next: THREE.Material = src;
    if (SHIRT_COLORS.has(hex)) next = white(true);
    else if (PANTS_COLORS.has(hex)) next = white(true);
    else if (LEATHER_COLORS.has(hex)) next = white(false);
    else if (HAIR_COLORS.has(hex)) next = silverHair();
    else if (SKIN_COLORS.has(hex)) next = paleSkin();
    else if (hex === 0x85847c || hex === 0x5b5b51) next = gold();
    cache.set(src, next);
    return next;
  };
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.material) return;
    if (Array.isArray(m.material)) m.material = m.material.map(pick);
    else m.material = pick(m.material);
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

export function createMioModel(): MioModel {
  // seed 1 — одна из готовых вариаций лица, дальше всё перекрашиваем
  const rig = createCharacter('human', 'normal', 1);
  restyle(rig);

  const bodyOnly: THREE.Object3D[] = [];
  const hairStrands: THREE.Object3D[] = [];
  const skirt: THREE.Object3D[] = [];
  const eyes: THREE.Mesh[] = [];

  // ---------- волосы: длинные пряди до пояса ----------
  const hairMat = silverHair();
  const hairGroup = new THREE.Group();
  hairGroup.position.set(0, 0.2, -0.02);
  rig.head.add(hairGroup);
  bodyOnly.push(hairGroup);

  const strandGeo = new THREE.CapsuleGeometry(1, 1, 4, 8);
  const strand = (r: number, len: number, x: number, y: number, z: number, rx: number, rz: number, mat = hairMat) => {
    const m = new THREE.Mesh(strandGeo, mat);
    // капсула высотой 3 единицы: делим, чтобы получить прядь ровно нужной длины
    m.scale.set(r, len / 3, r * 0.72);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    return m;
  };

  // шапка волос поверх прежней причёски
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
  cap.scale.set(0.104, 0.112, 0.112);
  cap.position.set(0, 0.212, -0.008);
  cap.castShadow = true;
  rig.head.add(cap);
  bodyOnly.push(cap);

  // чёлка и пряди у лица
  for (let i = 0; i < 6; i++) {
    const a = -0.5 + i * 0.2;
    const lock = strand(0.026, 0.16, Math.sin(a) * 0.085, 0.09, 0.062 + Math.cos(a) * 0.026, 0.18, a * 0.5);
    hairGroup.add(lock);
    hairStrands.push(lock);
  }
  // длинные пряди по спине
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const x = -0.1 + t * 0.2;
    const len = 0.34 + (1 - Math.abs(t - 0.5) * 1.4) * 0.2;
    const lock = strand(0.031 - Math.abs(t - 0.5) * 0.01, len, x, -0.16 - len * 0.5, -0.055 - Math.abs(t - 0.5) * 0.03, 0.06 + Math.abs(t - 0.5) * 0.1, (t - 0.5) * 0.5);
    hairGroup.add(lock);
    hairStrands.push(lock);
  }
  // два локона перед плечами
  for (const sx of [-1, 1]) {
    const lock = strand(0.03, 0.42, sx * 0.105, -0.18, 0.03, 0.04, sx * 0.16);
    hairGroup.add(lock);
    hairStrands.push(lock);
  }

  // ---------- платье ----------
  const dressMat = white(true);
  const dressDark = new THREE.MeshStandardMaterial({ color: DRESS_DARK, roughness: 0.66, metalness: 0.05, side: THREE.DoubleSide });
  const trimMat = gold();

  // корсет поверх торса
  const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.155, 0.4, 18, 1, true), dressMat);
  bodice.scale.set(1, 1, 0.78);
  bodice.position.set(0, 0.3, 0);
  bodice.castShadow = true;
  rig.torso.add(bodice);
  bodyOnly.push(bodice);

  // золотая окантовка корсета и талии
  for (const [y, r] of [[0.47, 0.198], [0.11, 0.19]] as [number, number][]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 6, 26), trimMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.8;
    ring.position.y = y;
    rig.torso.add(ring);
    bodyOnly.push(ring);
  }
  // золотой нагрудный знак — сефира
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), trimMat);
  emblem.position.set(0, 0.35, 0.135);
  rig.torso.add(emblem);
  bodyOnly.push(emblem);
  const emblemRing = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.005, 6, 20), trimMat);
  emblemRing.position.set(0, 0.35, 0.132);
  rig.torso.add(emblemRing);
  bodyOnly.push(emblemRing);

  // юбка: три слоя, каждый следующий шире и ниже
  const layers: [number, number, number, number][] = [
    // верхний радиус, нижний радиус, высота, смещение вниз
    [0.19, 0.39, 0.34, -0.12],
    [0.21, 0.48, 0.26, -0.22],
    [0.23, 0.56, 0.18, -0.31],
  ];
  for (const [top, bot, h, y] of layers) {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(top, bot, h, 22, 1, true), dressMat);
    cone.scale.z = 0.82;
    cone.position.y = y;
    cone.castShadow = true;
    rig.hips.add(cone);
    bodyOnly.push(cone);
    skirt.push(cone);
  }
  // золотой подол
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.01, 6, 34), trimMat);
  hem.rotation.x = Math.PI / 2;
  hem.scale.z = 0.82;
  hem.position.y = -0.352;
  rig.hips.add(hem);
  bodyOnly.push(hem);

  // пояс с золотой пряжкой
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.052, 18, 1, true), trimMat);
  belt.scale.z = 0.8;
  belt.position.y = 0.02;
  rig.hips.add(belt);
  bodyOnly.push(belt);

  // высокие сапоги: голенища белые с золотом
  for (const shin of [rig.parts.shinL, rig.parts.shinR]) {
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.062, 0.3, 14, 1, true), dressDark);
    boot.position.set(0, -0.2, 0);
    boot.castShadow = true;
    shin.add(boot);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.007, 6, 20), trimMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.07;
    shin.add(band);
  }

  // наручи и золотые браслеты
  for (const fore of [rig.parts.foreL, rig.parts.foreR]) {
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.043, 0.16, 12, 1, true), dressMat);
    cuff.position.y = -0.12;
    fore.add(cuff);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.007, 6, 18), trimMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.045;
    fore.add(band);
  }

  // ---------- ленты за спиной ----------
  const ribbons: THREE.Object3D[] = [];
  const ribbonTex = (() => {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,247,229,0.9)');
    g.addColorStop(0.75, 'rgba(255,224,160,0.75)');
    g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  for (const sx of [-1, 1]) {
    const ribbon = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.95, 1, 4),
      new THREE.MeshBasicMaterial({ map: ribbonTex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    ribbon.position.set(sx * 0.12, 0.05, -0.12);
    ribbon.rotation.set(0.2, sx * 0.25, sx * 0.1);
    rig.hips.add(ribbon);
    ribbons.push(ribbon);
    bodyOnly.push(ribbon);
  }

  // ---------- глаза ----------
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffd27a, emissive: 0xffb43c, emissiveIntensity: 2.4, roughness: 0.2, metalness: 0.4,
  });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), eyeMat);
    eye.scale.set(0.0085, 0.0051, 0.0042);
    eye.position.set(sx * 0.026, 0.177, 0.1045);
    rig.head.add(eye);
    eyes.push(eye);
    bodyOnly.push(eye);
  }

  // ---------- нимб ----------
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffe2a0, transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.0075, 6, 40), haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, 0.36, -0.02);
  rig.head.add(halo);
  bodyOnly.push(halo);

  // ---------- крылья света ----------
  const wingCanvas = document.createElement('canvas');
  wingCanvas.width = 128; wingCanvas.height = 256;
  const wc = wingCanvas.getContext('2d')!;
  const wg = wc.createLinearGradient(0, 0, 128, 0);
  wg.addColorStop(0, 'rgba(255,244,214,0.95)');
  wg.addColorStop(0.45, 'rgba(255,208,124,0.5)');
  wg.addColorStop(1, 'rgba(255,168,58,0)');
  wc.fillStyle = wg;
  wc.beginPath();
  wc.moveTo(6, 6);
  wc.quadraticCurveTo(122, 66, 110, 148);
  wc.quadraticCurveTo(68, 240, 8, 250);
  wc.quadraticCurveTo(32, 128, 6, 6);
  wc.fill();
  wc.strokeStyle = 'rgba(255,255,255,0.5)';
  wc.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) {
    const y = 22 + i * 26;
    wc.beginPath(); wc.moveTo(12, y); wc.lineTo(94 - i * 3, y + 30); wc.stroke();
  }
  const wingTex = new THREE.CanvasTexture(wingCanvas);
  wingTex.colorSpace = THREE.SRGBColorSpace;
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const mat = new THREE.MeshBasicMaterial({
      map: wingTex, transparent: true, opacity: 0.85, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.9), mat);
    w.position.set(sx * 0.24, 0.32, -0.14);
    w.rotation.set(0.1, sx * 0.6, sx * -0.2);
    rig.torso.add(w);
    wings.push(w);
    bodyOnly.push(w);
  }

  // ---------- анимация ----------
  let phase = 0;
  let lean = 0;
  let sway = 0;

  const update = ({ dt, time, speed, flying, vy }: { dt: number; time: number; speed: number; flying: boolean; vy: number }) => {
    phase += dt * (2.2 + speed * 1.5);
    sway += dt * (1.4 + speed * 0.35);
    lean += ((flying ? Math.min(0.55, speed * 0.03) : 0) - lean) * Math.min(1, dt * 3);

    const walk = Math.min(1, speed / 3.2);
    const swing = Math.sin(phase) * (flying ? 0.08 : 0.52 * walk);

    rig.parts.thighL.rotation.x = flying ? -0.26 + Math.sin(time * 1.7) * 0.04 : swing;
    rig.parts.thighR.rotation.x = flying ? -0.18 - Math.sin(time * 1.7) * 0.04 : -swing;
    rig.parts.shinL.rotation.x = flying ? 0.34 : Math.max(0, -swing) * 0.9;
    rig.parts.shinR.rotation.x = flying ? 0.28 : Math.max(0, swing) * 0.9;
    rig.parts.armL.rotation.x = flying ? -0.5 - Math.sin(time * 2.1) * 0.05 : -swing * 0.7;
    rig.parts.armR.rotation.x = flying ? -0.42 + Math.sin(time * 2.1) * 0.05 : swing * 0.7;
    rig.parts.armL.rotation.z = 0.045 + (flying ? 0.36 : 0);
    rig.parts.armR.rotation.z = -0.045 - (flying ? 0.36 : 0);
    rig.parts.foreL.rotation.x = flying ? -0.28 : -0.08 - Math.abs(swing) * 0.2;
    rig.parts.foreR.rotation.x = flying ? -0.3 : -0.08 - Math.abs(swing) * 0.2;

    // корпус: наклон вперёд в полёте, лёгкое покачивание в шаге
    rig.torso.rotation.x = lean + (flying ? 0 - vy * 0.004 : Math.sin(phase * 2) * 0.012 * walk);
    rig.torso.rotation.z = Math.sin(sway * 0.8) * (flying ? 0.05 : 0.02 * walk);
    rig.head.rotation.x = flying ? 0.12 : Math.sin(phase * 2) * 0.01;
    rig.head.rotation.z = Math.sin(sway * 0.6) * 0.03;

    // волосы и юбка отстают и развеваются
    hairStrands.forEach((h, i) => {
      const k = i / hairStrands.length;
      h.rotation.x = 0.06 + Math.sin(sway * 1.3 + i * 0.6) * (flying ? 0.2 : 0.05) + k * 0.02 + lean * 0.4;
      h.rotation.z = Math.sin(sway * 0.9 + i) * (flying ? 0.14 : 0.04);
    });
    ribbons.forEach((r, i) => {
      const sx = i === 0 ? -1 : 1;
      r.rotation.x = 0.2 + lean * 1.2 + Math.sin(sway * 1.5 + i) * (flying ? 0.22 : 0.06);
      r.rotation.z = sx * (0.1 + Math.sin(sway * 1.1 + i * 2) * (flying ? 0.1 : 0.03));
    });
    skirt.forEach((s, i) => {
      const k = i / skirt.length;
      s.rotation.z = Math.sin(sway * 1.1 + i) * (flying ? 0.1 : 0.03);
      s.rotation.x = lean * (0.6 + k) + Math.sin(sway * 0.7 + i) * 0.02;
    });
    wings.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      w.rotation.z = side * (-0.2 + Math.sin(time * (flying ? 6 : 2)) * (flying ? 0.22 : 0.07));
      w.rotation.y = side * (0.6 + (flying ? 0.22 : 0.06));
      ((w as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.55 + (flying ? 0.35 : 0.14);
    });
    halo.rotation.z = time * 0.8;
    for (const e of eyes) (e.material as THREE.MeshStandardMaterial).emissiveIntensity = 2 + Math.sin(time * 3) * 0.6;
  };

  rig.root.visible = false;
  return { ...rig, ribbons, hairStrands, skirt, wings, halo, eyes, bodyOnly, update };
}
