import * as THREE from 'three';
import type { Particles } from './particles';
import type { BodyPhysics } from './body-physics';
import type { Npc, PartName } from './npc';

/**
 * Gore — система расчленения и крови.
 *
 * Отдельный слой поверх Npc/particles/body-physics:
 *  · артериальные фонтаны, которые бьют импульсами после отсечения;
 *  · лужи крови, которые растекаются и подсыхают;
 *  · куски плоти, кости и зубы с физикой;
 *  · кровавый след за летящей конечностью;
 *  · комбо-счётчик и замедление времени на добивании.
 *
 * Всё в пулах с жёстким лимитом, поэтому система не течёт по памяти
 * и одинаково работает на телефоне и на ПК.
 */

const MAX_POOLS = 46;
const MAX_JETS = 22;
const MAX_TRAILS = 14;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler();

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(92,4,10,0.98)');
  g.addColorStop(0.55, 'rgba(74,3,9,0.82)');
  g.addColorStop(0.82, 'rgba(52,2,6,0.42)');
  g.addColorStop(1, 'rgba(40,2,4,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  // неровная кромка, чтобы лужа не выглядела кругом
  for (let i = 0; i <= 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 58 + Math.sin(a * 3.1) * 5 + Math.sin(a * 7.7) * 3.4;
    const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Pool {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  age: number;
  life: number;
  target: number;
  grow: number;
}

interface Jet {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
  life: number;
  power: number;
  acc: number;
}

interface Trail {
  obj: THREE.Object3D;
  t: number;
  acc: number;
}

const PART_RADIUS: Record<PartName, number> = {
  head: 0.115, torso: 0.2, armL: 0.062, armR: 0.062, foreL: 0.05, foreR: 0.05,
  thighL: 0.088, thighR: 0.088, shinL: 0.07, shinR: 0.07,
};

const PART_LABEL: Record<PartName, string> = {
  head: 'голова', torso: 'торс', armL: 'левая рука', armR: 'правая рука',
  foreL: 'левое предплечье', foreR: 'правое предплечье',
  thighL: 'левое бедро', thighR: 'правое бедро', shinL: 'левая голень', shinR: 'правая голень',
};

export class Gore {
  private pools: Pool[] = [];
  private poolCursor = 0;
  private jets: Jet[] = [];
  private trails: Trail[] = [];
  private decalAcc = 0;

  /** Кровавая пелена на экране 0..1 (для HUD). */
  screenBlood = 0;
  /** Текущее комбо добиваний. */
  combo = 0;
  comboTimer = 0;
  comboWindow = 3.6;
  bestCombo = 0;

  /** Множитель времени: замедление на добивании и hit-stop. */
  timeScale = 1;
  private slowTimer = 0;
  private slowTarget = 1;
  private stopTimer = 0;
  private killCamTimer = 0;
  killCam = 0;

  severed = 0;
  private lastSeverT = 0;

  constructor(
    private scene: THREE.Scene,
    private particles: Particles,
    private physics: BodyPhysics,
    private groundAt: (x: number, z: number) => number,
    private quality: 'low' | 'high' | 'ultra' = 'high',
  ) {
    const tex = poolTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const budget = quality === 'low' ? 18 : quality === 'high' ? 34 : MAX_POOLS;
    for (let i = 0; i < budget; i++) {
      const mat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, opacity: 0, roughness: 0.18, metalness: 0.12,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.pools.push({ mesh, mat, age: 0, life: 0, target: 1, grow: 0 });
    }
  }

  /* ── кровь ─────────────────────────────────────────────────────────── */

  /** Фонтан из перерезанного сосуда: бьёт импульсами по направлению удара. */
  jet(pos: THREE.Vector3, dir: THREE.Vector3, power = 1) {
    if (this.jets.length >= MAX_JETS) this.jets.shift();
    if (power < 0.12) return;
    this.jets.push({
      pos: pos.clone(),
      dir: dir.clone().normalize(),
      t: 0,
      life: 0.9 + 1.4 * Math.min(1, power),
      power: Math.min(1.6, power),
      acc: 0,
    });
    if (this.quality !== 'low') this.particles.bloodMist(pos, dir, Math.min(1, power));
  }

  /** Лужа: растекается и медленно темнеет. */
  pool(pos: THREE.Vector3, size = 1) {
    const p = this.pools[this.poolCursor];
    this.poolCursor = (this.poolCursor + 1) % this.pools.length;
    const y = this.groundAt(pos.x, pos.z);
    p.mesh.position.set(pos.x, y + 0.014 + Math.random() * 0.008, pos.z);
    p.mesh.scale.setScalar(0.12);
    p.mesh.visible = true;
    p.mat.opacity = 0.9;
    p.age = 0;
    p.life = 70;
    p.target = size * (0.75 + Math.random() * 0.55);
    p.grow = 0;
    _e.set(0, Math.random() * Math.PI * 2, 0);
    p.mesh.rotation.copy(_e);
  }

  /** Кровавый след в воздухе за летящей конечностью. */
  private trail(obj: THREE.Object3D) {
    if (this.trails.length >= MAX_TRAILS) this.trails.shift();
    this.trails.push({ obj, t: 0, acc: 0 });
  }

  /* ── расчленение ───────────────────────────────────────────────────── */

  /**
   * Отсекает часть тела: физика, фонтан, куски, лужа.
   * Возвращает объект конечности (уже в мировых координатах) или null.
   */
  sever(n: Npc, part: PartName, dir: THREE.Vector3, energy01: number, spray = 1): THREE.Object3D | null {
    const obj = n.dismember(part);
    if (!obj) return null;
    const world = obj.getWorldPosition(new THREE.Vector3());
    const stump = world.clone().addScaledVector(dir, -PART_RADIUS[part] * 0.9);

    this.scene.attach(obj);
    const vel = dir.clone().multiplyScalar(1.6 + 5.4 * energy01);
    vel.y += 1.1 + 2.4 * energy01;
    const spin = new THREE.Vector3(
      (Math.random() - 0.5) * 13, (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 13,
    );
    this.physics.fragment(obj, vel, spin, Math.min(0.13, PART_RADIUS[part]));
    this.trail(obj);

    // артерия
    this.jet(stump, dir, (part === 'head' ? 1.45 : part === 'torso' ? 1.3 : 0.95) * spray);
    // мелкие брызги по сторонам
    _v.copy(dir).multiplyScalar(-1);
    this.particles.bloodBurst(stump, _v, energy01, Math.round((part === 'head' ? 46 : 26) * spray));
    if (this.quality !== 'low') {
      _v2.set(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
      this.particles.goreChunks(stump, _v2, Math.min(1, energy01 + 0.25));
    }
    // лужа под местом удара
    this.pool(n.position(), 0.7 + (part === 'torso' ? 1.1 : part === 'head' ? 0.5 : 0.35));

    this.severed++;
    this.lastSeverT = 0;
    this.screenBlood = Math.min(1, this.screenBlood + 0.1 + energy01 * 0.18);
    if (part === 'head' || part === 'torso') this.hitStop(0.055 + 0.05 * energy01);
    return obj;
  }

  /** Тяжёлый удар без отсечения: брызги, лужа, пелена. */
  hit(pos: THREE.Vector3, dir: THREE.Vector3, energy01: number, depth: number, near: boolean, spray = 1, crush = 1) {
    // режущее лезвие даёт веер мелких брызг, дробящее — крупные тяжёлые капли и мясо
    this.particles.bloodBurst(pos, dir, energy01, Math.round((12 + 60 * depth) * spray));
    if (crush > 1.25) this.particles.goreChunks(pos, dir, Math.min(1, energy01 + 0.2));
    if (depth > 0.25 && Math.random() < 0.5) {
      _v.copy(pos); _v.y = 0;
      this.pool(_v, 0.25 + depth * 0.7);
    }
    if (near) this.screenBlood = Math.min(1, this.screenBlood + 0.06 + depth * 0.3);
  }

  /** Взрыв тела на куски: максимум эффекта. */
  explode(n: Npc, dir: THREE.Vector3, power = 1) {
    const center = n.position().clone().setY(n.position().y + 0.9);
    this.jet(center, dir, 1.5);
    for (let i = 0; i < 3; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      this.particles.goreChunks(center, _v, power);
    }
    this.particles.bloodBurst(center, dir, 1, 70);
    this.pool(n.position(), 1.6);
    this.screenBlood = Math.min(1, this.screenBlood + 0.35);
  }

  /* ── комбо и время ─────────────────────────────────────────────────── */

  /** Возвращает множитель за текущее комбо (1, 1.25, 1.5, 2…). */
  registerKill() {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = this.comboWindow;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    return this.comboMultiplier;
  }

  get comboMultiplier() {
    return 1 + Math.min(this.combo - 1, 12) * 0.25;
  }

  /** Полное замедление с плавным возвратом — «камера добивания». */
  slowmo(scale = 0.35, duration = 0.45) {
    if (this.quality === 'low') return;
    this.slowTarget = scale;
    this.slowTimer = duration;
    this.killCamTimer = Math.max(this.killCamTimer, duration);
  }

  /** Короткая заморозка кадра на тяжёлом попадании. */
  hitStop(duration = 0.07) {
    if (this.quality === 'low') return;
    this.stopTimer = Math.max(this.stopTimer, duration);
  }

  update(dt: number) {
    // время
    if (this.stopTimer > 0) {
      this.stopTimer -= dt;
      this.timeScale = 0.06;
    } else if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.timeScale += (this.slowTarget - this.timeScale) * Math.min(1, dt * 18);
    } else {
      this.slowTarget = 1;
      this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 7);
    }
    this.killCamTimer = Math.max(0, this.killCamTimer - dt);
    this.killCam = Math.min(1, this.killCamTimer * 2.4);

    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    this.screenBlood = Math.max(0, this.screenBlood - dt * 0.34);
    this.lastSeverT += dt;

    // фонтаны
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.t += dt;
      j.acc += dt;
      const k = j.t / j.life;
      if (k >= 1) { this.jets.splice(i, 1); continue; }
      // пульс: сердце бьётся всё реже
      const beat = 0.5 + 0.5 * Math.sin(j.t * (14 - 7 * k));
      const emitEvery = 0.055 + k * 0.14;
      while (j.acc > emitEvery) {
        j.acc -= emitEvery;
        _v.copy(j.dir).multiplyScalar(0.4 + Math.random() * 0.7);
        _v.y += 1.1 + Math.random() * 1.3;
        const px = j.pos.x + (Math.random() - 0.5) * 0.1;
        const py = j.pos.y + (Math.random() - 0.5) * 0.1;
        const pz = j.pos.z + (Math.random() - 0.5) * 0.1;
        _v2.set(px, py, pz);
        this.particles.bloodBurst(_v2, _v, (1 - k) * j.power * (0.35 + beat * 0.65), 5);
      }
    }

    // лужи
    for (const p of this.pools) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const grow = Math.min(1, p.age / 2.1);
      p.grow = grow;
      p.mesh.scale.setScalar(0.12 + (p.target - 0.12) * (1 - Math.pow(1 - grow, 2.4)));
      if (p.age > p.life * 0.45) p.mat.opacity = Math.max(0, 0.9 * (1 - (p.age - p.life * 0.45) / (p.life * 0.55)));
      if (p.age >= p.life) { p.mesh.visible = false; p.mat.opacity = 0; }
    }

    // кровавый след за летящей конечностью
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.t += dt;
      t.acc += dt;
      if (!t.obj.parent || t.t > 3) { this.trails.splice(i, 1); continue; }
      if (t.acc > 0.07) {
        t.acc = 0;
        t.obj.getWorldPosition(_v);
        _v.y += 0.02;
        this.decalAcc++;
        if (this.decalAcc % 2 === 0) this.particles.addDecal(_v, 0.1 + Math.random() * 0.16);
      }
    }
  }

  /** Подпись отрубленной части для журнала. */
  label(part: PartName) { return PART_LABEL[part]; }

  reset() {
    this.combo = 0;
    this.comboTimer = 0;
    this.screenBlood = 0;
    this.severed = 0;
    this.timeScale = 1;
    this.jets.length = 0;
    this.trails.length = 0;
    for (const p of this.pools) { p.mesh.visible = false; p.age = 0; p.mat.opacity = 0; }
  }
}
