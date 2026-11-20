import * as THREE from 'three';
import { createCharacter, type CharacterRig } from './characters';
import type { Car } from './vehicle';
import type { Traffic } from './vehicle';

export interface Officer {
  root: THREE.Group;
  rig: CharacterRig;
  pos: THREE.Vector3;
  yaw: number;
  hp: number;
  state: 'patrol' | 'chase' | 'shoot' | 'dead';
  shootCd: number;
  fireT: number;
  vel: THREE.Vector3;
  phase: number;
  deadT: number;
  patrolTarget: THREE.Vector3;
  /** Точность растёт, пока офицер держит игрока на прицеле. */
  aimT: number;
  /** Очередь: сколько выстрелов осталось и пауза между ними. */
  burst: number;
  burstT: number;
  /** Последняя известная позиция игрока — для поиска после потери. */
  lastKnown: THREE.Vector3;
  patrolTimer: number;
  side: 1 | -1;
}

/**
 * Патрульная машина — это настоящая машина из Traffic: её можно подбить,
 * взорвать, в неё можно сесть и уехать (и получить розыск).
 */
export interface PoliceCar {
  car: Car;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  lights: THREE.Mesh[];
  sirenT: number;
  hp: number;
  dead: boolean;
  smoke: number;
  stuck: number;
}

/**
 * Система розыска: преступления повышают уровень, полиция приезжает,
 * сирены, погоня, стрельба. Уровень падает, если спрятаться.
 */
export class Police {
  wanted = 0;
  stars = 0;
  heat = 0;          // время до потери розыска
  cars: PoliceCar[] = [];
  officers: Officer[] = [];
  siren = true;
  /** Мирный режим: полиция не замечает преступлений и не преследует. */
  hostile = true;
  sirenPhase = 0;
  private blocked: (x: number, z: number) => boolean = () => false;
  onFall?: (o: Officer, dir: THREE.Vector3) => void;
  onRemove?: (o: Officer) => void;
  onEnterStolen?: (car: Car) => void;

  constructor(public scene: THREE.Scene, private traffic?: Traffic) {}

  crime(amount: number) {
    if (!this.hostile) { this.wanted = 0; this.stars = 0; this.heat = 0; return; }
    this.wanted = Math.min(5, this.wanted + amount);
    this.heat = 22 + this.wanted * 12;
    this.stars = Math.min(5, Math.ceil(this.wanted));
  }

  calm(amount: number) {
    this.wanted = Math.max(0, this.wanted - amount);
    this.stars = Math.min(5, Math.ceil(this.wanted));
    if (this.wanted === 0) this.heat = 0;
  }

  get active() { return this.wanted > 0; }

  populatePatrol(origin: THREE.Vector3, blocked: (x: number, z: number) => boolean) {
    this.blocked = blocked;
    for (let i = this.officers.length; i < 2; i++) this.spawnOfficer(origin);
  }

