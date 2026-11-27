import * as THREE from 'three';
import type { Car } from './vehicle';
import type { Npc } from './npc';

interface Fire {
  pos: THREE.Vector3;
  car?: Car;
  life: number;
  intensity: number;
  seed: number;
}

function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(48, 48, 3, 48, 48, 46);
  g.addColorStop(0, 'rgba(46,40,35,.9)');
  g.addColorStop(0.55, 'rgba(38,35,32,.5)');
  g.addColorStop(1, 'rgba(28,26,24,0)');
  x.fillStyle = g; x.fillRect(0, 0, 96, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * Fires live independently of traffic so burning vehicles keep burning even
 * when their driver flees. The system is pooled and mobile friendly.
 */
export class Emergencies {
  fires: Fire[] = [];
  private group = new THREE.Group();
  private flameGeo: THREE.ConeGeometry;
  private flameMat: THREE.MeshBasicMaterial;
  private flames: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private smokeGeo: THREE.BufferGeometry;
  private smokePos: Float32Array;
  private smoke: THREE.Points;
  private emberPos: Float32Array;
  private embers: THREE.Points;
  private lights: THREE.PointLight[];
  private time = 0;
  private flash: THREE.PointLight;
  private ring: THREE.Mesh;
  private fxTimer = 0;
  private smokeCursor = 0;
  private emberCursor = 0;
  dispatchText = '';
  dispatchTimer = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const cone = new THREE.ConeGeometry(0.58, 1.9, 8, 3, true);
    const baked = new Float32Array(cone.attributes.position.count * 3);
    for (let i = 0; i < cone.attributes.position.count; i++) {
      const t = Math.max(0, Math.min(1, (cone.attributes.position.getY(i) + 0.95) / 1.9));
      const heat = Math.pow(1 - t, 1.55);
      baked[i * 3] = 1; baked[i * 3 + 1] = 0.27 + (1 - heat) * 0.6; baked[i * 3 + 2] = 0.06 + heat * 0.05;
    }
    cone.setAttribute('color', new THREE.BufferAttribute(baked, 3));
    this.flameGeo = cone;
    this.flameGeo.scale(1, 1, 1);
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa853, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.flames = new THREE.InstancedMesh(this.flameGeo, this.flameMat, 150);
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.frustumCulled = false;
    this.flames.count = 0;
    this.flames.renderOrder = 5;
    this.group.add(this.flames);
    this.glow = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff9a43, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false }), 60);
    this.glow.frustumCulled = false; this.glow.count = 0; this.group.add(this.glow);
    this.smokePos = new Float32Array(420 * 3);
    this.smokeGeo = new THREE.BufferGeometry();
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.smokeGeo.setDrawRange(0, 0);
    this.smoke = new THREE.Points(this.smokeGeo, new THREE.PointsMaterial({ map: smokeTexture(), transparent: true, opacity: 0.16, size: 1.35, sizeAttenuation: true, depthWrite: false, color: 0x4a443d }));
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
    this.emberPos = new Float32Array(160 * 3);
    const emberGeo = new THREE.BufferGeometry(); emberGeo.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3).setUsage(THREE.DynamicDrawUsage));
    emberGeo.setDrawRange(0, 0);
    this.embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({ color: 0xffb36b, size: 0.075, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.embers.frustumCulled = false;
    this.group.add(this.embers);
    this.lights = [0, 1].map(() => { const l = new THREE.PointLight(0xff7738, 0, 15, 1.8); scene.add(l); return l; });
    this.flash = new THREE.PointLight(0xffbe7a, 0, 26, 1.7);
    this.flash.visible = false; scene.add(this.flash);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.14, 32), new THREE.MeshBasicMaterial({ color: 0xffc699, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.visible = false; this.ring.renderOrder = 6; scene.add(this.ring);
  }

  ignite(pos: THREE.Vector3, car?: Car, intensity = 1) {
    if (car?.burned) return;
    const existing = car ? this.fires.find(f => f.car === car) : undefined;
    if (existing) { existing.intensity = Math.min(1.8, existing.intensity + intensity * 0.4); existing.life = Math.max(existing.life, 20); return existing; }
    const fire: Fire = { pos: pos.clone().setY(Math.max(0.35, pos.y + 0.55)), car, life: 20 + Math.random() * 8, intensity: Math.min(1.6, intensity), seed: Math.random() * 30 };
    this.fires.push(fire);
    this.setDispatch(fire, true);
    return fire;
  }

  private setDispatch(_fire: Fire, announce: boolean) {
    if (this.fires.length === 1 && announce) {
      this.dispatchText = 'Пожарная часть №4 выехала к месту возгорания';
      this.dispatchTimer = 7;
    }
  }

  extinguishNear(pos: THREE.Vector3, radius: number, amount = 0.65, dt = 0.016) {
    let n = 0;
    for (const f of this.fires) {
      if (f.pos.distanceTo(pos) > radius) continue;
      f.intensity -= amount * dt;
      if (f.intensity <= 0.04) { f.life = -1; n++; }
    }
    return n;
  }

  explosion(pos: THREE.Vector3) {
    this.fxTimer = 0.3;
    this.flash.position.copy(pos).setY(pos.y + 1.1);
    this.flash.intensity = 60; this.flash.visible = true;
    this.ring.position.copy(pos).setY(0.04);
    this.ring.scale.setScalar(0.2); this.ring.visible = true;
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.85;
    this.emberCursor = (this.emberCursor + 40) % 160;
  }

  update(dt: number, focus: THREE.Vector3, cars: Car[], npcs: Npc[], player: THREE.Vector3, particles: { dustPuff: (p: THREE.Vector3, n: number) => void; sparkBurst: (p: THREE.Vector3, d: THREE.Vector3, e: number) => void }) {
    this.time += dt;
    this.dispatchTimer = Math.max(0, this.dispatchTimer - dt);
    this.fires = this.fires.filter(f => {
      if (f.car) { f.pos.copy(f.car.pos).setY(f.car.pos.y + 0.6); f.intensity = Math.max(f.intensity, f.car.fire); }
      f.life -= dt; f.intensity -= dt * 0.028;
      return f.life > 0 && f.intensity > 0.03;
    });
    // fire spreads to adjacent vehicles and harms nearby pedestrians.
    for (const f of this.fires) {
      if (!f.car || Math.random() > dt * 0.08) continue;
      for (const c of cars) {
        if (c === f.car || c.exploded) continue;
        if (c.pos.distanceToSquared(f.car.pos) < 64) { c.fire = Math.max(c.fire, 0.25); this.ignite(c.pos, c, 0.35); }
      }
      for (const n of npcs) if (n.alive && n.position().distanceToSquared(f.car.pos) < 16) n.applyHit('torso', dt * 4.8, new THREE.Vector3(), 0.2);
    }
    let count = 0, glows = 0;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const scale = new THREE.Vector3();
    const flames = Math.min(150, this.fires.length * 8);
    this.flames.count = flames;
    this.glow.count = Math.min(60, this.fires.length * 3);
    for (const f of this.fires) {
      const dist = f.pos.distanceTo(focus);
      if (dist > 150) continue;
      for (let i = 0; i < 3 && glows < this.glow.count; i++) {
        const a = this.time * 2 + i * 2.1 + f.seed;
        scale.setScalar(1.2 + Math.sin(a) * 0.35);
        m.compose(f.pos.clone().add(new THREE.Vector3(Math.sin(a) * 0.32, 0.1, Math.cos(a) * 0.32)), new THREE.Quaternion(), scale);
        this.glow.setMatrixAt(glows++, m);
      }
      for (let i = 0; i < 10 && count < flames; i++) {
        const a = this.time * 4.1 + i * 2.4 + f.seed;
        const h = 0.55 + Math.abs(Math.sin(a * 1.7)) * 1.25 * f.intensity;
        scale.set(0.38 + Math.abs(Math.cos(a)) * 0.45, h, 0.38 + Math.abs(Math.sin(a * 0.7)) * 0.38);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
        m.compose(f.pos.clone().add(new THREE.Vector3(Math.sin(a) * 0.48, h * 0.42, Math.cos(a * 0.9) * 0.48)), q, scale);
        this.flames.setMatrixAt(count++, m);
      }
      if (Math.random() < dt * 0.75) {
        particles.dustPuff(f.pos.clone().setY(f.pos.y + 1.4), 1);
        const arr = this.smokePos, o = this.smokeCursor * 3;
        arr[o] = f.pos.x + (Math.random() - 0.5) * 0.7; arr[o + 1] = f.pos.y + 1.3 + Math.random(); arr[o + 2] = f.pos.z + (Math.random() - 0.5) * 0.7;
        this.smokeCursor = (this.smokeCursor + 1) % 420;
        this.smokeGeo.setDrawRange(0, 420);
        (this.smokeGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    }
    this.flames.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.lights.forEach((l, i) => {
      const f = this.fires[i];
      l.visible = !!f;
      if (f) { l.position.copy(f.pos).setY(f.pos.y + 1.5); l.intensity = 24 * f.intensity; }
    });
    if (this.lights[0] && !this.fires[0]) this.lights[0].intensity = 0;
    if (this.lights[1] && !this.fires[1]) this.lights[1].intensity = 0;
    if (this.fxTimer > 0) {
      this.fxTimer -= dt;
      const k = Math.min(1, this.fxTimer / 0.34);
      this.flash.intensity = 60 * k;
      this.ring.scale.setScalar(0.7 + (1 - k) * 11);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = k * 0.32;
      if (this.fxTimer <= 0) { this.flash.visible = false; this.ring.visible = false; }
    }
    void player;
  }

  get burningCount() { return this.fires.length; }
}
