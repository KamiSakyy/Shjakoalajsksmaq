import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Воздушная и бронетанковая поддержка полиции.
 * 4 звезды — вертолёт с прожектором и стрелком, 5 звёзд — танк с пушкой.
 * Обе машины можно подбить: вертолёт падает и взрывается, танк детонирует.
 */

export interface AirContext {
  playerPos: THREE.Vector3;
  wanted: number;
  blocked: (x: number, z: number) => boolean;
  onShoot: (from: THREE.Vector3, dir: THREE.Vector3) => void;
  onExplosion: (pos: THREE.Vector3, radius: number, power: number) => void;
  onLog: (text: string) => void;
  surfaceAt: (x: number, z: number) => number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Vector3();

function segSphere(p0: THREE.Vector3, p1: THREE.Vector3, c: THREE.Vector3, r: number, out: THREE.Vector3) {
  const d = _v.subVectors(p1, p0);
  const len2 = d.lengthSq();
  if (len2 < 1e-8) return p0.distanceToSquared(c) <= r * r;
  let t = _v2.subVectors(c, p0).dot(d) / len2;
  t = Math.max(0, Math.min(1, t));
  out.copy(p0).addScaledVector(d, t);
  return out.distanceToSquared(c) <= r * r;
}

export class Helicopter {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  hp = 260;
  maxHp = 260;
  dead = false;
  private phase = Math.random() * 6.28;
  private rotor: THREE.Group;
  private tailRotor: THREE.Group;
  private strobe: THREE.Mesh;
  private search: THREE.SpotLight;
  private cone: THREE.Mesh;
  private fireT = 2.2;
  private burst = 0;
  private deathT = 0;
  private orbit = 34;

