import * as THREE from 'three';
import { Body, Box, ConeTwistConstraint, GSSolver, Plane, SAPBroadphase, Sphere, Vec3, World, type Constraint } from 'cannon-es';
import type { CharacterRig } from './characters';
import { BLOCK, ROAD_W, CITY_PLAN } from './city-plan';

const TERRAIN = 1, JOINT = 2, LOOSE = 4;
type JointName = 'hips' | keyof CharacterRig['parts'];
interface FallRig { root: THREE.Group; hips: THREE.Group; parts: CharacterRig['parts'] }
interface Binding { mesh: THREE.Object3D; body: Body; offset: THREE.Vector3; name: JointName }
interface Doll { root: THREE.Group; parts: Binding[]; joints: Constraint[]; age: number; sleepTime: number }
interface Loose { binding: Binding; age: number }

const v = (p: THREE.Vector3) => new Vec3(p.x, p.y, p.z);
const config: { name: JointName; parent?: JointName; center: [number, number, number]; mass: number; radius: number; length?: number; angle?: number }[] = [
  { name: 'hips', center: [0, -0.005, 0], mass: 11, radius: 0.13 },
  { name: 'torso', parent: 'hips', center: [0, 0.265, 0], mass: 17, radius: 0.13, length: 0.25, angle: 0.32 },
  { name: 'head', parent: 'torso', center: [0, 0.145, 0], mass: 3.6, radius: 0.112, angle: 0.63 },
  { name: 'armL', parent: 'torso', center: [0, -0.143, 0], mass: 2.5, radius: 0.061, length: 0.21, angle: 1.22 },
  { name: 'armR', parent: 'torso', center: [0, -0.143, 0], mass: 2.5, radius: 0.061, length: 0.21, angle: 1.22 },
  { name: 'foreL', parent: 'armL', center: [0, -0.161, 0], mass: 1.6, radius: 0.048, length: 0.25, angle: 1.32 },
  { name: 'foreR', parent: 'armR', center: [0, -0.161, 0], mass: 1.6, radius: 0.048, length: 0.25, angle: 1.32 },
  { name: 'thighL', parent: 'hips', center: [0, -0.211, 0], mass: 5.2, radius: 0.082, length: 0.33, angle: 0.88 },
  { name: 'thighR', parent: 'hips', center: [0, -0.211, 0], mass: 5.2, radius: 0.082, length: 0.33, angle: 0.88 },
  { name: 'shinL', parent: 'thighL', center: [0, -0.219, 0.012], mass: 3.1, radius: 0.062, length: 0.35, angle: 1.15 },
  { name: 'shinR', parent: 'thighR', center: [0, -0.219, 0.012], mass: 3.1, radius: 0.062, length: 0.35, angle: 1.15 },
];

export class BodyPhysics {
  private world = new World({ gravity: new Vec3(0, -9.8, 0), allowSleep: true });
  private dolls = new Map<THREE.Group, Doll>();
  private loose: Loose[] = [];
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private parentRotation = new THREE.Quaternion();
  private rotationOffset = new THREE.Vector3();
  private lastCount = 0;
  maxDolls = 5;

