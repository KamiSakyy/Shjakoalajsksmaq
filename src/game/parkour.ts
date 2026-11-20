import * as THREE from 'three';
import type { Box3 } from './city';

/**
 * Parkour — свободное движение в духе Dying Light 2.
 *
 * Умеет:
 *  · прыжок и приземление с перекатом (гасит урон от падения);
 *  · вольт через забор/парапет (низкое препятствие);
 *  · подъём на уступ (средняя высота) с подтягиванием;
 *  · залезание по стене до крыши, пока хватает выносливости;
 *  · бег по стене (wall-run) с потерей высоты;
 *  · скольжение под низкими препятствиями;
 *  · стояние на крышах: земля считается по верху коробок города.
 *
 * Система не двигает игрока напрямую — она возвращает намерение
 * (Vault/Mantle/Climb), а Game применяет его к позиции и скорости.
 */

export type ParkourState = 'none' | 'vault' | 'mantle' | 'climb' | 'wallrun' | 'slide' | 'hang';

export interface ParkourWorld {
  boxesNear(x: number, z: number): Box3[];
  surfaceAt(x: number, z: number): number;
}

export interface ParkourInput {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  velY: number;
  feetY: number;
  onGround: boolean;
  crouch: boolean;
  sprint: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  forward: number;
  stamina: number;
}

export interface ParkourOutput {
  /** Итоговая позиция (может быть подправлена системой). */
  pos: THREE.Vector3;
  /** Вертикальная скорость. */
  velY: number;
  /** Считаемся ли на земле. */
  onGround: boolean;
  /** Высота «пола» под игроком. */
  groundY: number;
  /** Забрать выносливость (сколько). */
  staminaCost: number;
  /** Крен камеры, рад. */
  roll: number;
  /** Импульс FOV. */
  fov: number;
  /** Скорость удара о землю (для урона и пыли). */
  landImpact: number;
  /** События для звука/лога. */
  event: 'jump' | 'vault' | 'mantle' | 'grab' | 'land' | 'roll' | 'slide' | null;
  state: ParkourState;
}

const GRAVITY = 21;
const _v = new THREE.Vector3();

export class Parkour {
  state: ParkourState = 'none';
  private timer = 0;
  private duration = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private cooldown = 0;
  private rollTimer = 0;
  roll = 0;
  fov = 0;
  /** Сколько секунд подряд висим/лезем. */
  climbTime = 0;

  /** Верх всех коробок под точкой — земля крыш. */
  groundY(x: number, z: number, feetY: number, r = 0.3, world?: ParkourWorld): number {
    let best = world ? world.surfaceAt(x, z) : 0;
    if (!world) return best;
    for (const b of world.boxesNear(x, z)) {
      if (b.max.y > feetY + 0.34) continue;           // выше ног — это стена, не пол
      if (b.max.y <= best) continue;
      if (x < b.min.x - r || x > b.max.x + r || z < b.min.z - r || z > b.max.z + r) continue;
      best = b.max.y;
    }
    return best;
  }