  constructor(scene: THREE.Scene) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x141a1e, roughness: 0.45, metalness: 0.55 });
    const dark2 = new THREE.MeshStandardMaterial({ color: 0x1e2a30, roughness: 0.6, metalness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2b4653, roughness: 0.08, metalness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.9, 5.4), dark);
    body.position.y = 0;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 8), dark);
    nose.scale.set(1, 0.86, 1.5);
    nose.position.z = 2.4;
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 2.2), glass);
    cockpit.position.set(0, 0.45, 1.8);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.6), dark2);
    boom.position.set(0, 0.25, -4.4);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 1.3), dark);
    fin.position.set(0, 1.0, -6.3);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.7), dark);
    stab.position.set(0, 0.4, -5.6);
    this.rotor = new THREE.Group();
    this.rotor.position.set(0, 1.35, 0);
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.1, 0.44), dark2);
      blade.rotation.y = i * Math.PI / 2;
      this.rotor.add(blade);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 8), dark2);
    mast.position.y = 1.1;
    this.tailRotor = new THREE.Group();
    this.tailRotor.position.set(0.4, 1.0, -6.3);
    const tailBlade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.24), dark2);
    this.tailRotor.add(tailBlade);
    const skidGeos: THREE.BufferGeometry[] = [];
    for (const x of [-1.1, 1.1]) {
      const skid = new THREE.BoxGeometry(0.16, 0.16, 4.4);
      skid.translate(x, -1.35, 0.3);
      skidGeos.push(skid);
      for (const z of [-1.2, 1.4]) {
        const strut = new THREE.BoxGeometry(0.14, 0.8, 0.14);
        strut.translate(x, -1.0, z);
        skidGeos.push(strut);
      }
    }
    const skids = new THREE.Mesh(mergeGeometries(skidGeos)!, dark2);
    this.strobe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 4 }));
    this.strobe.position.set(0, 0.3, -6.5);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 3, roughness: 0.2 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), lampMat);
    lamp.position.set(0, -1.4, 1.6);
    this.cone = new THREE.Mesh(
      new THREE.ConeGeometry(5.4, 22, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.075, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    this.cone.position.set(0, -11.4, 1.6);
    this.cone.rotation.x = Math.PI;
    this.search = new THREE.SpotLight(0xfff0c8, 0, 46, 0.45, 0.55, 1.1);
    this.search.position.set(0, -1.3, 1.6);
    const target = new THREE.Object3D();
    target.position.set(0, -14, 8);
    this.root.add(body, nose, cockpit, boom, fin, stab, this.rotor, mast, this.tailRotor, skids, this.strobe, lamp, this.cone, this.search, target);
    this.search.target = target;
    this.root.visible = false;
    scene.add(this.root);
  }

  spawn(pos: THREE.Vector3) {
    this.pos.copy(pos).setY(42);
    this.root.position.copy(this.pos);
    this.root.visible = true;
    this.hp = this.maxHp;
    this.dead = false;
    this.deathT = 0;
    this.root.rotation.set(0, 0, 0);
    this.root.scale.setScalar(1);
  }

  damage(n: number) {
    if (this.dead) return;
    this.hp -= n;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deathT = 0; }
  }

  update(dt: number, ctx: AirContext, time: number) {
    if (!this.root.visible) return;
    this.phase += dt;
    this.rotor.rotation.y += dt * 34;
    this.tailRotor.rotation.x += dt * 42;
    this.strobe.visible = Math.sin(time * 9) > 0.2;

    if (this.dead) {
      this.deathT += dt;
      this.vel.y -= 16 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.root.position.copy(this.pos);
      this.root.rotation.z += dt * 1.6;
      this.root.rotation.x += dt * 0.6;
      this.rotor.rotation.y += dt * 12;
      this.search.intensity = 0;
      this.cone.visible = false;
      if (this.pos.y <= ctx.surfaceAt(this.pos.x, this.pos.z) + 2 || this.deathT > 6) {
        ctx.onExplosion(this.pos.clone(), 16, 1.6);
        ctx.onLog('Вертолёт сбит');
        this.root.visible = false;
      }
      return;
    }

    // орбита вокруг игрока, снижение для атаки
    this.orbit = THREE.MathUtils.lerp(this.orbit, 26, 1 - Math.exp(-dt * 0.6));
    const want = _v.copy(ctx.playerPos)
      .add(_v2.set(Math.cos(this.phase * 0.34) * this.orbit, 0, Math.sin(this.phase * 0.34) * this.orbit));
    const altitude = 24 + Math.sin(this.phase * 0.7) * 2.4;
    want.y = altitude;
    this.vel.lerp(_v2.copy(want).sub(this.pos).multiplyScalar(0.6), 1 - Math.exp(-dt * 1.4));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = Math.max(altitude * 0.55, this.pos.y);
    this.root.position.copy(this.pos);
    this.root.rotation.y = Math.atan2(this.vel.x, this.vel.z) + Math.PI;
    this.root.rotation.z = -this.vel.x * 0.012;

    this.search.intensity = Math.min(1, 0.4 + this.effectiveNight) * 520;
    this.cone.visible = true;
    (this.cone.material as THREE.MeshBasicMaterial).opacity = 0.04 + this.effectiveNight * 0.08;

    // стрельба очередями
    const dist = this.pos.distanceTo(ctx.playerPos);
    if (dist < 85) {
      this.fireT -= dt;
      if (this.fireT <= 0) {
        if (this.burst <= 0) this.burst = 4;
        this.burst--;
        this.fireT = this.burst > 0 ? 0.12 : 1.9 + Math.random() * 1.2;
        const from = this.pos.clone().add(_v.set(0, -1, 0));
        const dir = _v2.copy(ctx.playerPos).setY(ctx.playerPos.y + 1.1).sub(from).normalize();
        dir.x += (Math.random() - 0.5) * 0.045;
        dir.z += (Math.random() - 0.5) * 0.045;
        ctx.onShoot(from, dir.clone().normalize());
      }
    }
  }

  effectiveNight = 0;

  hitTest(p0: THREE.Vector3, p1: THREE.Vector3, out: THREE.Vector3) {
    if (!this.root.visible || this.dead) return false;
    return segSphere(p0, p1, this.pos, 3.6, out);
  }
}

export class Tank {
  root = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  hp = 900;
  maxHp = 900;
  dead = false;
  private turret = new THREE.Group();
  private barrel: THREE.Mesh;
  private tracks: THREE.Mesh[] = [];
  private fireT = 4;
  private deathT = 0;
  private turretYaw = 0;
  private wheels = 0;
  private shells: { pos: THREE.Vector3; vel: THREE.Vector3; life: number }[] = [];

