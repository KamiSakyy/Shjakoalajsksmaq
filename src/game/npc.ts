import * as THREE from 'three';
import type { Material } from './audio';
import { createCharacter, woundMaterial, boneMaterial } from './characters';

export type PartName = 'head' | 'torso' | 'armL' | 'armR' | 'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR';
export type NpcKind = 'zombie' | 'human';
export type NpcVariant = 'normal' | 'runner' | 'brute';

export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
  part: PartName;
  mat: Material;
  resistance: number;
  obj: THREE.Object3D;
}

export interface Stump { obj: THREE.Object3D; local: THREE.Vector3; time: number }

const PART_INFO: Record<PartName, { mat: Material; resistance: number; r: number }> = {
  head: { mat: 'bone', resistance: 240, r: 0.135 },
  torso: { mat: 'flesh', resistance: 125, r: 0.2 },
  armL: { mat: 'flesh', resistance: 70, r: 0.065 },
  armR: { mat: 'flesh', resistance: 70, r: 0.065 },
  foreL: { mat: 'flesh', resistance: 60, r: 0.058 },
  foreR: { mat: 'flesh', resistance: 60, r: 0.058 },
  thighL: { mat: 'flesh', resistance: 95, r: 0.095 },
  thighR: { mat: 'flesh', resistance: 95, r: 0.095 },
  shinL: { mat: 'flesh', resistance: 80, r: 0.075 },
  shinR: { mat: 'flesh', resistance: 80, r: 0.075 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export interface NpcOptions {
  kind: NpcKind;
  pos: THREE.Vector3;
  wander?: THREE.Vector3;
  variant?: NpcVariant;
  onFall?: (npc: Npc, direction: THREE.Vector3) => void;
}

export class Npc {
  root = new THREE.Group();
  hips = new THREE.Group();
  torso = new THREE.Group();
  neck = new THREE.Group();
  head = new THREE.Group();
  parts!: Record<PartName, THREE.Group>;
  lost = new Set<PartName>();
  stumps: Stump[] = [];
  woundCount = 0;

  kind: NpcKind;
  variant: NpcVariant = 'normal';
  hp: number;
  speed: number;
  phase = Math.random() * 10;
  gaitFreq: number;
  lean: number;
  armStyle: number;
  limp: number;
  scale: number;

  state: 'walk' | 'attack' | 'stagger' | 'dead' | 'flee' | 'idle' = 'walk';
  vel = new THREE.Vector3();
  staggerT = 0;
  staggerLean = 0;
  attackT = 0;
  attackCd = 0;
  attackDone = false;
  crawler = false;
  crawlBlend = 0;
  hpBar: THREE.Mesh | null = null;

  fallDir = new THREE.Vector3(0, 0, 1);
  fallAngle = 0;
  fallVel = 0;
  fallLanded = false;
  deadTime = 0;
  limpPose: number[] = [];
  yaw = 0;
  groanT = Math.random() * 6 + 2;
  remove = false;
  lastHitPart: PartName | null = null;
  target = new THREE.Vector3();
  hasTarget = false;
  idleT = 0;
  panicT = 0;
  wanderTimer = 0;
  walkSpeedNow = 0;
  walkPlan: { target: THREE.Vector3; waiting: boolean } | null = null;
  onFall?: (npc: Npc, direction: THREE.Vector3) => void;
  private reaction: { part: PartName; bend: number; twist: number; time: number } | null = null;
  private gaze: { x: number; z: number; time: number } | null = null;

  constructor(opts: NpcOptions) {
    this.kind = opts.kind;
    this.onFall = opts.onFall;
    this.variant = opts.variant ?? 'normal';
    const zombie = this.kind === 'zombie';
    const v = this.variant;
    const rig = createCharacter(this.kind, v);
    this.root = rig.root;
    this.hips = rig.hips;
    this.torso = rig.torso;
    this.neck = rig.neck;
    this.head = rig.head;
    this.parts = rig.parts;
    this.scale = v === 'brute' ? 1.2 : v === 'runner' ? 0.93 : 0.94 + Math.random() * 0.08;
    this.speed = v === 'runner' ? 3.3 : v === 'brute' ? 0.85 : zombie ? 0.8 + Math.random() * 0.65 : 1.15 + Math.random() * 0.4;
    this.gaitFreq = v === 'runner' ? 7.6 : zombie ? 3.4 : 5.2;
    this.lean = zombie ? 0.08 + Math.random() * 0.13 : 0.025;
    this.armStyle = Math.random();
    this.limp = zombie ? Math.random() * 0.4 : 0;
    this.hp = v === 'brute' ? 320 : v === 'runner' ? 55 : zombie ? 100 : 60;
    this.root.position.copy(opts.pos);
    this.root.scale.setScalar(this.scale);
    if (opts.wander) { this.target.copy(opts.wander); this.hasTarget = true; }
    for (let i = 0; i < 12; i++) this.limpPose.push((Math.random() - 0.5) * 1.2);
    this.root.updateWorldMatrix(true, true);
  }

  get alive() { return this.state !== 'dead'; }
  position() { return this.root.position; }

  glanceAt(p: THREE.Vector3) { this.gaze = { x: p.x, z: p.z, time: 1.35 }; }

  getCapsules(out: Capsule[]) {
    out.length = 0;
    this.root.updateWorldMatrix(true, true);
    const add = (part: PartName, obj: THREE.Object3D, aLocal: THREE.Vector3, bLocal: THREE.Vector3) => {
      if (this.lost.has(part)) return;
      const info = PART_INFO[part];
      out.push({
        a: obj.localToWorld(aLocal.clone()),
        b: obj.localToWorld(bLocal.clone()),
        r: info.r * this.scale,
        part,
        mat: info.mat,
        resistance: info.resistance,
        obj,
      });
    };
    add('head', this.head, new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, 0.2, 0));
    add('torso', this.torso, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.5, 0));
    add('armL', this.parts.armL, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.3, 0));
    add('armR', this.parts.armR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.3, 0));
    add('foreL', this.parts.foreL, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.33, 0));
    add('foreR', this.parts.foreR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.33, 0));
    add('thighL', this.parts.thighL, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.45, 0));
    add('thighR', this.parts.thighR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.45, 0));
    add('shinL', this.parts.shinL, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.47, 0));
    add('shinR', this.parts.shinR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.47, 0));
  }

  addWound(part: PartName, worldPoint: THREE.Vector3, size: number) {
    if (this.woundCount > 7) return;
    this.woundCount++;
    const obj = this.parts[part];
    const w = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 5), woundMaterial);
    const local = obj.worldToLocal(worldPoint.clone());
    w.position.copy(local);
    w.scale.set(1, 1.6, 0.6);
    w.rotation.set((Math.random() - 0.5) * 0.6, Math.atan2(local.x, local.z), (Math.random() - 0.5) * 1.2);
    obj.add(w);
  }

  dismember(part: PartName): THREE.Object3D | null {
    if (this.lost.has(part)) return null;
    const obj = this.parts[part];
    const chain: PartName[] = [part];
    if (part === 'armL') chain.push('foreL');
    if (part === 'armR') chain.push('foreR');
    if (part === 'thighL') chain.push('shinL');
    if (part === 'thighR') chain.push('shinR');
    for (const p of chain) this.lost.add(p);
    const parent = obj.parent;
    if (!parent || !this.root.getObjectById(obj.id)) return null;
    const pos = obj.getWorldPosition(new THREE.Vector3());
    const stump = new THREE.Mesh(new THREE.SphereGeometry(PART_INFO[part].r * 0.95, 7, 5), woundMaterial);
    const stumpLocal = parent.worldToLocal(pos.clone());
    stump.position.copy(stumpLocal);
    parent.add(stump);
    if (part !== 'head') {
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 5), boneMaterial);
      bone.position.copy(stumpLocal);
      bone.position.y -= 0.03;
      parent.add(bone);
    }
    this.stumps.push({ obj: parent, local: stumpLocal.clone(), time: 6 });
    if (part === 'head') this.hp = 0;
    if ((part === 'thighL' || part === 'thighR' || part === 'shinL' || part === 'shinR') && !this.crawler) this.crawler = true;
    return obj;
  }

  applyHit(part: PartName, damage: number, impulse: THREE.Vector3, stagger: number) {
    this.lastHitPart = part;
    this.hp -= damage;
    this.vel.add(impulse);
    if (this.alive) {
      const lateral = Math.cos(this.yaw) * impulse.x - Math.sin(this.yaw) * impulse.z;
      this.reaction = { part, bend: Math.min(0.62, 0.12 + stagger * 0.45), twist: Math.max(-0.42, Math.min(0.42, lateral * 0.23)), time: 0 };
    }
    if (this.state !== 'dead' && this.kind === 'zombie') {
      if (!(this.state === 'attack' && stagger < 0.3)) {
        this.state = 'stagger';
        this.staggerT = Math.max(this.staggerT, stagger);
      }
    } else if (this.state !== 'dead') {
      this.state = 'flee';
      this.panicT = 4 + Math.random() * 3;
    }
  }

  kill(dir: THREE.Vector3) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.fallDir.set(dir.x, 0, dir.z);
    if (this.fallDir.lengthSq() < 0.01) this.fallDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).negate();
    this.fallDir.normalize();
    this.fallVel = 0.6 + Math.random() * 0.6;
    this.fallAngle = 0;
    this.deadTime = 0;
    this.fallLanded = false;
    this.onFall?.(this, this.fallDir);
  }

  update(dt: number, playerPos: THREE.Vector3, npcs: Npc[], collide: (p: THREE.Vector3, r: number) => void, onAttack: () => void): boolean {
    const p = this.root.position;
    this.phase += dt * this.gaitFreq * (this.crawler ? 0.8 : 1) * (this.walkSpeedNow > 0.1 ? 1 : 0.25);
    this.crawlBlend = lerp(this.crawlBlend, this.crawler ? 1 : 0, 1 - Math.exp(-dt * 4));

    if (this.state === 'dead') {
      if (this.onFall) this.deadTime += dt;
      else {
        this.updateDeath(dt);
        p.addScaledVector(this.vel, dt);
        this.vel.multiplyScalar(Math.exp(-dt * 6));
      }
      return this.deadTime > 14;
    }

    const toP = _v.subVectors(playerPos, p);
    toP.y = 0;
    const dist = toP.length();
    toP.normalize();
    let moveSpeed = 0;
    let desiredYaw = this.yaw;

    if (this.kind === 'human') {
      // живой человек: бродит, убегает от зомби и от стрельбы
      this.wanderTimer -= dt;
      const nearZombie = npcs.some((n) => n !== this && n.kind === 'zombie' && n.alive && n.position().distanceTo(p) < 9);
      const threat = nearZombie || this.panicT > 0;
      if (this.panicT > 0) this.panicT -= dt;
      if (threat) {
        const src = nearZombie ? npcs.find((n) => n !== this && n.kind === 'zombie' && n.alive && n.position().distanceTo(p) < 9) : null;
        const from = src ? src.position() : playerPos;
        desiredYaw = Math.atan2(p.x - from.x, p.z - from.z);
        moveSpeed = 4.6;
        this.state = 'flee';
      } else if (this.walkPlan) {
        const toT = _v2.subVectors(this.walkPlan.target, p).setY(0);
        moveSpeed = this.walkPlan.waiting ? 0 : this.speed * Math.min(1, toT.length() * 2);
        if (toT.lengthSq() > 0.01) desiredYaw = Math.atan2(toT.x, toT.z);
        this.state = moveSpeed > 0.02 ? 'walk' : 'idle';
      } else {
        if (this.wanderTimer <= 0 || !this.hasTarget) {
          this.wanderTimer = 3 + Math.random() * 6;
          this.hasTarget = true;
          const a = Math.random() * Math.PI * 2;
          const r = 8 + Math.random() * 22;
          this.target.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
          this.state = Math.random() < 0.25 ? 'idle' : 'walk';
        }
        const toT = _v2.subVectors(this.target, p);
        toT.y = 0;
        if (toT.length() < 1.6) { this.state = 'idle'; this.wanderTimer = Math.min(this.wanderTimer, 0.5); }
        else { desiredYaw = Math.atan2(toT.x, toT.z); moveSpeed = 1.5; if (this.state === 'idle') this.state = 'walk'; }
      }
    } else {
      // зомби
      const reach = this.crawler ? 1.1 : this.variant === 'brute' ? 1.75 : 1.45;
      this.attackCd = Math.max(0, this.attackCd - dt);
      if (this.state === 'walk') {
        if (dist < reach && this.attackCd <= 0) {
          this.state = 'attack'; this.attackT = 0; this.attackDone = false;
        } else if (dist > reach * 0.8) {
          moveSpeed = this.speed * (this.crawler ? 0.45 : 1) * (1 - this.limp * 0.3 * Math.max(0, Math.sin(this.phase)));
        }
      } else if (this.state === 'attack') {
        this.attackT += dt;
        if (this.attackT > 0.55 && !this.attackDone) {
          this.attackDone = true;
          if (dist < reach + 0.25) onAttack();
        }
        if (this.attackT > 1.1) { this.state = 'walk'; this.attackCd = 0.8 + Math.random() * 0.8; }
      } else if (this.state === 'stagger') {
        this.staggerT -= dt;
        if (this.staggerT <= 0) this.state = 'walk';
      }
      desiredYaw = Math.atan2(toP.x, toP.z);
    }

    let dy = desiredYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const turnRate = this.state === 'stagger' ? 1.5 : this.kind === 'human' && this.state === 'flee' ? 5 : 3.5;
    this.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, dy));
    this.root.rotation.set(0, this.yaw, 0);
    this.walkSpeedNow = moveSpeed;
    this.staggerLean = lerp(this.staggerLean, this.state === 'stagger' ? 1 : 0, 1 - Math.exp(-dt * 12));

    const fwd = _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    p.addScaledVector(fwd, moveSpeed * dt * (Math.abs(dy) > 1.25 ? 0.15 : 1));
    p.addScaledVector(this.vel, dt);
    this.vel.multiplyScalar(Math.exp(-dt * 5));
    for (const o of npcs) {
      if (o === this || o.state === 'dead') continue;
      const dx = p.x - o.root.position.x, dz = p.z - o.root.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.62 * 0.62 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = (0.62 - d) * 2 * dt;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
    if (this.kind === 'zombie' && dist < 0.62) p.addScaledVector(toP, -(0.62 - dist));
    collide(p, 0.3);
    this.animate(dt, moveSpeed);
    this.groanT -= dt;
    return false;
  }

  wantsGroan() {
    if (this.groanT <= 0) { this.groanT = 4 + Math.random() * 8; return true; }
    return false;
  }

  private animate(dt: number, moveSpeed: number) {
    const P = this.parts;
    const ph = this.phase;
    const gait = Math.min(1, moveSpeed / 0.8) * 0.6 + 0.12;
    const cb = this.crawlBlend;
    const stag = this.staggerLean;
    const panic = this.state === 'flee';
    this.hips.position.y = lerp(1.0 + Math.abs(Math.sin(ph * 2)) * 0.013 * gait, 0.42, cb);
    this.hips.rotation.z = Math.sin(ph) * 0.025 * gait * (1 - cb);
    this.hips.rotation.x = lerp(0, -1.25, cb);
    this.torso.rotation.x = -this.lean * (1 - cb) + stag * 0.45 + (this.state === 'attack' ? this.attackCurve() * -0.5 : 0);
    this.torso.rotation.z = Math.sin(ph) * 0.025 * gait + stag * 0.2 * Math.sin(ph * 3) + (panic ? 0.12 : 0);
    this.torso.rotation.y = Math.sin(ph * 0.5) * 0.05;
    this.head.rotation.x = Math.sin(ph * 0.7) * 0.035 + (this.kind === 'zombie' ? 0.09 : 0) - stag * 0.22;
    this.head.rotation.z = Math.sin(ph * 0.9 + 1) * (this.kind === 'zombie' ? 0.09 : 0.02);
    if (this.gaze) {
      this.gaze.time -= dt;
      const angle = Math.atan2(this.gaze.x - this.root.position.x, this.gaze.z - this.root.position.z) - this.yaw;
      const gazeYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(angle), Math.cos(angle)), -0.81, 0.81) * Math.min(1, this.gaze.time * 4);
      this.head.rotation.y = lerp(this.head.rotation.y, gazeYaw, 1 - Math.exp(-dt * 8));
      if (this.gaze.time <= 0) this.gaze = null;
    } else this.head.rotation.y *= Math.exp(-dt * 7);
    const limpL = 1 - this.limp;
    if (!this.lost.has('thighL')) {
      P.thighL.rotation.x = lerp(-Math.sin(ph) * 0.6 * gait * limpL, 0.9 + Math.sin(ph) * 0.3, cb);
      P.shinL.rotation.x = lerp(Math.max(0, Math.cos(ph)) * 0.8 * gait + 0.1, 1.2, cb);
    }
    if (!this.lost.has('thighR')) {
      P.thighR.rotation.x = lerp(Math.sin(ph) * 0.6 * gait, 0.9 - Math.sin(ph) * 0.3, cb);
      P.shinR.rotation.x = lerp(Math.max(0, -Math.cos(ph)) * 0.8 * gait + 0.1, 1.2, cb);
    }
    const atk = this.state === 'attack' ? this.attackCurve() : 0;
    const baseArm = this.kind === 'zombie'
      ? lerp(-1.05, -0.35, this.armStyle) * (1 - cb) + cb * (-1.8)
      : lerp(-0.15, 0.25, this.armStyle) * (1 - cb) - (panic ? 0.7 : 0);
    const armSwing = Math.sin(ph) * (this.kind === 'zombie' ? 0.1 : 0.32) * gait;
    if (!this.lost.has('armL')) {
      P.armL.rotation.x = baseArm - armSwing - atk * 1.1 + stag * 0.5 + cb * Math.sin(ph) * 0.6;
      P.armL.rotation.z = 0.15 + atk * 0.3 + (panic ? 0.5 : 0);
      P.foreL.rotation.x = -0.4 * (1 - cb) - atk * 0.3 - (panic ? 0.5 : 0);
    }
    if (!this.lost.has('armR')) {
      P.armR.rotation.x = baseArm + armSwing - atk * 1.1 + stag * 0.5 - cb * Math.sin(ph) * 0.6;
      P.armR.rotation.z = -0.15 - atk * 0.3 - (panic ? 0.5 : 0);
      P.foreR.rotation.x = -0.5 * (1 - cb) - atk * 0.3 - (panic ? 0.5 : 0);
    }
    const hit = this.reaction;
    if (hit) {
      hit.time += dt;
      const recoil = Math.sin(hit.time * 14) * Math.exp(-hit.time * 5.6);
      if (!this.lost.has(hit.part)) {
        P[hit.part].rotation.x += hit.bend * recoil;
        P[hit.part].rotation.z += hit.twist * recoil;
      }
      this.torso.rotation.y += hit.twist * recoil * 0.37;
      if (hit.time > 0.8) this.reaction = null;
    }
  }

  private attackCurve() {
    const t = this.attackT;
    if (t < 0.5) return -(t / 0.5) * 0.6;
    if (t < 0.65) return lerp(-0.6, 1.2, (t - 0.5) / 0.15);
    return lerp(1.2, 0, Math.min(1, (t - 0.65) / 0.45));
  }

  private updateDeath(dt: number) {
    this.deadTime += dt;
    if (!this.fallLanded) {
      this.fallVel += 7.5 * dt * (0.4 + this.fallAngle);
      this.fallAngle += this.fallVel * dt;
      const limit = this.crawler ? 0.5 : Math.PI / 2 - 0.08;
      if (this.fallAngle >= limit) { this.fallAngle = limit; this.fallLanded = true; }
      const axis = _v.set(-this.fallDir.z, 0, this.fallDir.x).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, this.fallAngle);
      const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.root.quaternion.copy(q).multiply(yq);
      const k = 1 - Math.exp(-dt * 6);
      const P = this.parts;
      const lp = this.limpPose;
      P.armL.rotation.x = lerp(P.armL.rotation.x, lp[0], k);
      P.armR.rotation.x = lerp(P.armR.rotation.x, lp[1], k);
      P.foreL.rotation.x = lerp(P.foreL.rotation.x, -Math.abs(lp[2]), k);
      P.foreR.rotation.x = lerp(P.foreR.rotation.x, -Math.abs(lp[3]), k);
      P.thighL.rotation.x = lerp(P.thighL.rotation.x, lp[4] * 0.5, k);
      P.thighR.rotation.x = lerp(P.thighR.rotation.x, lp[5] * 0.5, k);
      P.shinL.rotation.x = lerp(P.shinL.rotation.x, Math.abs(lp[6]), k);
      P.shinR.rotation.x = lerp(P.shinR.rotation.x, Math.abs(lp[7]), k);
      this.head.rotation.x = lerp(this.head.rotation.x, lp[8] * 0.6, k);
      this.head.rotation.z = lerp(this.head.rotation.z, lp[9] * 0.6, k);
      this.torso.rotation.x = lerp(this.torso.rotation.x, lp[10] * 0.2, k);
      this.torso.rotation.z = lerp(this.torso.rotation.z, lp[11] * 0.2, k);
    } else if (this.deadTime > 9) {
      this.root.position.y -= dt * 0.12;
    }
  }
}
