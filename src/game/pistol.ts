import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Material } from './audio';

// ---------------------------------------------------------------------------
// Реалистичный пистолет: полуавтомат, отдача, цикл затвора, магазин, перезарядка
// ---------------------------------------------------------------------------

export interface Bullet { pos: THREE.Vector3; vel: THREE.Vector3; life: number; dmg: number; traveled: number; pierce?: number }

export interface FireResult {
  ok: boolean;
  reason?: 'empty' | 'cycling' | 'reloading';
}

const _v = new THREE.Vector3();

export class Pistol {
  group = new THREE.Group();       // крепится к камере
  slide!: THREE.Group;
  frame!: THREE.Group;
  muzzle = new THREE.Object3D();
  muzzleFlash!: THREE.Mesh;
  flashLight!: THREE.PointLight;

  ammo = 15;
  reserve = 90;
  magSize = 15;
  reloading = false;
  reloadT = 0;
  cycling = 0;         // цикл затвора, сек
  triggerPull = 0;     // 0..1 нажатие
  recoil = 0;          // текущая отдача (смещение оружия)
  recoilVel = 0;
  recoilYaw = 0;
  recoilYawVel = 0;
  ads = 0;             // 0..1 прицеливание
  aimSpread = 0;       // накопленный разлёт
  swayX = 0;
  swayY = 0;
  swayVX = 0;
  swayVY = 0;
  bobPhase = 0;
  lastFireTime = -10;
  casingT = 0;
  muzzleT = 0;
  /** Тюнинг из магазина телефона. */
  suppressed = false;
  damageMul = 1;
  pierceBonus = 0;
  spreadMul = 1;
  recoilMul = 1;
  private time = 0;

  bullets: Bullet[] = [];