  constructor(scene: THREE.Scene) {
    const armor = new THREE.MeshStandardMaterial({ color: 0x3b4632, roughness: 0.72, metalness: 0.4 });
    const armor2 = new THREE.MeshStandardMaterial({ color: 0x2c3527, roughness: 0.8, metalness: 0.3 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.5, 8.6), armor);
    hull.position.y = 1.2;
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.1, 2.4), armor);
    glacis.position.set(0, 1.15, 4.2);
    glacis.rotation.x = -0.42;
    const rear = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.1, 1.8), armor2);
    rear.position.set(0, 1.1, -4.4);
    this.turret.position.set(0, 2.2, 0);
    const turretBody = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.1, 1.1, 12), armor);
    const turretBox = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 3.4), armor);
    turretBox.position.z = 0.4;
    this.barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 6.2, 10), armor2);
    this.barrel.rotation.x = Math.PI / 2;
    this.barrel.position.set(0, 0.15, 4.3);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.7, 10), armor2);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.15, 7.3);
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.24, 10), armor2);
    hatch.position.set(0, 0.65, -0.5);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 4), armor2);
    antenna.position.set(0.8, 1.6, -1.2);
    this.turret.add(turretBody, turretBox, this.barrel, muzzle, hatch, antenna);

    for (const x of [-2.5, 2.5]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 9.2), rubber);
      track.position.set(x, 0.75, 0);
      this.root.add(track);
      this.tracks.push(track);
      for (let i = 0; i < 5; i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.35, 10), armor2);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.7, -3.6 + i * 1.8);
        this.root.add(wheel);
      }
    }
    this.root.add(hull, glacis, rear, this.turret);
    this.root.visible = false;
    scene.add(this.root);
  }

  spawn(pos: THREE.Vector3, yaw: number) {
    this.pos.copy(pos);
    this.yaw = yaw;
    this.root.position.copy(pos);
    this.root.rotation.set(0, yaw, 0);
    this.root.visible = true;
    this.hp = this.maxHp;
    this.dead = false;
    this.deathT = 0;
    this.shells.length = 0;
  }

  damage(n: number) {
    if (this.dead) return;
    this.hp -= n;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deathT = 0; }
  }

  update(dt: number, ctx: AirContext) {
    if (!this.root.visible) return;
    if (this.dead) {
      this.deathT += dt;
      if (this.deathT > 1.1) {
        ctx.onExplosion(this.pos.clone().setY(1.6), 22, 2.2);
        ctx.onLog('Танк уничтожен');
        this.root.visible = false;
      }
      this.root.rotation.z += dt * 0.12;
      return;
    }
    const to = _v.copy(ctx.playerPos).sub(this.pos).setY(0);
    const d = to.length();
    to.normalize();
    const desired = Math.atan2(to.x, to.z);
    let dy = desired - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(dy, -dt * 0.7, dt * 0.7);
    const speed = d > 26 ? 7.5 : d < 16 ? -2.5 : 0;
    const nx = this.pos.x + Math.sin(this.yaw) * speed * dt;
    const nz = this.pos.z + Math.cos(this.yaw) * speed * dt;
    if (!ctx.blocked(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    this.pos.y = ctx.surfaceAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.wheels += speed * dt * 2.2;
    this.tracks.forEach((t, i) => { t.position.y = 0.75 + Math.abs(Math.sin(this.wheels + i)) * 0.02; });

    // башня доворачивается на игрока
    let ty = desired - this.yaw;
    while (ty > Math.PI) ty -= Math.PI * 2;
    while (ty < -Math.PI) ty += Math.PI * 2;
    this.turretYaw += THREE.MathUtils.clamp(ty - this.turretYaw, -dt * 1.1, dt * 1.1);
    this.turret.rotation.y = this.turretYaw;
    this.barrel.rotation.x = Math.PI / 2 - THREE.MathUtils.clamp((14 - ctx.playerPos.y) * 0.004, -0.18, 0.14);

    this.fireT -= dt;
    if (this.fireT <= 0 && d < 90) {
      this.fireT = 5.5 + Math.random() * 1.5;
      const muzzlePos = this.pos.clone().add(_v2.set(Math.sin(this.yaw + this.turretYaw) * 7, 2.4, Math.cos(this.yaw + this.turretYaw) * 7));
      const dir = _v2.copy(ctx.playerPos).setY(ctx.playerPos.y + 0.8).sub(muzzlePos).normalize();
      const vel = dir.multiplyScalar(88);
      vel.y += 6;
      this.shells.push({ pos: muzzlePos, vel, life: 0 });
      ctx.onShoot(muzzlePos, dir.clone().normalize());
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life += dt;
      s.vel.y -= 22 * dt;
      s.pos.addScaledVector(s.vel, dt);
      const ground = ctx.surfaceAt(s.pos.x, s.pos.z);
      if (s.pos.y <= ground || s.life > 8) {
        ctx.onExplosion(s.pos.clone(), 14, 1.9);
        this.shells.splice(i, 1);
      }
    }
  }

  hitTest(p0: THREE.Vector3, p1: THREE.Vector3, out: THREE.Vector3) {
    if (!this.root.visible || this.dead) return false;
    return segSphere(p0, p1, _c.copy(this.pos).setY(this.pos.y + 1.6), 4.1, out);
  }
}

export class AirSupport {
  heli: Helicopter;
  tank: Tank;
  private heliCooldown = 0;
  private tankCooldown = 0;
  private heliRespawn = false;
  private tankRespawn = false;

  constructor(scene: THREE.Scene) {
    this.heli = new Helicopter(scene);
    this.tank = new Tank(scene);
  }

  get heliActive() { return this.heli.root.visible && !this.heli.dead; }
  get tankActive() { return this.tank.root.visible && !this.tank.dead; }

  update(dt: number, ctx: AirContext, time: number, night: number) {
    this.heliCooldown = Math.max(0, this.heliCooldown - dt);
    this.tankCooldown = Math.max(0, this.tankCooldown - dt);
    this.heli.effectiveNight = night;
    // после уничтожения техника возвращается не сразу
    if (this.heli.dead && !this.heliRespawn) { this.heliRespawn = true; this.heliCooldown = 30; }
    if (!this.heli.dead) this.heliRespawn = false;
    if (this.tank.dead && !this.tankRespawn) { this.tankRespawn = true; this.tankCooldown = 40; }
    if (!this.tank.dead) this.tankRespawn = false;

    if (ctx.wanted >= 4) {
      if (!this.heli.root.visible && this.heliCooldown <= 0) {
        const a = Math.random() * Math.PI * 2;
        this.heli.spawn(_v.copy(ctx.playerPos).add(_v2.set(Math.cos(a) * 130, 0, Math.sin(a) * 130)));
        this.heliCooldown = 20;
        ctx.onLog('В воздухе полицейский вертолёт');
      }
    } else if (this.heli.root.visible && !this.heli.dead) {
      // ниже 4 звёзд вертолёт уходит
      this.heli.root.visible = false;
      this.heliCooldown = 6;
    }

    if (ctx.wanted >= 5) {
      if (!this.tank.root.visible && this.tankCooldown <= 0) {
        for (let tries = 0; tries < 24; tries++) {
          const a = Math.random() * Math.PI * 2;
          const r = 90 + Math.random() * 50;
          const p = _v.copy(ctx.playerPos).add(_v2.set(Math.cos(a) * r, 0, Math.sin(a) * r));
          if (!ctx.blocked(p.x, p.z)) {
            this.tank.spawn(p.clone(), Math.atan2(ctx.playerPos.x - p.x, ctx.playerPos.z - p.z));
            this.tankCooldown = 26;
            ctx.onLog('На улицы выехал танк');
            break;
          }
        }
      }
    } else if (this.tank.root.visible && !this.tank.dead) {
      this.tank.root.visible = false;
      this.tankCooldown = 8;
    }

    this.heli.update(dt, ctx, time);
    this.tank.update(dt, ctx);
  }

  hitTest(p0: THREE.Vector3, p1: THREE.Vector3, out: THREE.Vector3): 'heli' | 'tank' | null {
    if (this.heli.hitTest(p0, p1, out)) return 'heli';
    if (this.tank.hitTest(p0, p1, out)) return 'tank';
    return null;
  }

  reset() {
    this.heli.root.visible = false;
    this.heli.dead = false;
    this.tank.root.visible = false;
    this.tank.dead = false;
    this.heliCooldown = 0;
    this.tankCooldown = 0;
    this.heliRespawn = false;
    this.tankRespawn = false;
  }
}
