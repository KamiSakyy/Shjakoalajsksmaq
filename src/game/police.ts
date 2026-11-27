import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCharacter, type CharacterRig } from './characters';

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
  patrolTimer: number;
  side: 1 | -1;
}

export interface PoliceCar {
  root: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  lights: THREE.Mesh[];
  sirenT: number;
  hp: number;
  dead: boolean;
  smoke: number;
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
  sirenPhase = 0;
  private blocked: (x: number, z: number) => boolean = () => false;
  onFall?: (o: Officer, dir: THREE.Vector3) => void;
  onRemove?: (o: Officer) => void;

  constructor(public scene: THREE.Scene) {}

  crime(amount: number) {
    this.wanted = Math.min(5, this.wanted + amount);
    this.heat = 22 + this.wanted * 12;
    this.stars = Math.min(5, Math.ceil(this.wanted));
  }

  get active() { return this.wanted > 0; }

  populatePatrol(origin: THREE.Vector3, blocked: (x: number, z: number) => boolean) {
    this.blocked = blocked;
    for (let i = this.officers.length; i < 2; i++) this.spawnOfficer(origin);
  }

  update(dt: number, playerPos: THREE.Vector3, blocked: (x: number, z: number) => boolean, onShoot: (from: THREE.Vector3, dir: THREE.Vector3) => void) {
    this.blocked = blocked;
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
    const wantCars = Math.min(4, Math.ceil(this.wanted / 1.5));
    if (this.cars.filter((c) => !c.dead).length < wantCars && Math.random() < dt * 0.55) {
      this.spawnCar(playerPos);
    }
    const wantOfficers = Math.min(6, Math.max(2, Math.ceil(this.wanted) * 2));
    if (this.officers.filter((o) => o.state !== 'dead').length < wantOfficers && Math.random() < dt * 0.5) {
      this.spawnOfficer(playerPos);
    }

    // сирена
    this.sirenPhase += dt * 6;
    for (const c of this.cars) {
      if (c.dead) {
        c.smoke = Math.min(1, c.smoke + dt);
        continue;
      }
      const to = new THREE.Vector3().subVectors(playerPos, c.pos);
      to.y = 0;
      const d = to.length();
      to.normalize();
      const desired = Math.atan2(to.x, to.z);
      let dy = desired - c.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      c.yaw += Math.max(-2.2 * dt, Math.min(2.2 * dt, dy));
      const targetSpeed = d > 12 ? 20 : d > 5 ? 11 : 0;
      c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 1.5);
      const nx = c.pos.x + Math.sin(c.yaw) * c.speed * dt;
      const nz = c.pos.z + Math.cos(c.yaw) * c.speed * dt;
      if (!blocked(nx, nz)) { c.pos.x = nx; c.pos.z = nz; }
      else c.speed *= 0.6;
      c.root.position.copy(c.pos);
      c.root.rotation.y = c.yaw;
      // мигалки
      const t = Math.sin(this.sirenPhase * 2.2) > 0;
      const m0 = c.lights[0].material as THREE.MeshStandardMaterial;
      const m1 = c.lights[1].material as THREE.MeshStandardMaterial;
      m0.emissiveIntensity = t ? 4 : 0.2;
      m1.emissiveIntensity = t ? 0.2 : 4;
      m0.color.setHex(t ? 0xff2222 : 0x660000);
      m1.color.setHex(t ? 0x002266 : 0x2255ff);
    }

    // офицеры
    for (const o of this.officers) {
      if (o.state === 'dead') { o.deadT += dt; if (!this.onFall) o.root.rotation.x = Math.min(Math.PI / 2, o.root.rotation.x + dt * 3); continue; }
      if (this.wanted <= 0) {
        o.state = 'patrol';
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
      o.yaw += Math.max(-3 * dt, Math.min(3 * dt, dy));
      o.phase += dt * 6;
      const shootRange = d < 22 && Math.abs(dy) < 0.5;
      if (shootRange) {
        o.state = 'shoot';
        o.fireT -= dt;
        o.shootCd -= dt;
        if (o.fireT <= 0) {
          o.fireT = 0.5 + Math.random() * 0.4;
          const dir = new THREE.Vector3().subVectors(playerPos.clone().setY(1.4), o.pos.clone().setY(1.4)).normalize();
          dir.x += (Math.random() - 0.5) * 0.07;
          dir.y += (Math.random() - 0.5) * 0.04;
          dir.z += (Math.random() - 0.5) * 0.07;
          onShoot(o.pos.clone().setY(1.4), dir.normalize());
        }
      } else {
        o.state = 'chase';
        const sp = 3.4;
        // Officers spread out to the sides as they close in, so they box the player in.
        const flank = o.side * Math.min(7, Math.max(0, d - 6) * 0.6);
        const aimX = to.x * d - to.z * flank, aimZ = to.z * d + to.x * flank;
        const aimLen = Math.hypot(aimX, aimZ) || 1;
        const nx = o.pos.x + (aimX / aimLen) * sp * dt;
        const nz = o.pos.z + (aimZ / aimLen) * sp * dt;
        if (!blocked(nx, nz)) { o.pos.x = nx; o.pos.z = nz; }
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

    // чистка
    this.cars = this.cars.filter((c) => !(c.dead && c.smoke > 1 && Math.random() < dt));
    this.officers = this.officers.filter((o) => {
      if (o.state === 'dead' && o.deadT > 12) { this.onRemove?.(o); this.scene.remove(o.root); return false; }
      return true;
    });
  }

  private spawnCar(playerPos: THREE.Vector3) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 30;
    const pos = new THREE.Vector3(playerPos.x + Math.cos(a) * r, 0, playerPos.z + Math.sin(a) * r);
    const root = new THREE.Group();
    root.position.copy(pos);
    const body = new THREE.Mesh(
      mergeGeometries([
        (() => { const g = new THREE.BoxGeometry(1.85, 0.62, 4.3); g.translate(0, 0.72, 0); return g; })(),
        (() => { const g = new THREE.BoxGeometry(1.7, 0.42, 1.9); g.translate(0, 1.18, -0.15); return g; })(),
      ])!,
      new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.45, metalness: 0.4 })
    );
    body.castShadow = true;
    root.add(body);
    const lmR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.25), new THREE.MeshStandardMaterial({ color: 0x660000, emissive: new THREE.Color(0xff0000), emissiveIntensity: 3 }));
    const lmB = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.25), new THREE.MeshStandardMaterial({ color: 0x000066, emissive: new THREE.Color(0x0000ff), emissiveIntensity: 3 }));
    lmR.position.set(-0.5, 1.42, -0.2);
    lmB.position.set(0.5, 1.42, -0.2);
    root.add(lmR, lmB);
    const wm = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]] as number[][]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10), wm);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.34, wz);
      root.add(w);
    }
    this.scene.add(root);
    this.cars.push({ root, pos, yaw: 0, speed: 12, lights: [lmR, lmB], sirenT: 0, hp: 200, dead: false, smoke: 0 });
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
    this.officers.push({ root, rig, pos, yaw: 0, hp: 60, state: this.wanted ? 'chase' : 'patrol', shootCd: 0, fireT: 1 + Math.random(), vel: new THREE.Vector3(), phase: Math.random() * 6, deadT: 0, patrolTarget: pos.clone(), patrolTimer: 0, side: Math.random() < 0.5 ? -1 : 1 });
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