  /** Взорванная/сгоревшая патрульная машина выбывает из погони. */
  onCarDestroyed(car: Car) {
    const pc = this.cars.find(c => c.car === car);
    if (pc) { pc.dead = true; pc.smoke = 0; }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    blocked: (x: number, z: number) => boolean,
    onShoot: (from: THREE.Vector3, dir: THREE.Vector3) => void,
    wet = 0,
  ) {
    this.blocked = blocked;
    if (!this.hostile) {
      // мирный режим: патрульные просто гуляют, розыска нет
      this.wanted = 0; this.stars = 0; this.heat = 0;
      for (const o of this.officers) {
        if (o.state !== 'dead') o.state = 'patrol';
      }
      this.sirenPhase += dt * 2;
      return;
    }
    // накопление / сброс
    if (this.wanted > 0) {
      this.heat -= dt;
      const near = this.cars.length ? Math.min(...this.cars.map((c) => c.pos.distanceTo(playerPos))) : 999;
      const seen = near < 45;
      if (seen) this.heat = 22 + this.wanted * 12;
      if (this.heat <= 0) {
        this.wanted = Math.max(0, this.wanted - 1);
        this.heat = this.wanted > 0 ? 22 + this.wanted * 12 : 0;
      }
    }
    this.stars = Math.min(5, Math.ceil(this.wanted));

    // спавн патруля
    const wantCars = Math.min(5, Math.ceil(this.wanted / 1.4));
    if (this.cars.filter((c) => !c.dead).length < wantCars && Math.random() < dt * 0.6) {
      this.spawnCar(playerPos);
    }
    const wantOfficers = Math.min(6, Math.max(2, Math.ceil(this.wanted) * 2));
    if (this.officers.filter((o) => o.state !== 'dead').length < wantOfficers && Math.random() < dt * 0.5) {
      this.spawnOfficer(playerPos);
    }

    // сирена
    this.sirenPhase += dt * 6;
    for (const c of this.cars) {
      if (c.dead) { c.smoke = Math.min(1, c.smoke + dt); continue; }
      const to = new THREE.Vector3().subVectors(playerPos, c.pos);
      to.y = 0;
      const d = to.length();
      to.normalize();
      const desired = Math.atan2(to.x, to.z);
      let dy = desired - c.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;

      const car = c.car;
      if (car.exploded || car.isPlayer) { c.dead = car.exploded; continue; }
      // настоящая физика: газ, руль, торможение; водитель видит игрока
      car.ai = false;
      const target = d > 16 ? 1 : d > 7 ? 0.35 : 0;
      car.throttle = target;
      car.brake = d < 9 ? 0.7 : 0;
      car.steerTarget = THREE.MathUtils.clamp(dy * 1.5, -1, 1);
      car.handbrake = Math.abs(dy) > 1.5 && Math.abs(car.vLong) > 12;
      const before = car.pos.clone();
      this.traffic?.stepCar(car, dt, () => {}, wet);
      // столкновение с городом: не даём проезжать сквозь дома
      if (blocked(car.pos.x, car.pos.z)) {
        car.pos.copy(before);
        car.vLong *= 0.35;
        c.stuck += dt;
      } else c.stuck = Math.max(0, c.stuck - dt);
      c.pos.copy(car.pos);
      c.yaw = car.yaw;
      c.speed = car.vLong;
      this.traffic?.syncVisuals(car, dt, 0, 0, car.steer * 0.52);

      // мигалки — материал, смонтированный на кузове
      const t = Math.sin(this.sirenPhase * 2.2) > 0;
      const m0 = c.lights[0]?.material as THREE.MeshStandardMaterial | undefined;
      const m1 = c.lights[1]?.material as THREE.MeshStandardMaterial | undefined;
      if (m0) { m0.emissiveIntensity = t ? 4 : 0.2; m0.color.setHex(t ? 0xff2222 : 0x660000); }
      if (m1) { m1.emissiveIntensity = t ? 0.2 : 4; m1.color.setHex(t ? 0x002266 : 0x2255ff); }
    }

    // офицеры
    for (const o of this.officers) {
      if (o.state === 'dead') { o.deadT += dt; if (!this.onFall) o.root.rotation.x = Math.min(Math.PI / 2, o.root.rotation.x + dt * 3); continue; }
      if (this.wanted <= 0) {
        o.state = 'patrol';
        o.aimT = 0; o.burst = 0; o.burstT = 0;
        o.patrolTimer -= dt;
        if (o.patrolTimer <= 0 || o.pos.distanceTo(o.patrolTarget) < 1) {
          o.patrolTimer = 8 + Math.random() * 6;
          for (let attempt = 0; attempt < 8; attempt++) {
            const direction = Math.floor(Math.random() * 4) * Math.PI / 2;
            o.patrolTarget.copy(o.pos).add(new THREE.Vector3(Math.sin(direction) * 16, 0, Math.cos(direction) * 16));
            if (!blocked(o.patrolTarget.x, o.patrolTarget.z)) break;
          }
        }
        const dir = o.patrolTarget.clone().sub(o.pos).setY(0).normalize();
        const yaw = Math.atan2(dir.x, dir.z);
        const turn = Math.atan2(Math.sin(yaw - o.yaw), Math.cos(yaw - o.yaw));
        o.yaw += THREE.MathUtils.clamp(turn, -dt * 1.5, dt * 1.5);
        const next = o.pos.clone().addScaledVector(dir, dt * 1.1);
        if (!blocked(next.x, next.z)) o.pos.copy(next);
        else o.patrolTimer = 0;
        o.phase += dt * 4.5;
        const gait = Math.sin(o.phase) * 0.29;
        o.rig.parts.thighL.rotation.x = gait; o.rig.parts.thighR.rotation.x = -gait;
        o.rig.parts.armL.rotation.x = -gait * 0.75; o.rig.parts.armR.rotation.x = gait * 0.75;
        o.rig.parts.foreL.rotation.x = o.rig.parts.foreR.rotation.x = -0.1;
        o.root.position.copy(o.pos); o.root.rotation.y = o.yaw;
        o.root.updateWorldMatrix(true, true);
        continue;
      }
      const to = new THREE.Vector3().subVectors(playerPos, o.pos);
      to.y = 0;
      const d = to.length();
      to.normalize();
      const desired = Math.atan2(to.x, to.z);
      let dy = desired - o.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      o.yaw += Math.max(-3.4 * dt, Math.min(3.4 * dt, dy));
      o.phase += dt * 6;
      if (d < 38) o.lastKnown.copy(playerPos);

      const inSight = d < 24 && Math.abs(dy) < 0.55;
      const wounded = o.hp < 26;
      o.aimT = inSight ? Math.min(1.6, o.aimT + dt) : Math.max(0, o.aimT - dt * 1.6);
      o.burstT = Math.max(0, o.burstT - dt);

      if (inSight) {
        o.state = 'shoot';
        // раненый отходит за укрытие, но продолжает огонь
        if (wounded) {
          const away = o.pos.clone().addScaledVector(to, -dt * 2.2);
          const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(o.side * dt * 1.6);
          away.add(side);
          if (!blocked(away.x, away.z)) o.pos.copy(away);
        } else if (d < 7) {
          // слишком близко — пятится, сохраняя линию огня
          const back = o.pos.clone().addScaledVector(to, -dt * 1.4);
          if (!blocked(back.x, back.z)) o.pos.copy(back);
        } else {
          // стреляет на ходу, смещаясь вбок (не толпа в одной точке)
          const strafe = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(o.side * dt * 1.1);
          const next = o.pos.clone().add(strafe);
          if (!blocked(next.x, next.z)) o.pos.copy(next);
        }
        // стрельба очередями: 3 выстрела, пауза
        o.fireT -= dt;
        if (o.fireT <= 0 && o.burstT <= 0) {
          const aimQ = 0.055 + (1.6 - Math.min(1.6, o.aimT)) * 0.055 + (wounded ? 0.035 : 0);
          const dir = new THREE.Vector3().subVectors(playerPos.clone().setY(1.4), o.pos.clone().setY(1.4)).normalize();
          dir.x += (Math.random() - 0.5) * aimQ * 2;
          dir.y += (Math.random() - 0.5) * aimQ;
          dir.z += (Math.random() - 0.5) * aimQ * 2;
          onShoot(o.pos.clone().setY(1.4), dir.normalize());
          o.burst--;
          if (o.burst <= 0) { o.burst = 3; o.burstT = 0.85 + Math.random() * 0.5; }
          else o.fireT = 0.11;
          if (o.fireT <= 0) o.fireT = 0;
        }
      } else if (this.wanted > 0) {
        // потерял из вида — идёт к последней известной точке
        o.state = 'chase';
        const target = o.lastKnown;
        const dirV = new THREE.Vector3().subVectors(target, o.pos).setY(0);
        const dl = dirV.length();
        if (dl > 2.5) {
          dirV.normalize();
          const sp = 3.7;
          const flank = o.side * Math.min(6, Math.max(0, dl - 7) * 0.5);
          const aimX = dirV.x * dl - dirV.z * flank, aimZ = dirV.z * dl + dirV.x * flank;
          const aimLen = Math.hypot(aimX, aimZ) || 1;
          const nx = o.pos.x + (aimX / aimLen) * sp * dt;
          const nz = o.pos.z + (aimZ / aimLen) * sp * dt;
          if (!blocked(nx, nz)) { o.pos.x = nx; o.pos.z = nz; }
        } else {
          // на месте: осматривается, «ищет»
          o.yaw += Math.sin(this.sirenPhase * 0.8 + o.phase) * dt * 1.4;
        }
      } else {
        o.state = 'patrol';
      }
      o.root.position.set(o.pos.x, 0, o.pos.z);
      o.root.rotation.y = o.yaw;
      const gait = o.state === 'shoot' ? 0 : Math.sin(o.phase) * 0.45;
      o.rig.parts.thighL.rotation.x = gait;
      o.rig.parts.thighR.rotation.x = -gait;
      o.rig.parts.shinL.rotation.x = Math.max(0, -gait) * 0.8;
      o.rig.parts.shinR.rotation.x = Math.max(0, gait) * 0.8;
      o.rig.parts.armL.rotation.x = o.state === 'shoot' ? -1.2 : -gait * 0.65;
      o.rig.parts.armR.rotation.x = o.state === 'shoot' ? -1.4 : gait * 0.65;
      o.rig.parts.foreL.rotation.x = o.state === 'shoot' ? -0.35 : -0.12;
      o.rig.parts.foreR.rotation.x = -0.15;
      o.rig.hips.position.y = 1 + Math.abs(gait) * 0.025;
      o.rig.head.rotation.x = o.state === 'shoot' ? 0.02 : Math.sin(o.phase) * 0.025;
      o.root.updateWorldMatrix(true, true);
    }

    // чистка: взорванные машины остаются как обгоревшие кузова, пока их не уберёт Traffic
    this.cars = this.cars.filter(c => !(c.dead && c.smoke > 1.2 && Math.random() < dt * 0.4));
    this.officers = this.officers.filter((o) => {
      if (o.state === 'dead' && o.deadT > 12) { this.onRemove?.(o); this.scene.remove(o.root); return false; }
      return true;
    });
  }