  constructor(walls: { min: THREE.Vector3; max: THREE.Vector3 }[]) {
    const broadphase = new SAPBroadphase(this.world);
    broadphase.axisIndex = 0;
    this.world.broadphase = broadphase;
    (this.world.solver as GSSolver).iterations = 9;
    (this.world.solver as GSSolver).tolerance = 0.005;
    this.world.defaultContactMaterial.friction = 0.62;
    this.world.defaultContactMaterial.restitution = 0.12;
    const ground = new Body({ mass: 0, shape: new Plane(), collisionFilterGroup: TERRAIN, collisionFilterMask: JOINT | LOOSE });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const b = new Body({ mass: 0, shape: new Box(new Vec3(sx, sy, sz)), position: new Vec3(x, y, z), collisionFilterGroup: TERRAIN, collisionFilterMask: JOINT | LOOSE });
      this.world.addBody(b);
    };
    for (const { min, max } of walls) box((min.x + max.x) / 2, 1.75, (min.z + max.z) / 2, (max.x - min.x) / 2, 1.75, (max.z - min.z) / 2);
    for (const p of CITY_PLAN) box(p.x, 0.06, p.z, (BLOCK - ROAD_W - 0.24) / 2, 0.12, (BLOCK - ROAD_W - 0.24) / 2);
  }

  get activeBodies() { return this.lastCount; }

  fall(rig: FallRig, direction: THREE.Vector3, momentum = new THREE.Vector3(), hit?: string) {
    if (this.dolls.has(rig.root)) return;
    if (this.dolls.size >= this.maxDolls) this.removeDoll(this.dolls.keys().next().value!);
    rig.root.updateWorldMatrix(true, true);
    const scale = rig.root.getWorldScale(new THREE.Vector3()).x;
    const doll: Doll = { root: rig.root, parts: [], joints: [], age: 0, sleepTime: 0 };
    for (const c of config) {
      const mesh = c.name === 'hips' ? rig.hips : rig.parts[c.name];
      if (!rig.root.getObjectById(mesh.id)) continue;
      const center = new THREE.Vector3(...c.center);
      const offset = center.clone().multiplyScalar(scale);
      const position = mesh.localToWorld(center);
      const rotation = mesh.getWorldQuaternion(new THREE.Quaternion());
      const body = new Body({ mass: c.mass, position: v(position), linearDamping: 0.22, angularDamping: 0.5,
        allowSleep: true, sleepSpeedLimit: 0.34, sleepTimeLimit: 1.1, collisionFilterGroup: JOINT, collisionFilterMask: TERRAIN });
      body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      const r = c.radius * scale;
      if (c.name === 'hips') body.addShape(new Box(new Vec3(0.146 * scale, 0.102 * scale, 0.107 * scale)));
      else if (c.name === 'torso') body.addShape(new Box(new Vec3(0.166 * scale, 0.235 * scale, 0.113 * scale)));
      else {
        body.addShape(new Sphere(r));
        if (c.length) {
          const side = (c.length * scale) / 2;
          body.addShape(new Sphere(r), new Vec3(0, side, 0));
          body.addShape(new Sphere(r), new Vec3(0, -side, 0));
        }
      }
      const height = THREE.MathUtils.clamp(position.y - rig.root.position.y, 0, 2);
      const sway = 0.49 + height * 0.48 + (hit === c.name ? 0.45 : 0);
      body.velocity.set(momentum.x * 0.55 + direction.x * sway, -0.18 + momentum.y * 0.25, momentum.z * 0.55 + direction.z * sway);
      body.angularVelocity.set(direction.z * (0.45 + height * 0.6), (Math.random() - 0.5) * 0.5, -direction.x * (0.45 + height * 0.6));
      this.world.addBody(body);
      const parent = doll.parts.find(p => p.name === c.parent);
      if (parent) {
        const origin = v(mesh.getWorldPosition(new THREE.Vector3()));
        const axis = new Vec3(0, c.name === 'head' || c.name === 'torso' ? 1 : -1, 0);
        const worldAxis = body.vectorToWorldFrame(axis);
        const joint = new ConeTwistConstraint(parent.body, body, {
          pivotA: parent.body.pointToLocalFrame(origin), pivotB: body.pointToLocalFrame(origin),
          axisA: parent.body.vectorToLocalFrame(worldAxis), axisB: axis,
          angle: c.angle ?? 0.7, twistAngle: c.name.startsWith('shin') || c.name.startsWith('fore') ? 0.22 : 0.48,
          maxForce: 4500, collideConnected: false,
        });
        this.world.addConstraint(joint); doll.joints.push(joint);
      }
      doll.parts.push({ mesh, body, offset, name: c.name });
    }
    this.dolls.set(rig.root, doll);
  }

  // A rigid box (lamp post, sign) that is knocked over and falls with real collisions.
  addRigid(mesh: THREE.Object3D, size: THREE.Vector3, mass: number, linear: THREE.Vector3, angular: THREE.Vector3) {
    if (!mesh.parent) return;
    mesh.updateMatrixWorld(true);
    const p = mesh.getWorldPosition(new THREE.Vector3());
    const q = mesh.getWorldQuaternion(new THREE.Quaternion());
    const body = new Body({ mass, position: v(p), linearDamping: 0.1, angularDamping: 0.3, allowSleep: true,
      sleepSpeedLimit: 0.2, sleepTimeLimit: 1.2, collisionFilterGroup: LOOSE, collisionFilterMask: TERRAIN | LOOSE });
    body.addShape(new Box(new Vec3(size.x / 2, size.y / 2, size.z / 2)));
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.velocity.copy(v(linear));
    body.angularVelocity.copy(v(angular));
    this.world.addBody(body);
    if (this.loose.length >= 16) this.removeLoose(0);
    this.loose.push({ age: 0, binding: { mesh, body, offset: new THREE.Vector3(), name: 'hips' } });
  }

  detach(mesh: THREE.Object3D) {
    for (const doll of this.dolls.values()) {
      const removed = doll.parts.filter(b => b.mesh === mesh || !!mesh.getObjectById(b.mesh.id));
      if (!removed.length) continue;
      const bodies = new Set(removed.map(b => b.body));
      doll.joints = doll.joints.filter(c => {
        if (bodies.has(c.bodyA) || bodies.has(c.bodyB)) { this.world.removeConstraint(c); return false; }
        return true;
      });
      removed.forEach(b => this.world.removeBody(b.body));
      doll.parts = doll.parts.filter(b => !bodies.has(b.body));
    }
  }

  fragment(mesh: THREE.Object3D, momentum: THREE.Vector3, spin: THREE.Vector3, radius: number) {
    this.detach(mesh);
    const r = THREE.MathUtils.clamp(radius, 0.047, 0.13);
    const center = new THREE.Vector3(0, mesh.name === 'head' ? 0.14 : -0.12, 0);
    const offset = center.clone().multiplyScalar(mesh.getWorldScale(new THREE.Vector3()).x);
    const p = mesh.localToWorld(center);
    const q = mesh.getWorldQuaternion(new THREE.Quaternion());
    const body = new Body({ mass: 1.8, position: v(p), linearDamping: 0.22, angularDamping: 0.38,
      sleepSpeedLimit: 0.3, sleepTimeLimit: 0.8, collisionFilterGroup: LOOSE, collisionFilterMask: TERRAIN | LOOSE });
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.velocity.copy(v(momentum)); body.angularVelocity.copy(v(spin));
    body.addShape(new Sphere(r));
    if (mesh.name !== 'head') body.addShape(new Sphere(r * 0.82), new Vec3(0, -0.14, 0));
    this.world.addBody(body);
    if (this.loose.length >= 16) this.removeLoose(0);
    this.loose.push({ age: 0, binding: { mesh, body, offset, name: 'hips' } });
  }

  private apply({ body, mesh, offset }: Binding) {
    if (!mesh.parent) return;
    this.rotation.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    this.position.set(body.position.x, body.position.y, body.position.z).sub(this.rotationOffset.copy(offset).applyQuaternion(this.rotation));
    mesh.position.copy(mesh.parent.worldToLocal(this.position));
    mesh.quaternion.copy(mesh.parent.getWorldQuaternion(this.parentRotation).invert().multiply(this.rotation));
    mesh.updateMatrix();
  }

  step(dt: number) {
    if (!this.dolls.size && !this.loose.length) { this.lastCount = 0; return; }
    this.world.step(1 / 90, Math.min(dt, 0.09), 8);
    this.lastCount = 0;
    for (const doll of this.dolls.values()) {
      doll.age += dt;
      this.lastCount += doll.parts.length;
      for (const part of doll.parts) this.apply(part);
      if (doll.parts.every(p => p.body.velocity.lengthSquared() < 0.055 && p.body.angularVelocity.lengthSquared() < 0.25)) doll.sleepTime += dt;
      else doll.sleepTime = 0;
      if (doll.age > 7 || doll.sleepTime > 0.95 && doll.age > 2) this.removeDoll(doll.root);
    }
    for (let i = this.loose.length - 1; i >= 0; i--) {
      this.loose[i].age += dt;
      this.apply(this.loose[i].binding);
      if (this.loose[i].age > 13) this.removeLoose(i);
    }
  }

  private removeLoose(i: number) {
    const part = this.loose[i].binding;
    this.world.removeBody(part.body);
    part.mesh.removeFromParent();
    this.loose.splice(i, 1);
  }

  removeDoll(root: THREE.Group) {
    const removed = this.dolls.get(root);
    if (!removed) return;
    removed.joints.forEach(j => this.world.removeConstraint(j));
    removed.parts.forEach(b => this.world.removeBody(b.body));
    this.dolls.delete(root);
  }

  clear() {
    this.dolls.forEach(d => this.removeDoll(d.root));
    while (this.loose.length) this.removeLoose(this.loose.length - 1);
  }
}