  /** Ближайшая стена перед игроком (по направлению взгляда). */
  private wallAhead(inp: ParkourInput, world: ParkourWorld) {
    const reach = 1.05;
    const dirX = -Math.sin(inp.yaw), dirZ = -Math.cos(inp.yaw);
    const px = inp.pos.x + dirX * reach;
    const pz = inp.pos.z + dirZ * reach;
    let best: { box: Box3; top: number; dist: number } | null = null;
    for (const b of world.boxesNear(px, pz)) {
      // расстояние от точки «впереди» до пятна застройки — без граничных сюрпризов
      const dx = Math.max(b.min.x - px, 0, px - b.max.x);
      const dz = Math.max(b.min.z - pz, 0, pz - b.max.z);
      if (dx * dx + dz * dz > 0.5 * 0.5) continue;
      const top = b.max.y;
      if (top - inp.feetY < 0.2) continue;
      const cx = Math.max(b.min.x, Math.min(inp.pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(inp.pos.z, b.max.z));
      const d = Math.hypot(inp.pos.x - cx, inp.pos.z - cz);
      if (!best || d < best.dist) best = { box: b, top, dist: d };
    }
    return best;
  }

  /** Точка на верху препятствия, куда встать после вольта/подъёма. */
  private landingOn(box: Box3, inp: ParkourInput) {
    const dirX = -Math.sin(inp.yaw), dirZ = -Math.cos(inp.yaw);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    // тянем точку внутрь препятствия от игрока
    let x = inp.pos.x + dirX * 0.55;
    let z = inp.pos.z + dirZ * 0.55;
    x = THREE.MathUtils.clamp(x, box.min.x + 0.35, box.max.x - 0.35);
    z = THREE.MathUtils.clamp(z, box.min.z + 0.35, box.max.z - 0.35);
    if (Math.abs(x - cx) < 0.05 && Math.abs(z - cz) < 0.05) { x += dirX * 0.3; z += dirZ * 0.3; }
    const y = box.max.y + 0.02;
    return _v.set(x, y, z) as THREE.Vector3;
  }

  update(dt: number, inp: ParkourInput, world: ParkourWorld): ParkourOutput {
    const out: ParkourOutput = {
      pos: inp.pos, velY: inp.velY, onGround: inp.onGround,
      groundY: this.groundY(inp.pos.x, inp.pos.z, inp.feetY, 0.3, world),
      staminaCost: 0, roll: this.roll, fov: this.fov, landImpact: 0, event: null, state: this.state,
    };
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.rollTimer = Math.max(0, this.rollTimer - dt);
    this.roll *= Math.exp(-dt * 6);
    this.fov *= Math.exp(-dt * 5);

    // ── активные состояния ────────────────────────────────────────────
    if (this.state === 'vault' || this.state === 'mantle') {
      this.timer += dt;
      const k = Math.min(1, this.timer / this.duration);
      // дуга: сначала вверх, потом вперёд
      const ease = 1 - Math.pow(1 - k, 3);
      inp.pos.x = THREE.MathUtils.lerp(this.from.x, this.to.x, ease);
      inp.pos.z = THREE.MathUtils.lerp(this.from.z, this.to.z, ease);
      const lift = this.state === 'vault' ? Math.sin(k * Math.PI) * 0.32 : Math.sin(k * Math.PI * 0.9) * 0.16;
      inp.pos.y = THREE.MathUtils.lerp(this.from.y, this.to.y, ease) + lift;
      out.velY = 0;
      out.onGround = false;
      out.roll = this.state === 'vault' ? 0.06 * Math.sin(k * Math.PI) : -0.09 * Math.sin(k * Math.PI);
      this.roll = out.roll;
      out.fov = this.state === 'vault' ? 3 : 2;
      if (k >= 1) {
        this.state = 'none';
        out.onGround = true;
        out.velY = 0;
        out.event = 'land';
        out.pos.y = this.to.y;
        this.cooldown = 0.18;
      }
      out.state = this.state;
      out.groundY = this.to.y;
      return out;
    }

    if (this.state === 'climb') {
      // лезем по стене, пока держим прыжок/вперёд и есть выносливость
      const wall = this.wallAhead(inp, world);
      const holding = inp.jumpHeld || inp.forward > 0.3;
      if (!wall || !holding || inp.stamina < 4) {
        if (!wall) { this.state = 'none'; }
        else if (!holding) this.state = 'none';
        out.state = this.state;
        return out;
      }
      this.climbTime += dt;
      const speed = 3.35;
      inp.pos.y += speed * dt;
      // прижимаемся к стене
      const cx = Math.max(wall.box.min.x, Math.min(inp.pos.x, wall.box.max.x));
      const cz = Math.max(wall.box.min.z, Math.min(inp.pos.z, wall.box.max.z));
      inp.pos.x += (cx - inp.pos.x) * Math.min(1, dt * 5);
      inp.pos.z += (cz - inp.pos.z) * Math.min(1, dt * 5);
      out.staminaCost = 11 * dt;
      out.velY = 0;
      out.onGround = false;
      this.roll = Math.sin(this.climbTime * 9) * 0.02;
      out.roll = this.roll;
      out.fov = 4;
      if (inp.pos.y >= wall.top - 0.55) {
        // перелезаем наверх
        this.beginLedge(wall.top, inp, world, 'mantle', 0.42);
        out.event = 'mantle';
      } else if (this.climbTime > 9) {
        this.state = 'none';
      }
      out.state = this.state;
      out.groundY = wall.top;
      return out;
    }

    if (this.state === 'wallrun') {
      this.timer += dt;
      const wall = this.wallAhead(inp, world);
      inp.pos.y += (inp.velY * 0.25 - 3.4 * this.timer) * dt;
      if (!wall || this.timer > 0.85 || inp.stamina < 2) {
        this.state = 'none';
        out.velY = -1;
        return out;
      }
      out.staminaCost = 8 * dt;
      out.onGround = false;
      out.velY = inp.velY * 0.6;
      this.roll = -0.16;
      out.roll = this.roll;
      out.state = this.state;
      return out;
    }

    if (this.state === 'slide') {
      this.timer += dt;
      if (this.timer > 0.62 || !inp.crouch) {
        this.state = 'none';
        out.state = 'none';
        return out;
      }
      out.state = 'slide';
      out.roll = -0.02;
      return out;
    }

    // ── обычная физика ────────────────────────────────────────────────
    const ground = out.groundY;
    const wasAir = !inp.onGround;

    if (this.rollTimer > 0) {
      // перекат после жёсткого приземления
      this.rollTimer -= dt;
      inp.pos.y = Math.max(ground, inp.pos.y - 3.2 * dt);
      out.onGround = true;
      out.velY = 0;
      out.roll = -0.12;
      this.roll = out.roll;
      out.state = 'slide';
      out.state = this.state;
      return out;
    }

    if (!inp.onGround) {
      out.velY = inp.velY - GRAVITY * dt;
      inp.pos.y += out.velY * dt;
      if (inp.pos.y <= ground) {
        const impact = Math.abs(out.velY);
        inp.pos.y = ground;
        out.onGround = true;
        out.velY = 0;
        out.landImpact = impact;
        if (wasAir && impact > 3) {
          out.event = 'land';
          if (inp.crouch && impact > 7) {
            this.rollTimer = 0.42;
            out.event = 'roll';
          }
        }
      }
    } else {
      // на земле: подъём по ступенькам и удержание высоты
      if (inp.pos.y - ground < 0.45 && inp.pos.y >= ground - 0.6) inp.pos.y = ground;
      else if (inp.pos.y < ground) inp.pos.y = ground;
      out.velY = 0;
      // сход с крыши — падаем
      if (inp.pos.y - ground > 0.5) out.onGround = false;
    }

    // ── вход в паркур ─────────────────────────────────────────────────
    const wantForward = inp.forward > 0.35;
    const wall = (wantForward || inp.jumpPressed) ? this.wallAhead(inp, world) : null;

    if (wall && this.cooldown <= 0) {
      const climb = wall.top - inp.feetY;
      const moving = Math.hypot(inp.vel.x, inp.vel.z) > 1.6;

      if (inp.onGround && inp.jumpPressed && climb > 0.35 && climb < 1.15 && moving) {
        // вольт через забор, парапет, капот
        const target = this.landingOn(wall.box, inp);
        this.begin(inp.pos, target, 0.34, 'vault');
        out.event = 'vault';
        out.state = 'vault';
        return out;
      }
      if (inp.onGround && inp.jumpPressed && climb >= 1.15 && climb < 3.1) {
        // подъём на уступ
        const target = this.landingOn(wall.box, inp);
        this.begin(inp.pos, target, 0.55, 'mantle');
        out.event = 'mantle';
        out.state = 'mantle';
        return out;
      }
      // стена выше: залезаем, пока держим
      if ((!inp.onGround && inp.jumpHeld && climb > 2.4) || (inp.onGround && inp.jumpPressed && climb >= 3.1)) {
        this.state = 'climb';
        this.climbTime = 0;
        out.staminaCost = 4;
        out.event = 'grab';
        out.state = 'climb';
        return out;
      }
      // бег по стене во время прыжка
      if (!inp.onGround && inp.jumpHeld && moving && climb > 1.2) {
        this.state = 'wallrun';
        this.timer = 0;
        out.state = 'wallrun';
        return out;
      }
    }

    // скольжение: присед на бегу
    if (inp.onGround && inp.crouch && inp.sprint && Math.hypot(inp.vel.x, inp.vel.z) > 4.2 && this.cooldown <= 0) {
      this.state = 'slide';
      this.timer = 0;
      out.event = 'slide';
      out.state = 'slide';
      return out;
    }

    out.state = this.state;
    return out;
  }

  private begin(from: THREE.Vector3, to: THREE.Vector3, duration: number, state: ParkourState) {
    this.from.copy(from);
    this.to.copy(to);
    this.timer = 0;
    this.duration = duration;
    this.state = state;
    this.climbTime = 0;
  }

  private beginLedge(top: number, inp: ParkourInput, world: ParkourWorld, state: ParkourState, duration: number) {
    const wall = this.wallAhead(inp, world);
    const target = wall ? this.landingOn(wall.box, inp).clone() : new THREE.Vector3(inp.pos.x, top + 0.02, inp.pos.z);
    target.y = Math.max(top + 0.02, target.y);
    this.begin(inp.pos, target, duration, state);
  }

  cancel() {
    this.state = 'none';
    this.timer = 0;
    this.climbTime = 0;
  }

  get active() { return this.state !== 'none'; }
}
