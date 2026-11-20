import * as THREE from 'three';

/**
 * Ballistics — материальная часть стрельбы.
 *
 *  · пулевые отверстия с трещинами (инстансы, затухают через минуту);
 *  · гильзы: вылетают, крутятся, скачут по асфальту и исчезают;
 *  · вспышка у дула — короткий источник света и спрайт;
 *  · брызги пыли/искр зависят от материала поверхности.
 *
 * Всё в двух InstancedMesh и одном PointLight, поэтому стоит почти ничего.
 */

const MAX_HOLES = 260;
const MAX_CASINGS = 90;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function holeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0, 'rgba(6,5,5,1)');
  g.addColorStop(0.34, 'rgba(16,14,13,0.95)');
  g.addColorStop(0.62, 'rgba(40,36,32,0.55)');
  g.addColorStop(1, 'rgba(60,54,48,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  // трещины
  ctx.strokeStyle = 'rgba(22,20,18,0.5)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.random();
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
    ctx.lineTo(32 + Math.cos(a + 0.3) * 16, 32 + Math.sin(a + 0.3) * 16);
    ctx.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type Surface = 'wall' | 'ground' | 'metal' | 'glass' | 'wood';

interface Casing {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  life: number;
  bounces: number;
  active: boolean;
}

export class Ballistics {
  private holes: THREE.InstancedMesh;
  private holeAge: number[] = [];
  private casings: THREE.InstancedMesh;
  private casingState: Casing[] = [];
  private cursor = 0;
  private casingCursor = 0;
  private light: THREE.PointLight;
  private flashSprite: THREE.Sprite;
  private flash = 0;
  private flashTime = 0;

  constructor(scene: THREE.Scene, private groundAt: (x: number, z: number) => number, quality: 'low' | 'high' | 'ultra') {
    const holeCount = quality === 'low' ? 90 : MAX_HOLES;
    const holeMat = new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, opacity: 0.95, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide,
    });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, holeCount);
    this.holes.frustumCulled = false;
    this.holes.count = holeCount;
    for (let i = 0; i < holeCount; i++) { this.holes.setMatrixAt(i, ZERO); this.holeAge.push(1e9); }
    this.holes.instanceMatrix.needsUpdate = true;
    scene.add(this.holes);

    const casingCount = quality === 'low' ? 30 : MAX_CASINGS;
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xc9a34a, metalness: 0.85, roughness: 0.35 });
    this.casings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.012, 0.032, 6), casingMat, casingCount);
    this.casings.frustumCulled = false;
    this.casings.count = casingCount;
    for (let i = 0; i < casingCount; i++) {
      this.casings.setMatrixAt(i, ZERO);
      this.casingState.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), rot: new THREE.Euler(), life: 0, bounces: 0, active: false });
    }
    this.casings.instanceMatrix.needsUpdate = true;
    scene.add(this.casings);

    this.light = new THREE.PointLight(0xffcf8a, 0, 16, 1.8);
    scene.add(this.light);

    const flashTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,246,214,1)');
      g.addColorStop(0.3, 'rgba(255,204,120,0.7)');
      g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
    }));
    this.flashSprite.scale.setScalar(0.9);
    scene.add(this.flashSprite);
  }

  /** Пулевое отверстие на поверхности. */
  hole(pos: THREE.Vector3, normal: THREE.Vector3, size = 0.11, surface: Surface = 'wall') {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.holeAge.length;
    _n.copy(normal).normalize();
    // поворачиваем плоскость по нормали
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n);
    _e.set(Math.random() * 0.4 - 0.2, Math.random() * 0.4 - 0.2, 0);
    _q.multiply(new THREE.Quaternion().setFromEuler(_e));
    const k = surface === 'glass' ? 1.9 : surface === 'metal' ? 0.75 : 1;
    _s.set(size * k, size * k, 1);
    _p.copy(pos).addScaledVector(_n, 0.012 + Math.random() * 0.006);
    _m.compose(_p, _q, _s);
    this.holes.setMatrixAt(i, _m);
    this.holes.instanceMatrix.needsUpdate = true;
    this.holeAge[i] = 0;
  }

  /** Гильза из затвора. */
  casing(pos: THREE.Vector3, dir: THREE.Vector3) {
    const i = this.casingCursor;
    this.casingCursor = (this.casingCursor + 1) % this.casingState.length;
    const c = this.casingState[i];
    c.active = true;
    c.life = 5.5;
    c.bounces = 0;
    c.pos.copy(pos);
    c.vel.set(
      dir.x * 1.4 + (Math.random() - 0.5) * 1.6,
      2.2 + Math.random() * 1.4,
      dir.z * 1.4 + (Math.random() - 0.5) * 1.6,
    );
    c.spin.set((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 26);
    c.rot.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  }

  /** Вспышка выстрела: источник света на 40 мс и спрайт. */
  muzzle(pos: THREE.Vector3, power = 1) {
    this.light.position.copy(pos);
    this.light.intensity = 26 * power;
    this.flash = 1;
    this.flashTime = 0;
    this.flashSprite.position.copy(pos);
    (this.flashSprite.material as THREE.SpriteMaterial).opacity = 0.85 * power;
    this.flashSprite.scale.setScalar(0.7 + power * 0.5);
  }

  /** Брызги материала при попадании. */
  impact(surface: Surface, pos: THREE.Vector3, normal: THREE.Vector3, sparks: (p: THREE.Vector3, d: THREE.Vector3, e: number) => void, dust: (p: THREE.Vector3, n: number) => void) {
    this.hole(pos, normal, surface === 'wood' ? 0.13 : 0.105, surface);
    if (surface === 'metal') { sparks(pos, normal, 0.5); dust(pos, 1); }
    else if (surface === 'glass') { sparks(pos, normal, 0.8); }
    else if (surface === 'wood') { dust(pos, 1); }
    else dust(pos, 1);
  }

  update(dt: number) {
    // затухание отверстий
    let dirty = false;
    for (let i = 0; i < this.holeAge.length; i++) {
      if (this.holeAge[i] > 70) continue;
      this.holeAge[i] += dt;
      if (this.holeAge[i] > 70) { this.holes.setMatrixAt(i, ZERO); dirty = true; }
    }
    if (dirty) this.holes.instanceMatrix.needsUpdate = true;

    // гильзы
    let moving = false;
    for (let i = 0; i < this.casingState.length; i++) {
      const c = this.casingState[i];
      if (!c.active) continue;
      moving = true;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        this.casings.setMatrixAt(i, ZERO);
        continue;
      }
      c.vel.y -= 19 * dt;
      c.pos.addScaledVector(c.vel, dt);
      const ground = this.groundAt(c.pos.x, c.pos.z) + 0.02;
      if (c.pos.y < ground) {
        c.pos.y = ground;
        c.vel.y = Math.abs(c.vel.y) * 0.32;
        c.vel.x *= 0.55; c.vel.z *= 0.55;
        c.spin.multiplyScalar(0.4);
        c.bounces++;
        if (c.bounces > 4) { c.vel.set(0, 0, 0); c.spin.set(0, 0, 0); }
      }
      c.rot.x += c.spin.x * dt;
      c.rot.y += c.spin.y * dt;
      c.rot.z += c.spin.z * dt;
      _q.setFromEuler(c.rot);
      const s = Math.max(0.01, Math.min(1, c.life / 1.2));
      _m.compose(c.pos, _q, _s.set(s, s, s));
      this.casings.setMatrixAt(i, _m);
    }
    if (moving) this.casings.instanceMatrix.needsUpdate = true;

    // вспышка
    this.flashTime += dt;
    if (this.flash > 0) {
      this.flash = Math.max(0, 1 - this.flashTime / 0.075);
      this.light.intensity = 26 * this.flash;
      (this.flashSprite.material as THREE.SpriteMaterial).opacity = 0.85 * this.flash;
    } else {
      this.light.intensity = 0;
      (this.flashSprite.material as THREE.SpriteMaterial).opacity = 0;
    }
  }
}
