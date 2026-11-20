import * as THREE from 'three';
import { BLOCK, ROAD_W, CITY_PLAN, BOUNDS } from './city-plan';

/**
 * Activities — побочные занятия в духе GTA:
 * спрятанные пакеты по всему городу, банкоматы (ограбление), магазины,
 * трамплины для трюков и уличная гонка с чекпойнтами.
 */

const OCEAN_DRIVE = 487;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export type Interact =
  | { kind: 'atm'; pos: THREE.Vector3; index: number }
  | { kind: 'store'; pos: THREE.Vector3; index: number }
  | { kind: 'race'; pos: THREE.Vector3; index: number };

export interface ActivityResult {
  money?: number;
  xp?: number;
  message?: string;
  wanted?: number;
}

interface Package { taken: boolean; phase: number; pos: THREE.Vector3 }
interface Ramp { pos: THREE.Vector3; yaw: number; mesh: THREE.Object3D; used: number }
interface Gate { mesh: THREE.Mesh; pos: THREE.Vector3; passed: boolean }

export class Activities {
  packages: Package[] = [];
  private packagesMesh!: THREE.InstancedMesh;
  private atms: { mesh: THREE.Group; pos: THREE.Vector3; cooldown: number }[] = [];
  private stores: { pos: THREE.Vector3; cooldown: number }[] = [];
  private ramps: Ramp[] = [];
  private gates: Gate[] = [];
  private raceStart = new THREE.Vector3();
  private raceMarker: THREE.Mesh;
  raceActive = false;
  raceIndex = 0;
  raceTimer = 0;
  raceBest = 0;
  private time = 0;
  private airTime = 0;
  private wasAir = false;