  private spawnCar(playerPos: THREE.Vector3) {
    if (!this.traffic) return;
    let pos = new THREE.Vector3();
    for (let attempt = 0; attempt < 16; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = 70 + Math.random() * 40;
      pos.set(playerPos.x + Math.cos(a) * r, 0, playerPos.z + Math.sin(a) * r);
      if (!this.blocked(pos.x, pos.z)) break;
    }
    const yaw = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z);
    const car = this.traffic.spawn('police', pos.x, pos.z, yaw, false);
    car.ai = false;
    car.hp = 150;
    car.gearText = 'D1';
    const lights: THREE.Mesh[] = [];
    // мигалки монтируем на крышу патрульной машины
    const mk = (color: number, x: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.3), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.4, roughness: 0.4 }));
      m.position.set(x, 1.34, -0.3);
      car.root.add(m);
      lights.push(m);
    };
    mk(0xff2222, -0.42);
    mk(0x2255ff, 0.42);
    this.scene.add(car.root);
    this.cars.push({ car, pos: car.pos.clone(), yaw, speed: 0, lights, sirenT: 0, hp: 150, dead: false, smoke: 0, stuck: 0 });
  }

  private spawnOfficer(playerPos: THREE.Vector3) {
    const pos = playerPos.clone();
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2, r = 28 + Math.random() * 18;
      pos.set(playerPos.x + Math.cos(a) * r, 0, playerPos.z + Math.sin(a) * r);
      if (!this.blocked(pos.x, pos.z)) break;
      if (attempt === 23) return;
    }
    const rig = createCharacter('officer');
    const root = rig.root;
    root.position.copy(pos);
    root.updateWorldMatrix(true, true);
    this.scene.add(root);
    this.officers.push({ root, rig, pos, yaw: 0, hp: 60, state: this.wanted ? 'chase' : 'patrol', shootCd: 0, fireT: 1 + Math.random(), vel: new THREE.Vector3(), phase: Math.random() * 6, deadT: 0, patrolTarget: pos.clone(), patrolTimer: 0, side: Math.random() < 0.5 ? -1 : 1, aimT: 0, burst: 0, burstT: 0, lastKnown: pos.clone() });
  }

  hitOfficer(o: Officer, dmg: number, dir: THREE.Vector3) {
    o.hp -= dmg;
    o.pos.addScaledVector(dir, 0.5);
    if (o.hp <= 0 && o.state !== 'dead') {
      o.state = 'dead';
      o.deadT = 0;
      this.onFall?.(o, dir);
    }
  }
}
