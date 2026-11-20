import * as THREE from 'three';
import type { Particles } from './particles';

/**
 * VehicleFx — следы шин, дым, выхлоп, пламя, стёкла и отваливающиеся колёса.
 * Один InstancedMesh на все следы и пул спрайтов на дым:
 * стоимость фиксирована, сколько бы машин ни ездило по городу.
 */

const MAX_SKIDS = 420;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

interface Skid { age: number; life: number }

export class VehicleFx {
  private skids: THREE.InstancedMesh;
  private skidState: Skid[] = [];
  private cursor = 0;
  private smoke: { s: THREE.Sprite; age: number; life: number; vel: THREE.Vector3; grow: number }[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, private particles: Particles, quality: 'low' | 'high' | 'ultra') {
    const geo = new THREE.PlaneGeometry(0.34, 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0e0f10, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    const count = quality === 'low' ? 160 : MAX_SKIDS;
    this.skids = new THREE.InstancedMesh(geo, mat, count);
    this.skids.frustumCulled = false;
    this.skids.count = count;
    for (let i = 0; i < count; i++) {
      this.skids.setMatrixAt(i, ZERO);
      this.skidState.push({ age: 1e9, life: 1 });
    }
    this.skids.instanceMatrix.needsUpdate = true;
    scene.add(this.skids);

    const smokeTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(220,220,215,0.55)');
      g.addColorStop(1, 'rgba(200,200,195,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const smokeCount = quality === 'low' ? 14 : 34;
    for (let i = 0; i < smokeCount; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.smoke.push({ s, age: 0, life: 0, vel: new THREE.Vector3(), grow: 1 });
    }
  }

  /** След шины: ставится под колесом, живёт 14 секунд. */
  skid(pos: THREE.Vector3, yaw: number, groundY: number, strength: number) {
    if (strength < 0.12) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.skidState.length;
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _s.set(1, 1, 0.7 + strength * 0.7);
    _p.set(pos.x, groundY + 0.014, pos.z);
    _m.compose(_p, _q, _s);
    this.skids.setMatrixAt(i, _m);
    this.skids.instanceMatrix.needsUpdate = true;
    this.skidState[i] = { age: 0, life: 14 };
  }

  /** Дым из-под колёс / из-под капота. */
  puffs(pos: THREE.Vector3, amount = 1, dark = false) {
    for (let k = 0; k < amount; k++) {
      const slot = this.smoke.find(s => !s.s.visible) ?? this.smoke[0];
      slot.s.visible = true;
      slot.age = 0;
      slot.life = 1.1 + Math.random() * 1.2;
      slot.grow = 1.6 + Math.random() * 1.6;
      slot.vel.set((Math.random() - 0.5) * 1.2, 0.7 + Math.random() * 0.9, (Math.random() - 0.5) * 1.2);
      slot.s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5));
      slot.s.scale.setScalar(0.5);
      (slot.s.material as THREE.SpriteMaterial).color.setHex(dark ? 0x3a3a3a : 0xd8d8d2);
      (slot.s.material as THREE.SpriteMaterial).opacity = 0.5;
    }
  }

  /** Выхлоп: короткий тёмный пуф из глушителя. */
  exhaust(pos: THREE.Vector3, dir: THREE.Vector3, throttle: number) {
    if (Math.random() > 0.25 + throttle * 0.5) return;
    this.puffs(pos.clone().addScaledVector(dir, -0.2), 1, true);
    if (throttle > 0.85 && Math.random() < 0.35) {
      this.particles.dustPuff(pos.clone().addScaledVector(dir, -0.4), 1);
    }
  }

  /** Дым/огонь из-под капота при повреждении. */
  damageSmoke(pos: THREE.Vector3, damage01: number, burning: boolean) {
    if (Math.random() > 0.14 + damage01 * 0.5) return;
    this.puffs(pos, burning ? 2 : 1, !burning);
    if (burning && Math.random() < 0.5) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.4, (Math.random() - 0.5) * 0.6);
      this.particles.sparkBurst(pos, v, 0.7);
    }
  }

  /** Стёкла и искры при ударе. */
  impact(pos: THREE.Vector3, normal: THREE.Vector3, power: number) {
    this.particles.sparkBurst(pos, normal, Math.min(1, power));
    if (power > 0.4) this.particles.dustPuff(pos, 1);
  }

  update(dt: number, night: number) {
    this.time += dt;
    // затухание следов
    let dirty = false;
    for (let i = 0; i < this.skidState.length; i++) {
      const st = this.skidState[i];
      if (st.age > st.life) continue;
      st.age += dt;
      if (st.age > st.life) {
        this.skids.setMatrixAt(i, ZERO);
        dirty = true;
      }
    }
    if (dirty) this.skids.instanceMatrix.needsUpdate = true;
    (this.skids.material as THREE.MeshBasicMaterial).opacity = 0.22 + night * 0.3;

    for (const s of this.smoke) {
      if (!s.s.visible) continue;
      s.age += dt;
      const k = s.age / s.life;
      if (k >= 1) { s.s.visible = false; (s.s.material as THREE.SpriteMaterial).opacity = 0; continue; }
      s.s.position.addScaledVector(s.vel, dt);
      s.s.scale.setScalar(0.45 + k * s.grow);
      (s.s.material as THREE.SpriteMaterial).opacity = (1 - k) * 0.42;
    }
  }
}
