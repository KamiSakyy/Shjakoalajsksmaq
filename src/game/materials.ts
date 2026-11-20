import * as THREE from 'three';
import type { Material } from './audio';
import { worldRng } from './worldgen';
/** Детерминированный поток «materials»: мир одинаков у всех и при каждом запуске. */
const rnd = worldRng('materials');

// Параметры сопротивления материалов — ядро реализма топора
export interface MatProps {
  resistance: number; // Дж на полную глубину лезвия
  penetration: number; // множитель проникновения
  stuckChance: number; // базовый шанс застрять при глубоком ударе
  bounce: number; // доля скорости, отражаемой при рикошете
  dull: number; // износ лезвия за удар
  hitstop: number; // «заморозка» на контакте, сек (ощущение тяжести)
  pullResist: number; // сколько рывков нужно, чтобы вытащить
}

export const MATERIALS: Record<Material, MatProps> = {
  flesh: { resistance: 55, penetration: 1.0, stuckChance: 0.22, bounce: 0.0, dull: 0.004, hitstop: 0.05, pullResist: 1.6 },
  bone: { resistance: 160, penetration: 0.55, stuckChance: 0.5, bounce: 0.35, dull: 0.02, hitstop: 0.09, pullResist: 2.6 },
  wood: { resistance: 210, penetration: 0.6, stuckChance: 0.75, bounce: 0.12, dull: 0.012, hitstop: 0.11, pullResist: 3.4 },
  stone: { resistance: 1e9, penetration: 0, stuckChance: 0, bounce: 0.55, dull: 0.09, hitstop: 0.03, pullResist: 0 },
  blunt: { resistance: 1e9, penetration: 0, stuckChance: 0, bounce: 0.25, dull: 0, hitstop: 0.03, pullResist: 0 },
};

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, s: number, base: [number, number, number], amp: number, count: number, rMin = 1, rMax = 3) {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < count; i++) {
    const v = (rnd() - 0.5) * amp;
    ctx.fillStyle = `rgb(${base[0] + v | 0},${base[1] + v | 0},${base[2] + v | 0})`;
    const r = rMin + rnd() * (rMax - rMin);
    ctx.beginPath();
    ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function makeTextures() {
  const ground = canvasTex(512, (ctx, s) => {
    noiseFill(ctx, s, [38, 34, 26], 40, 9000, 1, 5);
    // травинки / мусор
    for (let i = 0; i < 1500; i++) {
      ctx.strokeStyle = `rgba(${40 + rnd() * 30 | 0},${50 + rnd() * 40 | 0},${20 + rnd() * 20 | 0},0.7)`;
      ctx.lineWidth = 1;
      const x = rnd() * s, y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 8, y - rnd() * 8);
      ctx.stroke();
    }
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(20,16,12,${0.3 + rnd() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * s, rnd() * s, 3 + rnd() * 12, 2 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 40);

  const bark = canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, [58, 44, 32], 36, 3000, 1, 3);
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = `rgba(${20 + rnd() * 20 | 0},${14 + rnd() * 14 | 0},10,${0.4 + rnd() * 0.5})`;
      ctx.lineWidth = 1 + rnd() * 3;
      const x = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + (rnd() - 0.5) * 30, s * 0.3, x + (rnd() - 0.5) * 30, s * 0.7, x + (rnd() - 0.5) * 20, s);
      ctx.stroke();
    }
  }, 1);
  bark.repeat.set(2, 4);

  const metal = canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, [120, 122, 126], 30, 2500, 1, 2);
    // следы ковки / проката
    for (let i = 0; i < 400; i++) {
      ctx.strokeStyle = `rgba(${80 + rnd() * 100 | 0},${80 + rnd() * 100 | 0},${85 + rnd() * 100 | 0},0.35)`;
      ctx.lineWidth = 1;
      const y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (rnd() - 0.5) * 6);
      ctx.stroke();
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(60,45,35,${0.2 + rnd() * 0.4})`;
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, 2 + rnd() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 1);

  const handleWood = canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, [128, 96, 60], 30, 2500, 1, 2);
    for (let i = 0; i < 120; i++) {
      ctx.strokeStyle = `rgba(${70 + rnd() * 40 | 0},${45 + rnd() * 30 | 0},25,${0.3 + rnd() * 0.4})`;
      ctx.lineWidth = 1 + rnd();
      const x = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (rnd() - 0.5) * 10, s);
      ctx.stroke();
    }
  }, 1);
  handleWood.repeat.set(1, 3);

  const skin = canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, [112, 122, 96], 40, 4000, 1, 3);
    // вены, пятна гниения
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${60 + rnd() * 40 | 0},${30 + rnd() * 30 | 0},${30 + rnd() * 20 | 0},${0.25 + rnd() * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * s, rnd() * s, 5 + rnd() * 20, 4 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 50; i++) {
      ctx.strokeStyle = `rgba(50,40,70,${0.2 + rnd() * 0.3})`;
      ctx.lineWidth = 1;
      const x = rnd() * s, y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 10, y + 15, x - 10, y + 25, x + 5, y + 40);
      ctx.stroke();
    }
  }, 1);

  const cloth = canvasTex(128, (ctx, s) => {
    noiseFill(ctx, s, [52, 48, 50], 30, 1500, 1, 2);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(${50 + rnd() * 20 | 0},${10 + rnd() * 10 | 0},10,${0.3 + rnd() * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * s, rnd() * s, 4 + rnd() * 12, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 1);

  const stone = canvasTex(256, (ctx, s) => {
    noiseFill(ctx, s, [92, 92, 90], 50, 5000, 1, 4);
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = `rgba(30,30,30,${0.3 + rnd() * 0.4})`;
      ctx.lineWidth = 1 + rnd() * 2;
      const x = rnd() * s, y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60);
      ctx.stroke();
    }
  }, 1);

  return { ground, bark, metal, handleWood, skin, cloth, stone };
}

export type Textures = ReturnType<typeof makeTextures>;
