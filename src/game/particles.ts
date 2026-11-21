import * as THREE from 'three';

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  rot: THREE.Vector3;
  rotV: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class InstancedPool {
  mesh: THREE.InstancedMesh;
  ps: P[] = [];
  cursor = 0;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public count: number, public gravity: number, public drag: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    for (let i = 0; i < count; i++) {
      this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, rot: new THREE.Vector3(), rotV: new THREE.Vector3() });
      this.mesh.setMatrixAt(i, ZERO);
    }
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number) {
    const p = this.ps[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = 0;
    p.maxLife = life;
    p.size = size;
    p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.rotV.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
    return p;
  }
  update(dt: number, onGround?: (p: P) => void, shape?: (p: P, s: THREE.Vector3) => void) {
    const dr = Math.exp(-this.drag * dt);
    let visible = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      p.life += dt;
      p.vel.y -= this.gravity * dt;
      p.vel.multiplyScalar(dr);
      p.pos.addScaledVector(p.vel, dt);
      p.rot.addScaledVector(p.rotV, dt);
      if (p.pos.y <= 0.015 && p.vel.y < 0) {
        if (onGround) onGround(p);
        p.alive = false;
      }
      if (p.life >= p.maxLife) p.alive = false;
      if (!p.alive) continue;
      _e.set(p.rot.x, p.rot.y, p.rot.z);
      _q.setFromEuler(_e);
      _s.setScalar(p.size);
      if (shape) shape(p, _s);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(visible++, _m);
    }
    this.mesh.count = visible;
    if (visible) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Капля крови: маленькое тело с хвостом по направлению полёта.
 * Рисуем в белом — цвет задаёт материал.
 */
function dropletTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 32, 64);
  // хвост-струйка сверху
  const g = ctx.createLinearGradient(0, 0, 0, 44);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0.85)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.lineTo(20.5, 34);
  ctx.lineTo(11.5, 34);
  ctx.closePath();
  ctx.fill();
  // тело капли
  ctx.beginPath();
  ctx.ellipse(16, 45, 9, 12, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill();
  // мягкий край
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Мягкое облачко аэрозоля крови. */
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.34)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function splatterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  const blob = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(70,0,6,${a})`);
    g.addColorStop(0.6, `rgba(46,0,4,${a * 0.85})`);
    g.addColorStop(1, 'rgba(30,0,2,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  blob(64, 64, 30, 0.95);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * 44;
    blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + Math.random() * 12, 0.75);
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 30 + Math.random() * 55;
    ctx.fillStyle = `rgba(58,0,5,${0.35 + Math.random() * 0.5})`;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0.7 + Math.random() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _qz = new THREE.Quaternion();
const _qv = new THREE.Quaternion();
const _inv = new THREE.Quaternion();
const _vel = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Пул плоских капель, всегда развёрнутых к камере. В отличие от шариков
 * настоящая кровь в полёте — это струйки: капля вытягивается вдоль вектора
 * скорости, поэтому брызги читаются как брызги, а не как шарики из краски.
 */
class BillboardPool {
  mesh: THREE.InstancedMesh;
  ps: P[] = [];
  cursor = 0;
  constructor(tex: THREE.Texture, color: number, public count: number, public gravity: number, public drag: number, opacity: number) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color, transparent: true, opacity, depthWrite: false,
      blending: THREE.NormalBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < count; i++) {
      this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, rot: new THREE.Vector3(), rotV: new THREE.Vector3() });
      this.mesh.setMatrixAt(i, ZERO);
    }
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number) {
    const p = this.ps[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    p.alive = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = 0;
    p.maxLife = life;
    p.size = size;
    return p;
  }
  update(dt: number, cam: THREE.Quaternion, onGround?: (p: P) => void, grow = 0) {
    const dr = Math.exp(-this.drag * dt);
    _inv.copy(cam).invert();
    let visible = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      p.life += dt;
      p.vel.y -= this.gravity * dt;
      p.vel.multiplyScalar(dr);
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y <= 0.012 && p.vel.y < 0) {
        if (onGround) onGround(p);
        p.alive = false;
        continue;
      }
      if (p.life >= p.maxLife) { p.alive = false; continue; }
      // скорость в системе камеры даёт направление вытягивания на экране
      _vel.copy(p.vel).applyQuaternion(_inv);
      const sx = _vel.x, sy = _vel.y;
      const speed = Math.hypot(sx, sy);
      const ang = (sx === 0 && sy === 0) ? 0 : -Math.atan2(sx, sy);
      _qz.setFromAxisAngle(Z_AXIS, ang);
      _qv.copy(cam).multiply(_qz);
      const stretch = grow ? 1 + grow * (p.life / p.maxLife) * 4 : 1 + Math.min(2.4, speed * 0.16);
      _s.set(p.size, p.size * stretch, 1);
      _m.compose(p.pos, _qv, _s);
      this.mesh.setMatrixAt(visible++, _m);
    }
    this.mesh.count = visible;
    if (visible) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  blood: BillboardPool;
  mist: BillboardPool;
  chunks: InstancedPool;
  chips: InstancedPool;
  sparks: InstancedPool;
  decals: THREE.InstancedMesh;
  decalCursor = 0;
  decalCount = 320;
  group = new THREE.Group();
  dust: InstancedPool;

  constructor(scene: THREE.Scene, detail = 1) {
    // Кровь — плоские капли-струйки, а не шарики: дешевле в 4 раза по вершинам
    // и вблизи выглядит как настоящие брызги.
    this.blood = new BillboardPool(dropletTexture(), 0x8d0b13, Math.round(900 * detail), 9.8, 0.55, 0.92);

    // аэрозоль крови — мягкие облачка, быстро оседают
    this.mist = new BillboardPool(puffTexture(), 0x5d060d, Math.round(360 * detail), 1.1, 2.6, 0.3);

    // куски плоти/мяса
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x5c0d12, roughness: 0.55 });
    this.chunks = new InstancedPool(new THREE.IcosahedronGeometry(1, 0), chunkMat, 90, 9.8, 0.5);

    const chipMat = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.9 });
    this.chips = new InstancedPool(new THREE.BoxGeometry(1, 0.35, 0.2), chipMat, 150, 9.8, 0.8);

    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparks = new InstancedPool(new THREE.BoxGeometry(1, 0.15, 0.15), sparkMat, 120, 9.8, 1.2);

    const dustMat = new THREE.MeshBasicMaterial({ color: 0x8a8278, transparent: true, opacity: 0.25, depthWrite: false });
    this.dust = new InstancedPool(new THREE.SphereGeometry(1, 6, 5), dustMat, 120, -0.3, 2.5);

    const decalGeo = new THREE.PlaneGeometry(1, 1);
    decalGeo.rotateX(-Math.PI / 2);
    const decalMat = new THREE.MeshStandardMaterial({
      map: splatterTexture(), color: 0xffffff, roughness: 0.28, transparent: true, opacity: 0.95,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false,
    });
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, this.decalCount);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    for (let i = 0; i < this.decalCount; i++) this.decals.setMatrixAt(i, ZERO);
    this.decals.receiveShadow = true;

    this.group.add(this.blood.mesh, this.mist.mesh, this.chunks.mesh, this.chips.mesh, this.sparks.mesh, this.dust.mesh, this.decals);
    scene.add(this.group);
  }

  addDecal(pos: THREE.Vector3, size: number) {
    const i = this.decalCursor;
    this.decalCursor = (this.decalCursor + 1) % this.decalCount;
    _e.set(0, Math.random() * 6.28, 0);
    _q.setFromEuler(_e);
    _s.set(size * (0.6 + Math.random() * 0.8), 1, size * (0.6 + Math.random() * 0.8));
    _m.compose(new THREE.Vector3(pos.x, 0.012 + i * 0.00002, pos.z), _q, _s);
    this.decals.setMatrixAt(i, _m);
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  // Брызги крови: направление удара + конус разлёта, количество от энергии
  bloodBurst(pos: THREE.Vector3, dir: THREE.Vector3, energy01: number, count = 40) {
    // Артериальный фонтан при сильном ударе: много мелкой взвеси + несколько
    // длинных струй. Крупных «шаров крови» больше нет.
    const n = Math.floor(count * (0.55 + energy01 * 1.1));
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 2, (Math.random() - 0.35) * 2, (Math.random() - 0.5) * 2).normalize();
      v.lerp(dir, 0.5 + Math.random() * 0.35).normalize();
      const stream = i % 9 === 0; // редкие длинные струи
      const sp = (stream ? 7 + Math.random() * 5 : 1.4 + Math.random() * 4.2) * (0.55 + energy01);
      v.multiplyScalar(sp);
      v.y += 0.4 + Math.random() * 1.3 + energy01 * 0.4;
      const size = stream ? 0.009 + Math.random() * 0.006 : 0.004 + Math.random() * 0.011;
      this.blood.spawn(pos, v, 0.75 + Math.random() * 0.9, size * (0.8 + energy01 * 0.5));
    }
  }

  // туман и брызги при сильном попадании
  bloodMist(pos: THREE.Vector3, dir: THREE.Vector3, energy01: number) {
    const n = Math.floor(8 + 26 * energy01);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 1.6, (Math.random() - 0.5) * 2).normalize();
      v.lerp(dir, 0.4).normalize().multiplyScalar(0.5 + Math.random() * 2.8 * (0.4 + energy01));
      this.mist.spawn(pos, v, 0.28 + Math.random() * 0.42, 0.012 + Math.random() * 0.03);
    }
  }

  // куски мяса
  goreChunks(pos: THREE.Vector3, dir: THREE.Vector3, energy01: number) {
    const n = Math.floor(2 + 8 * energy01);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).normalize();
      v.lerp(dir, 0.5).normalize().multiplyScalar(2 + Math.random() * 6);
      v.y += 1.2;
      this.chunks.spawn(pos, v, 2.5 + Math.random() * 2, 0.018 + Math.random() * 0.035);
    }
  }

  // брызга на поверхности (стена/тело)
  splat(pos: THREE.Vector3, normal: THREE.Vector3, size: number) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: splatterTexture(), transparent: true, opacity: 0.9, roughness: 0.35,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      })
    );
    m.position.copy(pos).addScaledVector(normal, 0.012);
    m.lookAt(pos.clone().add(normal));
    this.group.add(m);
    setTimeout(() => {
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
      m.geometry.dispose();
    }, 9000);
  }

  bloodDrip(pos: THREE.Vector3) {
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.35, -0.4, (Math.random() - 0.5) * 0.35);
    this.blood.spawn(pos, v, 1.4, 0.005 + Math.random() * 0.008);
  }

  woodChips(pos: THREE.Vector3, dir: THREE.Vector3, energy01: number) {
    const n = Math.floor(6 + 18 * energy01);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).normalize();
      v.addScaledVector(dir, -0.6 - Math.random()).normalize().multiplyScalar(1.5 + Math.random() * 4);
      this.chips.spawn(pos, v, 1.5 + Math.random(), 0.02 + Math.random() * 0.05);
    }
  }

  sparkBurst(pos: THREE.Vector3, dir: THREE.Vector3, energy01: number) {
    const n = Math.floor(8 + 20 * energy01);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2).normalize();
      v.addScaledVector(dir, -1 - Math.random() * 2).normalize().multiplyScalar(2 + Math.random() * 6);
      this.sparks.spawn(pos, v, 0.15 + Math.random() * 0.35, 0.02 + Math.random() * 0.04);
    }
    for (let i = 0; i < 4; i++) {
      v.set((Math.random() - 0.5), Math.random() * 0.5 + 0.2, (Math.random() - 0.5)).multiplyScalar(0.8);
      this.dust.spawn(pos, v, 0.8 + Math.random() * 0.5, 0.05 + Math.random() * 0.08);
    }
  }

  dustPuff(pos: THREE.Vector3, amount: number) {
    const v = new THREE.Vector3();
    for (let i = 0; i < amount; i++) {
      v.set((Math.random() - 0.5), Math.random() * 0.6 + 0.2, (Math.random() - 0.5)).multiplyScalar(1.2);
      this.dust.spawn(pos, v, 1 + Math.random() * 0.8, 0.08 + Math.random() * 0.15);
    }
  }

  update(dt: number, cam = new THREE.Quaternion()) {
    this.mist.update(dt, cam, (p) => this.addDecal(p.pos, 0.06 + p.size * 4), 1.6);
    this.chunks.update(dt);
    this.blood.update(dt, cam, (p) => this.addDecal(p.pos, 0.04 + p.size * 5));
    this.chips.update(dt);
    this.sparks.update(dt, undefined, (p, s) => {
      const k = 1 - p.life / p.maxLife;
      s.set(p.size * (1 + p.vel.length() * 0.3), p.size * 0.6 * k, p.size * 0.6 * k);
    });
    this.dust.update(dt, undefined, (p, s) => {
      const k = p.life / p.maxLife;
      s.setScalar(p.size * (1 + k * 2.5));
    });
  }
}
