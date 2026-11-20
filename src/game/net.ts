import * as THREE from 'three';
import { createCharacter, type CharacterRig } from './characters';
import { WORLD_SEED, worldSignature } from './worldgen';
import type { GameMode } from './modes';

/**
 * Подготовка к онлайну.
 *
 * Мир детерминирован (одно зерно — один и тот же город у всех), поэтому по сети
 * нужно гонять только изменяемое состояние: время, погоду, режим, розыск и
 * игроков. Снимок (snapshot) — плоский массив чисел: его дешево кодировать,
 * легко диффать и удобно гонять по WebSocket на 20–30 Гц.
 */

export const NET_TICK = 1 / 20;           // 20 снимков в секунду
export const NET_INTERP_DELAY = 0.12;     // клиент отстаёт на 120 мс и интерполирует

export interface NetActor {
  id: string;
  name: string;
  x: number; y: number; z: number;
  yaw: number;
  pitch: number;
  speed: number;
  hp: number;
  /** 0 — пешком, 1 — в машине, 2 — паркур, 3 — присел */
  flags: number;
}

export interface NetWorld {
  seed: number;
  signature: string;
  mode: GameMode;
  clock: number;      // часы игрового времени 0..24
  weather: number;    // 0 ясно … 1 ливень
  wanted: number;
  tick: number;
}

export interface NetSnapshot {
  world: NetWorld;
  actors: NetActor[];
}

/** Короткий код режима — чтобы не гонять строки. */
const MODE_CODE: Record<GameMode, number> = { peace: 0, normal: 1, zombie: 2 };
const CODE_MODE: GameMode[] = ['peace', 'normal', 'zombie'];

export function encodeSnapshot(s: NetSnapshot): string {
  const ticks = Math.round(s.world.clock * 120);
  const head = [
    s.world.tick, WORLD_SEED, MODE_CODE[s.world.mode], ticks,
    Math.round(s.world.weather * 100), s.world.wanted,
  ];
  const actors = s.actors.map(a => [
    a.id, Math.round(a.x * 50) / 50, Math.round(a.y * 50) / 50, Math.round(a.z * 50) / 50,
    Math.round(a.yaw * 100) / 100, Math.round(a.pitch * 100) / 100,
    Math.round(a.speed * 10) / 10, Math.round(a.hp), a.flags, a.name,
  ]);
  return JSON.stringify({ h: head, a: actors });
}

export function decodeSnapshot(raw: string): NetSnapshot | null {
  try {
    const data = JSON.parse(raw) as { h: number[]; a: (number | string)[][] };
    if (!Array.isArray(data?.h)) return null;
    const [tick, seed, mode, ticks, weather, wanted] = data.h;
    const world: NetWorld = {
      seed, signature: worldSignature({ seed }), mode: CODE_MODE[mode] ?? 'normal',
      clock: ticks / 120, weather: weather / 100, wanted, tick,
    };
    const actors: NetActor[] = (data.a ?? []).map((row) => ({
      id: String(row[0]), x: Number(row[1]), y: Number(row[2]), z: Number(row[3]),
      yaw: Number(row[4]), pitch: Number(row[5]), speed: Number(row[6]),
      hp: Number(row[7]), flags: Number(row[8]) | 0, name: String(row[9] ?? 'Игрок'),
    }));
    return { world, actors };
  } catch { return null; }
}

/**
 * Фиксированный тик: сервер и клиенты считают один и тот же номер кадра,
 * поэтому снимки не «плывут» при разном FPS.
 */
export class NetClock {
  tick = 0;
  private acc = 0;
  advance(dt: number): number {
    this.acc += Math.min(dt, 0.25);
    let steps = 0;
    while (this.acc >= NET_TICK && steps < 6) { this.acc -= NET_TICK; this.tick++; steps++; }
    return steps;
  }
}

interface RemoteState {
  actor: NetActor;
  prev: NetActor;
  next: NetActor;
  blend: number;
  rig: CharacterRig;
  label: THREE.Sprite | null;
}

/** Визуализация других игроков с интерполяцией и подписями. */
export class RemoteActors {
  group = new THREE.Group();
  private states = new Map<string, RemoteState>();

  constructor(private scene: THREE.Scene) { scene.add(this.group); }

  get count() { return this.states.size; }

  private makeLabel(name: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'rgba(6,10,16,0.55)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9f4ff';
    ctx.fillText(name.slice(0, 14), 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.38, 1);
    sprite.position.y = 2.1;
    return sprite;
  }

  private ensure(actor: NetActor): RemoteState {
    let st = this.states.get(actor.id);
    if (!st) {
      const rig = createCharacter('human', 'normal', actor.id.length * 37 + actor.name.length);
      this.group.add(rig.root);
      const label = this.makeLabel(actor.name);
      if (label) rig.root.add(label);
      st = { actor, prev: { ...actor }, next: { ...actor }, blend: 0, rig, label };
      this.states.set(actor.id, st);
    }
    return st;
  }

  /** Применить снимок: чужие позиции станут целью для интерполяции. */
  apply(snapshot: NetSnapshot, selfId = 'me') {
    const seen = new Set<string>();
    for (const actor of snapshot.actors) {
      if (actor.id === selfId) continue;
      seen.add(actor.id);
      const st = this.ensure(actor);
      st.prev = { ...st.next };
      st.next = { ...actor };
      st.blend = 0;
      st.actor = actor;
    }
    for (const [id, st] of this.states) {
      if (seen.has(id)) continue;
      this.group.remove(st.rig.root);
      this.states.delete(id);
    }
  }

  update(dt: number) {
    const k = Math.min(1, dt / NET_INTERP_DELAY);
    for (const st of this.states.values()) {
      st.blend = Math.min(1, st.blend + k);
      const a = st.prev, b = st.next, t = st.blend;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const z = a.z + (b.z - a.z) * t;
      const yaw = a.yaw + shortestAngle(a.yaw, b.yaw) * t;
      st.rig.root.position.set(x, y, z);
      st.rig.root.rotation.y = yaw;
      const moving = b.speed > 0.4;
      const phase = performance.now() * 0.001 * (moving ? 7 : 1.4);
      const swing = moving ? Math.sin(phase) * 0.5 : 0;
      st.rig.parts.thighL.rotation.x = swing;
      st.rig.parts.thighR.rotation.x = -swing;
      st.rig.parts.armL.rotation.x = -swing * 0.7;
      st.rig.parts.armR.rotation.x = swing * 0.7;
      st.rig.root.visible = (b.flags & 1) === 0 || b.speed > 0.2;
      if (st.label) st.label.visible = true;
    }
  }

  dispose() {
    for (const st of this.states.values()) this.group.remove(st.rig.root);
    this.states.clear();
    this.scene.remove(this.group);
  }
}

const shortestAngle = (from: number, to: number) => {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