  constructor(camera: THREE.Camera) {
    camera.add(this.group);
    this.group.position.set(0.22, -0.24, -0.42);
    this.group.rotation.set(0.05, 0.12, 0);

    // ---- рама ----
    const frameParts: THREE.BufferGeometry[] = [];
    const grip = new THREE.BoxGeometry(0.05, 0.15, 0.06);
    grip.rotateX(-0.28);
    grip.translate(0, -0.075, 0.02);
    frameParts.push(grip);
    const body = new THREE.BoxGeometry(0.045, 0.07, 0.19);
    body.translate(0, 0.015, -0.02);
    frameParts.push(body);
    const triggerGuard = new THREE.TorusGeometry(0.028, 0.007, 6, 12, Math.PI);
    triggerGuard.rotateY(Math.PI / 2);
    triggerGuard.rotateZ(Math.PI);
    triggerGuard.translate(0, -0.045, 0.035);
    frameParts.push(triggerGuard);
    const frame = new THREE.Mesh(mergeGeometries(frameParts)!, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.55, metalness: 0.65 }));
    this.frame = new THREE.Group();
    this.frame.add(frame);
    this.group.add(this.frame);

    // ---- затвор ----
    const slideParts: THREE.BufferGeometry[] = [];
    const sl = new THREE.BoxGeometry(0.05, 0.058, 0.235);
    sl.translate(0, 0.055, -0.045);
    slideParts.push(sl);
    const barrel = new THREE.CylinderGeometry(0.011, 0.011, 0.06, 10);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0.05, -0.17);
    slideParts.push(barrel);
    const frontSight = new THREE.BoxGeometry(0.008, 0.014, 0.012);
    frontSight.translate(0, 0.09, -0.155);
    slideParts.push(frontSight);
    const rearSight = new THREE.BoxGeometry(0.03, 0.014, 0.012);
    rearSight.translate(0, 0.09, 0.055);
    slideParts.push(rearSight);
    const slide = new THREE.Mesh(mergeGeometries(slideParts)!, new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.35, metalness: 0.85 }));
    this.slide = new THREE.Group();
    this.slide.add(slide);
    this.group.add(this.slide);

    // дульный узел
    this.muzzle.position.set(0, 0.05, -0.2);
    this.slide.add(this.muzzle);

    const flashGeo = new THREE.ConeGeometry(0.035, 0.11, 6);
    flashGeo.rotateX(-Math.PI / 2);
    this.muzzleFlash = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.muzzleFlash.position.set(0, 0, -0.05);
    this.muzzle.add(this.muzzleFlash);
    this.flashLight = new THREE.PointLight(0xffcf80, 0, 9, 2);
    this.flashLight.position.set(0, 0, -0.1);
    this.muzzle.add(this.flashLight);

    // магазин
    this.mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.13, 0.05), new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.6, metalness: 0.5 }));
    this.mag.position.set(0, -0.085, 0.015);
    this.frame.add(this.mag);

    // спусковой крючок
    this.trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.028, 0.012), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.4, metalness: 0.8 }));
    this.trigger.position.set(0, -0.03, 0.035);
    this.frame.add(this.trigger);
  }

  mag!: THREE.Mesh;
  trigger!: THREE.Mesh;

  get canFire() { return !this.reloading && this.cycling <= 0 && this.ammo > 0; }

  // Попытка выстрела. Возвращает ок, если выстрел произошёл.
  tryFire(camera: THREE.Camera, spreadBase: number): FireResult {
    if (this.reloading) return { ok: false, reason: 'reloading' };
    if (this.cycling > 0) return { ok: false, reason: 'cycling' };
    if (this.ammo <= 0) return { ok: false, reason: 'empty' };
    this.ammo--;
    this.cycling = 0.085;           // цикл затвора ~12 выстр/мин быстрыми
    this.time = performance.now() / 1000;
    this.lastFireTime = this.time;

    // разброс: базовый + накопленный + движение
    const spread = (spreadBase + this.aimSpread) * this.spreadMul;
    const dir = camera.getWorldDirection(_v).clone();
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

    // скорость пули ~380 м/с с небольшой гравитацией
    this.bullets.push({
      pos: camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, 0.6),
      vel: dir.multiplyScalar(360),
      life: 0,
      dmg: 46 * this.damageMul,
      traveled: 0,
      pierce: 1 + this.pierceBonus,
    });
    this.aimSpread = Math.min(0.09, this.aimSpread + 0.012 * this.spreadMul);

    // отдача: оружие уходит назад и вверх, камера дёргается вверх
    this.recoilVel += 5.2 * this.recoilMul;
    this.recoilYawVel += (Math.random() - 0.5) * 1.6;
    this.muzzleT = 0.05;
    return { ok: true };
  }

  startReload(): boolean {
    if (this.reloading || this.ammo >= this.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadT = 0;
    return true;
  }

  update(dt: number, _camera: THREE.Camera, moveSpeed: number, camAngVel: THREE.Vector2, wantAds: boolean) {
    this.time += dt;
    if (this.cycling > 0) this.cycling = Math.max(0, this.cycling - dt);
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.aimSpread = Math.max(0, this.aimSpread - dt * 0.09);

    // прицеливание
    const adsTarget = wantAds && !this.reloading ? 1 : 0;
    this.ads += (adsTarget - this.ads) * (1 - Math.exp(-dt * 12));

    // перезарядка
    if (this.reloading) {
      this.reloadT += dt;
      const t = this.reloadT;
      if (t < 0.35) {
        this.mag.position.y = -0.085 - 0.12 * (t / 0.35);
        this.mag.rotation.x = -0.5 * (t / 0.35);
      } else if (t < 0.9) {
        this.mag.position.y = -0.085 - 0.12 * (1 - (t - 0.35) / 0.55);
        this.mag.rotation.x = -0.5 * (1 - (t - 0.35) / 0.55);
      } else if (t < 1.15) {
        this.mag.position.y = -0.085;
        this.mag.rotation.x = 0;
      } else {
        const need = this.magSize - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
      }
    } else {
      this.mag.position.y = -0.085;
      this.mag.rotation.x = 0;
    }

    // затвор: отход назад и возврат
    const cyc = this.cycling / 0.085;
    const slideBack = this.cycling > 0 ? Math.sin(Math.min(1, cyc) * Math.PI) * 0.045 : 0;
    this.slide.position.z = slideBack;

    // отдача (пружина)
    this.recoilVel += (-this.recoil * 260 - this.recoilVel * 22) * dt;
    this.recoil += this.recoilVel * dt;
    this.recoilYawVel += (-this.recoilYaw * 220 - this.recoilYawVel * 20) * dt;
    this.recoilYaw += this.recoilYawVel * dt;

    // покачивание и увод при движении
    this.bobPhase += dt * (2 + moveSpeed * 1.6);
    const bob = Math.min(1, moveSpeed / 3.4);
    const bx = Math.sin(this.bobPhase) * 0.012 * bob;
    const by = Math.abs(Math.cos(this.bobPhase)) * 0.014 * bob;
    // инерция от поворота камеры (пистолет отстаёт)
    const tgx = -camAngVel.y * 0.02;
    const tgy = -camAngVel.x * 0.02;
    this.swayVX += ((tgx - this.swayX) * 60 - this.swayVX * 11) * dt;
    this.swayVY += ((tgy - this.swayY) * 60 - this.swayVY * 11) * dt;
    this.swayX += this.swayVX * dt;
    this.swayY += this.swayVY * dt;

    // позиция оружия
    const hipX = 0.22, hipY = -0.24, hipZ = -0.42;
    const adsX = 0.0, adsY = -0.075, adsZ = -0.28;
    const tx = THREE.MathUtils.lerp(hipX, adsX, this.ads) + bx + this.swayX;
    const ty = THREE.MathUtils.lerp(hipY, adsY, this.ads) + by + this.swayY - this.recoil * 0.03;
    const tz = THREE.MathUtils.lerp(hipZ, adsZ, this.ads) + this.recoil * 0.055;
    this.group.position.set(tx, ty, tz);
    const rotX = THREE.MathUtils.lerp(0.05, 0, this.ads) + this.recoil * 0.28 + this.swayY * 0.6;
    const rotY = THREE.MathUtils.lerp(0.12, 0, this.ads) + this.recoilYaw * 0.12 + this.swayX * 0.5;
    const rotZ = THREE.MathUtils.lerp(0, 0, this.ads);
    this.group.rotation.set(rotX, rotY, rotZ);
    this.trigger.position.z = 0.035 - this.triggerPull * 0.012;

    // дульная вспышка
    const fm = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    if (this.muzzleT > 0) {
      const k = this.muzzleT / 0.05;
      fm.opacity = k;
      this.muzzleFlash.rotation.z = Math.random() * 6.28;
      this.muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.5);
      this.flashLight.intensity = 14 * k;
    } else {
      fm.opacity = 0;
      this.flashLight.intensity = 0;
    }
    this.casingT = Math.max(0, this.casingT - dt);
  }

  // доля отдачи для камеры
  cameraKick(): { pitch: number; yaw: number } {
    return { pitch: this.recoil * 0.035, yaw: this.recoilYaw * 0.02 };
  }

  spreadNow(base: number) {
    return base + this.aimSpread;
  }
}

export type { Material };