  constructor(private scene: THREE.Scene, private groundAt: (x: number, z: number) => number) {
    this.buildPackages();
    this.buildATMs();
    this.buildStores();
    this.buildRamps();
    this.buildRace();
    this.raceMarker = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.3, 24),
      new THREE.MeshBasicMaterial({ color: 0x53e0b0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.raceMarker.rotation.x = -Math.PI / 2;
    this.raceMarker.position.set(this.raceStart.x, this.groundAt(this.raceStart.x, this.raceStart.z) + 0.06, this.raceStart.z);
    scene.add(this.raceMarker);
  }

  /* ── спрятанные пакеты ───────────────────────────────────────────── */
  private buildPackages() {
    const geo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2fd6a0, emissive: 0x1fa37a, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3 });
    const spots: THREE.Vector3[] = [];
    for (const p of CITY_PLAN) {
      const a = Math.random() * Math.PI * 2;
      const r = (BLOCK - ROAD_W) * 0.42;
      spots.push(new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r));
    }
    for (let i = 0; i < 10; i++) {
      const z = -BOUNDS + (i / 9) * BOUNDS * 2;
      spots.push(new THREE.Vector3(OCEAN_DRIVE + (i % 2 ? 10 : -10), 0, z));
    }
    const list = spots.slice(0, 44);
    this.packagesMesh = new THREE.InstancedMesh(geo, mat, list.length);
    this.packagesMesh.frustumCulled = false;
    this.packagesMesh.castShadow = true;
    this.scene.add(this.packagesMesh);
    for (const s of list) {
      this.packages.push({ taken: false, phase: Math.random() * 6.28, pos: s.clone() });
    }
    this.packagesMesh.count = list.length;
  }

  private buildATMs() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.6, metalness: 0.4 });
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x1b3a4a, emissive: 0x2f8fb0, emissiveIntensity: 1.3, roughness: 0.3 });
    let i = 0;
    for (const p of CITY_PLAN) {
      if (i >= 8) break;
      const x = p.x + (BLOCK - ROAD_W) * 0.46;
      const z = p.z + 6;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.9, 0.5), bodyMat);
      body.position.y = 0.95;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), screenMat);
      screen.position.set(0, 1.42, 0.26);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0x111417 }));
      slot.position.set(0, 1.05, 0.26);
      g.add(body, screen, slot);
      g.position.set(x, this.groundAt(x, z), z);
      g.rotation.y = -Math.PI / 2;
      this.scene.add(g);
      this.atms.push({ mesh: g, pos: new THREE.Vector3(x, 0, z), cooldown: 0 });
      i++;
    }
  }

  private buildStores() {
    for (let i = 0; i < 4; i++) {
      const z = -300 + i * 200;
      const x = OCEAN_DRIVE - 16;
      this.stores.push({ pos: new THREE.Vector3(x, 0, z), cooldown: 0 });
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.8),
        new THREE.MeshStandardMaterial({ color: 0xff5f8f, emissive: 0xff5f8f, emissiveIntensity: 1.2, roughness: 0.5 }),
      );
      sign.position.set(x + 0.3, 3.1, z);
      sign.rotation.y = Math.PI / 2;
      this.scene.add(sign);
    }
  }

  private buildRamps() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3c4145, roughness: 0.7, metalness: 0.3 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf0c14e, roughness: 0.8 });
    const spots: [number, number, number][] = [
      [OCEAN_DRIVE, 300, Math.PI], [OCEAN_DRIVE, -180, 0], [40, -40, Math.PI / 2], [-160, 120, -Math.PI / 2],
    ];
    for (const [x, z, yaw] of spots) {
      const g = new THREE.Group();
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.28, 7), mat);
      ramp.rotation.x = -0.26;
      ramp.position.y = 0.55;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.04, 0.6), stripeMat);
      stripe.position.set(0, 1.3, 3.1);
      g.add(ramp, stripe);
      g.position.set(x, this.groundAt(x, z), z);
      g.rotation.y = yaw;
      this.scene.add(g);
      this.ramps.push({ pos: new THREE.Vector3(x, 0, z), yaw, mesh: g, used: 0 });
    }
  }

  private buildRace() {
    this.raceStart.set(OCEAN_DRIVE - 4, 0, 380);
    const route: [number, number][] = [
      [OCEAN_DRIVE - 4, 380], [OCEAN_DRIVE - 4, 120], [OCEAN_DRIVE - 4, -140],
      [120, -140], [120, 200], [-80, 200], [-80, 380], [OCEAN_DRIVE - 4, 380],
    ];
    for (const [x, z] of route) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(4.2, 0.22, 8, 22),
        new THREE.MeshStandardMaterial({ color: 0x53e0b0, emissive: 0x2fd6a0, emissiveIntensity: 1.4, roughness: 0.4 }),
      );
      ring.position.set(x, this.groundAt(x, z) + 3, z);
      ring.visible = false;
      this.scene.add(ring);
      this.gates.push({ mesh: ring, pos: new THREE.Vector3(x, 0, z), passed: false });
    }
  }

  /* ── взаимодействия ──────────────────────────────────────────────── */
  nearestInteract(pos: THREE.Vector3, max = 2.6): Interact | null {
    let best: Interact | null = null, bd = max;
    for (let i = 0; i < this.atms.length; i++) {
      const a = this.atms[i];
      if (a.cooldown > 0) continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d < bd) { bd = d; best = { kind: 'atm', pos: a.pos, index: i }; }
    }
    for (let i = 0; i < this.stores.length; i++) {
      const s = this.stores[i];
      if (s.cooldown > 0) continue;
      const d = Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z);
      if (d < bd) { bd = d; best = { kind: 'store', pos: s.pos, index: i }; }
    }
    if (!this.raceActive && Math.hypot(this.raceStart.x - pos.x, this.raceStart.z - pos.z) < Math.max(bd, 3.2)) {
      best = { kind: 'race', pos: this.raceStart, index: 0 };
    }
    return best;
  }

  /** Использовать интерактив. Возвращает награду или null. */
  use(target: Interact): ActivityResult | null {
    if (target.kind === 'atm') {
      const atm = this.atms[target.index];
      if (atm.cooldown > 0) return null;
      atm.cooldown = 120;
      const money = 180 + Math.round(Math.random() * 320);
      return { money, xp: 20, wanted: 1.6, message: `Банкомат вскрыт · $${money}` };
    }
    if (target.kind === 'store') {
      const store = this.stores[target.index];
      if (store.cooldown > 0) return null;
      store.cooldown = 240;
      const money = 320 + Math.round(Math.random() * 480);
      return { money, xp: 35, wanted: 2.4, message: `Касса очищена · $${money}` };
    }
    if (target.kind === 'race') {
      if (!this.raceActive) this.startRace();
      return { message: 'Гонка началась! Проедь все кольца' };
    }
    return null;
  }

  startRace() {
    this.raceActive = true;
    this.raceIndex = 0;
    this.raceTimer = 0;
    this.gates.forEach(g => { g.passed = false; g.mesh.visible = false; });
    if (this.gates[0]) this.gates[0].mesh.visible = true;
  }

  stopRace() {
    this.raceActive = false;
    this.gates.forEach(g => (g.mesh.visible = false));
  }

  /* ── обновление ──────────────────────────────────────────────────── */
  update(dt: number, ctx: { pos: THREE.Vector3; inCar: boolean; speed: number; night: number }): ActivityResult[] {
    this.time += dt;
    const out: ActivityResult[] = [];
    const { pos } = ctx;

    // пакеты
    let dirty = false;
    for (let i = 0; i < this.packages.length; i++) {
      const p = this.packages[i];
      if (p.taken) continue;
      const y = this.groundAt(p.pos.x, p.pos.z) + 0.42 + Math.sin(this.time * 2 + p.phase) * 0.12;
      _e.set(0, this.time * 1.8 + p.phase, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.pos.x, y, p.pos.z), _q, _s.set(1, 1, 1));
      this.packagesMesh.setMatrixAt(i, _m);
      dirty = true;
      if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < 1.9 && Math.abs(y - pos.y) < 2.2) {
        p.taken = true;
        this.packagesMesh.setMatrixAt(i, ZERO);
        out.push({ money: 50, xp: 8, message: `Пакет найден · ${this.collected}/${this.packages.length}` });
      }
    }
    if (dirty) this.packagesMesh.instanceMatrix.needsUpdate = true;

    // банкоматы: подсветка и кулдаун
    for (const a of this.atms) {
      if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - dt);
    }
    for (const s of this.stores) if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);

    // трюки: оторвался от земли на трамплине и приземлился
    const groundY = this.groundAt(pos.x, pos.z);
    const air = pos.y - groundY > 0.9;
    if (air) this.airTime += dt;
    if (this.wasAir && !air) {
      const nearRamp = this.ramps.some(r => Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z) < 12);
      if (this.airTime > 0.55 && nearRamp) {
        const gain = Math.round(this.airTime * 260 + ctx.speed * 4);
        out.push({ money: gain, xp: 14, message: `Трюк · ${this.airTime.toFixed(2)} с в воздухе · $${gain}` });
      }
      this.airTime = 0;
    }
    this.wasAir = air;

    // гонка
    if (this.raceActive) {
      this.raceTimer += dt;
      const gate = this.gates[this.raceIndex];
      if (gate) {
        gate.mesh.rotation.z += dt * 1.4;
        if (Math.hypot(gate.pos.x - pos.x, gate.pos.z - pos.z) < 7) {
          gate.passed = true;
          gate.mesh.visible = false;
          this.raceIndex++;
          if (this.raceIndex >= this.gates.length) {
            const time = this.raceTimer;
            this.raceActive = false;
            if (!this.raceBest || time < this.raceBest) this.raceBest = time;
            out.push({ money: 1200, xp: 90, message: `Гонка выиграна · ${time.toFixed(1)} с · $1200` });
          } else {
            this.gates[this.raceIndex].mesh.visible = true;
            out.push({ message: `Кольцо ${this.raceIndex + 1}/${this.gates.length}` });
          }
        }
      }
      if (this.raceTimer > 180) {
        this.stopRace();
        out.push({ message: 'Гонка провалена: время вышло' });
      }
    }
    this.raceMarker.rotation.z += dt * 0.9;
    (this.raceMarker.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 3) * 0.2;

    return out;
  }

  get collected() { return this.packages.filter(p => p.taken).length; }
  get total() { return this.packages.length; }
  get raceTarget() { return this.gates[this.raceIndex]?.pos ?? null; }
  get gatesCount() { return this.gates.length; }

  nearestRamp(pos: THREE.Vector3) {
    let best: Ramp | null = null, bd = 20;
    for (const r of this.ramps) {
      const d = Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  reset() {
    this.stopRace();
    for (const p of this.packages) p.taken = false;
    for (const a of this.atms) a.cooldown = 0;
    for (const s of this.stores) s.cooldown = 0;
  }
}


